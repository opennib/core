import test from "brittle"

import type { TranscriptEntry } from "../../src/types.js"
import { HISTORY_RETENTION_MS } from "../../src/config/constants.js"
import { HypercoreHistory } from "../../src/storage/hypercore-history.js"

// `list()` drops entries older than HISTORY_RETENTION_MS, so absolute epoch
// timestamps (1000, 2000, …) would make every test entry ~56 years stale and
// list() would return []. `at` is a small relative offset on a recent base.
const BASE = Date.now() - 60_000

// Bare has no node:fs/os/path, and we are NOT adding bare-fs. Hypercore creates
// missing directories, and relative paths resolve against CWD (tests always run
// from the package root), so each test opens its store at a fresh unique relative
// path. The npm test script wipes `test/.tmp` before each run — no in-test fs
// cleanup — and every opened store is closed via t.teardown.
let counter = 0
function freshPath(): string {
  counter++
  return `test/.tmp/history-${Date.now()}-${counter}`
}

function entry(id: string, text: string, at: number): TranscriptEntry {
  return {
    id,
    createdAt: BASE + at,
    text,
    language: "en",
    durationMs: 1000,
  }
}

test("HypercoreHistory: returns an empty list before any append", async (t) => {
  const history = new HypercoreHistory({ storagePath: freshPath() })
  t.teardown(() => history.close())
  const entries = await history.list()
  t.alike(entries, [])
})

test("HypercoreHistory: appends a single entry and reads it back", async (t) => {
  const history = new HypercoreHistory({ storagePath: freshPath() })
  t.teardown(() => history.close())
  await history.append(entry("1", "hello", 1000))
  const entries = await history.list()
  t.is(entries.length, 1)
  t.is(entries[0]?.id, "1")
  t.is(entries[0]?.text, "hello")
})

test("HypercoreHistory: returns entries newest-first", async (t) => {
  const history = new HypercoreHistory({ storagePath: freshPath() })
  t.teardown(() => history.close())
  await history.append(entry("1", "first", 1000))
  await history.append(entry("2", "second", 2000))
  await history.append(entry("3", "third", 3000))
  const entries = await history.list()
  t.alike(
    entries.map((e) => e.id),
    ["3", "2", "1"],
  )
})

test("HypercoreHistory: respects the limit option", async (t) => {
  const history = new HypercoreHistory({ storagePath: freshPath() })
  t.teardown(() => history.close())
  for (let i = 1; i <= 5; i++) {
    await history.append(entry(String(i), `line ${i}`, i * 1000))
  }
  const entries = await history.list({ limit: 2 })
  t.alike(
    entries.map((e) => e.id),
    ["5", "4"],
  )
})

test("HypercoreHistory: paginates with the before option (exclusive cursor)", async (t) => {
  const history = new HypercoreHistory({ storagePath: freshPath() })
  t.teardown(() => history.close())
  for (let i = 1; i <= 5; i++) {
    await history.append(entry(String(i), `line ${i}`, i * 1000))
  }
  const page = await history.list({ before: "4", limit: 2 })
  t.alike(
    page.map((e) => e.id),
    ["3", "2"],
  )
})

test("HypercoreHistory: returns an empty list when before targets an unknown id", async (t) => {
  const history = new HypercoreHistory({ storagePath: freshPath() })
  t.teardown(() => history.close())
  await history.append(entry("1", "a", 1000))
  const page = await history.list({ before: "missing" })
  t.alike(page, [])
})

test("HypercoreHistory: clear removes all entries", async (t) => {
  const history = new HypercoreHistory({ storagePath: freshPath() })
  t.teardown(() => history.close())
  await history.append(entry("1", "a", 1000))
  await history.append(entry("2", "b", 2000))
  await history.clear()
  const entries = await history.list()
  t.alike(entries, [])
})

test("HypercoreHistory: can append again after clear", async (t) => {
  const history = new HypercoreHistory({ storagePath: freshPath() })
  t.teardown(() => history.close())
  await history.append(entry("1", "a", 1000))
  await history.clear()
  await history.append(entry("2", "b", 2000))
  const entries = await history.list()
  t.alike(
    entries.map((e) => e.id),
    ["2"],
  )
})

test("HypercoreHistory: persists across reopen", async (t) => {
  const storagePath = freshPath()
  const history = new HypercoreHistory({ storagePath })
  await history.append(entry("1", "persisted", 1000))
  await history.close()

  const reopened = new HypercoreHistory({ storagePath })
  t.teardown(() => reopened.close())
  const entries = await reopened.list()
  t.alike(
    entries.map((e) => e.id),
    ["1"],
  )
})

test("HypercoreHistory: filters entries older than the retention window", async (t) => {
  const history = new HypercoreHistory({ storagePath: freshPath() })
  t.teardown(() => history.close())
  await history.append({
    ...entry("old", "ancient", 0),
    createdAt: Date.now() - HISTORY_RETENTION_MS - 60_000,
  })
  await history.append(entry("new", "recent", 1000))
  const entries = await history.list()
  t.alike(
    entries.map((e) => e.id),
    ["new"],
  )
})

test("HypercoreHistory: an expired entry appended AFTER recent ones does not hide them", async (t) => {
  // Regression: `createdAt` comes from the host clock, so a clock that jumps
  // backwards can append an old-looking entry after newer ones. list() walks
  // newest-first; treating the first expired entry as a stop signal wiped the
  // whole recent history in that case.
  const history = new HypercoreHistory({ storagePath: freshPath() })
  t.teardown(() => history.close())
  await history.append(entry("1", "recent a", 1000))
  await history.append(entry("2", "recent b", 2000))
  await history.append({
    ...entry("stale", "clock went backwards", 0),
    createdAt: Date.now() - HISTORY_RETENTION_MS - 60_000,
  })
  await history.append(entry("3", "recent c", 3000))
  const entries = await history.list()
  t.alike(
    entries.map((e) => e.id),
    ["3", "2", "1"],
  )
})

test("HypercoreHistory: retention cutoff follows the injected clock", async (t) => {
  const fixedNow = BASE + 10_000
  const pinned = new HypercoreHistory({
    storagePath: freshPath(),
    clock: () => fixedNow,
  })
  t.teardown(() => pinned.close())
  await pinned.append({
    ...entry("stale", "just past the window", 0),
    createdAt: fixedNow - HISTORY_RETENTION_MS - 1,
  })
  await pinned.append({
    ...entry("fresh", "just inside the window", 0),
    createdAt: fixedNow - HISTORY_RETENTION_MS + 1000,
  })
  const entries = await pinned.list()
  t.alike(
    entries.map((e) => e.id),
    ["fresh"],
  )
})

test("HypercoreHistory: opens lazily — constructor does not touch the disk", async (t) => {
  const fresh = new HypercoreHistory({ storagePath: freshPath() })
  t.teardown(() => fresh.close())
  const entries = await fresh.list()
  t.alike(entries, [])
})

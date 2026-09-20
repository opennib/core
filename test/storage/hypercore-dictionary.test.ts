import test from "brittle"

import type { DictionaryEntry } from "../../src/types.js"
import { DEFAULT_DICTIONARY_TERMS } from "../../src/config/constants.js"
import { HypercoreDictionary } from "../../src/storage/hypercore-dictionary.js"

// Bare has no node:fs/os/path, and we are NOT adding bare-fs. Hypercore creates
// missing directories, and relative paths resolve against CWD (tests always run
// from the package root), so each test opens its store at a fresh unique relative
// path. The npm test script wipes `test/.tmp` before each run — no in-test fs
// cleanup — and every opened store is closed via t.teardown.
let counter = 0
function freshPath(): string {
  counter++
  return `test/.tmp/dict-${Date.now()}-${counter}`
}

function entry(id: string, term: string, replacement?: string): DictionaryEntry {
  return {
    id,
    term,
    ...(replacement !== undefined ? { replacement } : {}),
    createdAt: 1000,
  }
}

// --- Raw log behavior (starter seeding disabled) ---

test("HypercoreDictionary: returns an empty list before any add", async (t) => {
  const dict = new HypercoreDictionary({ storagePath: freshPath(), seedDefaults: false })
  t.teardown(() => dict.close())
  t.alike(await dict.list(), [])
})

test("HypercoreDictionary: adds and lists a single entry", async (t) => {
  const dict = new HypercoreDictionary({ storagePath: freshPath(), seedDefaults: false })
  t.teardown(() => dict.close())
  await dict.add(entry("1", "opennib"))
  const items = await dict.list()
  t.is(items.length, 1)
  t.is(items[0]?.term, "opennib")
})

test("HypercoreDictionary: adds multiple entries and preserves them", async (t) => {
  const dict = new HypercoreDictionary({ storagePath: freshPath(), seedDefaults: false })
  t.teardown(() => dict.close())
  await dict.add(entry("1", "opennib"))
  await dict.add(entry("2", "QVAC"))
  await dict.add(entry("3", "Hyperswarm"))
  const terms = (await dict.list()).map((e) => e.term).sort()
  t.alike(terms, ["Hyperswarm", "QVAC", "opennib"])
})

test("HypercoreDictionary: supports replacement entries", async (t) => {
  const dict = new HypercoreDictionary({ storagePath: freshPath(), seedDefaults: false })
  t.teardown(() => dict.close())
  await dict.add(entry("1", "opennib", "open nib"))
  const items = await dict.list()
  t.is(items[0]?.term, "opennib")
  t.is(items[0]?.replacement, "open nib")
})

test("HypercoreDictionary: treats the latest add for an id as the current value", async (t) => {
  const dict = new HypercoreDictionary({ storagePath: freshPath(), seedDefaults: false })
  t.teardown(() => dict.close())
  await dict.add(entry("1", "opennib"))
  await dict.add({ id: "1", term: "Opennib", createdAt: 2000 })
  const items = await dict.list()
  t.is(items.length, 1)
  t.is(items[0]?.term, "Opennib")
})

test("HypercoreDictionary: remove tombstones an entry", async (t) => {
  const dict = new HypercoreDictionary({ storagePath: freshPath(), seedDefaults: false })
  t.teardown(() => dict.close())
  await dict.add(entry("1", "opennib"))
  await dict.add(entry("2", "QVAC"))
  await dict.remove("1")
  const items = await dict.list()
  t.alike(
    items.map((e) => e.term),
    ["QVAC"],
  )
})

test("HypercoreDictionary: remove of an unknown id is a recorded no-op for the materialized view", async (t) => {
  const dict = new HypercoreDictionary({ storagePath: freshPath(), seedDefaults: false })
  t.teardown(() => dict.close())
  await dict.remove("missing")
  t.alike(await dict.list(), [])
})

test("HypercoreDictionary: clear wipes all entries", async (t) => {
  const dict = new HypercoreDictionary({ storagePath: freshPath(), seedDefaults: false })
  t.teardown(() => dict.close())
  await dict.add(entry("1", "opennib"))
  await dict.add(entry("2", "QVAC"))
  await dict.clear()
  t.alike(await dict.list(), [])
})

test("HypercoreDictionary: can add again after clear", async (t) => {
  const dict = new HypercoreDictionary({ storagePath: freshPath(), seedDefaults: false })
  t.teardown(() => dict.close())
  await dict.add(entry("1", "opennib"))
  await dict.clear()
  await dict.add(entry("2", "QVAC"))
  const items = await dict.list()
  t.alike(
    items.map((e) => e.term),
    ["QVAC"],
  )
})

test("HypercoreDictionary: persists entries across reopen", async (t) => {
  const storagePath = freshPath()
  const dict = new HypercoreDictionary({ storagePath, seedDefaults: false })
  await dict.add(entry("1", "opennib"))
  await dict.close()

  const reopened = new HypercoreDictionary({ storagePath })
  t.teardown(() => reopened.close())
  const items = await reopened.list()
  t.alike(
    items.map((e) => e.term),
    ["opennib"],
  )
})

test("HypercoreDictionary: opens lazily — constructor does not touch the disk", async (t) => {
  const fresh = new HypercoreDictionary({ storagePath: freshPath(), seedDefaults: false })
  t.teardown(() => fresh.close())
  t.alike(await fresh.list(), [])
})

// --- Starter dictionary seeding (seedDefaults on, the default) ---

test("HypercoreDictionary starter seeding: seeds the starter dictionary into a fresh log by default", async (t) => {
  const dict = new HypercoreDictionary({ storagePath: freshPath() })
  t.teardown(() => dict.close())
  const items = await dict.list()
  t.alike(items.map((e) => e.id).sort(), DEFAULT_DICTIONARY_TERMS.map((s) => s.id).sort())
  const opennib = items.find((e) => e.id === "default-opennib")
  t.is(opennib?.term, "opennib")
  t.is(opennib?.replacement, "open nib")
})

test("HypercoreDictionary starter seeding: does not re-seed a log that already has events", async (t) => {
  const storagePath = freshPath()
  const dict = new HypercoreDictionary({ storagePath })
  await dict.list() // trigger seed
  await dict.remove("default-opennib")
  await dict.close()

  const reopened = new HypercoreDictionary({ storagePath })
  t.teardown(() => reopened.close())
  const ids = (await reopened.list()).map((e) => e.id)
  t.ok(!ids.includes("default-opennib"))
  t.ok(ids.includes("default-github"))
})

test("HypercoreDictionary starter seeding: re-seeds after clear + reopen (settings → reset restores the starter set)", async (t) => {
  const storagePath = freshPath()
  const dict = new HypercoreDictionary({ storagePath })
  await dict.list() // trigger seed
  await dict.clear()
  t.alike(await dict.list(), []) // same session stays cleared
  await dict.close()

  const reopened = new HypercoreDictionary({ storagePath })
  t.teardown(() => reopened.close())
  const items = await reopened.list()
  t.is(items.length, DEFAULT_DICTIONARY_TERMS.length)
})

import test from "brittle";

import Hypercore from "hypercore";

import { HISTORY_RETENTION_MS } from "../../src/config/constants.js";
import { compactingPath, oldPath } from "../../src/storage/internal/compact.js";
import { HypercoreDictionary } from "../../src/storage/hypercore-dictionary.js";
import { HypercoreHistory } from "../../src/storage/hypercore-history.js";
import type { DictionaryEntry, TranscriptEntry } from "../../src/types.js";
import { createStorageFs } from "./failing-storage-fs.js";

let counter = 0;
function freshPath(): string {
  counter++;
  return `test/.tmp/compact-${Date.now()}-${counter}`;
}

const NOW = 1_800_000_000_000;
const clock = (): number => NOW;
const live = (id: string, ageMs = 1000): TranscriptEntry => ({
  id,
  createdAt: NOW - ageMs,
  text: `text ${id}`,
  language: "en",
  durationMs: 500,
});
const expired = (id: string): TranscriptEntry => ({
  ...live(id),
  createdAt: NOW - HISTORY_RETENTION_MS - 60_000,
});
const word = (id: string, term: string): DictionaryEntry => ({
  id,
  term,
  createdAt: NOW,
});

/** Raw block count of the log on disk — what compaction actually changes. */
async function rawLength(storagePath: string): Promise<number> {
  const core = new Hypercore(storagePath, { valueEncoding: "json" });
  await core.ready();
  const n = core.length;
  await core.close();
  return n;
}

// ── history ──────────────────────────────────────────────────────────

test("compaction: history open removes expired entries from disk and keeps list() identical", async (t) => {
  const storagePath = freshPath();
  const fs = await createStorageFs();

  const seed = new HypercoreHistory({ storagePath, clock });
  await seed.append(expired("x1"));
  await seed.append(live("a", 3000));
  await seed.append(expired("x2"));
  await seed.append(live("b", 2000));
  await seed.append(live("c", 1000));
  const before = (await seed.list()).map((e) => e.id);
  await seed.close();
  t.is(await rawLength(storagePath), 5);

  const compacted = new HypercoreHistory({ storagePath, clock, fs });
  t.teardown(() => compacted.close());
  const after = (await compacted.list()).map((e) => e.id);
  t.alike(after, before);
  t.alike(after, ["c", "b", "a"]);
  await compacted.close();
  t.is(await rawLength(storagePath), 3);
  t.absent(await fs.exists(compactingPath(storagePath)));
  t.absent(await fs.exists(oldPath(storagePath)));
});

test("compaction: history open is a no-op when nothing is expired", async (t) => {
  const storagePath = freshPath();
  const fs = await createStorageFs();
  const seed = new HypercoreHistory({ storagePath, clock });
  await seed.append(live("a"));
  await seed.append(live("b"));
  await seed.close();

  const store = new HypercoreHistory({ storagePath, clock, fs });
  t.teardown(() => store.close());
  await store.list();
  t.alike(fs.ops, []);
});

test("compaction: without a StorageFs, expired entries stay on disk (today's behavior)", async (t) => {
  const storagePath = freshPath();
  const seed = new HypercoreHistory({ storagePath, clock });
  await seed.append(expired("x"));
  await seed.append(live("a"));
  await seed.close();

  const store = new HypercoreHistory({ storagePath, clock });
  t.alike(
    (await store.list()).map((e) => e.id),
    ["a"],
  );
  await store.close();
  t.is(await rawLength(storagePath), 2);
});

// ── crash recovery ───────────────────────────────────────────────────

test("compaction: crash BEFORE the swap (mid-copy) leaves the original intact and is cleaned up", async (t) => {
  const storagePath = freshPath();
  const seed = new HypercoreHistory({ storagePath, clock });
  await seed.append(expired("x"));
  await seed.append(live("a"));
  await seed.close();

  // ops during compaction: [remove .compacting, rename main→old, rename compacting→main, remove old]
  // Fail before the first rename: the new log has been fully written to
  // `.compacting` but the main log is untouched.
  const crashing = await createStorageFs();
  crashing.failAfter(1);
  const dying = new HypercoreHistory({ storagePath, clock, fs: crashing });
  await t.exception(dying.list(), /compaction failed/);
  t.ok(await crashing.exists(storagePath), "original log still present");
  t.ok(
    await crashing.exists(compactingPath(storagePath)),
    "stray .compacting left behind",
  );

  const fs = await createStorageFs();
  const recovered = new HypercoreHistory({ storagePath, clock, fs });
  t.teardown(() => recovered.close());
  t.alike(
    (await recovered.list()).map((e) => e.id),
    ["a"],
  );
  t.absent(await fs.exists(compactingPath(storagePath)));
  t.absent(await fs.exists(oldPath(storagePath)));
});

test("compaction: crash BETWEEN the two renames is completed on the next open with no data loss", async (t) => {
  const storagePath = freshPath();
  const seed = new HypercoreHistory({ storagePath, clock });
  await seed.append(expired("x"));
  await seed.append(live("a"));
  await seed.append(live("b"));
  await seed.close();

  // Fail after `rename main→old`: main is gone, `.old` holds the outgoing
  // log, `.compacting` holds the complete new one.
  const crashing = await createStorageFs();
  crashing.failAfter(2);
  const dying = new HypercoreHistory({ storagePath, clock, fs: crashing });
  await t.exception(dying.list(), /compaction failed/);
  t.absent(await crashing.exists(storagePath), "main log missing mid-swap");
  t.ok(await crashing.exists(oldPath(storagePath)));
  t.ok(await crashing.exists(compactingPath(storagePath)));

  const fs = await createStorageFs();
  const recovered = new HypercoreHistory({ storagePath, clock, fs });
  t.teardown(() => recovered.close());
  t.alike(
    (await recovered.list()).map((e) => e.id),
    ["b", "a"],
  );
  await recovered.close();
  t.is(await rawLength(storagePath), 2, "the compacted log was adopted");
  t.absent(await fs.exists(oldPath(storagePath)));
});

test("compaction: crash AFTER the swap (before removing .old) just drops the leftover", async (t) => {
  const storagePath = freshPath();
  const seed = new HypercoreHistory({ storagePath, clock });
  await seed.append(expired("x"));
  await seed.append(live("a"));
  await seed.close();

  const crashing = await createStorageFs();
  crashing.failAfter(3);
  const dying = new HypercoreHistory({ storagePath, clock, fs: crashing });
  await t.exception(dying.list(), /compaction failed/);
  t.ok(await crashing.exists(storagePath));
  t.ok(await crashing.exists(oldPath(storagePath)));

  const fs = await createStorageFs();
  const recovered = new HypercoreHistory({ storagePath, clock, fs });
  t.teardown(() => recovered.close());
  t.alike(
    (await recovered.list()).map((e) => e.id),
    ["a"],
  );
  t.absent(await fs.exists(oldPath(storagePath)));
});

// ── dictionary ───────────────────────────────────────────────────────

test("compaction: dictionary open folds tombstones; list() is unchanged; re-add after remove survives", async (t) => {
  const storagePath = freshPath();
  const fs = await createStorageFs();
  const seed = new HypercoreDictionary({
    storagePath,
    clock,
    seedDefaults: false,
  });
  await seed.add(word("d1", "opennib"));
  await seed.add(word("d2", "Hypercore"));
  await seed.remove("d1");
  await seed.add(word("d3", "Bare"));
  await seed.remove("d3");
  await seed.add(word("d1", "opennib"));
  const before = (await seed.list()).map((e) => e.term);
  await seed.close();
  t.is(await rawLength(storagePath), 6);

  const compacted = new HypercoreDictionary({
    storagePath,
    clock,
    seedDefaults: false,
    fs,
  });
  t.teardown(() => compacted.close());
  const after = (await compacted.list()).map((e) => e.term);
  t.alike(after, before);
  t.alike(after, ["Hypercore", "opennib"]);
  await compacted.close();
  t.is(await rawLength(storagePath), 2, "only the two live adds remain");
});

test("compaction: dictionary open is a no-op when the log has no tombstones", async (t) => {
  const storagePath = freshPath();
  const fs = await createStorageFs();
  const seed = new HypercoreDictionary({
    storagePath,
    clock,
    seedDefaults: false,
  });
  await seed.add(word("d1", "opennib"));
  await seed.close();

  const store = new HypercoreDictionary({
    storagePath,
    clock,
    seedDefaults: false,
    fs,
  });
  t.teardown(() => store.close());
  await store.list();
  t.alike(fs.ops, []);
});

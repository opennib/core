// Lesson 5 example — HypercoreHistory + HypercoreDictionary: append-only
// logs. Shows append/list ordering, persistence across reopen, the
// retention cutoff, and why dictionary removal is a TOMBSTONE (an event
// appended to the log) rather than a deletion. No models needed.
//
//   bare examples/05-hypercore-storage.mjs
import fs from "bare-fs";
import os from "bare-os";
import path from "bare-path";

import {
  HypercoreHistory,
  HypercoreDictionary,
} from "../dist/storage/index.js";
import { HISTORY_RETENTION_MS } from "../dist/config/constants.js";

const dir = path.join(os.tmpdir(), `lesson5-${Date.now()}`);
const historyDir = path.join(dir, "history");
const dictionaryDir = path.join(dir, "dictionary");
const now = Date.now();
const entry = (id, text, ageMs = 0) => ({
  id,
  createdAt: now - ageMs,
  text,
  language: "en",
  durationMs: 900,
});

// ── History ─────────────────────────────────────────────────────────
console.log("A) append three transcripts, list newest-first");
let history = new HypercoreHistory({ storagePath: historyDir });
await history.append(entry("h1", "first thing I said", 3000));
await history.append(entry("h2", "second thing", 2000));
await history.append(entry("h3", "third thing", 1000));
console.log(
  "   ",
  (await history.list()).map((e) => e.id),
); // [h3, h2, h1]
console.log(
  "    limit 2 →",
  (await history.list({ limit: 2 })).map((e) => e.id),
);
console.log(
  "    before h3 →",
  (await history.list({ before: "h3" })).map((e) => e.id),
);

console.log(
  "\nB) close, reopen from the same directory → data survived on disk",
);
await history.close();
history = new HypercoreHistory({ storagePath: historyDir });
console.log(
  "   ",
  (await history.list()).map((e) => e.id),
);
console.log(
  "    files on disk:",
  fs.readdirSync(historyDir).length,
  "→",
  fs.readdirSync(historyDir).slice(0, 4).join(", "),
  "…",
);

console.log(
  "\nC) retention: an entry older than 30 days is appended but never listed",
);
await history.append(
  entry("old", "from long ago", HISTORY_RETENTION_MS + 60_000),
);
console.log(
  "   ",
  (await history.list()).map((e) => e.id),
  "← recent entries kept, 'old' skipped; its bytes stay in the log, list() hides them",
);

// ── Dictionary ──────────────────────────────────────────────────────
console.log(
  "\nD) dictionary: add two terms, remove one → removal is a tombstone EVENT, not a delete",
);
const dictionary = new HypercoreDictionary({
  storagePath: dictionaryDir,
  seedDefaults: false,
});
await dictionary.add({
  id: "d1",
  term: "opennib",
  replacement: "open nib",
  createdAt: now,
});
await dictionary.add({
  id: "d2",
  term: "Hypercore",
  replacement: "hyper core",
  createdAt: now,
});
console.log(
  "    list →",
  (await dictionary.list()).map((e) => e.term),
);
await dictionary.remove("d1");
console.log(
  "    after remove(d1) →",
  (await dictionary.list()).map((e) => e.term),
);

console.log(
  "\nE) re-adding the same id after removal wins again (latest event per id)",
);
await dictionary.add({
  id: "d1",
  term: "opennib",
  replacement: "open nib",
  createdAt: now,
});
console.log(
  "    list →",
  (await dictionary.list()).map((e) => e.term),
);

console.log(
  "\nF) one writer per directory: a second store on the SAME path fails while the first is open",
);
const second = new HypercoreDictionary({
  storagePath: dictionaryDir,
  seedDefaults: false,
});
try {
  await second.list();
  console.log(
    "    ✗ UNEXPECTED: the second open succeeded — the exclusive lock is not working",
  );
} catch (err) {
  console.log(
    `    ✓ rejected as expected — ${err.name}: ${err.message.split("\n")[0]}`,
  );
  console.log(
    "    ↑ diagnose-open-error.ts turns hypercore-storage's raw fd-lock failure into that actionable message",
  );
}

console.log(
  "\nG) close the store, THEN read the raw log: every event is still there",
);
await dictionary.close();
console.log(
  "    raw log has",
  await rawLength(dictionaryDir),
  "events → [add d1, add d2, remove d1, add d1]; list() folds them to the current view",
);

await history.close();
Bare.exit(0);

// Peek at the underlying log via a fresh raw Hypercore (only valid once the
// store that owns the directory is closed — see F).
async function rawLength(storagePath) {
  const { default: Hypercore } = await import("hypercore");
  const core = new Hypercore(storagePath, { valueEncoding: "json" });
  await core.ready();
  const n = core.length;
  await core.close();
  return n;
}

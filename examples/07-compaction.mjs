// Lesson 7 example — storage compaction. Simulates a user's existing data
// (40 expired + 5 live transcripts, a dictionary with removals), then opens
// the stores the way the production workers do — with a `StorageFs` built on
// bare-fs — and proves the expired data is physically gone from disk while
// everything visible is unchanged. Finally simulates a crash mid-compaction
// and shows the next open recovering.
//
//   bare examples/07-compaction.mjs
import fs from "bare-fs";
import os from "bare-os";
import path from "bare-path";
import Hypercore from "hypercore";

import { HISTORY_RETENTION_MS } from "../dist/config/constants.js";
import {
  HypercoreDictionary,
  HypercoreHistory,
} from "../dist/storage/index.js";

// The exact adapter both production workers inject. Core never imports
// bare-fs itself — it only sees these three methods.
const storageFs = {
  rename: (from, to) => fs.promises.rename(from, to),
  remove: (p) => fs.promises.rm(p, { recursive: true, force: true }),
  exists: async (p) => {
    try {
      await fs.promises.stat(p);
      return true;
    } catch {
      return false;
    }
  },
};

const dir = path.join(os.tmpdir(), `lesson7-${Date.now()}`);
const historyDir = path.join(dir, "history");
const dictionaryDir = path.join(dir, "dictionary");
const now = Date.now();
const hour = 3_600_000;

// ── 1. a user's existing data (stores opened WITHOUT fs — like before compaction existed)
let history = new HypercoreHistory({ storagePath: historyDir });
for (let i = 0; i < 40; i++) {
  await history.append({
    id: `old${i}`,
    createdAt: now - HISTORY_RETENTION_MS - (i + 1) * hour,
    text: `expired transcript ${i}`,
    language: "en",
    durationMs: 900,
  });
}
for (let i = 0; i < 5; i++) {
  await history.append({
    id: `live${i}`,
    createdAt: now - (i + 1) * 60_000,
    text: `recent transcript ${i}`,
    language: "en",
    durationMs: 900,
  });
}
const visibleBefore = (await history.list()).map((e) => e.id);
await history.close();

let dictionary = new HypercoreDictionary({
  storagePath: dictionaryDir,
  seedDefaults: false,
});
await dictionary.add({ id: "a", term: "opennib", createdAt: now });
await dictionary.add({ id: "b", term: "Bare", createdAt: now });
await dictionary.remove("b");
await dictionary.add({ id: "c", term: "Hypercore", createdAt: now });
await dictionary.remove("a");
await dictionary.add({ id: "a", term: "opennib", createdAt: now });
const termsBefore = (await dictionary.list()).map((e) => e.term);
await dictionary.close();

console.log("A) existing data on disk");
console.log(
  `   history:    ${await rawBlocks(historyDir)} blocks in the log, ${visibleBefore.length} visible to the user`,
);
console.log(
  `   dictionary: ${await rawBlocks(dictionaryDir)} events in the log, ${termsBefore.length} visible terms`,
);
console.log(
  `   expired text physically present on disk: ${diskContains(historyDir, "expired transcript 0")}`,
);

// ── 2. next app launch — the workers open with storageFs → compaction runs inside open()
console.log(
  "\nB) next launch: open with a StorageFs (what both workers do) → compaction",
);
const t0 = Date.now();
history = new HypercoreHistory({ storagePath: historyDir, fs: storageFs });
dictionary = new HypercoreDictionary({
  storagePath: dictionaryDir,
  seedDefaults: false,
  fs: storageFs,
});
const visibleAfter = (await history.list()).map((e) => e.id);
const termsAfter = (await dictionary.list()).map((e) => e.term);
console.log(`   both stores opened + compacted in ${Date.now() - t0}ms`);
await history.close();
await dictionary.close();
console.log(
  `   history:    ${await rawBlocks(historyDir)} blocks (was 45)   visible unchanged: ${same(visibleBefore, visibleAfter)}`,
);
console.log(
  `   dictionary: ${await rawBlocks(dictionaryDir)} events (was 6)    visible unchanged: ${same(termsBefore, termsAfter)}`,
);
console.log(
  `   expired text physically present on disk: ${diskContains(historyDir, "expired transcript 0")}   ← the privacy fix`,
);
console.log(
  `   temp dirs left behind: ${fs.readdirSync(dir).filter((n) => n.includes(".")).length === 0 ? "none" : fs.readdirSync(dir).join(", ")}`,
);

// ── 3. a launch with nothing expired is a no-op
const t1 = Date.now();
history = new HypercoreHistory({ storagePath: historyDir, fs: storageFs });
await history.list();
await history.close();
console.log(
  `\nC) launch with nothing expired: ${Date.now() - t1}ms, log still ${await rawBlocks(historyDir)} blocks (no rewrite)`,
);

// ── 4. crash mid-compaction → next open recovers
console.log(
  "\nD) simulate a crash between the two directory renames, then reopen",
);
await appendExpired(historyDir);
let renames = 0;
const crashingFs = {
  ...storageFs,
  rename: async (from, to) => {
    renames++;
    if (renames === 2) throw new Error("simulated power loss");
    await storageFs.rename(from, to);
  },
};
try {
  await new HypercoreHistory({
    storagePath: historyDir,
    fs: crashingFs,
  }).list();
} catch (err) {
  console.log(
    `   ✓ compaction failed as simulated — ${err.name}: ${err.message}`,
  );
}
console.log(
  `   disk state mid-crash: main=${await storageFs.exists(historyDir)} .old=${await storageFs.exists(historyDir + ".old")} .compacting=${await storageFs.exists(historyDir + ".compacting")}`,
);
history = new HypercoreHistory({ storagePath: historyDir, fs: storageFs });
const recovered = (await history.list()).map((e) => e.id);
await history.close();
console.log(
  `   after reopen: ${recovered.length} visible entries (${same(recovered, visibleAfter) ? "identical to before the crash" : "MISMATCH"}), log ${await rawBlocks(historyDir)} blocks, leftover dirs: ${fs.readdirSync(dir).filter((n) => n.includes(".")).length}`,
);

Bare.exit(0);

// ── helpers ─────────────────────────────────────────────────────────
async function rawBlocks(storagePath) {
  const core = new Hypercore(storagePath, { valueEncoding: "json" });
  await core.ready();
  const n = core.length;
  await core.close();
  return n;
}
function diskContains(root, needle) {
  for (const name of fs.readdirSync(root)) {
    const p = path.join(root, name);
    if (fs.statSync(p).isDirectory()) {
      if (diskContains(p, needle)) return true;
    } else if (fs.readFileSync(p).includes(needle)) return true;
  }
  return false;
}
async function appendExpired(storagePath) {
  const h = new HypercoreHistory({ storagePath });
  await h.append({
    id: "late-old",
    createdAt: now - HISTORY_RETENTION_MS - hour,
    text: "expired again",
    language: "en",
    durationMs: 900,
  });
  await h.close();
}
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

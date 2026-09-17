// Lesson 7 — a host driving the COMPLETE worker (07-core-worker.mjs) through
// one real dictation: start → init → preload → transcribe → dictionary →
// cleanup → history → shutdown. Everything the app does, minus the UI.
//
//   say --file-format=WAVE --data-format=LEI16@16000 -o /tmp/hello.wav "the app is called open nib"
//   node examples/07-core-host.mjs /tmp/hello.wav
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import spawn from "bare-runtime/spawn";
import HRPC from "../spec/hrpc/index.js";
import { rehydrateError } from "../dist/rpc/protocol.js";
import { CleanupError } from "../dist/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const wavPath = process.argv[2];
const models = join(homedir(), "Library/Application Support/@opennib/desktop");
const whisperModel = join(models, "whisper/ggml-small.bin");
const llmModel = join(models, "llm/qwen2.5-0.5b-instruct-q4_k_m.gguf");
const dataDir = mkdtempSync(join(tmpdir(), "l7-"));
const socketPath = join(dataDir, "w.sock");

const unwrap = (res) => {
  if (res.error) throw rehydrateError(res.error.name, res.error.message);
  return res;
};
const step = (n, s) => console.log(`\n${n}. ${s}`);

// ── START: listen, spawn, connect ───────────────────────────────────
step(
  1,
  "START — listen on a socket, spawn `bare` with the worker, wait for it to connect",
);
const t0 = Date.now();
const connected = new Promise((resolve) =>
  createServer((s) => resolve(new HRPC(s))).listen(socketPath),
);
const worker = spawn("bare", {
  args: [join(here, "07-core-worker.mjs"), socketPath],
  stdio: ["ignore", "inherit", "inherit"],
});
const rpc = await connected;
console.log(`   worker up in ${Date.now() - t0}ms`);

// ── INIT ────────────────────────────────────────────────────────────
step(
  2,
  "INIT — where to keep data (also registers the SDK plugins in the worker)",
);
unwrap(
  await rpc.init({
    historyDir: join(dataDir, "history"),
    dictionaryDir: join(dataDir, "dictionary"),
  }),
);
console.log("   ok");

// ── PRELOAD: pay the model-load cost now, not on the first hotkey ────
step(3, "PRELOAD — load whisper before the user presses anything");
const t1 = Date.now();
unwrap(
  await rpc.transcriberPreload({ modelPath: whisperModel, language: "auto" }),
);
console.log(`   whisper 'small' loaded in ${Date.now() - t1}ms`);

// ── TRANSCRIBE: raw samples over the wire (the desktop route) ───────
step(4, "TRANSCRIBE — send 16 kHz float samples as one binary field");
const frame = readWavAsFrame(wavPath);
const samples = Buffer.from(
  frame.samples.buffer,
  frame.samples.byteOffset,
  frame.samples.byteLength,
);
const t2 = Date.now();
const { text: raw } = unwrap(
  await rpc.transcribe({
    samples,
    sampleRate: frame.sampleRate,
    durationMs: frame.durationMs,
    modelPath: whisperModel,
    language: "auto",
  }),
);
console.log(
  `   ${samples.length} bytes → ${JSON.stringify(raw)}  (${Date.now() - t2}ms)`,
);

// ── DICTIONARY ──────────────────────────────────────────────────────
step(
  5,
  "DICTIONARY — the user's custom words live in the worker's Hypercore log",
);
unwrap(
  await rpc.dictionaryAdd({
    id: "d1",
    term: "opennib",
    replacement: "open nib",
    createdAt: Date.now(),
  }),
);
const { entries: terms } = unwrap(await rpc.dictionaryList({}));
console.log(
  `   terms: ${terms.map((t) => `${t.replacement} → ${t.term}`).join(", ")}`,
);

// ── CLEANUP: optional; first show the typed error when it's off ─────
step(
  6,
  "CLEANUP — off by default: calling it yields a typed CleanupError on the host",
);
try {
  unwrap(await rpc.cleanerCleanup({ text: raw, language: "en", terms }));
} catch (err) {
  console.log(
    `   ${err.constructor.name}: ${err.message}   (instanceof CleanupError: ${err instanceof CleanupError})`,
  );
}

let final = raw;
if (existsSync(llmModel)) {
  step(7, "CLEANUP — configure the LLM (loads Qwen in the worker), then clean");
  const t3 = Date.now();
  unwrap(await rpc.cleanerConfigure({ modelPath: llmModel }));
  ({ text: final } = unwrap(
    await rpc.cleanerCleanup({ text: raw, language: "en", terms }),
  ));
  console.log(
    `   ${JSON.stringify(raw)}\n   → ${JSON.stringify(final)}  (${Date.now() - t3}ms incl. model load)`,
  );
} else {
  step(
    7,
    "CLEANUP — skipped (no LLM model installed); the raw text is the result",
  );
}

// ── HISTORY ─────────────────────────────────────────────────────────
step(8, "HISTORY — remember the transcript");
unwrap(
  await rpc.historyAppend({
    entry: {
      id: "t1",
      createdAt: Date.now(),
      text: final,
      language: "auto",
      durationMs: frame.durationMs,
      app: null,
    },
  }),
);
const { entries } = unwrap(await rpc.historyList({ limit: 5, before: null }));
console.log(
  `   ${entries.length} entry: ${JSON.stringify(entries[0].text)} (${entries[0].durationMs}ms)`,
);

// ── SHUTDOWN ────────────────────────────────────────────────────────
step(9, "SHUTDOWN — worker closes stores, unloads both models, exits");
unwrap(await rpc.shutdown({}));
worker.on("exit", (code) => {
  console.log(`   worker exited with code ${code}`);
  process.exit(0);
});

function readWavAsFrame(file) {
  const buf = readFileSync(file);
  let sampleRate = 16000,
    offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4),
      size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") sampleRate = buf.readUInt32LE(offset + 12);
    if (id === "data") {
      const pcm = buf.subarray(offset + 8, offset + 8 + size),
        s = new Float32Array(pcm.length / 2);
      for (let i = 0; i < s.length; i++) s[i] = pcm.readInt16LE(i * 2) / 32768;
      return {
        samples: s,
        sampleRate,
        durationMs: Math.round((s.length / sampleRate) * 1000),
      };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("no data chunk in WAV");
}

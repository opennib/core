// Lesson 7 — a COMPLETE core worker: every command in the contract, the real
// engines, the real stores. This is the production shape; the desktop app's
// worker is this file plus Electron-specific path handling.
//
// Started for you by 07-core-host.mjs — see that file.
import fs from "bare-fs";
import net from "bare-net";
import os from "bare-os";
import path from "bare-path";

import HRPC from "../spec/hrpc/index.js";
import {
  HypercoreDictionary,
  HypercoreHistory,
} from "../dist/storage/index.js";
import { WhisperTranscriber } from "../dist/whisper-transcriber.js";
import { LlmCleaner } from "../dist/llm-cleaner.js";
import { CleanupError } from "../dist/errors.js";

// ── 1. connect back to the host ─────────────────────────────────────
const rpc = new HRPC(net.connect(Bare.argv[Bare.argv.length - 1]));

// ── 2. the worker's entire state: five variables ────────────────────
let history = null;
let dictionary = null;
let transcriber = null;
let cleaner = null; // stays null unless the host configures one (LLM is optional)
let pluginsRegistered = false;

// ── 3. the two helpers every handler uses ───────────────────────────
// The generated dispatcher has no try/catch: a throw would hang the host
// forever. `guard` turns any throw into the response's `error` field.
const guard =
  (fn, empty = {}) =>
  async (req) => {
    try {
      return await fn(req);
    } catch (err) {
      return { error: { name: err.name, message: err.message }, ...empty };
    }
  };
const requireInit = () => {
  if (history === null) throw new Error("command received before init");
};

// Under Bare, @qvac/sdk runs models IN THIS PROCESS ("Bare-direct") and needs
// the engine plugins registered before the first call.
async function ensurePlugins() {
  if (pluginsRegistered) return;
  const { plugins } = await import("@qvac/sdk");
  const { whisperPlugin } =
    await import("@qvac/sdk/whispercpp-transcription/plugin");
  const { llmPlugin } = await import("@qvac/sdk/llamacpp-completion/plugin");
  plugins([whisperPlugin, llmPlugin]);
  pluginsRegistered = true;
}

// The transcriber's AudioEncoder seam (lesson 2): write the frame to a float32
// WAV so the SDK takes its well-tested ffmpeg path.
const wavFileEncoder = {
  audioFormat: "f32le",
  async encode(frame) {
    const file = path.join(os.tmpdir(), `onib-${Date.now()}.wav`);
    fs.writeFileSync(file, float32Wav(frame.samples, frame.sampleRate));
    return { chunk: file, cleanup: async () => fs.unlinkSync(file) };
  },
};

// ── 4. lifecycle ────────────────────────────────────────────────────
rpc.onInit(
  guard(async ({ historyDir, dictionaryDir }) => {
    await ensurePlugins();
    history = new HypercoreHistory({ storagePath: historyDir });
    dictionary = new HypercoreDictionary({ storagePath: dictionaryDir });
    transcriber = new WhisperTranscriber({ audioEncoder: wavFileEncoder });
    return { error: null };
  }),
);

rpc.onShutdown(
  guard(async () => {
    // Stores first (release the corestore locks), then the native engines.
    await history?.close();
    await dictionary?.close();
    await transcriber?.unloadAll();
    await cleaner?.unload();
    setTimeout(() => Bare.exit(0), 50); // reply first, then exit
    return { error: null };
  }),
);

// ── 5. transcription (lessons 1–2) ──────────────────────────────────
rpc.onTranscriberPreload(
  guard(async ({ modelPath, language }) => {
    requireInit();
    await transcriber.preload(modelPath, language);
    return { error: null };
  }),
);

rpc.onTranscribe(
  guard(
    async (req) => {
      requireInit();
      // The decoded `samples` is an UNALIGNED view into the RPC frame — copy it
      // before reinterpreting as Float32Array.
      const bytes = new Uint8Array(req.samples);
      const samples = new Float32Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength / 4,
      );
      const frame = {
        samples,
        sampleRate: req.sampleRate,
        durationMs: req.durationMs,
      };
      return {
        error: null,
        text: await transcriber.transcribe(frame, req.modelPath, req.language),
      };
    },
    { text: null },
  ),
);

rpc.onTranscribeFile(
  guard(
    async ({ wavPath, model, language }) => {
      requireInit();
      // The mobile route: audio is already a file. `model` is a path here; on
      // mobile the worker maps a catalog id to an SDK registry constant instead.
      const text = await transcriber.transcribe(
        readWavAsFrame(wavPath),
        model,
        language,
      );
      return { error: null, text };
    },
    { text: null },
  ),
);

rpc.onModelLoad(
  guard(async ({ model, language }) => {
    requireInit();
    await transcriber.preload(model, language);
    return { error: null };
  }),
);

rpc.onTranscriberUnloadAll(
  guard(async () => {
    requireInit();
    await transcriber.unloadAll();
    return { error: null };
  }),
);

// ── 6. optional LLM cleanup (lesson 3) ──────────────────────────────
rpc.onCleanerConfigure(
  guard(async ({ modelPath }) => {
    requireInit();
    await cleaner?.unload();
    cleaner = modelPath === null ? null : new LlmCleaner({ modelPath });
    return { error: null };
  }),
);

rpc.onCleanerCleanup(
  guard(
    async ({ text, language, terms }) => {
      requireInit();
      if (cleaner === null) throw new CleanupError("no cleaner configured");
      return {
        error: null,
        text: await cleaner.cleanup(text, language, terms ?? undefined),
      };
    },
    { text: null },
  ),
);

// ── 7. storage (lesson 5) — each handler is one library call ────────
rpc.onHistoryAppend(
  guard(async ({ entry }) => {
    requireInit();
    await history.append(entry);
    return { error: null };
  }),
);
rpc.onHistoryList(
  guard(
    async ({ limit, before }) => {
      requireInit();
      const entries = await history.list({
        ...(limit ? { limit } : {}),
        ...(before ? { before } : {}),
      });
      return { error: null, entries };
    },
    { entries: null },
  ),
);
rpc.onHistoryClear(
  guard(async () => {
    requireInit();
    await history.clear();
    return { error: null };
  }),
);
rpc.onDictionaryList(
  guard(
    async () => {
      requireInit();
      return { error: null, entries: await dictionary.list() };
    },
    { entries: null },
  ),
);
rpc.onDictionaryAdd(
  guard(async (entry) => {
    requireInit();
    await dictionary.add(entry);
    return { error: null };
  }),
);
rpc.onDictionaryRemove(
  guard(async ({ id }) => {
    requireInit();
    await dictionary.remove(id);
    return { error: null };
  }),
);
rpc.onDictionaryClear(
  guard(async () => {
    requireInit();
    await dictionary.clear();
    return { error: null };
  }),
);

// ── helpers ─────────────────────────────────────────────────────────
function float32Wav(samples, sampleRate) {
  const data = Buffer.from(
      samples.buffer,
      samples.byteOffset,
      samples.byteLength,
    ),
    h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(3, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(32, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
function readWavAsFrame(file) {
  const buf = fs.readFileSync(file);
  let sampleRate = 16000,
    offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4),
      size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") sampleRate = buf.readUInt32LE(offset + 12);
    if (id === "data") {
      const pcm = buf.subarray(offset + 8, offset + 8 + size),
        samples = new Float32Array(pcm.length / 2);
      for (let i = 0; i < samples.length; i++)
        samples[i] = pcm.readInt16LE(i * 2) / 32768;
      return {
        samples,
        sampleRate,
        durationMs: Math.round((samples.length / sampleRate) * 1000),
      };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("no data chunk in WAV");
}

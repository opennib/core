// Lesson 4 example — DictationPipeline, the push-to-talk state machine.
// Real Whisper engine; every PLATFORM capability (recorder, paster,
// notifier, history, settings, model manager) is a small fake that prints
// what the platform would do. Shows the happy path, then the error policy.
//
//   say --file-format=WAVE --data-format=LEI16@16000 -o /tmp/hello.wav "testing one two three"
//   bare examples/04-dictation-pipeline.mjs /tmp/hello.wav
import fs from "bare-fs";
import os from "bare-os";
import path from "bare-path";

import * as sdk from "@qvac/sdk";
import { whisperPlugin } from "@qvac/sdk/whispercpp-transcription/plugin";
import { DictationPipeline } from "../dist/dictation-pipeline.js";
import { WhisperTranscriber } from "../dist/whisper-transcriber.js";

sdk.plugins([whisperPlugin]);

const wavPath = Bare.argv[Bare.argv.length - 1];
const modelDir = path.join(
  os.homedir(),
  "Library/Application Support/@opennib/desktop/whisper",
);

// ── platform fakes ──────────────────────────────────────────────────
// On desktop these are Electron adapters; on mobile, Expo + native shells.
// Core only sees the interfaces.
const recorder = {
  frame: readWavAsFrame(wavPath),
  failStop: false,
  async start() {
    console.log("  [recorder] start — mic open");
  },
  async stop() {
    console.log("  [recorder] stop  — returning AudioFrame");
    if (this.failStop) throw new Error("microphone disconnected");
    return this.frame;
  },
};
const paster = {
  async paste(text) {
    console.log(`  [paster]   PASTE → ${JSON.stringify(text)}`);
  },
};
const notifier = {
  async notify(title, body) {
    console.log(`  [notifier] ${title}: ${body}`);
  },
};
const history = {
  entries: [],
  async append(e) {
    this.entries.push(e);
    console.log(
      `  [history]  appended #${this.entries.length} (${e.durationMs}ms, ${e.language})`,
    );
  },
};
const modelManager = {
  async isInstalled() {
    return true;
  },
  async pathFor(id) {
    return path.join(modelDir, `ggml-${id}.bin`);
  },
};
const settings = {
  whisperModelId: () => "small",
  language: () => "auto",
  cleanupEnabled: () => false,
  llmModelId: () => null,
};

const transcriber = new WhisperTranscriber({ audioEncoder: wavFileEncoder() });

const pipeline = new DictationPipeline({
  recorder,
  transcriber,
  modelManager,
  paster,
  history,
  notifier,
  settings,
  cleaner: () => null, // cleanup off → LLM never loaded
  dictionary: null,
  idFactory: () => `t-${Date.now()}`,
  onStateChange: (s) => console.log(`  [state]    → ${s}`),
});

console.log("A) happy path: hold hotkey (beginCycle) … release (endCycle)");
await pipeline.beginCycle();
await pipeline.endCycle();

console.log("\nB) endCycle() with nothing recording → ignored, no paste");
await pipeline.endCycle();
console.log(`  state is still: ${pipeline.currentState()}`);

console.log(
  "\nC) recorder.stop() throws → user is notified, state returns to idle, nothing pasted",
);
recorder.failStop = true;
await pipeline.beginCycle();
await pipeline.endCycle();
console.log(
  `  state is: ${pipeline.currentState()}, history still has ${history.entries.length} entry`,
);

await transcriber.unloadAll();
Bare.exit(0);

// ── helpers (same as example 02) ────────────────────────────────────
function wavFileEncoder() {
  return {
    audioFormat: "f32le",
    async encode(frame) {
      const tmp = path.join(os.tmpdir(), `lesson4-${Date.now()}.wav`);
      fs.writeFileSync(tmp, float32Wav(frame.samples, frame.sampleRate));
      return { chunk: tmp, cleanup: async () => fs.unlinkSync(tmp) };
    },
  };
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

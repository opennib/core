// Lesson 2 example — WhisperTranscriber end to end, under Bare (its
// production runtime). Demonstrates both seams: a WAV-file AudioEncoder
// (the reliable filePath route) and an injected `sdk` facade that logs
// every SDK call, so we can SEE the model cache behavior.
//
//   say --file-format=WAVE --data-format=LEI16@16000 -o /tmp/hello.wav "testing one two three"
//   bare examples/02-whisper-transcriber.mjs /tmp/hello.wav
import fs from "bare-fs"
import os from "bare-os"
import path from "bare-path"

import * as sdk from "@qvac/sdk"
import { whisperPlugin } from "@qvac/sdk/whispercpp-transcription/plugin"
import { WhisperTranscriber } from "../dist/whisper-transcriber.js"

const wavPath = Bare.argv[Bare.argv.length - 1]
const modelPath = path.join(
  os.homedir(),
  "Library/Application Support/@opennib/desktop/whisper/ggml-small.bin",
)

// Under Bare the SDK runs in-process ("Bare-direct") and needs the engine
// plugin registered before the first call. Under Node this step is not needed.
sdk.plugins([whisperPlugin])

// ── Seam 1: the SDK facade. Real SDK underneath, but every call is logged.
const loggingSdk = {
  async loadModel(opts) {
    console.log(`  [sdk] loadModel   language=${opts.modelConfig.language}`)
    return sdk.loadModel(opts)
  },
  async transcribe(opts) {
    console.log(`  [sdk] transcribe  modelId=${opts.modelId}`)
    return sdk.transcribe(opts)
  },
  async unloadModel(opts) {
    console.log(`  [sdk] unloadModel modelId=${opts.modelId}`)
    return sdk.unloadModel(opts)
  },
}

// ── Seam 2: an AudioEncoder that writes the frame to a float32 WAV file and
// hands the SDK a PATH (ffmpeg decodes it → f32le, hence audioFormat "f32le").
const wavFileEncoder = {
  audioFormat: "f32le",
  async encode(frame) {
    const tmp = path.join(os.tmpdir(), `lesson2-${Date.now()}.wav`)
    fs.writeFileSync(tmp, float32Wav(frame.samples, frame.sampleRate))
    return { chunk: tmp, cleanup: async () => fs.unlinkSync(tmp) }
  },
}

// Decode the input WAV (16 kHz s16le from `say`) into core's AudioFrame.
const frame = readWavAsFrame(wavPath)
console.log(
  `frame: ${frame.samples.length} samples, ${frame.durationMs}ms @ ${frame.sampleRate}Hz\n`,
)

const transcriber = new WhisperTranscriber({
  audioEncoder: wavFileEncoder,
  sdk: loggingSdk,
  useGpu: true,
})

console.log('1) transcribe with language "auto"  → expect loadModel')
console.log("   text:", JSON.stringify(await transcriber.transcribe(frame, modelPath, "auto")))

console.log('\n2) transcribe again with "auto"      → cache hit, NO loadModel')
console.log("   text:", JSON.stringify(await transcriber.transcribe(frame, modelPath, "auto")))

console.log(
  '\n3) transcribe with language "en"    → key changed → unloadModel(old) THEN loadModel(new)',
)
console.log("   text:", JSON.stringify(await transcriber.transcribe(frame, modelPath, "en")))
console.log('   (one model resident at a time — the "auto" context was released first)')

console.log("\n4) unloadAll()                       → releases the resident model")
await transcriber.unloadAll()

// The SDK keeps Bare's event loop alive after unload; exit explicitly.
Bare.exit(0)

// ── helpers ─────────────────────────────────────────────────────────
function readWavAsFrame(file) {
  const buf = fs.readFileSync(file)
  let sampleRate = 16000
  let offset = 12 // skip RIFF header, walk chunks
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === "fmt ") sampleRate = buf.readUInt32LE(offset + 12)
    if (id === "data") {
      const pcm = buf.subarray(offset + 8, offset + 8 + size)
      const samples = new Float32Array(pcm.length / 2)
      for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768
      return { samples, sampleRate, durationMs: Math.round((samples.length / sampleRate) * 1000) }
    }
    offset += 8 + size + (size % 2)
  }
  throw new Error("no data chunk in WAV")
}

function float32Wav(samples, sampleRate) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
  const h = Buffer.alloc(44)
  h.write("RIFF", 0)
  h.writeUInt32LE(36 + data.length, 4)
  h.write("WAVE", 8)
  h.write("fmt ", 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(3, 20) // format 3 = IEEE float
  h.writeUInt16LE(1, 22) // mono
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(sampleRate * 4, 28)
  h.writeUInt16LE(4, 32)
  h.writeUInt16LE(32, 34)
  h.write("data", 36)
  h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

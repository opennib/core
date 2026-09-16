import test from "brittle"

import type { AudioFrame } from "../src/types.js"
import { WhisperTranscriber, type WhisperSdk } from "../src/whisper-transcriber.js"
import type { WhisperModelConfig } from "../src/whisper-config.js"

// brittle can't mock modules the way vitest's `vi.mock("@qvac/sdk")` does, so
// the transcriber accepts an injected SDK facade. This recording fake stands
// in for the real @qvac/sdk so these tests never touch native binaries or
// real model files — the same isolation the vitest module mock provided.

type LoadModelArgs = {
  modelSrc: string
  modelType: "whispercpp-transcription"
  modelConfig: WhisperModelConfig
}

type TranscribeArgs = { modelId: string; audioChunk: string | Buffer }

interface FakeSdk extends WhisperSdk {
  readonly loadCalls: LoadModelArgs[]
  readonly transcribeCalls: TranscribeArgs[]
  readonly unloadCalls: Array<{ modelId: string }>
}

function makeSdk(
  behavior: {
    loadIds?: string[]
    transcribeResult?: string
    transcribeThrows?: unknown
    unloadThrows?: unknown
  } = {},
): FakeSdk {
  const loadCalls: LoadModelArgs[] = []
  const transcribeCalls: TranscribeArgs[] = []
  const unloadCalls: Array<{ modelId: string }> = []
  const loadIds = behavior.loadIds ?? ["model-id-1"]
  let loadIndex = 0
  return {
    loadCalls,
    transcribeCalls,
    unloadCalls,
    async loadModel(options) {
      loadCalls.push(options)
      const id = loadIds[loadIndex] ?? loadIds[loadIds.length - 1] ?? "model-id-1"
      loadIndex++
      return id
    },
    async transcribe(options) {
      transcribeCalls.push(options)
      if (behavior.transcribeThrows !== undefined) throw behavior.transcribeThrows
      return behavior.transcribeResult ?? "hello world"
    },
    async unloadModel(options) {
      unloadCalls.push(options)
      if (behavior.unloadThrows !== undefined) throw behavior.unloadThrows
    },
  }
}

function makeFrame(): AudioFrame {
  return {
    samples: new Float32Array(16_000),
    sampleRate: 16_000,
    durationMs: 1000,
  }
}

test("WhisperTranscriber: loads the model on first call and returns text from the SDK", async (t) => {
  const sdk = makeSdk()
  const wt = new WhisperTranscriber({ sdk })
  const text = await wt.transcribe(makeFrame(), "/m/base.bin", "auto")
  t.is(text, "hello world")
  t.is(sdk.loadCalls.length, 1)
  t.is(sdk.transcribeCalls.length, 1)
})

test("WhisperTranscriber: does NOT reload when the same (modelPath, language) is reused", async (t) => {
  const sdk = makeSdk()
  const wt = new WhisperTranscriber({ sdk })
  await wt.transcribe(makeFrame(), "/m/base.bin", "auto")
  await wt.transcribe(makeFrame(), "/m/base.bin", "auto")
  t.is(sdk.loadCalls.length, 1)
  t.is(sdk.transcribeCalls.length, 2)
})

test("WhisperTranscriber: switching modelPath unloads the previous model, then loads the new one", async (t) => {
  const sdk = makeSdk({ loadIds: ["id-base", "id-medium"] })
  const wt = new WhisperTranscriber({ sdk })
  await wt.transcribe(makeFrame(), "/m/base.bin", "auto")
  await wt.transcribe(makeFrame(), "/m/medium.bin", "auto")
  t.is(sdk.loadCalls.length, 2)
  t.alike(sdk.unloadCalls, [{ modelId: "id-base" }])
  t.is(sdk.transcribeCalls[1]?.modelId, "id-medium")
})

test("WhisperTranscriber: switching language unloads the previous context (one model resident)", async (t) => {
  const sdk = makeSdk({ loadIds: ["id-auto", "id-vi"] })
  const wt = new WhisperTranscriber({ sdk })
  await wt.transcribe(makeFrame(), "/m/base.bin", "auto")
  await wt.transcribe(makeFrame(), "/m/base.bin", "vi")
  t.is(sdk.loadCalls.length, 2)
  t.alike(sdk.unloadCalls, [{ modelId: "id-auto" }])
})

test("WhisperTranscriber: a failed unload of the outgoing model does not block the reload", async (t) => {
  const sdk = makeSdk({ loadIds: ["id-auto", "id-vi"], unloadThrows: new Error("addon busy") })
  const wt = new WhisperTranscriber({ sdk })
  await wt.transcribe(makeFrame(), "/m/base.bin", "auto")
  const text = await wt.transcribe(makeFrame(), "/m/base.bin", "vi")
  t.is(text, "hello world")
  t.is(sdk.loadCalls.length, 2)
  t.is(sdk.unloadCalls.length, 1)
})

test("WhisperTranscriber: concurrent loads for different keys serialize instead of evicting mid-flight", async (t) => {
  const sdk = makeSdk({ loadIds: ["id-auto", "id-vi"] })
  const wt = new WhisperTranscriber({ sdk })
  const [a, b] = await Promise.all([
    wt.transcribe(makeFrame(), "/m/base.bin", "auto"),
    wt.transcribe(makeFrame(), "/m/base.bin", "vi"),
  ])
  t.is(a, "hello world")
  t.is(b, "hello world")
  t.is(sdk.loadCalls.length, 2)
  t.alike(sdk.unloadCalls, [{ modelId: "id-auto" }])
  t.is(sdk.transcribeCalls[0]?.modelId, "id-auto")
  t.is(sdk.transcribeCalls[1]?.modelId, "id-vi")
})

test("WhisperTranscriber: sends language='auto' WITHOUT detect_language", async (t) => {
  const sdk = makeSdk()
  const wt = new WhisperTranscriber({ sdk })
  await wt.transcribe(makeFrame(), "/m/base.bin", "auto")
  const args = sdk.loadCalls[0]
  // The QVAC whispercpp addon's `language` handler atomically sets BOTH
  // `params.language` and `params.detect_language` when it sees "auto".
  // Sending `detect_language` explicitly fires a cross-validator that
  // reads `params.language` AFTER the language handler nulled it, and
  // throws `FAILED_TO_ACTIVATE: detect_language must be false if
  // language is not auto`. We must omit `detect_language` entirely.
  t.is(args?.modelConfig.language, "auto")
  t.ok(!Object.keys(args?.modelConfig ?? {}).includes("detect_language"))
})

test("WhisperTranscriber: sends a concrete language WITHOUT detect_language", async (t) => {
  const sdk = makeSdk()
  const wt = new WhisperTranscriber({ sdk })
  await wt.transcribe(makeFrame(), "/m/base.bin", "vi")
  const args = sdk.loadCalls[0]
  t.is(args?.modelConfig.language, "vi")
  t.ok(!Object.keys(args?.modelConfig ?? {}).includes("detect_language"))
})

test("WhisperTranscriber: converts frame.samples to s16le before sending to the SDK", async (t) => {
  const sdk = makeSdk()
  const wt = new WhisperTranscriber({ sdk })
  const frame: AudioFrame = {
    samples: new Float32Array([0, 0.5, -0.5, 1, -1]),
    sampleRate: 16_000,
    durationMs: 1,
  }
  await wt.transcribe(frame, "/m/base.bin", "auto")
  const chunk = sdk.transcribeCalls[0]?.audioChunk
  t.ok(Buffer.isBuffer(chunk))
  const buf = chunk as Buffer
  // s16le: 2 bytes per sample.
  t.is(buf.byteLength, frame.samples.length * 2)
  // Spot-check the conversion: int16 little-endian.
  const view = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2)
  t.is(view[0], 0)
  t.is(view[1], Math.round(0.5 * 0x7fff))
  t.is(view[2], Math.round(-0.5 * 0x8000))
  t.is(view[3], 0x7fff)
  t.is(view[4], -0x8000)
})

test("WhisperTranscriber: does NOT pass language on the per-call transcribe args", async (t) => {
  const sdk = makeSdk()
  const wt = new WhisperTranscriber({ sdk })
  await wt.transcribe(makeFrame(), "/m/base.bin", "vi")
  const args = sdk.transcribeCalls[0] as Record<string, unknown>
  t.ok(!Object.keys(args).includes("language"))
})

test("WhisperTranscriber: passes nThreads / useGpu / flashAttn defaults from the POC", async (t) => {
  const sdk = makeSdk()
  const wt = new WhisperTranscriber({ sdk })
  await wt.transcribe(makeFrame(), "/m/base.bin", "auto")
  const args = sdk.loadCalls[0]
  t.is(args?.modelConfig.n_threads, 4)
  t.is(args?.modelConfig.contextParams.use_gpu, true)
  t.is(args?.modelConfig.contextParams.flash_attn, true)
})

test("WhisperTranscriber: respects constructor-supplied options", async (t) => {
  const sdk = makeSdk()
  const wt = new WhisperTranscriber({ sdk, nThreads: 8, useGpu: false, flashAttn: false })
  await wt.transcribe(makeFrame(), "/m/base.bin", "auto")
  const args = sdk.loadCalls[0]
  t.is(args?.modelConfig.n_threads, 8)
  t.is(args?.modelConfig.contextParams.use_gpu, false)
  t.is(args?.modelConfig.contextParams.flash_attn, false)
})

test("WhisperTranscriber: unloadAll unloads the resident model and the next transcribe reloads", async (t) => {
  const sdk = makeSdk({ loadIds: ["id-base", "id-medium", "id-base-2"] })
  const wt = new WhisperTranscriber({ sdk })
  await wt.transcribe(makeFrame(), "/m/base.bin", "auto")
  await wt.transcribe(makeFrame(), "/m/medium.bin", "auto")
  // The switch above already evicted id-base; unloadAll releases id-medium.
  await wt.unloadAll()
  t.alike(sdk.unloadCalls, [{ modelId: "id-base" }, { modelId: "id-medium" }])

  await wt.transcribe(makeFrame(), "/m/base.bin", "auto")
  t.is(sdk.loadCalls.length, 3)
  t.is(sdk.transcribeCalls[2]?.modelId, "id-base-2")
})

test("WhisperTranscriber: unloadAll is safe to call when nothing is loaded", async (t) => {
  const sdk = makeSdk()
  const wt = new WhisperTranscriber({ sdk })
  await wt.unloadAll()
  t.is(sdk.unloadCalls.length, 0)
})

test("WhisperTranscriber: preload primes the cache so subsequent transcribe doesn't reload", async (t) => {
  const sdk = makeSdk()
  const wt = new WhisperTranscriber({ sdk })
  await wt.preload("/m/base.bin", "auto")
  t.is(sdk.loadCalls.length, 1)
  await wt.transcribe(makeFrame(), "/m/base.bin", "auto")
  t.is(sdk.loadCalls.length, 1)
  t.is(sdk.transcribeCalls.length, 1)
})

test("WhisperTranscriber: preload is idempotent for the same (modelPath, language)", async (t) => {
  const sdk = makeSdk()
  const wt = new WhisperTranscriber({ sdk })
  await wt.preload("/m/base.bin", "auto")
  await wt.preload("/m/base.bin", "auto")
  t.is(sdk.loadCalls.length, 1)
})

test("WhisperTranscriber: uses a custom audio encoder's chunk and audioFormat when provided", async (t) => {
  const sdk = makeSdk()
  let cleanupCalls = 0
  let encodeCalls = 0
  const customEncoder = {
    audioFormat: "f32le" as const,
    async encode() {
      encodeCalls++
      return {
        chunk: "/tmp/opennib-audio-xyz/frame.wav",
        async cleanup() {
          cleanupCalls++
        },
      }
    },
  }
  const wt = new WhisperTranscriber({ sdk, audioEncoder: customEncoder })
  await wt.transcribe(makeFrame(), "/m/base.bin", "auto")

  t.is(sdk.loadCalls[0]?.modelConfig.audio_format, "f32le")
  t.is(sdk.transcribeCalls[0]?.audioChunk, "/tmp/opennib-audio-xyz/frame.wav")
  t.is(encodeCalls, 1)
  t.is(cleanupCalls, 1)
})

test("WhisperTranscriber: calls encoder cleanup even when sdk transcribe rejects", async (t) => {
  const sdk = makeSdk({ transcribeThrows: new Error("boom") })
  let cleanupCalls = 0
  const customEncoder = {
    audioFormat: "f32le" as const,
    async encode() {
      return {
        chunk: "/tmp/x.wav",
        async cleanup() {
          cleanupCalls++
        },
      }
    },
  }
  const wt = new WhisperTranscriber({ sdk, audioEncoder: customEncoder })
  await t.exception(() => wt.transcribe(makeFrame(), "/m/base.bin", "auto"), /boom/)
  t.is(cleanupCalls, 1)
})

test("WhisperTranscriber: default encoder reports audioFormat='s16le'", async (t) => {
  const sdk = makeSdk()
  const wt = new WhisperTranscriber({ sdk })
  await wt.transcribe(makeFrame(), "/m/base.bin", "auto")
  t.is(sdk.loadCalls[0]?.modelConfig.audio_format, "s16le")
})

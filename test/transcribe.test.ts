import test from "brittle"

import { ModelLoadError, OpennibError, TranscriptionError, ValidationError } from "../src/errors.js"
import { transcribe } from "../src/transcribe.js"
import type { ModelManager, Transcriber } from "../src/interfaces/index.js"
import type { AudioFrame, LanguageTag } from "../src/types.js"

function makeFrame(overrides: Partial<AudioFrame> = {}): AudioFrame {
  return {
    samples: new Float32Array(16_000), // 1 second of silence
    sampleRate: 16_000,
    durationMs: 1000,
    ...overrides,
  }
}

class FakeModelManager implements ModelManager {
  private readonly installed: Set<string>
  private readonly paths: Map<string, string>

  constructor(opts: { installed?: readonly string[]; paths?: Record<string, string> } = {}) {
    this.installed = new Set(opts.installed ?? [])
    this.paths = new Map(Object.entries(opts.paths ?? {}))
  }

  async isInstalled(modelId: string): Promise<boolean> {
    return this.installed.has(modelId)
  }
  async download(): Promise<void> {}
  async pathFor(modelId: string): Promise<string> {
    return this.paths.get(modelId) ?? `/fake/models/${modelId}.bin`
  }
  async remove(): Promise<void> {}
}

class FakeTranscriber implements Transcriber {
  readonly calls: Array<{
    frame: AudioFrame
    modelPath: string
    language: LanguageTag
  }> = []

  constructor(private readonly behavior: { result?: string; throws?: unknown } = {}) {}

  async transcribe(frame: AudioFrame, modelPath: string, language: LanguageTag): Promise<string> {
    this.calls.push({ frame, modelPath, language })
    if (this.behavior.throws !== undefined) throw this.behavior.throws
    return this.behavior.result ?? "hello world"
  }
}

const installed = ["whisper-base"]

test("transcribe: returns text on the happy path", async (t) => {
  const tr = new FakeTranscriber({ result: "the quick brown fox" })
  const m = new FakeModelManager({ installed })
  const text = await transcribe(makeFrame(), {
    transcriber: tr,
    modelManager: m,
    modelId: "whisper-base",
  })
  t.is(text, "the quick brown fox")
  t.is(tr.calls.length, 1)
})

test("transcribe: rejects sample rates that aren't 16 kHz with ValidationError", async (t) => {
  const tr = new FakeTranscriber()
  const m = new FakeModelManager({ installed })
  try {
    await transcribe(makeFrame({ sampleRate: 44_100 }), {
      transcriber: tr,
      modelManager: m,
      modelId: "whisper-base",
    })
    t.fail("should have thrown")
  } catch (err) {
    t.ok(err instanceof ValidationError)
  }
  t.is(tr.calls.length, 0)
})

test("transcribe: rejects audio longer than the max with ValidationError", async (t) => {
  const tr = new FakeTranscriber()
  const m = new FakeModelManager({ installed })
  try {
    await transcribe(makeFrame({ durationMs: 60_001 }), {
      transcriber: tr,
      modelManager: m,
      modelId: "whisper-base",
    })
    t.fail("should have thrown")
  } catch (err) {
    t.ok(err instanceof ValidationError)
  }
})

test("transcribe: rejects empty audio with ValidationError", async (t) => {
  const tr = new FakeTranscriber()
  const m = new FakeModelManager({ installed })
  try {
    await transcribe(makeFrame({ samples: new Float32Array(0) }), {
      transcriber: tr,
      modelManager: m,
      modelId: "whisper-base",
    })
    t.fail("should have thrown")
  } catch (err) {
    t.ok(err instanceof ValidationError)
  }
})

test("transcribe: throws ModelLoadError when the requested model is not installed", async (t) => {
  const tr = new FakeTranscriber()
  const m = new FakeModelManager({ installed: [] })
  try {
    await transcribe(makeFrame(), {
      transcriber: tr,
      modelManager: m,
      modelId: "whisper-base",
    })
    t.fail("should have thrown")
  } catch (err) {
    t.ok(err instanceof ModelLoadError)
  }
  t.is(tr.calls.length, 0)
})

test("transcribe: wraps a non-OpennibError throw from the transcriber as TranscriptionError with cause", async (t) => {
  const root = new Error("whisper crashed")
  const tr = new FakeTranscriber({ throws: root })
  const m = new FakeModelManager({ installed })
  try {
    await transcribe(makeFrame(), {
      transcriber: tr,
      modelManager: m,
      modelId: "whisper-base",
    })
    t.fail("should have thrown")
  } catch (err) {
    t.ok(err instanceof TranscriptionError)
    t.is((err as TranscriptionError).cause, root)
  }
})

test("transcribe: re-throws an OpennibError from the transcriber unchanged", async (t) => {
  const inner = new TranscriptionError("model corrupted")
  const tr = new FakeTranscriber({ throws: inner })
  const m = new FakeModelManager({ installed })
  try {
    await transcribe(makeFrame(), {
      transcriber: tr,
      modelManager: m,
      modelId: "whisper-base",
    })
    t.fail("should have thrown")
  } catch (err) {
    t.is(err, inner)
  }
})

test("transcribe: never wraps an OpennibError subclass (any subclass passes through)", async (t) => {
  const inner = new ValidationError("transcriber said no")
  const tr = new FakeTranscriber({ throws: inner })
  const m = new FakeModelManager({ installed })
  try {
    await transcribe(makeFrame(), {
      transcriber: tr,
      modelManager: m,
      modelId: "whisper-base",
    })
    t.fail("should have thrown")
  } catch (err) {
    t.is(err, inner)
    t.ok(err instanceof OpennibError)
  }
})

test("transcribe: defaults language to 'auto' when omitted", async (t) => {
  const tr = new FakeTranscriber()
  const m = new FakeModelManager({ installed })
  await transcribe(makeFrame(), {
    transcriber: tr,
    modelManager: m,
    modelId: "whisper-base",
  })
  t.is(tr.calls[0]?.language, "auto")
})

test("transcribe: forwards the user-supplied language to the transcriber", async (t) => {
  const tr = new FakeTranscriber()
  const m = new FakeModelManager({ installed })
  await transcribe(makeFrame(), {
    transcriber: tr,
    modelManager: m,
    modelId: "whisper-base",
    language: "vi",
  })
  t.is(tr.calls[0]?.language, "vi")
})

test("transcribe: passes the resolved modelPath from ModelManager.pathFor to the transcriber", async (t) => {
  const tr = new FakeTranscriber()
  const m = new FakeModelManager({
    installed,
    paths: { "whisper-base": "/custom/path/whisper-base.bin" },
  })
  await transcribe(makeFrame(), {
    transcriber: tr,
    modelManager: m,
    modelId: "whisper-base",
  })
  t.is(tr.calls[0]?.modelPath, "/custom/path/whisper-base.bin")
})

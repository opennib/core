import test from "brittle"

import {
  CleanupError,
  ModelLoadError,
  PasterError,
  RecorderError,
  StorageError,
  TranscriptionError,
  WHISPER_SAMPLE_RATE_HZ,
  type AudioFrame,
  type Cleaner,
  type Dictionary,
  type DictionaryEntry,
  type History,
  type LanguageTag,
  type ModelManager,
  type Notifier,
  type Paster,
  type Recorder,
  type Settings,
  type SettingsSnapshot,
  type Transcriber,
  type TranscriptEntry,
} from "../src/index.js"

import { DictationPipeline, type PipelineState } from "../src/dictation-pipeline.js"

class FakeRecorder implements Recorder {
  starts = 0
  stops = 0
  startError: unknown = null
  stopError: unknown = null
  frame: AudioFrame = {
    samples: new Float32Array(WHISPER_SAMPLE_RATE_HZ),
    sampleRate: WHISPER_SAMPLE_RATE_HZ,
    durationMs: 1000,
  }

  async start(): Promise<void> {
    this.starts++
    if (this.startError !== null) throw this.startError
  }

  async stop(): Promise<AudioFrame> {
    this.stops++
    if (this.stopError !== null) throw this.stopError
    return this.frame
  }
}

class FakeTranscriber implements Transcriber {
  result = "  hello world  "
  error: unknown = null
  calls: Array<{ frame: AudioFrame; modelPath: string; language: LanguageTag }> = []

  async transcribe(frame: AudioFrame, modelPath: string, language: LanguageTag): Promise<string> {
    this.calls.push({ frame, modelPath, language })
    if (this.error !== null) throw this.error
    return this.result
  }
}

class FakeModelManager implements ModelManager {
  installed = true
  path = "/models/ggml-base.bin"
  requested: string[] = []

  async pathFor(modelId: string): Promise<string> {
    this.requested.push(modelId)
    return this.path
  }
  async isInstalled(modelId: string): Promise<boolean> {
    this.requested.push(modelId)
    return this.installed
  }
  async download(): Promise<void> {
    /* no-op */
  }
  async remove(): Promise<void> {
    /* no-op */
  }
}

class FakeCleaner implements Cleaner {
  result: string | null = null
  error: unknown = null
  calls: Array<{
    text: string
    language: LanguageTag
    terms: readonly DictionaryEntry[] | undefined
  }> = []

  async cleanup(
    text: string,
    language: LanguageTag,
    terms?: readonly DictionaryEntry[],
  ): Promise<string> {
    this.calls.push({ text, language, terms })
    if (this.error !== null) throw this.error
    return this.result ?? text
  }
}

class FakeDictionary implements Dictionary {
  entries: DictionaryEntry[] = []
  listError: unknown = null

  async list(): Promise<readonly DictionaryEntry[]> {
    if (this.listError !== null) throw this.listError
    return this.entries
  }
  async add(entry: DictionaryEntry): Promise<void> {
    this.entries.push(entry)
  }
  async remove(id: string): Promise<void> {
    this.entries = this.entries.filter((e) => e.id !== id)
  }
  async clear(): Promise<void> {
    this.entries = []
  }
}

class FakePaster implements Paster {
  pastes: string[] = []
  error: unknown = null

  async paste(text: string): Promise<void> {
    if (this.error !== null) throw this.error
    this.pastes.push(text)
  }
}

class FakeHistory implements History {
  entries: TranscriptEntry[] = []
  appendError: unknown = null

  async append(entry: TranscriptEntry): Promise<void> {
    if (this.appendError !== null) throw this.appendError
    this.entries.push(entry)
  }
  async list(): Promise<readonly TranscriptEntry[]> {
    return this.entries
  }
  async clear(): Promise<void> {
    this.entries = []
  }
}

class FakeNotifier implements Notifier {
  notifications: Array<{ title: string; body: string }> = []

  async notify(title: string, body: string): Promise<void> {
    this.notifications.push({ title, body })
  }
}

class FakeSettings implements Settings {
  current: SettingsSnapshot = {
    whisperModelId: "base",
    language: "en",
    cleanupEnabled: false,
    llmModelId: null,
  }
  private listeners = new Set<(s: SettingsSnapshot) => void>()

  whisperModelId(): string {
    return this.current.whisperModelId
  }
  language(): LanguageTag {
    return this.current.language
  }
  cleanupEnabled(): boolean {
    return this.current.cleanupEnabled
  }
  llmModelId(): string | null {
    return this.current.llmModelId
  }
  snapshot(): SettingsSnapshot {
    return this.current
  }
  async setWhisperModelId(id: string): Promise<void> {
    this.current = { ...this.current, whisperModelId: id }
    for (const l of this.listeners) l(this.current)
  }
  async setLanguage(language: LanguageTag): Promise<void> {
    this.current = { ...this.current, language }
    for (const l of this.listeners) l(this.current)
  }
  async setCleanupEnabled(enabled: boolean): Promise<void> {
    this.current = { ...this.current, cleanupEnabled: enabled }
    for (const l of this.listeners) l(this.current)
  }
  async setLlmModelId(id: string | null): Promise<void> {
    this.current = { ...this.current, llmModelId: id }
    for (const l of this.listeners) l(this.current)
  }
  onChange(handler: (s: SettingsSnapshot) => void): () => void {
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }
}

interface Harness {
  recorder: FakeRecorder
  transcriber: FakeTranscriber
  modelManager: FakeModelManager
  cleaner: FakeCleaner
  dictionary: FakeDictionary
  paster: FakePaster
  history: FakeHistory
  notifier: FakeNotifier
  settings: FakeSettings
  pipeline: DictationPipeline
}

function build(
  opts: {
    withCleaner?: boolean
    withDictionary?: boolean
    onStateChange?: (state: PipelineState) => void
  } = {},
): Harness {
  const recorder = new FakeRecorder()
  const transcriber = new FakeTranscriber()
  const modelManager = new FakeModelManager()
  const cleaner = new FakeCleaner()
  const dictionary = new FakeDictionary()
  const paster = new FakePaster()
  const history = new FakeHistory()
  const notifier = new FakeNotifier()
  const settings = new FakeSettings()

  const pipeline = new DictationPipeline({
    recorder,
    transcriber,
    modelManager,
    cleaner: opts.withCleaner === false ? () => null : () => cleaner,
    dictionary: opts.withDictionary === false ? null : dictionary,
    paster,
    history,
    notifier,
    settings,
    ...(opts.onStateChange !== undefined ? { onStateChange: opts.onStateChange } : {}),
    clock: () => 1234,
    idFactory: () => "fixed-id",
  })

  return {
    recorder,
    transcriber,
    modelManager,
    cleaner,
    dictionary,
    paster,
    history,
    notifier,
    settings,
    pipeline,
  }
}

async function flushAsync(): Promise<void> {
  // Flush microtasks so handler-spawned promises settle. Each await yields
  // once; 16 covers the deepest chain in runCycle (recorder.stop →
  // isInstalled → pathFor → transcribe → cleaner → paste → history) with
  // headroom for back-to-back cycles in the same test.
  for (let i = 0; i < 16; i++) {
    await Promise.resolve()
  }
}

test("DictationPipeline: beginCycle starts the recorder and transitions to recording", async (t) => {
  const harness = build()
  await harness.pipeline.beginCycle()
  t.is(harness.recorder.starts, 1)
  t.is(harness.pipeline.currentState(), "recording")
})

test("DictationPipeline: beginCycle → endCycle runs the full cycle: record, transcribe, cleanup, paste, history", async (t) => {
  const harness = build()
  await harness.pipeline.beginCycle()
  t.is(harness.recorder.starts, 1)

  await harness.pipeline.endCycle()
  await flushAsync()

  t.is(harness.recorder.stops, 1)
  t.is(harness.transcriber.calls.length, 1)
  t.is(harness.transcriber.calls[0]?.modelPath, "/models/ggml-base.bin")
  t.is(harness.transcriber.calls[0]?.language, "en")
  t.is(harness.cleaner.calls.length, 1)
  t.is(harness.cleaner.calls[0]?.text, "hello world")
  t.alike(harness.paster.pastes, ["hello world"])
  t.alike(harness.history.entries, [
    {
      id: "fixed-id",
      createdAt: 1234,
      text: "hello world",
      language: "en",
      durationMs: 1000,
    },
  ])
  t.is(harness.notifier.notifications.length, 0)
})

test("DictationPipeline: uses the cleaner's output when it differs from the trimmed transcript", async (t) => {
  const harness = build()
  harness.cleaner.result = "Hello, world."
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()

  t.alike(harness.paster.pastes, ["Hello, world."])
  t.is(harness.history.entries[0]?.text, "Hello, world.")
})

test("DictationPipeline: skips the cleaner when not configured (cleaner: null)", async (t) => {
  const h = build({ withCleaner: false })
  await h.pipeline.beginCycle()
  await h.pipeline.endCycle()
  await flushAsync()

  t.alike(h.paster.pastes, ["hello world"])
  t.is(h.history.entries.length, 1)
})

test("DictationPipeline: falls back to the raw transcript and continues when cleanup throws", async (t) => {
  const harness = build()
  harness.cleaner.error = new CleanupError("boom")
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()

  t.alike(harness.paster.pastes, ["hello world"])
  t.is(harness.history.entries.length, 1)
  // Cleanup failure stays a soft warning — no user notification.
  t.is(harness.notifier.notifications.length, 0)
})

test("DictationPipeline: skips paste and history when transcription returns empty text", async (t) => {
  const harness = build()
  harness.transcriber.result = "   "
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()

  t.alike(harness.paster.pastes, [])
  t.alike(harness.history.entries, [])
  t.is(harness.notifier.notifications.length, 0)
})

test("DictationPipeline: notifies and aborts when recorder.start fails", async (t) => {
  const harness = build()
  harness.recorder.startError = new RecorderError("device busy")
  await harness.pipeline.beginCycle()
  await flushAsync()

  t.alike(harness.notifier.notifications, [
    { title: "Could not start recording", body: "device busy" },
  ])
  // endCycle after a failed start is a no-op (state is back to idle).
  await harness.pipeline.endCycle()
  await flushAsync()
  t.is(harness.recorder.stops, 0)
})

test("DictationPipeline: notifies and aborts when recorder.stop fails", async (t) => {
  const harness = build()
  harness.recorder.stopError = new RecorderError("ipc died")
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()

  t.alike(harness.notifier.notifications, [{ title: "Recording failed", body: "ipc died" }])
  t.is(harness.transcriber.calls.length, 0)
  t.alike(harness.paster.pastes, [])
})

test("DictationPipeline: notifies and aborts when transcribe fails (model not installed)", async (t) => {
  const harness = build()
  harness.modelManager.installed = false
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()

  t.is(harness.notifier.notifications[0]?.title, "Transcription failed")
  t.alike(harness.paster.pastes, [])
  t.alike(harness.history.entries, [])
})

test("DictationPipeline: propagates ModelLoadError through transcription", async (t) => {
  const harness = build()
  harness.transcriber.error = new ModelLoadError("missing weights")
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()

  t.is(harness.notifier.notifications.length, 1)
  t.ok((harness.notifier.notifications[0]?.body ?? "").includes("missing weights"))
})

test("DictationPipeline: wraps non-OpennibError thrown from the transcriber", async (t) => {
  const harness = build()
  harness.transcriber.error = new Error("native crash")
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()

  t.is(harness.notifier.notifications[0]?.title, "Transcription failed")
  // transcribe() wraps non-OpennibError as TranscriptionError("transcription failed", cause)
  t.is(harness.notifier.notifications[0]?.body, "transcription failed")
})

test("DictationPipeline: notifies and skips history when paste fails", async (t) => {
  const harness = build()
  harness.paster.error = new PasterError("paste-helper missing")
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()

  t.alike(harness.notifier.notifications, [
    { title: "Could not paste transcript", body: "paste-helper missing" },
  ])
  t.alike(harness.history.entries, [])
})

test("DictationPipeline: does NOT notify when history append fails (user already got the paste)", async (t) => {
  const harness = build()
  harness.history.appendError = new StorageError("disk full")
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()

  t.alike(harness.paster.pastes, ["hello world"])
  t.alike(harness.notifier.notifications, [])
})

test("DictationPipeline: ignores extra beginCycle calls while recording", async (t) => {
  const harness = build()
  await harness.pipeline.beginCycle()
  await flushAsync()
  await harness.pipeline.beginCycle()
  await flushAsync()
  t.is(harness.recorder.starts, 1)
})

test("DictationPipeline: ignores endCycle without a prior beginCycle", async (t) => {
  const harness = build()
  await harness.pipeline.endCycle()
  await flushAsync()
  t.is(harness.recorder.stops, 0)
  t.is(harness.transcriber.calls.length, 0)
})

test("DictationPipeline: ignores beginCycle while a previous cycle is still processing", async (t) => {
  const harness = build()
  let resolveTranscribe!: (text: string) => void
  harness.transcriber.transcribe = () =>
    new Promise<string>((resolve) => {
      resolveTranscribe = resolve
    })
  await harness.pipeline.beginCycle()
  void harness.pipeline.endCycle()
  await flushAsync()

  // Transcription is still pending; a second beginCycle should be ignored.
  await harness.pipeline.beginCycle()
  await flushAsync()
  t.is(harness.recorder.starts, 1)

  // Resolve the in-flight cycle and verify a new beginCycle now starts a new one.
  resolveTranscribe("done")
  await flushAsync()
  await harness.pipeline.beginCycle()
  await flushAsync()
  t.is(harness.recorder.starts, 2)
})

test("DictationPipeline: forwards dictionary terms to the cleaner when the dictionary has entries", async (t) => {
  const harness = build()
  harness.dictionary.entries = [
    { id: "1", term: "opennib", createdAt: 0 },
    { id: "2", term: "QVAC", replacement: "kuvac", createdAt: 0 },
  ]
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()

  t.alike(harness.cleaner.calls[0]?.terms, harness.dictionary.entries)
})

test("DictationPipeline: does NOT pass terms when dictionary is null", async (t) => {
  const h = build({ withDictionary: false })
  await h.pipeline.beginCycle()
  await h.pipeline.endCycle()
  await flushAsync()

  t.is(h.cleaner.calls[0]?.terms, undefined)
})

test("DictationPipeline: falls back to no terms when dictionary.list throws (still cleans)", async (t) => {
  const harness = build()
  harness.dictionary.listError = new StorageError("disk corrupted")
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()

  t.is(harness.cleaner.calls.length, 1)
  t.is(harness.cleaner.calls[0]?.terms, undefined)
  t.alike(harness.paster.pastes, ["hello world"])
  t.is(harness.notifier.notifications.length, 0)
})

test("DictationPipeline: returns to idle so a new cycle works after an error", async (t) => {
  const harness = build()
  harness.transcriber.error = new TranscriptionError("once")
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()
  t.is(harness.notifier.notifications.length, 1)

  harness.transcriber.error = null
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()
  t.alike(harness.paster.pastes, ["hello world"])
})

test("DictationPipeline: emits idle → recording → processing → idle through the state callback", async (t) => {
  const states: PipelineState[] = []
  const h = build({ onStateChange: (s) => states.push(s) })
  await h.pipeline.beginCycle()
  await flushAsync()
  await h.pipeline.endCycle()
  await flushAsync()
  t.alike(states, ["recording", "processing", "idle"])
})

test("DictationPipeline: emits recording then idle when recorder.start fails", async (t) => {
  const states: PipelineState[] = []
  const h = build({ onStateChange: (s) => states.push(s) })
  h.recorder.startError = new RecorderError("mic blocked")
  await h.pipeline.beginCycle()
  await flushAsync()
  t.alike(states, ["recording", "idle"])
})

test("DictationPipeline: reads language from settings live, picking up runtime changes", async (t) => {
  const harness = build()
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()
  t.is(harness.history.entries[0]?.language, "en")

  await harness.settings.setLanguage("fr")
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()
  t.is(harness.history.entries[1]?.language, "fr")
})

test("DictationPipeline: reads whisperModelId from settings live", async (t) => {
  const harness = build()
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()
  t.ok(harness.modelManager.requested.includes("base"))

  await harness.settings.setWhisperModelId("small")
  await harness.pipeline.beginCycle()
  await harness.pipeline.endCycle()
  await flushAsync()
  t.ok(harness.modelManager.requested.includes("small"))
})

test("DictationPipeline: does not blow up when the state listener throws", async (t) => {
  const h = build({
    onStateChange: () => {
      throw new Error("listener exploded")
    },
  })
  await h.pipeline.beginCycle()
  await flushAsync()
  await h.pipeline.endCycle()
  await flushAsync()
  t.alike(h.paster.pastes, ["hello world"])
})

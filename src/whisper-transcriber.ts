import type { Transcriber } from "./interfaces/index.js"
import { log } from "./log.js"
import type { AudioFrame, LanguageTag } from "./types.js"
import { buildWhisperModelConfig, type WhisperModelConfig } from "./whisper-config.js"

/**
 * The slice of `@qvac/sdk` the transcriber calls. Tests inject a recording
 * fake so the suite runs under Bare without loading native binaries;
 * production resolves the real SDK on first use via a lazy dynamic import.
 */
export interface WhisperSdk {
  loadModel(options: {
    modelSrc: string
    modelType: "whispercpp-transcription"
    modelConfig: WhisperModelConfig
  }): Promise<string>
  transcribe(options: { modelId: string; audioChunk: string | Buffer }): Promise<string>
  unloadModel(options: { modelId: string }): Promise<void>
}

/**
 * Strategy for converting an `AudioFrame` into the form `@qvac/sdk`'s
 * `transcribe()` expects. The two viable options are:
 *
 *   - a raw PCM buffer matching `audioFormat` (base64 batch path inside the
 *     SDK — fast, but the least-tested SDK path; produced empty transcripts
 *     against @qvac/sdk 0.9.1 / @qvac/transcription-whispercpp 0.6.5 with
 *     both `f32le` and `s16le` raw bytes);
 *
 *   - a path to a WAV/MP3/etc. file that the SDK runs through ffmpeg into
 *     `audioFormat` (filePath route — what `qvac-dictate` POC uses, well
 *     exercised in production).
 *
 * `audioFormat` is consumed at `loadModel()` time via `modelConfig.audio_format`
 * and must agree with what whisper sees AFTER any ffmpeg decode. For the WAV
 * filePath route this is whatever ffmpeg outputs (`f32le` for WAV format=3),
 * NOT the WAV's source encoding.
 */
export interface AudioEncoder {
  readonly audioFormat: "f32le" | "s16le"
  encode(frame: AudioFrame): Promise<EncodedAudio>
}

export interface EncodedAudio {
  /** A file path (string) is sent through the SDK's filePath route; a Buffer goes through the base64 route. */
  readonly chunk: string | Buffer
  /** Called after `transcribe()` completes (success or failure). Use to delete temp files. */
  cleanup?(): Promise<void>
}

const DEFAULT_AUDIO_ENCODER: AudioEncoder = {
  audioFormat: "s16le",
  async encode(frame) {
    return { chunk: float32ToS16LeBuffer(frame.samples) }
  },
}

export interface WhisperTranscriberOptions {
  readonly nThreads?: number
  readonly useGpu?: boolean
  readonly flashAttn?: boolean
  /**
   * How `AudioFrame`s become the SDK's `audioChunk`. Defaults to a raw
   * Float32 → s16le converter. Desktop and the mobile Bare worker should
   * provide a WAV-file-writing encoder (see `WavFileAudioEncoder` in the
   * desktop package) so transcription routes through the SDK's
   * filePath/ffmpeg path that the POC validates against the live model.
   */
  readonly audioEncoder?: AudioEncoder
  /**
   * Facade over the `@qvac/sdk` functions this transcriber calls. Tests
   * inject a recording fake so the suite runs under Bare without loading
   * native binaries; production leaves this undefined and the real SDK is
   * resolved lazily on first use.
   */
  readonly sdk?: WhisperSdk
}

const DEFAULT_OPTIONS = {
  nThreads: 4,
  useGpu: true,
  flashAttn: true,
} as const

/**
 * Production `Transcriber` backed by `@qvac/sdk` (whisper.cpp).
 *
 * Exactly ONE model is resident at a time, keyed by `(modelPath, language)`:
 * whisper-cpp's language is a load-time setting (`modelConfig.language` for a
 * fixed language, or the literal string "auto" for runtime auto-detect via
 * `whisper_lang_auto_detect_with_state`), so a language or model switch
 * unloads the outgoing context before loading the new one. Keeping several
 * contexts resident would cost ~0.5–3GB each; a switch already pays the
 * reload latency, so freeing the old one is pure win. Same policy as the
 * mobile worker.
 *
 * Call `unloadAll()` at app shutdown to release the native resources the
 * SDK holds onto.
 *
 * NOT exported from `@opennib/core`'s default barrel — pull it from
 * `@opennib/core/whisper-transcriber` so consumers that only want the
 * orchestration types don't end up loading whisper's native binaries.
 */
export class WhisperTranscriber implements Transcriber {
  private active: { readonly key: string; readonly modelId: string } | null = null
  // Serializes load/unload so two overlapping calls for different keys
  // can't evict each other mid-flight.
  private queue: Promise<unknown> = Promise.resolve()
  private readonly options: Required<Omit<WhisperTranscriberOptions, "audioEncoder" | "sdk">>
  private readonly encoder: AudioEncoder
  private readonly injectedSdk: WhisperSdk | undefined
  private resolvedSdk: WhisperSdk | undefined

  constructor(options: WhisperTranscriberOptions = {}) {
    this.options = {
      nThreads: options.nThreads ?? DEFAULT_OPTIONS.nThreads,
      useGpu: options.useGpu ?? DEFAULT_OPTIONS.useGpu,
      flashAttn: options.flashAttn ?? DEFAULT_OPTIONS.flashAttn,
    }
    this.encoder = options.audioEncoder ?? DEFAULT_AUDIO_ENCODER
    this.injectedSdk = options.sdk
  }

  /**
   * Resolve the SDK facade: the injected fake when provided, otherwise the
   * real `@qvac/sdk` loaded lazily so importing this module doesn't pull in
   * whisper's native binaries until the first transcription. Cached after
   * the first resolution.
   */
  private async sdk(): Promise<WhisperSdk> {
    if (this.injectedSdk !== undefined) return this.injectedSdk
    if (this.resolvedSdk === undefined) {
      this.resolvedSdk = (await import("@qvac/sdk")) as unknown as WhisperSdk
    }
    return this.resolvedSdk
  }

  /**
   * Eagerly load the (modelPath, language) combination into the cache so the
   * next `transcribe()` call doesn't pay the model-load latency. Safe to call
   * multiple times; subsequent calls with the same key are no-ops.
   */
  async preload(modelPath: string, language: LanguageTag): Promise<void> {
    await this.ensureLoaded(modelPath, language)
  }

  async transcribe(frame: AudioFrame, modelPath: string, language: LanguageTag): Promise<string> {
    const modelId = await this.ensureLoaded(modelPath, language)
    const encoded = await this.encoder.encode(frame)
    const sdk = await this.sdk()
    try {
      return await sdk.transcribe({ modelId, audioChunk: encoded.chunk })
    } finally {
      if (encoded.cleanup !== undefined) {
        try {
          await encoded.cleanup()
        } catch (err) {
          // Cleanup failures must not mask transcription results — temp-file
          // leaks are recoverable, lost text isn't. Log and move on.
          log.warn("audio cleanup failed", {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    }
  }

  private async ensureLoaded(modelPath: string, language: LanguageTag): Promise<string> {
    const run = this.queue.then(() => this.swapIn(modelPath, language))
    this.queue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async swapIn(modelPath: string, language: LanguageTag): Promise<string> {
    const key = `${modelPath}::${language}`
    if (this.active !== null && this.active.key === key) return this.active.modelId

    const sdk = await this.sdk()

    if (this.active !== null) {
      const previous = this.active
      this.active = null
      try {
        await sdk.unloadModel({ modelId: previous.modelId })
      } catch (err) {
        // Best-effort: a failed unload of the outgoing model must not block
        // loading the one the caller asked for. Logged so a leak is visible.
        log.warn("whisper unloadModel failed; continuing with reload", {
          modelId: previous.modelId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // The config invariants (why `detect_language` must be omitted, what
    // `audio_format` describes) are documented once in `whisper-config.ts`,
    // which every load site shares.
    const modelConfig = buildWhisperModelConfig({
      language,
      audioFormat: this.encoder.audioFormat,
      nThreads: this.options.nThreads,
      useGpu: this.options.useGpu,
      flashAttn: this.options.flashAttn,
    })
    try {
      const modelId = await sdk.loadModel({
        modelSrc: modelPath,
        modelType: "whispercpp-transcription",
        modelConfig,
      })
      this.active = { key, modelId }
      return modelId
    } catch (err) {
      // The whispercpp addon's errors ("vector", "FAILED_TO_ACTIVATE") are
      // cryptic and don't name the input that caused them. Log the model
      // path and language so a bad file or bad language tag can be
      // identified from the log alone, then re-throw for upstream handlers.
      log.error("whisper loadModel failed", {
        modelPath,
        language,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  /**
   * Unload the resident model, if any. Safe to call multiple times. After
   * this, the next `transcribe()` call reloads the requested model.
   */
  async unloadAll(): Promise<void> {
    if (this.active === null) return
    const { modelId } = this.active
    this.active = null
    const sdk = await this.sdk()
    await sdk.unloadModel({ modelId })
  }
}

function float32ToS16LeBuffer(float32: Float32Array): Buffer {
  const s16 = new Int16Array(float32.length)
  for (let i = 0; i < float32.length; i++) {
    const v = Math.max(-1, Math.min(1, float32[i] ?? 0))
    s16[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff)
  }
  return Buffer.from(s16.buffer, s16.byteOffset, s16.byteLength)
}

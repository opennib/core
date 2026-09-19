import {
  DEFAULT_LANGUAGE,
  MAX_AUDIO_DURATION_SECONDS,
  WHISPER_SAMPLE_RATE_HZ,
} from "./config/constants.js"
import { ModelLoadError, OpennibError, TranscriptionError, ValidationError } from "./errors.js"
import type { ModelManager, Transcriber } from "./interfaces/index.js"
import type { AudioFrame, LanguageTag } from "./types.js"

const MAX_AUDIO_DURATION_MS = MAX_AUDIO_DURATION_SECONDS * 1000

export interface TranscribeDeps {
  readonly transcriber: Transcriber
  readonly modelManager: ModelManager
  readonly modelId: string
  readonly language?: LanguageTag
}

/**
 * Turns an `AudioFrame` into transcript text.
 *
 * This is the central core operation: it validates the frame against
 * Whisper's invariants, resolves the model file via `ModelManager`, and runs
 * the actual whisper call through the injected `Transcriber`. The model is
 * NOT downloaded on the fly — callers are expected to install it via
 * `modelManager.download(...)` first; missing models raise `ModelLoadError`
 * so the UI can offer a remediation path.
 *
 * Errors:
 * - `ValidationError` — frame violates Whisper's input shape (sample rate,
 *   duration, empty buffer).
 * - `ModelLoadError` — the requested model id is not installed.
 * - `TranscriptionError` — the transcriber threw a non-`OpennibError`. The
 *   original error is attached via `error.cause`.
 * - Any `OpennibError` from the transcriber is re-thrown as-is so callers
 *   can branch on the typed subclass.
 */
export async function transcribe(frame: AudioFrame, deps: TranscribeDeps): Promise<string> {
  if (frame.sampleRate !== WHISPER_SAMPLE_RATE_HZ) {
    throw new ValidationError(
      `audio frame sampleRate must be ${WHISPER_SAMPLE_RATE_HZ}, got ${frame.sampleRate}`,
    )
  }
  if (frame.durationMs > MAX_AUDIO_DURATION_MS) {
    throw new ValidationError(
      `audio frame durationMs ${frame.durationMs} exceeds ${MAX_AUDIO_DURATION_MS}`,
    )
  }
  if (frame.samples.length === 0) {
    throw new ValidationError("audio frame samples is empty")
  }

  const { transcriber, modelManager, modelId, language } = deps

  if (!(await modelManager.isInstalled(modelId))) {
    throw new ModelLoadError(`model not installed: ${modelId}`)
  }
  const modelPath = await modelManager.pathFor(modelId)

  try {
    return await transcriber.transcribe(frame, modelPath, language ?? DEFAULT_LANGUAGE)
  } catch (err) {
    if (err instanceof OpennibError) throw err
    // Keep the engine's own message in ours: hosts log `error.message`, and
    // "transcription failed" alone has cost real debugging time.
    const detail = err instanceof Error ? err.message : String(err)
    throw new TranscriptionError(`transcription failed: ${detail}`, err)
  }
}

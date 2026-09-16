import type { LanguageTag } from "./types.js"

/**
 * Options for {@link buildWhisperModelConfig}. `audioFormat` must describe the
 * PCM bytes whisper sees AFTER any ffmpeg decode — for the WAV filePath route
 * that is what ffmpeg outputs (`f32le` for WAV format=3), NOT the WAV's source
 * encoding. The audio route (raw buffer vs file path) owns this contract.
 */
export interface WhisperModelConfigOptions {
  readonly language: LanguageTag
  readonly audioFormat: "f32le" | "s16le"
  readonly nThreads?: number
  readonly useGpu?: boolean
  readonly flashAttn?: boolean
}

/**
 * The `modelConfig` shape `@qvac/sdk`'s whispercpp addon expects at
 * `loadModel()` time. Field names are snake_case because this object crosses
 * into the SDK as-is.
 */
export interface WhisperModelConfig {
  readonly audio_format: "f32le" | "s16le"
  readonly strategy: "greedy"
  readonly n_threads: number
  readonly no_timestamps: true
  readonly suppress_blank: true
  readonly suppress_nst: true
  readonly temperature: number
  readonly language: LanguageTag
  readonly contextParams: {
    readonly use_gpu: boolean
    readonly flash_attn: boolean
  }
}

const DEFAULT_N_THREADS = 4

/**
 * Single source of truth for the whisper `modelConfig` opennib sends to
 * `@qvac/sdk`, shared by every load site (desktop's `WhisperTranscriber`,
 * mobile's transcriber hook) so the invariants below can't drift per platform.
 *
 * Invariants encoded here:
 *
 * - We send `language` ONLY — never `detect_language`. The qvac-whispercpp
 *   C++ addon's `language` handler (`WhisperHandlers.cpp`) already sets
 *   `params.detect_language` internally based on the language string:
 *     - `language === "auto"` → `params.language = nullptr; params.detect_language = true`
 *     - `language === <code>` → `params.language = code;    params.detect_language = false`
 *   Sending `detect_language` explicitly triggers a cross-validator that
 *   reads `params.language` AFTER the language handler ran — at which point
 *   `params.language` is `nullptr` for the "auto" case, so the string compare
 *   `currentLanguage != "auto"` is true, and the wrapper throws
 *   `FAILED_TO_ACTIVATE: detect_language must be false if language is not
 *   auto`. Omitting `detect_language` entirely lets the language handler
 *   manage both internal fields atomically.
 * - `audio_format` describes post-decode bytes (see
 *   {@link WhisperModelConfigOptions}); passing the WAV's source encoding here
 *   makes whisper interpret float samples as int16 PCM and silently return
 *   empty transcripts.
 * - `temperature: 0` + `greedy` for deterministic dictation output;
 *   `no_timestamps` / `suppress_blank` / `suppress_nst` trim non-speech
 *   artifacts from short utterances.
 */
export function buildWhisperModelConfig(options: WhisperModelConfigOptions): WhisperModelConfig {
  return {
    audio_format: options.audioFormat,
    strategy: "greedy",
    n_threads: options.nThreads ?? DEFAULT_N_THREADS,
    no_timestamps: true,
    suppress_blank: true,
    suppress_nst: true,
    temperature: 0.0,
    language: options.language,
    contextParams: {
      use_gpu: options.useGpu ?? true,
      flash_attn: options.flashAttn ?? true,
    },
  }
}

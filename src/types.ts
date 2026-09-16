/**
 * 16 kHz mono PCM audio frame, the input shape Whisper expects.
 *
 * `samples` are 32-bit floats in the range [-1, 1]. Platform recorders are
 * responsible for resampling and channel-downmixing before producing this.
 */
export interface AudioFrame {
  readonly samples: Float32Array
  readonly sampleRate: number
  readonly durationMs: number
}

/**
 * BCP-47 language tag (e.g. `"en"`, `"vi"`, `"ja"`). The literal `"auto"`
 * means let Whisper auto-detect the language at transcription time.
 */
export type LanguageTag = string

/**
 * One transcript record stored in history. Append-only — entries are never
 * mutated in place.
 */
export interface TranscriptEntry {
  readonly id: string
  readonly createdAt: number
  readonly text: string
  readonly language: LanguageTag
  readonly durationMs: number
  readonly app?: string
}

/**
 * One entry in the user's custom dictionary. `term` is the spelling the user
 * wants the cleaner to enforce; `replacement` is what the user said in the
 * recording (e.g. they say "open nib" but want "opennib" written). When
 * `replacement` is omitted, the cleaner is told the term is a proper noun
 * to preserve as-is.
 */
export interface DictionaryEntry {
  readonly id: string
  readonly term: string
  readonly replacement?: string
  readonly createdAt: number
}

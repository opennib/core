/**
 * Magic numbers and string defaults that live across the codebase.
 *
 * Anything that would otherwise be inlined as a literal goes here so it
 * has a name, a comment, and a single place to change.
 */

/** Whisper expects 16 kHz mono PCM. */
export const WHISPER_SAMPLE_RATE_HZ = 16_000

/** Hard cap for a single dictation utterance. */
export const MAX_AUDIO_DURATION_SECONDS = 60

/**
 * Speech gate (see `speech-gate.ts`). Frames shorter than this are treated
 * as an accidental tap of the hotkey, not an utterance.
 */
export const MIN_UTTERANCE_MS = 250

/**
 * Speech gate levels (full scale = 1.0). A frame must clear BOTH to reach
 * Whisper. Tuned on real recordings: phone and simulator mics deliver
 * speech at -50 to -37 dBFS RMS with peaks of 0.03–0.09, far quieter than a
 * desktop mic with automatic gain, while digital silence is exactly 0 and a
 * dropped mic feed stays below 0.002 peak. So: an RMS floor at -60 dBFS
 * that only rejects near-silence, plus a peak floor at -34 dBFS that even
 * quiet speech exceeds but a faint noise floor does not.
 */
export const MIN_SPEECH_RMS = 0.001
export const MIN_SPEECH_PEAK = 0.02

/** Hard cap on a single transcript text length, after cleanup. */
export const MAX_TRANSCRIPT_LENGTH = 10_000

/** Default language hint — `"auto"` means let Whisper detect. */
export const DEFAULT_LANGUAGE: "auto" = "auto"

/**
 * How long transcript history is kept. Older entries are filtered out of
 * `History.list()` results and never resurface in the UI. The data remains
 * in the underlying Hypercore log (append-only — we can't delete individual
 * indices) but is treated as if it doesn't exist.
 */
export const HISTORY_RETENTION_DAYS = 30
export const HISTORY_RETENTION_MS = HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000

/**
 * Starter corrections seeded into a brand-new (empty) dictionary log, so the
 * feature demonstrates itself and the words this app makes users say most —
 * starting with the brand — transcribe correctly. `term` is the enforced
 * spelling, `replacement` is what speech-to-text typically hears. Stable ids
 * keep seeding idempotent: a re-seed of the same ids collapses to one entry
 * per id in the materialized view.
 */
export const DEFAULT_DICTIONARY_TERMS: readonly {
  readonly id: string
  readonly term: string
  readonly replacement: string
}[] = [
  { id: "default-opennib", term: "opennib", replacement: "open nib" },
  { id: "default-whisper", term: "Whisper", replacement: "whisper" },
  { id: "default-github", term: "GitHub", replacement: "github" },
  { id: "default-api", term: "API", replacement: "api" },
]

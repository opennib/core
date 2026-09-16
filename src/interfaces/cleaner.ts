import type { DictionaryEntry, LanguageTag } from "../types.js"

/**
 * Post-processes raw transcript text — fixing punctuation, capitalization,
 * and obvious dictation artifacts before it's pasted into the focused app.
 *
 * Implementations:
 *   - `LlmCleaner` (default) — runs a small local LLM via `@qvac/sdk`.
 *   - test fakes — return a fixed or transformed string for unit tests.
 *
 * `cleanup()` MUST be idempotent: calling it twice with the same input
 * should produce the same output (so retries are safe).
 *
 * The optional `terms` argument is the user's custom dictionary
 * materialized as a plain array; LLM-backed cleaners should weave the
 * spellings into their prompt so a small Whisper model's misspellings of
 * proper nouns and jargon get corrected.
 */
export interface Cleaner {
  cleanup(
    text: string,
    language: LanguageTag,
    terms?: readonly DictionaryEntry[],
  ): Promise<string>
}

import { DEFAULT_LANGUAGE, MAX_TRANSCRIPT_LENGTH } from "./config/constants.js"
import { CleanupError, OpennibError, ValidationError } from "./errors.js"
import type { Cleaner } from "./interfaces/index.js"
import type { DictionaryEntry, LanguageTag } from "./types.js"

export interface CleanupDeps {
  readonly cleaner: Cleaner
  readonly language?: LanguageTag
  /**
   * The user's custom dictionary, already materialized. Resolving the entries
   * is the caller's job (Dictionary.list()) so this orchestrator can stay
   * dependency-free of storage.
   */
  readonly terms?: readonly DictionaryEntry[]
}

/**
 * Runs raw transcript text through the configured `Cleaner` to fix
 * punctuation, capitalization, and obvious dictation artifacts.
 *
 * The orchestrator is intentionally thin: it normalizes whitespace, rejects
 * empty / oversized input, and wraps non-`OpennibError` failures in
 * `CleanupError` so callers can branch on the typed subclass.
 *
 * If the cleaner returns an empty string (the LLM ate the input or hit a
 * guardrail), we fall back to the original trimmed text rather than handing
 * the user empty output. Cleanup is best-effort cosmetics, not a hard
 * dependency on the dictation flow.
 */
export async function cleanupText(text: string, deps: CleanupDeps): Promise<string> {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    throw new ValidationError("cleanup input text is empty")
  }
  if (trimmed.length > MAX_TRANSCRIPT_LENGTH) {
    throw new ValidationError(
      `cleanup input length ${trimmed.length} exceeds ${MAX_TRANSCRIPT_LENGTH}`,
    )
  }

  const { cleaner, language, terms } = deps
  let cleaned: string
  try {
    cleaned =
      terms !== undefined
        ? await cleaner.cleanup(trimmed, language ?? DEFAULT_LANGUAGE, terms)
        : await cleaner.cleanup(trimmed, language ?? DEFAULT_LANGUAGE)
  } catch (err) {
    if (err instanceof OpennibError) throw err
    throw new CleanupError("cleanup failed", err)
  }

  const cleanedTrimmed = cleaned.trim()
  return cleanedTrimmed.length === 0 ? trimmed : cleanedTrimmed
}

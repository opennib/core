import { DEFAULT_LANGUAGE } from "../config/constants.js"
import type { SettingsSnapshot } from "../interfaces/settings.js"
import { DEFAULT_WHISPER_MODEL_ID } from "../models/whisper.js"

/**
 * Canonical default snapshot — used as the seed value before `load()` runs
 * and as the per-field fallback when a stored value is missing or the wrong
 * shape. Both desktop (`JsonFileSettings`) and mobile (`AsyncStorageSettings`)
 * adopt this for the dictation slice, so a settings-shape change only lands in
 * one place. Host fields (hotkey, tray toggles, onboarding) default in the
 * platform packages that own them.
 */
export const DEFAULT_SETTINGS_SNAPSHOT: SettingsSnapshot = {
  whisperModelId: DEFAULT_WHISPER_MODEL_ID,
  language: DEFAULT_LANGUAGE,
  cleanupEnabled: false,
  llmModelId: null,
}

/**
 * Parse a settings snapshot from arbitrary input (typically the result of
 * `JSON.parse` on stored bytes). Missing fields, wrong types, and empty
 * strings all fall back to the canonical default for that field.
 *
 * Returns the full default snapshot when `raw` is not a non-null object —
 * including the `null` and `undefined` cases — so callers can pipe e.g.
 * `JSON.parse("null")` through without a guard.
 */
export function parseSettingsSnapshot(raw: unknown): SettingsSnapshot {
  if (typeof raw !== "object" || raw === null) {
    return DEFAULT_SETTINGS_SNAPSHOT
  }
  const partial = raw as Partial<SettingsSnapshot>
  return {
    whisperModelId:
      typeof partial.whisperModelId === "string" && partial.whisperModelId.length > 0
        ? partial.whisperModelId
        : DEFAULT_SETTINGS_SNAPSHOT.whisperModelId,
    language:
      typeof partial.language === "string" && partial.language.length > 0
        ? partial.language
        : DEFAULT_SETTINGS_SNAPSHOT.language,
    cleanupEnabled:
      typeof partial.cleanupEnabled === "boolean"
        ? partial.cleanupEnabled
        : DEFAULT_SETTINGS_SNAPSHOT.cleanupEnabled,
    llmModelId:
      typeof partial.llmModelId === "string" && partial.llmModelId.length > 0
        ? partial.llmModelId
        : null,
  }
}

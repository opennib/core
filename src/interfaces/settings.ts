import type { LanguageTag } from "../types.js"

/**
 * User-tunable dictation settings. Device-local — per CLAUDE.md these are
 * tied to model files installed on this specific device, so they never
 * sync across paired peers (unlike History/Dictionary which do).
 *
 * This is the platform-agnostic slice only: which Whisper model to use, the
 * transcription language, and whether/which LLM runs the cleanup pass. Host
 * concepts (push-to-talk hotkey, tray toggles, onboarding flags, launch-at-login)
 * live in the platform packages, since core runs unchanged in Bare + Hermes
 * where those concepts don't exist. Each platform's settings service composes
 * this interface with its own host snapshot behind one persisted blob.
 *
 * Reads are sync because callers (the dictation pipeline) need them inside
 * tight cycles where awaiting a JSON read every press would add latency.
 * Writes persist asynchronously and notify listeners so renderers can keep
 * UI in sync without re-fetching.
 *
 * Desktop: JSON file under `storage.baseDirectory()`.
 * Mobile:  AsyncStorage.
 */
export interface Settings {
  whisperModelId(): string
  language(): LanguageTag
  /**
   * Whether the LLM cleanup pass runs after transcription. Off by default;
   * cleanup needs an installed LLM model so we can't enable it blindly.
   */
  cleanupEnabled(): boolean
  /**
   * Which LLM model the cleanup pass uses. `null` when the user has not
   * picked one yet — the desktop main process treats null as "cleanup off"
   * even if `cleanupEnabled` is true, so a misconfigured state can't crash
   * the pipeline.
   */
  llmModelId(): string | null
  setWhisperModelId(id: string): Promise<void>
  setLanguage(language: LanguageTag): Promise<void>
  setCleanupEnabled(enabled: boolean): Promise<void>
  setLlmModelId(id: string | null): Promise<void>
  /** Subscribe to any change. Returns an unsubscribe function. */
  onChange(handler: (snapshot: SettingsSnapshot) => void): () => void
  /** Materialized snapshot, useful for IPC payloads. */
  snapshot(): SettingsSnapshot
}

export interface SettingsSnapshot {
  readonly whisperModelId: string
  readonly language: LanguageTag
  readonly cleanupEnabled: boolean
  readonly llmModelId: string | null
}

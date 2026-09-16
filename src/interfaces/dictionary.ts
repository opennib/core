import type { DictionaryEntry } from "../types.js"

/**
 * User custom dictionary — proper nouns, technical jargon, or pet names that
 * a small Whisper model can't be expected to spell on its own. We feed the
 * active list into the LLM cleanup prompt so the LLM corrects misspellings.
 *
 * Storage shape: append-only log of `add` and `remove` events keyed by
 * `entry.id`. The latest event for an id wins; a removal is recorded as a
 * tombstone so the log can sync via Hypercore from v0.5 without conflict
 * resolution drama. Callers should treat `list()` as the materialized view.
 *
 * Desktop: Hypercore-direct.
 * Mobile (today): AsyncStorage-backed, non-syncable.
 * Mobile (v1+):   Hypercore inside opennib's Bare worker.
 */
export interface Dictionary {
  list(): Promise<readonly DictionaryEntry[]>
  add(entry: DictionaryEntry): Promise<void>
  /** Append a tombstone for `id`. No-op if `id` is unknown or already removed. */
  remove(id: string): Promise<void>
  /** Wipe the whole log. Used by settings → reset. */
  clear(): Promise<void>
}

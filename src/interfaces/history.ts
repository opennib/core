import type { TranscriptEntry } from "../types.js"

/**
 * Append-only transcript history.
 *
 * Desktop: Hypercore-direct (Electron main runs Node, hosts Hypercore).
 * Mobile (today): AsyncStorage-backed, non-syncable.
 * Mobile (v1+):   Hypercore inside an opennib-owned Bare worker (separate
 *                 from `@qvac/sdk`'s internal Bare runtime for AI).
 */

export interface HistoryListOptions {
  limit?: number
  before?: string
}

export interface History {
  append(entry: TranscriptEntry): Promise<void>
  list(options?: HistoryListOptions): Promise<readonly TranscriptEntry[]>
  clear(): Promise<void>
}

import Hypercore from "hypercore"

import { HISTORY_RETENTION_MS } from "../config/constants.js"
import { StorageError } from "../errors.js"
import type { History, HistoryListOptions } from "../interfaces/index.js"
import type { TranscriptEntry } from "../types.js"

import { diagnoseOpenError } from "./internal/diagnose-open-error.js"

export interface HypercoreHistoryOptions {
  /** Directory where Hypercore writes its append-only log files. */
  readonly storagePath: string
  /**
   * Time source for the retention cutoff. Injectable so tests can pin the
   * clock (mirrors `DictationPipelineDeps.clock`); defaults to `Date.now`.
   */
  readonly clock?: () => number
}

/**
 * Append-only transcript history backed by Hypercore. We use Hypercore from
 * v0.1 even without sync because (per CLAUDE.md) the data shape fits and the
 * v0.5 sync slice ships without a data migration.
 */
export class HypercoreHistory implements History {
  private core: Hypercore | null = null
  private opening: Promise<Hypercore> | null = null
  private readonly clock: () => number

  constructor(private readonly options: HypercoreHistoryOptions) {
    this.clock = options.clock ?? Date.now
  }

  async append(entry: TranscriptEntry): Promise<void> {
    const core = await this.open()
    try {
      await core.append(entry)
    } catch (cause) {
      throw new StorageError("history append failed", cause)
    }
  }

  async list(options?: HistoryListOptions): Promise<readonly TranscriptEntry[]> {
    const core = await this.open()
    const limit = options?.limit ?? Number.POSITIVE_INFINITY
    const before = options?.before

    let cursorIndex = core.length
    if (before !== undefined) {
      cursorIndex = await this.findIndexById(core, before)
      if (cursorIndex < 0) return []
      // `before` is exclusive — entries strictly older than the cursor.
    }

    // Hard retention cap: hide entries older than 30 days (`HISTORY_RETENTION_MS`).
    // The Hypercore log is append-only so the bytes stay on disk, but we never
    // expose them through `list()`. Expired entries are SKIPPED, not used as a
    // stop signal: `createdAt` comes from the host's clock, so a clock that
    // jumps backwards can append an "old" entry after newer ones — breaking
    // on it would hide the entire recent history behind it.
    const retentionCutoff = this.clock() - HISTORY_RETENTION_MS

    const out: TranscriptEntry[] = []
    for (let i = cursorIndex - 1; i >= 0 && out.length < limit; i--) {
      try {
        const entry = (await core.get(i)) as TranscriptEntry | null
        if (entry === null) continue
        if (entry.createdAt < retentionCutoff) continue
        out.push(entry)
      } catch (cause) {
        throw new StorageError(`history read failed at index ${i}`, cause)
      }
    }
    return out
  }

  async clear(): Promise<void> {
    const core = await this.open()
    try {
      await core.truncate(0)
    } catch (cause) {
      throw new StorageError("history clear failed", cause)
    }
  }

  async close(): Promise<void> {
    if (this.core !== null) {
      try {
        await this.core.close()
      } finally {
        this.core = null
        this.opening = null
      }
    }
  }

  private async open(): Promise<Hypercore> {
    if (this.core !== null) return this.core
    if (this.opening !== null) return this.opening

    this.opening = (async () => {
      let core: Hypercore
      try {
        core = new Hypercore(this.options.storagePath, { valueEncoding: "json" })
        await core.ready()
      } catch (cause) {
        this.opening = null
        throw new StorageError(diagnoseOpenError("history", this.options.storagePath, cause), cause)
      }
      this.core = core
      return core
    })()
    return this.opening
  }

  private async findIndexById(core: Hypercore, id: string): Promise<number> {
    for (let i = core.length - 1; i >= 0; i--) {
      const entry = (await core.get(i)) as TranscriptEntry | null
      if (entry !== null && entry.id === id) return i
    }
    return -1
  }
}

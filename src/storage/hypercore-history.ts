import Hypercore from "hypercore";

import { HISTORY_RETENTION_MS } from "../config/constants.js";
import { StorageError } from "../errors.js";
import type { History, HistoryListOptions } from "../interfaces/index.js";
import type { StorageFs } from "../interfaces/storage-fs.js";
import { log } from "../log.js";
import type { TranscriptEntry } from "../types.js";

import {
  compactLog,
  recoverInterruptedCompaction,
} from "./internal/compact.js";
import { diagnoseOpenError } from "./internal/diagnose-open-error.js";

export interface HypercoreHistoryOptions {
  /** Directory where Hypercore writes its append-only log files. */
  readonly storagePath: string;
  /**
   * Time source for the retention cutoff. Injectable so tests can pin the
   * clock (mirrors `DictationPipelineDeps.clock`); defaults to `Date.now`.
   */
  readonly clock?: () => number;
  /**
   * Filesystem access for compaction. When provided, opening the store
   * physically removes entries past the retention window by rewriting the
   * log (see `internal/compact.ts`). Without it, expired entries are only
   * hidden by `list()` and the bytes stay on disk forever.
   */
  readonly fs?: StorageFs;
}

/**
 * Append-only transcript history backed by Hypercore. The log itself can
 * only grow; retention is enforced two ways — `list()` hides expired entries
 * at read time, and when a `StorageFs` is supplied, `open()` compacts the
 * log so expired entries are actually gone from disk.
 */
export class HypercoreHistory implements History {
  private core: Hypercore | null = null;
  private opening: Promise<Hypercore> | null = null;
  private readonly clock: () => number;

  constructor(private readonly options: HypercoreHistoryOptions) {
    this.clock = options.clock ?? Date.now;
  }

  async append(entry: TranscriptEntry): Promise<void> {
    const core = await this.open();
    try {
      await core.append(entry);
    } catch (cause) {
      throw new StorageError("history append failed", cause);
    }
  }

  async list(
    options?: HistoryListOptions,
  ): Promise<readonly TranscriptEntry[]> {
    const core = await this.open();
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;
    const before = options?.before;

    let cursorIndex = core.length;
    if (before !== undefined) {
      cursorIndex = await this.findIndexById(core, before);
      if (cursorIndex < 0) return [];
      // `before` is exclusive — entries strictly older than the cursor.
    }

    // Hard retention cap: hide entries older than 30 days (`HISTORY_RETENTION_MS`).
    // The Hypercore log is append-only so the bytes stay on disk, but we never
    // expose them through `list()`. Expired entries are SKIPPED, not used as a
    // stop signal: `createdAt` comes from the host's clock, so a clock that
    // jumps backwards can append an "old" entry after newer ones — breaking
    // on it would hide the entire recent history behind it.
    const retentionCutoff = this.clock() - HISTORY_RETENTION_MS;

    const out: TranscriptEntry[] = [];
    for (let i = cursorIndex - 1; i >= 0 && out.length < limit; i--) {
      try {
        const entry = (await core.get(i)) as TranscriptEntry | null;
        if (entry === null) continue;
        if (entry.createdAt < retentionCutoff) continue;
        out.push(entry);
      } catch (cause) {
        throw new StorageError(`history read failed at index ${i}`, cause);
      }
    }
    return out;
  }

  async clear(): Promise<void> {
    const core = await this.open();
    try {
      await core.truncate(0);
    } catch (cause) {
      throw new StorageError("history clear failed", cause);
    }
  }

  async close(): Promise<void> {
    if (this.core !== null) {
      try {
        await this.core.close();
      } finally {
        this.core = null;
        this.opening = null;
      }
    }
  }

  private async open(): Promise<Hypercore> {
    if (this.core !== null) return this.core;
    if (this.opening !== null) return this.opening;

    this.opening = (async () => {
      const fs = this.options.fs;
      if (fs !== undefined)
        await recoverInterruptedCompaction(fs, this.options.storagePath);
      let core = await this.openCore();
      if (fs !== undefined) core = await this.compactIfDue(fs, core);
      this.core = core;
      return core;
    })();
    return this.opening;
  }

  private async openCore(): Promise<Hypercore> {
    try {
      const core = new Hypercore(this.options.storagePath, {
        valueEncoding: "json",
      });
      await core.ready();
      return core;
    } catch (cause) {
      this.opening = null;
      throw new StorageError(
        diagnoseOpenError("history", this.options.storagePath, cause),
        cause,
      );
    }
  }

  /**
   * Rewrite the log without expired entries when at least one exists.
   * Compaction is a full-scan filter, never an ordering assumption:
   * `createdAt` comes from the host clock and may be out of order.
   */
  private async compactIfDue(
    fs: StorageFs,
    core: Hypercore,
  ): Promise<Hypercore> {
    const cutoff = this.clock() - HISTORY_RETENTION_MS;
    const isLive = (block: unknown): boolean =>
      (block as TranscriptEntry).createdAt >= cutoff;
    let expired = 0;
    for (let i = 0; i < core.length; i++) {
      const block = await core.get(i);
      if (block !== null && !isLive(block)) expired++;
    }
    if (expired === 0) return core;

    try {
      const kept = await compactLog(fs, this.options.storagePath, core, isLive);
      log.info("history compacted", { removed: expired, kept });
    } catch (cause) {
      this.opening = null;
      throw new StorageError("history compaction failed", cause);
    }
    return this.openCore();
  }

  private async findIndexById(core: Hypercore, id: string): Promise<number> {
    for (let i = core.length - 1; i >= 0; i--) {
      const entry = (await core.get(i)) as TranscriptEntry | null;
      if (entry !== null && entry.id === id) return i;
    }
    return -1;
  }
}

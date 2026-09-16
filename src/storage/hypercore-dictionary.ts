import Hypercore from "hypercore"

import { DEFAULT_DICTIONARY_TERMS } from "../config/constants.js"
import { StorageError } from "../errors.js"
import type { Dictionary } from "../interfaces/index.js"
import type { DictionaryEntry } from "../types.js"

import { diagnoseOpenError } from "./internal/diagnose-open-error.js"

export interface HypercoreDictionaryOptions {
  /** Directory where Hypercore writes its append-only log files. */
  readonly storagePath: string
  /**
   * Seed `DEFAULT_DICTIONARY_TERMS` into a log that opens empty (fresh
   * install, or reopened after settings → reset). Defaults to true so every
   * platform gets the starter dictionary without wiring; tests exercising
   * raw log behavior opt out.
   */
  readonly seedDefaults?: boolean
  /**
   * Time source for tombstone/seed timestamps. Injectable so tests can pin
   * the clock (mirrors `DictationPipelineDeps.clock`); defaults to `Date.now`.
   */
  readonly clock?: () => number
}

/**
 * Custom-dictionary entry log block. We store every event — `add` and
 * `remove` — so the underlying Hypercore can sync via Hyperswarm in v0.5
 * without conflict resolution. The materialized view in `list()` collapses
 * the log: latest event for an `id` wins, and `remove` events suppress the
 * entry entirely.
 */
type DictionaryEvent =
  | { readonly kind: "add"; readonly entry: DictionaryEntry }
  | { readonly kind: "remove"; readonly id: string; readonly removedAt: number }

/**
 * Custom dictionary backed by Hypercore. Mirrors `HypercoreHistory` in shape:
 * lazy single-flight open, valueEncoding json, every Hypercore call wrapped
 * in `StorageError`.
 */
export class HypercoreDictionary implements Dictionary {
  private core: Hypercore | null = null
  private opening: Promise<Hypercore> | null = null
  private readonly clock: () => number

  constructor(private readonly options: HypercoreDictionaryOptions) {
    this.clock = options.clock ?? Date.now
  }

  async list(): Promise<readonly DictionaryEntry[]> {
    const core = await this.open()
    const active = new Map<string, DictionaryEntry>()
    for (let i = 0; i < core.length; i++) {
      let event: DictionaryEvent | null
      try {
        event = (await core.get(i)) as DictionaryEvent | null
      } catch (cause) {
        throw new StorageError(`dictionary read failed at index ${i}`, cause)
      }
      if (event === null) continue
      if (event.kind === "add") {
        active.set(event.entry.id, event.entry)
      } else {
        active.delete(event.id)
      }
    }
    return Array.from(active.values())
  }

  async add(entry: DictionaryEntry): Promise<void> {
    const core = await this.open()
    try {
      await core.append({ kind: "add", entry })
    } catch (cause) {
      throw new StorageError("dictionary add failed", cause)
    }
  }

  async remove(id: string): Promise<void> {
    const core = await this.open()
    try {
      await core.append({ kind: "remove", id, removedAt: this.clock() })
    } catch (cause) {
      throw new StorageError("dictionary remove failed", cause)
    }
  }

  async clear(): Promise<void> {
    const core = await this.open()
    try {
      await core.truncate(0)
    } catch (cause) {
      throw new StorageError("dictionary clear failed", cause)
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
        throw new StorageError(
          diagnoseOpenError("dictionary", this.options.storagePath, cause),
          cause,
        )
      }
      if ((this.options.seedDefaults ?? true) && core.length === 0) {
        const createdAt = this.clock()
        try {
          for (const seed of DEFAULT_DICTIONARY_TERMS) {
            await core.append({ kind: "add", entry: { ...seed, createdAt } })
          }
        } catch (cause) {
          this.opening = null
          throw new StorageError("dictionary seed failed", cause)
        }
      }
      this.core = core
      return core
    })()
    return this.opening
  }
}

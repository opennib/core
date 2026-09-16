import { cleanupText } from "./cleanup.js"
import type {
  Cleaner,
  Dictionary,
  History,
  ModelManager,
  Notifier,
  Paster,
  Recorder,
  Settings,
  Transcriber,
} from "./interfaces/index.js"
import { log } from "./log.js"
import { transcribe } from "./transcribe.js"
import type { DictionaryEntry, TranscriptEntry } from "./types.js"

export interface DictationPipelineDeps {
  readonly recorder: Recorder
  readonly transcriber: Transcriber
  readonly modelManager: ModelManager
  /**
   * Resolves the active cleaner per recording cycle. A function (not a fixed
   * instance) so the host can swap the underlying LLM cleaner when the user
   * toggles cleanup or picks a different model in settings, without
   * recreating the whole pipeline.
   */
  readonly cleaner: () => Cleaner | null
  readonly dictionary: Dictionary | null
  readonly paster: Paster
  readonly history: History
  readonly notifier: Notifier
  readonly settings: Settings
  /**
   * Generates transcript-entry IDs. Required (rather than defaulted) because
   * core runs in Node / Bare / Hermes and each runtime has a different
   * canonical UUID source; the platform host injects whichever is appropriate.
   */
  readonly idFactory: () => string
  readonly onStateChange?: (state: PipelineState) => void
  readonly clock?: () => number
}

export type PipelineState = "idle" | "recording" | "processing"

/**
 * Push-to-talk dictation orchestrator.
 *
 * Wires the platform-side capabilities (recorder, paster, history, notifier)
 * to core's pure orchestration helpers (`transcribe`, `cleanupText`). The
 * flow per cycle:
 *
 *   beginCycle()  → recorder.start
 *   endCycle()    → recorder.stop → transcribe → cleanup? → paste → history.append
 *
 * State machine: `idle → recording → processing → idle`. Extra `beginCycle`
 * calls while recording or processing are dropped (a user holding two
 * presses or a release that preceded a queued press should not produce
 * overlapping cycles). An `endCycle` without a prior `beginCycle` is also
 * ignored — same reasoning.
 *
 * The trigger source is the host's responsibility: desktop wires a global
 * hotkey, iOS wires Darwin notifications from the keyboard extension,
 * Android wires events from the IME service.
 */
export class DictationPipeline {
  private state: PipelineState = "idle"
  private readonly clock: () => number
  private readonly idFactory: () => string

  constructor(private readonly deps: DictationPipelineDeps) {
    this.clock = deps.clock ?? Date.now
    this.idFactory = deps.idFactory
  }

  currentState(): PipelineState {
    return this.state
  }

  private setState(next: PipelineState): void {
    if (this.state === next) return
    this.state = next
    if (this.deps.onStateChange !== undefined) {
      try {
        this.deps.onStateChange(next)
      } catch (err) {
        // Listener errors must not break the dictation cycle.
        log.error("onStateChange listener threw", { error: errorMessage(err) })
      }
    }
  }

  async beginCycle(): Promise<void> {
    if (this.state !== "idle") {
      log.debug("dictation beginCycle ignored", { state: this.state })
      return
    }
    this.setState("recording")
    try {
      await this.deps.recorder.start()
    } catch (err) {
      this.setState("idle")
      log.error("recorder start failed", { error: errorMessage(err) })
      this.notifyError("Could not start recording", err)
    }
  }

  async endCycle(): Promise<void> {
    if (this.state !== "recording") {
      log.debug("dictation endCycle ignored", { state: this.state })
      return
    }
    this.setState("processing")
    try {
      await this.runCycle()
    } finally {
      this.setState("idle")
    }
  }

  private async runCycle(): Promise<void> {
    let frame: Awaited<ReturnType<Recorder["stop"]>>
    try {
      frame = await this.deps.recorder.stop()
    } catch (err) {
      log.error("recorder stop failed", { error: errorMessage(err) })
      this.notifyError("Recording failed", err)
      return
    }

    const language = this.deps.settings.language()
    let raw: string
    try {
      raw = await transcribe(frame, {
        transcriber: this.deps.transcriber,
        modelManager: this.deps.modelManager,
        modelId: this.deps.settings.whisperModelId(),
        language,
      })
    } catch (err) {
      log.error("transcription failed", { error: errorMessage(err) })
      this.notifyError("Transcription failed", err)
      return
    }

    const trimmed = raw.trim()
    if (trimmed.length === 0) {
      log.info("transcription returned empty text; skipping paste")
      return
    }

    let text = trimmed
    const activeCleaner = this.deps.cleaner()
    if (activeCleaner !== null) {
      let terms: readonly DictionaryEntry[] | undefined
      if (this.deps.dictionary !== null) {
        try {
          terms = await this.deps.dictionary.list()
        } catch (err) {
          // Dictionary is decorative; a read failure should not stall cleanup.
          log.warn("dictionary list failed, proceeding without terms", {
            error: errorMessage(err),
          })
        }
      }
      try {
        text = await cleanupText(trimmed, {
          cleaner: activeCleaner,
          language,
          ...(terms !== undefined ? { terms } : {}),
        })
      } catch (err) {
        // Cleanup is best-effort cosmetics; fall back to the raw transcript
        // and surface a soft warning rather than failing the whole cycle.
        log.warn("cleanup failed, falling back to raw transcript", {
          error: errorMessage(err),
        })
      }
    }

    try {
      await this.deps.paster.paste(text)
    } catch (err) {
      log.error("paste failed", { error: errorMessage(err) })
      this.notifyError("Could not paste transcript", err)
      return
    }

    const entry: TranscriptEntry = {
      id: this.idFactory(),
      createdAt: this.clock(),
      text,
      language,
      durationMs: frame.durationMs,
    }
    try {
      await this.deps.history.append(entry)
    } catch (err) {
      // History append shouldn't surface as a noisy notification — the user
      // already has the pasted text.
      log.error("history append failed", { error: errorMessage(err) })
    }
  }

  private notifyError(title: string, err: unknown): void {
    void this.deps.notifier.notify(title, errorMessage(err)).catch((notifyErr) => {
      log.error("notifier failed", { error: errorMessage(notifyErr) })
    })
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

import type { Cleaner } from "./interfaces/index.js"
import type { DictionaryEntry, LanguageTag } from "./types.js"

/**
 * The slice of `@qvac/sdk` the cleaner calls. Tests inject a recording fake
 * so the suite runs under Bare without loading native binaries; production
 * resolves the real SDK on first use via a lazy dynamic import.
 */
export interface LlmSdk {
  loadModel(options: {
    modelSrc: { src: string; engine: "llamacpp-completion" }
    modelConfig: { temp: number; gpu_layers: number }
  }): Promise<string>
  completion(options: {
    modelId: string
    stream: false
    history: { role: "system" | "user"; content: string }[]
  }): { text: Promise<string> }
  unloadModel(options: { modelId: string }): Promise<void>
}

export interface LlmCleanerOptions {
  /** Path to the LLM weights file (gguf). Required — the cleaner is bound to one model. */
  readonly modelPath: string
  readonly useGpu?: boolean
  /** Override the default cleanup system prompt. */
  readonly systemPrompt?: string
  /**
   * Facade over the `@qvac/sdk` functions this cleaner calls. Tests inject a
   * recording fake so the suite runs under Bare without loading native
   * binaries; production leaves this undefined and the real SDK is resolved
   * lazily on first use.
   */
  readonly sdk?: LlmSdk
}

const DEFAULT_OPTIONS = {
  useGpu: true,
} as const

/**
 * Default cleanup prompt. Phrased to discourage the LLM from rewriting
 * meaning, adding new content, or translating — its only job is to fix
 * punctuation, capitalization, and obvious dictation artifacts.
 *
 * The instruction is in English but the rule "preserve the language of
 * the input" lets a small multilingual instruct model handle other
 * languages without per-language prompts.
 */
const DEFAULT_SYSTEM_PROMPT = [
  "You are a dictation cleanup assistant.",
  "Your only job is to fix punctuation, capitalization, and obvious",
  "transcription errors in the text the user provides.",
  "Rules:",
  "- Preserve the original language of the input.",
  "- Do NOT add words, expand abbreviations, or change meaning.",
  "- Do NOT translate.",
  "- Do NOT add explanations, prefaces, or quotation marks.",
  "- Return ONLY the cleaned text, nothing else.",
].join("\n")

/**
 * Production `Cleaner` backed by `@qvac/sdk` (llama.cpp).
 *
 * The LLM model is loaded lazily on first call and reused across calls.
 * Call `unload()` at app shutdown (or when the user changes their LLM
 * model in settings) to release native resources.
 *
 * NOT exported from `@opennib/core`'s default barrel — pull it from
 * `@opennib/core/llm-cleaner` so consumers that only want orchestration
 * types don't end up loading llama.cpp's native binaries.
 */
export class LlmCleaner implements Cleaner {
  private readonly options: Required<
    Omit<LlmCleanerOptions, "modelPath" | "systemPrompt" | "sdk">
  > & {
    modelPath: string
    systemPrompt: string
  }
  private modelId: string | undefined
  private readonly injectedSdk: LlmSdk | undefined
  private resolvedSdk: LlmSdk | undefined

  constructor(options: LlmCleanerOptions) {
    this.options = {
      modelPath: options.modelPath,
      useGpu: options.useGpu ?? DEFAULT_OPTIONS.useGpu,
      systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    }
    this.injectedSdk = options.sdk
  }

  /**
   * Resolve the SDK facade: the injected fake when provided, otherwise the
   * real `@qvac/sdk` loaded lazily so importing this module doesn't pull in
   * llama.cpp's native binaries until the first cleanup. Cached after the
   * first resolution.
   */
  private async sdk(): Promise<LlmSdk> {
    if (this.injectedSdk !== undefined) return this.injectedSdk
    if (this.resolvedSdk === undefined) {
      this.resolvedSdk = (await import("@qvac/sdk")) as unknown as LlmSdk
    }
    return this.resolvedSdk
  }

  async cleanup(
    text: string,
    _language: LanguageTag,
    terms?: readonly DictionaryEntry[],
  ): Promise<string> {
    const sdk = await this.sdk()
    if (this.modelId === undefined) {
      // SDK 0.16 dropped `modelType` for LLMs: local files are described by a
      // ModelDescriptor whose `engine` selects the llama.cpp completion addon.
      this.modelId = await sdk.loadModel({
        modelSrc: { src: this.options.modelPath, engine: "llamacpp-completion" },
        // SDK 0.16's llama.cpp load schema: `temp` (0 = deterministic
        // cleanup) and `gpu_layers` (99 = offload every layer). The SDK
        // rejects unknown keys, so no whisper-style n_threads/contextParams.
        modelConfig: {
          temp: 0,
          gpu_layers: this.options.useGpu ? 99 : 0,
        },
      })
    }

    const systemContent = buildSystemPrompt(this.options.systemPrompt, terms)

    const result = sdk.completion({
      modelId: this.modelId,
      stream: false,
      history: [
        { role: "system", content: systemContent },
        { role: "user", content: text },
      ],
    })
    // `CompletionRun.text` is a Promise that resolves when generation ends.
    return await result.text
  }

  /**
   * Unload the cached LLM. Safe to call multiple times. After this, the
   * next `cleanup()` call will reload the model.
   */
  async unload(): Promise<void> {
    if (this.modelId === undefined) return
    const id = this.modelId
    this.modelId = undefined
    const sdk = await this.sdk()
    await sdk.unloadModel({ modelId: id })
  }
}

/**
 * Append a dictionary block to the base system prompt when the user has
 * any custom terms. Two shapes:
 *
 * - `term` only          → "Spell `opennib` exactly as written."
 * - `term + replacement` → "Replace `open nib` with `opennib`."
 *
 * The phrasing is deliberately small and unambiguous so a 1–3B parameter
 * instruct model can follow it without confusing dictionary entries with
 * the rest of the cleanup rules.
 */
function buildSystemPrompt(base: string, terms?: readonly DictionaryEntry[]): string {
  if (terms === undefined || terms.length === 0) return base

  const lines = terms.map((t) =>
    t.replacement !== undefined && t.replacement.length > 0
      ? `- Replace \`${t.replacement}\` with \`${t.term}\`.`
      : `- Spell \`${t.term}\` exactly as written.`,
  )
  return [base, "", "User dictionary (apply silently):", ...lines].join("\n")
}

/**
 * Catalog of LLM models opennib knows how to download and run for the
 * cleanup pass (punctuation / capitalization / dictation-artifact fixup).
 *
 * Sourced from the Qwen team's official GGUF releases on Hugging Face
 * (`huggingface.co/Qwen/Qwen2.5-{size}-Instruct-GGUF`). Q4_K_M is the
 * quantization sweet spot for instruct models — small enough to fit
 * comfortably in RAM alongside Whisper, accurate enough that cleanup
 * doesn't drift away from the source text.
 *
 * Cleanup is a constrained task: punctuation, capitalization, follow a
 * short dictionary. Even the 0.5B model handles it well, so we default
 * to that and let users opt up if they want headroom for long
 * paragraphs or low-resource languages.
 */
export type LlmModelId =
  | "qwen2.5-0.5b-instruct-q4"
  | "qwen2.5-1.5b-instruct-q4"
  | "qwen2.5-3b-instruct-q4"

export interface LlmModel {
  readonly id: LlmModelId
  readonly file: string
  readonly displayName: string
  readonly approxSizeBytes: number
  readonly downloadUrl: string
  /**
   * Canonical LFS sha256 from the HuggingFace repo, verified after every
   * download — same corruption defense as the Whisper catalog (a byte-size-
   * correct but content-wrong download must be rejected before activation).
   */
  readonly sha256: string
}

function entry(
  id: LlmModelId,
  repo: string,
  file: string,
  displayName: string,
  approxSizeBytes: number,
  sha256: string,
): LlmModel {
  return {
    id,
    file,
    displayName,
    approxSizeBytes,
    downloadUrl: `https://huggingface.co/${repo}/resolve/main/${file}`,
    sha256,
  }
}

export const LLM_MODELS: Readonly<Record<LlmModelId, LlmModel>> = {
  "qwen2.5-0.5b-instruct-q4": entry(
    "qwen2.5-0.5b-instruct-q4",
    "Qwen/Qwen2.5-0.5B-Instruct-GGUF",
    "qwen2.5-0.5b-instruct-q4_k_m.gguf",
    "Qwen 2.5 0.5B Instruct (Q4_K_M)",
    400_000_000,
    "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db",
  ),
  "qwen2.5-1.5b-instruct-q4": entry(
    "qwen2.5-1.5b-instruct-q4",
    "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
    "qwen2.5-1.5b-instruct-q4_k_m.gguf",
    "Qwen 2.5 1.5B Instruct (Q4_K_M)",
    1_000_000_000,
    "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e",
  ),
  "qwen2.5-3b-instruct-q4": entry(
    "qwen2.5-3b-instruct-q4",
    "Qwen/Qwen2.5-3B-Instruct-GGUF",
    "qwen2.5-3b-instruct-q4_k_m.gguf",
    "Qwen 2.5 3B Instruct (Q4_K_M)",
    1_900_000_000,
    "626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d",
  ),
}

/**
 * Default LLM model for users who enable cleanup without picking one.
 * 0.5B is sufficient for the constrained cleanup task and keeps the
 * first-launch download under half a gig.
 */
export const DEFAULT_LLM_MODEL_ID: LlmModelId = "qwen2.5-0.5b-instruct-q4"

export function isLlmModelId(value: string): value is LlmModelId {
  return Object.prototype.hasOwnProperty.call(LLM_MODELS, value)
}

export function getLlmModel(id: LlmModelId): LlmModel {
  return LLM_MODELS[id]
}

export function listLlmModels(): readonly LlmModel[] {
  return Object.values(LLM_MODELS)
}

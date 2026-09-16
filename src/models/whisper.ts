/**
 * Catalog of Whisper models opennib knows how to download and run.
 *
 * Sourced from `huggingface.co/ggerganov/whisper.cpp`, the canonical ggml
 * conversion used by whisper.cpp. Multilingual variants are the default
 * because opennib's pitch is multilingual dictation; the `.en` variants are
 * listed for users who only dictate in English and want a smaller / faster
 * model.
 *
 * `sha256` is the canonical LFS hash from HuggingFace and is verified after
 * every download. A mismatched download (which we saw in the wild: byte-size-
 * correct but content-wrong files producing `FAILED_TO_ACTIVATE: vector` in
 * the whispercpp addon) is rejected before it can be activated.
 */
export type WhisperModelId =
  | "tiny"
  | "tiny.en"
  | "base"
  | "base.en"
  | "small"
  | "small.en"
  | "medium"
  | "medium.en"
  | "large-v3"
  | "large-v3-turbo"

export interface WhisperModel {
  readonly id: WhisperModelId
  readonly file: string
  readonly displayName: string
  readonly approxSizeBytes: number
  readonly multilingual: boolean
  readonly downloadUrl: string
  readonly sha256: string
}

const HUGGINGFACE_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main"

function entry(
  id: WhisperModelId,
  file: string,
  displayName: string,
  approxSizeBytes: number,
  multilingual: boolean,
  sha256: string,
): WhisperModel {
  return {
    id,
    file,
    displayName,
    approxSizeBytes,
    multilingual,
    downloadUrl: `${HUGGINGFACE_BASE}/${file}`,
    sha256,
  }
}

export const WHISPER_MODELS: Readonly<Record<WhisperModelId, WhisperModel>> = {
  tiny: entry(
    "tiny",
    "ggml-tiny.bin",
    "Tiny (multilingual)",
    75_000_000,
    true,
    "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
  ),
  "tiny.en": entry(
    "tiny.en",
    "ggml-tiny.en.bin",
    "Tiny (English)",
    75_000_000,
    false,
    "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f",
  ),
  base: entry(
    "base",
    "ggml-base.bin",
    "Base (multilingual)",
    142_000_000,
    true,
    "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
  ),
  "base.en": entry(
    "base.en",
    "ggml-base.en.bin",
    "Base (English)",
    142_000_000,
    false,
    "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
  ),
  small: entry(
    "small",
    "ggml-small.bin",
    "Small (multilingual)",
    466_000_000,
    true,
    "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
  ),
  "small.en": entry(
    "small.en",
    "ggml-small.en.bin",
    "Small (English)",
    466_000_000,
    false,
    "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d",
  ),
  medium: entry(
    "medium",
    "ggml-medium.bin",
    "Medium (multilingual)",
    1_500_000_000,
    true,
    "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208",
  ),
  "medium.en": entry(
    "medium.en",
    "ggml-medium.en.bin",
    "Medium (English)",
    1_500_000_000,
    false,
    "cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356",
  ),
  "large-v3": entry(
    "large-v3",
    "ggml-large-v3.bin",
    "Large v3 (multilingual)",
    3_100_000_000,
    true,
    "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2",
  ),
  "large-v3-turbo": entry(
    "large-v3-turbo",
    "ggml-large-v3-turbo.bin",
    "Large v3 Turbo (multilingual)",
    1_600_000_000,
    true,
    "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
  ),
}

/**
 * Default model for a fresh install. `small` is the smallest multilingual
 * model whose accuracy holds up on non-English languages (Vietnamese, Chinese,
 * etc.) under auto-detect — `base` mis-transcribes those frequently. The
 * tradeoff is a ~466MB first-launch download instead of ~142MB; the readiness
 * banner already shows download progress, so the cost is bearable.
 */
export const DEFAULT_WHISPER_MODEL_ID: WhisperModelId = "small"

export function isWhisperModelId(value: string): value is WhisperModelId {
  return Object.prototype.hasOwnProperty.call(WHISPER_MODELS, value)
}

export function getWhisperModel(id: WhisperModelId): WhisperModel {
  return WHISPER_MODELS[id]
}

export function listWhisperModels(): readonly WhisperModel[] {
  return Object.values(WHISPER_MODELS)
}

export function listMultilingualWhisperModels(): readonly WhisperModel[] {
  return listWhisperModels().filter((m) => m.multilingual)
}

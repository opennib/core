export * from "./errors.js";
export { log, setLogLevel, getLogLevel } from "./log.js";
export type { LogLevel } from "./log.js";
export type {
  AudioFrame,
  DictionaryEntry,
  LanguageTag,
  TranscriptEntry,
} from "./types.js";
export type {
  Recorder,
  Paster,
  Storage,
  Notifier,
  Hotkey,
  HotkeyHandlers,
  ModelManager,
  Permissions,
  PermissionState,
  History,
  HistoryListOptions,
  Dictionary,
  Transcriber,
  Cleaner,
  Settings,
  SettingsSnapshot,
  StorageFs,
} from "./interfaces/index.js";
export { transcribe } from "./transcribe.js";
export type { TranscribeDeps } from "./transcribe.js";
export { cleanupText } from "./cleanup.js";
export type { CleanupDeps } from "./cleanup.js";
export { DictationPipeline } from "./dictation-pipeline.js";
export type {
  DictationPipelineDeps,
  PipelineState,
} from "./dictation-pipeline.js";
export {
  DEFAULT_LANGUAGE,
  HISTORY_RETENTION_DAYS,
  HISTORY_RETENTION_MS,
  MAX_AUDIO_DURATION_SECONDS,
  MAX_TRANSCRIPT_LENGTH,
  WHISPER_SAMPLE_RATE_HZ,
} from "./config/constants.js";
export {
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
} from "./config/languages.js";
export type { SupportedLanguage } from "./config/languages.js";
export {
  DEFAULT_WHISPER_MODEL_ID,
  WHISPER_MODELS,
  getWhisperModel,
  isWhisperModelId,
  listMultilingualWhisperModels,
  listWhisperModels,
} from "./models/whisper.js";
export type { WhisperModel, WhisperModelId } from "./models/whisper.js";
export {
  DEFAULT_LLM_MODEL_ID,
  LLM_MODELS,
  getLlmModel,
  isLlmModelId,
  listLlmModels,
} from "./models/llm.js";
export type { LlmModel, LlmModelId } from "./models/llm.js";
export {
  DEFAULT_SETTINGS_SNAPSHOT,
  parseSettingsSnapshot,
} from "./settings/parse-settings-snapshot.js";
export { buildWhisperModelConfig } from "./whisper-config.js";
export type {
  WhisperModelConfig,
  WhisperModelConfigOptions,
} from "./whisper-config.js";
export { hasLikelySpeech, measurePeak, measureRms } from "./speech-gate.js"
export { decodeWav, encodeWavPcm16 } from "./audio/wav.js"

/**
 * Manages the on-disk lifecycle of model files (Whisper variants, local LLMs).
 *
 * Models are device-local — they are NOT synced. Platform adapters know where
 * the app sandbox / data directory lives and download files there.
 */
export interface ModelManager {
  isInstalled(modelId: string): Promise<boolean>
  download(modelId: string, onProgress?: (percent: number) => void): Promise<void>
  pathFor(modelId: string): Promise<string>
  remove(modelId: string): Promise<void>
}

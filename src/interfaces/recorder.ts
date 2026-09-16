import type { AudioFrame } from "../types.js"

/**
 * Captures audio from the system microphone and returns it as 16 kHz mono PCM.
 *
 * Platform adapters: `expo-av` on mobile; Web Audio (via a hidden Electron
 * renderer) on desktop.
 */
export interface Recorder {
  start(): Promise<void>
  stop(): Promise<AudioFrame>
}

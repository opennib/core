import type { AudioFrame, LanguageTag } from "../types.js"

/**
 * Runs whisper.cpp on a single `AudioFrame` and returns the transcript text.
 *
 * Production adapters wrap `@qvac/sdk` (which embeds whisper.cpp under the hood
 * and runs inside Bare on mobile, Node on desktop). Tests inject an in-memory
 * fake so unit tests never have to load a real model.
 *
 * `modelPath` is resolved by `ModelManager.pathFor(...)` upstream — this
 * interface deliberately knows nothing about how models are stored or named.
 */
export interface Transcriber {
  transcribe(frame: AudioFrame, modelPath: string, language: LanguageTag): Promise<string>
}

import { MIN_SPEECH_PEAK, MIN_SPEECH_RMS, MIN_UTTERANCE_MS } from "./config/constants.js"
import type { AudioFrame } from "./types.js"

/**
 * Root-mean-square level of a PCM float frame, 0 for empty input. Samples
 * are expected in [-1, 1]; the result is on the same scale (1.0 = full scale).
 */
export function measureRms(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0
    sum += s * s
  }
  return Math.sqrt(sum / samples.length)
}

/** Largest absolute sample value in the frame, 0 for empty input. */
export function measurePeak(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i] ?? 0)
    if (a > peak) peak = a
  }
  return peak
}

/**
 * Whether a recorded frame plausibly contains speech. Whisper hallucinates
 * on silence — a held key with nothing said typically transcribes as "you"
 * or "Thank you." — so the pipeline skips transcription for frames that are
 * too short or too quiet. The thresholds are deliberately permissive: quiet
 * speech into a phone mic still passes, only near-silence and accidental
 * taps are cut. See the constants for the measurements behind them.
 */
export function hasLikelySpeech(frame: AudioFrame): boolean {
  if (frame.durationMs < MIN_UTTERANCE_MS) return false
  if (measurePeak(frame.samples) < MIN_SPEECH_PEAK) return false
  return measureRms(frame.samples) >= MIN_SPEECH_RMS
}

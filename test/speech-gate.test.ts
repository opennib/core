import test from "brittle"

import { MIN_SPEECH_PEAK, MIN_UTTERANCE_MS, WHISPER_SAMPLE_RATE_HZ } from "../src/config/constants.js"
import { hasLikelySpeech, measurePeak, measureRms } from "../src/speech-gate.js"

function frame(samples: Float32Array, durationMs: number) {
  return { samples, sampleRate: WHISPER_SAMPLE_RATE_HZ, durationMs }
}

test("measureRms: empty input is 0, full-scale square wave is 1", (t) => {
  t.is(measureRms(new Float32Array(0)), 0)
  const square = new Float32Array(1000).map((_, i) => (i % 2 === 0 ? 1 : -1))
  t.is(measureRms(square), 1)
})

test("measureRms: sine amplitude A has RMS A/√2", (t) => {
  const n = WHISPER_SAMPLE_RATE_HZ
  const sine = new Float32Array(n).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / n))
  const rms = measureRms(sine)
  t.ok(Math.abs(rms - 0.5 / Math.SQRT2) < 1e-3)
})

test("hasLikelySpeech: silence and a faint noise floor fail, speech-level audio passes", (t) => {
  const n = WHISPER_SAMPLE_RATE_HZ
  t.is(hasLikelySpeech(frame(new Float32Array(n), 1000)), false)
  // A dropped mic feed: peak well under the peak floor, whatever its RMS.
  const hiss = new Float32Array(n).map(() => (Math.random() - 0.5) * MIN_SPEECH_PEAK * 0.5)
  t.is(hasLikelySpeech(frame(hiss, 1000)), false)
  const speech = new Float32Array(n).map((_, i) => 0.05 * Math.sin((2 * Math.PI * 200 * i) / n))
  t.is(hasLikelySpeech(frame(speech, 1000)), true)
})

test("hasLikelySpeech: quiet phone-mic speech (-49 dBFS RMS, 0.03 peak) passes", (t) => {
  // Levels measured from iOS recordings that a desktop-tuned RMS gate wrongly
  // dropped: speech at ~0.0035 RMS with peaks around 0.03–0.06.
  const n = WHISPER_SAMPLE_RATE_HZ
  const quiet = new Float32Array(n).map((_, i) => 0.005 * Math.sin((2 * Math.PI * 180 * i) / n))
  for (let i = 0; i < n; i += 4000) quiet[i] = 0.03 // consonant bursts
  t.ok(measurePeak(quiet) >= MIN_SPEECH_PEAK)
  t.is(hasLikelySpeech(frame(quiet, 1000)), true)
})

test("hasLikelySpeech: frames shorter than MIN_UTTERANCE_MS fail even when loud", (t) => {
  const n = Math.round((WHISPER_SAMPLE_RATE_HZ * (MIN_UTTERANCE_MS - 50)) / 1000)
  const loud = new Float32Array(n).fill(0.5)
  t.is(hasLikelySpeech(frame(loud, MIN_UTTERANCE_MS - 50)), false)
})

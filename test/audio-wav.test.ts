import test from "brittle"

import { decodeWav, encodeWavPcm16 } from "../src/audio/wav.js"
import { WHISPER_SAMPLE_RATE_HZ } from "../src/config/constants.js"
import { ValidationError } from "../src/errors.js"

function tone(seconds: number, amplitude = 0.5): Float32Array {
  const n = WHISPER_SAMPLE_RATE_HZ * seconds
  return new Float32Array(n).map((_, i) => amplitude * Math.sin((2 * Math.PI * 440 * i) / WHISPER_SAMPLE_RATE_HZ))
}

test("wav: PCM16 round-trips through encode → decode within quantisation error", (t) => {
  const samples = tone(1)
  const bytes = encodeWavPcm16({ samples, sampleRate: WHISPER_SAMPLE_RATE_HZ, durationMs: 1000 })
  const frame = decodeWav(bytes)
  t.is(frame.sampleRate, WHISPER_SAMPLE_RATE_HZ)
  t.is(frame.durationMs, 1000)
  t.is(frame.samples.length, samples.length)
  let maxErr = 0
  for (let i = 0; i < samples.length; i++) {
    maxErr = Math.max(maxErr, Math.abs((frame.samples[i] ?? 0) - (samples[i] ?? 0)))
  }
  t.ok(maxErr < 1 / 32768 + 1e-6)
})

test("wav: decodes 32-bit float and averages stereo to mono", (t) => {
  const n = 4
  const bytes = new Uint8Array(44 + n * 2 * 4)
  const v = new DataView(bytes.buffer)
  const str = (o: number, s: string) => { for (let i = 0; i < 4; i++) bytes[o + i] = s.charCodeAt(i) }
  str(0, "RIFF"); v.setUint32(4, 36 + n * 8, true); str(8, "WAVE"); str(12, "fmt ")
  v.setUint32(16, 16, true); v.setUint16(20, 3, true); v.setUint16(22, 2, true)
  v.setUint32(24, 16000, true); v.setUint32(28, 16000 * 8, true); v.setUint16(32, 8, true); v.setUint16(34, 32, true)
  str(36, "data"); v.setUint32(40, n * 8, true)
  for (let i = 0; i < n; i++) { v.setFloat32(44 + i * 8, 0.5, true); v.setFloat32(48 + i * 8, -0.5, true) }
  const frame = decodeWav(bytes)
  t.is(frame.samples.length, n)
  t.alike(Array.from(frame.samples), [0, 0, 0, 0])
})

test("wav: skips unknown chunks before data (LIST/INFO from real recorders)", (t) => {
  const inner = encodeWavPcm16({ samples: tone(0.01), sampleRate: WHISPER_SAMPLE_RATE_HZ, durationMs: 10 })
  const list = new Uint8Array(8 + 6)
  const lv = new DataView(list.buffer)
  ;"LIST".split("").forEach((c, i) => (list[i] = c.charCodeAt(0)))
  lv.setUint32(4, 6, true)
  // fmt chunk = bytes 12..36 of inner, data chunk = 36..end; splice LIST between them.
  const bytes = new Uint8Array(inner.length + list.length)
  bytes.set(inner.subarray(0, 36), 0)
  bytes.set(list, 36)
  bytes.set(inner.subarray(36), 36 + list.length)
  const frame = decodeWav(bytes)
  t.is(frame.samples.length, WHISPER_SAMPLE_RATE_HZ / 100)
})

test("wav: rejects non-WAVE input and unsupported bit depths with ValidationError", (t) => {
  t.exception(() => decodeWav(new Uint8Array([1, 2, 3])), /not a RIFF\/WAVE file/)
  try {
    decodeWav(new Uint8Array([1, 2, 3]))
  } catch (err) {
    t.ok(err instanceof ValidationError)
  }
  const bytes = encodeWavPcm16({ samples: tone(0.01), sampleRate: 16000, durationMs: 10 })
  new DataView(bytes.buffer).setUint16(34, 8, true) // claim 8-bit PCM
  t.exception(() => decodeWav(bytes), /unsupported PCM bit depth 8/)
})

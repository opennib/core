import { ValidationError } from "../errors.js"
import type { AudioFrame } from "../types.js"

const RIFF = 0x46464952 // "RIFF" little-endian
const WAVE = 0x45564157 // "WAVE"
const FMT = 0x20746d66 // "fmt "
const DATA = 0x61746164 // "data"
const FORMAT_PCM = 1
const FORMAT_IEEE_FLOAT = 3
const FORMAT_EXTENSIBLE = 0xfffe

/**
 * Decode a RIFF/WAVE file into an `AudioFrame`: mono, samples normalised to
 * [-1, 1]. Supports 16-bit PCM (what `expo-av` and most recorders produce)
 * and 32-bit IEEE float (what the desktop worker writes for whisper), plus
 * the WAVE_FORMAT_EXTENSIBLE wrapper around either. Multi-channel input is
 * averaged down to mono. No resampling: `sampleRate` is reported as found
 * and the caller decides whether it is acceptable.
 *
 * Pure buffer parsing on purpose — no filesystem — so the worker on every
 * platform reads the file with its own fs and hands the bytes here.
 */
export function decodeWav(bytes: Uint8Array): AudioFrame {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.byteLength < 12 || view.getUint32(0, true) !== RIFF || view.getUint32(8, true) !== WAVE) {
    throw new ValidationError("not a RIFF/WAVE file")
  }

  let format = 0
  let channels = 0
  let sampleRate = 0
  let bitsPerSample = 0
  let dataOffset = -1
  let dataLength = 0

  let offset = 12
  while (offset + 8 <= bytes.byteLength) {
    const id = view.getUint32(offset, true)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === FMT) {
      if (size < 16) throw new ValidationError("malformed fmt chunk")
      format = view.getUint16(body, true)
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
      bitsPerSample = view.getUint16(body + 14, true)
      // WAVE_FORMAT_EXTENSIBLE carries the real format in the sub-format GUID.
      if (format === FORMAT_EXTENSIBLE && size >= 26) {
        format = view.getUint16(body + 24, true)
      }
    } else if (id === DATA) {
      dataOffset = body
      dataLength = Math.min(size, bytes.byteLength - body)
      break
    }
    // Chunks are word-aligned.
    offset = body + size + (size % 2)
  }

  if (channels === 0 || sampleRate === 0) throw new ValidationError("WAVE file has no fmt chunk")
  if (dataOffset < 0) throw new ValidationError("WAVE file has no data chunk")
  if (format !== FORMAT_PCM && format !== FORMAT_IEEE_FLOAT) {
    throw new ValidationError(`unsupported WAVE format tag ${format}`)
  }
  if (format === FORMAT_PCM && bitsPerSample !== 16) {
    throw new ValidationError(`unsupported PCM bit depth ${bitsPerSample}`)
  }
  if (format === FORMAT_IEEE_FLOAT && bitsPerSample !== 32) {
    throw new ValidationError(`unsupported float bit depth ${bitsPerSample}`)
  }

  const bytesPerSample = bitsPerSample / 8
  const frameBytes = bytesPerSample * channels
  const frames = Math.floor(dataLength / frameBytes)
  const samples = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) {
      const at = dataOffset + i * frameBytes + c * bytesPerSample
      sum +=
        format === FORMAT_PCM ? view.getInt16(at, true) / 32768 : view.getFloat32(at, true)
    }
    samples[i] = sum / channels
  }

  return { samples, sampleRate, durationMs: Math.round((frames / sampleRate) * 1000) }
}

/**
 * Encode a mono float frame as a 16-bit PCM WAVE file. The inverse of
 * `decodeWav` for the common case; used by tests and by hosts that need to
 * hand whisper a file rather than a buffer.
 */
export function encodeWavPcm16(frame: AudioFrame): Uint8Array {
  const n = frame.samples.length
  const bytes = new Uint8Array(44 + n * 2)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, RIFF, true)
  view.setUint32(4, 36 + n * 2, true)
  view.setUint32(8, WAVE, true)
  view.setUint32(12, FMT, true)
  view.setUint32(16, 16, true)
  view.setUint16(20, FORMAT_PCM, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, frame.sampleRate, true)
  view.setUint32(28, frame.sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  view.setUint32(36, DATA, true)
  view.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, frame.samples[i] ?? 0))
    view.setInt16(44 + i * 2, Math.round(s < 0 ? s * 32768 : s * 32767), true)
  }
  return bytes
}

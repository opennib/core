import test from "brittle"

import { buildWhisperModelConfig } from "../src/whisper-config.js"

test("buildWhisperModelConfig: never emits a detect_language key (the addon derives it from `language`)", (t) => {
  for (const language of ["auto", "en", "vi"]) {
    const config = buildWhisperModelConfig({ language, audioFormat: "f32le" })
    t.ok(!Object.keys(config).includes("detect_language"))
    t.is(config.language, language)
  }
})

test("buildWhisperModelConfig: applies the desktop-oriented defaults", (t) => {
  const config = buildWhisperModelConfig({ language: "auto", audioFormat: "s16le" })
  t.is(config.audio_format, "s16le")
  t.is(config.strategy, "greedy")
  t.is(config.n_threads, 4)
  t.is(config.no_timestamps, true)
  t.is(config.suppress_blank, true)
  t.is(config.suppress_nst, true)
  t.is(config.temperature, 0)
  t.alike(config.contextParams, { use_gpu: true, flash_attn: true })
})

test("buildWhisperModelConfig: honors per-platform overrides", (t) => {
  const config = buildWhisperModelConfig({
    language: "en",
    audioFormat: "f32le",
    nThreads: 2,
    useGpu: false,
    flashAttn: false,
  })
  t.is(config.n_threads, 2)
  t.alike(config.contextParams, { use_gpu: false, flash_attn: false })
})

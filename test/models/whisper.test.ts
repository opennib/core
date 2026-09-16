import test from "brittle"

import {
  DEFAULT_WHISPER_MODEL_ID,
  WHISPER_MODELS,
  getWhisperModel,
  isWhisperModelId,
  listMultilingualWhisperModels,
  listWhisperModels,
} from "../../src/models/whisper.js"

test("whisper model registry: default model is multilingual", (t) => {
  t.is(getWhisperModel(DEFAULT_WHISPER_MODEL_ID).multilingual, true)
})

test("whisper model registry: every entry's id matches its registry key", (t) => {
  for (const [key, model] of Object.entries(WHISPER_MODELS)) {
    t.is(model.id, key)
  }
})

test("whisper model registry: every download URL points at the canonical ggerganov/whisper.cpp repo", (t) => {
  for (const model of listWhisperModels()) {
    t.ok(
      /^https:\/\/huggingface\.co\/ggerganov\/whisper\.cpp\/resolve\/main\/ggml-/.test(
        model.downloadUrl,
      ),
    )
    t.is(model.downloadUrl.endsWith(`/${model.file}`), true)
  }
})

test("whisper model registry: .en variants are not multilingual", (t) => {
  for (const model of listWhisperModels()) {
    if (model.id.endsWith(".en")) t.is(model.multilingual, false)
  }
})

test("whisper model registry: non-.en variants are multilingual", (t) => {
  for (const model of listWhisperModels()) {
    if (!model.id.endsWith(".en")) t.is(model.multilingual, true)
  }
})

test("whisper model registry: isWhisperModelId narrows known ids and rejects unknown strings", (t) => {
  t.is(isWhisperModelId("base"), true)
  t.is(isWhisperModelId("large-v3-turbo"), true)
  t.is(isWhisperModelId("nonsense"), false)
  t.is(isWhisperModelId(""), false)
})

test("whisper model registry: listMultilingualWhisperModels excludes .en variants", (t) => {
  const ids = listMultilingualWhisperModels().map((m) => m.id)
  t.ok(!ids.includes("tiny.en"))
  t.ok(!ids.includes("base.en"))
  t.ok(ids.includes("base"))
  t.ok(ids.includes("large-v3"))
})

test("whisper model registry: approximate sizes are positive and roughly increase with model size", (t) => {
  for (const model of listWhisperModels()) {
    t.ok(model.approxSizeBytes > 0)
  }
  t.ok(getWhisperModel("tiny").approxSizeBytes < getWhisperModel("base").approxSizeBytes)
  t.ok(getWhisperModel("base").approxSizeBytes < getWhisperModel("small").approxSizeBytes)
  t.ok(getWhisperModel("small").approxSizeBytes < getWhisperModel("medium").approxSizeBytes)
  t.ok(getWhisperModel("medium").approxSizeBytes < getWhisperModel("large-v3").approxSizeBytes)
})

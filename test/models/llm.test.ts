import test from "brittle"

import {
  DEFAULT_LLM_MODEL_ID,
  LLM_MODELS,
  getLlmModel,
  isLlmModelId,
  listLlmModels,
} from "../../src/models/llm.js"

test("llm model registry: default model is in the registry", (t) => {
  t.ok(getLlmModel(DEFAULT_LLM_MODEL_ID) !== undefined)
})

test("llm model registry: every entry's id matches its registry key", (t) => {
  for (const [key, model] of Object.entries(LLM_MODELS)) {
    t.is(model.id, key)
  }
})

test("llm model registry: every download URL points at the canonical Qwen GGUF repo", (t) => {
  for (const model of listLlmModels()) {
    t.ok(
      /^https:\/\/huggingface\.co\/Qwen\/Qwen2\.5-[\d.]+B-Instruct-GGUF\/resolve\/main\/qwen2\.5-/.test(
        model.downloadUrl,
      ),
    )
    t.is(model.downloadUrl.endsWith(`/${model.file}`), true)
  }
})

test("llm model registry: every entry carries a canonical sha256", (t) => {
  for (const model of listLlmModels()) {
    t.ok(/^[0-9a-f]{64}$/.test(model.sha256))
  }
})

test("llm model registry: isLlmModelId narrows known ids and rejects unknown strings", (t) => {
  t.is(isLlmModelId("qwen2.5-0.5b-instruct-q4"), true)
  t.is(isLlmModelId("qwen2.5-3b-instruct-q4"), true)
  t.is(isLlmModelId("nonsense"), false)
  t.is(isLlmModelId(""), false)
})

test("llm model registry: approximate sizes are positive and increase with model size", (t) => {
  for (const model of listLlmModels()) {
    t.ok(model.approxSizeBytes > 0)
  }
  t.ok(
    getLlmModel("qwen2.5-0.5b-instruct-q4").approxSizeBytes <
      getLlmModel("qwen2.5-1.5b-instruct-q4").approxSizeBytes,
  )
  t.ok(
    getLlmModel("qwen2.5-1.5b-instruct-q4").approxSizeBytes <
      getLlmModel("qwen2.5-3b-instruct-q4").approxSizeBytes,
  )
})

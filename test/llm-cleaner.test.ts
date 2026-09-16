import test from "brittle"

import { LlmCleaner, type LlmSdk } from "../src/llm-cleaner.js"

// brittle can't mock modules the way vitest's `vi.mock("@qvac/sdk")` does, so
// the cleaner accepts an injected SDK facade. This recording fake stands in
// for the real @qvac/sdk so these tests never touch native binaries.

type LoadModelArgs = {
  modelSrc: { src: string; engine: "llamacpp-completion" }
  modelConfig: { temp: number; gpu_layers: number }
}

type CompletionArgs = {
  modelId: string
  stream: false
  history: { role: "system" | "user"; content: string }[]
}

interface FakeSdk extends LlmSdk {
  readonly loadCalls: LoadModelArgs[]
  readonly completionCalls: CompletionArgs[]
  readonly unloadCalls: Array<{ modelId: string }>
}

function makeSdk(behavior: { loadIds?: string[]; completionText?: string } = {}): FakeSdk {
  const loadCalls: LoadModelArgs[] = []
  const completionCalls: CompletionArgs[] = []
  const unloadCalls: Array<{ modelId: string }> = []
  const loadIds = behavior.loadIds ?? ["llm-id-1"]
  let loadIndex = 0
  return {
    loadCalls,
    completionCalls,
    unloadCalls,
    async loadModel(options) {
      loadCalls.push(options)
      const id = loadIds[loadIndex] ?? loadIds[loadIds.length - 1] ?? "llm-id-1"
      loadIndex++
      return id
    },
    completion(options) {
      completionCalls.push(options)
      return { text: Promise.resolve(behavior.completionText ?? "Hello, world.") }
    },
    async unloadModel(options) {
      unloadCalls.push(options)
    },
  }
}

test("LlmCleaner: loads the LLM model on first call and returns the cleaned text", async (t) => {
  const sdk = makeSdk()
  const cleaner = new LlmCleaner({ modelPath: "/m/llm.gguf", sdk })
  const out = await cleaner.cleanup("hello world", "auto")
  t.is(out, "Hello, world.")
  t.is(sdk.loadCalls.length, 1)
  t.is(sdk.completionCalls.length, 1)
})

test("LlmCleaner: does NOT reload the model on subsequent calls", async (t) => {
  const sdk = makeSdk()
  const cleaner = new LlmCleaner({ modelPath: "/m/llm.gguf", sdk })
  await cleaner.cleanup("hi", "auto")
  await cleaner.cleanup("there", "auto")
  t.is(sdk.loadCalls.length, 1)
  t.is(sdk.completionCalls.length, 2)
})

test("LlmCleaner: loads the LLM via a descriptor with engine=llamacpp-completion and the requested path", async (t) => {
  const sdk = makeSdk()
  const cleaner = new LlmCleaner({ modelPath: "/m/llm.gguf", sdk })
  await cleaner.cleanup("hi", "auto")
  const args = sdk.loadCalls[0]
  t.is(args?.modelSrc.src, "/m/llm.gguf")
  t.is(args?.modelSrc.engine, "llamacpp-completion")
})

test("LlmCleaner: loads with deterministic temp and full GPU offload by default", async (t) => {
  const sdk = makeSdk()
  const cleaner = new LlmCleaner({ modelPath: "/m/llm.gguf", sdk })
  await cleaner.cleanup("hi", "auto")
  const args = sdk.loadCalls[0]
  t.is(args?.modelConfig.temp, 0)
  t.is(args?.modelConfig.gpu_layers, 99)
})

test("LlmCleaner: respects constructor-supplied options", async (t) => {
  const sdk = makeSdk()
  const cleaner = new LlmCleaner({
    modelPath: "/m/llm.gguf",
    sdk,
    useGpu: false,
  })
  await cleaner.cleanup("hi", "auto")
  const args = sdk.loadCalls[0]
  t.is(args?.modelConfig.gpu_layers, 0)
})

test("LlmCleaner: calls completion with stream=false and the system+user prompt", async (t) => {
  const sdk = makeSdk()
  const cleaner = new LlmCleaner({ modelPath: "/m/llm.gguf", sdk })
  await cleaner.cleanup("hello world", "auto")
  const args = sdk.completionCalls[0]
  t.is(args?.modelId, "llm-id-1")
  t.is(args?.stream, false)
  t.is(args?.history.length, 2)
  t.is(args?.history[0]?.role, "system")
  t.alike(args?.history[1], { role: "user", content: "hello world" })
})

test("LlmCleaner: uses a custom systemPrompt when provided", async (t) => {
  const sdk = makeSdk()
  const cleaner = new LlmCleaner({
    modelPath: "/m/llm.gguf",
    sdk,
    systemPrompt: "JUST FIX TYPOS",
  })
  await cleaner.cleanup("hi", "auto")
  const args = sdk.completionCalls[0]
  t.is(args?.history[0]?.content, "JUST FIX TYPOS")
})

test("LlmCleaner: default system prompt mentions language preservation", async (t) => {
  const sdk = makeSdk()
  const cleaner = new LlmCleaner({ modelPath: "/m/llm.gguf", sdk })
  await cleaner.cleanup("xin chao", "vi")
  const content = (sdk.completionCalls[0]?.history[0]?.content ?? "").toLowerCase()
  t.ok(content.includes("preserve"))
  t.ok(content.includes("language"))
})

test("LlmCleaner: unload() calls unloadModel and clears the cache; next cleanup reloads", async (t) => {
  const sdk = makeSdk({ loadIds: ["llm-id-1", "llm-id-2"] })
  const cleaner = new LlmCleaner({ modelPath: "/m/llm.gguf", sdk })
  await cleaner.cleanup("hi", "auto")
  await cleaner.unload()
  t.is(sdk.unloadCalls.length, 1)
  t.alike(sdk.unloadCalls[0], { modelId: "llm-id-1" })

  await cleaner.cleanup("there", "auto")
  t.is(sdk.loadCalls.length, 2)
})

test("LlmCleaner: unload() is safe to call when nothing is loaded", async (t) => {
  const sdk = makeSdk()
  const cleaner = new LlmCleaner({ modelPath: "/m/llm.gguf", sdk })
  await cleaner.unload()
  t.is(sdk.unloadCalls.length, 0)
})

test("LlmCleaner: appends a dictionary block to the system prompt when terms are provided", async (t) => {
  const sdk = makeSdk()
  const cleaner = new LlmCleaner({ modelPath: "/m/llm.gguf", sdk })
  await cleaner.cleanup("hi", "auto", [
    { id: "1", term: "opennib", createdAt: 0 },
    { id: "2", term: "QVAC", replacement: "kuvac", createdAt: 0 },
  ])
  const sys = sdk.completionCalls[0]?.history[0]?.content ?? ""
  t.ok(sys.includes("User dictionary"))
  t.ok(sys.includes("Spell `opennib` exactly as written."))
  t.ok(sys.includes("Replace `kuvac` with `QVAC`."))
})

test("LlmCleaner: does not add a dictionary block when terms is empty", async (t) => {
  const sdk = makeSdk()
  const cleaner = new LlmCleaner({ modelPath: "/m/llm.gguf", sdk })
  await cleaner.cleanup("hi", "auto", [])
  t.ok(!(sdk.completionCalls[0]?.history[0]?.content ?? "").includes("User dictionary"))
})

test("LlmCleaner: does not add a dictionary block when terms is undefined", async (t) => {
  const sdk = makeSdk()
  const cleaner = new LlmCleaner({ modelPath: "/m/llm.gguf", sdk })
  await cleaner.cleanup("hi", "auto")
  t.ok(!(sdk.completionCalls[0]?.history[0]?.content ?? "").includes("User dictionary"))
})

# @opennib/core

Runtime-portable core for building **local, private dictation**: on-device Whisper transcription and LLM transcript cleanup (via [`@qvac/sdk`](https://www.npmjs.com/package/@qvac/sdk)), append-only [Hypercore](https://github.com/holepunchto/hypercore) storage for history and a custom dictionary, and a typed, append-only RPC contract to drive it all from any UI.

No cloud, no telemetry — audio and transcripts never leave the device.

```sh
npm install @opennib/core
```

## Architecture

`@opennib/core` follows the [Tether stack](https://github.com/tetherto/tips/blob/main/posts/28-05-26-the-tether-stack.md): the package is a complete headless backend designed to run inside a [Bare](https://github.com/holepunchto/bare) worker, with the host app as a thin RPC client. It also loads under Node and Expo's Hermes — the support matrix is in [`docs/runtime-matrix.md`](./docs/runtime-matrix.md).

```
 host app (Electron, React Native, CLI, …)
 audio capture · UI · text insertion
        │
        │  typed RPC — @opennib/core/hrpc (generated, append-only)
        ▼
 @opennib/core, inside a Bare worker
 ┌───────────────────────────────────────────────────────┐
 │ orchestrators   transcribe · cleanupText · pipeline   │
 │ engines         WhisperTranscriber · LlmCleaner       │  ← @qvac/sdk
 │ storage         HypercoreHistory · HypercoreDictionary│  ← hypercore
 │ foundation      types · typed errors · model catalogs │
 └───────────────────────────────────────────────────────┘
```

Internally the layers only import downward; the engines are the only files that touch `@qvac/sdk`, and storage is the only place that touches Hypercore.

| Entry                               | Contents                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `@opennib/core`                     | types, typed errors (`OpennibError` hierarchy), orchestrators, model catalogs (sha256-verified), `buildWhisperModelConfig`, `log` |
| `@opennib/core/hrpc`                | the generated RPC contract (compact-encoding; schema in `spec/`, append-only)                                                     |
| `@opennib/core/whisper-transcriber` | Whisper engine over `@qvac/sdk` (loads native binaries — import only where you mean it)                                           |
| `@opennib/core/llm-cleaner`         | local-LLM transcript cleanup engine                                                                                               |
| `@opennib/core/hypercore`           | append-only history + dictionary stores                                                                                           |
| `@opennib/core/rpc`                 | `rehydrateError` — wire errors back into typed `OpennibError`s                                                                    |

## Quick usage

### Transcribe audio

```ts
import { WhisperTranscriber } from "@opennib/core/whisper-transcriber"
import { WHISPER_MODELS } from "@opennib/core"

// 1. Get a model file. The catalog carries the canonical URL + sha256 —
//    download it once, verify the hash, keep the path.
const model = WHISPER_MODELS["small"] // multilingual default
// model.downloadUrl → https://huggingface.co/ggerganov/whisper.cpp/...
// model.sha256      → verify after download

// 2. Transcribe a 16 kHz mono Float32 AudioFrame ("auto" = detect language).
const transcriber = new WhisperTranscriber()
const text = await transcriber.transcribe(
  { samples, sampleRate: 16_000, durationMs: 2_000 },
  "/models/ggml-small.bin",
  "auto",
)
```

Exactly one model stays resident, keyed by `(modelPath, language)` — whisper.cpp bakes the language in at load time, so a language or model switch unloads the previous context and loads the new one. Call `transcriber.unloadAll()` at shutdown.

> Under Bare, register the SDK plugin once before the first call:
> `const { plugins } = await import("@qvac/sdk")` +
> `plugins([whisperPlugin])` with the plugin from
> `@qvac/sdk/whispercpp-transcription/plugin`. Under Node the SDK manages
> its own worker and no registration is needed.

### Clean up a transcript (optional, best-effort)

```ts
import { cleanupText } from "@opennib/core"
import { LlmCleaner } from "@opennib/core/llm-cleaner"

const cleaner = new LlmCleaner({ modelPath: "/models/qwen2.5-0.5b-instruct-q4_k_m.gguf" })

const polished = await cleanupText(rawText, {
  cleaner,
  language: "en",
  // dictionary terms are woven into the prompt: "Spell `opennib` exactly…"
  terms: [{ id: "1", term: "opennib", replacement: "open nib", createdAt: Date.now() }],
})
```

`cleanupText` fixes punctuation and capitalization only — and falls back to the raw transcript on any failure. Cleanup is cosmetics, never a gatekeeper.

### Store history and dictionary

```ts
import { HypercoreHistory, HypercoreDictionary } from "@opennib/core/hypercore"

const history = new HypercoreHistory({ storagePath: "./data/history" })
await history.append({ id, createdAt: Date.now(), text, language: "en", durationMs })
const recent = await history.list({ limit: 20 }) // newest first, 30-day retention
```

Append-only logs: entries are never mutated, removals are tombstones, and `list()` materializes the current view.

### Drive it over RPC (the production shape)

```js
// worker side (Bare) — serve the contract
import HRPC from "@opennib/core/hrpc"
const rpc = new HRPC(stream)
rpc.onTranscribeFile(async ({ wavPath, model, language }) => {
  try {
    return { error: null, text: await myTranscribe(wavPath, model, language) }
  } catch (err) {
    return { error: { name: err.name, message: err.message }, text: null }
  }
})
```

```ts
// host side — call it
import HRPC from "@opennib/core/hrpc"
import { rehydrateError } from "@opennib/core/rpc"

const rpc = new HRPC(socket)
const res = await rpc.transcribeFile({ wavPath, model: "small", language: "auto" })
if (res.error) throw rehydrateError(res.error.name, res.error.message)
pasteIntoFocusedApp(res.text) // your platform's job — core stops at text
```

Two contract rules: handlers **return** the `error` envelope instead of throwing (a thrown handler hangs the caller), and the schema in `spec/` is **append-only** — grow it with `npm run build:hrpc`, never renumber or repurpose. That's what lets independently-released clients and workers stay compatible.

## Development

```sh
npm install
npx tsc -p tsconfig.json --noEmit   # typecheck
npm run build                       # compile to dist/
npm test                            # 177 tests, running under the Bare runtime
```

Tests run under Bare on purpose: this package's production home is a Bare worker, and a bug caught under Bare on a laptop is a mobile bug caught early. Contribution notes are in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

[MIT](./LICENSE).

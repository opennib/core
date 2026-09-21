# @opennib/core

<p>
  <a href="https://github.com/tetherto/qvac"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tetherto/qvac/refs/heads/main/docs/branding/qvac-badge-inline-green-dark.svg">
    <img alt="Built with QVAC" src="https://raw.githubusercontent.com/tetherto/qvac/refs/heads/main/docs/branding/qvac-badge-inline-green-light.svg">
  </picture></a>
  <a href="https://www.npmjs.com/package/@opennib/core"><img alt="npm version" src="https://img.shields.io/npm/v/%40opennib%2Fcore?label=npm&labelColor=4b5563&color=1f6feb&style=flat"></a>
  <a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-1f6feb?style=flat&labelColor=4b5563"></a>
</p>

**Website:** [opennib.com](https://opennib.com) · **Privacy policy:** [opennib.com/privacy](https://opennib.com/privacy)

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
import { WhisperTranscriber } from "@opennib/core/whisper-transcriber";
import { WHISPER_MODELS } from "@opennib/core";

// 1. Get a model file. The catalog carries the canonical URL + sha256 —
//    download it once, verify the hash, keep the path.
const model = WHISPER_MODELS["small"]; // multilingual default
// model.downloadUrl → https://huggingface.co/ggerganov/whisper.cpp/...
// model.sha256      → verify after download

// 2. Transcribe a 16 kHz mono Float32 AudioFrame ("auto" = detect language).
const transcriber = new WhisperTranscriber();
const text = await transcriber.transcribe(
  { samples, sampleRate: 16_000, durationMs: 2_000 },
  "/models/ggml-small.bin",
  "auto",
);
```

Exactly one model stays resident, keyed by `(modelPath, language)` — whisper.cpp bakes the language in at load time, so a language or model switch unloads the previous context and loads the new one. Call `transcriber.unloadAll()` at shutdown.

Two helpers the pipeline uses that hosts may want directly:

```ts
import { decodeWav, hasLikelySpeech } from "@opennib/core";

const frame = decodeWav(bytes); // PCM16 or float32 WAVE → mono AudioFrame
if (!hasLikelySpeech(frame)) {
  // Too short (< 250 ms) or too quiet: whisper would hallucinate ("you",
  // "Thank you.") on this, so the pipeline skips it. Thresholds are tuned on
  // phone-mic recordings; see config/constants.ts.
}
```

> Under Bare, register the SDK plugin once before the first call:
> `const { plugins } = await import("@qvac/sdk")` +
> `plugins([whisperPlugin])` with the plugin from
> `@qvac/sdk/whispercpp-transcription/plugin`. Under Node the SDK manages
> its own worker and no registration is needed.

### Clean up a transcript (optional, best-effort)

```ts
import { cleanupText } from "@opennib/core";
import { LlmCleaner } from "@opennib/core/llm-cleaner";

const cleaner = new LlmCleaner({
  modelPath: "/models/qwen2.5-0.5b-instruct-q4_k_m.gguf",
});

const polished = await cleanupText(rawText, {
  cleaner,
  language: "en",
  // dictionary terms are woven into the prompt: "Spell `opennib` exactly…"
  terms: [
    {
      id: "1",
      term: "opennib",
      replacement: "open nib",
      createdAt: Date.now(),
    },
  ],
});
```

`cleanupText` fixes punctuation and capitalization only — and falls back to the raw transcript on any failure. Cleanup is cosmetics, never a gatekeeper.

### Store history and dictionary

```ts
import { HypercoreHistory, HypercoreDictionary } from "@opennib/core/hypercore";

const history = new HypercoreHistory({ storagePath: "./data/history" });
await history.append({
  id,
  createdAt: Date.now(),
  text,
  language: "en",
  durationMs,
});
const recent = await history.list({ limit: 20 }); // newest first, 30-day retention
```

Append-only logs: entries are never mutated, removals are tombstones, and `list()` materializes the current view.

### Running core as a worker (the production shape)

`@opennib/core` is a **library** — it starts no processes. Whisper and
Hypercore want the Bare runtime, and an app's UI runs somewhere else (Node
in Electron, Hermes in React Native), so in production the library runs in
its own **Bare worker** and the app talks to it over RPC:

```
   your app  (Electron main · React Native · a CLI)          ← the HOST
   UI, audio capture, text insertion
        │
        │  typed RPC   @opennib/core/hrpc   (generated from spec/, append-only)
        ▼
   a Bare process running a small WORKER SCRIPT
   that imports this library and serves the contract
        │
        ├─ WhisperTranscriber · LlmCleaner          (@qvac/sdk, in-process)
        └─ HypercoreHistory · HypercoreDictionary
```

Three pieces, and it matters who owns each:

| Piece                 | Who provides it         | What it is                                                                                                                                                                   |
| --------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The contract**      | this package, generated | `@opennib/core/hrpc` — one `HRPC` class with a _call_ method and an _on_ method per command (`historyAppend()` / `onHistoryAppend()`). Both ends instantiate the same class. |
| **The worker script** | your app (today)        | ~12 one-line handlers connecting each command to the library, e.g. `onHistoryAppend(({ entry }) => history.append(entry))`.                                                  |
| **The host**          | your app                | starts the Bare process, connects the stream, calls the typed methods.                                                                                                       |

Runnable pair: `node examples/06-rpc-host.mjs` (host) + `examples/06-rpc-worker.mjs` (worker).

#### The worker script

Runs under Bare. Its only jobs: connect back to the host, register a handler
per command, call the library.

```js
// worker.mjs — started as `bare worker.mjs <socketPath>`
import net from "bare-net";
import HRPC from "@opennib/core/hrpc";
import { HypercoreHistory } from "@opennib/core/hypercore";

const rpc = new HRPC(net.connect(Bare.argv[Bare.argv.length - 1]));
let history;

// The generated dispatcher has no try/catch, so a throwing handler would hang
// the caller. Every handler RETURNS the error envelope instead.
const guard =
  (fn, empty = {}) =>
  async (req) => {
    try {
      return await fn(req);
    } catch (err) {
      return { error: { name: err.name, message: err.message }, ...empty };
    }
  };

rpc.onInit(
  guard(async ({ historyDir }) => {
    history = new HypercoreHistory({ storagePath: historyDir });
    return { error: null };
  }),
);
rpc.onHistoryAppend(
  guard(async ({ entry }) => {
    await history.append(entry);
    return { error: null };
  }),
);
rpc.onTranscribeFile(
  guard(
    async ({ wavPath, model, language }) => {
      return {
        error: null,
        text: await myTranscribe(wavPath, model, language),
      };
    },
    { text: null },
  ),
);
```

#### The host — desktop (Node / Electron)

Start to finish in one program. Runnable: `node examples/06-rpc-host.mjs`.

```ts
import { createServer } from "node:net";
import spawn from "bare-runtime/spawn"; // launches the `bare` binary shipped in node_modules
import HRPC from "@opennib/core/hrpc";
import { rehydrateError } from "@opennib/core/rpc";

// every reply carries `error`; this turns it back into the typed OpennibError
const unwrap = <T extends { error: { name: string; message: string } | null }>(
  res: T,
): T => {
  if (res.error) throw rehydrateError(res.error.name, res.error.message);
  return res;
};

// 1. START — a child process over a unix socket. Listen first (the worker
//    connects back the moment it boots), then spawn.
const connected = new Promise<HRPC>((resolve) => {
  createServer((socket) => resolve(new HRPC(socket))).listen(socketPath); // keep the path short: macOS caps it at ~104 bytes
});
const child = spawn("bare", { args: ["worker.mjs", socketPath] });
const rpc = await connected;

// 2. INIT — tell the worker where to keep its data; nothing else works before this
unwrap(
  await rpc.init({
    historyDir: `${dataDir}/history`,
    dictionaryDir: `${dataDir}/dictionary`,
  }),
);

// 3. INTERACT — typed methods, each returning { error, ...payload }
const { text } = unwrap(
  await rpc.transcribeFile({ wavPath, model: "small", language: "auto" }),
);

unwrap(
  await rpc.historyAppend({
    entry: {
      id,
      createdAt: Date.now(),
      text,
      language: "auto",
      durationMs,
      app: null,
    },
  }),
);
const { entries } = unwrap(await rpc.historyList({ limit: 20, before: null })); // newest first

unwrap(
  await rpc.dictionaryAdd({
    id,
    term: "opennib",
    replacement: "open nib",
    createdAt: Date.now(),
  }),
);
const { entries: terms } = unwrap(await rpc.dictionaryList({}));

// optional LLM cleanup: configure once (null turns it off), then clean
unwrap(
  await rpc.cleanerConfigure({
    modelPath: "/models/qwen2.5-0.5b-instruct-q4_k_m.gguf",
  }),
);
const { text: polished } = unwrap(
  await rpc.cleanerCleanup({ text, language: "en", terms }),
);

// 4. SHUTDOWN — the worker closes its Hypercore logs and unloads models, then end the process
unwrap(await rpc.shutdown({}));
child.kill();
```

#### The host — mobile (React Native)

Same four steps. Apps can't launch executables, so `react-native-bare-kit`
runs Bare as a **thread inside the app** and hands you the stream; the worker
script is pre-bundled for the device with `bare-pack`.

```ts
import { Worklet } from "react-native-bare-kit";
import HRPC from "@opennib/core/hrpc";
import { rehydrateError } from "@opennib/core/rpc";
import workerBundle from "./worker.bundle"; // bare-pack output, as bytes

const unwrap = <T extends { error: { name: string; message: string } | null }>(
  res: T,
): T => {
  if (res.error) throw rehydrateError(res.error.name, res.error.message);
  return res;
};

// 1. START — a Bare thread inside the app; its IPC channel is the stream.
//    HOME_DIR is where @qvac/sdk keeps its model cache — a writable sandbox dir.
const worklet = new Worklet();
worklet.start("/app.bundle", workerBundle, [
  "react-native-bare-kit",
  "worker.js",
  JSON.stringify({ HOME_DIR: dataDir }),
]);
const rpc = new HRPC(worklet.IPC);
rpc.onModelProgress(({ model, percent }) => showProgress(model, percent)); // worker → app push events

// 2. INIT
unwrap(
  await rpc.init({
    historyDir: `${dataDir}/history`,
    dictionaryDir: `${dataDir}/dictionary`,
  }),
);

// 3. INTERACT — warm the model once (downloads on first use, reports progress) …
unwrap(await rpc.modelLoad({ model: "tiny", language: "auto" }));

// … then one `dictate` per push-to-talk: the worker runs core's
// DictationPipeline on the recorded file — speech gate → whisper → cleanup
// → history append — and returns the final text (null when the recording
// had no speech). The app only records and displays; history is already
// written when this resolves.
const { text } = unwrap(
  await rpc.dictate({ wavPath, model: "tiny", language: "auto" }),
);
const { entries } = unwrap(await rpc.historyList({ limit: 20, before: null }));

// `transcribeFile` still exists for hosts that orchestrate themselves.

unwrap(
  await rpc.dictionaryAdd({
    id,
    term: "opennib",
    replacement: "open nib",
    createdAt: Date.now(),
  }),
);
const { entries: terms } = unwrap(await rpc.dictionaryList({}));

// 4. SHUTDOWN
unwrap(await rpc.shutdown({}));
worklet.terminate();
```

The full command list is `scripts/build-hrpc.mjs` — one line per command,
request struct → response struct.

#### Rules of the contract

- **Handlers return errors, never throw.** The `error` field on every
  response is the error channel; `rehydrateError` turns it back into a typed
  `OpennibError` on the host, so `instanceof` works across the process
  boundary exactly as in-process.
- **`spec/` is append-only and committed.** Grow it via `scripts/build-hrpc.mjs`
  - `npm run build:hrpc`; never renumber, repurpose, or hand-edit the
    generated files. The committed registry is what guarantees an old app keeps
    working against a newer worker.
- **Optional fields decode as `null`**, not `undefined`.

> **Coming next:** the handler one-liners are the same in every app, so the
> next release ships them — `@opennib/core/worker` (a complete worker script,
> configurable for which engines and transcription commands to serve) and
> `@opennib/core/host` (the listen → spawn → connect → init sequence above as
> one call). An app will then start core in three lines and write no worker
> code at all.

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

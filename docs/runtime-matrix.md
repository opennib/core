# Runtime matrix

What `@opennib/core` code may use. The library runs inside a **Bare** worker
in production and is tested under Bare; Node (Electron main) and Hermes
(React Native UI) also import it, so every module must load in all three.

| Feature                              | Bare | Node 22 | Hermes |
| ------------------------------------ | ---- | ------- | ------ |
| ES2022, Promises, TypedArrays, `Map` | ✅   | ✅      | ✅     |
| `fetch`, `URL`, timers, `console`    | ✅   | ✅      | ✅     |
| `Buffer`                             | ✅   | ✅      | ❌     |
| `TextEncoder` / `TextDecoder`        | ❌   | ✅      | ⚠️     |
| `events`                             | ✅   | ✅      | ✅     |
| `@qvac/sdk`, `hypercore`             | ✅   | ⚠️      | ❌     |
| `bare-*` modules                     | ✅   | ❌      | ❌     |
| `node:*` modules                     | ❌   | ✅      | ❌     |
| spawning processes                   | ⚠️   | ✅      | ❌     |
| DOM, `localStorage`                  | ❌   | ❌      | ❌     |

✅ use · ⚠️ runtime-specific, verify · ❌ never in the library

## Rules

- Use only rows that are ✅ in all three columns. `Buffer` only behind
  `typeof Buffer !== "undefined"` with a pure-JS fallback (the RPC codec does
  this; a test asserts byte-identical output).
- No `bare-*` or `node:*` imports in `src/`. Platform capabilities enter via
  interfaces in `src/interfaces/` (`StorageFs`, `AudioEncoder`, the engines'
  `sdk` facade). The worker script fills them.
- Engines and Hypercore live behind subpath exports
  (`@opennib/core/whisper-transcriber`, `/llm-cleaner`, `/hypercore`) and are
  only imported by code that runs in the worker.

## Bare-specific facts

- `@qvac/sdk` under Bare runs in-process: register plugins before the first
  call (`plugins([whisperPlugin, …])`), and only the engines the app's native
  binary links (iOS: whisper only).
- Under `react-native-bare-kit` the SDK reads its home dir from worklet argv:
  start with `["react-native-bare-kit", "worker.js", JSON.stringify({ HOME_DIR })]`.
- One process per Hypercore directory (OS file lock); a second open throws
  `StorageError`.

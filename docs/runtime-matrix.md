# Runtime Matrix

`packages/core/` runs in three JavaScript runtimes. This matrix is the source of truth for what's safe to use in core code.

## The three runtimes

- **Node.js 22+** — used by the Electron main process on desktop
- **Bare** — Holepunch's lightweight runtime, runs the AI worker on mobile
- **Hermes** (or JavaScriptCore) via Expo — runs the React Native context on mobile

The lowest common denominator is Bare. If something works in Bare, it almost always works in Node and Expo too. If it doesn't work in Bare, you cannot use it in core.

## Support table

| Feature                              | Node 22 | Bare | Expo (RN) |
|--------------------------------------|---------|------|-----------|
| ES2022 syntax (async, classes, etc.) | ✅      | ✅   | ✅        |
| Promise, async/await, async iterators| ✅      | ✅   | ✅        |
| Map, Set, WeakMap, WeakSet           | ✅      | ✅   | ✅        |
| TypedArrays                          | ✅      | ✅   | ✅        |
| Proxy, Reflect                       | ✅      | ✅   | ✅        |
| `crypto.subtle` (Web Crypto)         | ✅      | ✅   | ✅        |
| `crypto` (Node module)               | ✅      | ⚠️    | ❌        |
| `Buffer`                             | ✅      | ✅   | ⚠️ (polyfill) |
| `fetch` (global)                     | ✅      | ✅   | ✅        |
| `URL`, `URLSearchParams`             | ✅      | ✅   | ✅        |
| `events` (Node module)               | ✅      | ✅   | ✅ (polyfilled by RN) |
| `stream` (Node module)               | ✅      | ⚠️    | ⚠️         |
| `util` (basic types like inspect)    | ✅      | ⚠️    | ⚠️         |
| `console`                            | ✅      | ✅   | ✅        |
| `setTimeout`, `setInterval`          | ✅      | ✅   | ✅        |
| `queueMicrotask`                     | ✅      | ✅   | ✅        |
| `fs`                                 | ✅      | ❌   | ❌        |
| `child_process`                      | ✅      | ❌   | ❌        |
| `worker_threads`                     | ✅      | ❌   | ❌        |
| `path`                               | ✅      | ❌   | ❌        |
| `os`                                 | ✅      | ❌   | ❌        |
| `net`, `http`, `https`               | ✅      | ⚠️    | ❌        |
| `dgram` (UDP)                        | ✅      | ⚠️    | ❌        |
| `cluster`                            | ✅      | ❌   | ❌        |
| `localStorage`                       | ❌      | ❌   | ❌        |
| `window`, `document`, DOM            | ❌      | ❌   | ❌        |
| `XMLHttpRequest`                     | ❌      | ❌   | ⚠️ (RN bridge) |

Legend:
- ✅ supported, use freely
- ❌ not supported, do not use in core
- ⚠️ partial, different API, or behavioral differences — verify before using

## What this means for core

Use only the ✅ row across all three columns. That's:

- All ES2022 syntax and standard library
- Promises, async iterators
- `Map`, `Set`, TypedArrays, Proxy
- `crypto.subtle` (Web Crypto API) — use this for hashing, encryption, signing
- `fetch` for HTTP (when sync arrives in v0.5, even then prefer Hyperswarm transport)
- `events` for event emitters
- `Buffer` (with the awareness that on Expo it comes via polyfill)
- Timers, console

Anything else: define an interface in `core/src/interfaces/` and let the platform adapters provide it.

## QVAC SDK

`@qvac/sdk` is supported in all three runtimes. On mobile, the SDK embeds its OWN Bare runtime via `react-native-bare-kit` and runs whisper inside it transparently — opennib code never bridges to Bare for AI. From the app's perspective, calls to `loadModel(...)` / `transcribe(...)` look like normal async calls. The Tether team maintains compatibility. Treat the SDK's API as runtime-portable.

The `bare-*` family of packages (`bare-runtime`, `bare-fs`, `bare-buffer`, `bare-stream`, `bare-process`, etc.) typically arrives in mobile builds transitively via `@qvac/sdk` — opennib's mobile package does not need to depend on them directly just to run AI.

## Holepunch stack (Hypercore et al.)

`hypercore`, `hyperswarm`, `autobase`, `corestore` work in Node and Bare. They do NOT work directly in Expo's Hermes context — they need a Node-like runtime. This means:

- **On desktop:** core uses Hypercore directly inside the Electron main process; runs in Node, no extra layer needed.
- **On mobile (v1+):** opennib mobile must host its own Bare worker (via `react-native-bare-kit`) to run Hypercore. The `History` adapter in `mobile/src/adapters/history.ts` forwards to that worker over a small RN ↔ Bare bridge. **This worker is opennib-owned and is separate from the Bare runtime that `@qvac/sdk` embeds for AI.** They are different processes and different concerns. AI never goes through opennib's Bare worker; storage never goes through the SDK's.
- **On mobile (today, pre-v1):** there is no opennib-owned Bare worker yet. `History` is backed by AsyncStorage and is non-syncable. Switching to the Bare-hosted Hypercore implementation is the v1 storage milestone.

The shape of `core/storage/` is the same in both cases — the Hypercore-vs-AsyncStorage choice happens entirely in the platform `History` adapter, so core code does not change between v0.x and v1+ on mobile.

## Common pitfalls

**"I just need the file path."**

You don't need `path`. Core gets the base directory through the `Storage` interface and uses string concatenation:

```ts
// ❌ wrong (Node-only)
import { join } from "path"
const dir = join(storage.baseDirectory(), "history.hypercore")

// ✅ correct (works everywhere)
const dir = `${storage.baseDirectory()}/history.hypercore`
```

For windows compatibility, the desktop adapter normalizes its `baseDirectory()` return value to use forward slashes. core never thinks about path separators.

**"I just need to read a file."**

Core does not read files directly. Hypercore handles its own files via the storage path you provide. If you find yourself wanting `fs.readFile` in core, you're either bypassing Hypercore (don't) or doing platform-specific work that belongs in the adapter.

**"I just need an HTTP request."**

Use the global `fetch`. It exists in all three runtimes. Don't import `http` from Node.

**"I just need a hash."**

Use `crypto.subtle.digest`, not `crypto.createHash`. Both produce the same output (SHA-256, etc.), but `crypto.subtle` is the only one that works everywhere.

```ts
// ❌ wrong (Node-only)
import { createHash } from "crypto"
const hash = createHash("sha256").update(data).digest("hex")

// ✅ correct (works everywhere)
const buf = await crypto.subtle.digest("SHA-256", data)
const hash = Array.from(new Uint8Array(buf))
  .map(b => b.toString(16).padStart(2, "0"))
  .join("")
```

**"I just need to spawn a process."**

You can't. Mobile platforms don't allow it, and Bare doesn't expose it. If a feature requires a child process, it's a desktop-only feature and belongs in the platform package, not core.

## Updating this matrix

This file is maintained by hand. If you discover something marked ✅ here that breaks in Bare or Expo, update the table and add a note. The cost of a stale matrix is broken builds in the runtime nobody tests locally — and that's usually mobile, since desktop dev is faster to iterate.

When in doubt about a specific package or API, check or ask before importing into core.
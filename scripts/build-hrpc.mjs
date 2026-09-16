#!/usr/bin/env node
// Generates the frozen HRPC contract for the core worker into `spec/`.
//
//   node scripts/build-hrpc.mjs
//
// `spec/hyperschema` holds the append-only message registry (hyperschema
// refuses breaking changes to already-published fields); `spec/hrpc` holds
// the generated typed RPC (compact-encoding over bare-rpc). Both are
// COMMITTED — regeneration is only needed when the contract grows.
//
// Error handling: hrpc's generated handler has no try/catch, so a throwing
// handler would hang the caller. Every response therefore embeds an optional
// `error {name, message}` and the thin wrappers in the platform packages
// convert to/from the OpennibError hierarchy (same envelope semantics the
// JSON protocol used).
//
// (Build tooling only — runs under Node. Paths via URL so this file stays
// free of Node-only builtins per the core portability hook.)
import HRPCBuilder from "hrpc"
import Hyperschema from "hyperschema"

const SCHEMA_DIR = new URL("../spec/hyperschema", import.meta.url).pathname
const HRPC_DIR = new URL("../spec/hrpc", import.meta.url).pathname

const schema = Hyperschema.from(SCHEMA_DIR)
const ns = schema.namespace("opennib")

// ── shared structs ──────────────────────────────────────────────────

ns.register({
  name: "rpc-error",
  fields: [
    { name: "name", type: "string", required: true },
    { name: "message", type: "string", required: true },
  ],
})

// Bare acknowledgement — success unless `error` is set.
ns.register({
  name: "ack",
  fields: [{ name: "error", type: "@opennib/rpc-error" }],
})

ns.register({
  name: "empty",
  fields: [],
})

ns.register({
  name: "transcript-entry",
  fields: [
    { name: "id", type: "string", required: true },
    { name: "createdAt", type: "uint", required: true },
    { name: "text", type: "string", required: true },
    { name: "language", type: "string", required: true },
    { name: "durationMs", type: "uint", required: true },
    { name: "app", type: "string" },
  ],
})

ns.register({
  name: "dictionary-entry",
  fields: [
    { name: "id", type: "string", required: true },
    { name: "term", type: "string", required: true },
    { name: "replacement", type: "string" },
    { name: "createdAt", type: "uint", required: true },
  ],
})

// ── requests / responses ────────────────────────────────────────────

ns.register({
  name: "init-request",
  fields: [
    { name: "historyDir", type: "string", required: true },
    { name: "dictionaryDir", type: "string", required: true },
  ],
})

ns.register({
  name: "preload-request",
  fields: [
    { name: "modelPath", type: "string", required: true },
    { name: "language", type: "string", required: true },
  ],
})

// Raw-PCM transcription (desktop route). `samples` is f32le bytes; the
// binary rides compact-encoding natively — no hand-rolled framing.
ns.register({
  name: "transcribe-request",
  fields: [
    { name: "samples", type: "buffer", required: true },
    { name: "sampleRate", type: "uint", required: true },
    { name: "durationMs", type: "uint", required: true },
    { name: "modelPath", type: "string", required: true },
    { name: "language", type: "string", required: true },
  ],
})

// File-path transcription (mobile route — recorder writes a WAV into the
// shared sandbox; samples never cross the RPC boundary).
ns.register({
  name: "transcribe-file-request",
  fields: [
    { name: "wavPath", type: "string", required: true },
    { name: "model", type: "string", required: true },
    { name: "language", type: "string", required: true },
  ],
})

ns.register({
  name: "text-response",
  fields: [
    { name: "error", type: "@opennib/rpc-error" },
    { name: "text", type: "string" },
  ],
})

ns.register({
  name: "model-load-request",
  fields: [
    { name: "model", type: "string", required: true },
    { name: "language", type: "string", required: true },
  ],
})

// `modelPath` absent ⇒ unload the active cleaner (cleanup off).
ns.register({
  name: "cleaner-configure-request",
  fields: [{ name: "modelPath", type: "string" }],
})

ns.register({
  name: "cleanup-request",
  fields: [
    { name: "text", type: "string", required: true },
    { name: "language", type: "string", required: true },
    { name: "terms", type: "@opennib/dictionary-entry", array: true },
  ],
})

ns.register({
  name: "history-append-request",
  fields: [{ name: "entry", type: "@opennib/transcript-entry", required: true }],
})

// `limit` 0 / absent ⇒ no limit; `before` absent ⇒ from the newest entry.
ns.register({
  name: "history-list-request",
  fields: [
    { name: "limit", type: "uint" },
    { name: "before", type: "string" },
  ],
})

ns.register({
  name: "history-list-response",
  fields: [
    { name: "error", type: "@opennib/rpc-error" },
    { name: "entries", type: "@opennib/transcript-entry", array: true },
  ],
})

ns.register({
  name: "dictionary-list-response",
  fields: [
    { name: "error", type: "@opennib/rpc-error" },
    { name: "entries", type: "@opennib/dictionary-entry", array: true },
  ],
})

ns.register({
  name: "dictionary-remove-request",
  fields: [{ name: "id", type: "string", required: true }],
})

// Worker → host push during a model download/load (send-only, no reply).
ns.register({
  name: "model-progress",
  fields: [
    { name: "model", type: "string", required: true },
    { name: "percent", type: "uint", required: true },
  ],
})

Hyperschema.toDisk(schema)

// ── commands ────────────────────────────────────────────────────────
// Registration order assigns command ids — append-only, never reorder.

const builder = HRPCBuilder.from(SCHEMA_DIR, HRPC_DIR)
const rpc = builder.namespace("opennib")

const command = (name, request, response = "@opennib/ack") =>
  rpc.register({
    name,
    request: { name: request, stream: false },
    response: { name: response, stream: false },
  })

command("init", "@opennib/init-request")
command("shutdown", "@opennib/empty")
command("transcriber-preload", "@opennib/preload-request")
command("transcribe", "@opennib/transcribe-request", "@opennib/text-response")
command("transcriber-unload-all", "@opennib/empty")
command("transcribe-file", "@opennib/transcribe-file-request", "@opennib/text-response")
command("model-load", "@opennib/model-load-request")
command("cleaner-configure", "@opennib/cleaner-configure-request")
command("cleaner-cleanup", "@opennib/cleanup-request", "@opennib/text-response")
command("history-append", "@opennib/history-append-request")
command("history-list", "@opennib/history-list-request", "@opennib/history-list-response")
command("history-clear", "@opennib/empty")
command("dictionary-list", "@opennib/empty", "@opennib/dictionary-list-response")
command("dictionary-add", "@opennib/dictionary-entry")
command("dictionary-remove", "@opennib/dictionary-remove-request")
command("dictionary-clear", "@opennib/empty")

rpc.register({
  name: "model-progress",
  request: { name: "@opennib/model-progress", send: true },
})

HRPCBuilder.toDisk(builder)

console.log(`hrpc contract generated → ${HRPC_DIR}`)

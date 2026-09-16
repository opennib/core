// Hand-written type surface for the generated (untyped) HRPC client/server in
// `spec/hrpc/index.js`. The generated file is JavaScript with no `.d.ts`, and
// `spec/` is deliberately kept out of the TypeScript build, so consumers type
// the `@opennib/core/hrpc` import through an ambient `declare module` that
// mirrors this file.
//
// This file is the CANONICAL copy of that declaration. It is NOT wired into a
// tsconfig itself (a package can't reach across the package boundary into
// another package's `spec/`), so each consuming package (desktop, mobile)
// carries its own ambient `declare module "@opennib/core/hrpc"` block that
// reproduces the shapes below, reusing `TranscriptEntry` / `DictionaryEntry`
// from `@opennib/core`. Keep those blocks in sync with this file when the
// contract grows (regenerate via `npm run build:hrpc`).
//
// Every command method resolves to a response object whose `error` is either
// `null` (success) or `{ name, message }` (a worker-side failure that the
// platform client rehydrates into the matching `OpennibError` via
// `rehydrateError` from `@opennib/core/rpc`). A throwing handler HANGS the
// caller, so worker handlers never throw — they return the error envelope.

import type { DictionaryEntry, TranscriptEntry } from "@opennib/core"

/** `{ name, message }` on failure, `null` on success. Set on every response. */
export interface HrpcError {
  readonly name: string
  readonly message: string
}

/** Bare acknowledgement — success unless `error` is set. */
export interface HrpcAck {
  readonly error: HrpcError | null
}

export interface HrpcInitRequest {
  readonly historyDir: string
  readonly dictionaryDir: string
}

export interface HrpcPreloadRequest {
  readonly modelPath: string
  readonly language: string
}

/**
 * Decoded `samples` is an UNALIGNED subarray view into the RPC frame — copy it
 * (`new Uint8Array(req.samples)`) before constructing a `Float32Array` view.
 */
export interface HrpcTranscribeRequest {
  readonly samples: Uint8Array
  readonly sampleRate: number
  readonly durationMs: number
  readonly modelPath: string
  readonly language: string
}

export interface HrpcTranscribeFileRequest {
  readonly wavPath: string
  readonly model: string
  readonly language: string
}

/** `text` is `null` when absent (optional struct field). */
export interface HrpcTextResponse {
  readonly error: HrpcError | null
  readonly text: string | null
}

export interface HrpcModelLoadRequest {
  readonly model: string
  readonly language: string
}

/** `modelPath: null` unloads the active cleaner (cleanup off). */
export interface HrpcCleanerConfigureRequest {
  readonly modelPath: string | null
}

export interface HrpcCleanupRequest {
  readonly text: string
  readonly language: string
  readonly terms: readonly DictionaryEntry[] | null
}

export interface HrpcHistoryAppendRequest {
  readonly entry: TranscriptEntry
}

/** `limit` 0/null ⇒ no limit; `before` null ⇒ from the newest entry. */
export interface HrpcHistoryListRequest {
  readonly limit: number | null
  readonly before: string | null
}

export interface HrpcHistoryListResponse {
  readonly error: HrpcError | null
  readonly entries: readonly TranscriptEntry[] | null
}

export interface HrpcDictionaryListResponse {
  readonly error: HrpcError | null
  readonly entries: readonly DictionaryEntry[] | null
}

export interface HrpcDictionaryRemoveRequest {
  readonly id: string
}

/** Send-only worker → host push (fire-and-forget, no reply). */
export interface HrpcModelProgress {
  readonly model: string
  readonly percent: number
}

export type HrpcHandler<Req, Res> = (req: Req) => Promise<Res>

/**
 * Generated typed RPC over a duplex stream. Client calls the camelCase command
 * methods; the peer registers matching `on…` handlers. Symmetric — either end
 * may act as client, server, or both (mobile registers handlers AND sends the
 * `modelProgress` event).
 */
export declare class HRPC {
  constructor(stream: unknown)

  // ── client calls ──────────────────────────────────────────────────
  init(args: HrpcInitRequest): Promise<HrpcAck>
  shutdown(args: Record<string, never>): Promise<HrpcAck>
  transcriberPreload(args: HrpcPreloadRequest): Promise<HrpcAck>
  transcribe(args: HrpcTranscribeRequest): Promise<HrpcTextResponse>
  transcriberUnloadAll(args: Record<string, never>): Promise<HrpcAck>
  transcribeFile(args: HrpcTranscribeFileRequest): Promise<HrpcTextResponse>
  modelLoad(args: HrpcModelLoadRequest): Promise<HrpcAck>
  cleanerConfigure(args: HrpcCleanerConfigureRequest): Promise<HrpcAck>
  cleanerCleanup(args: HrpcCleanupRequest): Promise<HrpcTextResponse>
  historyAppend(args: HrpcHistoryAppendRequest): Promise<HrpcAck>
  historyList(args: HrpcHistoryListRequest): Promise<HrpcHistoryListResponse>
  historyClear(args: Record<string, never>): Promise<HrpcAck>
  dictionaryList(args: Record<string, never>): Promise<HrpcDictionaryListResponse>
  dictionaryAdd(args: DictionaryEntry): Promise<HrpcAck>
  dictionaryRemove(args: HrpcDictionaryRemoveRequest): Promise<HrpcAck>
  dictionaryClear(args: Record<string, never>): Promise<HrpcAck>

  /** Send-only event (fire-and-forget, no reply). */
  modelProgress(args: HrpcModelProgress): void

  // ── server handler registration ───────────────────────────────────
  onInit(fn: HrpcHandler<HrpcInitRequest, HrpcAck>): void
  onShutdown(fn: HrpcHandler<Record<string, never> | null, HrpcAck>): void
  onTranscriberPreload(fn: HrpcHandler<HrpcPreloadRequest, HrpcAck>): void
  onTranscribe(fn: HrpcHandler<HrpcTranscribeRequest, HrpcTextResponse>): void
  onTranscriberUnloadAll(fn: HrpcHandler<Record<string, never> | null, HrpcAck>): void
  onTranscribeFile(fn: HrpcHandler<HrpcTranscribeFileRequest, HrpcTextResponse>): void
  onModelLoad(fn: HrpcHandler<HrpcModelLoadRequest, HrpcAck>): void
  onCleanerConfigure(fn: HrpcHandler<HrpcCleanerConfigureRequest, HrpcAck>): void
  onCleanerCleanup(fn: HrpcHandler<HrpcCleanupRequest, HrpcTextResponse>): void
  onHistoryAppend(fn: HrpcHandler<HrpcHistoryAppendRequest, HrpcAck>): void
  onHistoryList(fn: HrpcHandler<HrpcHistoryListRequest, HrpcHistoryListResponse>): void
  onHistoryClear(fn: HrpcHandler<Record<string, never> | null, HrpcAck>): void
  onDictionaryList(fn: HrpcHandler<Record<string, never> | null, HrpcDictionaryListResponse>): void
  onDictionaryAdd(fn: HrpcHandler<DictionaryEntry, HrpcAck>): void
  onDictionaryRemove(fn: HrpcHandler<HrpcDictionaryRemoveRequest, HrpcAck>): void
  onDictionaryClear(fn: HrpcHandler<Record<string, never> | null, HrpcAck>): void

  /** Received `modelProgress` pushes (send-only handler, returns nothing). */
  onModelProgress(fn: (req: HrpcModelProgress) => void | Promise<void>): void
}

export default HRPC

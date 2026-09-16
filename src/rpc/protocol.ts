import {
  CleanupError,
  ModelLoadError,
  NotFoundError,
  OpennibError,
  StorageError,
  TranscriptionError,
  ValidationError,
} from "../errors.js"

/**
 * Error rehydration for the core worker RPC.
 *
 * The wire contract itself is the generated HRPC in `spec/hrpc` (compact-
 * encoding over bare-rpc, built by `scripts/build-hrpc.mjs`): typed request /
 * response structs, imported as `@opennib/core/hrpc` on both ends. Every
 * response carries an optional `error {name, message}` because the generated
 * handler has no try/catch — a throwing handler would hang the caller — so
 * worker handlers return the error envelope instead of throwing, and the
 * platform clients turn it back into the matching `OpennibError` subclass here
 * so `instanceof` branching works exactly as it did when the engines ran
 * in-process.
 *
 * This module is pure and runtime-portable (no wire codecs live here anymore);
 * both platform clients import `rehydrateError`.
 */

const ERROR_CLASSES: Readonly<Record<string, new (message: string) => OpennibError>> = {
  TranscriptionError,
  CleanupError,
  StorageError,
  ValidationError,
  ModelLoadError,
  NotFoundError,
}

/**
 * Turn a worker error envelope (`{name, message}`) back into the matching
 * `OpennibError` subclass. Unknown names fall back to a plain `OpennibError`
 * carrying the original name in its message.
 */
export function rehydrateError(name: string, message: string): OpennibError {
  const Klass = ERROR_CLASSES[name]
  if (Klass !== undefined) return new Klass(message)
  return new OpennibError(`${name}: ${message}`)
}

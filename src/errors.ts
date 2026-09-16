/**
 * Typed error hierarchy for opennib.
 *
 * All domain failures extend `OpennibError`. The `cause` argument is forwarded
 * to the native ES2022 `Error.cause`, so `error.cause` works without us
 * tracking it manually.
 */

export class OpennibError extends Error {
  override readonly name: string

  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined)
    this.name = new.target.name
  }
}

export class TranscriptionError extends OpennibError {}
export class CleanupError extends OpennibError {}
export class StorageError extends OpennibError {}
export class ValidationError extends OpennibError {}
export class ModelLoadError extends OpennibError {}
export class HotkeyError extends OpennibError {}
export class PasterError extends OpennibError {}
export class PermissionError extends OpennibError {}
export class NotFoundError extends OpennibError {}
export class RecorderError extends OpennibError {}

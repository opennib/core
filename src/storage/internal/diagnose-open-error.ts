/**
 * Build a human-readable open-failure message for a Hypercore-backed adapter.
 *
 * `hypercore-storage` opens `${storagePath}/CORESTORE` via `device-file` and
 * takes an exclusive `fd-lock` on it. When a second process tries to open the
 * same path, the lock attempt fails with "File descriptor could not be locked"
 * — a cryptic message that doesn't name its actual cause (another opennib
 * process is alive against the same user-data-dir).
 *
 * This helper preserves the lazy single-flight `open()` flow (we still throw),
 * but produces a top-line message that names the likely fix so logs are
 * actionable without digging into hypercore-storage internals.
 */
export function diagnoseOpenError(
  scope: string,
  storagePath: string,
  cause: unknown,
): string {
  const generic = `failed to open ${scope} hypercore`
  const text = errorText(cause)
  if (/File descriptor could not be locked|fd-?lock/i.test(text)) {
    return (
      `${generic}: another opennib process already holds the corestore lock ` +
      `at ${storagePath} (CORESTORE fd-lock). Check for a stale dev process ` +
      `against the same user-data-dir and kill it.`
    )
  }
  return generic
}

function errorText(cause: unknown): string {
  if (cause instanceof Error) {
    const chained = cause.cause === undefined ? "" : ` ${errorText(cause.cause)}`
    return `${cause.message}${chained}`
  }
  return String(cause)
}

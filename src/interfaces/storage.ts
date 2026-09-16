/**
 * Provides the platform-specific data directory where Hypercore (and any
 * device-local stores) put their files. core/storage code uses string
 * concatenation on this value so it does NOT need `node:path`.
 *
 * Platform adapters resolve to:
 *   macOS:   `~/Library/Application Support/opennib/`
 *   Linux:   `~/.config/opennib/`
 *   Windows: `%APPDATA%/opennib/`
 *   iOS:     app sandbox `Library/Application Support/`
 *   Android: app sandbox internal storage
 *
 * The returned path uses forward slashes on all platforms (Windows adapters
 * normalize). core never thinks about path separators.
 */
export interface Storage {
  baseDirectory(): string
}

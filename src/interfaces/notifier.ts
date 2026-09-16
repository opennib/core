/**
 * Posts a system notification — used for "transcription failed", "model
 * downloaded", etc.
 *
 * Platform adapters: Electron's `Notification` on desktop, `expo-notifications`
 * on mobile.
 */
export interface Notifier {
  notify(title: string, body: string): Promise<void>
}

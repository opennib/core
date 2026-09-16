/**
 * Push-to-talk needs both keydown and keyup, which Electron's built-in
 * `globalShortcut` does not provide. Platform adapters use:
 *   macOS:        native Swift `fn-key-monitor` (handles the Fn key too)
 *   Win / Linux:  `node-global-key-listener`
 *   mobile:       no global hotkey — replaced by an in-app or keyboard button
 */

export interface HotkeyHandlers {
  onPress(): void
  onRelease(): void
}

export interface Hotkey {
  register(combo: string, handlers: HotkeyHandlers): Promise<void>
  unregister(combo: string): Promise<void>
}

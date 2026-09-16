/**
 * Inserts text into the currently focused application or text field.
 *
 * Platform adapters: macOS uses a native Swift `paste-helper` binary +
 * Electron's clipboard; Windows/Linux use `nut-js`; mobile uses the keyboard
 * extension (iOS) or IME (Android).
 */
export interface Paster {
  paste(text: string): Promise<void>
}

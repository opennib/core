/**
 * OS permission state for capabilities the app needs.
 *
 * On macOS, accessibility permission is required for the global hotkey
 * listener and the paste-helper. On other platforms, `accessibility` is
 * undefined.
 */

export type PermissionState = "granted" | "denied" | "undetermined"

export interface Permissions {
  microphone(): Promise<PermissionState>
  requestMicrophone(): Promise<PermissionState>
  accessibility?(): Promise<PermissionState>
  requestAccessibility?(): Promise<PermissionState>
}

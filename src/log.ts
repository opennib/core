/**
 * Runtime-portable logger for opennib core.
 *
 * Routes through `console.*` so it works under Node, Bare, and Hermes.
 * This module is the ONLY file in core/ allowed to use `console.*` directly
 * (enforced by .claude/hooks/check-package-boundaries.mjs).
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function readLevelFromEnv(): LogLevel | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env
  if (!env) return undefined
  const raw = env.OPENNIB_LOG_LEVEL?.toLowerCase()
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw
  return undefined
}

let currentLevel: LogLevel = readLevelFromEnv() ?? "info"

export function setLogLevel(level: LogLevel): void {
  currentLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLevel
}

function enabled(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel]
}

function emit(
  consoleMethod: (...args: unknown[]) => void,
  message: string,
  data: unknown,
): void {
  if (data === undefined) consoleMethod(message)
  else consoleMethod(message, data)
}

export const log = {
  debug(message: string, data?: unknown): void {
    if (!enabled("debug")) return
    emit(console.debug.bind(console), message, data)
  },
  info(message: string, data?: unknown): void {
    if (!enabled("info")) return
    emit(console.info.bind(console), message, data)
  },
  warn(message: string, data?: unknown): void {
    if (!enabled("warn")) return
    emit(console.warn.bind(console), message, data)
  },
  error(message: string, data?: unknown): void {
    if (!enabled("error")) return
    emit(console.error.bind(console), message, data)
  },
} as const

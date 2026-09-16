import test from "brittle"

import { getLogLevel, log, setLogLevel, type LogLevel } from "../src/log.js"

// brittle has no vi.spyOn, so we swap console.{debug,info,warn,error} for
// recording functions and restore them via t.teardown. Each test resets the
// log level to "debug" up front and restores the prior level on teardown.

interface Spies {
  info: unknown[][]
  warn: unknown[][]
  error: unknown[][]
  debug: unknown[][]
}

type ConsoleMethod = (...args: unknown[]) => void

function setup(t: { teardown(fn: () => void | Promise<void>): void }): Spies {
  const spies: Spies = { info: [], warn: [], error: [], debug: [] }
  const original = {
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  }
  const record =
    (bucket: unknown[][]): ConsoleMethod =>
    (...args: unknown[]) => {
      bucket.push(args)
    }
  console.info = record(spies.info)
  console.warn = record(spies.warn)
  console.error = record(spies.error)
  console.debug = record(spies.debug)

  const priorLevel = getLogLevel()
  setLogLevel("debug")

  t.teardown(() => {
    console.info = original.info
    console.warn = original.warn
    console.error = original.error
    console.debug = original.debug
    setLogLevel(priorLevel)
  })

  return spies
}

test("log routing: routes log.info to console.info", (t) => {
  const spies = setup(t)
  log.info("hello")
  t.is(spies.info.length, 1)
  t.alike(spies.info[0], ["hello"])
})

test("log routing: routes log.warn to console.warn", (t) => {
  const spies = setup(t)
  log.warn("careful")
  t.is(spies.warn.length, 1)
  t.alike(spies.warn[0], ["careful"])
})

test("log routing: routes log.error to console.error", (t) => {
  const spies = setup(t)
  log.error("boom")
  t.is(spies.error.length, 1)
  t.alike(spies.error[0], ["boom"])
})

test("log routing: routes log.debug to console.debug", (t) => {
  const spies = setup(t)
  log.debug("trace")
  t.is(spies.debug.length, 1)
  t.alike(spies.debug[0], ["trace"])
})

test("log routing: does not cross-fire (info does not reach warn/error/debug)", (t) => {
  const spies = setup(t)
  log.info("hello")
  t.is(spies.warn.length, 0)
  t.is(spies.error.length, 0)
  t.is(spies.debug.length, 0)
})

test("log structured data: forwards a plain object as the second arg", (t) => {
  const spies = setup(t)
  log.info("started", { duration: 1234 })
  t.alike(spies.info[0], ["started", { duration: 1234 }])
})

test("log structured data: forwards an Error object intact (no stringification)", (t) => {
  const spies = setup(t)
  const err = new Error("network down")
  log.error("save failed", err)
  t.alike(spies.error[0], ["save failed", err])
  t.is(spies.error[0]?.[1], err)
})

test("log structured data: omits the second arg when data is undefined", (t) => {
  const spies = setup(t)
  log.info("solo")
  t.alike(spies.info[0], ["solo"])
  t.is(spies.info[0]?.length, 1)
})

test("log structured data: forwards null as a value (does not coerce to undefined)", (t) => {
  const spies = setup(t)
  log.info("with-null", null)
  t.alike(spies.info[0], ["with-null", null])
  t.is(spies.info[0]?.length, 2)
})

test("log level filtering: suppresses debug at info level", (t) => {
  const spies = setup(t)
  setLogLevel("info")
  log.debug("trace")
  t.is(spies.debug.length, 0)
})

test("log level filtering: suppresses info at warn level", (t) => {
  const spies = setup(t)
  setLogLevel("warn")
  log.info("hello")
  log.warn("careful")
  t.is(spies.info.length, 0)
  t.is(spies.warn.length, 1)
})

test("log level filtering: suppresses warn at error level but error still fires", (t) => {
  const spies = setup(t)
  setLogLevel("error")
  log.warn("careful")
  log.error("boom")
  t.is(spies.warn.length, 0)
  t.is(spies.error.length, 1)
})

test("log level filtering: does not suppress error at any level", (t) => {
  const spies = setup(t)
  const levels: LogLevel[] = ["debug", "info", "warn", "error"]
  for (const level of levels) {
    spies.error.length = 0
    setLogLevel(level)
    log.error("critical")
    t.is(spies.error.length, 1)
  }
})

test("log level filtering: getLogLevel reflects setLogLevel", (t) => {
  setup(t)
  setLogLevel("warn")
  t.is(getLogLevel(), "warn")
  setLogLevel("debug")
  t.is(getLogLevel(), "debug")
})

test("log portability: does not throw if console is replaced after module load", (t) => {
  // Simulates Bare/Hermes where the console object may differ subtly.
  // Bound methods are captured at call time, so spying still works.
  const spies = setup(t)
  log.info("ok")
  t.is(spies.info.length, 1)
})

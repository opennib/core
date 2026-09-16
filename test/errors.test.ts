import test from "brittle"

import {
  CleanupError,
  HotkeyError,
  ModelLoadError,
  NotFoundError,
  OpennibError,
  PasterError,
  PermissionError,
  RecorderError,
  StorageError,
  TranscriptionError,
  ValidationError,
} from "../src/errors.js"

test("OpennibError is an instance of Error", (t) => {
  const err = new OpennibError("base failure")
  t.ok(err instanceof Error)
  t.ok(err instanceof OpennibError)
})

test("OpennibError preserves the message", (t) => {
  const err = new OpennibError("oh no")
  t.is(err.message, "oh no")
})

test("OpennibError sets name to OpennibError when constructed directly", (t) => {
  const err = new OpennibError("x")
  t.is(err.name, "OpennibError")
})

test("OpennibError sets name to the SUBCLASS name when subclassed", (t) => {
  const err = new TranscriptionError("whisper failed")
  t.is(err.name, "TranscriptionError")
  t.ok(err instanceof TranscriptionError)
  t.ok(err instanceof OpennibError)
  t.ok(err instanceof Error)
})

test("OpennibError forwards cause via native ES2022 Error.cause", (t) => {
  const root = new Error("root cause")
  const wrapper = new ModelLoadError("Failed to load whisper", root)
  t.is(wrapper.cause, root)
})

test("OpennibError leaves cause undefined when not provided", (t) => {
  const err = new ValidationError("bad input")
  t.is(err.cause, undefined)
})

test("OpennibError captures non-Error values as cause (object)", (t) => {
  const err = new StorageError("save failed", { kind: "disk-full" })
  t.alike(err.cause, { kind: "disk-full" })
})

test("OpennibError captures non-Error values as cause (string)", (t) => {
  const err = new StorageError("save failed", "disk full")
  t.is(err.cause, "disk full")
})

test("OpennibError captures non-Error values as cause (null is preserved as a value)", (t) => {
  // Caller passes `null` explicitly — it's stored as the cause.
  const err = new StorageError("save failed", null)
  t.is(err.cause, null)
})

test("subclass instances are distinct under instanceof", (t) => {
  const a = new HotkeyError("hk")
  const b = new PasterError("ps")
  t.ok(!(a instanceof PasterError))
  t.ok(!(b instanceof HotkeyError))
})

test("each domain subclass exists and reports its own name", (t) => {
  const subclasses = [
    ["TranscriptionError", TranscriptionError],
    ["CleanupError", CleanupError],
    ["StorageError", StorageError],
    ["ValidationError", ValidationError],
    ["ModelLoadError", ModelLoadError],
    ["HotkeyError", HotkeyError],
    ["PasterError", PasterError],
    ["PermissionError", PermissionError],
    ["NotFoundError", NotFoundError],
    ["RecorderError", RecorderError],
  ] as const
  for (const [name, SubClass] of subclasses) {
    const err = new SubClass("test")
    t.ok(err instanceof OpennibError, `${name} instanceof OpennibError`)
    t.ok(err instanceof Error, `${name} instanceof Error`)
    t.is(err.name, name)
    t.is(err.message, "test")
  }
})

test("captures a stack trace", (t) => {
  const err = new TranscriptionError("oops")
  t.ok(err.stack !== undefined)
  t.is(typeof err.stack, "string")
  t.ok((err.stack ?? "").includes("TranscriptionError"))
})

test("supports cause chains (wrap a wrap)", (t) => {
  const root = new Error("disk-io")
  const mid = new StorageError("write failed", root)
  const top = new TranscriptionError("could not persist transcript", mid)
  t.is(top.cause, mid)
  t.is((top.cause as StorageError).cause, root)
})

test("can be re-thrown and caught as the base type", async (t) => {
  const inner = new ValidationError("bad")
  await t.exception(() => {
    throw inner
  }, /bad/)
  try {
    throw inner
  } catch (err) {
    t.ok(err instanceof OpennibError)
  }
})

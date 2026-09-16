import test from "brittle"

import { OpennibError, TranscriptionError } from "../src/errors.js"
import { rehydrateError } from "../src/rpc/protocol.js"

test("rpc-protocol: rehydrates the matching OpennibError subclass", (t) => {
  const err = rehydrateError("TranscriptionError", "model exploded")
  t.ok(err instanceof TranscriptionError)
  t.is(err.message, "model exploded")
})

test("rpc-protocol: unknown error names fall back to OpennibError", (t) => {
  const err = rehydrateError("RangeError", "out of range")
  t.ok(err instanceof OpennibError)
  t.absent(err instanceof TranscriptionError)
  t.ok(err.message.includes("RangeError"))
  t.ok(err.message.includes("out of range"))
})

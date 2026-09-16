import test from "brittle"

import { cleanupText } from "../src/cleanup.js"
import { MAX_TRANSCRIPT_LENGTH } from "../src/config/constants.js"
import { CleanupError, ModelLoadError, ValidationError } from "../src/errors.js"
import type { Cleaner } from "../src/interfaces/index.js"
import type { DictionaryEntry } from "../src/types.js"

interface RecordingCleaner extends Cleaner {
  /** Each entry is the exact argument list `cleanup` was invoked with. */
  readonly calls: Array<[string, string, (readonly DictionaryEntry[])?]>
}

function fakeCleaner(
  impl: (
    text: string,
    language: string,
    terms?: readonly DictionaryEntry[],
  ) => string | Promise<string>,
): RecordingCleaner {
  const calls: Array<[string, string, (readonly DictionaryEntry[])?]> = []
  return {
    calls,
    async cleanup(...args: [string, string, (readonly DictionaryEntry[])?]): Promise<string> {
      // Record the exact arity received so tests can assert terms was omitted.
      calls.push(args)
      return impl(args[0], args[1], args[2])
    },
  }
}

test("cleanupText: returns the cleaner's output", async (t) => {
  const cleaner = fakeCleaner(() => "Hello, world.")
  const out = await cleanupText("hello world", { cleaner })
  t.is(out, "Hello, world.")
})

test("cleanupText: trims input whitespace before passing to the cleaner", async (t) => {
  const cleaner = fakeCleaner((text) => text)
  await cleanupText("   hello   ", { cleaner })
  t.alike(cleaner.calls[0], ["hello", "auto"])
})

test("cleanupText: forwards the language to the cleaner; defaults to 'auto'", async (t) => {
  const cleaner = fakeCleaner((text) => text)
  await cleanupText("hi", { cleaner })
  t.alike(cleaner.calls[0], ["hi", "auto"])
  await cleanupText("xin chao", { cleaner, language: "vi" })
  t.alike(cleaner.calls[cleaner.calls.length - 1], ["xin chao", "vi"])
})

test("cleanupText: rejects empty / whitespace-only input with ValidationError", async (t) => {
  const cleaner = fakeCleaner((text) => text)
  try {
    await cleanupText("", { cleaner })
    t.fail("should have thrown")
  } catch (err) {
    t.ok(err instanceof ValidationError)
  }
  try {
    await cleanupText("    ", { cleaner })
    t.fail("should have thrown")
  } catch (err) {
    t.ok(err instanceof ValidationError)
  }
  t.is(cleaner.calls.length, 0)
})

test("cleanupText: rejects input longer than MAX_TRANSCRIPT_LENGTH with ValidationError", async (t) => {
  const cleaner = fakeCleaner((text) => text)
  const huge = "a".repeat(MAX_TRANSCRIPT_LENGTH + 1)
  try {
    await cleanupText(huge, { cleaner })
    t.fail("should have thrown")
  } catch (err) {
    t.ok(err instanceof ValidationError)
  }
})

test("cleanupText: falls back to original trimmed text when cleaner returns empty", async (t) => {
  const cleaner = fakeCleaner(() => "")
  const out = await cleanupText("  hello world  ", { cleaner })
  t.is(out, "hello world")
})

test("cleanupText: falls back when cleaner returns whitespace-only", async (t) => {
  const cleaner = fakeCleaner(() => "   \n  ")
  const out = await cleanupText("hello", { cleaner })
  t.is(out, "hello")
})

test("cleanupText: trims trailing/leading whitespace from cleaner output", async (t) => {
  const cleaner = fakeCleaner(() => "  Hello, world.  \n")
  const out = await cleanupText("hello world", { cleaner })
  t.is(out, "Hello, world.")
})

test("cleanupText: wraps non-OpennibError failures in CleanupError with cause", async (t) => {
  const original = new Error("LLM crashed")
  const cleaner = fakeCleaner(() => {
    throw original
  })
  try {
    await cleanupText("hi", { cleaner })
    t.fail("should have thrown")
  } catch (err) {
    t.ok(err instanceof CleanupError)
    t.is((err as CleanupError).cause, original)
  }
})

test("cleanupText: re-throws OpennibError subclasses unchanged so callers can branch on type", async (t) => {
  const original = new ModelLoadError("LLM model missing")
  const cleaner = fakeCleaner(() => {
    throw original
  })
  try {
    await cleanupText("hi", { cleaner })
    t.fail("should have thrown")
  } catch (err) {
    t.is(err, original)
  }
})

test("cleanupText: forwards dictionary terms to the cleaner when provided", async (t) => {
  const seen: Array<readonly DictionaryEntry[] | undefined> = []
  const cleaner = fakeCleaner((text, _l, terms) => {
    seen.push(terms)
    return text
  })
  const terms: readonly DictionaryEntry[] = [
    { id: "1", term: "opennib", createdAt: 0 },
    { id: "2", term: "QVAC", replacement: "kuvac", createdAt: 0 },
  ]
  await cleanupText("hi", { cleaner, terms })
  t.alike(seen[0], terms)
})

test("cleanupText: does NOT pass terms when omitted (cleaner receives 2 args)", async (t) => {
  const cleaner = fakeCleaner((text) => text)
  await cleanupText("hi", { cleaner })
  t.is(cleaner.calls[0]?.length, 2)
})

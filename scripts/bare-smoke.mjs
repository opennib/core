// Smoke test for the compiled @opennib/core package under the Bare runtime.
//
// Why this exists: vitest runs under Node, but our core code must also work
// under Bare (mobile native worker) and Hermes (Expo). Bare is the lowest
// common denominator — if it works here, it almost certainly works in
// Hermes too.
//
// Run via:  npm run test:bare -w @opennib/core
// Which is: npm run build && bare scripts/bare-smoke.mjs

import {
  DEFAULT_LANGUAGE,
  HotkeyError,
  MAX_AUDIO_DURATION_SECONDS,
  ModelLoadError,
  NotFoundError,
  OpennibError,
  PasterError,
  PermissionError,
  StorageError,
  TranscriptionError,
  ValidationError,
  WHISPER_SAMPLE_RATE_HZ,
  getLogLevel,
  log,
  setLogLevel,
  transcribe,
} from "../dist/index.js"

let pass = 0
let fail = 0
const failures = []

function ok(cond, label) {
  if (cond) {
    pass++
    console.log("  ✓", label)
  } else {
    fail++
    failures.push(label)
    console.error("  ✗", label)
  }
}

console.log("@opennib/core: bare-runtime smoke test\n")

// log
console.log("log:")
ok(typeof log.info === "function", "log.info is a function")
ok(typeof log.warn === "function", "log.warn is a function")
ok(typeof log.error === "function", "log.error is a function")
ok(typeof log.debug === "function", "log.debug is a function")
ok(typeof setLogLevel === "function", "setLogLevel is a function")
ok(typeof getLogLevel === "function", "getLogLevel is a function")

setLogLevel("error") // keep smoke output quiet during the calls below
log.info("suppressed at error level")
log.error("error fires")
setLogLevel("debug")
ok(getLogLevel() === "debug", "getLogLevel reflects setLogLevel")

// errors
console.log("\nerrors:")
const base = new OpennibError("base failure")
ok(base instanceof Error, "OpennibError instanceof Error")
ok(base instanceof OpennibError, "OpennibError instanceof OpennibError")
ok(base.name === "OpennibError", "OpennibError.name === 'OpennibError'")
ok(base.message === "base failure", "OpennibError preserves message")

const subclassPairs = [
  ["TranscriptionError", TranscriptionError],
  ["StorageError", StorageError],
  ["ValidationError", ValidationError],
  ["ModelLoadError", ModelLoadError],
  ["HotkeyError", HotkeyError],
  ["PasterError", PasterError],
  ["PermissionError", PermissionError],
  ["NotFoundError", NotFoundError],
]
for (const [name, Klass] of subclassPairs) {
  const e = new Klass("smoke")
  ok(e instanceof OpennibError, `${name} instanceof OpennibError`)
  ok(e instanceof Error, `${name} instanceof Error`)
  ok(e.name === name, `${name}.name === '${name}'`)
}

const root = new Error("root cause")
const wrapped = new ModelLoadError("wrap", root)
ok(wrapped.cause === root, "ModelLoadError forwards cause via Error.cause")

const wrappedTwice = new TranscriptionError("outer", new StorageError("inner", root))
ok(
  wrappedTwice.cause instanceof StorageError && wrappedTwice.cause.cause === root,
  "cause chains survive nesting",
)

const noCause = new ValidationError("bad input")
ok(noCause.cause === undefined, "cause undefined when not provided")

// constants
console.log("\nconstants:")
ok(WHISPER_SAMPLE_RATE_HZ === 16000, "WHISPER_SAMPLE_RATE_HZ === 16000")
ok(MAX_AUDIO_DURATION_SECONDS === 60, "MAX_AUDIO_DURATION_SECONDS === 60")
ok(DEFAULT_LANGUAGE === "auto", "DEFAULT_LANGUAGE === 'auto'")

// runtime sanity (Bare-specific)
console.log("\nruntime:")
ok(typeof Float32Array === "function", "Float32Array is available (needed for AudioFrame)")
ok(typeof Promise === "function", "Promise is available")
ok(typeof Buffer === "function", "Buffer is available (needed by hypercore)")

// transcribe — exercise the orchestration end-to-end under Bare with fakes
// so we know the code path (not just the export) actually runs.
console.log("\ntranscribe:")
ok(typeof transcribe === "function", "transcribe is a function")

const fakeFrame = {
  samples: new Float32Array(16000),
  sampleRate: 16000,
  durationMs: 1000,
}
const fakeModelManager = {
  isInstalled: async (id) => id === "whisper-base",
  download: async () => {},
  pathFor: async (id) => `/fake/${id}.bin`,
  remove: async () => {},
}
const fakeTranscriber = {
  lastCall: null,
  async transcribe(frame, modelPath, language) {
    this.lastCall = { frame, modelPath, language }
    return "hello from bare"
  },
}

try {
  const text = await transcribe(fakeFrame, {
    transcriber: fakeTranscriber,
    modelManager: fakeModelManager,
    modelId: "whisper-base",
  })
  ok(text === "hello from bare", "transcribe returns text from injected transcriber")
  ok(fakeTranscriber.lastCall?.language === "auto", "transcribe defaults language to 'auto'")
  ok(
    fakeTranscriber.lastCall?.modelPath === "/fake/whisper-base.bin",
    "transcribe forwards modelPath from ModelManager",
  )
} catch (err) {
  ok(false, `transcribe happy path threw: ${err?.message ?? err}`)
}

try {
  await transcribe({ ...fakeFrame, sampleRate: 44100 }, {
    transcriber: fakeTranscriber,
    modelManager: fakeModelManager,
    modelId: "whisper-base",
  })
  ok(false, "transcribe should reject non-16kHz frames with ValidationError")
} catch (err) {
  ok(err instanceof ValidationError, "transcribe rejects bad sampleRate with ValidationError")
}

try {
  await transcribe(fakeFrame, {
    transcriber: fakeTranscriber,
    modelManager: fakeModelManager,
    modelId: "not-installed",
  })
  ok(false, "transcribe should reject uninstalled models with ModelLoadError")
} catch (err) {
  ok(err instanceof ModelLoadError, "transcribe rejects uninstalled model with ModelLoadError")
}

// summary
console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) {
  console.error("\nFailures:")
  for (const f of failures) console.error("  -", f)
  Bare.exit(1)
}
Bare.exit(0)

import test from "brittle"

import type { AudioFrame, DictionaryEntry, TranscriptEntry } from "../../src/types.js"
import type {
  Cleaner,
  Dictionary,
  History,
  Hotkey,
  ModelManager,
  Notifier,
  Paster,
  PermissionState,
  Permissions,
  Recorder,
  Settings,
  SettingsSnapshot,
  Storage,
} from "../../src/interfaces/index.js"

// These are type-only contracts. vitest's `expectTypeOf` is a compile-time
// assertion with no runtime effect, and brittle can't provide it. We encode
// the same contracts as `Expect<Equal<...>>` type-level checks that fail the
// `tsc` compile when a type drifts, then record a passing runtime assertion so
// the suite reports coverage for each contract.

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

test("core interfaces: Recorder.start returns Promise<void>", (t) => {
  type _ = Expect<Equal<ReturnType<Recorder["start"]>, Promise<void>>>
  t.pass()
})

test("core interfaces: Recorder.stop returns Promise<AudioFrame>", (t) => {
  type _ = Expect<Equal<ReturnType<Recorder["stop"]>, Promise<AudioFrame>>>
  t.pass()
})

test("core interfaces: AudioFrame has 16-bit-friendly Float32Array samples", (t) => {
  type _S = Expect<Equal<AudioFrame["samples"], Float32Array>>
  type _R = Expect<Equal<AudioFrame["sampleRate"], number>>
  type _D = Expect<Equal<AudioFrame["durationMs"], number>>
  t.pass()
})

test("core interfaces: Paster.paste accepts a string and returns Promise<void>", (t) => {
  type _P = Expect<Equal<Parameters<Paster["paste"]>, [string]>>
  type _R = Expect<Equal<ReturnType<Paster["paste"]>, Promise<void>>>
  t.pass()
})

test("core interfaces: Storage.baseDirectory returns string (no async)", (t) => {
  type _ = Expect<Equal<ReturnType<Storage["baseDirectory"]>, string>>
  t.pass()
})

test("core interfaces: Notifier.notify takes (title, body): two strings", (t) => {
  type _P = Expect<Equal<Parameters<Notifier["notify"]>, [string, string]>>
  type _R = Expect<Equal<ReturnType<Notifier["notify"]>, Promise<void>>>
  t.pass()
})

test("core interfaces: Hotkey.register handlers expose onPress and onRelease", (t) => {
  type Handlers = Parameters<Hotkey["register"]>[1]
  type _On = Expect<Equal<Handlers["onPress"], () => void>>
  type _Off = Expect<Equal<Handlers["onRelease"], () => void>>
  t.pass()
})

test("core interfaces: ModelManager covers full install/use/remove lifecycle", (t) => {
  type _I = Expect<Equal<Parameters<ModelManager["isInstalled"]>, [string]>>
  type _IR = Expect<Equal<ReturnType<ModelManager["isInstalled"]>, Promise<boolean>>>
  type _P = Expect<Equal<ReturnType<ModelManager["pathFor"]>, Promise<string>>>
  type _R = Expect<Equal<ReturnType<ModelManager["remove"]>, Promise<void>>>
  t.pass()
})

test("core interfaces: ModelManager.download accepts an optional progress callback", (t) => {
  type Args = Parameters<ModelManager["download"]>
  type _ = Expect<Equal<Args, [string, ((percent: number) => void)?]>>
  t.pass()
})

test("core interfaces: Permissions.microphone resolves a state literal union", (t) => {
  type _M = Expect<Equal<ReturnType<Permissions["microphone"]>, Promise<PermissionState>>>
  type _S = Expect<Equal<PermissionState, "granted" | "denied" | "undetermined">>
  t.pass()
})

test("core interfaces: Permissions.accessibility is optional (macOS only)", (t) => {
  // Optional → the property type itself includes undefined.
  type Acc = Permissions["accessibility"]
  type _ = Expect<Equal<Acc, (() => Promise<PermissionState>) | undefined>>
  t.pass()
})

test("core interfaces: History.list returns a readonly array of TranscriptEntry", (t) => {
  type _ = Expect<Equal<ReturnType<History["list"]>, Promise<readonly TranscriptEntry[]>>>
  t.pass()
})

test("core interfaces: Dictionary.list returns a readonly array of DictionaryEntry", (t) => {
  type _ = Expect<Equal<ReturnType<Dictionary["list"]>, Promise<readonly DictionaryEntry[]>>>
  t.pass()
})

test("core interfaces: Cleaner takes (text, language, terms?) and returns Promise<string>", (t) => {
  type _P = Expect<
    Equal<
      Parameters<Cleaner["cleanup"]>,
      [text: string, language: string, terms?: readonly DictionaryEntry[]]
    >
  >
  type _R = Expect<Equal<ReturnType<Cleaner["cleanup"]>, Promise<string>>>
  t.pass()
})

test("core interfaces: TranscriptEntry has the expected required + optional fields", (t) => {
  type _Id = Expect<Equal<TranscriptEntry["id"], string>>
  type _C = Expect<Equal<TranscriptEntry["createdAt"], number>>
  type _T = Expect<Equal<TranscriptEntry["text"], string>>
  type _D = Expect<Equal<TranscriptEntry["durationMs"], number>>
  type _A = Expect<Equal<TranscriptEntry["app"], string | undefined>>
  t.pass()
})

test("core interfaces: Settings exposes sync getters and async setters", (t) => {
  type _W = Expect<Equal<ReturnType<Settings["whisperModelId"]>, string>>
  type _L = Expect<Equal<ReturnType<Settings["language"]>, string>>
  type _SW = Expect<Equal<Parameters<Settings["setWhisperModelId"]>, [string]>>
  type _SWR = Expect<Equal<ReturnType<Settings["setWhisperModelId"]>, Promise<void>>>
  type _SL = Expect<Equal<Parameters<Settings["setLanguage"]>, [string]>>
  type _SLR = Expect<Equal<ReturnType<Settings["setLanguage"]>, Promise<void>>>
  t.pass()
})

test("core interfaces: SettingsSnapshot is a flat readonly view", (t) => {
  type _W = Expect<Equal<SettingsSnapshot["whisperModelId"], string>>
  type _L = Expect<Equal<SettingsSnapshot["language"], string>>
  t.pass()
})

import test from "brittle"

import { DEFAULT_LANGUAGE } from "../../src/config/constants.js"
import { DEFAULT_WHISPER_MODEL_ID } from "../../src/models/whisper.js"
import {
  DEFAULT_SETTINGS_SNAPSHOT,
  parseSettingsSnapshot,
} from "../../src/settings/parse-settings-snapshot.js"

test("parseSettingsSnapshot: returns canonical defaults for non-object input", (t) => {
  t.alike(parseSettingsSnapshot(null), DEFAULT_SETTINGS_SNAPSHOT)
  t.alike(parseSettingsSnapshot(undefined), DEFAULT_SETTINGS_SNAPSHOT)
  t.alike(parseSettingsSnapshot(42), DEFAULT_SETTINGS_SNAPSHOT)
  t.alike(parseSettingsSnapshot("oops"), DEFAULT_SETTINGS_SNAPSHOT)
})

test("parseSettingsSnapshot: defaults pin the model + language to the shared constants", (t) => {
  t.is(DEFAULT_SETTINGS_SNAPSHOT.whisperModelId, DEFAULT_WHISPER_MODEL_ID)
  t.is(DEFAULT_SETTINGS_SNAPSHOT.language, DEFAULT_LANGUAGE)
  t.is(DEFAULT_SETTINGS_SNAPSHOT.cleanupEnabled, false)
  t.is(DEFAULT_SETTINGS_SNAPSHOT.llmModelId, null)
})

test("parseSettingsSnapshot: keeps a fully-valid snapshot as-is", (t) => {
  const input = {
    whisperModelId: "whisper-base",
    language: "fr",
    cleanupEnabled: true,
    llmModelId: "llama-3.2-1b",
  }
  t.alike(parseSettingsSnapshot(input), input)
})

test("parseSettingsSnapshot: ignores host-owned fields that share the persisted blob", (t) => {
  // Desktop/mobile persist their host snapshot alongside the dictation
  // slice in one JSON blob. Core's parser must drop the extras rather than
  // surface them, so the returned snapshot stays exactly the 4-field shape.
  const input = {
    whisperModelId: "small",
    language: "es",
    cleanupEnabled: false,
    llmModelId: null,
    hotkey: "Fn",
    onboardingCompleted: true,
    enabled: false,
  }
  t.alike(parseSettingsSnapshot(input), {
    whisperModelId: "small",
    language: "es",
    cleanupEnabled: false,
    llmModelId: null,
  })
})

test("parseSettingsSnapshot: falls back per field when the value is missing or wrong type", (t) => {
  const partial = { language: "es", cleanupEnabled: "yes please" }
  const result = parseSettingsSnapshot(partial)
  t.is(result.language, "es")
  t.is(result.whisperModelId, DEFAULT_SETTINGS_SNAPSHOT.whisperModelId)
  t.is(result.cleanupEnabled, false)
  t.is(result.llmModelId, null)
})

test("parseSettingsSnapshot: treats empty strings as missing", (t) => {
  const result = parseSettingsSnapshot({
    whisperModelId: "",
    language: "",
    cleanupEnabled: true,
    llmModelId: "",
  })
  t.is(result.whisperModelId, DEFAULT_SETTINGS_SNAPSHOT.whisperModelId)
  t.is(result.language, DEFAULT_SETTINGS_SNAPSHOT.language)
  t.is(result.cleanupEnabled, true)
  t.is(result.llmModelId, null)
})

test("parseSettingsSnapshot: preserves llmModelId=null distinct from a non-string fallback", (t) => {
  t.is(parseSettingsSnapshot({ llmModelId: null }).llmModelId, null)
  t.is(parseSettingsSnapshot({ llmModelId: 7 }).llmModelId, null)
})

test("parseSettingsSnapshot: parses cleanupEnabled only when it is a boolean", (t) => {
  t.is(parseSettingsSnapshot({ cleanupEnabled: true }).cleanupEnabled, true)
  t.is(parseSettingsSnapshot({ cleanupEnabled: false }).cleanupEnabled, false)
  t.is(parseSettingsSnapshot({ cleanupEnabled: "yes" }).cleanupEnabled, false)
  t.is(parseSettingsSnapshot({ cleanupEnabled: 1 }).cleanupEnabled, false)
})

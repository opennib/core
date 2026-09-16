// Aggregate entry point for the brittle test suite: importing every *.test
// file for its side effects (each registers its `test(...)` cases) lets the
// whole suite run in one `bare` process via the compiled `test-dist/test/all.js`.
//
// NEW TEST FILES MUST BE ADDED HERE, or they will not run.

import "./errors.test.js"
import "./transcribe.test.js"
import "./cleanup.test.js"
import "./dictation-pipeline.test.js"
import "./whisper-config.test.js"
import "./whisper-transcriber.test.js"
import "./llm-cleaner.test.js"
import "./log.test.js"
import "./models/whisper.test.js"
import "./models/llm.test.js"
import "./settings/parse-settings-snapshot.test.js"
import "./interfaces/interfaces.test.js"
import "./storage/hypercore-history.test.js"
import "./storage/hypercore-dictionary.test.js"
import "./rpc-protocol.test.js"

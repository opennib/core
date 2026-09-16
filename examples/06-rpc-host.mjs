// Lesson 6 example — the generated HRPC contract, host side (Node, standing
// in for Electron main / the mobile app). Spawns a real Bare worker running
// 06-rpc-worker.mjs, connects it over a unix socket, and drives it through
// the typed client: init → append → list → transcribe → a typed error → shutdown.
//
//   node examples/06-rpc-host.mjs
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import spawn from "bare-runtime/spawn";
import HRPC from "../spec/hrpc/index.js";
import { rehydrateError } from "../dist/rpc/protocol.js";
import { ValidationError } from "../dist/errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "l6-"));
const socketPath = join(dir, "w.sock"); // short: macOS caps socket paths at ~104 bytes

// 1. Listen first, then spawn — the worker connects back to us.
const connected = new Promise((resolve) => {
  createServer((socket) => resolve(new HRPC(socket))).listen(socketPath);
});
const worker = spawn("bare", {
  args: [join(here, "06-rpc-worker.mjs"), socketPath],
  stdio: ["ignore", "inherit", "inherit"],
});
const rpc = await connected;
console.log("host: worker connected\n");

// One unwrap helper: the wire error envelope → the matching OpennibError class.
const unwrap = (res) => {
  if (res.error) throw rehydrateError(res.error.name, res.error.message);
  return res;
};

console.log(
  "A) init + append + list — the SAME typed methods the real apps call",
);
unwrap(
  await rpc.init({
    historyDir: join(dir, "history"),
    dictionaryDir: join(dir, "dictionary"),
  }),
);
unwrap(
  await rpc.historyAppend({
    entry: {
      id: "r1",
      createdAt: Date.now(),
      text: "over the wire",
      language: "en",
      durationMs: 800,
      app: null,
    },
  }),
);
const { entries } = unwrap(
  await rpc.historyList({ limit: null, before: null }),
);
console.log(
  "   list →",
  entries.map((e) => `${e.id}:${JSON.stringify(e.text)}`),
);

console.log(
  "\nB) transcribe-file — request struct in, {error, text} struct out",
);
const { text } = unwrap(
  await rpc.transcribeFile({
    wavPath: "/tmp/hello.wav",
    model: "small",
    language: "auto",
  }),
);
console.log("   text →", JSON.stringify(text));

console.log(
  "\nC) a worker-side throw arrives as a TYPED error on the host (RULE 1 + rehydrateError)",
);
try {
  unwrap(
    await rpc.transcribeFile({
      wavPath: "/tmp/hello.wav",
      model: "small",
      language: "xx",
    }),
  );
} catch (err) {
  console.log(`   caught ${err.constructor.name}: ${err.message}`);
  console.log(
    `   instanceof ValidationError → ${err instanceof ValidationError}   (same class hierarchy as in-process)`,
  );
}

console.log("\nD) shutdown — the worker closes its stores and exits");
unwrap(await rpc.shutdown({}));
worker.on("exit", (code) => {
  console.log(`host: worker exited with code ${code}`);
  process.exit(0);
});

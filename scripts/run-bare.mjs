#!/usr/bin/env node
// Runs a script under the Bare runtime without relying on the `bare` bin shim
// in node_modules/.bin (which npm may skip creating when platform-optional
// runtime packages can't be resolved — the cause of "bare: command not found"
// in CI). Resolves the runtime binary for this platform explicitly.
//
//   node scripts/run-bare.mjs <script> [args…]
import spawn from "bare-runtime/spawn";

const [, , script, ...args] = process.argv;
if (!script) {
  console.error("usage: node scripts/run-bare.mjs <script> [args…]");
  process.exit(2);
}
spawn("bare", {
  args: [script, ...args],
  stdio: "inherit",
  forwardExitCode: true,
});

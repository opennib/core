// Lesson 3 example — LLM cleanup with the custom dictionary, under Bare.
// Shows: (A) plain cleanup, (B) the dictionary changing the output,
// (C) cleanupText's best-effort fallback, and the LlmSdk seam via a
// logging facade (which also reveals what the SDK's completion() returns).
//
//   bare examples/03-llm-cleaner.mjs
import os from "bare-os";
import path from "bare-path";

import * as sdk from "@qvac/sdk";
import { llmPlugin } from "@qvac/sdk/llamacpp-completion/plugin";
import { LlmCleaner } from "../dist/llm-cleaner.js";
import { cleanupText } from "../dist/cleanup.js";

const modelPath = path.join(
  os.homedir(),
  "Library/Application Support/@opennib/desktop/llm/qwen2.5-0.5b-instruct-q4_k_m.gguf",
);

sdk.plugins([llmPlugin]); // Bare-direct: register the llama.cpp engine in-process

// ── the LlmSdk seam: real SDK underneath, every call logged ──────────
const loggingSdk = {
  async loadModel(opts) {
    console.log(
      `  [sdk] loadModel  ${path.basename(opts.modelSrc.src)} engine=${opts.modelSrc.engine}`,
    );
    return sdk.loadModel(opts);
  },
  completion(opts) {
    const system = opts.history.find((m) => m.role === "system")?.content ?? "";
    const dictLines = system
      .split("\n")
      .filter((l) => l.startsWith("- Replace") || l.startsWith("- Spell"));
    console.log(
      `  [sdk] completion dictionary lines in prompt: ${dictLines.length}${dictLines.length ? " → " + dictLines.join(" | ") : ""}`,
    );
    const run = sdk.completion(opts);
    console.log(
      `  [sdk] completion returned: .text is a ${run.text instanceof Promise ? "Promise" : typeof run.text}`,
    );
    return run;
  },
  async unloadModel(opts) {
    console.log(`  [sdk] unloadModel ${opts.modelId}`);
    return sdk.unloadModel(opts);
  },
};

const raw =
  "so um the app is called open nib and it works on iphone i mean android too";
console.log(`raw transcript:\n  ${JSON.stringify(raw)}\n`);

const cleaner = new LlmCleaner({ modelPath, sdk: loggingSdk });

console.log("A) cleanupText WITHOUT dictionary");
const a = await cleanupText(raw, { cleaner, language: "en" });
console.log(`   → ${JSON.stringify(a)}\n`);

console.log(
  'B) cleanupText WITH dictionary term { term: "opennib", replacement: "open nib" }',
);
const b = await cleanupText(raw, {
  cleaner,
  language: "en",
  terms: [
    {
      id: "1",
      term: "opennib",
      replacement: "open nib",
      createdAt: Date.now(),
    },
  ],
});
console.log(`   → ${JSON.stringify(b)}\n`);

console.log(
  'C) best-effort fallback: a cleaner that returns "" (LLM ate the input)',
);
const brokenCleaner = {
  async cleanup() {
    return "";
  },
};
const c = await cleanupText(raw, { cleaner: brokenCleaner, language: "en" });
console.log(
  `   → ${JSON.stringify(c)}  (= the raw text, trimmed — never empty output)\n`,
);

console.log("D) unload()");
await cleaner.unload();
Bare.exit(0);

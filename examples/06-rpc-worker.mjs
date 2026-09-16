// Lesson 6 example — the generated HRPC contract, worker side. This file IS
// a tiny core worker: it runs under Bare, connects to the host's socket, and
// serves three commands from spec/hrpc. Storage is real (Hypercore); the
// transcriber is a stub so the example needs no model.
//
// Started for you by 06-rpc-host.mjs — see that file.
import net from "bare-net";
import os from "bare-os";
import path from "bare-path";

import HRPC from "../spec/hrpc/index.js";
import { HypercoreHistory } from "../dist/storage/index.js";
import { ValidationError } from "../dist/errors.js";

const socketPath = Bare.argv[Bare.argv.length - 1];
const rpc = new HRPC(net.connect(socketPath));

let history = null;

// RULE 1: the generated handler has no try/catch — a throw would hang the
// caller forever. Every handler is wrapped so a throw becomes the response's
// `error` field instead.
const guard =
  (fn, empty = {}) =>
  async (req) => {
    try {
      return await fn(req);
    } catch (err) {
      return { error: { name: err.name, message: err.message }, ...empty };
    }
  };

rpc.onInit(
  guard(async ({ historyDir }) => {
    history = new HypercoreHistory({ storagePath: historyDir });
    console.log(`  [worker] init → history at ${path.basename(historyDir)}`);
    return { error: null };
  }),
);

rpc.onHistoryAppend(
  guard(async ({ entry }) => {
    await history.append(entry);
    console.log(`  [worker] history-append ${entry.id}`);
    return { error: null };
  }),
);

rpc.onHistoryList(
  guard(
    async ({ limit }) => {
      // RULE 3: optional fields decode as null; limit 0/null means "no limit".
      const entries = await history.list(limit ? { limit } : undefined);
      return { error: null, entries };
    },
    { entries: null },
  ),
);

rpc.onTranscribeFile(
  guard(
    async ({ wavPath, language }) => {
      console.log(
        `  [worker] transcribe-file ${path.basename(wavPath)} lang=${language}`,
      );
      if (language === "xx")
        throw new ValidationError(`unsupported language tag: ${language}`);
      return {
        error: null,
        text: `(stub transcript of ${path.basename(wavPath)})`,
      };
    },
    { text: null },
  ),
);

rpc.onShutdown(
  guard(async () => {
    await history?.close();
    console.log("  [worker] shutdown");
    setTimeout(() => Bare.exit(0), 50);
    return { error: null };
  }),
);

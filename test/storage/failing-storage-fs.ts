import type { StorageFs } from "../../src/interfaces/storage-fs.js";

/**
 * `StorageFs` over the real filesystem (bare-fs) with a `failAfter` hook that
 * throws once a given number of mutating operations have run — how tests
 * simulate a process dying part-way through a compaction. Directory contents
 * are real Hypercore data, so recovery is exercised against genuine logs.
 */
export interface FailingStorageFs extends StorageFs {
  readonly ops: string[];
  failAfter(count: number): void;
}

export async function createStorageFs(): Promise<FailingStorageFs> {
  const fs = (await import("bare-fs")).default;
  const ops: string[] = [];
  let remaining = Number.POSITIVE_INFINITY;

  function tick(op: string): void {
    if (ops.length >= remaining) {
      throw new Error(`simulated crash before ${op}`);
    }
    ops.push(op);
  }

  return {
    ops,
    failAfter(count) {
      remaining = count;
    },
    async rename(from, to) {
      tick(`rename ${from} → ${to}`);
      await fs.promises.rename(from, to);
    },
    async remove(path) {
      tick(`remove ${path}`);
      await fs.promises.rm(path, { recursive: true, force: true });
    },
    async exists(path) {
      try {
        await fs.promises.stat(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

import Hypercore from "hypercore";

import type { StorageFs } from "../../interfaces/storage-fs.js";
import { log } from "../../log.js";

/**
 * Crash-safe rewrite of an append-only Hypercore log: copy the blocks `keep`
 * selects into a fresh log, then swap directories. Used by the stores to
 * physically reclaim expired history and folded dictionary tombstones —
 * Hypercore cannot delete from the middle of a log, so "delete" means
 * "rebuild from the survivors".
 *
 * Directory protocol (a complete, valid log exists at some path at every
 * instant):
 *
 *   <path>.compacting   the new log being written; discarded if found stray
 *   <path>.old          the outgoing log during the swap; deleted last
 *
 *   1. write survivors → <path>.compacting
 *   2. rename <path> → <path>.old
 *   3. rename <path>.compacting → <path>
 *   4. remove <path>.old
 *
 * `recoverInterruptedCompaction` runs before every open and finishes or
 * unwinds whichever step a previous process died in.
 */

export function compactingPath(storagePath: string): string {
  return `${storagePath}.compacting`;
}

export function oldPath(storagePath: string): string {
  return `${storagePath}.old`;
}

/**
 * Repair the directory layout left by a compaction that did not finish.
 * Idempotent; safe to call when nothing is wrong.
 */
export async function recoverInterruptedCompaction(
  fs: StorageFs,
  storagePath: string,
): Promise<void> {
  const compacting = compactingPath(storagePath);
  const old = oldPath(storagePath);
  const hasMain = await fs.exists(storagePath);
  const hasOld = await fs.exists(old);

  if (hasOld && !hasMain) {
    // Died between step 2 and 3. The new log in `.compacting` is complete
    // (step 1 finished before step 2 could run), so prefer it; otherwise
    // put the outgoing log back.
    if (await fs.exists(compacting)) {
      await fs.rename(compacting, storagePath);
      await fs.remove(old);
      log.info("storage compaction: completed interrupted swap", {
        storagePath,
      });
    } else {
      await fs.rename(old, storagePath);
      log.info("storage compaction: restored outgoing log", { storagePath });
    }
    return;
  }

  if (hasOld && hasMain) {
    // Died between step 3 and 4: the new log is in place; drop the leftover.
    await fs.remove(old);
    log.info("storage compaction: removed leftover outgoing log", {
      storagePath,
    });
  }

  if (await fs.exists(compacting)) {
    // Died during step 1: the partial new log is worthless; the main log is intact.
    await fs.remove(compacting);
    log.info("storage compaction: discarded partial compaction", {
      storagePath,
    });
  }
}

/**
 * Rewrite the log at `storagePath` keeping only the blocks for which `keep`
 * returns true (in original order). `source` must be an OPEN core on
 * `storagePath`; it is closed by this call. Returns the number of blocks kept.
 */
export async function compactLog(
  fs: StorageFs,
  storagePath: string,
  source: Hypercore,
  keep: (block: unknown, index: number) => boolean,
): Promise<number> {
  const compacting = compactingPath(storagePath);
  await fs.remove(compacting);

  const survivors: unknown[] = [];
  for (let i = 0; i < source.length; i++) {
    const block = await source.get(i);
    if (block !== null && keep(block, i)) survivors.push(block);
  }

  const target = new Hypercore(compacting, { valueEncoding: "json" });
  await target.ready();
  if (survivors.length > 0) await target.append(survivors);
  await target.close();
  await source.close();

  await fs.rename(storagePath, oldPath(storagePath));
  await fs.rename(compacting, storagePath);
  await fs.remove(oldPath(storagePath));
  return survivors.length;
}

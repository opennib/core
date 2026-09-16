/**
 * The filesystem slice the Hypercore stores need to compact a log: rename a
 * directory, remove one recursively, check existence. Injected by the host
 * worker (`bare-fs` under Bare) so core itself stays free of runtime-specific
 * filesystem imports and tests can drive compaction — including the
 * interrupted-halfway cases — against a controllable implementation.
 *
 * Stores work without it: they then keep today's read-time filtering only,
 * and expired data is hidden but never reclaimed from disk.
 */
export interface StorageFs {
  rename(from: string, to: string): Promise<void>;
  /** Remove a file or directory tree. Must not throw when `path` is absent. */
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

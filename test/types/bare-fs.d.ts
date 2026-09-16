// Minimal ambient declaration for bare-fs — only the promise slice the test
// StorageFs implementation uses. Same approach as brittle.d.ts.
declare module "bare-fs" {
  interface BareFsPromises {
    rename(from: string, to: string): Promise<void>;
    rm(
      path: string,
      options?: { recursive?: boolean; force?: boolean },
    ): Promise<void>;
    stat(path: string): Promise<unknown>;
  }
  const fs: { promises: BareFsPromises };
  export default fs;
}

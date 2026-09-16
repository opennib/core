// Minimal ambient declaration for hypercore. The package ships without
// types; we only use a tiny slice (constructor + ready/append/get/length/
// truncate/close), so a precise local-only declaration is preferable to
// pulling in a community-maintained @types/* shim.

declare module "hypercore" {
  interface HypercoreOptions {
    valueEncoding?: "json" | "utf-8" | "binary"
    createIfMissing?: boolean
    overwrite?: boolean
  }

  class Hypercore<T = unknown> {
    constructor(storage: string, options?: HypercoreOptions)
    constructor(storage: string, key: Buffer | null, options?: HypercoreOptions)

    readonly length: number
    ready(): Promise<void>
    append(block: T): Promise<number>
    get(index: number): Promise<T | null>
    truncate(length: number): Promise<void>
    close(): Promise<void>
  }

  export = Hypercore
}

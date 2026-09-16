// Minimal ambient declaration for brittle. The package ships without types;
// we declare just the slice the core test suite uses — same approach as
// `src/storage/hypercore.d.ts`.

declare module "brittle" {
  export interface Assertion {
    is(actual: unknown, expected: unknown, message?: string): void
    not(actual: unknown, expected: unknown, message?: string): void
    /** Deep equality (vitest's `toEqual`). */
    alike(actual: unknown, expected: unknown, message?: string): void
    unlike(actual: unknown, expected: unknown, message?: string): void
    ok(value: unknown, message?: string): void
    absent(value: unknown, message?: string): void
    pass(message?: string): void
    fail(message?: string): void
    comment(message: string): void
    plan(count: number): void
    teardown(fn: () => void | Promise<void>): void
    exception(
      fn: (() => unknown) | Promise<unknown>,
      error?: RegExp | string,
      message?: string,
    ): Promise<void>
    execution(fn: (() => unknown) | Promise<unknown>, message?: string): Promise<void>
    test(name: string, fn: (t: Assertion) => void | Promise<void>): Promise<void>
  }

  export interface TestOptions {
    timeout?: number
    solo?: boolean
    skip?: boolean
  }

  interface TestFn {
    (name: string, fn: (t: Assertion) => void | Promise<void>): Promise<void>
    (
      name: string,
      options: TestOptions,
      fn: (t: Assertion) => void | Promise<void>,
    ): Promise<void>
    solo: TestFn
    skip: TestFn
  }

  const test: TestFn
  export default test
}

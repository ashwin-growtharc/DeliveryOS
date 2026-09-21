/* eslint-disable @typescript-eslint/no-require-imports -- the one file allowed
 * to, for the reason below. Every `require` here has a literal specifier, and
 * that is not style: esbuild only bundles what it can see, so a `require`
 * with a variable would leave the shipped executable without the package. */
import type * as TS from 'typescript';
import type * as Docgen from 'react-docgen-typescript';

/**
 * Heavy dependencies, loaded the first time they are asked for.
 *
 * WHY THIS EXISTS
 *
 * `deliveryos --help` took a second. `list` took 1.3 s. Neither does a second
 * of work. Every command module is registered at startup, each imports the
 * engine, and six modules eagerly imported tools that only `push --preview`,
 * `scan`, signed pulls and `mcp` ever run. Measured `require` cost, in
 * isolation: Tailwind 247 ms, sigstore 240 ms, react-docgen 181 ms, the MCP
 * SDK 180 ms, the TypeScript compiler 178 ms. That sum IS the startup time.
 *
 * WHY `require` AND NOT `await import()`
 *
 * The codebase already defers ESM-only packages with `import()` --
 * `createOctokit`, `playwright-core` -- and the async callers in `compile.ts`
 * and `provenance/verify.ts` do the same. The two loaders here exist for the
 * callers that cannot: `parseRoutesTree` and `detectSelfNestingWarnings` are
 * synchronous functions called from synchronous code, and turning them async
 * to satisfy `import()` would ripple through every caller for no benefit. Both
 * packages are CommonJS, so a lazy `require` is the honest tool.
 *
 * `test/e2e/startupWeight.e2e.test.ts` is what keeps this true. It fails on
 * any top-level value import of these packages, and it spawns `--help` and
 * checks none of them ended up in `require.cache`.
 */

function once<T>(load: () => T): () => T {
  let value: T | undefined;
  return () => {
    if (value === undefined) value = load();
    return value;
  };
}

/** The TypeScript compiler API, for the two modules that walk a real AST. */
export const loadTypescript = once((): typeof TS => require('typescript'));

/** `react-docgen-typescript`, which itself loads the compiler -- so the first
 * call pays for both, and nothing before it pays for either. */
export const loadReactDocgen = once((): typeof Docgen => require('react-docgen-typescript'));

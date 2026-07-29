# Phase 6, Phase A spike: UI-component live-preview compilation — results

Per PLAN.md's Phase 6, Phase A: prove a component's source compiles to a
self-contained, interactive HTML bundle before any of the surrounding
feature (sidebar page, Scan integration, controls) gets built on top of
that assumption. Branch `ui-components-planning`. Windows-only, matching
the project's current overall scope.

## What was built

- `src/engine/preview/compile.ts` — `compilePreviewHtml()` compiles a
  component's `preview.tsx` demo file (see
  `docs/ui-components-feature-design.md` §5) into one self-contained HTML
  document via native `esbuild`: a synthetic `stdin` entry point imports
  the real preview file by a normal relative specifier, renders whichever
  variant is declared first, and the whole thing (component + preview +
  React/ReactDOM + a small mount harness) is bundled and minified into one
  `<script>` tag.
- `listVariantNames()` — reads a preview file's exported variant names
  directly from its source text, in real declaration order. Exists
  specifically because of a real bug this spike caught (below).
- `test/fixtures/preview-spike/Button/` — a hardcoded fixture (`Button.tsx`
  + a three-variant `preview.tsx`) exercised by both the automated test
  suite and a manual real-browser check.
- `test/unit/preview.compile.test.ts` — 5 tests, executing the compiled
  bundle for real in `jsdom` and asserting on the actual rendered DOM
  (not just string-matching the compiled JS text — see below for why that
  matters).
- Packaging wiring: `scripts/build-sidecar.mjs` stages
  `node_modules/@esbuild/win32-x64/esbuild.exe` into `build/esbuild.exe`;
  `src-tauri/tauri.conf.json` adds it as a `bundle.resources` entry;
  `src-tauri/src/lib.rs`'s `sidecar_call` resolves that bundled resource
  and sets `ESBUILD_BINARY_PATH` on the spawned sidecar's environment
  before `.spawn()`, if (and only if) it's actually found.
- `src/sidecar.ts`'s `preview.compileDebug` — a **temporary, debug-only**
  command (clearly marked for removal once Phase B wires a real one in)
  that let the packaged-`.exe` acceptance test below actually happen.

None of this touches `src/cli/`, existing `src/engine/` modules, or any
existing test — confirmed additive-only; all 114 tests (109 pre-existing +
5 new) pass.

## Two real bugs this spike caught (the actual point of a spike)

1. **Picking "the first variant" via `Object.keys()` silently rendered the
   wrong one.** esbuild's bundler does not preserve source declaration
   order in the namespace object it generates for `import * as x` — it
   came back alphabetized (`Disabled` before `Primary`), confirmed via a
   real browser check (a `sandbox="allow-scripts"` iframe, no
   `allow-same-origin`, loaded via `srcdoc`) that visibly showed the
   Disabled variant's grey styling where Primary's navy was expected.
   Fixed by `listVariantNames()` reading the source text directly and
   importing the first variant **by its actual name** (a named import),
   never by object-key indexing into a bundled namespace.
2. **The first test-methodology pass couldn't actually prove which variant
   rendered.** It asserted on substrings of the compiled JS bundle text
   (`toContain('#1E3C53')` / `not.toContain('not-allowed')`) — but the
   bundle's source contains *every* branch of `Button.tsx` regardless of
   which one executes at runtime, so both assertions passed even while the
   wrong variant (Disabled) was actually rendering. Fixed by executing the
   compiled HTML for real in `jsdom` (`runScripts: 'dangerously'`) and
   asserting on the real rendered `<button>` element instead. Also caught:
   React 19's `createRoot` doesn't flush its initial render purely
   synchronously inside the inline `<script>` — the test polls for the
   rendered element (up to 2s) rather than trusting one fixed sleep
   duration.

## A third, architectural correction: `esbuild-wasm` → native `esbuild`

The spike's first working version used `esbuild-wasm`. This directly
contradicted `docs/ui-components-feature-design.md` §4.2's own already-
documented decision (native `esbuild`, explicitly *not* the WASM build) —
and not just as a style mismatch. Confirmed by reading
`node_modules/esbuild-wasm/lib/main.js` directly: its only Node code path
hardcodes `child_process.spawn("node", [...bin/esbuild])`, which cannot
survive the sidecar's existing Node SEA packaging (no separate Node
install or `node_modules` exists on an end user's machine for that spawn
to find). Native `esbuild`, by contrast, has a documented
`ESBUILD_BINARY_PATH` env-var escape hatch built for exactly this
"packaged unusually" scenario (`node_modules/esbuild/lib/main.js`:
`ESBUILD_BINARY_PATH` is read once at module-top-level from
`process.env`, and when set, both skips the "cannot be bundled" guard and
spawns that binary directly — no `"node"` wrapper, no PATH lookup). Since
`src-tauri/src/lib.rs` sets that env var via `.env()` on the Command
builder *before* `.spawn()`, it's present in the child process's
environment from its very first instruction — not a runtime race.

## Measured result

Compiled bundle size (the fixture Button, minified, React + ReactDOM
inlined): **190.5 KB**. Down from ~1.1MB unminified during initial
development. Native `esbuild.exe` staged as a resource: 11.1 MB (a fixed,
one-time cost, not per-component).

## Independent code review — findings and disposition

A second-pass review (a fresh subagent, reading the actual changed files
plus `esbuild`'s and `tauri-plugin-shell`'s own source rather than taking
claims on faith) found 8 issues. Fixed now, all cheap and clearly in scope:

- **Unescaped `</script>` in the generated HTML** — any component whose
  rendered/literal content contained that substring would have
  prematurely closed the `<script>` element, spilling arbitrary content
  into the document. Fixed: `</script` is escaped before interpolation.
- **Unvalidated filename interpolated into generated harness source** —
  `entryBasename` was spliced into generated import-specifier source with
  no character validation (unlike `firstVariantName`, already constrained
  by an identifier regex). Fixed: rejects anything not matching a safe
  `[\w.-]+` shape before use.
- **Orphaned native `esbuild.exe` service process** — native esbuild's
  `build()` starts a long-lived native service on first call, meant to be
  reused across calls; this sidecar is spawned fresh and killed per call
  (see `lib.rs`'s own doc comment), so there's no "next call" to reuse it
  for. Fixed: `await esbuild.stop()` after every compile.
- **A proposed `external: ['esbuild']` "fix" in `build-sidecar.mjs` would
  have broken packaging entirely** — re-examining this against esbuild's
  own source (see the architectural-correction section above) showed the
  original bundle-it-in approach was already correct; marking it external
  would leave an unresolvable `require('esbuild')` in the packaged
  sidecar with no `node_modules` at runtime. Reverted, with the reasoning
  documented inline in `build-sidecar.mjs` so it isn't "fixed" again by
  someone hitting the same false alarm later.
- **A comment in `lib.rs` incorrectly implied `tauri dev` doesn't need
  this to work** ("native esbuild's default node_modules-based lookup
  already works in dev") — `tauri dev` spawns the same `externalBin`
  sidecar `.exe` production does; there's no separate dev-mode sidecar
  with `node_modules` nearby. Comment corrected.
- `listVariantNames`'s regex extended to also match `export async
  function` (was previously missed).

Documented as explicit known limitations rather than fixed here (real,
but correctly out of this spike's scope):

- **React/ReactDOM are not actually vendored yet.** The generated harness
  does `import React from 'react'` / `import { createRoot } from
  'react-dom/client'`, resolved via ordinary `node_modules` lookup
  (walking up from the artifact's own directory) — works today only
  because the test fixture happens to sit inside this monorepo. Will
  **not** work for a real pulled artifact in an arbitrary project folder,
  nor in the packaged app (no `node_modules` next to the SEA-packaged
  sidecar). `docs/ui-components-feature-design.md` §4.2 already calls for
  vendoring a pinned React/ReactDOM runtime the app ships with itself —
  this spike didn't implement that part. **Real Phase B work, not done
  here.**
- **No sandboxing on relative-import resolution.** A component or its
  `preview.tsx` can `import` anything reachable via relative path
  traversal and esbuild will inline it — a path-traversal-shaped risk once
  genuinely untrusted pushed content flows through this function. Fine
  today (Phase A only ever compiles a hardcoded fixture); must be
  constrained to the artifact's own directory before Phase D (Scan
  integration, real pushed content) reaches this code path.
- **`sidecar_call`'s response loop (`lib.rs`) has no timeout.** Pre-
  existing gap, not introduced here, but newly relevant now that
  "compile arbitrary source with no resource limits" is a candidate to
  run through this exact call path eventually.

## The packaged-`.exe` acceptance test: actually done, via a shell-level simulation

A temporary debug-only sidecar command, `preview.compileDebug` (in
`src/sidecar.ts`, clearly marked for removal once Phase B wires a real
command in), exercises `compilePreviewHtml()` end to end. Rather than
wait on a full `cargo tauri build`, the exact runtime condition Rust's
`.env("ESBUILD_BINARY_PATH", ...)` produces was reproduced directly at
the shell level — an env var set on a spawned child process is identical
regardless of whether Rust or a shell does the spawning:

1. Temporarily renamed `node_modules/@esbuild/win32-x64` out of the way,
   so native esbuild's own default `node_modules`-based fallback
   genuinely could not succeed — isolating the exact risk this spike
   exists to de-risk, not conflating it with the separately-documented
   "React isn't vendored yet" gap (the fixture stays inside the monorepo,
   so React itself still resolves normally).
2. Ran the real packaged `build/deliveryos-engine-*.exe` directly, piping
   in a `preview.compileDebug` request, with `ESBUILD_BINARY_PATH` set to
   the staged `build/esbuild.exe` resource — **succeeded**:
   `{"ok":true,"result":{"success":true,"byteLength":195034,...}}`.
3. **Negative control**: same setup, `ESBUILD_BINARY_PATH` unset — failed
   cleanly with esbuild's own clear, expected error ("The esbuild
   JavaScript API cannot be bundled..."), not a crash or a corrupted
   stdout stream. Confirms the fix is actually doing something, not
   passing by coincidence.
4. Restored `node_modules/@esbuild/win32-x64` immediately after each run;
   full `npm test` (114 tests) re-confirmed green afterward.

This proves the actual packaging risk this spike existed to de-risk —
native esbuild really does work from inside the packaged, no-`node_modules`
sidecar binary, driven purely by an env var set before spawn — without
needing a Rust toolchain at all, since the env var mechanism itself is
OS-level and identical regardless of which process does the spawning.

## What's still genuinely owed

**`cargo check` still hasn't run.** No Rust toolchain exists in the
environment this spike was built in (confirmed: no `cargo`/`rustc` on
`PATH`), so `src-tauri/src/lib.rs`'s actual Rust code — the
`app.path().resolve(...)` / `BaseDirectory::Resource` / `.env(...)` calls
that *produce* the env var the shell-level test above simulated by hand —
has still never been compiled. Verified only against official `docs.rs`
documentation and the real `tauri-plugin-shell` v2 source for the exact
API signatures used. **Run `cargo check` (or `cargo tauri dev`) before
Phase B starts** — the shell-level test above proves the *mechanism*
works; it doesn't prove `lib.rs` itself compiles.

## Recommendation: proceed to Phase B, with one item tracked

The core compile mechanism is proven, tested, and now verified against
the real packaged binary under the exact failure-inducing condition
(`node_modules` fallback unavailable) it needed to survive. Every
fixable issue from the review pass is fixed. The one thing still
genuinely owed — an actual `cargo check` — should happen before or early
in Phase B, not be silently forgotten. The temporary
`preview.compileDebug` sidecar command should be removed once Phase B
wires in the real one.

# Changelog

All notable changes to DeliveryOS are recorded here, phase by phase. See
[PLAN.md](PLAN.md) for the roadmap and [ARCHITECTURE.md](ARCHITECTURE.md) for
design rationale.

- **Fixed a real scrollbar-flash bug in the live preview**, found by hand
  once real styling/animation actually worked: clicking a component that
  changes size at runtime (framer-motion's `ExpandedTabs`) briefly showed
  a native scrollbar inside the preview during the transition. Root cause
  -- resizing is inherently asynchronous (the iframe measures its own
  content, posts it to the parent, and the parent applies a new box size
  on its own next frame), so any component whose size changes at runtime
  always has a brief window where its real content exceeds whatever box
  the parent has applied so far; the iframe's own `html`/`body` (a
  genuinely separate root scrolling element, independent of the parent
  page) had no `overflow: hidden` rule, so that moment showed a real
  native scrollbar. Researched how other iframe-resize tools/the CSS
  Working Group treat this class of problem before fixing it -- confirmed
  `overflow: hidden` on the iframe's own root doesn't affect the
  `scrollWidth`/`scrollHeight` measurements `injectContentHeightReporter`
  already depends on (they report real content size regardless of whether
  a scrollbar is shown), so this is a pure display fix with no
  measurement-accuracy tradeoff. Also confirmed and documented a SEPARATE,
  non-fixable platform limitation while researching this: a hover-
  triggered element that needs to visually extend beyond a component's
  own box (a tooltip, a dropdown) can never actually paint outside the
  iframe's allocated box in the parent page -- Chrome (since v108) and
  Firefox both force `overflow: clip` on `iframe`/`embed`/`object`
  specifically to stop embedded content from escaping its box, a
  deliberate isolation boundary, not something either side's CSS can work
  around. Verified by hand: embedded the real compiled `ExpandedTabs`
  preview in a deliberately undersized real iframe and clicked through
  its tab-switch animation -- content clips cleanly at the box edge with
  no scrollbar, even mid-transition. 1 new unit test; full suite (167
  tests) + typecheck + lint all clean.

- **Fixed a real packaged-sidecar-only bug in the Tailwind CSS generation
  below**: the user restarted the app after that fix shipped and still saw
  zero styling. Root cause, confirmed by directly spawning the actual
  packaged sidecar `.exe` and sending it a real `preview.compileLocal`
  request (not just testing against `dist/` under a normal `node`
  process, which has real `node_modules` and had masked this entirely):
  Tailwind's own `preflight` core plugin reads its package's
  `lib/css/preflight.css` off disk with a plain `fs.readFileSync` at
  RUNTIME (`node_modules/tailwindcss/lib/corePlugins.js`) -- the packaged
  Node SEA has no `node_modules` anywhere near it at all, so this threw
  `ENOENT`, silently caught by `generateTailwindCss`'s own fail-soft catch
  and degrading to no styling at all. The exact same class of packaging
  problem this project already hit twice before (esbuild's native binary,
  React's own runtime) -- same fix: new
  `scripts/generate-vendored-tailwind-preflight.mjs` reads that one static
  file once at build time and embeds it as a plain string constant
  (`VENDORED_TAILWIND_PREFLIGHT_CSS`); `generateTailwindCss` now disables
  Tailwind's own `preflight` core plugin entirely and prepends this
  constant instead. New regression test hides the real
  `preflight.css` file (mirroring the existing "vendored React runtime"
  isolation test's exact discipline) and confirms preflight CSS still
  appears in the output. Re-verified by spawning the actual rebuilt
  packaged sidecar exe again and confirming both a real `.rounded-full`
  rule and a real preflight `box-sizing: border-box` rule are present,
  with no stderr errors -- not just re-running the earlier `dist/`-based
  check, which would not have caught this. Full suite (166 tests) +
  typecheck + lint all clean.

- **Real Tailwind CSS generation in the preview pipeline.** Found by hand
  (a screenshot of a real Tailwind-authored component's live preview
  showed correct DOM structure -- icons, layout, labels -- but zero visual
  styling: no rounding, background, spacing, blur, shadow). An independent
  agent investigation confirmed the root cause: `compileReactPreview`
  never had a CSS build step at all -- no `tailwindcss`/`postcss`
  dependency, no `tailwind.config`/`postcss.config` anywhere in the repo,
  esbuild only ever bundled JS/TSX. New `generateTailwindCss` in
  `compile.ts` runs Tailwind v3's own JIT engine (via `postcss` +
  `tailwindcss`'s `content: [{ raw, extension }]` API -- scans in-memory
  source text directly, no real file globs needed) against every sibling
  `.tsx`/`.jsx` file in a component's payload directory (reusing
  `findComponentFiles`, newly exported from `docgen.ts`), and injects the
  resulting CSS as a `<style>` tag. Unlike the vendored JS libraries
  above, this runs entirely server-side in the sidecar process itself (no
  browser-side vendoring needed) and required no separate generation
  script: `build-sidecar.mjs`'s existing esbuild bundle already inlines
  every real dependency of `sidecar.ts`'s import graph. Preflight
  (Tailwind's own reset) is left on, matching what a real Tailwind-hosted
  component already assumes. Fails soft to no extra CSS (never breaks an
  otherwise-working preview) if a sibling file can't be read or Tailwind
  itself throws. Verified against the real `ExpandedTabs` component in a
  real test project via both a direct compile (confirmed generated CSS
  rules like `.rounded-full { border-radius: 9999px }` are present) and a
  real browser screenshot/click showing the fully-styled, correctly
  animated result. 2 new unit tests; full suite (165 tests) + typecheck +
  lint all clean.

- **Vendored a short allow-list of common UI-kit libraries** --
  `framer-motion`, `clsx`, `tailwind-merge`, `class-variance-authority` --
  the same way React itself is already vendored, so a real pasted
  component that imports one of these (left completely untouched, per
  `.claude/skills/ui-component-extractor/SKILL.md`) now actually compiles
  and runs instead of failing with `Could not resolve "..."`. New
  `scripts/generate-vendored-libraries.mjs` (mirrors
  `generate-vendored-react-runtime.mjs`'s pattern) bundles each library
  with react/react-dom/`react/jsx-runtime` marked `external`, so it shares
  the one already-vendored React instance rather than bringing its own
  (would silently break hooks/context otherwise). `compileReactPreview`
  now marks exactly these specifiers `external` too, satisfied at
  preview-render time by a new global `require()` shim (embedded ahead of
  the component bundle) that resolves `'react'`/`'react/jsx-runtime'` to
  the vendored React runtime and any allow-listed name to
  `window.__DeliveryOSVendoredLibs[name]`. Everything else still hits
  `createDirectorySandboxPlugin`'s existing rejection exactly as before --
  confirmed with a regression test importing `zod` (a real dependency of
  this very repo, so genuinely resolvable, not just missing) and asserting
  it's still rejected. Found and fixed a real ESM/CJS double-interop bug
  along the way: the vendored library's own bundle and the CONSUMING
  component's bundle are two separate esbuild invocations, and without a
  `__esModule: true` marker on the vendored object, esbuild's `__toESM`
  helper wrapped it a second time in the consumer, making `clsx.default`
  the entire namespace object instead of the real function (`(0,
  c.default) is not a function`) -- confirmed by hand, fixed by marking
  the vendored object accordingly. Verified end-to-end against the real
  `ExpandedTabs` component in a real test project (framer-motion) via both
  a direct compile and a real browser click that re-triggered its layout
  animation. 3 new unit tests (clsx runs for real, framer-motion mounts
  for real, an unvendored real package is still rejected); full suite
  (163 tests) + typecheck + lint all clean.

- Surfaced the real compile/parse error in every "Preview unavailable"
  placeholder (`loadUiComponentPreview`, `loadDetailPreview`,
  `loadAddNewReviewPreview` in `app.js`) instead of discarding it --
  found while hand-testing Scan against a real project, where a
  component with a genuinely unresolved import (a plain `import React
  from 'react'` against DeliveryOS's vendored-React pipeline, which has
  no real `react` package on disk at compile time) just showed a bare
  "Preview unavailable" with no way to tell why. Now shows
  `Preview unavailable -- <message>`, reusing the same
  `err instanceof Error ? err.message : String(err)` pattern already
  used for toasts elsewhere in this file. Added text-wrapping/padding to
  `.ui-component-preview-loading` so a real error message doesn't clip
  inside the (possibly narrow) preview frame.

- Added a new skill, `.claude/skills/ui-component-extractor/SKILL.md`,
  documenting the process for ingesting an arbitrary pasted/found React
  UI component (from v0, 21st.dev, shadcn, Aceternity, etc.) into a
  DeliveryOS project so it both compiles and is correctly picked up by
  `deliveryos scan`: promote the real props-bearing component to be the
  file's own export when the pasted source is a zero-prop demo wrapper
  around an unexported internal component (a real, confirmed Scan false
  negative -- `react-docgen-typescript` never documents unexported
  symbols, no parser option overrides this), apply the established
  mechanical react-import fix, leave every other (genuinely third-party)
  import untouched, and hand-write `preview.tsx` with realistic example
  data instead of relying on the auto-scaffold's bare type-based
  placeholders. Includes a full worked Dropdown example and a verified
  real-world case (`ExpandedTabs`, restructured out of a `Tabs2` demo
  wrapper in a real test project -- confirmed via a direct
  `react-docgen-typescript` probe that the original file produced zero
  component docs, and that `deliveryos scan` found it with zero warnings
  immediately after the restructure).

- Fixed two real gaps in Phase D's auto-scaffolded `preview.tsx` found by
  hand while testing Scan against a real project: a required prop with no
  default and no better inference always fell back to a placeholder
  assuming string/boolean/number, which was wrong two ways. (1) A required
  string-LITERAL-UNION prop (`variant: 'primary' | 'secondary'`) got an
  empty string -- genuinely invalid for that type, not one of its own
  allowed literals. Fixed by reusing `parseEnumValues` (newly exported
  from `docgen.ts`) to pick the union's own first member instead. (2) A
  plain required string prop with no default (e.g. `label: string`) also
  got an empty string, which renders as invisible/blank content in the
  live preview -- exactly what made a scanned `Button` component's Review
  preview look "dead": a real button was rendering with no visible label
  at all, easy to mistake for a broken preview rather than an unfinished
  placeholder. Fixed by using the prop's own name, capitalized, instead
  (`label` -> `"Label"`). Also fixed a related bug this surfaced: a
  required FUNCTION-typed prop (`onActivate: () => void`) fell into the
  same string-placeholder branch, which is worse than blank -- a
  component that actually calls the prop would throw "onActivate is not a
  function" the moment someone interacts with the Review preview, not
  just render statically. Fixed with a real, callable no-op (`() => {}`)
  instead -- still never fabricating actual behavior (an optional
  callback prop like a real `onClick` stays intentionally un-wired, left
  for Review to fill in by hand, per this scaffold's existing "starting
  point, not a finished demo" discipline). 2 new unit tests; full suite
  (160 tests) + typecheck + lint all clean. Verified by hand: regenerated
  the auto-scaffolded preview for a real `Button` component in a real
  test project, confirmed it now renders with a visible "Label" instead
  of blank.

- **Phase D — Scan integration, completed.** Wired `detectUiComponentCandidates`
  (below) into `scanForNewArtifacts` (`scan.ts` now calls it alongside the
  four existing markdown-backed kinds and merges results into one array --
  nothing else in those four kinds' own logic touched), the CLI
  (`src/cli/commands/scan.ts` now prints any `candidate.warnings`, not
  kind-gated), and the app UI: Add New's Review step shows a real live
  preview for a `kind: ui-component` Scan candidate, via a new
  `preview.compileLocal` sidecar command (`compileLocalPreview` in
  `resolveArtifactPreview.ts`, calling `compilePreviewHtml` directly --
  no remote/id/version/cache, since the candidate has never been pushed
  and there's nothing to key a cache on yet), plus a warnings banner
  surfacing any import-escape/dedupe findings above the review rows.
  Verified against a real fixture project via the actual built CLI
  (`node dist/index.js scan`), covering every documented case in one
  project at once: a dedicated-folder component, two components sharing
  one folder (forcing the flat/staged path for both), a same-batch id
  collision, an import escaping its folder, and a page-level component
  correctly excluded -- then confirmed both an in-place-scaffolded and a
  staged-and-scaffolded `preview.tsx` actually compile through the real
  pipeline, not just unit-tested in isolation. Added 1 new e2e test
  proving the `scanForNewArtifacts` wiring itself (the detector module was
  already unit-tested on its own) and 2 new `compileLocalPreview` unit
  tests (including one confirming it recompiles fresh on every call rather
  than silently serving stale cached output, unlike `compileArtifactPreview`).
  Full suite (158 tests) + typecheck + lint all clean.

- **Phase D groundwork -- structural UI-component detection for Scan.** New
  `detectUiComponentCandidates` (`src/engine/scan/detectUiComponents.ts`)
  walks `src/**/*.{tsx,jsx}` (excluding `node_modules`, dotfiles/dot-dirs,
  `pages/`/`app/`/`routes/`, and `*.test`/`*.spec` files) and calls
  `parseComponentFile` (newly extracted from `docgen.ts`'s
  `extractPropsSchemas`) on each survivor -- a file only becomes a
  candidate if that parse succeeds and finds a component with a non-empty
  props map, a pure structural/deterministic heuristic with no AI call.
  Candidate ids key off each file's immediate containing folder (`forms-
  button`, not `ui-forms-button`; collapsed to just the folder name when
  it already matches the basename, e.g. `Card/Card.tsx` -> `card`); a
  genuine same-batch id collision between two different files keeps the
  first (by sorted absolute path) and numbers the rest (`-2`, `-3`, ...)
  with a `warnings` entry explaining why -- distinct from the existing
  `IdCollisionError`, which only ever checks against a remote catalog, not
  sibling candidates in the same scan. A component already living in its
  own dedicated folder (the sole detected component in a non-`src`-root
  directory) is proposed in place, auto-scaffolding a `preview.tsx` next to
  it if one doesn't exist; a component with no dedicated folder (flat
  siblings sharing one directory, or sitting directly in `src/`) instead
  gets a copy of itself plus a generated preview staged into a new
  `scanStagingDir(cwd)` (`paths.ts`) -- the original file is never touched.
  Every detected file's own relative imports are statically checked for
  escaping its eventual payload directory and surfaced as `warnings`,
  ahead of (and distinct from) `compile.ts`'s existing runtime
  `createDirectorySandboxPlugin`, which enforces the same boundary but
  fails hard and opaquely at compile time. `ScanCandidate` moved out of
  `scan.ts` into a new `src/engine/scan/types.ts` (its `kind` union now
  includes `'ui-component'`, plus an optional `warnings?: string[]`) to
  avoid a circular import; `scan.ts` re-exports it unchanged and is
  otherwise untouched -- wiring this detector into `scanForNewArtifacts`,
  the CLI, and the app UI is a deliberately separate follow-up. 12 new
  unit tests (`test/unit/detectUiComponents.test.ts`), all against real
  files on disk; full suite (157 tests) + typecheck + lint all clean.

- Fixed the previous fix: re-subscribing the ResizeObserver to the real
  rendered element (see the entry just below) put that element back in
  the observer's own measurement path -- `measureIntrinsicWidth` was
  temporarily setting THAT SAME element's `style.width` to `max-content`
  to measure it, then reverting. Synchronously reverting before the
  callback returns is spec-legal and worked fine in the Chromium build
  used to develop/verify the previous fix, but the real running app
  (WebView2, a different engine/version) does not handle self-mutation-
  during-callback as gracefully: the old one-character-per-line collapse
  came back, confirmed in the real app immediately after that fix landed
  -- and confirmed NOT to be a stale build/cache this time (the actual
  served preview's cached output was checked by hand and already
  contained the previous fix's code). Fixed by measuring against a
  detached clone of the element instead, in a dedicated sandbox container
  attached to `<html>` that the ResizeObserver never watches -- nothing
  the observer watches is ever touched by measurement, regardless of any
  given engine's specific loop-detection heuristics. Chrome could not
  reproduce this bug either before or after the fix (confirmed multiple
  times this session), so verification here is necessarily code-review +
  reasoning about the mechanism, not a Chrome repro -- this one needs
  confirmation against the real WebView2 app specifically.

- Fixed a real, confirmed bug behind a user report of "different style on
  every refresh" for the UI Components preview pipeline: the
  `ResizeObserver` that reports a component's real content size was set
  up with two `.observe()` calls -- `document.body`, and whatever
  `widthMeasureTarget()` (the actual rendered element) returned AT THAT
  MOMENT. Both calls run synchronously at script-setup time, before
  React's initial commit has landed, so the second call ALSO fell back
  to `document.body` and was an unwitting duplicate of the first -- the
  real rendered element was never actually being watched for its own
  future size changes, only `document.body`'s own (shrink-wrapped) box
  re-triggered a re-measure. Anything whose width settles without
  `document.body`'s height also changing (a width-only reflow; text
  re-rendering at a constant line count) went silently unreported.
  Confirmed by hand: reloading the same `decrypting-text` preview
  repeatedly reported different widths (587 vs. 572px) across otherwise-
  identical loads -- whichever render happened to be live at the single
  moment `document.body`'s height first changed got measured and frozen,
  and that moment's exact timing (React's commit scheduling vs. the
  observer's own notification timing) varies run to run. Fixed by
  re-observing whichever element `reportSize()` actually measured on
  every call, upgrading from `document.body` to the real element the
  instant it exists. Also tightened the pre-mount `(0, 0)` guard to skip
  on EITHER axis reading zero, not just both together. Verified by
  reloading the same preview 3 times fresh (not just re-checking one
  load): 591x97 every time, versus the previous 587/572px inconsistency.
  Found via a dedicated code-review pass focused specifically on sources
  of non-determinism, not a guess -- the review traced the exact
  synchronous-vs-async timing gap rather than re-describing already-fixed
  bugs.

- Reworked the "UI Components" page's layout twice in the same session,
  driven by real feedback against the running app:
  - First made preview cards size to their real content instead of a
    fixed height, packed via a vendored bin-packing library (Muuri) into
    a masonry grid (variable width/height, tightly packed). Getting this
    genuinely correct took several real, hand-verified fixes: Muuri
    requires the consumer's own CSS to set `position: absolute` on
    managed items (it only sets `left`/`top`/`transform` itself) --
    missing this caused a "diagonal staircase with huge gaps" layout,
    confirmed and fixed via a real-browser repro (jsdom has no actual
    layout engine, so this class of bug is invisible to it); a CSS
    `transition: height` was racing Muuri's synchronous re-measurement,
    always reading the pre-transition height; and
    `document.documentElement.scrollHeight` -- the original height
    measurement -- is spec'd to never read smaller than the viewport,
    silently breaking every small component (a lone Badge, a row of
    Buttons) by reporting the viewport's size instead of the real
    (much smaller) content height. Fixed by measuring `document.body`
    instead, and by centering the iframe as an element from the parent
    side (`.ui-component-preview-frame`'s own flex-centering) rather than
    inside the iframe's own document, once the iframe had to shrink-wrap
    tightly to its real content for the measurement to be correct.
  - Then replaced the masonry grid with a vertical list entirely (one
    full-width row per component: index number, name, componentTypes tag,
    description, then the live preview) after seeing it next to a
    reference site using this simpler pattern. This is a real
    simplification, not just a different look -- a single-column list
    has no bin-packing problem to solve at all, so Muuri, `position:
    absolute`, the "wide card" heuristic, and the whole vendored-library
    dependency all became unnecessary and were removed. The height-
    measurement and centering fixes above are layout-agnostic and needed
    no changes at all for this pivot.
  - All verified via a real-browser harness (the real `app.js`/`style.css`
    with only the sidecar call (`window.DeliveryOS.call`) and Tauri APIs
    stubbed, driven with real compiled preview data through the actual
    Chrome browser tool) rather than assumption, since jsdom cannot catch
    any of these bugs.

- Fixed the list view's preview frame sitting flush against the row's
  left-aligned text instead of centering in the row's full width (both
  shared the same `max-width: 720px` with no margin, so the frame
  inherited the header's implicit left alignment) -- `margin: 0 auto` on
  `.ui-component-preview-frame` centers it independently once it hits its
  max-width, confirmed via a real-browser measurement showing an exact
  symmetric 156px gap on each side. (Investigating this also surfaced a
  harness-only artifact worth noting: `IntersectionObserver` and a nested
  iframe's own `ResizeObserver` only run during a browser's "update the
  rendering" step, which Chrome can skip entirely for a tab that isn't
  actively being painted -- automation via raw JS execution never forces
  a paint, so previews silently never loaded until a screenshot capture
  forced one. A real user's foreground tab is always being painted, so
  this never surfaces in actual use.)

- Made the preview frame's WIDTH dynamic per component, matching height's
  existing behavior, after real screenshots showed a fixed-width themed
  component (a dark, rounded text box) sitting inside a much wider frame
  with dead space on both sides. Root cause: unlike height (a block
  element's default height shrink-wraps to its content), a block
  element's default WIDTH fills its containing block -- `document.body`
  correctly reports real content HEIGHT, but always reports the frame's
  own full WIDTH regardless of how narrow the real content is, since body
  itself stretches to fill the iframe's viewport either way. Fixed by
  measuring the actual React-rendered element (`#root`'s one child, an
  ordinary flex item with no `flex-grow`, which genuinely shrinks to its
  own content width) instead of `document.body` for the width axis only
  (`compile.ts`'s `injectContentHeightReporter`, still one message, now
  reporting both `width` and `height`). `app.js` clamps and applies width
  the same way it already did height (`clampPreviewWidth`, MIN 240/MAX
  720, mirroring `clampPreviewHeight`), so each row's frame now hugs its
  real content width -- confirmed via real-browser measurement showing
  every row's frame still perfectly centered (symmetric left/right gap)
  but at its own natural width (240px for a lone Badge, 720px for a full
  animated hero, in between for everything else) instead of always 720px.
  A separately reported "hover on the Outline button overflows the card"
  bug, confirmed by the user's own screenshots (the button's border
  visibly escaping its own rounded-corner shape on hover), could NOT be
  reproduced under rigorous real-browser testing (dozens of before/after
  hover screenshots, plus 250+ scrollHeight samples spanning a real hover
  event showing zero DOM change) -- the compiled preview has no
  hover-reactive CSS or layout logic that jsdom-style measurement could
  catch either way, and the visual artifact (a "flag"-shaped border
  overshooting a rounded corner) looks like a transient GPU
  compositing/rasterization seam during a fast CSS transition, most
  likely specific to the real app's WebView2 rendering engine rather than
  Chromium. Left unfixed pending confirmation from the real running app,
  since DeliveryOS's preview frame has no reach into a pushed component's
  own compiled CSS to begin with (by design -- see
  docs/ui-components-feature-design.md's sandboxing rules).

- Fixed two serious regressions the width work above introduced, both
  found by testing against the real running app after the fixes above
  looked correct in an isolated harness:
  - **Runaway shrink to one character per line.** Reading a component's
    plain `scrollWidth` is unstable for anything that can wrap (running
    text, a flex-wrap button row): it only reflects how much the content
    wraps at whatever width it CURRENTLY has, and the parent then applies
    that reading as its NEXT width. A width even slightly narrower than
    the content's true unwrapped size forces one extra wrap, which makes
    the widest remaining line -- and therefore the next reading --
    narrower still, compounding every cycle. Confirmed by hand: this ran
    all the way down to one character per line with a scrollbar. Fixed
    by measuring via a temporary `width: max-content` (asks the browser
    for this element's width if it never had to wrap at all, which does
    not depend on its current width), reverted synchronously before
    anything can observe or paint the intermediate state.
  - **Permanent corruption from a 0x0 pre-mount measurement.** The
    reporter's own immediate call and its `load` listener can both fire
    before React's initial commit has actually landed, reporting (0, 0)
    for a still-empty `document.body`. The parent applied that as the
    iframe's own literal CSS size -- and once an iframe's real rendering
    surface is squeezed to zero, layout inside it comes back corrupted
    even moments later once React DOES mount and takes a real, correct
    measurement (observed by hand: a real 587x97 reading immediately
    followed by a nonsensical 79x1015 on the very next report, and it
    stayed wrong from then on, not a transient blip). Fixed by simply
    never reporting a (0, 0) measurement at all -- the ResizeObserver
    re-fires the moment React's commit actually lands, same as it does
    for any later layout change, so nothing is lost by skipping it.
  - Also added a small (4px) safety margin when applying a reported
    max-content width back as a real container size, since sub-pixel
    font-metric rounding between measurement and render could otherwise
    still wrap content one word early even at its own reported
    "never wraps" width.
  - All three fixes verified with an instrumented, isolated parent+iframe
    repro reproducing the exact message sequence by hand before and
    after each fix, not just eyeballing the running app -- this class of
    bug (a feedback loop through postMessage) doesn't show up reliably in
    a quick visual check, since it can take a few round-trips to diverge.

- Added Storybook-style interactive controls to the "UI Components"
  feature's Detail view (design in `docs/ui-components-feature-design.md`
  §5; full write-up in `PLAN.md`'s Phase C entry): a component's Detail
  page now shows a live preview with variant tabs and a generated
  props-controls panel, instead of just a static first-variant preview.
  - `react-docgen-typescript` derives a props schema (name/type/required/
    default/enum values) from a component's own TypeScript `Props`
    interface -- no hand-written controls schema. Gated on its own spike
    first (mirroring Phase A's discipline): proved correct against the
    real fixture AND verified twice to survive the packaged,
    no-`node_modules` `.exe` (docgen alone, then the full pipeline).
  - The compiled bundle now includes every CSF variant (not just the
    first) plus an embedded `postMessage` protocol -- variant switching
    and prop editing both happen against the same already-loaded iframe,
    no recompile, no further sidecar round-trip. Fixed two real gaps the
    original design left open: a CSF variant has to be *called* (not
    wrapped as a component) to read its real component + starting props
    off the resulting React element, since a zero-arg variant ignores
    props passed via `React.createElement`; and `keepNames: true` had to
    be added to the esbuild call, since minification (already on) renames
    top-level identifiers and would otherwise silently break the
    name-based schema lookup.
  - Corrected the design doc's origin-validation guidance: a `srcdoc`
    iframe's origin is the opaque literal `"null"` for every such iframe
    on the page at once (grid cards stay mounted-but-hidden behind
    Detail), so only `event.source` -- a reference check against a
    specific `contentWindow` -- actually works.
  - The preview cache now stores the whole compiled result (html +
    variants + props schema) as JSON, not just raw HTML
    (`previewCachePath`'s filename renamed `index.html` -> `compiled.json`).
  - An independent code-review pass found and fixed 4 real bugs, not just
    style nitpicks: a genuine race in `loadDetailPreview` (overlapping
    calls -- e.g. quickly opening Detail for two different components in
    a row -- could each attach their own `message` listener, permanently
    leaking the first one), no error handling around calling a variant
    function or rendering (a pushed component's own bug could leave the
    iframe silently blank forever, and a failed variant switch left the
    tab UI out of sync with what was actually showing), the controls
    panel never falling back to docgen's own `defaultValue` for a prop a
    variant didn't explicitly set, and `docgen.ts`'s sibling-file
    discovery being non-recursive (silently missing a component living in
    a subfolder, even though esbuild's own import sandboxing already
    supports that layout). All fixed, plus new regression tests for the
    nested-file and partial-parse-failure cases.
  - All 135 tests pass; typecheck/lint clean; a real packaged-`.exe` run
    with `node_modules` hidden confirmed the full pipeline (esbuild +
    docgen + harness together). One gap honestly flagged, not silently
    skipped: jsdom can't execute scripts inside a `srcdoc` iframe or fake
    a legitimate cross-window `event.source`, so the actual "switch
    variant, watch it re-render" loop -- and the app.js receiving side in
    general, which has no automated coverage at all, same as every other
    frontend function in this project -- needs a real two-window browser
    check by hand.

- Added the "UI Components" feature (design in
  `docs/ui-components-feature-design.md`; full write-up in `PLAN.md`'s
  Phase A/B entries): a new sidebar page shows real pushed React/TS and
  plain-HTML/CSS/JS components as live, interactive preview cards, grouped
  by a new `tags.componentTypes` dimension (threaded end to end -- schema,
  `push`/CLI `--component-types`, Add New's tag-picker, and Detail's Edit
  form, matching roles/teams/stacks).
  - Each preview compiles via native `esbuild` (not `esbuild-wasm`, whose
    only Node path can't survive the sidecar's Node SEA packaging) into a
    single self-contained HTML document, genuinely self-contained: React
    19 ships no UMD build, so a one-time build script
    (`scripts/generate-vendored-react-runtime.mjs`) bundles React/ReactDOM
    into a vendored IIFE runtime baked into the sidecar itself, with no
    `node_modules` resolution at preview-compile time at all -- proven by
    an isolation test that hides `node_modules/react`+`react-dom` entirely
    and confirms compilation still succeeds.
  - Renders inside a `sandbox="allow-scripts"` iframe (no
    `allow-same-origin`) with a strict injected CSP (`default-src 'none'`),
    closing the gap where the sandbox attribute alone blocks DOM/cookie
    access but not outbound network calls. Relative imports are sandboxed
    to the component's own directory (rejects any path-traversal import),
    proven by a dedicated fixture.
  - Compiled previews are cached globally (keyed by remote/id/version, not
    per-project) with an atomic, path-traversal-guarded write, so browsing
    the same catalog from a different project never pointlessly recompiles.
  - All 125 tests pass; typecheck/lint clean; a code-review pass (and a
    second pass over that pass's own fixes) caught and fixed 7 further
    issues (an `IntersectionObserver` leak across re-renders, a
    click-target dead zone over the live preview plus its own leftover
    "clickable" cursor/hover styling, missing `--component-types` CLI test
    coverage, the vendored-runtime generator not chained into
    `build`/`test`, Detail not showing/editing `componentTypes`, and an
    orphaned `.tmp` file left behind if the atomic cache write ever fails
    mid-way). Two gaps left deliberately open (not silently
    dropped): the preview cache has no explicit pruning of superseded
    versions, and the import sandbox isn't symlink-aware.

- Reworked the growtharc-ai-helpers import for real structural fidelity to
  the source backup:
  - Fixed the 67 agents, which had pulled flat into `.claude/agents/<id>.md`,
    losing the source's category subfolders (`agents/java/`,
    `agents/engineering/`, ...). Now `.claude/agents/<category>/<id>.md`,
    matching the reference exactly (`payload_path` -- where each file
    actually lives in this repo -- is unchanged, only where a pull installs
    it changes).
  - Imported `.claude/commands/` (30 artifacts: 19 java commands + a bundled
    `java-command-references` for their shared `references/` folder, 8
    orchestration commands, `extract-ui`, and `design-system` -- bundled
    with its own nested `design-system/references/` subfolder so the exact
    sibling file+directory layout survives a pull). `architect`,
    `java-reviewer`, and `design-system` renamed with a `-cmd` suffix where
    they'd otherwise collide with an existing agent/skill id.
  - Imported `.claude/rules/` (35 artifacts across common/java/python/rust/
    typescript). Rule files use a `paths: [glob, ...]` frontmatter
    convention, never `description:`, so descriptions are derived from each
    file's own first heading instead. Several filenames repeat verbatim
    across categories (`coding-style.md`, `security.md`, `testing.md`, ...)
    -- ids are `<category>-<name>`, with a few further disambiguated
    (`-rule` suffix) where that still collided with an existing command or
    skills-lib skill id.
  - `deliveryos scan` (and the app's Scan view) now also look at
    `.claude/commands` and `.claude/rules`, recursively (commands/rules
    commonly nest into category subfolders, unlike the one-level-deep
    agents/skills) -- every `.md` file found becomes its own candidate,
    `installTarget` preserving whatever subfolder it was actually found in.
  - Verified via a real pull of a representative sample (an agent, a java
    command alongside its shared references, the design-system/extract-ui
    sibling structure, and rules from two different categories) --
    byte-identical content, exact folder structure, including files with
    identical basenames in different categories not colliding.
  - `growtharc-ai-helpers` now has 210 artifacts total (67 agent + 78 skill
    + 30 command + 35 rule).

- Added `deliveryos scan` (CLI, sidecar, and a "Scan for new agents/skills"
  button in Browse): finds agents/skills sitting in a project's
  `.claude/agents` and `.claude/skills` that aren't tracked in the lockfile
  yet and don't already exist (by id) in a chosen remote's catalog, with a
  best-effort guessed `description` from each file's own frontmatter. The
  CLI prints a ready-to-edit `push --new` command per candidate; the app
  navigates each one into Add New with id/kind/description/payload
  pre-filled, roles/teams/stacks left blank for review (no reliable
  folder-category signal in a flat `.claude/agents/` directory to guess
  those from). Added an optional Install Target field to Add New so a
  scanned agent can actually round-trip back to `.claude/agents/<id>.md`
  instead of always defaulting to a folder named after the id.

  Verified fully end to end against the real growtharc-ai-helpers remote:
  created a real local agent file, ran the real CLI's `scan`, edited its
  guessed roles/stacks, pushed for real (PR #23), merged, pulled it back,
  and confirmed it landed as a real file. Cleaned up the demo artifact
  afterward.

- Added remote removal: `deliveryos remote remove <name>` (CLI) and a
  "Delete" button per row in Settings (app), both unregistering the remote
  and deleting its local cache clone. Deliberately doesn't touch any
  project's lockfile/pulled files -- those stay on disk exactly as pulled;
  only the ability to pull/push against that remote again (until it's
  re-added) goes away. Confirm-gated in the app. Covered by new sidecar and
  real-CLI-subprocess e2e tests (success, cache-deletion, and the
  unregistered-name error case).

- Fixed a latent bug in `push --new` (propose-new): a single-file payload
  was always wrapped in the standard `artifacts/<id>/payload/` convention
  (a directory, even for one file), which broke `pull` the moment
  `install_target` was itself a file path (e.g. `.claude/agents/<id>.md`)
  -- `pullArtifact`'s `fs.cpSync` created `install_target` as a directory
  containing the file instead of the file itself. This is the exact bug
  found and fixed as a one-off data correction for the
  growtharc-ai-helpers agent import; this fixes it in the engine itself so
  it can't recur. Single-file payloads now get `payload_path` pointing at
  a real, stable location (`files/<id>/<basename>`) instead of the
  wrapper. Directory payloads are unaffected. Covered by a new e2e test
  that actually pushes, merges, and pulls back a file-shaped
  `install_target` end to end (not just asserting the commit contents).

- Added an Edit button to Detail: description/roles/teams/stacks can now be
  changed on an already-tracked artifact without touching its payload at
  all -- opens a PR against just `manifest.yaml`, same PR/pendingPr/"Check
  push status" transparency an ordinary edit push already gets. New engine
  mode `pushArtifact({metadataEdit: {...}})`, only ever committing
  `artifacts/<id>/manifest.yaml`. Also wired into the CLI:
  `deliveryos push <id> --description/--roles/--teams/--stacks` (without
  `--new`) now does the same edit instead of being silently ignored, which
  is what those flags did before this outside `--new`. Covered by new e2e
  tests (real branch/commit/PR content, plus a no-op case) and unit tests
  for the CLI's flag routing.

- Add New (propose-new) could only tag a new artifact with `roles` -- there
  was no way to set `stacks`/`teams` from the app at all, so anything
  proposed through the UI could never show up under Browse's "stack" or
  "project" tag folders. Added matching Stack and Team/project fields to the
  form.

- Tag values (stacks/roles/teams) now normalize case consistently end to
  end: "python" and "Python" pushed on different occasions previously
  produced two separate tag folders instead of one. Add New's form fields
  and the CLI's `--roles`/`--teams`/`--stacks` flags now lowercase on the
  way in (canonical data at the source), and Browse's own tag
  matching/deduping (`entriesForTag`, the tag value list) is
  case-insensitive as a second line of defense for tags from outside this
  app (an existing manifest, a hand-edited one). Covered by a new unit test
  for the CLI's flag-to-`PushOptions` mapping, which had no test coverage
  at all before this.

- Fixed the shared progress panel staying visible after navigating away
  from the artifact/folder it belonged to. `openDetail`/`openTagFolder`
  already reset it on the way *in*; nothing reset it on the way *out* --
  clicking "Back to Browse" (from Detail or a Tag Folder) left the last
  action's log showing underneath the plain artifact grid, where it should
  never appear. `showView()` (Browse/Settings/Add New's entry point) now
  resets it too, leaving Detail/Tag Folder's own reset-on-entry untouched.

- The progress-log overflow fix above turned out incomplete -- it stopped
  `.msg` forcing `.progress-panel` wider, but `#main` is itself a flex item
  of `#app` (display:flex, column direction) with the same default
  `min-width: auto`, so a wide enough descendant could still force `#main`
  -- and with it the whole page -- wider than the viewport, independent of
  any individual component's own fix. Added `min-width: 0` to `#main`
  (the actual fix) plus a global `overflow-x: hidden` on `body` as a safety
  net, so this class of bug can't resurface from some other component later
  without someone remembering to fix it locally too.

- Full review pass over the tag-folder/bulk-pull work after repeated
  layout complaints, and fixed everything found:
  - **"Pull all" in a Tag Folder never showed the progress log at all** --
    `handleTagFolderPullAll` called `artifact.pull` directly in a loop
    without ever calling `beginProgress()`/`endProgress()`, unlike every
    other action in the app. Only the button's own "Pulling i/N" label
    updated; the shared log panel just never turned on. Now begins once
    before the loop (each pull is awaited fully before the next starts, so
    their stage lines land in order with no interleaving) and ends once
    after, giving one continuous log across the whole bulk pull.
  - **The progress log overflowed past the page edge** on a long Windows
    path (e.g. `Copying payload files to
    C:\Users\...\Project-test\.claude\skills\engagement-kickoff`). Root
    cause: `.progress-line`'s `.msg` is a flex child with no `min-width: 0`,
    so it refused to shrink below its own unbroken content width (backslash
    -separated paths have no natural break point) and forced the whole
    panel wider than its container. Fixed with `min-width: 0` +
    `overflow-wrap: anywhere` on the message, plus defensive `overflow-x:
    hidden` on the panel and log.
  - Moved the shared progress panel from a sibling of `<main>` to a plain
    child of it (last thing inside `<main>`, after every `.view` section).
    It's not part of the `.view` rotation (no `view` class, so view-
    switching never touches it), but `#main` has `flex: 1`, so as a sibling
    it was pinned to the very bottom of the window regardless of how little
    content was above it -- moving it inside `#main` means it now appears
    directly under whichever view is showing, and picks up `#main`'s own
    width/centering/padding for free (the now-removed `.content-width`
    rule was a workaround for the wrong problem).
  - Stale comments referring to "Detail's action button is the sole
    trigger" (no longer true since Tag Folder rows/Pull-all also drive the
    same shared panel) corrected.

- Restyled the tag value list again: the plain chevron-list read as dated
  ("Windows XP style") and left most of the page empty. Now a card grid
  matching the app's own res-card look (shadow, rounded corners, hover
  lift, expands to fill the row), each card showing how many artifacts
  carry that tag (e.g. "3 artifacts") instead of just a bare name.

- Fixed the artifact grid still showing while a tag category was expanded,
  even after the previous fix that set `grid.hidden = true` for exactly that
  case. Root cause: `.grid { display: grid; }` (an author rule) beats the
  browser's own `[hidden] { display: none }` rule at equal CSS specificity,
  so setting the `hidden` attribute on `#card-grid` silently did nothing.
  Added a single global `[hidden] { display: none !important; }` rule so the
  `hidden` attribute always wins app-wide, instead of a one-off override.

- Restyled the tag value row (python/java/typescript/...): first pass used
  boxed folder icons, which read as heavy/cluttered; now a clean breadcrumb-
  style list ("name  >") using the app's existing brand tokens, with the
  main artifact grid hidden while a tag category is expanded (previously it
  stayed visible underneath, showing an unrelated full artifact list at the
  same time as the tag picker).

- Added tag-based bulk pull in the app, as its own navigable Tag Folder view
  (not an inline filter of Browse's own grid). Browse gets a tag category row
  (stack/role/project); picking one reveals that category's own values (e.g.
  stack → python, java). Picking a value opens a dedicated view -- its own
  "← Back to Browse", same pattern as Detail -- listing every artifact with
  that tag grouped by kind (agent/skill/template/...), each row with its own
  inline Pull/Push/Update button so acting on one doesn't require opening
  Detail first, plus a "Pull all (N)" button for the whole folder. Clicking a
  row opens the existing, unchanged Detail view. The shared progress/log
  panel (previously only reachable from Detail) was moved to be page-level
  so it lights up the same way regardless of which view triggered the
  pull/push. Answers the actual request: pulling "python" should pull every
  python-tagged agent/skill/template, not just one artifact at a time by id.
  Artifacts that are `edited_locally`/`both_changed` are never swept into a
  bulk pull -- those still go through Detail's existing per-artifact
  confirmation, unchanged.

- Fixed a crash proposing a new artifact whose payload is a single file
  (e.g. picking one `.md` file via the app's file picker instead of a
  folder): `Cannot overwrite directory ... with non-directory ...`.
  `fs.cpSync` can't copy a file onto a path that already exists as a
  directory (the freshly-created `payload/` dir) -- now copies a
  single-file payload to `payload/<filename>` directly instead. Covered by
  a new regression test.

- Added transparency about what happens to a push after it opens a PR.
  Pushing never updated local state on its own (the edit isn't accepted
  just because a PR exists), so there was no way to later tell "still
  open" from "merged" from "rejected" — an edit that got merged looked
  identical to one still sitting unreviewed. Edit-mode push now records
  the opened PR against the artifact's lockfile entry
  (`pendingPr: {number, url}`); Detail shows it and a "Check push status"
  button that asks GitHub for that PR's real state. Merged resyncs the
  pristine snapshot (so `edited_locally` correctly resolves back to
  `pulled`) and clears the tracking; still-open leaves everything as-is;
  closed-without-merging clears the tracking but deliberately leaves the
  local edit untouched, since that divergence is still real. Only covers
  pushes made after this shipped — an edit pushed and merged before this
  existed has no `pendingPr` to check; re-pulling it once resyncs status
  the same way a merge-driven resync would.

## Unreleased

- Fixed a real bug found while demo-prepping `arcos-cli`: simply *running*
  a pulled Python tool (`arcos --help`, `pytest`, etc.) generates
  `__pycache__`/bytecode cache files, which are correctly excluded by the
  project's own `.gitignore` — but `computeChangedFiles` didn't know about
  `.gitignore` at all, so it misread that cache as a "local edit," flipping
  a perfectly fine pull to "Edited locally" and making a real `push` fail
  outright trying to stage gitignored paths. Fixed by filtering the diff
  through the artifact's own `.gitignore` (already present in the pulled
  copy) via the `ignore` package. Verified directly against the real,
  previously-broken `arcos-cli` folder, plus two new unit tests.

- Fixed `push --new` (Add New in the app) copying a whole project folder's
  payload verbatim, unfiltered. Proposing something like a project template
  (not just a single doc) via "Choose folder..." would previously copy
  *everything* underneath it into the remote's tracked catalog, including a
  nested `.git/` (which git would try to treat as an embedded repo rather
  than plain files once committed) and anything the project's own
  `.gitignore` excludes (`node_modules/`, build output, caches) -- neither
  was filtered the way an edit-mode push's diff already is. `.git` is now
  skipped unconditionally while walking the payload (regardless of
  `.gitignore` content, since a project's `.gitignore` typically doesn't
  even list `.git` -- git never applies it there); everything else is
  filtered through the same `.gitignore`-aware logic edit-mode push already
  uses. Covered by a new e2e test asserting the actual committed tree in a
  real git fixture.

- Fixed `push --new` crashing with `fatal: '...' is not a valid branch name`
  whenever the proposed artifact's id contained a space or uppercase letter
  (e.g. typing "GrowthArc-Brand Guidelines" into the Add New form's free-text
  ID field) — git branch refs can't contain whitespace. The branch name
  builder now slugifies the id (lowercase, invalid characters collapsed to
  `-`) before using it. The Add New form's Artifact ID field also now
  validates client-side (lowercase/digits/hyphens only) so this is caught
  with a clear message before a push is even attempted, not as a raw git
  error after the fact.

- Fixed Browse's "Refresh" never actually refreshing from the remote — it
  only re-read whatever was already cached on disk. An artifact proposed via
  Add New and then merged upstream would never appear until *something else*
  happened to fetch that same remote (e.g. later pulling an unrelated,
  already-tracked artifact from it), since neither plain Refresh nor "Check
  for updates" (which only fetches remotes with existing lockfile entries)
  covered that case. Refresh now calls a new `catalog.refresh` that fetches
  every registered remote first, tolerating individual remote failures so
  one unreachable remote doesn't block the rest. Scoped to the Refresh
  button only — every other internal catalog reload (folder switches,
  post-push/pull re-renders) still uses the fast, local-only `catalog.list`,
  so this doesn't reintroduce network flakiness into paths that don't need it.

- Fixed `edited_locally` having no way to resolve in the UI at all. Detail's
  action button only ever offered "Push" for that status, so an edit that
  was actually already pushed and merged upstream (or one the user simply
  wanted to discard) had no path back to "Pulled" short of manually deleting
  files on disk. The drift-warning block (previously shown only for the
  rarer `both_changed` case) now also appears for plain `edited_locally`,
  with a "Discard local edit and re-sync" button that re-pulls after an
  explicit confirmation.

- Restyled the desktop app end to end against `DESIGN_SYSTEM.md` (the app's
  own navigation/views are unchanged — Browse, Tag Folder, Detail, Add New,
  Settings, Scan — only the visual language). The color palette in
  `style.css` already matched the design system's hex values almost exactly;
  the actual work was renaming every token to the design system's own names
  (`--primary-700/800/900`, `--sage-*`, `--sand-*`, `--accent-500`, etc.),
  setting headings to `font-weight: 400` per its typography table (previously
  500), adding real `.btn-accent` (purple, AI-specific actions) and
  `.btn-ghost` (text-only, inline actions) button variants alongside the
  existing default/outline/danger-ghost ones, an accessible `:focus-visible`
  ring, and a `prefers-reduced-motion` block disabling every animation.
  Also caught and fixed 3 places that had been using an AI-reserved token
  (cyan) for plain, non-AI status UI — the hint banner, the push-status
  panel, and the "update available" badge — which the design system's own
  "warm tones for regular UI, AI tones for AI-specific elements only" rule
  explicitly calls out as wrong; all three now use the warm sand/gold tones
  instead. Scan's frontmatter-guessed descriptions (the one place in the app
  that's genuinely AI-driven inference) now get a small purple "AI guessed"
  sparkle badge, and the Scan view's own "Scan" button uses the new
  `.btn-accent` variant, matching the design system's guidance to reserve
  the purple/glow treatment for AI-specific elements rather than applying it
  app-wide.

- Real filter/sort/search gaps closed in the app, on top of the restyle
  above:
  - Kind chips are now multi-select (e.g. view "agent" + "skill" together)
    instead of one at a time, and the selection now also applies inside an
    open Tag Folder, which previously ignored it entirely.
  - Added a Remote filter (a `<select>`, populated from whatever remotes are
    actually represented in the loaded catalog) and a Sort control (Name /
    Kind / Status), both applying to Browse's grid and an open Tag Folder.
  - Search now matches kind, owner, and every tag value, not just id and
    description. Tag Folder gets its own scoped search box (independent of
    Browse's), and the stack/role/project value list gets a "Filter
    values..." box for categories with a lot of values.
  - Generalized Tag Folder's "Pull all" into a shared `bulkPull()` and added
    the same capability to Browse itself — "Pull all (N)" now pulls
    everything currently matching the active Kind/Remote/search filters, not
    only a tag folder's contents.
  - Both empty states (Browse's grid, an open Tag Folder) now say so
    explicitly when filters are the reason nothing's showing, instead of a
    generic "no results".
  - The Browse toolbar (search, filters, sort, pull-all, refresh, updates,
    scan, add-new — 8 controls) was flattening into one cramped, wrapping
    line; restructured into a search+primary-action row and a
    filters-left/utilities-right row underneath.
  - Renamed "Scan for new agents/skills" to "Scan for new content" — it's
    covered commands/rules since the earlier scan-extension work, and the
    button label had never been updated to match.
  - Removed the lightning-bolt logo mark from the topbar per explicit
    request; just the "DeliveryOS" wordmark remains.

- Add New's Kind field is now populated from every distinct kind already in
  the catalog, with a "+ New kind..." option that reveals a text input for
  inventing one that doesn't exist yet — kind stays open-ended by design
  (see ARCHITECTURE.md), this is just a convenience for the common case of
  reusing "agent"/"skill"/etc. instead of retyping it from memory.
  Roles/Stack/Team fields (in both Add New and Detail's Edit form) became a
  small chip-picker component (`createTagPicker`) backed by a `<datalist>`
  of values already used elsewhere in the catalog, replacing the old raw
  "type a comma-separated list and hope you spell it the same as last time"
  text inputs — still fully free-text (a new tag is just as valid), just
  easier to reuse an existing one without a near-duplicate typo ("python" vs
  "Python") creating a second, separate tag folder.

- Turned Add New into a step-by-step wizard instead of one long scrolling
  form: one field/group visible at a time, a progress bar, Next/Back, and a
  final Review step (every field summarized, each with its own "Edit"
  button jumping straight back to that step) before the real Propose
  submit. Kind and Remote — both low-cardinality, fixed-ish choices —
  became clickable `.chip` buttons (the same look Browse's own Kind filter
  already uses) instead of native `<select>` elements, which render with
  OS-default chrome that doesn't match the rest of the app and hide every
  option behind a click to open the dropdown; a new `createSingleChipPicker`
  is the single-select counterpart to the existing multi-value
  `createTagPicker`. Enter anywhere in the form now advances to the next
  step (except inside a tag picker's own input, where Enter means "commit
  this chip and keep typing," and except on Review, where Enter doing
  nothing is safer than an accidental submit). Scan's "Review & propose"
  jumps straight to the Review step instead of forcing a click through 9
  mostly-empty-looking steps, since most required fields are already
  prefilled — worth flagging: Owner is never prefilled by Scan, and a
  required field on a hidden wizard step is exempt from the browser's own
  native validation (an element that isn't rendered is barred from
  constraint validation), so `submitAddNew` now re-checks
  description/owner/kind/remote explicitly and jumps back to whichever step
  is actually blank, rather than silently letting an empty required field
  slip through to the engine.

- Full sidebar-based shell, replacing the top bar (`branch: sidebar-revamp`,
  built from a static mockup iterated with the user and design-researched
  against real products before any real code changed):
  - `#app` restructured from `header.topbar + main` into a left
    `nav.sidebar` (Browse, Browse by tag, Settings, a divider, Scan, Add
    New — every one a real destination, `showView()`-driven) plus a
    `.content-shell` (a slim context strip holding the project folder +
    Change folder, then `main`). Every `[data-view]` element (sidebar
    items and every view's own "← Back to ..." button) is now wired
    identically in `wireEvents()`, rather than special-casing the sidebar
    separately from back-buttons.
  - **Browse by tag** is a new, real sidebar destination/view — not an
    inline expansion of Browse's own grid (dumped variable-length tag data
    next to stable content), not a permanently-expanded sidebar section
    (same problem, different container), and not a flyout popover
    (inconsistent with every other sidebar item, which all go to a real
    page). Category tabs (stack/role/project, single-select, whichever
    actually have values) plus a plain list of that category's values,
    sorted by count descending, each row reusing Browse's own `.res-card`
    visual language with a real icon per value (`tagValueIconParts` — a
    small curated map for common stack values like python/java/rust/
    typescript, generic fallbacks for role/project and any unrecognized
    stack). Clicking a value opens the existing, unchanged Tag Folder
    view. The old inline `tag-category-row`/`tag-value-row` machinery in
    Browse is gone.
  - Kind filtering is now an underline tab bar (`.tab-row`/`.tab`) instead
    of pill chips, reading as a deliberate filter control rather than a
    generic row of buttons — pure CSS/markup change, the existing
    multi-select `state.activeKinds` Set logic is untouched.
  - Added a real kind-icon system (`kindIcon`/`kindSwatchHtml` in
    `app.js`, `KIND_ICON` map with a neutral-diamond fallback for any kind
    not listed, since kind stays open-ended per ARCHITECTURE.md) — used on
    Browse's cards, Detail's header, and every kind-grouped row (Tag
    Folder, Scan). Browse's cards themselves got a richer treatment to
    match: icon swatch + EB Garamond name/kind-label pair up top, matching
    the exact same card language now reused by Browse-by-tag's list rows.
  - Removed the redundant "Scan for new content" toolbar button from
    Browse now that Scan is a first-class sidebar destination; kept "+ Add
    new" in the toolbar as a quick-access shortcut alongside its own
    sidebar item, since proposing something is common enough to warrant
    both entry points.

- Removed the "AI guessed" sparkle badge from Scan results entirely — on
  reflection it read as a gimmick rather than useful signal, and every
  candidate's description is editable in Add New/the wizard's Review step
  anyway, so flagging which ones were guessed didn't change what anyone
  would do next. Deleted `.ai-badge`/`.ai-badge .sparkle`/`@keyframes
  neural-pulse` from `style.css` (including their mention in the
  `prefers-reduced-motion` block) and the badge-building block from
  `renderScanResults()`.

- Add New is now two modes sharing one form and one `submitAddNew`, not one
  fixed flow: direct entry (sidebar "Add New", Browse's "+ Add new") shows
  every field at once, flat, no wizard chrome — real feedback on the
  step-by-step wizard above was that stepping through mostly-blank fields
  by hand felt like too many steps ("add new gives the step by step, i
  dont feel its so good"). Scan's "Review & propose" still gets the full
  step-by-step wizard (progress bar, Next/Back, a final Review step with
  per-field Edit) — the one place it was already agreed to be an
  improvement, since most fields arrive prefilled and Review's per-row Edit
  is what actually saves a click. Implementation: the same `.wizard-step`-
  wrapped fields now render either all-at-once or one-at-a-time depending
  on a new `addNewWizardMode` flag (`false` for direct entry, `true` for
  Scan's flow) — `renderWizardStep()` branches on it to decide which
  `.wizard-step`s are hidden and whether the progress bar/nav/Review show
  up, so there's exactly one copy of every field's markup and one
  `submitAddNew` validation path regardless of mode.

## Phase 5 — Polish (in progress)

- Added drift detection: `deliveryos check-updates` (CLI) and a "Check for
  updates" button in Browse (app) compare each pulled artifact's recorded
  version against its remote's current version (fetching only remotes the
  lockfile actually references, not every registered one). A pulled artifact
  that's both locally edited AND has an upstream update gets a distinct
  "Both changed" state with no one-click action — updating it requires an
  explicit confirmation, so the existing Update button can never silently
  overwrite a local edit.
- Added background auto-sync: a 20-minute Rust-side timer periodically
  reruns the same check-for-updates logic automatically (no new
  engine/sidecar code — just a timer event the frontend already knew how to
  handle). Stays quiet on routine no-op ticks, only toasts when it actually
  finds new updates.

## Phase 3 — Tauri app — **Done**

- Added live progress visibility during Pull/Push: `pullArtifact`/`pushArtifact`
  gained an optional `onProgress` callback (no-op for CLI, unchanged
  behavior there), the sidecar streams `{event:'progress'}` lines mid-call,
  and the Rust host forwards them as Tauri events. Detail view now shows a
  real, honest activity log (named stages, not a fake percentage bar —
  there's no way to know "80% done" for an arbitrary shell command).
- Restructured Browse cards: no more per-card Pull/Push button — the whole
  card opens Detail, and Pull/Push (with the new progress log) happens from
  there instead.
- Added an "Open folder" button in Detail, using `revealItemInDir` (not
  `openPath`) so it works consistently whether the artifact's install
  target is a file or a directory. Found and fixed two real bugs during
  QA: the opener permission had no scope (every real path was rejected),
  and the initial implementation used `openPath` which launched single-file
  artifacts in their default editor instead of revealing them in Explorer.

- Added `--post-install <cmd>` to `push --new` (CLI) and a "Setup command"
  field to the Add-new form (app), closing a real gap: proposing a
  brand-new artifact previously had no way to declare its own setup step
  (`npm install`, `pip install -e ".[dev]"`, etc.) through the normal flow —
  it could only be added by hand-editing the generated `manifest.yaml`
  before merging. Verified fully end-to-end through the real GUI: filled
  in the form, opened a real PR, merged it, pulled the new artifact, and
  confirmed on disk that the setup command actually ran.
- Fixed a UI bug: the "Refresh" button (and any other button using the
  shared `withBusy` helper in `src-tauri/spike-ui/app.js`) could get
  permanently stuck showing "Working..." instead of its real label. Cause:
  `withBusy` wasn't safe against two overlapping calls on the same button
  (e.g. picking a project folder triggers a catalog refresh, and if a
  Pull's own post-success refresh overlapped with it before the first
  finished, the second call captured "Working..." as its own "restore to"
  value). Now each button's true idle label is remembered once and a busy
  counter ensures only the last of several overlapping calls restores it.
  This file has no automated test coverage (ESLint only scans `.ts` files),
  so the fix was verified by deliberately reproducing the exact race
  through the real running app and confirming the button always settles
  back correctly, including under rapid-fire clicking.
- Fixed a real bug found while testing `arcos-cli`/`launchpad-template`
  through the actual GUI: `pull`'s pristine snapshot was taken *before*
  `post_install` ran, so post_install's own generated files (`node_modules/`,
  a fresh lockfile, an `.egg-info/` dir) were misread as local edits —
  every freshly-pulled artifact with a `post_install` step showed
  "Edited locally" instead of "Pulled" (and, for a real Push, would have
  tried to commit those generated files into a PR). Now snapshots pristine
  from `installTarget` *after* `post_install` completes. Verified both via
  a new regression test (`test/e2e/sidecar.e2e.test.ts`) and a live re-test
  through the real app.
- Added `src/sidecar.ts`: a newline-delimited-JSON stdio dispatcher wrapping
  the existing engine directly — the foundation for the desktop app's UI to
  talk to the engine without duplicating any logic. Now implements 5
  commands: `catalog.list` (with a computed `localStatus` per artifact —
  `not_pulled`/`pulled`/`edited_locally`), `artifact.pull`, `artifact.push`,
  `remote.list`, `remote.add`.
- Packaged the engine as a standalone Node Single Executable Application
  (SEA), confirmed to run without a Node install on the machine (~88MB).
- Built a real Tauri v2 desktop UI (Browse, Detail, Add-new, Settings) via
  one generalized `sidecar_call` Rust command — every future sidecar command
  needs zero new Rust code. Styled with the ArcFlow brand system (colors,
  EB Garamond/IBM Plex Sans/JetBrains Mono typography). Deliberately omits
  onboarding/sign-in, sync/drift banners, conflict resolution, version
  history, and profile switching — none have engine support yet; see
  [docs/phase-3-ui-scope.md](docs/phase-3-ui-scope.md) for the full
  section-by-section scope decision.
- Real MSI (37.78MB) and NSIS (25.44MB) installers build successfully.
- Measured cold-start latency: green on the median (~108ms), with a
  yellow-band tail (up to ~391ms) surfaced by independent re-testing — not
  blocking. Full write-up: [docs/phase-3-spike-results.md](docs/phase-3-spike-results.md).
- Fixed a latent bug: `pull`'s `post_install` step used `stdio:'inherit'`,
  which would have corrupted the sidecar's JSON stream — now captured via
  `stdio:'pipe'` and surfaced explicitly, with no CLI-visible regression.
- Fixed during review: the Rust `sidecar_call` command could leak orphaned
  sidecar processes on certain error paths (missing `child.kill()` calls) —
  now killed on every return path.
- Added sidecar-level e2e tests (`test/e2e/sidecar.e2e.test.ts`) driving the
  JSON-RPC protocol directly, since no GUI-automation tool exists for a
  native Tauri window here. One known coverage gap: `artifact.push`'s
  success path can't be tested through the sidecar itself (no way to inject
  a fake GitHub client across the process boundary) — only verified via the
  manual runbook. See [docs/manual-ui-clickthrough.md](docs/manual-ui-clickthrough.md).
- Added [REQUIREMENTS.md](REQUIREMENTS.md) documenting the Rust/MSVC/Tauri
  toolchain needed to build this and future Phase 3 work.

## Phase 2 — ArcOS as a remote

- Added an optional `payload_path` manifest field (relative to the remote's
  repo root) so `pull`/`push` can read from and diff against a real,
  pre-existing file or directory elsewhere in a remote's repo, instead of
  requiring payloads to live under `artifacts/<id>/payload/`. Fully
  backward-compatible — manifests without it behave exactly as before.
  Propose-new mode is unaffected (always uses the classic convention, since a
  brand-new artifact has no pre-existing real file to point at).
- Wrote real DeliveryOS manifests for two actual ArcOS catalog assets
  (`code-reviewer`, `engagement-kickoff`), using `payload_path` to point at
  their real files rather than duplicating them.
- Proved the full pull -> edit -> push -> PR loop end to end against real
  ArcOS catalog content, via a personal scratch repo
  (`ashwin-growtharc/arc_os-catalog-poc`) rather than the shared
  `growtharc/arc_os` repo directly (forking is disabled there at the org
  level). See [docs/phase-2-retro.md](docs/phase-2-retro.md) for the full
  write-up, including an open governance question about whether ArcOS's
  "core needs 2 reviewers" convention actually applies to catalog assets
  under its own current rules.

## Post-Phase-2 addendum — two more real artifacts

- Added `arcos-cli` (`kind: template`, `review_required: false`,
  Pull-only) to the existing `ashwin-growtharc/arc_os-catalog-poc` scratch
  remote: a full mirror of the real `growtharc/arc_os` repo's 75 tracked
  files, hand-copied into an `arcos-mirror/` subdirectory (not the repo
  root, to avoid colliding with that same remote's own Phase 2
  `artifacts/`/`catalog/`/README content) and referenced via
  `payload_path: arcos-mirror`. `post_install: pip install -e ".[dev]"`
  verified to run and succeed for real. See
  [docs/artifact-arcos-cli-retro.md](docs/artifact-arcos-cli-retro.md).
- Added `launchpad-template` (`kind: template`) to a brand-new scratch
  remote, `ashwin-growtharc/launchpad-template-poc`, seeded with a real
  copy of Launchpad's actual Next.js "Hello World" starter kit (20
  git-tracked files). DeliveryOS's first artifact sourced from a project
  with no relationship to ArcOS at all; confirms the manifest schema and
  pull/push mechanics are genuinely payload-agnostic — no engine changes
  were needed. `post_install: npm install` verified to run and succeed for
  real. See
  [docs/artifact-launchpad-template-retro.md](docs/artifact-launchpad-template-retro.md).
- Both were verified end to end via the real, built CLI (`remote add` →
  `list --json` → `pull`) against fresh scratch `DELIVERYOS_HOME`/cwd
  pairs, independent of any earlier manual testing session. Zero
  `src/`/`test/` diffs were needed for either — confirmed by `git status`
  on the engine directories before and after.

## Phase 1 — Push

- Added `deliveryos push <id> [--remote <name>]` — pushes a local edit to a
  previously-pulled artifact as a branch + real GitHub PR against its owning
  remote.
- Added `deliveryos push <id> --new --remote <name> --path <dir> --kind <kind>
  --owner <owner> --description <text> [--install-target <path>]
  [--artifact-version <semver>] [--review-required] [--roles ...] [--teams ...]
  [--stacks ...]` — proposes a brand-new artifact via the same PR flow.
- Diff detection via a pristine payload snapshot taken at pull time
  (`.deliveryos/pristine/<id>`), compared against the live `install_target` at
  push time.
- GitHub PR creation via Octokit, authenticated through `gh auth token`
  (ambient `gh` CLI credentials — no new credential storage).
- Auto-drafted PR title/body templates for both edit and propose-new pushes.
- Id-collision detection on propose-new, checked against the target remote's
  freshly-refreshed catalog.
- Fixed (pre-release, found in QA): a cache-isolation bug where a second push
  against the same cached remote clone could build its branch on top of a
  prior, unrelated push's leftover commit instead of the remote's true default
  branch tip — polluting the resulting PR's diff.
- Fixed (pre-release, found in QA): `--version` on `push --new` collided with
  Commander's global `-V/--version` flag and silently no-op'd; renamed to
  `--artifact-version`.
- Manual smoke-test runbook: [docs/manual-smoke-test-push.md](docs/manual-smoke-test-push.md).

## Phase 0 — Engine MVP

- Added `deliveryos remote add <git-url> [--name <name>]` — registers a
  git-backed remote and clones it into a local cache (`~/.deliveryos/remotes`,
  override with `DELIVERYOS_HOME`).
- Added `deliveryos list [--remote <name>] [--json]` — lists artifacts across
  all registered remotes.
- Added `deliveryos pull <id> [--remote <name>]` — copies an artifact's
  payload to its manifest's `install_target`, runs `post_install` if present,
  and records the pull in a project-local lockfile (`.deliveryos/lock.json`).
- Manifest schema (zod) with an intentionally open-ended `kind` field, one
  manifest per artifact at `artifacts/<id>/manifest.yaml` +
  `artifacts/<id>/payload/**`.
- Upsert-by-id, atomically-written lockfile.

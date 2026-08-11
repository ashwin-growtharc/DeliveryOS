# Changelog

All notable changes to DeliveryOS are recorded here, phase by phase. See
[PLAN.md](PLAN.md) for the roadmap and [ARCHITECTURE.md](ARCHITECTURE.md) for
design rationale.

- **Phase 11, item 1: the design-kit bundle's five real components +
  guideline doc, authored and pushed for real.** `Button`/`Card`/
  `TopBar`/`Feedback`/`Input`, styled from `DESIGN_SYSTEM.md`'s real
  tokens (light only -- this repo's own design system has no dark
  palette to match), pushed as one `kind: template` bundle:
  [growtharc-ai-helpers#57](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/57).
  `GUIDELINES.md` writes down the radius/spacing scale and status colors
  for the first time anywhere reusable -- `DESIGN_SYSTEM.md`'s own
  markdown never documented them. Payload structure corrected from the
  original "fully flat" scoping: `findPreviewEntryFile` needs one
  `preview.tsx` per directory, so each component got its own subfolder
  under a shared `components/` parent instead of colliding on a shared
  flat filename -- confirmed against `docgen.ts` before writing anything.
  **A real bug found and fixed while authoring `Input`'s preview**: a CSF
  variant function is called directly as a plain JS function, not
  rendered through React -- calling `useState()` inside the variant
  itself is a genuine rules-of-hooks violation, confirmed by hand
  (`Cannot read properties of null (reading 'useState')`, thrown with a
  blank preview and zero visible console errors -- caught only by
  actually rendering the compiled output in a real browser, since the
  text-based dogfood check had already passed). Fixed by moving the
  hook into a real component the variant merely returns an element for.
  Verified: `compileLocalPreview` against all 5 components, then each one
  actually rendered and interacted with in a real browser before pushing.

- **A real, user-reported preview rendering bug, root-caused to one
  shared function and fixed there once.** Reported with a real
  screenshot: the `search` component's preview showed its "Recent
  search" label and "Clear all" button at near-zero contrast, and a
  separate report that a preview's background "changes dynamically"
  while just looking at it. Root cause, confirmed by reading the real
  `Search.tsx` source and the preview compiler: `generateTailwindCss`
  (`src/engine/preview/compile.ts`) never pinned a `darkMode` strategy,
  so Tailwind's default `media` behavior compiled every component's
  `dark:` classes (a normal, correct thing for a component to have) to
  a live `@media (prefers-color-scheme: dark)` query -- resolved against
  the VIEWER's own OS setting, not anything this project controls. That
  explains both reports at once: a `dark:bg-black/30` translucent modal
  rendering dark-mode-correct but composited over the preview frame's
  fixed light background (which never itself goes dark to match) reads
  as broken contrast; and the OS scheme changing while a preview stays
  mounted re-evaluates that live media query with no user action at all,
  which is the "changes dynamically" report. Fixed by pinning
  `darkMode: 'class'` -- no `.dark` class is ever added anywhere in this
  pipeline, so `dark:` variants now deterministically never activate,
  matching this project's own real design system (light-only, no dark
  variant defined at all) -- plus `color-scheme: light` on the iframe's
  own html/body so native browser chrome (scrollbars, form controls)
  stays consistent too. One shared fix, not a per-component patch: every
  past and future `ui-component` artifact that uses `dark:` classes is
  fixed by this same change, confirmed by re-running it against the real
  `search` component and verifying zero `prefers-color-scheme`
  occurrences remain in its compiled output. 2 new unit tests using a
  real fixture component with `dark:` classes. Full suite: 347/348, the
  1 failure pre-existing and unrelated (confirmed already, several times
  this session).

- **Three more real bugs, found chasing the fix above through an actual
  running app.** (1) The dark-mode fix above shipped without bumping
  `PREVIEW_COMPILER_VERSION`, so the cache that constant exists to
  invalidate kept serving every already-compiled preview's stale,
  pre-fix HTML -- restarting the app changed nothing, because the cache
  key never changed. (2) The wrapper card behind every live preview
  (`.ui-component-preview-frame`) filled with a flat beige background
  and a border; real components with their own translucent/glass
  surfaces (e.g. `search`) read as a muddy mismatched box against it.
  Removed the fill; a follow-up screenshot showed even a hairline border
  still read as an unwanted line around the component, so removed that
  too -- confirmed unaffected against a plain opaque component
  (`button-showcase`) first. (3) `button-showcase`'s Outline variant
  lifts 1px on hover, a normal micro-interaction; with the iframe's
  `body` at zero padding, that 1px lift pushed the button's border past
  body's own edge, where `overflow: hidden` clipped it -- visible as the
  border's flat top edge vanishing while its rounded corners survived.
  Fixed with 4px of real `body` padding, included in the actual
  `scrollHeight` measurement the parent sizes the frame to.

- **That padding fix (3) above caused two further real regressions,
  both since reverted.** A 6-button row started wrapping its last button
  ("Link") onto its own line: `app.js`'s `WIDTH_SAFETY_MARGIN` measures
  the row element itself, never `document.body`, so it never accounted
  for body's new padding cutting into the same outer box's usable width
  (confirmed by hand: row measures 596.67px unwrapped; the old margin,
  +4 = 601px outer, left only 593px inside once body's 8px of padding is
  subtracted). Far more serious: **any pushed component using an
  ordinary `min-h-screen` / `min-height: 100vh` pattern (a real full-page
  sign-up mockup hit this directly) grew its preview to the 640px MAX
  ceiling instead of its real ~350px size.** `min-height: 100vh`
  resolves against the iframe's own currently-applied height, which the
  parent sets from what got reported -- a closed loop. body's padding
  sits on top of that loop's own element, so once the applied height
  first exceeds the component's true size, the component's height locks
  to that value and the padding adds exactly 8px to every subsequent
  report, forever, until the MAX clamp stops it (confirmed by hand:
  472 -> 480 -> 488 -> 496 ..., +8 every round). Not something a smaller
  padding value would have avoided -- any constant fed back into a loop
  like this compounds, for any component using this entirely common
  pattern. **Reverted the body padding entirely and `WIDTH_SAFETY_MARGIN`
  back to `4`** -- confirmed by hand both ways: the sign-up component now
  converges immediately to a stable 464px and stays there; the 6-button
  row fits on one line again. The Button hover-clip this fixed is real
  but narrow (one variant, cosmetic) against a regression that broke a
  very common authoring pattern broadly -- the right trade until a fix
  exists that doesn't feed anything back into the measurement loop.

- **A distinct pre-mount measurement bug, found investigating the above,
  kept even after reverting the padding that exposed it.** The
  `width === 0 || height === 0` check that exists to skip reporting
  before React has mounted infers "not mounted" from a raw pixel
  measurement happening to be exactly zero -- exactly what broke, briefly,
  once body had non-zero padding even while genuinely empty. Replaced
  with a precise, direct check: `#root`'s own child count, immune to
  whatever body padding does or doesn't exist. `PREVIEW_COMPILER_VERSION`
  now `4` (padding reverted + this check, together).

- **Phase 10 is complete: item 2, "want help fixing this?", built after
  explicit go-ahead given directly in chat.** The original plan
  (unrestricted `--allowedTools "Bash,Read,Edit"`) is dropped -- this
  project already proved that flag unreliable. Redesigned so the
  subprocess needs no tool access at all: it gets the failing file's
  content and the real build error (both delimited the same
  "inert data, never instructions" way item 3 already does), returns
  strict JSON (`{"fixed_file": "..."}` or `{"fixed_file": null,
  "reason": "..."}`), and the app itself does every write, only after a
  human explicitly clicks Apply. Scoped to only the files item 1's own
  auto-wiring just wrote -- never a file guessed from build-error text.
  After writing, re-runs the real build to actually confirm the fix
  worked; if it doesn't, the original file is restored automatically
  (`rolledBack: true`) rather than leaving a broken write in place. New
  append-only audit log (`.deliveryos/build-fix-log.jsonl`, the first log
  file anywhere in this codebase) records one entry per fix actually
  applied -- real before/after content, real cost/duration pulled from
  `claude`'s own response, and whether it was kept or rolled back.
  Extracted the shared `claude` subprocess-invocation logic
  (`src/engine/claude/runClaudeSubprocess.ts`) out of item 3's
  `suggestMetadata.ts` rather than duplicating its two hard-won Windows
  fixes a second time.
  **Real, unstaged verification**: reproduced the actual historical
  `auth.ts` bug this project hit before
  (`export { GET, POST } from '@/auth'`) through the rebuilt packaged
  sidecar exe -- asked twice with only the file+error, the model
  correctly said it couldn't determine the fix both times rather than
  guess, a real and appropriate "I don't know," not a shortcoming.
  Switched to a self-contained typo bug fully determinable from the
  file+error alone and verified the complete pipeline for real: request
  -> correct fix -> apply -> real build passes -> exact right audit-log
  entry. Then forced a fix that doesn't work and confirmed the rollback
  for real: original file restored byte-for-byte, audit log's second
  entry correctly marked `rolledBack: true`. 18 new unit tests, including
  a real rollback test and a real path-traversal-refusal test.

- **The rest of the same top-to-bottom code review's findings, fixed the
  same day.** Five more, all real:
  - **Sidecar-blocking subprocess calls made async.** `suggestMetadata`
    (`claude` calls) and `verifyBuild`'s `runProjectBuild` (`npm run
    build`) both used synchronous, blocking `execFileSync`/`execSync` --
    the sidecar is a single Node process explicitly designed to handle
    overlapping requests concurrently (`handleLine` fired without being
    awaited per line), so a blocking call froze the ENTIRE process,
    including any other in-flight or new command, for the call's whole
    duration -- realistically many seconds for a live AI call. Converted
    both to real async (`execFile`/`exec`), and proved the fix, not just
    the intent: fired a slow `artifact.suggestMetadata` call and a fast
    `remote.list` call at the same running sidecar process 200ms apart --
    the fast one's response came back at 1.6s while the slow one was
    still running until 9.7s, confirming the process genuinely stayed
    responsive. `execFile`'s async form has no `input` convenience option
    the way the sync versions do (confirmed directly: passing one is
    silently ignored) -- the prompt is now written to the child's own
    `stdin` stream by hand instead.
  - **Prompt-injection hardening for "Suggest with Claude."** A payload's
    own source -- which could be third-party code someone didn't author
    themselves -- is embedded in the prompt sent to `claude`, and this
    project's own tool-restriction flags are already known not to be
    reliably enforced (see below). The embedded source is now wrapped in
    explicit `<UNTRUSTED_SOURCE>`/`</UNTRUSTED_SOURCE>` delimiters with a
    direct instruction to treat it as inert data, never as instructions,
    even if it contains text that reads like a command -- a standard,
    real mitigation, though not a substitute for the tool-restriction
    actually holding.
  - **Two real "Suggest with Claude" UI bugs fixed.** The Component Type
    step's Suggest button was silently overwriting an already-edited
    Description (both buttons shared one handler that always touched both
    fields) -- each button now only ever touches the field(s) it's
    actually associated with. The suggestion cache was keyed only by
    payload path, not kind -- changing kind after already requesting a
    suggestion (reachable via Review's own Edit links) silently returned
    a stale, wrong-kind suggestion; the cache key now includes kind.
  - **A real duplicated-code cleanup.** The recursive "list every source
    file in this payload, skipping node_modules/dotfiles" walk was
    copy-pasted near-verbatim across four detector files. Consolidated
    into one shared `listFilesRecursively`
    (`src/engine/scan/listFiles.ts`).
  - **A real detection gap closed.** `detectInstallParams` only matched
    dot-notation (`process.env.FOO`); bracket-notation
    (`process.env['FOO']`) is real, valid, sometimes-seen syntax that was
    silently invisible to it. Now detects both, deduped.

- **Security fix: path traversal in Phase 10 item 1's automatic wiring
  writer, found in a top-to-bottom code review and fixed the same day.**
  `applyDeterministicWiring` resolved a manifest's `wiring_actions[].target_file`
  via plain `path.resolve(cwd, targetFile)` with no containment check
  before writing to it -- proved directly (and reproduced via a real,
  temporarily-reverted-then-restored test) that a `target_file` of
  `"../../../../evil.txt"` or an absolute path genuinely resolves outside
  the target project and genuinely gets written to. Fixed at the root:
  new `resolveContainedTargetFile` (`src/engine/pull/wiring.ts`) resolves
  a target only when the result is verifiably inside `cwd`, used both by
  `resolveWiringActions`'s own (lower-severity, read-only) existence
  check -- which had the identical unguarded pattern -- and, as a second,
  independent layer of defense, by `applyDeterministicWiring`'s actual
  write site itself, which no longer trusts that every
  `ResolvedWiringAction` it's ever handed necessarily came from the
  now-fixed upstream resolver. A target that escapes is reported as
  `needsReview` (write) / `targetFileExists: true` with an explicit
  "resolves outside this project and was refused for safety" message
  (resolve), never silently applied and never crashing. 8 new unit tests,
  including two that genuinely prove the fix: each was run once against
  the pre-fix code (confirmed to fail, with the malicious write actually
  landing on disk) before being restored alongside the fix.

- **Phase 10 item 3, "Suggest with Claude": the first AI-invoking
  capability in Add New's autofill.** Every other autofilled field is
  pure regex/AST analysis; this adds an explicit "Suggest with Claude ✨"
  button (never automatic) that shells out to a real `claude -p`
  subprocess for the two fields static analysis honestly can't fill --
  `description` and `componentTypes` -- when there's no JSDoc/frontmatter/
  comment signal to draw from. `roles`/`teams` are still not touched even
  by this: they're organization-internal concepts no model can recover
  from code any better than a regex can. New
  `src/engine/scan/suggestMetadata.ts` and `artifact.suggestMetadata`
  sidecar command.
  **Two real, tested findings that shaped the actual implementation:**
  (1) the tool-restriction flags used in item 2's own "settled" design
  aren't a hard sandbox -- `--bare` breaks authentication outright here
  (skips keychain reads), `--allowedTools ''` didn't stop a real Bash
  call from running, and `--disallowedTools` naming every tool blocked it
  on 2 of 3 real attempts but not the third; accepted as a known
  limitation rather than a solved one, since this same engine already
  runs arbitrary trusted shell commands on this machine anyway. (2) a
  real Windows command-injection bug, found and fixed before shipping:
  `claude` is a `.cmd` npm shim on Windows, which `execFileSync` can only
  invoke with `shell: true` -- but that concatenates argv into a shell
  command line unescaped, so putting the arbitrary payload-derived prompt
  text directly in argv would have let a stray `&`/`"`/`^` in someone's
  source file break out into an arbitrary second command. Fixed by never
  putting the prompt in argv at all: piped to the child's stdin instead
  (`claude -p` reads from stdin when piped), so only fixed, hardcoded
  flag strings ever pass through the shell-concatenated argv. Verified
  for real against the rebuilt packaged sidecar exe: a sign-in form
  component with zero JSDoc got back an accurate description and
  `componentTypes: ["form"]`; a simulated missing-`claude` PATH failed
  cleanly with a real `SuggestionError`, not a hang or a crash. 10 new
  unit tests for the pure prompt-building/response-parsing logic.

- **Phase 10 item 3 extended: real autofill now covers `stacks`,
  `description`, and `owner`, for every kind, not just `install_params`
  on backend-plugin-shaped payloads.** Follow-up to the entry below, in
  response to direct feedback that autofill should reach "mostly
  everything," not one field on one kind. New `detectStacks`
  (`src/engine/scan/detectStacks.ts`) reads real `import`/`require`
  specifiers and `package.json` dependencies against a small lookup
  table verified against the real catalog's own existing tag vocabulary
  (`next`→`nextjs`, `react`→`react`, `@prisma/client`/a `.prisma` file→
  `prisma`, `express`→`express`, plus real file-extension-based
  `typescript`/`javascript`). `description` now has a real source for
  every kind: `ui-component` gets `react-docgen-typescript`'s own
  `ComponentDoc.description` -- a real JSDoc comment that was already
  being parsed and then silently thrown away
  (`detectUiComponents.ts` previously hardcoded `undefined`, with a
  comment claiming no reliable signal existed; that was simply stale).
  The four markdown kinds now get frontmatter-based guessing from Add
  New's own manual payload-pick path too (previously Scan-only). Anything
  else falls back to a new `extractLeadingComment`
  (`src/engine/scan/extractLeadingComment.ts`), reading a real leading
  comment off a conventional entry file, never fabricating one. `owner`
  now defaults from the real local git identity (`git config
  user.name`, already resolved via the existing `getCommitIdentity`) --
  confirmed to exactly match the convention already used in every real
  shipped manifest. **Deliberately still not attempted**:
  `componentTypes`/`roles`/`teams` -- checked real catalog values and
  concluded there is no equally reliable code signal for either; both
  require a semantic judgment no regex or import scan can honestly make,
  so they stay manual on purpose. One consolidated sidecar command,
  `artifact.detectMetadata`, replaces the narrower
  `artifact.detectInstallParams`. Verified for real against the
  rebuilt packaged sidecar exe (not just unit tests) across four real
  fixtures -- a ui-component's JSDoc, a skill's frontmatter, a
  backend-shaped payload's comment/imports/env-var, and a signal-free
  payload that correctly came back blank rather than fabricated -- plus
  20 new unit tests. Also fixed, while investigating a reported "Unknown
  command" error: the packaged sidecar `.exe` Tauri actually spawns
  (`src-tauri/target/**/deliveryos-engine.exe`) was stale relative to the
  freshly rebuilt `build/deliveryos-engine-*.exe`, since `cargo`/`tauri
  dev` hadn't rerun since the last rebuild -- not a code bug, fixed by
  clearing the stale copies so the next `tauri dev`/`tauri build`
  re-copies fresh ones.

- **Phase 10 items 1 and 3 are complete: deterministic apply-and-test on
  Pull, and real code-driven autofill for Add New's `install_params`.**
  Item 2 (an explicit agent-escalation button on build failure) stays
  gated on a separate, explicit go-ahead and was not touched.
  - **Item 1** — a new `pullAndAutoWire` orchestration
    (`src/engine/pull/pullAndAutoWire.ts`) wraps the existing, unchanged
    `pullArtifact`: for artifacts declaring `wiring_actions`, it now also
    applies every `whenAbsent`-shaped action for real
    (`src/engine/pull/applyWiring.ts` — writes only genuinely new files;
    anything that already exists is left alone and flagged for manual
    review, even when a `whenPresent` merge-guidance snippet exists, since
    that snippet is guidance, not a full file to overwrite) and then runs
    the target project's own real build if one is detectable
    (`src/engine/pull/verifyBuild.ts` — `npm run build` when
    `package.json` declares a `scripts.build`, otherwise `{ran: false}`,
    never an error). Wired into the desktop app's own Pull button via a
    new sidecar command, `artifact.pullAndAutoWire`, used only when an
    artifact's manifest actually has `wiring_actions` — `pullArtifact`
    itself and its existing sidecar command are untouched. 13 new unit
    tests plus a new real e2e test
    (`test/e2e/sidecar.e2e.test.ts`) proving all three outcomes against a
    real fixture: a fresh file applied verbatim, an existing file left
    alone and flagged, and a real `npm run build` executed and reported.
  - **Item 3** — a new `detectInstallParams`
    (`src/engine/scan/detectInstallParams.ts`) scans a proposed artifact's
    actual payload source for real `process.env.X` and Prisma's own
    `env("X")` references, proposing a starting `install_params` list:
    real key names, `required: true` always (a plain regex can't reliably
    tell whether a call site has its own fallback, so this is the safe
    direction to be wrong in), and a secret guess from a naming heuristic
    (`SECRET`/`TOKEN`/`PASSWORD`/`_KEY`/`DATABASE_URL`/etc). Description
    text is deliberately left blank rather than fabricated — the same
    "make the autofill good, don't decorate it" lesson as Scan's own,
    already-removed "AI guessed" badge. `push.ts` gained a real
    `installParams` option that lands directly in the committed manifest
    when present, and is a complete no-op (`install_params: []`, unchanged
    from today) when omitted. Wired into the desktop app's Add New wizard
    as a new "Install-time config" step, auto-triggered the moment a
    payload is picked, editable before submit. 10 new unit tests plus 2
    new e2e tests against real `pushArtifact` calls.
    **A real, honest limitation, found by running this against the
    actual, already-shipped `nextauth-credentials` artifact**: it detects
    nothing there, because `AUTH_SECRET`/`AUTH_URL` are read implicitly by
    Auth.js's own internal library code (never referenced in this
    artifact's own payload source), and `DATABASE_URL` lives in the
    *consuming* project's own `prisma/schema.prisma`, not the
    `prisma-schema-snippet.prisma` reference file this payload actually
    ships. Static analysis over payload text genuinely can't see either —
    stated plainly rather than papered over.
  - Verified against a genuinely fresh, real Next.js project
    (`dos-phase10-e2e`), through the rebuilt packaged sidecar exe, not
    just unit tests: pulling the real, signed `nextauth-credentials`
    artifact applied its fresh-file wiring actions correctly, correctly
    left an already-existing file alone, and the real `next build`
    passed.

- **Phase 9 is complete: `deliveryos-status`, a real Claude Code Skill
  teaching the status/health check this session kept doing by hand.**
  Genuinely separate from `deliveryos-check-first` (different trigger
  moments -- "build me X" vs. "what's the status" -- would weaken
  auto-invocation for both if blended into one description). Runs
  `npm run typecheck`/`lint`/`test` and summarizes pass/fail, plus the real
  capability this phase exists for: a doc-sync check that greps PLAN.md/
  CHANGELOG.md for PR links, checks their real state via `gh pr view`, and
  flags drift against what the doc text claims -- taught as reading
  comprehension over the surrounding text, not keyword-matching, with
  explicit handling for closed-not-merged PRs, failed lookups, and
  cross-repo URLs. Decided explicitly: stays a request-triggered snapshot,
  never a persistent status page -- every check is already fast and
  stateless, so there's no real problem a dashboard would solve here.
  Pushed for real via `deliveryos push --new`
  ([PR #56](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/56),
  merged), pulled back through the real packaged sidecar exe
  into the same global skills directory `deliveryos-check-first` lives in.
  Then genuinely run against this real repo, not staged: typecheck/lint/test
  all passed (270/271, 1 pre-existing unrelated failure), and the doc-sync
  check found 8 real, unmanufactured drift cases across PLAN.md/
  CHANGELOG.md (PRs #4/#50/#51/#54/#55 all still described as "open,
  awaiting review" long after merging) -- fixed, then re-verified clean.

- **A real "prove adoption" attempt found a real, previously-undiscovered
  bug in Phase 6's own work.** `deliveryos-check-first` was installed for
  real into the user's own global Claude Code skills directory and
  exercised on a genuinely undirected task ("a card with a hover effect").
  The check-first/pull loop worked exactly as designed, but inspecting the
  pulled code surfaced that 4 of the catalog's 6 `ui-component` artifacts
  (`magic-container`, `decrypting-text`, `orbiting-skills`, `search`) were
  fundamentally non-portable -- they destructured hooks from
  `window.__DeliveryOSReactRuntime.React` instead of a real `import` from
  `'react'`, crashing immediately if dropped into a real project. Root
  cause was in DeliveryOS's own preview compiler
  (`src/engine/preview/compile.ts`): `'react'`/`'react-dom'` were never
  marked `external` for a component's own source, so a real `import`
  couldn't resolve there -- the runtime-global workaround was the only way
  anyone found to get hooks working, not a mistake. Fixed at the root: new
  `REACT_EXTERNAL_NAMES`, added alongside the existing
  `VENDORED_LIBRARY_NAMES` mechanism (the require shim already handled
  both specifiers, it was just unreachable before). New regression test
  proves real, reactive hook state works through a genuinely portable
  import (a counter that increments on real click events). All 42
  existing preview tests still pass -- no regression. The 4 real broken
  artifacts were fixed and verified three ways: compile through the real
  rebuilt preview compiler, type-check cleanly in an isolated external
  project with no DeliveryOS runtime, and actually render via
  `react-dom/server` with zero DeliveryOS-specific globals present.
  Opened as
  [ai-helpers PR #55](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/55)
  (merged). Full suite: 271 passed, 1 pre-existing unrelated failure.

- **Phase 8 is now complete: items 2-4 (CLI wiring exposure, the
  wire-and-test loop, and a real end-to-end test).** New
  `deliveryos wiring <id> [--remote <name>] [--json]` CLI command
  (`src/cli/commands/wiring.ts`), the one concrete gap blocking a Claude
  Code Skill from doing anything with Tier 2 wiring at all -- verified
  against the real `nextauth-credentials` artifact, 3 new e2e tests.
  `deliveryos-check-first`'s own instructions gained an explicit
  wire-and-test loop step: apply a resolved snippet mechanically, then
  actually run the project's real build/test command and fix what fails
  -- called out explicitly as genuine judgment, not assumed covered by
  "the wiring step was deterministic."
  **Real end-to-end proof, including the "fixes what fails" half, not
  just the happy path**: a second fresh Next.js project
  (`dos-phase8-e2e`) literally followed the skill's own instructions --
  checked the catalog, evaluated and pulled `nextauth-credentials` (real
  signature verified), resolved wiring, applied it. The old, pre-PR-#53
  buggy `route.ts` snippet was deliberately reapplied first to prove the
  "fix a deliberately-introduced break" half for real: reproduced the
  exact `next build` failure, fixed it by reasoning from the error
  message, confirmed a clean build afterward. This real run found a
  second genuine gap: `list --json` didn't return enough to actually
  follow the skill's own "evaluate a match honestly" step without
  pulling first -- fixed by extending it (additive) with `tags`,
  `installTarget`, `installParams`, and `signed`. 2 new e2e tests for the
  extended shape. `deliveryos-check-first`'s SKILL.md updated to match,
  pushed as follow-up commits to the same open
  [PR #54](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/54).
  Full suite: 271 tests, one pre-existing unrelated failure, typecheck/lint
  clean. Merged via
  [PR #4](https://github.com/ashwin-growtharc/DeliveryOS/pull/4) on
  DeliveryOS itself.

- **Phase 8 item 1: the check-first + propose-back Skill, aimed directly
  at Tier 0's stuck "prove adoption" item.** With no real adopter
  candidate identified yet, this reframes the problem: instead of needing
  someone to deliberately try DeliveryOS, a Claude Code Skill checks the
  catalog automatically on every relevant task, so reuse becomes a side
  effect of normal engineering work. Needed no new engine code -- every
  CLI flag the skill documents was checked against the real `--help`
  output first. Pushed for real via `deliveryos push --new` as
  `deliveryos-check-first` (`kind: skill`), opened as
  [PR #54](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/54)
  on `ai-helpers` (merged), then pulled back through the
  real packaged sidecar exe to confirm it lands exactly where Claude Code
  reads skills from (`.claude/skills/deliveryos-check-first/SKILL.md`).
  Mirrors `find-skills`'s real, already-catalogued structure. On branch
  `phase8-check-first-skill`.

- **Phase 7's end-to-end test -- Phase 7 is now complete.** A genuinely
  fresh Next.js project (`dos-auth-e2e`, not `DOS Demo`, which already had
  this artifact pulled into it from earlier work) proved every piece of
  Phase 7 together for real: pull + install-time config collection,
  signature verification before any files are written, both branches of
  the wiring agent's tier boundaries on real unmodified scaffold content
  (a fresh `create-next-app` already has `layout.tsx` but not `auth.ts`),
  and a real `next build` after hand-applying every Tier 2 suggestion
  exactly as given. Found and fixed three real bugs this way -- none
  catchable by schema/unit tests, since those never compile or clone the
  resulting code: (1) `wiring_actions`' `targetFile` paths assumed a
  non-`src/` layout, inconsistent with the artifact's own
  `install_target: src/lib/auth` (fixed on PR #51); (2) the API route
  wiring snippet was wrong -- `export { GET, POST } from '@/auth'`
  doesn't work since `auth.ts` exports `handlers`, not top-level `GET`/
  `POST` (fixed on PR
  [#53](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/53),
  confirmed with a clean `next build`); (3) a real cross-platform bug --
  git's common Windows `core.autocrlf=true` default checks text payload
  files out with CRLF while the Linux CI runner that signed them saw LF,
  silently breaking verification for any such Windows user on an
  untampered artifact. Fixed at the root: `cloneTo`
  (`src/engine/git/git.ts`) now forces `core.autocrlf=false` on every
  DeliveryOS-managed clone, so caches are always byte-faithful regardless
  of the host's own git config. 2 new regression tests. Full suite: 265
  tests, one pre-existing unrelated failure, typecheck/lint clean. On
  branch `phase7-detail-pull-ux`, not yet pushed.

- **Phase 7's security/provenance model: keyless Sigstore signing,
  verified at pull, before any files are written.** Chose the `sigstore`
  npm package over the `cosign` CLI binary deliberately -- verification
  runs inside DeliveryOS's own packaged executable on arbitrary end-user
  machines, where requiring a separately-installed `cosign` binary would
  be a real distribution problem. New `src/engine/provenance/digest.ts`
  (`computePayloadDigest`, a deterministic sha256 over a payload's actual
  content, directory-order-independent) and `verify.ts`
  (`verifyArtifactSignature`: a no-op when `manifest.signature` is absent;
  else checks the digest before touching any cryptography, then calls
  `sigstore`'s `verify()` pinned to the manifest's own
  `certificate_identity`/`oidc_issuer`). New `SignatureVerificationError`.
  Wired into `pullArtifact` as a new `verify` progress stage, genuinely
  before `fs.cpSync`. On `growtharc-ai-helpers`: a new GitHub Actions
  workflow (PR
  [#52](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/52),
  merged) signs every `kind: backend-plugin` artifact's payload on push to
  `main` using the workflow's own ambient GitHub Actions OIDC identity --
  no key material anywhere. Writing the workflow YAML itself was blocked
  by Claude Code's own auto-mode classifier (CI workflow files with
  `id-token`/`contents: write` are a real supply-chain surface); the user
  created that one file via the GitHub UI, everything else proceeded
  normally. **Real, live proof**: merging the PR triggered a real signing
  run against `nextauth-credentials`, producing an actual Fulcio
  certificate and Rekor log entry; pulled that real signed artifact
  through the rebuilt packaged sidecar exe and confirmed verification
  succeeded and the payload landed correctly. Also proved it fails closed
  against that same real bundle, twice: a hand-tampered local payload
  (digest mismatch, refused before any crypto ran) and a hand-edited
  `certificate_identity` (a genuine cryptographic rejection from
  `sigstore`'s own `verify()`) -- neither wrote anything to disk. 20 new
  tests (unit + CLI e2e + sidecar e2e); full suite (264 tests, one
  pre-existing unrelated failure) + typecheck/lint clean. Deliberately
  deferred: full SLSA Level 3 conformance, retrofitting signing onto
  other kinds, any key-management scheme, build-time-pinned trust root
  (pull already needs live network access to clone from GitHub, so
  `sigstore`'s own live TUF fetch is consistent with that). On branch
  `phase7-detail-pull-ux`, not yet pushed.

- **Phase 7's wiring agent (Tier 1 + Tier 2), deterministic and
  manifest-declared, not an LLM-reasoning agent** (confirmed with the user
  before building). Tier 1 needed no new manifest field at all:
  `.env.example` placeholders are fully derivable from the already-shipped
  `install_params`, so `installParams.ts`'s upsert logic was extracted
  into a shared `upsertEnvFile(filePath, values)` reused by both
  `applyInstallParams` (`.env.local`) and the new
  `applyEnvExamplePlaceholders` (`.env.example`). Tier 2 gained a new
  `wiring_actions` manifest field (`WiringActionSchema`:
  `type: 'suggest_snippet'`, `targetFile` resolved against `cwd` --
  never `install_target` -- `whenAbsent` requiring a snippet,
  `whenPresent` optional so a declared action can honestly say "review
  before replacing" instead of forcing one snippet to serve both cases)
  and a new, purely read-only `resolveWiringActions(wiringActions, cwd)`
  (`src/engine/pull/wiring.ts`) that never writes or mutates anything.
  Deliberately excludes the Prisma schema merge -- that's Tier 3 per this
  project's own three-tier table, already surfaced passively via the
  prior item's `artifact.readPayloadFile` + rendered README. New sidecar
  command `artifact.resolveWiringActions`. Detail gained a "Wiring"
  subsection (one card per resolved action: target file, exists/not-found
  badge, description, instructions, snippet if applicable) -- no "apply"
  button, since Tier 2 is inherently "go do this in your own editor."
  The real, already-merged `nextauth-credentials` manifest on
  `ai-helpers` was updated with its real 4 `wiring_actions`, opened as
  [PR #51](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/51)
  (merged). Verified in a real browser
  against a mocked harness, and `artifact.resolveWiringActions` verified
  against the real (locally checked-out) manifest content through the
  actual rebuilt packaged sidecar exe. 20 new tests across schema, unit,
  and e2e coverage; full suite (247 tests, one pre-existing unrelated
  failure) + typecheck + lint clean. On branch `phase7-detail-pull-ux`,
  not yet pushed.

- **Phase 7's Detail/Pull UX for non-visual artifacts**: a new
  `src/engine/pull/installParams.ts` resolves and applies an artifact's
  declared `install_params` (provided value > already-configured
  `.env.local` value > the manifest's own `default`), writing to
  `<cwd>/.env.local` -- a project-ROOT file, deliberately never anything
  under `install_target`, since the pristine-snapshot step would otherwise
  capture a secret value baked into a "pristine reference copy". CLI:
  `deliveryos pull <id> --set KEY=VALUE` (repeatable). Sidecar: two new
  commands, `artifact.applyInstallParams` (configure later without a
  re-pull) and `artifact.readPayloadFile` (reads a real file, e.g.
  README.md, out of an artifact's payload, sandboxed against
  path-traversal). Caught a real bug while wiring this up: configuring one
  missing value later made every OTHER already-satisfied param look
  missing again, since the resolver only ever saw what was provided THAT
  call -- fixed by folding in whatever's already in `.env.local` first.
  Detail gained a new section (gated on `install_params` being non-empty,
  never a `kind` check): a provenance badge, the rendered README, and a
  required-config checklist. Verified in a real browser against a mocked
  harness, and the real packaged sidecar exe reading the real, merged
  `nextauth-credentials` artifact's README from `ai-helpers`. 29 new
  tests; full suite (222 tests, one pre-existing unrelated failure) +
  typecheck + lint clean. On branch `phase7-detail-pull-ux`.

- **Phase 7 (backend-plugin artifacts) started for real**: picked a
  concrete target (Auth.js/NextAuth v5 + Prisma, Credentials provider, in
  a Next.js App Router project) over Passport.js/Express, a Supabase-auth
  wrapper, and a Python logger, and built the first real piece —
  `src/engine/manifest/schema.ts` gained `install_params` (a new
  `InstallParamSchema[]`, schema-level-impossible to mark `secret` and
  also declare a `default`), plus `content_digest` and an optional
  `signature` object for the not-yet-built provenance model. Fully
  additive: every pre-existing manifest still parses unchanged, verified
  against the real catalog through the actual packaged sidecar exe, not
  just `dist/` under `node`. 8 new unit tests; full suite (200 tests, one
  pre-existing unrelated failure) + typecheck + lint clean. On branch
  `phase7-schema-install-params`.

- **Phase 7's real target actually pushed**: the Auth.js v5 + Prisma
  Credentials module (`auth.config.ts`, `password.ts`, a copy-pasteable
  Prisma schema snippet, and a README documenting the manual wiring steps
  until a wiring agent exists) proposed via the existing, unmodified
  `deliveryos push --new` CLI — zero new engine code needed. Opened as
  [PR #50](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/50)
  against `ai-helpers`. The three `install_params` were hand-added to the
  manifest in a follow-up commit (`push --new` has no CLI flag for this
  field yet) and verified against the real `ManifestSchema` before
  committing. Deliberately scoped the payload to a self-contained folder,
  not a project-root-wide copy: `pullArtifact` has no file-merge concept,
  so scattering files across an existing project (overwriting a real
  `prisma/schema.prisma` wholesale, for instance) would be actively
  destructive. Merged.

- **Two Tier-0 hardening fixes, both merged** (see PLAN.md's "Tier 0
  hardening" section). `fix-lockfile-race` fixes a real, present-tense
  concurrency bug: `upsertEntry` was an unlocked read-modify-write, so the
  app's own 20-minute auto-sync tick and a concurrent manual pull/push
  could race, with the second writer silently clobbering the first's
  already-applied update. Fixed with `proper-lockfile` (pure-JS, no native
  bindings). Two regression tests prove it, both verified by hand to
  actually fail without the fix (a same-id-only version of the second test
  was tried first and quietly turned out to prove nothing — caught by
  running it against the unlocked code too). `close-github-poll-loop`
  closes a real, named gap: PR status polling (`sync.resolvePendingPushes`)
  already existed and was well-tested, but was wired to only a manual
  per-entry button — never the same 20-minute tick that already polls
  version drift. Wired it in, and caught a real ordering bug along the way
  (a same-tick merge could silently wipe that tick's own drift
  annotations).

- **Closed out Phase 6's end-to-end test checklist for real** (see
  PLAN.md) — every scenario now walked against the actual `ai-helpers`
  remote, not fixtures. Along the way, **found and fixed a real bug**:
  pulling `magic-container` (still reporting v1.0.0) into a fresh project
  revealed the earlier `React.FC<Props>` docgen fix had been pushed to
  PR #46's branch *after* that PR had already auto-merged (~10 minutes
  later) — the fix was written, committed, and pushed, but never actually
  reached `main`, invisible until a real pull surfaced the still-broken
  file. Fixed via a new PR (#48, cherry-picking the original fix commit
  onto `main`, bumping the manifest to 1.0.1). Then walked the full
  **edit + drift-detection loop** for real: pulled the corrected 1.0.1
  into a second, different local project (`DELETER/Github deleter`, no
  prior history of this artifact), made a real visual edit (swapped the
  hover-gradient's color stops), pushed via `deliveryos push` (auto-bumped
  to 1.0.2, PR #49), merged; back in a *first* project (`DOS Demo`, still
  on 1.0.0), `deliveryos check-updates` correctly reported
  `1.0.0 -> 1.0.2` — jumping straight to the true latest version rather
  than a stale intermediate one — and a re-pull's compiled preview
  genuinely contained the new gradient color, not the old one. Also
  confirmed, with real evidence rather than incidental: "CLI-driven
  propose, no GUI" (every real push this session ran via the CLI directly,
  no app window involved) and "graceful degradation" (an unresolved
  `lucide-react` import, before it was vendored, was independently
  observed rendering a clean `Preview unavailable` text-only card in the
  real running app, never a crash). Corrected PLAN.md's long-stale Phase 6
  header ("Not started, brainstormed only") to reflect all of this.

- **Fixed a real docgen bug** (`magic-container`'s pushed preview showing
  no interactive props / "showing someother thing") and **vendored
  `lucide-react`** after a real pasted component (a command-palette style
  search UI) failed to compile with "Could not resolve lucide-react".
  - Root cause of the docgen bug: `React.FC<Props>` as a value-level type
    annotation requires TypeScript to actually resolve the real `React.FC`
    generic via a real `'react'` module to unwrap it -- which fails
    silently (zero docs returned, not an error) in every real-world
    component payload directory, since none of them ship their own
    `node_modules/react`. A plain typed function declaration
    (`function X(props: Props) {}`) only needs the local `Props`
    interface, never `React.FC` itself, so it's unaffected. Confirmed via
    a 4-way empirical test (function-decl vs. `const X: React.FC<Props>`,
    with/without a `react` type import) and by re-probing
    `react-docgen-typescript` directly (`[]` before the fix, a real
    `className` prop schema after). Fixed by converting `magic-container`
    to a plain typed function and pushing the fix to its already-open PR's
    branch. `.claude/skills/ui-component-extractor/SKILL.md` should be
    updated with this as a documented conversion step for future pasted
    `React.FC<Props>` components.
  - `lucide-react` added to the same vendored-library allow-list as
    `framer-motion`/`clsx`/`tailwind-merge`/`class-variance-authority`
    (`VENDORED_LIBRARY_NAMES` in `compile.ts`, `LIBRARIES` in
    `scripts/generate-vendored-libraries.mjs`) -- it's the one real size
    outlier in that list (~716 KB minified, bundling every icon
    component regardless of which one an individual component actually
    imports, vs. ~185 KB for framer-motion, the next largest). Embedded
    unconditionally anyway, matching the rest of the list's existing
    "embed it whether or not this particular preview uses it" simplicity,
    since it's a local one-time build cost, not a per-request network
    cost -- a real per-component tree-shaken bundle would need a separate
    architecture, not attempted here. Bumped the "reasonably-sized
    bundle" unit test's sanity ceiling to reflect the real, expected new
    size (every compiled preview bundle grows by lucide-react's ~716 KB,
    not just ones that import it).
  - **Also added a starter set of 16 `@radix-ui/react-*` primitives**
    (Dialog, Dropdown Menu, Popover, Select, Tooltip, Tabs, Checkbox,
    Switch, Label, Accordion, Avatar, Radio Group, Separator, Alert
    Dialog, Toast, and Slot -- the ones shadcn/ui-derived pasted
    components reach for most often), to the same allow-list, at the
    user's explicit request ("add lucide react and other
    important/common ones too"). Each is individually small (Radix's own
    modular per-primitive package design), ~560 KB combined -- a modest
    addition next to lucide-react's own size, not another outlier.
    **Doing this surfaced a real, previously-latent gap**: several Radix
    primitives (Dialog, Popover, Select, Tooltip -- anything that portals
    its content) call `ReactDOM.createPortal`/`flushSync` from plain
    `'react-dom'`, which the compiler had never vendored (only
    `react-dom/client`'s `createRoot`) and the require shim
    (`VENDORED_LIBRARY_REQUIRE_SHIM_JS`) had no case for at all --
    confirmed by hand, every portal-based Radix primitive threw "Cannot
    resolve react-dom" before this. Fixed by vendoring the real
    `'react-dom'` entry alongside `react-dom/client` in the same runtime
    bundle (`generate-vendored-react-runtime.mjs`) and adding it to the
    require shim, at effectively zero extra size (both entry points come
    from the same already-bundled package). New regression tests: a
    `@radix-ui/react-switch` fixture (asserts a real `data-state="checked"`
    from `defaultChecked`, proving the actual Radix state machine ran),
    plus a manual portal-based Dialog probe verified by hand. Bumped the
    bundle-size sanity ceiling again to account for the Radix set's real
    combined weight.

- **Fixed a real, currently-live rendering bug** ("this thing good
  sometimes, not good sometimes" -- a real component's live preview
  intermittently collapsed to one character per line with a scrollbar) --
  and, investigating it, **found and fixed a much more serious regression:
  the packaged Tauri app's sidecar has been crashing on startup, for
  every command, since Phase E.**
  - Root cause of the original report: `getOrCompilePreview`'s cache was
    keyed only on `(remoteName, id, version)` -- an already-pushed
    artifact whose own version never changes stays cached indefinitely,
    invisible to every subsequent fix to the compiler itself. Confirmed
    by hand: a real, months-old cached preview for `decrypting-text` (a
    real pushed test artifact) was missing Tailwind CSS generation,
    vendored libraries, and the iframe scrollbar fix -- three separate
    fixes landed earlier this same session -- still running whatever
    measurement logic existed when it was first compiled, including
    timing-dependent races since fixed (explaining "sometimes good,
    sometimes bad": the same stale, racy bundle, not a new bug each time).
    Fixed with a new `PREVIEW_COMPILER_VERSION` constant (`compile.ts`),
    folded into `previewCachePath` alongside the artifact version --
    bumping it whenever compile.ts's output-affecting logic changes now
    invalidates every previously-cached preview across every remote/
    artifact/version in one move, with no manual cache-clearing step.
  - Investigating led to rebuilding the packaged sidecar for the first
    time since Phase E added `playwright-core` -- and it didn't just fail
    to build, it revealed the packaged EXE crashes on startup for every
    single command, not just push: `playwright-core`'s own bundle does a
    dynamic `require(path.join(__dirname, '..', 'package.json'))` at
    import time (to read its own version), and Node's SEA `require` shim
    can only resolve genuine built-ins or whatever esbuild statically
    bundled in -- confirmed by hand, including that marking the whole
    package `external` doesn't help either: a real, on-disk
    `node_modules/playwright-core` sitting right next to the packaged exe
    still isn't resolvable, since Node SEA has NO external module
    resolution at all, for anything, regardless of what's physically on
    disk. Fixed by making the `playwright-core` import in
    `renderPreviewImage.ts` fully lazy (a dynamic `import()` inside the
    one function that needs it, not a static top-level import) -- the
    sidecar now starts fine for every command, and the one place that
    still needs `playwright-core` (an actual push generating a
    `preview.png`) fails INTO the exact same graceful-degradation path a
    Playwright-unrelated render failure already used
    (`maybeRenderPreviewImage`'s own try/catch, push.ts) rather than
    crashing. This is a genuine, permanent platform limit, not a
    temporary one: the packaged desktop app can never generate
    `preview.png` at all (Node SEA cannot run `playwright-core` in any
    form); only the CLI (a real, unpackaged `node` process with real
    `node_modules`) can. Also fixed a second, unrelated packaged-sidecar
    build failure surfaced by the same rebuild: `playwright-core`'s own
    bundle references the optional, never-installed `chromium-bidi`
    package inside a lazily-invoked initializer this project never
    reaches (no BiDi-protocol browser launches, only plain CDP via
    `channel: 'msedge'`/`'chrome'`) -- marked `external` in
    `build-sidecar.mjs`'s esbuild config, same "never resolved, never
    reached" reasoning as the `chromium-bidi` case's own doc comment.
  - New regression tests: a stale-cache-from-an-older-compiler-version
    test (`preview.compile.test.ts`), and a real e2e test proving a
    render failure (a genuine compile error, not Playwright-specific)
    never blocks the push itself, just omits the image (`push.e2e.test.ts`)
    -- the actual safety net now protecting against the newly-discovered
    packaged-sidecar failure mode. Verified by hand against the real,
    rebuilt packaged sidecar exe: an unrelated command (`remote.list`) now
    succeeds where it previously crashed the whole process, and
    `decrypting-text`'s preview now recompiles fresh with every current
    fix present. Full suite (188 tests) + typecheck + lint all clean.

- **Fixed real navigation-flow UX complaints, found by actually using the
  app.** Detail's "← Back to Browse" was hardcoded regardless of entry
  point (Browse, a Tag Folder, or the UI Components list all landed on the
  same generic Browse grid on Back, discarding the actual context), and a
  successful propose from Scan's "Review & propose" always dumped back to
  Browse too, losing the rest of that scan batch's still-unreviewed
  candidates and forcing a full real re-scan to keep going.
  - New `state.detailReturnView`, captured from `state.view` right before
    `openDetail` switches to Detail -- its Back button now branches on it:
    `openTagFolder(category, value)` to reopen the exact Tag Folder (Tag
    Folder's own back button already did this correctly; Detail's didn't),
    or `showView(...)` for `'browse'`/`'ui-components'`. The button's own
    label updates to match ("← Back to Browse" / "← Back to Tag Folder" /
    "← Back to UI Components").
  - New `returnToScan(proposedId?)`: returns Add New (both its own top
    "← Back" link and the post-submit success path) to Scan when
    `addNewWizardMode` is true, restoring the last real `scan.run` result
    (cached in `state.lastScanCandidates`) minus whichever candidate was
    just proposed, if any -- via `showViewRaw`, not `showView('scan')` ->
    `openScanView()`, which wipes the results list (correct for a fresh
    sidebar visit, wrong for "come back mid-review"). Flat/direct Add New
    entry is unaffected -- still returns to Browse, confirmed by hand.
  - Every place a PR URL used to be inert text is now a real "View PR"
    button, opened via the opener plugin's `openUrl` (`showToast`'s own
    doc comment explains why a plain `<a href target="_blank">` doesn't
    reliably work inside a Tauri webview) -- Add New's success toast,
    Detail's per-artifact push-success toast, and Detail's persistent
    pending-PR block (previously showed the raw URL as plain text).
    `opener:allow-open-url` added to `capabilities/default.json`, scoped
    to `https://github.com/*` (least-privilege, matching how
    `allow-open-path` is already scoped rather than wildcard-everything).
  - New "Pull all" button on the UI Components view, for parity with
    Browse and Tag Folder (both already had one) -- the one real gap a UX
    pass through the app found there.
  - Verified in a real browser against a mocked `DeliveryOS.call`/
    `window.__TAURI__` harness (`app.js` has no framework/build step and
    no automated GUI test suite exists for the native Tauri window):
    Browse/Tag-Folder/UI-Components -> Detail -> Back, each landing back
    exactly where it started; Scan -> Review & propose -> success ->
    lands on Scan (not Browse) with the just-proposed candidate gone and
    the other one still there; every new "View PR" button firing `openUrl`
    with the exact right PR URL; flat/direct Add New entry confirmed
    still returns to Browse, not Scan.

- **Fixed a real broken-image bug in Phase E's PR preview, found by pushing
  a real component to a real (private) remote.** The very first live PR
  ([ai-helpers#44](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/44))
  had a dead image link -- `raw.githubusercontent.com` does not serve
  private-repo content to an unauthenticated request at all (confirmed: a
  direct `curl` against the exact committed URL 404s). Also tried a
  `data:` URI base64 fallback and confirmed, by posting a real test PR
  comment and reading its rendered HTML back via the GitHub API, that
  GitHub's PR-body markdown renderer strips `data:` URIs from `<img>` tags
  entirely (the tag came back with an empty `src`) -- so there is no way
  to embed an image inline in a PR body for a private repo at all today.
  New `fetchRepoInfo` (`github.ts`, replacing `getDefaultBranch`) fetches
  the repo's visibility alongside its default branch in the same one
  `repos.get` call, so `pushArtifact` can decide BEFORE building the PR
  body whether to embed the image (public repo) or point at the
  Files-changed tab instead (private repo -- GitHub renders a committed
  image there natively, authenticated, no external fetch involved,
  regardless of visibility). Had to move this fetch to AFTER each branch's
  own local-only validation, not before: two existing tests assert
  `NoLocalChangesError`/`IdCollisionError` fail with zero GitHub API calls,
  and caught this as a real regression the moment the fetch was first
  placed too early in the function. Fixed the already-open PR #44 by hand
  (added the missing `preview.png`, corrected the body text) so it wasn't
  left broken while the underlying fix landed. 2 new tests (a private-repo
  e2e push, a `buildPreviewSection` fallback unit test) + updated fake
  Octokit test helper. Full suite (186 tests) + typecheck + lint all clean.

- **Phase 6, Phase E — PR preview image + the version-bump fix — Done.**
  Closes the last two real gaps in UI Components: a proposed/edited
  component's PR now embeds a real `preview.png`, and edit-mode push can
  finally bump a component's version at all (previously: never, at all --
  `manifest.yaml` was never even part of what edit-mode push touched, so
  `checkForUpdates`/the preview cache could never detect a real edit,
  silently, forever).
  - New `src/engine/preview/renderPreviewImage.ts`: compiles a component's
    preview via the existing `compilePreviewHtml` (the same HTML the live
    sandboxed iframe already uses) and screenshots it with a real headless
    browser (`playwright-core`, `channel: 'msedge'` then `'chrome'` as a
    fallback -- confirmed by hand this dev machine has no Chrome install at
    all, while Edge launched immediately, and this project is Windows-only
    today). Screenshots `#root`'s rendered CHILD, not `#root` itself --
    `#root` is a width-less flex container that otherwise fills the
    viewport, confirmed by hand as a real bug during development (a
    near-viewport-width image with the component tiny and centered inside
    it) before fixing it to crop to the actual component.
  - Used for BOTH the GUI and CLI push paths, deliberately deviating from
    the original brainstormed "GUI reuses the Tauri webview" idea -- no
    such screenshot capability exists in this Tauri app, and building one
    would mean new, fragile, Windows-only WebView2-specific Rust code for
    no real benefit over one consistent path that guarantees the GUI and
    CLI produce the same image for the same source.
  - New `src/engine/manifest/version.ts` (`bumpVersion`) + a new
    `PushOptions.bump` field / `--bump patch|minor|major` CLI flag,
    defaulting to an automatic `patch` bump on any real payload change (a
    metadata-only edit never bumps at all -- its payload, and therefore its
    real behavior, hasn't changed). `push.ts`'s edit-mode branch now writes
    an updated `manifest.yaml` back to the remote cache and commits it --
    for the first time ever in this branch.
  - `preview.png` generation is gated purely on a conventional preview
    entry file existing (`findPreviewEntryFile`), never a `kind` check,
    matching how `post_install` already works -- runs on both propose-new
    and edit-mode pushes, regenerating on every real payload change so
    GitHub's before/after image diff never shows a stale picture. A render
    failure (a real compile error, no browser installed) never fails the
    whole push -- same graceful-degradation principle as an unresolved
    import in the live preview itself.
  - PR bodies embed the image via a plain markdown `![preview](https://raw.
    githubusercontent.com/.../<branch>/...)` tag -- confirmed GitHub
    sanitizes PR bodies/diffs and strips `<iframe>`/`<script>` entirely, so
    a static image is the only way to show a preview inline at all, live or
    not. Edit-mode PR titles/bodies now show `vOLD -> vNEW` when a real
    version bump happened.
  - New test fixture `createTestRemoteWithUiComponentArtifact` (a real
    `kind: ui-component` artifact with a real `Button.tsx` + `preview.tsx`)
    added alongside the existing template/doc/config fixtures, strictly
    additive -- every pre-existing test that assumes "exactly 3 seeded
    artifacts" keeps working unmodified.
  - Updated one existing e2e test (`payloadPath.e2e.test.ts`) whose exact
    diff-file-list assertion predated this fix -- edit-mode push now always
    additionally commits `manifest.yaml`, which is correct, expected new
    behavior, not a regression.
  - 12 new/updated tests (`bumpVersion`, `renderPreviewImage` against a real
    headless browser, `prContent`'s version-arrow/image embedding, 5 new
    `push.ts` e2e tests, 3 new CLI `--bump` parsing tests) + 1 existing test
    updated for the new expected behavior. Full suite (181 tests) +
    typecheck + lint all clean.

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

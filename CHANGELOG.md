# Changelog

All notable changes to DeliveryOS are recorded here, newest first. See
[PLAN.md](PLAN.md) for the phase-by-phase roadmap and
[ARCHITECTURE.md](ARCHITECTURE.md) for design rationale.

---

## Phase 13 — Backend plug-and-play: basic hygiene (in progress)

- **Post-pull secret rotation: `deliveryos config <id>`.** The engine-level
  `applyInstallParams` RPC (`src/sidecar.ts`) already existed, but nothing
  outside the sidecar could call it -- no CLI command wrapped it, and
  `cli/commands/pull.ts` told CLI-only users to "edit `.env.local` directly"
  instead. New `deliveryos config <id> [--remote <name>] --set KEY=VALUE`
  (`src/cli/commands/config.ts`) wraps the exact same real sequence the
  sidecar handler already used (`resolveArtifact` -> `resolveInstallParamValues`
  against `readExistingEnvValues` -> `applyInstallParams`), and reports the
  same `missingRequiredParams`/`gitignoreWarning` output `pull.ts` already
  does. Also prints its own honest, undecorated note that it does NOT
  re-run `wiring_actions` -- a rotated value only reaches code that reads
  `process.env` at runtime, since a real re-wire path is still the
  separate, deferred "A real update-apply path" item below.
- **Uninstall: `deliveryos remove <id>`.** There was no way to cleanly back
  out a pulled artifact at all -- `removeRemoteEntry` only unregisters a
  git remote, never a pulled artifact's own files, and nothing recorded
  which files a pull's wiring had created fresh vs. which already existed
  in the project. `LockEntry` gains two additive fields: `installTarget`
  (the real resolved path `pullArtifact` copied a payload to) and
  `wiredFiles` (`applyDeterministicWiring`'s own `applied` list, recorded
  by `pullAndAutoWire` via a second `upsertEntry` call right after wiring
  runs, only when it created something). New `removeEntry`
  (`src/engine/lockfile/lockfile.ts`) mirrors `upsertEntry`'s real
  inter-process lock. New `removeArtifact`
  (`src/engine/pull/removeArtifact.ts`) deletes the install directory
  (falling back to resolving it via the manifest for an old-shape entry
  with no recorded path), deletes every real `wiredFiles` entry
  (re-validated for containment, never trusted blindly), deletes the
  pristine snapshot, then drops the lockfile entry last -- and reports,
  never auto-touches, anything that predates the pull or went through the
  AI wiring-merge flow (`filesNeedingManualReview`) or is still sitting in
  `.env.local` (`envParamsStillSet`). Wired up as a CLI command, the
  `artifact.remove` sidecar command, and a confirm-gated Remove button in
  Detail. 11 new unit tests plus an updated e2e assertion for the
  lockfile's new shape.
- **Secrets safety net for `.env.local`.** `applyInstallParams` writes
  real secret values into `.env.local` with zero check anywhere that the
  file is actually gitignored -- a real path to committing a secret to a
  shared remote. New `checkEnvLocalGitignoreCoverage` (same `ignore`-
  package pattern as `push/diff.ts`'s `loadIgnoreFilter`) warns clearly
  when it isn't covered, whether by no `.gitignore` at all or one that
  just doesn't happen to include it -- never auto-edits `.gitignore`,
  only warns. Only checked when a call actually wrote something (mirrors
  `upsertEnvFile`'s own no-op-on-empty gate), so the overwhelming
  majority of artifacts with no `install_params` never trigger a
  pointless check. Surfaced as its own distinct toast -- never folded
  into the calm post-install health summary -- everywhere a real
  pull/configure can write a secret: plain pull, `pullAndAutoWire`, the
  Configuration tab's apply button, and bulk pull (aggregated once,
  since every artifact in one run shares the same `.gitignore`). 11 new
  unit tests.
- **Timeouts on build/install commands.** Neither the build check
  (`runProjectBuild`/`execAsync` in `src/engine/pull/verifyBuild.ts`) nor
  the post-install command (`execSync` in `src/engine/pull/pull.ts`) had a
  timeout at all -- a hung/interactive command blocked indefinitely.
  Both now carry a real one (`BUILD_VERIFY_TIMEOUT_MS` = 5min,
  `POST_INSTALL_TIMEOUT_MS` = 10min). Also closed a real, confirmed gap
  where "the tool to run this isn't on PATH" looked identical to "the
  code doesn't compile": both call sites now report a genuine timeout and
  a genuine missing-tool case as their own distinct, honest outcome
  (`BuildVerificationResult`'s new additive `timedOut`/`toolNotFound`
  fields; `PostInstallError`'s message text gains distinct prefixes for
  the same two cases). The "tool not found" detection was verified
  empirically first, not assumed from docs: on Windows, `exec`/`execSync`
  route through cmd.exe, so a missing tool never throws a Node-level
  ENOENT -- it's the shell reporting an ordinary-looking non-zero exit
  with its own "not recognized"/"not found" wording. 6 new unit tests
  (`test/unit/verifyBuild.test.ts`, `test/unit/pull.test.ts`) exercise
  real hung/missing-tool commands with test-only timeout overrides, not
  mocks. One real, confirmed limitation found along the way, deliberately
  left as a known gap (bigger than this item's scope): on Windows, killing
  a timed-out command only terminates the immediate shell wrapper, not the
  grandchild process it actually spawned -- a "timed out" command can keep
  running in the background afterward.

## Phase 12 — Backend plug-and-play, unlocked further

- **A visible audit trail for the wiring-merge log.** Each
  `wiring-merge-log.jsonl` entry is now tagged with the artifact that
  caused it (fixed before it ever shipped, since the wiring-merge PR was
  still open/unmerged), so a project with more than one pulled
  backend-plugin artifact doesn't mix their entries together. New
  "Activity" Detail tab, gated on real matching entries existing, shows
  what was proposed, applied, or rolled back, with before/after content
  behind a `<details>` disclosure. 6 new/updated unit tests, real
  dogfood via a throwaway script confirmed filtering and ordering.
- **Post-install health narrator.** Closed a real, confirmed gap: the
  toast shown after an auto-wired Pull never mentioned still-missing
  required `install_params` at all -- silently dropped. New
  `buildPostInstallHealthSummary` (deliberately deterministic, not an AI
  call -- every input is already a known fact) synthesizes wiring
  applied/needsReview, the build result, and missing install params into
  one coherent plain-language summary, shown both as the Pull toast and
  as a persistent Detail banner (the toast fades; the banner doesn't).
  9 new unit tests covering every real scenario (clean pass, missing
  params, build failure with a capped output excerpt, no build command
  detected, nothing left to do).
- Reviewed the original 6-item Phase 12 brainstorm against this
  project's own discipline (only build what's proven needed) before
  committing to anything -- 4 of the 6 items were deferred or descoped
  with reasons recorded in PLAN.md; only the two above were built.

## Phase 7 — Backend plug-and-play: AI wiring merge

- **Closed a real, previously-unaddressed gap in Tier-2 wiring**: when a
  `wiring_action`'s target file already existed at pull time, the only
  option was "review it yourself" -- even a static `whenPresent.snippet`
  the artifact's author wrote was just merge guidance text, never
  applied. New "Merge with Claude" button in Detail's wiring section:
  reads the real existing file, proposes a genuine merged version via a
  real Claude subprocess, applies it on confirmation, and re-runs the
  project's real build to verify -- auto-rolling back if it doesn't
  actually keep the project building. Same ask→apply→verify→rollback
  shape already proven for the build-fix and design-fix flows, with its
  own audit log (`wiring-merge-log.jsonl`).
  Dogfooded for real against the actual `nextauth-credentials` artifact
  on a real scratch project: an honest `mergedFile: null` refusal on a
  genuine library conflict (better-auth vs. NextAuth, never guessed or
  forced), a real rollback when a proposed merge broke the build for an
  unrelated environment reason (a missing path alias), and a clean merge
  + passing rebuild for a genuinely additive case (adding an auth
  middleware export while preserving an unrelated existing export and
  merging two matcher arrays). 19 new unit tests.

## Phase 11 — Design-kit bundle & design-quality checks

- **Phase 11's last open item, run for real: the full design-quality
  end-to-end test.** Pulled the real `design-kit` bundle (now 10
  components) into a fresh scratch project via the real CLI, confirmed
  every component compiles/live-previews clean, then planted a genuine
  self-nesting anti-pattern in a new component simulating "Claude Code
  built UI from the kit." A real `deliveryos scan` correctly flagged it;
  the real fix flow (a real Claude subprocess call, then a real apply +
  recompile) fixed it for real, confirmed by re-checking the fixed file
  no longer trips the detector. Phase 11 is now fully done.
- **Source-drift detection for extracted artifacts.** Once a project or
  component is extracted from a real external codebase (via the
  `starter-kit-extractor`/`ui-component-extractor` skills), nothing
  previously tracked whether that real source had since changed. New
  `src/engine/drift/` module hashes each source file at extraction time
  (`SOURCES.json` at the payload root) and re-hashes it later to report
  `unchanged`/`drifted`/`source-missing` — via a new `deliveryos
  check-drift` CLI command and a "Check for source drift" Detail tab,
  both gated on real `SOURCES.json` presence. Verified against the real
  `kortix-design-kit` artifact and Suna's actual source on disk.
- Fixed Detail's Type Scale section rendering blank for any design kit
  whose `GUIDELINES.md` names its table columns differently than the
  original `design-kit` artifact (found via `kortix-design-kit`, whose
  real Suna-derived table has no `Element`/`Weight` columns at all) —
  now falls back across known column names, and correctly converts
  `rem`-based sizes to pixels.
- Scan can now detect a whole standalone project (not just a single
  component) as a pullable `kind: template` candidate, requiring both a
  real build script and real routing evidence so it doesn't over-flag
  every package in a monorepo. Ships alongside a new
  `starter-kit-extractor` skill for the human/AI judgment work of
  cleaning one up.
- Fixed two Detail-view bugs found from real use: switching views no
  longer leaves the new view scrolled to the old view's position, and a
  brand-new artifact's tabs now correctly default to the intended lead
  tab (Design/Components) instead of getting stuck on Configuration just
  because it resolved first. Also moved the per-component "Pull" button
  into the component's own detail view and reordered Detail's tabs so
  the visual content leads.
- A full review pass on the Detail-tabs/markdown/pull-component work
  (two review agents plus manual verification) found and fixed several
  real bugs: a markdown XSS gap where `javascript:` links rendered live
  (fixed with a URL-scheme allowlist), a tab-state race where a
  same-artifact refresh could silently steal the active tab, a
  stale-data bug when returning from a component's detail view mid-
  refresh, a leaked iframe listener, a component-pull bug that silently
  dropped nested files and overwrote existing ones on re-pull, an
  empty-`GUIDELINES.md` tab-visibility bug, and unwrapped long tokens
  clipping off the markdown frame's edge.
- Fixed a "Back to Browse" infinite loop after visiting a component's
  own detail view, and added a "Pull" button per component in the
  Components tab so a single component's file(s) can be copied into a
  project without pulling the whole artifact.
- Detail view now renders real markdown (headers, tables, links, code
  fences) instead of literal text, via a vendored markdown parser inside
  a sandboxed iframe with escaped HTML and a safe-URL allowlist. Also
  split Detail's growing pile of sections into tabs
  (Preview/Configuration/Documentation/Design/Components/Routes), only
  showing tabs that actually apply to a given artifact.
- Detail view now shows a real route/page map for whole-app templates,
  parsed directly from the artifact's own `src/routes.tsx` rather than a
  hand-maintained description.
- Shipped `growtharc-react-vite-starter`, the company's whole starter
  kit (Vite+React+TS, routing/layout, Azure AD SSO) as one pullable
  template, merged from real project branches with several real bugs
  fixed along the way (import-casing, dead CSS, a missing route, an
  invalid SCSS lint config).
- Added a generic README fallback in Detail for artifacts that have
  neither `GUIDELINES.md` nor install params, so config-only artifacts
  still show their setup instructions.
- Added a dedicated per-component detail view for design-kit's grid,
  showing every variant, a live props panel, and full usage-rule text.
- Grew the catalog with three real artifacts pulled from a GrowthArc
  project template: `azure-msal-sso` (Azure AD/Entra SSO backend
  plugin), four new design-kit components, and `react-vite-lint-scaffold`
  (a lint/tooling starter template) — each with real bugs found and
  fixed in the source before shipping.
- Matched Detail's visual polish to an earlier pitch mockup (bigger
  token swatches, real applied type samples, per-component usage-rule
  captions, a real layout-rules strip), and re-verified the mockup's
  other two scenes (the check-first skill, and a live unscripted demo)
  still hold up for real.
- Added a real Detail view for design-kit templates: live color/type
  tokens parsed from `GUIDELINES.md`, a component grid, and a light/dark
  theme toggle.
- Extended design-kit with `EmptyState`, `ErrorState`, and `Skeleton`
  components, plus a Motion section in `GUIDELINES.md` documenting
  transition timing.
- Built the "fix" step for design findings: an explicit ask/apply flow
  that identifies the right file, applies a fix, recompiles to verify,
  and auto-rolls back on failure.
- Added "Suggest with Claude" for anti-patterns a mechanical rule can't
  catch — an explicit, opt-in button that calls Claude Code to review a
  component and surface subjective issues (e.g. low-contrast text,
  inconsistent border radius).
- Added the first mechanical anti-pattern detector: flags a component
  that renders itself nested exactly two levels deep, while correctly
  allowing legitimate single-level recursion (e.g. a tree node).
- Shipped the design-kit bundle itself: five real components (Button,
  Card, TopBar, Feedback, Input) plus a `GUIDELINES.md` documenting the
  design system's radius/spacing/color tokens for the first time. Found
  and fixed a real rules-of-hooks bug in one component's preview along
  the way.

## Preview engine fixes (dark mode & sizing)

- Fixed a real dark-mode contrast bug in previews: components using
  `dark:` Tailwind classes were rendering against the viewer's own OS
  color scheme instead of a pinned light theme, explaining both a
  contrast complaint and a "background changes on its own" report.
  Pinned the preview compiler to light mode so `dark:` variants never
  activate, fixing every past and future component that uses them in
  one change.
- Chasing that fix, found and fixed three more bugs: a missing
  cache-version bump meant the fix wasn't reaching already-compiled
  previews; a translucent-surface component looked muddy against the
  preview frame's opaque background (removed the fill/border); and a
  hover-lift micro-interaction was getting clipped by the iframe's zero
  padding (fixed with a small padding, sized into the height
  measurement).
- That padding fix caused two regressions — a button row started
  wrapping unexpectedly, and any component using `min-height: 100vh`
  grew its preview to the maximum size via a feedback loop — both
  traced to the same root cause and fixed by reverting the padding
  change.
- Fixed a separate, narrower bug found while investigating the above:
  the "not yet mounted" check inferred that state from a literal 0×0
  measurement, which could also happen briefly for other reasons;
  replaced with a direct check of whether React has actually mounted
  anything yet.

## Phase 10 — Claude Code wired into the app UI

- "Want help fixing this?": on a build failure, an AI subprocess (no
  tool access, strict JSON in/out) proposes a fix from just the failing
  file and the error; a person reviews and applies it, the app re-runs
  the real build to confirm, and auto-rolls back if the fix didn't
  work. Every applied fix is recorded in a new audit log.
- The same code-review pass found five more real bugs, fixed the same
  day: blocking subprocess calls that froze the whole sidecar process
  during a slow AI call (made async); a prompt-injection gap where
  untrusted payload source wasn't clearly delimited from instructions;
  two "Suggest with Claude" UI bugs; a duplicated file-walking helper
  consolidated into one; and a detection gap for bracket-notation
  `process.env['FOO']` closed.
- Security fix: a path-traversal bug in the automatic wiring writer let
  a malicious `target_file` (e.g. `"../../../../evil.txt"`) write
  outside the target project. Fixed with a containment check applied at
  two independent layers.
- Added "Suggest with Claude" to Add New's autofill: an explicit button
  that calls a real `claude -p` subprocess to fill `description`/
  `componentTypes` when static analysis has no signal. Found and fixed a
  real Windows command-injection bug before shipping, and confirmed
  Claude Code's own tool-restriction flags aren't reliably enforced, so
  the design doesn't depend on them.
- Extended autofill to cover `stacks`, `description`, and `owner` for
  every artifact kind — each always sourced from a real mechanical fact
  (imports, JSDoc, git identity), never fabricated, and left blank when
  there's no real signal.
- Shipped deterministic apply-and-test on Pull: an artifact declaring
  `wiring_actions` now auto-applies safe file-writes (never overwriting
  an existing file) and runs the target project's own build
  automatically, reported in the progress log. Also added code-driven
  autofill for Add New's `install_params`, scanning a proposed
  artifact's real source for env-var references.

## Phase 9 — Claude Code as the status/health interface

- Shipped `deliveryos-status`, a Claude Code Skill for asking "what's
  the status": runs typecheck/lint/test and reports pass/fail, plus a
  doc-sync check that greps PLAN.md/CHANGELOG.md for PR links and flags
  any that describe a PR as still open when GitHub shows it merged. A
  real run against this repo found and fixed eight such stale-doc cases.

## Phase 8 — Claude Code check-first

- Installing `deliveryos-check-first` into a real global Claude Code
  skills directory and running it on an undirected task surfaced a
  real, previously-undiscovered bug: 4 of the catalog's 6 UI components
  destructured React hooks from a runtime global instead of a normal
  `import`, so they crashed immediately outside DeliveryOS's own preview
  sandbox. Root-caused to the preview compiler never marking `react`/
  `react-dom` as external, and fixed for good.
- Added a `deliveryos wiring` CLI command exposing Tier 2 wiring
  actions, and taught the skill a real wire-and-test loop (apply a
  snippet, run the build, fix what fails). A second end-to-end run
  found one more gap: `list --json` wasn't returning enough for the
  skill to evaluate a match without pulling first; fixed by extending
  it.
- Shipped `deliveryos-check-first` itself: a Claude Code Skill that
  checks the catalog automatically on relevant tasks instead of relying
  on someone remembering to look, so reuse becomes a side effect of
  normal engineering work.

## Phase 7 — Backend plug-and-play artifacts

- An end-to-end test in a genuinely fresh Next.js project proved the
  whole loop (pull, install-time config, signature verification,
  wiring) together for real, and found three real bugs no unit test
  could catch: a wiring path assumption that didn't match the
  artifact's own install location, a wrong API-route wiring snippet, and
  a cross-platform bug where Windows' default git line-ending setting
  silently broke signature verification.
- Shipped the security/provenance model: keyless Sigstore signing in
  CI, verified before any files are written on pull. Proven with a real
  signed artifact, and confirmed to fail closed against both a tampered
  payload and a forged certificate identity.
- Shipped the wiring agent (Tier 1 + Tier 2): safe placeholders are
  auto-filled from install params, and a new `wiring_actions` manifest
  field lets an artifact declare the handful of edits a project needs —
  surfaced as suggestions, never auto-applied.
- Shipped Detail/Pull UX for non-visual artifacts: a project's own
  `.env.local` gets an artifact's declared install params applied
  automatically, with a required-config checklist and provenance badge
  in Detail. Fixed a real bug where configuring one missing value made
  every other already-set value look missing again.
- Extended the manifest schema with `install_params`, `content_digest`,
  and a `signature` field, fully backward-compatible with every
  existing manifest.
- Pushed Phase 7's real target: an Auth.js v5 + Prisma Credentials login
  module for Next.js, with install params and a README documenting
  manual wiring steps.

## Tier 0 hardening

- Closed a real lockfile race between background auto-sync and a
  concurrent manual pull/push (fixed with proper file locking), and
  closed the "check GitHub by hand" gap by wiring PR merge/close-status
  polling into the same auto-sync tick that already checks for version
  drift.

## Phase 6 — UI Components

- Closed out Phase 6's end-to-end test checklist against a live remote.
  Found a real bug where a fix had been pushed to a PR branch after the
  PR already merged, so it never reached `main` — fixed via a follow-up
  PR. Then walked the full edit + drift-detection loop across two
  different projects, confirming `check-updates` jumps straight to the
  true latest version and a re-pull picks up the real change.
- Fixed a real docgen bug where `React.FC<Props>`-style components
  silently returned no prop schema — converting to a plain typed
  function fixes it. Vendored `lucide-react` so components importing it
  actually compile, plus a starter set of 16 Radix UI primitives, which
  surfaced a real gap where portal-based Radix components (Dialog,
  Popover, Select, Tooltip) couldn't resolve `react-dom` at all; fixed
  by vendoring that too.
- Fixed a real intermittent preview-rendering bug (a stale, months-old
  cached preview was still running long-superseded compiler logic) by
  keying the preview cache to a compiler-version constant, so any
  future compiler fix invalidates every cached preview at once.
  Investigating it surfaced a much more serious regression: the packaged
  desktop app's sidecar had been crashing on startup for every single
  command since a dependency was added, because Node's packaged-
  executable format can't resolve certain dynamic imports. Fixed by
  making that import lazy — a real platform limit that means the
  packaged app can never generate PR preview images itself; only the
  CLI can.
- Fixed real navigation complaints: Detail's "Back" button now returns
  to the real entry point instead of always landing on Browse, a
  successful propose from Scan's Review flow returns to Scan with the
  rest of that batch intact, and every inert PR-link became a real
  clickable "View PR" button.
- Fixed a broken PR preview image on the very first live PR:
  private-repo images aren't fetchable from GitHub's raw-content host by
  an unauthenticated request, and GitHub's PR-body renderer strips
  `data:` URI images entirely. Fixed by pointing at the PR's
  Files-changed tab instead when the repo is private.
- Shipped PR preview images and real version bumps on edit: a proposed
  or edited UI component's PR now embeds a real screenshot (captured
  with a real headless browser against the live-preview HTML), and
  edit-mode push finally writes an updated `manifest.yaml` — previously
  edits never bumped the version at all, so drift detection could never
  see a real edit.
- Fixed a scrollbar-flash bug during a component's resize/animation
  transitions, and documented a related, non-fixable platform limit:
  content meant to visually extend beyond its box (a tooltip, a
  dropdown) can never escape an iframe's box in current Chrome/Firefox.
- Added real Tailwind CSS generation to the preview pipeline (previously
  a Tailwind-authored component's preview had correct structure but zero
  visual styling), then fixed a packaged-app-only bug where Tailwind's
  CSS reset silently failed to load in the packaged executable, and
  vendored a short allow-list of common UI-kit libraries (`framer-motion`,
  `clsx`, `tailwind-merge`, `class-variance-authority`) so pasted
  components using them actually compile — fixing a real ESM/CJS
  interop bug along the way.
- Surfaced the real underlying error message in "Preview unavailable"
  placeholders instead of a bare, unhelpful message, and added a
  `ui-component-extractor` skill documenting how to bring an arbitrary
  pasted React component (from v0, shadcn, etc.) into a project so it
  compiles and is picked up by Scan.
- Fixed two gaps in Scan's auto-scaffolded preview: a required prop with
  a literal-union type or no sensible default got an invalid or blank
  placeholder value (fixed by picking a real allowed value or using the
  prop's own name), and a required function-typed prop got a real
  callable no-op instead of a placeholder that would throw if called.
- Wired structural UI-component detection into Scan (CLI, sidecar, and
  app): a purely deterministic heuristic (no AI call) finds components
  with a real props interface, auto-scaffolds a preview file, and gives
  the scanned candidate a real live preview plus import-safety warnings
  in Review.
- Fixed two real ResizeObserver bugs behind "different style on every
  refresh" and a later regression of the same fix: the observer was
  briefly watching the wrong element (a timing gap before React's first
  render), and a later fix for that re-introduced the bug in the real
  app specifically because measuring an element by resizing it put that
  same element back in the observer's own watch path — fixed by
  measuring a detached clone instead.
- Reworked the UI Components page's layout twice based on real
  feedback: first into a size-to-content masonry grid (several real
  bin-packing/measurement bugs fixed along the way), then simplified to
  a plain vertical list, removing the masonry dependency entirely. Also
  made the preview frame's width shrink to fit each component's real
  content, mirroring how height already worked, and fixed two serious
  regressions that width work introduced — a feedback loop that could
  shrink text to one character per line, and a permanent layout
  corruption from ever reporting a 0×0 pre-mount measurement. A
  separately reported hover-border-overflow bug could not be reproduced
  under rigorous testing and was left open.
- Added Storybook-style interactive controls to Detail: a component's
  props schema is derived automatically from its TypeScript interface,
  and variant switching/prop editing happen live against the same
  loaded preview. An independent code-review pass found and fixed four
  real bugs, including a listener leak and missing error handling
  around a broken variant.
- Added the "UI Components" feature itself: a new sidebar page shows
  real pushed React/TS and plain HTML/CSS/JS components as live,
  interactive preview cards, compiled via esbuild into a self-contained
  document and rendered inside a sandboxed iframe with a strict CSP. A
  code-review pass caught and fixed 7 further issues, including an
  observer leak and a click dead-zone over the live preview.

## Phase 5 — Polish

- Reworked the growtharc-ai-helpers import for real structural fidelity:
  agents/commands/rules now preserve their real category subfolders
  instead of flattening into one directory, and Scan now also looks at
  `.claude/commands`/`.claude/rules`. The catalog grew to 210 artifacts.
- Added `deliveryos scan`: finds agents/skills in a project that aren't
  tracked yet and proposes them, with a guessed description from
  frontmatter. Verified with a real end-to-end propose → merge → pull
  round trip.
- Added remote removal (`deliveryos remote remove`), and fixed a latent
  bug where a single-file payload always got wrapped in a directory
  convention, breaking `pull` whenever `install_target` was itself
  meant to be a file.
- Added an Edit button to Detail (and matching CLI flags) so an
  already-tracked artifact's description/roles/teams/stacks can change
  without touching its payload, via the same PR flow. Add New gained
  matching Stack and Team fields (previously roles-only), and tag
  values (stacks/roles/teams) now normalize case so "python" and
  "Python" no longer created two separate tag folders.
- Fixed the shared progress panel staying visible after navigating away
  from its artifact, a related layout bug where a long path could force
  the whole page wider than the viewport, and — found in a follow-up
  review pass — a Tag Folder "Pull all" that never showed the progress
  log at all plus a panel-position bug that pinned it to the window
  bottom regardless of content.
- Restyled the tag value list twice based on feedback (boxed icons →
  breadcrumb list → a card grid with an artifact count per tag), and
  fixed a CSS-specificity bug where hiding the artifact grid behind an
  expanded tag category silently didn't work.
- Added tag-based bulk pull as its own Tag Folder view: picking a tag
  category and value opens a dedicated page listing every artifact with
  that tag, each with its own inline Pull/Push button plus a "Pull all"
  for the whole folder.
- Fixed a crash proposing a new artifact from a single file via the
  file picker.
- Added transparency about what happens after a push opens a PR: the
  artifact's lockfile entry now tracks the PR, and Detail shows a
  "Check push status" button, resolving to `edited_locally`, still-open,
  or a real re-sync depending on the PR's actual state.
- Fixed a real bug found demo-prepping `arcos-cli`: running a pulled
  Python tool generates cache files that `.gitignore` correctly
  excludes, but the local-edit detector didn't know about `.gitignore`
  at all and misread the cache as a local edit, breaking a real push.
- Fixed `push --new` copying a whole project folder's payload
  unfiltered (including a nested `.git/` directory and anything the
  project's own `.gitignore` excludes), and fixed it crashing whenever
  a proposed id contained a space or uppercase letter, since git branch
  names can't contain whitespace — the id is now slugified and
  validated client-side first.
- Fixed Browse's "Refresh" button only re-reading the local cache
  instead of actually fetching from the remote, so a newly merged
  artifact never appeared until something else happened to trigger a
  fetch, and fixed `edited_locally` having no way to resolve in the UI
  (added a "Discard local edit and re-sync" option).
- Restyled the desktop app end to end against the ArcAI design system:
  renamed color tokens to match, corrected heading weights, added
  AI-specific button/badge variants, an accessible focus ring, and a
  reduced-motion mode. Also fixed three places using the AI-reserved
  accent color for plain, non-AI UI.
- Closed several real filter/sort/search gaps: multi-select kind chips,
  a Remote filter, a Sort control, broader search (kind/owner/tags), and
  generalized "Pull all" to respect whatever filters are active. Add
  New's Kind field now offers every kind already in the catalog plus a
  way to add a new one, and Roles/Stack/Team became a reusable
  chip-picker instead of a raw comma-separated text field.
- Turned Add New into a step-by-step wizard (progress bar, Next/Back, a
  final Review step with per-field Edit links) — later scoped to only
  Scan's flow after feedback that stepping through mostly-blank fields
  for a direct Add New felt worse, not better.
- Rebuilt the app's navigation around a left sidebar (Browse, Browse by
  tag, Settings, Scan, Add New), replacing the old top bar, with
  "Browse by tag" as its own real destination. Removed the "AI guessed"
  sparkle badge from Scan results as a gimmick rather than useful
  signal, since every field is editable anyway.
- Added drift detection (`check-updates`): compares a pulled artifact's
  recorded version against the remote's current one, with a distinct
  "both changed" state when it's also been locally edited.
- Added background auto-sync: a 20-minute timer reruns the same check
  automatically, staying quiet unless it finds something.

## Phase 3 — Tauri app

- Added `src/sidecar.ts`, a JSON-over-stdio dispatcher wrapping the
  engine, and packaged it as a standalone Node executable — the
  foundation letting a desktop UI talk to the engine with no Node
  install needed on the target machine.
- Built the real Tauri desktop UI (Browse, Detail, Add-new, Settings)
  via one generalized sidecar-call Rust command, styled with the
  ArcFlow brand system, with live progress visibility during Pull/Push
  (a real, named-stage activity log instead of a fake percentage bar).
  Deliberately deferred: onboarding/sign-in, sync/drift banners,
  conflict resolution, version history, profile switching.
- Restructured Browse cards so the whole card opens Detail, with
  Pull/Push happening from there, and added an "Open folder" button in
  Detail — fixing two real bugs found in QA (an unscoped permission,
  and a wrong API that opened files in an editor instead of revealing
  them).
- Added a "Setup command" field for a brand-new artifact's own install
  step (`--post-install`), verified end-to-end via a real PR merge and
  pull.
- Real MSI/NSIS installers build successfully; cold-start latency
  measured acceptable.
- Fixed several real bugs found in QA: the "Refresh" button (and any
  button sharing its busy-state helper) could get stuck showing
  "Working..." after two overlapping actions raced; a pull's "pristine
  snapshot" was taken before `post_install` ran, so its generated files
  were misread as local edits; `post_install`'s own output could have
  corrupted the sidecar's JSON stream; and the Rust host could leak
  orphaned sidecar processes on certain error paths.

## Phase 2 — ArcOS as a remote

- Added an optional `payload_path` manifest field so pull/push can read
  from a pre-existing file/directory elsewhere in a remote's repo,
  instead of requiring the fixed `artifacts/<id>/payload/` convention.
- Wrote real manifests for two ArcOS catalog assets, using
  `payload_path` to point at their real files.
- Proved the full pull → edit → push → PR loop end to end against real
  ArcOS catalog content, via a personal scratch fork since forking the
  shared repo is disabled at the org level. Left open: whether ArcOS's
  own multi-reviewer convention applies to catalog assets.

## Post-Phase-2 addendum — two more real artifacts

- Added `arcos-cli`, a full pull-only mirror of the real `arc_os` repo,
  and `launchpad-template`, sourced from an entirely unrelated Next.js
  starter kit — confirming the manifest/pull/push mechanics are
  genuinely payload-agnostic, with zero engine changes needed for
  either.

## Phase 1 — Push

- Added `deliveryos push`: pushes a local edit as a branch + real
  GitHub PR, and a `--new` mode to propose a brand-new artifact the same
  way.
- Diff detection via a pristine snapshot taken at pull time; PR
  creation via Octokit, authenticated through the ambient `gh` CLI;
  id-collision detection on propose-new.
- Fixed two bugs found in QA before release: a cache-isolation bug
  where a second push could build on a prior push's leftover commit,
  and a flag-name collision with Commander's own `--version`.

## Phase 0 — Engine MVP

- Added `deliveryos remote add`, `deliveryos list`, and `deliveryos
  pull` — the core loop of registering a git-backed remote, listing its
  artifacts, and copying one to its manifest's `install_target`, tracked
  in a project-local lockfile.
- Manifest schema (zod) with an intentionally open-ended `kind` field.

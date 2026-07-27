# Changelog

All notable changes to DeliveryOS are recorded here, phase by phase. See
[PLAN.md](PLAN.md) for the roadmap and [ARCHITECTURE.md](ARCHITECTURE.md) for
design rationale.

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

- Add New's Kind field is now a `<select>` populated from every distinct
  kind already in the catalog, with a "+ New kind..." option that reveals a
  text input for inventing one that doesn't exist yet — kind stays
  open-ended by design (see ARCHITECTURE.md), this is just a convenience for
  the common case of reusing "agent"/"skill"/etc. instead of retyping it
  from memory. Roles/Stack/Team fields (in both Add New and Detail's Edit
  form) became a small chip-picker component (`createTagPicker`) backed by a
  `<datalist>` of values already used elsewhere in the catalog, replacing
  the old raw "type a comma-separated list and hope you spell it the same
  as last time" text inputs — still fully free-text (a new tag is just as
  valid), just easier to reuse an existing one without a near-duplicate
  typo ("python" vs "Python") creating a second, separate tag folder.

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

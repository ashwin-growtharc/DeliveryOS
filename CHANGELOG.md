# Changelog

All notable changes to DeliveryOS are recorded here, phase by phase. See
[PLAN.md](PLAN.md) for the roadmap and [ARCHITECTURE.md](ARCHITECTURE.md) for
design rationale.

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

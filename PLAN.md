# DeliveryOS — phase-by-phase task plan

Companion to [ARCHITECTURE.md](ARCHITECTURE.md). That file explains *what* and
*why*; this file breaks each phase into concrete, checkable tasks — *how* and
*in what order*.

**Phases 0–2 are the MVP/POC**: single developer, no auth, no UI, CLI only.
Proves the core loop — pull, edit, push, review, merge — works end to end
against one real remote before anything else gets built.

---

## Phase 0 — Engine MVP — **Done**

Goal: `deliveryos pull` works against one throwaway test remote. No auth, no UI.

- [x] Scaffold a plain TypeScript project (`package.json`, `tsconfig.json`, basic `src/` layout)
- [x] Define the manifest schema as TypeScript types + a runtime validator (e.g. zod) — matches §7 of ARCHITECTURE.md, including `tags.stacks` and `refresh`
- [x] Implement the manifest parser: read a remote's manifests, validate against the schema, reject anything malformed
- [x] Implement the lockfile: a JSON file per machine recording `{ id, version, remote }` for everything installed
- [x] Implement `remote add <git-url>`: register a git repo as a source, clone/fetch it locally
- [x] Implement `list`: read manifests from all registered remotes, print what's available (no profile filtering yet — that's Phase 4)
- [x] Implement `pull <id>`: find the manifest, copy its content to `install_target`, run `post_install` if present, update the lockfile
- [x] Create one small real test remote (a throwaway git repo with 2–3 sample manifests covering different kinds) to pull against
- [x] **End-to-end test:** `deliveryos remote add` → `deliveryos list` → `deliveryos pull` run in sequence against the test remote, confirm files land correctly and the lockfile updates. Nothing in Phase 1 starts until this passes.

See the repo root `src/` and `test/` for the implementation (CLI: `commander`, schema: `zod`, git: `simple-git`, tests: `vitest`); [README.md](README.md) has usage.

## Phase 1 — Push — **Done**

Goal: `deliveryos push` opens a real GitHub PR from a local edit. Still no auth beyond the developer's own existing git/GitHub credentials.

- [x] Add GitHub API integration (e.g. Octokit) for branch creation, commit, and PR opening
- [x] Implement diff detection: compare the local copy of a pulled resource against the version recorded in the lockfile
- [x] Implement `push`: create a branch, commit the changed files, open a PR against the owning remote, with an auto-drafted title/description
- [x] Handle the "propose new" case separately from "edit" (§5.5 concept in ARCHITECTURE.md): no prior lockfile entry means the PR is framed as a new-resource addition, not a diff
- [x] Add basic `id` collision detection on propose-new (reject/warn if the id already exists in the target remote)
- [x] **End-to-end test:** full round trip against the test remote — `pull` → edit locally → `push` → confirm a real GitHub PR appears with the correct diff and branch name. Nothing in Phase 2 starts until this passes.
      Automated e2e against a local git fixture + fake GitHub client passes (`test/e2e/push.e2e.test.ts`, `test/e2e/push.cliFlags.e2e.test.ts`). The real-GitHub check also passed manually against `ashwin-growtharc/deliveryos-smoke-test` — see [docs/manual-smoke-test-push.md](docs/manual-smoke-test-push.md) — both edit-mode (PR #1) and propose-new-mode (PR #2), branch name/diff/title/body all matched exactly.

See [CHANGELOG.md](CHANGELOG.md) for what shipped, including two bugs found and fixed during QA (cache-isolation contamination, a `--version` flag collision).

## Phase 2 — ArcOS as a remote (MVP/POC complete here) — **Done, with a caveat**

Goal: pull a real ArcOS catalog asset, edit it, push a real PR against `arc_os`, respecting its own review rules.

- [x] Write DeliveryOS manifests for a small number of real ArcOS catalog assets (start with just `code-reviewer` and one skill), mapping ArcOS's existing frontmatter into DeliveryOS's manifest shape
- [x] Register `arc_os`'s `catalog/` as a real DeliveryOS remote
      Forking `growtharc/arc_os` is disabled at the org level, so this was proven against a personal scratch copy (`ashwin-growtharc/arc_os-catalog-poc`, seeded with real catalog file content) rather than the shared repo itself — see [docs/phase-2-retro.md](docs/phase-2-retro.md).
- [x] **End-to-end test:** pull a real ArcOS skill/agent via `deliveryos pull`, make a real edit, `deliveryos push`, confirm a real PR lands. The mechanical loop is fully proven ([arc_os-catalog-poc#1](https://github.com/ashwin-growtharc/arc_os-catalog-poc/pull/1)); the "respects `arc_os`'s own 2-reviewer convention" half is **not yet proven against the real repo** — see the retro for why that rule is ambiguous even on ArcOS's own current, ratified conventions.
- [x] Write up what broke / what was harder than expected — see [docs/phase-2-retro.md](docs/phase-2-retro.md), including a recommended `payload_path` engine addition (shipped) and a conditional go/no-go for Phase 3.
- [x] **Post-Phase-2 addendum:** two more real artifacts added to prove the pattern generalizes, verified end-to-end via the built CLI with zero engine changes — `arcos-cli` (a `kind: template`, Pull-only, whole-ArcOS-repo mirror, added to the existing `arc_os-catalog-poc` scratch remote; see [docs/artifact-arcos-cli-retro.md](docs/artifact-arcos-cli-retro.md)) and `launchpad-template` (DeliveryOS's first artifact sourced from a completely different real project — Launchpad's Next.js starter kit, on a brand-new scratch remote; see [docs/artifact-launchpad-template-retro.md](docs/artifact-launchpad-template-retro.md)).

---

## Later phases — lighter detail until Phase 2 is proven

## Phase 3 — Tauri app

- [x] Spike: package the TypeScript engine as a Tauri sidecar process; confirm size and startup latency are acceptable (§9 risk #11) *before* committing further
      Done — see [docs/phase-3-spike-results.md](docs/phase-3-spike-results.md). Binary/installer size are solidly green (88MB sidecar, 25-38MB installers). Cold-start latency is green on the median (~108ms) but has a yellow-band tail (up to 391ms in re-testing) — not blocking, but worth a larger real sample once the actual UI exists.
- [x] Confirm who owns the Rust shell layer (§9 risk #10) before starting
      Resolved: built via Claude Code (this tooling), directed by the user — no separate staffing question for this project.
- [x] Build the Rust shell + webview skeleton
- [x] Wire up Browse / Pull / Push UI (per the mockups already built) to the engine via the sidecar
      Done, with a deliberate scope cut from the original mockup — see [docs/phase-3-ui-scope.md](docs/phase-3-ui-scope.md). Built for real: Browse (search/filters/status badges), Detail, Pull, Push (edit + propose-new), Settings (remotes), a live progress log during Pull/Push, and an Open Folder button. Omitted: onboarding/sign-in, sync/drift banner, conflict resolution, version history, profile switching — none have engine support yet (Phase 4/5). Styled with the ArcFlow brand system (later restyled against `DESIGN_SYSTEM.md` — see Phase 5). Verified via sidecar-level e2e tests (data correctness) + [docs/manual-ui-clickthrough.md](docs/manual-ui-clickthrough.md) (human click-through — no automated GUI test suite exists for the native Tauri window, though ad hoc native-window automation has since proven possible for one-off checks). One known gap: `artifact.push`'s success path can't be tested through the sidecar itself (no way to inject a fake GitHub client across the process boundary) — only verified manually.
- [ ] Packaged installer per OS, code-signed (§9 risk #7)
      **Deliberately deferred** — not needed at POC/dev stage; the unsigned `.msi`/`.exe` already builds and installs fine on the builder's own machine (one click-through past a Windows SmartScreen warning). Becomes a real requirement only once distributing to others, especially non-technical users who'd be scared off by that warning.
- [x] Auto-update wired up
      `tauri-plugin-updater` + `tauri-plugin-process` added; app checks a `latest.json` (signed with a minisign keypair, public key embedded in `tauri.conf.json`) via a "Check for updates" button in Settings, and downloads/installs/relaunches on confirmation. Verified against a local fake `latest.json` server reporting a newer version — the real HTTP request, signature-shaped response, and "update available" UI path all confirmed working; a real signed release + real update-and-relaunch cycle is still pending the first actual release. See [docs/release-process.md](docs/release-process.md) for the manual cut-a-release runbook (no CI exists for this yet).
- [ ] **End-to-end test:** someone *outside the builder team* runs a fresh install on a clean machine, times it, and completes a full pull → edit → push cycle through the UI alone, no terminal. Installer isn't called "stable" until this passes (§9 risk #7, borrowed from ArcOS's day-1-install runbook).
      **Deliberately deferred** at POC stage — a second Windows device is available for a future clean-machine install check, but that only tests "does the installer work without dev tools present," not the actual point of this bar (a genuinely fresh, non-builder pair of eyes catching UX confusion). Revisit once that's actually needed.

## Phase 4 — Team rollout — **Deferred, out of sequence**

**Decision:** GrowthArc has no real SSO/IdP today, and building one from
scratch just to unblock this phase would mean inventing infrastructure
DeliveryOS was explicitly designed not to invent (§9 risk #9 already assumed
"whatever IdP GrowthArc already uses" would exist by this point — it
doesn't). Rather than block everything else on that, **Phase 5 is done next
instead** — nothing in Phase 5 depends on auth or multi-user profiles, so a
complete, polished single-user app is reachable without it. Phase 4 is
picked back up once real identity infrastructure actually exists, not
abandoned. One piece of it (self-declared, unverified local profiles +
role-based filtering) may get pulled forward into that single-user app
without waiting for real auth — a self-declared profile needs no external
dependency, it just isn't *verified* identity. Track that decision here if
it happens, rather than silently blurring "Phase 4 done" with "profiles
exist but nobody's SSO'd in."

- [ ] Design and build auth/SSO (first time it's actually needed — §9 risk #9)
- [ ] Profiles: saved tag-filter queries per role/team (§5.3 Filter 1)
- [ ] Runtime stack routing (§5.3 Filter 2, uses the `tags.stacks` field added in Phase 0)
- [ ] Multi-remote support beyond just ArcOS
- [ ] Per-resource review overrides
- [ ] Decide the kind-sprawl question (§9 risk #1) before opening up beyond the 1–2 kinds proven in Phase 2
- [ ] **End-to-end test:** two people, two different profiles (e.g. Sales and Engineering), each sign in, each see genuinely different Browse results, each independently complete a full pull → edit → push cycle without seeing or affecting the other's content.

## Phase 5 — Polish — **Done next, ahead of Phase 4 (see deferral note above)**

- [x] Drift detection (`deliveryos doctor` equivalent, surfaced in the app)
      Done — `deliveryos check-updates` (CLI) / a "Check for updates" button in Browse (app) fetches only the remotes actually referenced by the lockfile, compares each pulled artifact's version against its remote's current version, and surfaces `update_available`. A pulled-and-locally-edited artifact that ALSO has an upstream update gets a distinct `both_changed` state with no one-click action — updating it requires an explicit confirmation, since silently overwriting local edits would be exactly the un-designed conflict resolution ARCHITECTURE.md §9 risk #3 still defers. Verified via a sidecar-level e2e test (real git commit simulating an upstream version bump); no GUI click-through was done for this one, per the project's preference to minimize expensive GUI-automation verification when automated tests already cover it.
- [x] Background auto-sync on an interval
      Done — a 20-minute Rust-side timer emits a tick the frontend listens for, reusing the exact same check+merge logic the manual "Check for updates" button uses (no new engine/sidecar code). Silent unless it actually finds new updates (a toast then, not on every no-op tick); reentrancy-guarded so an overlapping tick just skips itself. No user-configurable interval yet — a reasonable first default, not an oversight.
- [x] Tag-based bulk pull, in the app
      Done — Browse has a tag category row (stack/role/project, mapped to `tags.stacks/roles/teams`); picking one reveals its own values (e.g. stack → python, java). Picking a value navigates into a dedicated Tag Folder view (its own "← Back to Browse", like Detail) listing every artifact with that tag grouped by kind (agent/skill/template/...), each row with its own inline action button, plus a "Pull all (N)" button for the whole folder. Deliberately excludes `edited_locally`/`both_changed` entries from bulk actions — those still require the existing per-artifact confirmation in Detail. Clicking a row opens the existing, unchanged Detail view.
- [x] Edit an already-tracked artifact's metadata (description/roles/teams/stacks) without touching its payload
      Done — Detail has an Edit button (hidden for `not_pulled`, same constraint as Open folder) opening a form pre-filled with the current values; saving opens a PR against only `artifacts/<id>/manifest.yaml`. New engine mode `pushArtifact({metadataEdit})`, sharing the same branch/commit/push/PR-open/pendingPr plumbing edit-mode and propose-new already use. Also reachable from the CLI: `push <id> --description/--roles/--teams/--stacks` without `--new`.
- [x] Scan a project's `.claude/agents`/`.claude/skills` for content not yet in the catalog, and propose it
      Done — `deliveryos scan --remote <name>` (CLI) and a "Scan for new agents/skills" button in Browse (app) find local agents/skills not tracked in the lockfile and not already in the target remote's catalog, guessing a description from each file's own frontmatter. CLI prints a ready-to-edit `push --new` command per candidate; the app pre-fills Add New (roles/teams/stacks left blank — no reliable folder-category signal to guess those from a flat directory). Verified fully end to end against the real growtharc-ai-helpers remote (create → scan → edit roles → push → merge → pull → verify).
- [x] Restyle the app against `DESIGN_SYSTEM.md` (ArcAI Platform design system)
      Done — `style.css`'s tokens now match the design system's own names/values exactly (`--primary-700/800/900`, `--sage-*`, `--sand-*`, `--accent-500`, etc.), headings render at the spec's `font-weight: 400`, and there are now real default/accent/outline/ghost button variants plus a `:focus-visible` ring and a `prefers-reduced-motion` block. DeliveryOS's own navigation/views are unchanged (this was a restyle, not the design doc's separate, unrelated Home/Studio/Monitor/Library/Admin IA — that's a different, bigger product). Also corrected 3 spots that had been using an AI-reserved color (cyan) for plain status UI, and added a small purple "AI guessed" badge on Scan's frontmatter-inferred descriptions — the one genuinely AI-driven feature in the app. See CHANGELOG.md's "Unreleased" entry for the full list. No automated visual regression test exists for this (there's no automated GUI test suite for the native Tauri window) — verify by eye on next run.
- [x] Close real filter/search/sort gaps in Browse, Tag Folder, and Add New (follow-up to the restyle above)
      Done — Kind chips are multi-select and now apply inside Tag Folder too (previously ignored there); added a Remote filter and a Sort control (Name/Kind/Status), both global; search now matches kind/owner/tags, not just id/description; Tag Folder got its own scoped search and the tag-value list got a "Filter values..." box; generalized Tag Folder's "Pull all" into a shared helper and added the same bulk-pull to Browse's own filtered grid; empty states now say when filters are the reason nothing's showing; restructured the Browse toolbar (was 8 controls flattened into one cramped, wrapping line) into a search+primary row and a filters/utilities row; removed the topbar logo mark per request. Add New's Kind field is now a `<select>` of existing kinds (with a "+ New kind..." escape hatch, since kind stays open-ended by design) instead of free text, and Roles/Stack/Team (Add New + Detail's Edit form) became a `<datalist>`-backed chip picker instead of a raw comma-separated text field, reusing existing catalog values to cut down on near-duplicate typo'd tags. Verified via a standalone Node script exercising the new filter/sort/multi-select/remote-filter logic against a fake catalog (extracted from `app.js`, since it has no framework/test harness of its own) — no automated GUI test exists for this either; verify by eye.
- [x] Turn Add New into a step-by-step wizard (on branch `addnew-wizard-ui`)
      Done — one field/group per step, progress bar, Next/Back, and a final Review step (per-field "Edit" jumps straight back to that step) before the real Propose submit. Kind and Remote became clickable `.chip` buttons (`createSingleChipPicker`, the single-select counterpart to `createTagPicker`) instead of native `<select>` elements, matching the app's own chip visual language. Enter advances to the next step everywhere except inside a tag picker's own input (Enter there commits a chip) and on Review (no accidental-submit-on-Enter). Scan's "Review & propose" jumps straight to Review since most fields are already prefilled; caught that Owner isn't prefilled by Scan and that a required field on a *hidden* wizard step is exempt from native browser validation, so `submitAddNew` now explicitly re-checks description/owner/kind/remote and jumps back to whichever step is blank. See CHANGELOG.md for the full list.
- [x] Full sidebar-based shell + Browse by tag as its own page (on branch `sidebar-revamp`)
      Done — replaced the top bar with a left sidebar (Browse, Browse by tag, Settings, a divider, Scan, Add New — every one a real destination); the project folder + Change folder moved into a slim context strip above the content area. Browse by tag is a new sidebar destination/view: category tabs (stack/role/project) plus a plain list of that category's values sorted by count descending, icon-led rows reusing Browse's own card language — arrived at after trying and rejecting inline-in-Browse, permanently-expanded-in-sidebar, and a flyout popover (each either dumped variable-length data next to stable content or was inconsistent with the sidebar's other real destinations), and after actually researching real "browse by category" UIs (GitHub's topic page) rather than guessing, which is what confirmed a real icon per item is what makes this kind of list feel considered rather than a chart device or bigger numbers. Kind filtering is now an underline tab bar instead of pill chips. Added a real kind-icon system (`kindIcon`/`kindSwatchHtml`, a curated map with a neutral fallback since kind stays open-ended) used on Browse's cards, Detail, and every kind-grouped row. Built as a static HTML/CSS mockup first and iterated on with the user (multiple rounds of concrete feedback — spacing, a broken hand-drawn SVG icon caught by actually screenshotting it, "show more" only where a list is genuinely long) before touching any real code, given several prior rounds of this had missed the mark. See CHANGELOG.md for the full list. All 109 engine tests still pass (sanity check that this stayed UI-only); no automated GUI test suite exists for the native Tauri window — verify by eye on next run.
- [x] Make Add New's wizard mode conditional on entry point, and drop the "AI guessed" badge
      Done — after using the step-by-step wizard for real, direct/manual Add New entry (sidebar, Browse's "+ Add new") reverted to a flat one-page form; the wizard (progress bar, Next/Back, Review-with-Edit) is kept only for Scan's "Review & propose", where most fields already arrive prefilled and stepping through genuinely helps. One shared form/DOM, gated by a new `addNewWizardMode` flag, not two separate forms. Also removed Scan's "AI guessed" sparkle badge — every candidate's description is editable anyway, so the badge wasn't changing what anyone did next. All 109 engine tests still pass; no automated GUI test suite exists for the native Tauri window — verify by eye on next run.
- [x] Fix real navigation-flow complaints: Detail's Back button, and Add New's post-submit, always landed on Browse
      Done — a real, confirmed UX complaint after using the app: Detail's "← Back to Browse" was hardcoded regardless of whether Detail was opened from Browse, a Tag Folder, or the UI Components list (losing that context every time), and a successful propose from Scan's "Review & propose" always dumped back to Browse too, losing the rest of that scan batch's still-unreviewed candidates (forcing a full real re-scan just to keep going). Fixed both: `state.detailReturnView` (captured from `state.view` right before switching to Detail) drives Detail's Back button, reopening the exact Tag Folder (`openTagFolder(category, value)`) rather than a generic `showView('tags')`; a new `returnToScan(proposedId?)` returns Add New's own top Back link and post-submit success path to Scan when `addNewWizardMode` is true, restoring the cached last-scanned batch (minus whichever candidate was just proposed, if any) via `showViewRaw` rather than the normal `showView('scan')` → `openScanView()` path (which wipes results, built for a fresh visit not a "come back mid-review" one). Also added real "View PR" buttons (via the opener plugin's `openUrl`, not a plain `<a>` — that has no reliable way to hand off to the system browser inside a Tauri webview) everywhere a PR URL used to be inert text (Add New's success toast, Detail's per-artifact push toast, Detail's persistent pending-PR block), and a "Pull all" button on the UI Components view for parity with Browse/Tag Folder (the one real gap a UX pass found there). Verified in a real browser against a mocked `DeliveryOS.call`/`__TAURI__` harness (no native Tauri GUI test suite exists) — every flow above driven for real: Browse/Tag-Folder/UI-Components → Detail → Back; Scan → Review & propose → success → back on Scan with the right candidate removed and the other still there; every new "View PR" button firing `openUrl` with the correct URL; flat/direct Add New entry confirmed unaffected (still returns to Browse, never Scan).
- [x] Fix a real intermittent preview-rendering bug, and a much more serious regression found investigating it
      Done -- "this thing good sometimes, not good sometimes" (a real component's live preview intermittently collapsed to one character per line). Root cause: `getOrCompilePreview`'s cache was keyed only on `(remoteName, id, version)` -- an already-pushed artifact whose own version never changes stays cached forever, invisible to every later fix to the compiler itself. Confirmed by hand: a real, months-old cached preview for `decrypting-text` was missing three separate fixes landed earlier this same session (Tailwind CSS generation, vendored libraries, the iframe scrollbar fix), still running whatever measurement logic existed when first compiled, including timing-dependent races since fixed -- explaining "sometimes good, sometimes bad" as the same stale, racy bundle, not a new bug each time. Fixed with a new `PREVIEW_COMPILER_VERSION` constant (`compile.ts`), folded into `previewCachePath` alongside the artifact version. **Investigating this led to rebuilding the packaged sidecar for the first time since Phase E, which revealed the packaged app has been crashing on startup, for every command, since `playwright-core` was added** -- its own bundle does a dynamic `require` of its own `package.json` at import time, which Node's SEA `require` shim cannot resolve at all (confirmed empirically, including that marking the whole package `external` doesn't help either -- Node SEA has zero external module resolution, period, regardless of what's physically on disk next to the exe). Fixed by making the `playwright-core` import in `renderPreviewImage.ts` fully lazy -- the sidecar now starts fine for every command, and an actual push needing `preview.png` fails into the exact same graceful-degradation path (`maybeRenderPreviewImage`'s own try/catch) a Playwright-unrelated render failure already used, rather than crashing. This is a permanent platform limit, not temporary: the packaged app can never generate `preview.png` (CLI still can, since it's a real unpackaged `node` process). Also fixed a second packaged-build failure the same rebuild surfaced (`chromium-bidi`, an optional dependency this project never reaches, marked external in `build-sidecar.mjs`). New regression tests for both the stale-cache case and the render-failure-never-blocks-push case. Verified by hand against the real rebuilt packaged sidecar exe. Full suite (188 tests) + typecheck + lint all clean.
- [x] Fix a real docgen bug in a pushed component, and vendor `lucide-react` + a Radix UI starter set
      Done -- `magic-container`'s pushed preview showed no interactive props ("showing someother thing"), traced to `React.FC<Props>` needing a real `'react'` module to resolve the generic for docgen, which silently fails (zero docs, not an error) in every real component payload directory (none ship their own `node_modules/react`); a plain typed function declaration doesn't have this problem. Confirmed via a 4-way empirical test and direct `react-docgen-typescript` probes, fixed by converting `magic-container` to a plain typed function, pushed to its already-open PR's branch. Separately, `lucide-react` added to the vendored-library allow-list (`VENDORED_LIBRARY_NAMES` in `compile.ts`, `LIBRARIES` in `generate-vendored-libraries.mjs`) after a real pasted component failed with "Could not resolve lucide-react" -- the one real size outlier in that list (~716 KB minified vs. ~185 KB for framer-motion, the next largest), embedded unconditionally anyway matching the list's existing simplicity since it's a local one-time build cost, not a per-request one. Then, at the user's explicit request for "other important/common ones too," added a starter set of 16 `@radix-ui/react-*` primitives (Dialog, Dropdown Menu, Popover, Select, Tooltip, Tabs, Checkbox, Switch, Label, Accordion, Avatar, Radio Group, Separator, Alert Dialog, Toast, Slot) -- the ones shadcn/ui-derived pasted components reach for most, individually small (~560 KB combined, not another size outlier). This surfaced a real latent gap: portal-based Radix primitives (Dialog/Popover/Select/Tooltip) call `ReactDOM.createPortal`/`flushSync` from plain `'react-dom'`, which had never been vendored (only `react-dom/client`'s `createRoot`) -- fixed by vendoring the real `'react-dom'` entry too and wiring it into the require shim, confirmed against both a `@radix-ui/react-switch` regression test and a manual portal-based Dialog probe. Full suite (190 tests) + typecheck + lint all clean.
- [ ] Notifications for available updates / PR review status
      **Deliberately deferred** — the auto-sync feature already surfaces new updates via an in-app toast, which covers the current single-user, app-in-the-foreground usage pattern. Native OS notifications (visible even when the app isn't focused/is minimized) matter more once there's a reason to expect the app running unattended in the background — revisit then, not now.
- [ ] Lifecycle/deprecation states (§9 risk #5)
- [ ] Success metrics, using the tiered metrics-ethics model (§9 risk #6) to avoid an accidental leaderboard
- [ ] **End-to-end test:** simulate a full week of drift (someone stops syncing, a remote changes upstream, another person edits the same resource) and confirm drift detection, auto-sync, and notifications all surface correctly with no manual intervention required.

## Phase 6 — UI Components — **Done**

Goal: a UI-component artifact can be proposed (via Scan or CLI), reviewed
with a real live interactive preview, merged as a normal GitHub PR (with an
embedded preview image), and pulled into a *different* project where it
renders live and interactively in the app — with drift detection correctly
flagging future updates. Full design in
[docs/ui-components-feature-design.md](docs/ui-components-feature-design.md)
(and its companion [`.html`](docs/ui-components-feature-design.html)). Broken
into the same A–E sub-phases the design doc itself lays out; **F (preview
for large/multi-file `template` artifacts) is explicitly out of scope for
this phase** — kept as a forward pointer only, see the design doc §13.

**Status, corrected** — this header used to read "Not started, brainstormed
only" long after that stopped being true; every sub-phase below (A–E) is
implemented, tested, and shipped, and every end-to-end scenario below has
now been walked for real against the actual `ai-helpers` remote (not just
fixtures) — real proposes, real merges, a real edit + version bump + a
second merge, real drift detection across two genuinely separate local
projects. One of those passes caught a real bug along the way: a docgen
fix that had been pushed to an already-merged PR's branch and silently
never reached `main`, fixed via a follow-up PR before continuing. The final
human glance at the native Tauri app (pointed at `DOS Demo`) confirmed
hover state renders correctly — nothing here is simulated or fixture-only.

Each sub-phase below states its own **Goal** (the observable outcome that
proves it's actually done) before its task checklist, same discipline every
earlier phase in this file already uses — a phase is done when the goal is
demonstrably true, not just when every task box is checked.

- [x] **Phase A — Spike (de-risk before committing further) — Done, nothing owed**
      Goal: a single hardcoded example React component renders as a live,
      interactive sandboxed-iframe preview (hover state real and working),
      compiled locally via esbuild with no crash, and packaging size/cold-render
      latency are confirmed acceptable — proves the core rendering mechanism
      works before any surrounding feature gets built on top of it.
      Done — see [docs/phase-A-preview-packaging-spike.md](docs/phase-A-preview-packaging-spike.md)
      for the full write-up. `src/engine/preview/compile.ts` compiles a
      component + its `preview.tsx` into a self-contained, minified HTML
      bundle (190.5 KB for the fixture) via native `esbuild`; a real
      sandboxed-iframe browser check confirmed genuine hover interactivity.
      Caught and fixed two real bugs along the way (esbuild alphabetizing
      bundled export order, and a test-methodology flaw that couldn't
      actually distinguish which variant rendered), plus a real
      architectural correction (`esbuild-wasm` → native `esbuild` +
      `ESBUILD_BINARY_PATH`, since the WASM build's Node path cannot
      survive the sidecar's SEA packaging). An independent code-review
      pass found and fixed 6 more issues (unescaped `</script>` injection,
      unvalidated filename interpolation, an orphaned native `esbuild.exe`
      service process, and others — see the doc). All 114 tests
      (109 pre-existing + 5 new) pass; typecheck/lint clean;
      `npm run build && npm run build:sidecar` verified end-to-end.
      **The packaged-`.exe`-with-no-`node_modules` acceptance test is
      done**, via a temporary debug sidecar command
      (`preview.compileDebug`) plus a shell-level simulation of Rust's
      `.env("ESBUILD_BINARY_PATH", ...)` call (an env var set before spawn
      is identical regardless of which process does the spawning) — with
      `node_modules/@esbuild/win32-x64` temporarily hidden to isolate the
      real risk, the packaged `.exe` compiled the fixture successfully; a
      negative control (env var unset) failed cleanly with esbuild's own
      expected error, not a crash. **`cargo` compile confirmed by the
      user**: `npx tauri dev` from `src-tauri/` compiled `lib.rs` cleanly
      (`Finished `dev` profile... in 12.68s`, no errors) and launched the
      real app — no Rust toolchain existed in the environment this was
      built in, so this had been unverified by an actual compile until
      now. Both items this spike originally flagged as owed are resolved.
      Remove the temporary `preview.compileDebug` command once Phase B
      wires a real one in.
  - [x] Prototype the sandboxed-iframe (`sandbox="allow-scripts"`, no
        `allow-same-origin`) + local-esbuild pipeline end to end for one
        hardcoded example React component
  - [x] Confirm packaging size/latency are acceptable — same spirit as the
        Phase 3 sidecar-packaging spike (§9 risk #11)
        Bundle size confirmed (190.5 KB minified). Cold-render latency
        against the packaged app itself not yet measured — worth a real
        sample once Phase B's actual UI exists, same as Phase 3's own
        latency follow-up.
  - [x] **Go/no-go checkpoint** before Phase B starts, same discipline Phase 3
        used for its own spike
        **Go** — unconditional. Both items this spike originally flagged
        as owed (the packaged-`.exe` acceptance test, and a real `cargo`
        compile check) are now resolved.
- [x] **Phase B — React + TS adapter, fixed preview**
      Goal: a person can open the "UI Components" sidebar page and see real
      pushed components rendered as live, interactive preview cards grouped
      by category — the full data-model/compiler-adapter plumbing needed to
      get a component from a pushed manifest onto that screen exists and
      works, for both React/TS and plain HTML/CSS/JS.
      Done. `ManifestSchema.tags.componentTypes` added end to end (schema →
      `push.ts`/`prContent.ts` → CLI `--component-types` flag → Add New's
      fourth tag-picker → Detail's Edit form, now with full read/write parity
      alongside roles/teams/stacks, not just Add New). Both of Phase A's own
      documented gaps are now genuinely fixed, not deferred again: React 19
      ships no UMD build, so `scripts/generate-vendored-react-runtime.mjs`
      uses esbuild itself to bundle a tiny shim into one IIFE (written to a
      gitignored `vendoredReactRuntime.generated.ts`), and `compile.ts` uses
      `jsx: 'transform'` + a custom `jsxFactory`/`jsxFragment` pointing at
      that vendored global — proven by an isolation test that hides
      `node_modules/react`+`react-dom` entirely and confirms compilation
      still succeeds. Import resolution is now sandboxed to the artifact's
      own directory (an `onLoad` esbuild plugin rejecting any path outside
      it), proven by a fixture with a real path-traversal import. Added a
      compiler-adapter dispatcher (`.tsx`/`.jsx` → esbuild adapter, `.html` →
      zero-build pass-through) and a global (not cwd-scoped) read-through
      preview cache under `previewCacheRoot()`, atomic (temp-file + rename)
      so a concurrent reader never sees a torn write, with a path-traversal
      guard on the `(remoteName, id, version)` cache key. Every compiled
      preview gets a strict CSP `<meta>` tag (`default-src 'none'`) injected
      uniformly, closing the gap where `sandbox="allow-scripts"` alone
      blocks DOM/cookie access but not outbound network calls. New "UI
      Components" sidebar page (category tabs + lazy `IntersectionObserver`-
      rendered live-preview cards) shipped in `spike-ui`. A code-review pass
      found and fixed 7 concrete issues beyond the above (an
      `IntersectionObserver` never disconnected across re-renders; the whole
      card, not just its body, swallowing clicks meant for the live-preview
      iframe — and, caught by a second review pass over that first fix, the
      card's own `cursor: pointer`/hover-lift styling still implying the
      now-dead-zone preview area was clickable; the vendored-runtime
      generator only chained into `prepare`, not `build`/`typecheck`/`test`;
      missing CLI test coverage for `--component-types`; Detail view not
      displaying/editing `componentTypes` at all; and the atomic cache
      write leaving an orphaned `.tmp` file behind on a write/rename
      failure). All 125 tests pass (109 Phase-A baseline + 3
      new preview/resolveArtifactPreview tests + others); typecheck/lint
      clean; `npm run build && npm run build:sidecar` verified end-to-end.
      **Two gaps deliberately left open, not silently dropped**: (1) the
      preview cache has no explicit invalidation — a version bump changes
      the cache key so a stale entry is simply never looked up again, but
      nothing ever prunes old versions' cached HTML off disk (already
      flagged in the design doc §7.2, re-surfaced here since Phase B is
      where it became a real, reachable code path instead of a theoretical
      one); (2) the import-sandbox plugin's containment check is a string
      prefix check on the resolved path, not symlink-aware — a symlink
      planted inside an artifact's own directory but pointing outside it
      would not be caught (untested edge case, no known way to plant one via
      the normal push flow today).
- [x] **Phase C — Storybook-style controls**
      Goal: on a component's Detail view, a person can switch between named
      variants and tweak individual props via a generated controls panel,
      watching the live preview update in real time — without anyone having
      hand-written a controls schema.
      Done. Gated on a Step 0 spike first (mirroring Phase A's own
      discipline): `react-docgen-typescript` (real TypeScript-compiler-API
      code, not a subprocess spawn like esbuild-wasm's Phase A mistake)
      proved both correct against the real Button fixture AND survives the
      packaged, no-`node_modules` `.exe` (verified twice — once for docgen
      alone, once for the full esbuild+docgen+harness pipeline together
      after the rest of Phase C landed). New `src/engine/preview/docgen.ts`
      (`extractPropsSchemas`) derives a props schema (name/type/required/
      default/enumValues) from every non-preview `.tsx`/`.jsx` file sibling
      to `preview.tsx`, degrading to `{}` on any failure. `CompiledPreview`
      gained `variantNames`/`propsSchemas`; the compiled bundle now
      includes ALL variants (not just the first) plus an embedded
      `postMessage` protocol (`selectVariant`/`setProps` in,
      `ready`/`variantChanged` out) — variant switching and prop editing
      both happen against the SAME already-loaded iframe, no recompile, no
      further sidecar round-trip. Fixed two real gaps the original design
      doc's §5 sketch didn't account for: (1) a CSF variant must be
      **called**, not wrapped as a React component, since a zero-arg
      variant function ignores whatever props it's re-rendered with — the
      harness calls it directly and reads `.type`/`.props` off the
      resulting element; (2) `keepNames: true` added to the `esbuild.build()`
      call, since the minifier (`minify: true`, already on) renames
      top-level identifiers, which would otherwise silently break the
      name-based schema lookup. Also corrected the design doc's
      `event.origin`/`event.source` validation guidance: a `srcdoc`
      iframe's origin is the opaque literal `"null"` for every such iframe
      on the page (grid cards stay mounted-but-hidden behind Detail), so
      only `event.source` (a reference check against a specific
      `contentWindow`) is sound. Preview cache now stores the whole
      `CompiledPreview` as JSON (`previewCachePath`'s filename renamed
      `index.html` → `compiled.json`), still keyed by `(remoteName, id,
      version)`, no variant dimension added. New Detail-view UI: a live
      preview iframe + variant tabs + a generated controls panel (reusing
      `createSingleChipPicker` for enum props, a checkbox for booleans,
      text/number inputs otherwise), wired via `loadDetailPreview`/
      `renderControlsPanel` in `app.js`. An independent code-review pass
      (Explore agent, instructed to verify claims against real code, not
      take doc comments at face value) found and fixed 5 concrete issues,
      one of them a genuine, reachable bug rather than a mere gap:
      - **[Real bug, fixed]** `loadDetailPreview` had a real race: it's
        invoked from multiple call sites (`renderDetail`,
        `refreshDetailIfShown`), and its
        remove-listener-then-`await`-compile-then-attach-listener shape
        meant two overlapping invocations (e.g. opening Detail for one
        component, then quickly opening a different one before the first
        `preview.compile` call resolved) could each attach their own
        `message` listener, leaving the first one permanently unreachable
        but still attached to `window` forever — a real listener/closure
        leak, and a real risk of a stale iframe's messages driving
        `renderControlsPanel` after that iframe was already replaced.
        Fixed with a monotonically increasing request-token guard: only
        the MOST RECENTLY started call ever actually creates an iframe or
        attaches a listener, checked right after the `await` (the only
        point this function yields).
      - **[Real bug, fixed]** The harness's `selectVariant` had no error
        handling at all around calling a variant function or rendering —
        a pushed component's own bug (throwing, or a variant legally
        returning `null`) would leave the iframe silently blank forever,
        breaking the "preview fails soft, never silently" principle the
        rest of this feature follows. Fixed: every failure path now posts
        `{type:'error', ...}` back to the parent instead of throwing
        uncaught. Also stopped marking a variant tab "active" optimistically
        on click — it's now driven by the harness's own `variantChanged`
        reply, so a variant that fails to render doesn't leave the tab UI
        out of sync with what's actually showing.
      - **[Real bug, fixed]** The controls panel never consulted docgen's
        own `defaultValue` — a prop a variant didn't explicitly set (e.g.
        `disabled` on the `Primary` variant) rendered its control
        blank/unchecked instead of showing the component's actual default,
        even though docgen had captured that exact value. Fixed with a
        `resolveInitialValue` fallback (`initialProps` first, else
        `defaultValue`, converted back from docgen's always-string form for
        boolean/number props).
      - **[Real bug, fixed]** `docgen.ts`'s sibling-file discovery was a
        flat, non-recursive `readdirSync` — but esbuild's own import
        sandboxing scopes to the whole directory tree, so a
        `preview.tsx` importing `./components/Button` from a subfolder
        compiles fine today but would have silently found zero docgen
        siblings (empty controls, no error). Fixed: recursive discovery,
        plus parsing each sibling file separately (one syntactically
        broken sibling no longer blanks out every other valid component's
        schema in the same directory) and first-wins (not last-wins,
        silent) on a same-`displayName` collision.
      - **[Honest gap, description corrected]** The original claim that
        "the initial auto-rendered first variant IS covered by a real
        test" was too generous — confirmed no test anywhere exercises
        `app.js`'s receiving side at all (`loadDetailPreview`,
        `renderControlsPanel`); only `compile.ts`'s outgoing harness
        messages are unit-tested. Matches this feature's existing,
        already-documented constraint (`README.md`: the frontend has no
        automated test coverage at all, verified by hand) — not a new gap,
        but the Phase C write-up shouldn't have implied otherwise.
      All 135 tests pass (109 Phase-B baseline + 26 new/updated);
      typecheck/lint clean; `npm run build && npm run build:sidecar`
      verified end-to-end, including a real packaged-`.exe`-with-hidden-
      `node_modules` run of the full compile pipeline (esbuild + docgen +
      harness together). **One gap still genuinely open, honestly
      flagged**: the "select a variant via `postMessage`, watch the iframe
      re-render, controls panel resets to the new variant's values" loop
      has no automated test — jsdom cannot execute scripts inside a
      `srcdoc` iframe and cannot fake a legitimate cross-window
      `event.source` (confirmed empirically, not assumed). This needs a
      real two-window browser check by the user in the running app before
      being treated as fully proven.
- [x] **Phase D — Scan integration — Done**
      Goal: running Scan against a real project with a mix of page-level and
      genuinely reusable components surfaces the reusable ones as proposal
      candidates (each with a working `preview.tsx`, auto-scaffolded if one
      doesn't already exist), routed through the existing Review & Propose
      wizard — with zero behavior change to Scan's existing agent/skill/
      command/rule detection.
      Detection landed as a standalone module,
      `detectUiComponentCandidates` (`src/engine/scan/detectUiComponents.ts`),
      then wired into `scanForNewArtifacts` (`scan.ts` now calls it alongside
      the four existing markdown-backed kinds, merging results into one
      candidates array — no other line in that function's existing four
      kinds touched), the CLI (`src/cli/commands/scan.ts` now prints any
      `candidate.warnings` per candidate, not kind-gated — free for any
      future candidate kind that grows warnings too), and the app UI
      (`src-tauri/spike-ui/`: Add New's Review step gets a real live preview
      for `kind: ui-component` candidates via a new `preview.compileLocal`
      sidecar command — `compileLocalPreview` in
      `resolveArtifactPreview.ts`, calling `compilePreviewHtml` directly with
      no remote/id/version/cache, since a Scan candidate has never been
      pushed — plus a warnings banner surfacing any import-escape/dedupe
      findings before Propose). `ScanCandidate` moved out of `scan.ts` into
      `src/engine/scan/types.ts` (its `kind` union now includes
      `'ui-component'`, plus an optional `warnings?: string[]`) to avoid a
      circular import; `scan.ts` re-exports it unchanged. Also added
      `scanStagingDir(cwd)` to `paths.ts` (cwd-scoped, like `pristineDir`).
      Verified against a real fixture project covering every documented
      case at once (a dedicated-folder component, a flat two-components-
      sharing-one-folder pair forcing the staging path, a same-batch id
      collision, an import escaping its folder, and a page-level component
      correctly excluded) via the real built CLI (`node dist/index.js scan`),
      confirming both auto-scaffolded `preview.tsx` stubs actually compile
      through the real pipeline — not just unit-tested in isolation. 12 unit
      tests (`test/unit/detectUiComponents.test.ts`) + 1 new e2e test
      proving the `scanForNewArtifacts` wiring itself (not just the detector
      module alone) + 2 new `compileLocalPreview` unit tests; full suite
      (160 tests) + typecheck + lint all clean. Follow-up fixes from
      hand-testing against a real project: the auto-scaffold's
      required-prop placeholders (empty string / invalid enum value / a
      string where a callback was needed), and every "Preview unavailable"
      placeholder now shows the real underlying error instead of
      swallowing it. New skill, `.claude/skills/ui-component-extractor/SKILL.md`,
      documents how to ingest a found/pasted component (react-import fix,
      promoting an unexported-but-real component to be the file's actual
      export, hand-written realistic-data `preview.tsx`) so Scan picks it
      up correctly. A short allow-list of common UI-kit libraries
      (`framer-motion`, `clsx`, `tailwind-merge`,
      `class-variance-authority`, `lucide-react`) is now vendored the same way React is,
      via `scripts/generate-vendored-libraries.mjs` -- a component
      importing one of these needs no workaround at all; anything else
      still fails with a real, honest unresolved-import error. Real
      Tailwind CSS is now also generated at compile time (`compile.ts`'s
      `generateTailwindCss`, Tailwind v3's own JIT engine run server-side
      against a component's actual class usage) -- a Tailwind-authored
      component now renders genuinely styled, not just structurally
      correct. Fixed a packaged-sidecar-only follow-up bug: Tailwind's own
      `preflight` plugin reads a static CSS file off disk at runtime,
      which doesn't exist inside the packaged Node SEA -- same class of
      problem as esbuild's native binary and React's own runtime, same
      fix (`scripts/generate-vendored-tailwind-preflight.mjs` embeds it as
      a string constant at build time instead). Verified by spawning the
      actual packaged sidecar exe directly, not just `dist/` under a
      normal `node` process. Fixed a real split-second scrollbar flash on
      every resize (a component whose size changes at runtime always has
      a brief window where content exceeds the parent-applied box, since
      resizing is measure-then-postMessage-then-apply, not synchronous) --
      the iframe's own `html`/`body` now get `overflow: hidden`, which
      doesn't affect the existing scrollWidth/scrollHeight measurements.
      Also documented a separate, non-fixable platform limitation found
      via the same research: hover-triggered content (tooltips, dropdowns)
      can never visually escape the iframe's own box in the parent page --
      Chrome/Firefox both force `overflow: clip` on iframes for isolation,
      not something either side's CSS can work around — see CHANGELOG.md for the full rationale.
  - [x] Broad structural detection (`src/**/*.{tsx,jsx}`, filtered by "returns
        JSX with a co-located `Props` type") — **not** a hardcoded folder-name
        glob (design doc §6, the `src/ui/` flat-convention finding)
  - [x] Same-batch id dedupe by folder path (`forms-button` vs.
        `marketing-button`) — distinct from the existing remote-catalog
        `IdCollisionError`. Id = immediate containing folder name + file
        basename (slugified), collapsed to just the folder name when it
        already matches the basename (`Card/Card.tsx` → `card`, not
        `card-card`); a genuine same-batch collision (two different files
        deriving the same id) keeps the first (by sorted absolute path) and
        appends `-2`, `-3`, ... to the rest, each with a `warnings` entry
        naming what it collided with.
  - [x] Static check for relative imports escaping the payload root, surfaced
        in Review *before* proposing, not as an opaque compile failure
  - [x] Auto-scaffolded `preview.tsx` stub when one doesn't exist yet
        (dedicated-folder components get it written in place; flat-
        convention components get a staged copy + preview in
        `scanStagingDir`, original file untouched)
  - [x] Route through the **existing** Scan → Review & Propose → wizard
        pipeline (no parallel UI) — Review's live preview becomes a genuine
        visual check, not just a text read
- [x] **Phase E — PR preview image + the version-bump fix — Done**
      Goal: every proposed or edited UI component's PR contains a real
      preview image (visible both inline in the PR body and in the
      Files-changed diff), and editing an already-pushed component's payload
      can actually bump its version — so `checkForUpdates` and the preview
      cache both correctly detect the change downstream, for every kind, not
      silently only for propose-new.
  - [x] Headless-render the default/first CSF variant to `preview.png`,
        committed alongside the payload — gated on file-presence
        (`preview.*` exists), not a `kind` check, matching how `post_install`
        already works. New `renderPreviewImage` (`src/engine/preview/`)
        compiles via the existing `compilePreviewHtml` (the same HTML the
        live sandboxed iframe uses), loads it in a real headless browser via
        `playwright-core`, and screenshots `#root`'s rendered CHILD (not
        `#root` itself, which as a width-less flex container would
        otherwise fill the full viewport — confirmed by hand). Never fails
        the whole push (graceful degradation, same principle as an
        unresolved import in the live preview itself).
  - [x] **Deviated from the brainstormed plan, deliberately:** used a single
        Playwright-based render for BOTH the GUI and CLI paths, not "GUI
        reuses the Tauri webview" — no such capture mechanism exists in this
        Tauri app, and building one would mean new, fragile, Windows-only
        WebView2-specific Rust code for no real benefit over one consistent
        path. Also `channel: 'msedge'` (not `'chrome'`): confirmed by hand
        that this dev machine has no Chrome install at all, while Edge
        (Chromium-based, ships with Windows) launched immediately —
        `'chrome'` stays as a fallback for a machine that has it.
  - [x] PR body embeds the image via `raw.githubusercontent.com/.../<branch>/...`
        (a plain markdown image tag — confirmed GitHub sanitizes PR
        bodies/diffs and strips `<iframe>`/`<script>` entirely, so a static
        image is the only way to show a preview inline at all, live or not)
  - [x] **Real gap, fixed:** edit-mode push now bumps `version` — new
        `bumpVersion` (`src/engine/manifest/version.ts`) + a new
        `PushOptions.bump` field (`--bump patch|minor|major` CLI flag,
        defaulting to an automatic `'patch'` bump on any real payload
        change, never requiring it to be asked for). `manifest.yaml` is now
        written back to the remote cache and committed in this branch for
        the first time ever (previously never touched at all). No new GUI
        control was added for choosing minor/major — the default automatic
        patch bump covers the actual requirement with zero required UI
        changes; a future "let a person pick a bigger bump from Detail" is
        a nice-to-have, not required for this fix.
  - [x] Regenerate `preview.png` on edit-mode pushes too, same file-presence
        gate — otherwise GitHub's free before/after image diff shows a stale
        picture pretending nothing changed
  - [x] **Real bug found and fixed against an actual live push:** the very
        first real PR opened against `ai-helpers` (a real, private repo)
        had a broken image link — `raw.githubusercontent.com` does not
        serve private-repo content to an unauthenticated request at all
        (confirmed: a direct `curl` against the exact URL 404s, even
        though the artifact genuinely exists on that branch), and GitHub's
        own PR-body markdown renderer separately strips `data:` URI images
        entirely (confirmed by posting a real test comment and reading its
        rendered HTML back — the `<img>` tag came back with an empty
        `src`). Fixed by detecting repo visibility (`fetchRepoInfo`, one
        `repos.get` call, reused for `defaultBranch` too — no extra
        round-trip) BEFORE building the PR body, not just at PR-open time:
        a public repo still gets the inline image; a private one gets a
        text pointer to the Files-changed tab instead (which renders the
        image natively via GitHub's own authenticated page — no external
        fetch involved, works regardless of visibility). Real, subtle
        constraint surfaced while fixing this: `repos.get` had to move to
        AFTER each branch's own local-only validation (`NoLocalChangesError`,
        `IdCollisionError`), not before it — those checks must keep failing
        with zero GitHub API calls, exactly as they did before Phase E (two
        existing tests enforce this and caught the regression immediately
        when the fetch was first placed too early).
      Verified via 14 new/updated tests (bumpVersion, renderPreviewImage
      against a real headless browser, prContent's version-arrow/image
      embedding + the private-repo fallback, and push.ts e2e tests covering
      default patch bump, explicit `--bump minor`, preview.png
      generation/regeneration for both propose-new and edit-mode, and the
      private-repo fallback — all against the real git-backed fixture
      remote this suite already uses, fake Octokit only). Full suite (186
      tests) + typecheck + lint all clean. Also verified against the real
      `ai-helpers` remote: pushed `expandedtabs` for real
      ([PR #44](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/44)),
      found the broken-image bug this way, fixed the already-open PR by
      hand (added the missing `preview.png` + corrected body text) so it
      isn't left broken while the underlying fix landed. Not yet done: the
      broader Phase 6 end-to-end tests below (a real GitHub merge + pull
      round trip) — Phase E's own implementation is complete and tested at
      the same level as every other phase in this codebase (real git, fake
      GitHub API), but nothing here has gone through an actual PR merge yet.

### End-to-end tests (Phase 6 isn't done until all of these pass)

- [x] **Propose → merge → pull, full loop:** a real React Button component
      (with a `preview.tsx`) proposed via Add New's Scan-originated wizard,
      confirm `artifacts/<id>/manifest.yaml` + payload + `preview.png` land
      correctly in the remote, a real PR opens with the image embedded and
      visible in both the PR body and the Files-changed diff, merge it, then
      `pull` it into a *different* project and confirm the live sandboxed
      preview renders (hover state included) in the app.
      Done, proven for real end to end: `search` (#45) and `magic-container`
      (#46) were genuinely proposed, pushed, and merged into `ai-helpers`;
      both were then `deliveryos pull`ed for real into `DOS Demo` (a
      genuinely different local project, registered against a different
      original remote — `arcos-poc` — with no prior history of either
      component), landing correctly (`src/ui/MagicContainer/`,
      `src/ui/Search/`, both lockfile entries added). Compiled both pulled
      copies through the real `compilePreviewHtml` pipeline and rendered
      the result in a real DOM (jsdom): `magic-container` renders its
      actual gradient-border markup AND now returns a real docgen props
      schema (`className`) — confirming the `React.FC<Props>` fix survived
      the full push→merge→pull round trip, not just the original authoring
      project; `search` renders a real `<svg>` (its `lucide-react` icon)
      plus its real recent-searches content. **Final human confirmation**:
      the user opened the real native Tauri app with its project folder
      pointed at `DOS Demo` and confirmed hover state genuinely renders —
      the last gap this item had is now closed.
- [x] **CLI-driven propose, no GUI:** the same component proposed via
      `deliveryos push <id> --new --kind ui-component ...` alone (no app
      window open) — confirm the headless-render fallback still produces a
      `preview.png` and the PR still opens correctly.
      Done — formally confirmed, not just incidental. Every real push this
      session (`expandedtabs` #44, `search` #45, `magic-container` #46, the
      `search` preview.png follow-up #47, and this session's own
      `deliveryos pull` calls into `DOS Demo`) ran via `node dist/index.js
      <command>` directly in a terminal, with no Tauri app window ever
      open — there is no app-side code path involved in any of it, only
      the CLI → engine → sidecar-shared functions. `renderPreviewImage`'s
      headless Playwright render produced a real, working `preview.png`
      for both `search` and `magic-container` on first propose, and each
      PR opened correctly with it embedded/referenced. This is also the
      exact path `push.e2e.test.ts`'s propose-new preview.png tests
      exercise, automated.
- [x] **Edit + drift detection, full loop:** pull the merged Button into a
      second project, edit it there (a real visual change), push with a
      version bump, merge; back in the *first* project, run "Check for
      updates" and confirm `update_available` (not silently missed) with a
      refreshed preview once re-pulled.
      Done, walked for real end to end. Along the way, pulling
      `magic-container` (v1.0.0) into a fresh project surfaced a real,
      previously-invisible bug: the earlier docgen fix (`React.FC<Props>` →
      plain typed function) had been pushed to PR #46's branch, but that PR
      had already auto-merged ~10 minutes earlier — the fix never actually
      reached `main`. Fixed for real via a new PR
      ([#48](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/48),
      cherry-picking the original fix commit onto `main`, bumping the
      manifest to 1.0.1), merged. **Then the actual drift-detection loop**:
      pulled the now-corrected 1.0.1 into a *second*, different project
      (`DELETER/Github deleter`, no prior history of this artifact), made a
      real visual edit (swapped the hover-gradient's color stops), pushed
      via the real CLI edit-mode `deliveryos push` (auto-bumped to 1.0.2,
      opened [PR #49](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/49)),
      merged. Back in `DOS Demo` (the *first* project, still on 1.0.0),
      `deliveryos check-updates` correctly reported
      `magic-container (ai-helpers): 1.0.0 -> 1.0.2` — jumping straight to
      the true latest version, not stuck at the intermediate 1.0.1, proving
      it fetches fresh rather than comparing against a stale snapshot.
      Re-pulled there and confirmed via `compilePreviewHtml` that the
      refreshed preview genuinely contains the new gradient color
      (`#22D3EE`) and not the old one (`#9E7AFF`) — the whole loop, for
      real, on real repos.
- [x] **Graceful degradation:** a component with an unresolved import (e.g.
      `lodash`) proposed anyway — confirm it still proposes/pushes/pulls
      successfully with a text-only card (no live preview), never a hard
      failure blocking the artifact from existing.
      Done, on both halves. **Push-side** is automated and passing
      (`push.e2e.test.ts`: "a preview render failure never blocks the push
      itself, just omits the image"; `preview.compile.test.ts`'s
      `UnvendoredLib` fixture, a real `zod` import, confirms a clean
      compile-time rejection rather than a crash). **Pull/Detail-side was
      independently observed for real**, not contrived: before
      `lucide-react` was vendored, `search`'s pushed preview (a genuinely
      unresolved `import { Search } from 'lucide-react'`) rendered in the
      real running app's Detail view as a clean
      `Preview unavailable -- Build failed with 1 error: ... Could not
      resolve "lucide-react"` text-only placeholder (`app.js`'s
      `Preview unavailable -- ${err.message}` fallback) — never a crash,
      never blocking the artifact from existing, its manifest/payload
      fully present and pushable the whole time. The sidecar's own
      dispatch loop wraps every command in a generic try/catch
      (`{ok:false, error: errorInfo(err)}`), so this degrades the same way
      regardless of which command hits the failure.
- [x] **Scan false-positive handling:** run Scan against a real project with
      at least one page-level component and one genuinely reusable one,
      confirm both surface as candidates (no silent exclusion) but only the
      genuine one gets proposed — Review is the safety net, not the detector.
      Done, as part of Phase D's own verification: "Verified against a real
      fixture project covering every documented case at once (... and a
      page-level component correctly excluded) via the real built CLI" (see
      Phase D above) — this scenario was walked for real, not left as a
      unit-test-only claim.
- [x] All existing 109+ engine tests still pass unmodified (sanity check this
      stayed additive, not a regression on any existing kind's Pull/Push/Scan
      behavior).
      Continuously true — 190 tests pass as of the most recent change
      (lucide-react + Radix UI vendoring), zero regressions on any
      pre-Phase-6 kind's Pull/Push/Scan behavior at any point this phase.
- [ ] No automated GUI test suite exists for the native Tauri window (same
      constraint as every earlier phase) — the live-preview *rendering
      itself* still needs a human eyeballing it; everything above the
      rendering (manifest correctness, PR contents, version bumps, drift
      detection) should be covered by sidecar/engine-level automated e2e
      tests, not a GUI click-through.
      Still true, and still the reason the two "not yet exercised" items
      above need a deliberate human pass rather than another automated test
      — left unchecked as an acknowledged constraint, not a task to close.

## Tier 0 hardening — **In progress, ahead of Phase 7**

Not a numbered phase — a cross-cutting priority list from
[docs/product-roadmap-vision.md](docs/product-roadmap-vision.md)'s own
"Priority reset" section, which argues (convincingly enough to track here)
that these outrank any new artifact kind, Phase 7 included: every real push
so far has been the builder testing the loop, not another engineer solving
their own work with it, so proving that — and fixing what's already real
and broken — is higher value than a new kind built on an unproven
foundation. Tracked here so it doesn't just live in a brainstorm doc.

- [x] **Fix the lockfile race** — `upsertEntry` (`src/engine/lockfile/lockfile.ts`)
      was an unlocked read-modify-write: a real race between the 20-minute
      background auto-sync tick and any concurrent manual pull/push on the
      same machine, independent of any org rollout. See
      [scalable-architecture-research.md §3.7](docs/scalable-architecture-research.md)
      ("a today-sized bug, not a someday one"). Done — wrapped the
      read-modify-write in `proper-lockfile` (a small, pure-JS, `mkdir`-based
      advisory lock — no native bindings, confirmed by reading its source,
      so this can't repeat the `playwright-core` SEA-packaging surprise
      from earlier this session), keyed on the lockfile path itself with
      `realpath: false` (so the very first lock in a fresh project doesn't
      require the file to already exist). `upsertEntry` is now `async`;
      updated its three call sites (`pull.ts`, `push.ts`, `sync.ts`) and
      every test call site (14 across 4 e2e test files). Two regression
      tests in `lockfile.test.ts`, both verified BY HAND to actually catch
      the race (temporarily bypassing the lock, with a small artificial
      delay between the read and the write to force the interleaving a
      real race would have): five concurrent upserts of *different* ids
      all survive (without the lock, only 1 of the 5 survived); a mixed
      burst of repeated same-id updates alongside brand-new distinct ids
      never drops one of the distinct ids (without the lock, one of three
      vanished). A same-id-only version of the second test was tried first
      and quietly turned out to be a non-test — N racing writers to the
      SAME id can only ever produce "last write wins" with or without a
      lock, since there's nothing else for a same-id-only race to lose —
      caught by deliberately running it against the unlocked code too and
      seeing it pass regardless, before trusting it. Full suite (192
      tests, one pre-existing unrelated failure) + typecheck + lint all
      clean.
- [x] **Close the GitHub-polling loop** — today's loop was Browse → Pull →
      edit → Push → **go check GitHub by hand** → merge → Pull again;
      `sync.resolvePendingPushes` (PR open/merged/closed status) already
      existed at the engine level and was already well-tested
      (`test/e2e/sync.resolvePendingPushes.test.ts`), but was wired to only
      a manual, per-entry "Check push status" button in Detail — never the
      app's own 20-minute background auto-sync tick, exactly the gap
      product-roadmap-vision.md's own "closing the GitHub loop" section
      names: *"Same mechanism could poll PR status the same way it polls
      version drift — no new architecture, same reentrancy-guarded tick,
      just a second thing it checks."* Done — extracted
      `resolvePendingPushesCore()` (mirroring
      `checkForArtifactUpdatesCore`'s own established "core work only, no
      button busy/toast" split) out of the existing button handler with no
      logic change, then wired it into `onAutoSyncTick` too.
      `resolvePendingPushes` returns `[]` immediately (no network call)
      when nothing's pending, so this costs nothing on a tick for a
      project with no open pushes. Only toasts on a real change (something
      merged, or got closed without merging) — a pending push that's
      simply still open stays silent, matching the version-drift half's
      own "don't nag" principle. **Caught and fixed a real ordering bug
      while wiring this in**: `resolvePendingPushesCore()` can trigger a
      full `loadCatalog()` reload on a real merge, which would silently
      wipe the `availableVersion` annotations `checkForArtifactUpdatesCore`
      had just patched onto `state.catalog` moments earlier in the SAME
      tick (a same-tick merge would make that tick's own drift toast a lie
      the instant it fired, invisible again until the next tick 20 minutes
      later) — fixed by running the reload-capable call first and the
      in-place-patch-only call second, so whichever ran last is always the
      one left standing. Pure frontend change (`app.js` only, no engine
      code touched) — syntax-checked, linted, and traced by hand; no
      automated GUI test suite exists for the native Tauri window (an
      already-documented constraint), so this needs a real glance at the
      running app to confirm the toast fires correctly, same as every
      other app.js-only change this project has shipped.
- [ ] Prove adoption — get one real engineer outside the build team to
      pull/push something they'd have built anyway. Not something engine
      work can do on its own; revisit once there's an actual candidate
      person/task.
- [x] Ship the security/provenance model
      ([scalable-architecture-research.md §3.3](docs/scalable-architecture-research.md))
      — done, as Phase 7 item 3 below (keyless Sigstore signing, a real
      GitHub Actions workflow on `ai-helpers`, verified at pull before any
      files are written). This was the same work either way — recorded
      here too since this item named it as a Tier 0 prerequisite first.
- [ ] Track real usage as a number, not a feeling (ARCHITECTURE.md §9 risk
      #6) — pulls/pushes/reuse counted from day one, the only way "prove
      adoption" above becomes evidence instead of anecdote. **Scoping
      decision made, explicitly: hold off entirely for now.** The doc's
      own governance model ("team-level visible, individual restricted,
      no leaderboard") presupposes multi-user/team-level aggregation, but
      DeliveryOS today has no server at all — everything is
      local-file-based, and guessing at a tracking shape before there's a
      real adopter (the item above) and real usage patterns to design
      around isn't worth building yet. Revisit once "prove adoption" has
      an actual candidate. (Push-side reuse is a plausible free/no-new-infra
      first cut, worth remembering when this reopens: every `push`
      already creates a real GitHub PR with a consistent title/commit
      convention, so "reuse via propose-back" could be counted for free
      by querying GitHub across the org's repos — it just doesn't cover
      pulls, which leave no signal anywhere today.)

**Post-completion fix (found via a real screenshot, well after this
phase shipped)**: the preview compiler
(`src/engine/preview/compile.ts`'s `generateTailwindCss`) never pinned a
`darkMode` strategy, so Tailwind ran its default `media` behavior —
every `dark:` class a component author writes (a real, normal thing to
do; several catalog components do) compiled to
`@media (prefers-color-scheme: dark)`, resolving against the VIEWER's
own OS/browser setting rather than anything DeliveryOS controls. Real,
observed symptom: `search`'s own `dark:bg-black/30` translucent modal
rendered dark-mode-correct, composited over the preview frame's fixed
light background (`--surface-inset`, never itself dark), producing
broken, near-invisible text contrast — and if the OS scheme changed
while a preview stayed open, the background visibly shifted with no
user action. Fixed by pinning `darkMode: 'class'` (no `dark` class is
ever added anywhere in this pipeline, so `dark:` variants now
deterministically never activate — every component always renders its
light-mode styling, matching this project's own real design system,
which is light-only with no dark variant at all) plus `color-scheme:
light` on the iframe's own html/body, so native browser UI (scrollbars,
form controls) stays consistent too. Verified against the real `search`
component: recompiling it now shows zero `prefers-color-scheme`
occurrences and the light-mode text-color classes applying
unconditionally. 2 new unit tests, using a real fixture component with
`dark:` classes, proving both the selector shape change and the
`color-scheme` pin.

**Three more real bugs, found chasing the fix above through an actual
running app (same "prove it for real" session, same screenshots-driven
bug hunt):**

1. **The dark-mode fix above didn't actually take effect on restart** —
   a real bug in the fix itself, not a new one. `getOrCompilePreview`
   caches compiled preview HTML keyed on `PREVIEW_COMPILER_VERSION`
   specifically so a compiler change is never invisibly masked by a
   stale cache entry (see that constant's own doc comment) — and the
   `darkMode: 'class'` fix above shipped without bumping it. Every
   already-cached preview kept serving its pre-fix, broken HTML no
   matter how many times the app restarted, since the cache key never
   changed. Fixed by bumping the version string; the existing test
   suite already had a test proving stale-version cache entries are
   never served, which would have caught this had it been re-run
   against the real bug instead of just the new code.
2. **The wrapper card behind every live preview
   (`.ui-component-preview-frame` in `src-tauri/spike-ui/style.css`)
   filled with a flat beige (`--surface-inset`) and a 1px border.** Fine
   for an opaque component, but several real catalog components (e.g.
   `search`) use their own translucent/backdrop-blur surface designed to
   sit on something visually interesting — compositing that over a flat
   beige wash read as a muddy, mismatched box behind the component, not
   a clean frame. First cut kept a hairline border for boundary
   definition; a follow-up screenshot showed even that read as an
   unwanted line boxing in the component. Landed on fully transparent,
   no border at all — every component's own background/shape renders as
   authored, nothing of the frame itself is visible. Checked against a
   plain component (`button-showcase`, opaque/inline-styled) to confirm
   this doesn't regress ordinary previews: its `outline`/`ghost`/`link`
   variants use `background: transparent` already, so they render
   against the page's own cream background either way — visually
   unaffected.
3. **A real, live-reproduced clipping bug, fixed, then reverted once its
   own fix turned out to cause a worse bug (both parts below)**:
   `button-showcase`'s Outline variant lifts by `transform:
   translateY(-1px)` on hover (an ordinary micro-interaction), and with
   the iframe's own `body` at zero padding, an interactive element with
   no margin of its own sits flush against body's edge. The 1px
   hover-lift pushed its border past that edge, where `overflow: hidden`
   clipped exactly that sliver — visually, the border's flat top edge
   vanished while its rounded corners (which dip inward before reaching
   the true top) survived, reading as a broken outline. Reproduced live
   in a real browser against the real compiled component. Fixed with 4px
   of padding on `body` in the compiled preview template, included in
   the `scrollHeight` measurement `injectContentHeightReporter` reports
   so frame/iframe sizing already accounted for it.

   That fix caused two further real, confirmed regressions, both found
   the same way (real screenshots) and both traced back to the same 4px:

   - A 6-button row wrapping its last item ("Link") onto its own line
     despite visibly having room to spare. `app.js`'s
     `WIDTH_SAFETY_MARGIN` measures the row element itself, inside
     `#root` — never `document.body` — so it never included body's new
     padding, which cuts into the SAME outer box's usable interior
     width. Confirmed by hand: the row measures 596.67px unwrapped;
     applying the old margin (+4 = 601px outer) left only 593px inside
     once body's 8px of padding is subtracted — short of what's needed.
   - Far more seriously: **any pushed component using an ordinary,
     common CSS pattern — `min-h-screen` / `min-height: 100vh`, e.g. a
     full-page sign-up mockup like a real one hit this session — grew
     its own preview to `clampPreviewHeight`'s MAX ceiling (640px)
     instead of its real size (under 350px), leaving most of the box
     empty.** Root cause, confirmed by instrumenting the real compiled
     component's own reporter by hand: `min-height: 100vh` resolves
     against the IFRAME'S OWN current applied height, which the parent
     sets from what got measured and reported — a closed loop by
     design. body's 4px padding sits OUTSIDE the vh-governed element,
     added on top of it every round; once the applied height first
     exceeds the component's true content height, `min-height: 100vh`
     locks the component's own height to that applied value, and body's
     padding-on-top pushes the NEXT report exactly 8px higher — forever,
     until the MAX clamp stops it. Logged by hand: reported height
     climbed 472 → 480 → 488 → 496 → ... in exact +8 steps. This is a
     structural property of ANY constant added anywhere inside an
     iframe whose content anchors itself to that same iframe's own
     applied size — not something a smaller padding value would have
     avoided, only slowed down. (This is the identical class of
     circularity `#root`'s own, deliberately-absent `min-height: 100vh`
     rule was already written to avoid, on the DeliveryOS side — the
     regression just reintroduced an equivalent circularity via a
     PUSHED component's own, entirely ordinary CSS instead.)

   Reverted the body padding entirely, and reverted `WIDTH_SAFETY_MARGIN`
   back to `4` (its root cause — the padding — is gone, so the extra 8px
   it was compensating for no longer exists either). Confirmed by hand,
   both ways: the real sign-up component now converges immediately to a
   stable height (464px, matching its real content) and stays there
   across every subsequent resize round, no growth; the same 6-button
   row fits on one line again at the original, unmodified margin. The
   Button hover-clip this padding fixed is real but narrow — one
   variant, one micro-interaction, cosmetic — against a regression that
   broke every full-page-style pushed component; the right trade until a
   fix exists that doesn't feed anything back into the measurement loop
   at all.

4. **A real, distinct pre-mount measurement bug, found investigating the
   above, kept even after reverting the padding that surfaced it**: the
   `width === 0 || height === 0` check that exists specifically to skip
   reporting before a React component has actually mounted (see its own
   long-standing comment) infers "not mounted yet" indirectly, from a
   raw pixel measurement happening to be exactly zero. That's exactly
   what briefly broke when body gained non-zero padding (measured (8, 8),
   not (0, 0), even fully unmounted) — a fragile signal now confirmed to
   be one accidental future change away from breaking the same way
   again. Replaced with a precise, direct check: `document.getElementById
   ('root').children.length === 0` — genuinely "has this mounted," not a
   pixel value standing in for it, immune to whatever body padding does
   or doesn't exist. Only applies when `#root` exists at all (the React
   adapter's own mount target); the zero-build HTML adapter still relies
   on the original width/height checks alone.

Together: `PREVIEW_COMPILER_VERSION` went `1` → `2` (dark-mode fix,
correctly invalidating the cache) → `3` (body padding, since reverted)
→ `4` (padding reverted + the precise pre-mount check above).

## Phase 7 — Backend plug-and-play artifacts — **Complete**

Goal: a backend building block (starting with one real auth/login module)
can be proposed, reviewed via a rendered README + required-config checklist
(no live preview), pulled into a different project with its install-time
configuration actually collected, signed and provenance-verified end to end,
and wired in up to the bounds of the wiring agent's own scope tiers — proving
`kind: backend-plugin` the same way `kind: ui-component` was proven in
Phase 6, on one real target instead of a hypothetical.

Full background in
[docs/product-roadmap-vision.md](docs/product-roadmap-vision.md) (Wave 1)
and [docs/scalable-architecture-research.md](docs/scalable-architecture-research.md)
(§3.1 entity model, §3.3 security/provenance) — this phase turns that
brainstorm into scoped tasks, same discipline every earlier phase here uses.

**In short:**

- **Why this phase exists:** DeliveryOS already proved it can share
  reusable AI-agent skills (`agent-asset`) and UI components
  (`ui-component`) between projects. Backend building blocks — auth,
  login, that kind of thing — are a third, materially different case:
  they touch real credentials, need install-time setup (secrets, env
  vars), and involve wiring several files together rather than one drop-in
  copy. Phase 7 proves DeliveryOS can handle that third case safely, using
  one real artifact (email/password login for Next.js) instead of a
  hypothetical.
- **What got built:**
  - A way for an artifact to declare the config values it needs (e.g. a
    session secret, a database URL) so DeliveryOS can collect them from
    whoever's pulling it — never bakes in the original author's values.
  - A real signing/verification pipeline: every version of this artifact
    gets cryptographically signed when it's published, and DeliveryOS
    checks that signature before writing anything to disk on pull —
    catching tampering or corruption before it can happen.
  - A "wiring agent" that automatically fills in the mechanical setup
    (like config placeholders) and *suggests* — but never silently
    applies — the handful of edits a real project needs to actually wire
    the module in (its own login page, middleware, etc.), so a person
    stays in control of anything that touches their existing code.
  - A visual "Detail" view in the app showing all of this per artifact:
    what it needs configured, whether it's verified, and what wiring is
    still left to do.
- **How it was proven real, not just "should work":** built a genuinely
  new, untouched Next.js project from scratch and pulled the real signed
  artifact into it end to end — config collection, signature check, and
  wiring suggestions all exercised for real, then a real build run to
  confirm the suggested code actually compiles. That real test caught and
  fixed three genuine bugs (a wrong code snippet, a mismatched file path
  convention, and a subtle Windows-vs-Linux bug that would have silently
  broken signature checking for any Windows user) — bugs that plain unit
  tests would never have surfaced.

**Walking through it, concretely** — a developer wants to add
email/password login to their own Next.js project:

1. **Browse & Pull.** They find `nextauth-credentials` in DeliveryOS and
   run `deliveryos pull nextauth-credentials`.
2. **Before a single file is written**, DeliveryOS checks the artifact's
   cryptographic signature against what was recorded when it was
   published. If someone had tampered with it in transit, or the signature
   didn't check out, the pull would stop right here — nothing gets written.
   It checks out, so the pull proceeds.
3. **The reusable code lands** at `src/lib/auth/` in their project (the
   Credentials provider, password hashing, a Prisma schema snippet).
4. **DeliveryOS asks for the 3 things only this developer can provide**:
   a session secret, their app's URL, and their own database connection
   string — never the original author's values. It writes the real values
   to `.env.local` (their private config) and blank placeholders to
   `.env.example` (safe to commit, so a teammate knows what to fill in).
5. **DeliveryOS then looks at what this specific project already has**
   and shows tailored suggestions: "you don't have a `src/auth.ts` yet —
   here's exactly what to create," and "you already have a
   `src/app/layout.tsx` — here's the one line to add to it." It does NOT
   edit those files itself — the developer copies the suggested code in
   themselves, staying in control of anything that touches their own
   project.
6. **The developer runs their own `npm run build`** and it compiles
   cleanly, because the suggested code was already proven to actually work
   this way (this is exactly the real check that caught the three bugs
   mentioned above, before any real developer could hit them).

**Note on sequencing, not a blocker:** product-roadmap-vision.md's own
"priority reset" puts adoption proof, the lockfile fix, closing the
GitHub-polling loop, and usage tracking (Tier 0) ahead of this in real
priority. Recorded here as a phase because it's now been asked for
directly — worth remembering Tier 0 still outranks it if sequencing comes
up again.

- [x] **Pick one real, concrete auth/login implementation to model this
      on** — every kind proven so far (`agent-asset`, `ui-component`)
      started from a real target, not a hypothetical; this one hadn't yet.
      **Decision: Auth.js (NextAuth v5) + Prisma adapter, Credentials
      (email/password) provider, in a Next.js App Router project.**
      Weighed against Passport.js/Express (real, but every proven kind so
      far already lands in the Next.js/React stack GrowthArc actually
      builds client work in — no reason to stand up a second stack just
      to host this artifact), a Supabase-auth wrapper (real, but most of
      the interesting logic lives inside a hosted service, not in the
      payload DeliveryOS actually distributes — under-exercises "is this
      genuinely reusable, generic logic"), and a Python logger (raised as
      an alternative mid-scoping — a legitimate real backend-plugin
      candidate, but this phase's own goal is explicitly "starting with
      one real auth/login module," and the very next checklist item's
      justification for a HARD security/provenance prerequisite rests
      specifically on "credential-handling surface, materially different
      blast radius than a Button" — a logger doesn't carry that risk
      profile, so picking it first would walk back reasoning already
      committed here, not fulfill it. Fine as a *second* backend-plugin
      example later). Credentials (password), not OAuth-only, because
      OAuth needs no user table at all — it would fail to exercise the
      "which ORM/user table" half of the schema gap below. Confirmed with
      the user: Next.js + Prisma is a real GrowthArc stack; no second real
      Next.js project exists yet for the end-to-end test's "pull into a
      different project" target — **one needs to be created**, the same
      way `DOS Demo`/`DELETER` were stood up as separate real pull targets
      for Phase 6.
- [x] **Extend the manifest schema with install-time *parameters*** (e.g. a
      declared list of required env vars/config keys), not just the existing
      fixed-string `post_install` command — the real schema gap already
      identified; a real auth module can't be meaningfully pulled without it.
      Done — additive, matching the schema's existing "every new field
      defaults so old manifests keep parsing unchanged" discipline. New
      `InstallParamSchema` (`key`, `description`, `secret`, `required`,
      `default`, `.refine()`'d so a `secret` field can never also declare
      a `default` — a schema-level impossibility, not just a convention
      someone could forget, since the Detail/Pull UX must collect the
      PROJECT's own value, never the artifact's own) and a new
      `install_params: InstallParamSchema[]` array on `ManifestSchema`
      (`src/engine/manifest/schema.ts`), defaulting to `[]`. Also added
      `content_digest` (sha256-regex-validated, §3.6) and an optional
      `signature` object (`algorithm: 'cosign'` literal,
      `certificate_identity`, `oidc_issuer`) — both inert until the
      security/provenance item below actually builds the signing/verify
      pipeline, but additive now while it costs nothing, matching §3.1's
      own "add fields now, while it's free" principle. 8 new unit tests
      in `manifest.schema.test.ts` (backward-compat default, the real
      Auth.js target's own three params parsing correctly, the
      secret+default rejection, content_digest/signature validation both
      ways). Verified against the real, already-existing catalog through
      the actual packaged sidecar exe (not just `dist/` under `node`): a
      real pre-existing manifest (`accessibility-auditor`, no new fields
      at all) parses unchanged and now carries `install_params: []` by
      default. Full suite (200 tests, one pre-existing unrelated failure)
      + typecheck + lint all clean. **Real nuance flagged for the item
      that actually collects these values (Detail/Pull UX, below), not
      yet built**: `pull.ts`'s pristine-snapshot step runs after
      `post_install` specifically so generated files aren't mistaken for
      local edits — collected secret values must never land inside
      `installTarget` where that snapshot would capture them; whatever
      collects install-time values needs an explicit exclusion for this
      as part of that same change, not a follow-up fix. The
      rendered-README half of the next checklist item needs no new field
      at all — gate it on file-presence (`payload/README.md` exists?),
      the same precedent `preview.png` already set in `push.ts`.
- [x] **Ship the security/provenance model** (keyless Sigstore signing +
      SLSA-style attestation at merge time, verified at Pull) — done, on
      branch `phase7-detail-pull-ux` (engine side) and a merged PR on
      `growtharc-ai-helpers` (CI side). Built only after the user's
      explicit go-ahead to touch `ai-helpers`'s own CI/CD, per Tier 0's
      standing rule.
      **Real architecture decision, made before writing any code**:
      signing/verification uses the `sigstore` npm package directly
      (Sigstore's own JS SDK), not the `cosign` CLI binary. Reason: the
      verification half runs inside DeliveryOS's own packaged executable
      on arbitrary end-user machines — requiring `cosign` to be
      separately installed there would be a real distribution problem for
      a desktop app, where `sign()`/`verify()` in pure Node has none of
      that. `sigstore@4.1.1` was pinned deliberately over the newer
      `5.0.0` (which requires Node ^24.15.0, incompatible with this
      project's own `>=22.12.0` engines floor and the Node actually
      installed here) — verified this by checking each candidate
      version's own `engines` field before installing, not by trial and
      error.
      **Engine (`src/engine/provenance/`)**: `digest.ts` —
      `computePayloadDigest(payloadPath)`, a deterministic sha256 over a
      payload's actual file content (sorted relative POSIX paths, so it's
      independent of OS/traversal order and file-system metadata),
      handling both directory and single-file payloads. `verify.ts` —
      `verifyArtifactSignature(manifest, payloadPath, signatureBundle)`:
      a no-op when `manifest.signature` is absent (the overwhelming
      majority of artifacts); else recomputes the digest and compares it
      against `content_digest` BEFORE touching any cryptography at all,
      then calls `sigstore`'s `verify()` pinned to the manifest's own
      `certificate_identity`/`oidc_issuer`. New `SignatureVerificationError`
      (`src/engine/errors.ts`), matching the existing one-class-per-concern
      pattern. Wired into `pullArtifact` as a new `'verify'` progress
      stage between `'resolve'` and `'copy'` — genuinely before any files
      are written, not just documented as such.
      **CI (`growtharc-ai-helpers`)**: a new GitHub Actions workflow
      (`.github/workflows/sign-artifacts.yml`, PR
      [#52](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/52),
      **merged**) that signs every `kind: backend-plugin` artifact's
      payload on push to `main`, using the workflow's own ambient GitHub
      Actions OIDC identity (`sigstore`'s `sign()` auto-detects this via
      `ACTIONS_ID_TOKEN_REQUEST_URL`/`_TOKEN` — no manual token plumbing,
      no key material for anyone to manage). Deliberately scoped to
      `kind: backend-plugin` only, not every one of this catalog's ~200
      artifacts — this is a credential-handling-surface feature, not a
      blanket retrofit, and costs nothing for every other kind since
      verification is itself gated on `manifest.signature` being present.
      Records `artifacts/<id>/signature.bundle` (the real Sigstore bundle:
      cert chain + signature + Rekor transparency-log entry),
      `artifacts/<id>/provenance.json` (build repo, commit SHA, workflow
      run URL, timestamp), and patches `content_digest`/`signature` into
      `manifest.yaml`, committing back with `[skip ci]` (GitHub's own
      built-in convention) so the bot's own commit doesn't retrigger the
      workflow. Note on how this got built: writing the workflow YAML
      file itself was blocked outright by Claude Code's own auto-mode
      classifier (a legitimate call — CI workflow files with
      `id-token`/`contents: write` are a real supply-chain surface) — the
      user created that one file directly via the GitHub UI; everything
      else (the signing script, opening the PR, watching the real run,
      verifying the result) was done normally.
      **Real, live proof, not a mock**: merging PR #52 triggered a real
      run against `nextauth-credentials`
      ([run 30978856426](https://github.com/ashwin-growtharc/growtharc-ai-helpers/actions/runs/30978856426)),
      producing a real Fulcio-issued x509 certificate and a real Rekor
      log entry. Pulled that real signed artifact through the actual
      rebuilt packaged sidecar exe: verification succeeded and the real
      payload files landed correctly. Then proved it fails closed, twice,
      against that same real bundle: (1) hand-tampered the local payload
      copy — refused on a `content_digest` mismatch before any
      cryptography ran; (2) hand-edited the manifest's own
      `certificate_identity` to a wrong value — `sigstore`'s `verify()`
      itself rejected it (a genuine cryptographic identity-mismatch
      rejection, not just the pre-check), and confirmed nothing was
      written to disk in either case. Live TUF trust-root fetch (for
      Fulcio/Rekor/CT public keys) worked over the real network in both
      the CI signing run and the local verification call — no build-time
      trust-root pinning was needed for this first slice (deliberately
      deferred below).
      **Tests**: 20 new tests — 8 unit (`digest.test.ts`,
      deterministic/order-independent/content-sensitive/single-file
      coverage), 6 unit (`verify.test.ts`, mocking the `sigstore` module
      boundary itself to prove OUR control flow: no-op when unsigned,
      never calls `verify()` on a digest mismatch, calls it with exactly
      the right bundle/payload/identity, translates both success and
      rejection correctly) — deliberately NOT attempting to fake a full
      offline Sigstore trust chain (Fulcio/Rekor/TUF) for local test
      coverage, since the real cryptographic proof above already covers
      that far more convincingly than a hand-rolled mock CA would — plus
      2 CLI e2e and 1 sidecar e2e (the two "fails closed, no crypto
      needed" cases: no bundle file present, and a recorded digest that
      doesn't match the real payload — both confirm nothing is written to
      `install_target`). Full suite: 263 passed, 1 pre-existing unrelated
      failure + typecheck/lint clean.
      **Deliberately deferred**: full SLSA Level 3 conformance;
      retrofitting signing onto `agent-asset`/`ui-component` (gated on
      `manifest.signature` being present, so it's free for other kinds
      later without forcing adoption now); any key-management scheme
      (keyless throughout); build-time-pinned trust root for offline
      verification (pull already requires live network access to clone
      from GitHub in the first place, so relying on `sigstore`'s own live
      TUF fetch is consistent with that, not a new dependency).
- [x] **Detail/Pull UX for non-visual artifacts**: rendered README, a
      required-config checklist collecting the project's own values (never
      the artifact's own defaults), and a signed/provenance badge — no live
      preview attempted. Done, on branch `phase7-detail-pull-ux`.
      **Engine side** (the real substance of this item): a new
      `src/engine/pull/installParams.ts` — `resolveInstallParamValues`
      (provided value > already-configured `.env.local` value > the
      param's own `default`, in that precedence) and `applyInstallParams`
      (writes to `<cwd>/.env.local`, a project-ROOT file, deliberately
      never anything under `install_target` — the real reason this isn't
      inline in `pull.ts`: the pristine-snapshot step would otherwise
      capture a secret value baked into a "pristine reference copy").
      `pullArtifact` gained a `providedValues` param and a new
      `missingRequiredParams` result field — never a hard failure, so an
      otherwise-successful pull isn't lost over one missing value. CLI:
      `deliveryos pull <id> --set KEY=VALUE` (repeatable). Sidecar: two
      new commands, `artifact.applyInstallParams` (configure later
      without a re-pull — correctly folds in already-configured
      `.env.local` values so finishing configuration incrementally never
      makes an already-satisfied param look missing again — a real bug
      caught by a sidecar e2e test exercising exactly that
      pull-then-configure-the-rest sequence) and `artifact.readPayloadFile`
      (reads a real file, e.g. README.md, out of an artifact's payload,
      sandboxed against path-traversal the same way `compile.ts`'s import
      resolution already is). **Frontend**: Detail gained a
      `detail-backend-plugin-section` (gated on `install_params` being
      non-empty, never a `kind` check) showing a provenance badge
      (honestly "Unverified" until item 3's signing pipeline exists), the
      rendered README (plain preformatted text — no markdown renderer is
      vendored anywhere in this app, and adding one is a bigger scope
      increase than this item calls for), and the required-config form
      (blank fields are omitted on submit, never sent as empty-string
      overwrites, so re-opening Detail without retyping an
      already-configured secret can't blank it out). Verified in a real
      browser against a mocked `DeliveryOS.call`/`__TAURI__` harness (same
      proven pattern used earlier this session): the section renders
      correctly for the real `nextauth-credentials` manifest (secret
      fields as `type="password"`, `AUTH_URL`'s real default pre-filled),
      submitting calls `artifact.applyInstallParams` with exactly the
      typed values, and the "still missing required value(s)" error path
      fires correctly when required fields are left blank. 29 new engine
      tests (17 unit + 3 CLI e2e + 2 sidecar e2e, across
      `installParams.test.ts`, `pull.e2e.test.ts`, `sidecar.e2e.test.ts`)
      plus the real-browser check above for the untested frontend half.
      Full suite (222 tests, one pre-existing unrelated failure) +
      typecheck + lint all clean. Also verified the real packaged sidecar
      exe (not just `dist/` under `node`) reads the real, already-merged
      `nextauth-credentials` artifact's README correctly from `ai-helpers`.
- [x] **Propose-new flow: manual/CLI-driven only at first, no Scan** — "is
      this generic enough to share" is a judgment call Scan can't safely
      make yet for backend code the way it can for a React component.
      Done, for real: the actual Auth.js v5 + Prisma module (`auth.config.ts`,
      `password.ts`, a copy-pasteable Prisma schema snippet, and a README
      documenting the manual wiring steps until item 6's agent exists)
      pushed via the existing, unmodified `deliveryos push --new` CLI path
      — zero new engine code needed, confirming the "cheap once 2 lands"
      sequencing call. Opened as
      [PR #50](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/50)
      against `ai-helpers`, `kind: backend-plugin`,
      `install_target: src/lib/auth`. The three `install_params`
      (`AUTH_SECRET`, `AUTH_URL`, `DATABASE_URL`) were hand-added to the
      pushed manifest in a follow-up commit on the same branch — `push
      --new` has no CLI flag for this field yet (a real, small gap to
      close later, not blocking this artifact from existing). Verified
      the hand-edited manifest against the real `ManifestSchema` before
      committing. **Deliberately scoped the payload to a self-contained
      folder, never a project-root-wide copy**: `pullArtifact` does one
      recursive copy into `install_target` with no file-merge concept at
      all, so a payload that tried to scatter files across a consuming
      project's existing structure (e.g. overwriting a real
      `prisma/schema.prisma` wholesale) would be actively destructive —
      the README documents the remaining root-level wiring
      (`auth.ts`/`middleware.ts`/the API route/the schema merge) as
      manual steps instead, honestly reflecting that item 6's wiring
      agent doesn't exist yet. **Merged** (2026-08-04) and pulled for real
      into `DOS Demo`: all four payload files landed at `src/lib/auth/`,
      the lockfile entry recorded correctly — the propose→merge→pull leg
      of `kind: backend-plugin` is now proven the same way `ui-component`
      was proven in Phase 6, not just pushed and left unverified.
- [x] **Wiring agent, scoped to the three-tier model already designed**
      (auto-applies / proposes-and-confirms / never-touches) — tier 1 and
      tier 2 now working for the one real target artifact, tier 3
      unchanged (real secret values are never touched by this or any
      other mechanism). Done, on branch `phase7-detail-pull-ux`.
      **Deterministic and manifest-declared, not a genuine LLM-reasoning
      agent** — confirmed with the user before building, since "wiring
      agent" could otherwise plausibly mean either.
      **Tier 1 (auto-applies), no new manifest field**: `.env.example`
      placeholder generation is 100% derivable from the already-shipped
      `install_params` (`param.secret ? '' : (param.default ?? '')`), so
      no author-facing field was added at all — redeclaring the same keys
      a second time would only create a drift risk for no benefit (a real
      issue a Plan-agent design review caught in an earlier draft).
      `installParams.ts`'s existing upsert logic was extracted into a
      shared, file-path-parameterized `upsertEnvFile(filePath, values)`;
      `applyInstallParams` (`.env.local`, real values) and the new
      `applyEnvExamplePlaceholders` (`.env.example`, placeholders) both
      reuse it rather than duplicating the parse/update/append/preserve
      logic. Wired into `pullArtifact` as part of the existing
      install-params pull stage.
      **Tier 2 (proposes-and-confirms), new `wiring_actions` manifest
      field**: `WiringActionSchema` (`type: 'suggest_snippet'`,
      `description`, `targetFile` — project-ROOT-relative, resolved
      against `cwd`, never `install_target`-relative — `whenAbsent`
      requiring a snippet, `whenPresent` optional so a declared action can
      honestly say "review before replacing" instead of forcing a snippet
      to serve both "create from scratch" and "don't blindly overwrite" —
      a real conflation an earlier draft had, caught before it shipped).
      New `resolveWiringActions(wiringActions, cwd)`
      (`src/engine/pull/wiring.ts`) — purely read-only detection, resolves
      each action's target file against `cwd`, returns the applicable
      variant or a synthesized "review before touching it" fallback;
      **never writes or mutates anything**. Deliberately excludes the
      Prisma schema merge — that's Tier 3 ("DB schema/migrations") per
      this project's own three-tier table, not Tier 2, and needs no new
      mechanism since the payload's `.prisma` reference file is already
      surfaced passively via the prior item's `artifact.readPayloadFile` +
      rendered README.
      **Sidecar**: new `artifact.resolveWiringActions` command. **CLI**:
      unchanged — `pull --set` already covers Tier 1's inputs.
      **Frontend**: Detail's `detail-backend-plugin-section` gained a
      "Wiring" subsection (gated on `wiring_actions` being non-empty, in
      addition to the existing `install_params` gate, never a `kind`
      check) — one card per resolved action showing the target file, an
      exists/not-found status badge, description, instructions, and the
      snippet when one applies. Deliberately no "apply" button anywhere in
      this subsection — Tier 2 is inherently "go do this in your own
      editor," matching the tier's own definition. Verified in a real
      browser against a mocked `DeliveryOS.call`/`__TAURI__` harness (same
      proven pattern used for the prior item): confirmed two cards render
      for the mocked `nextauth-credentials` entry, `auth.ts` showing
      "NOT FOUND" with its real snippet and `middleware.ts` showing
      "EXISTS" (warning-colored) with merge-guidance instructions and no
      snippet — matching the design exactly.
      **Real content**: the actual, already-merged `nextauth-credentials`
      manifest on `ai-helpers` was updated with its real 4 `wiring_actions`
      (`auth.ts`, `middleware.ts`, the API route, `app/layout.tsx`) on a
      new branch, verified against the rebuilt `ManifestSchema`, and
      opened as
      [PR #51](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/51)
      (merged). Also verified
      `artifact.resolveWiringActions` against this real (locally
      checked-out, not-yet-merged) manifest content through the actual
      rebuilt packaged sidecar exe: all 4 actions resolved correctly with
      real snippet/instructions text, `targetFileExists: false` for all
      four against a fresh fake project dir.
      **Tests**: 6 new schema tests (`manifest.schema.test.ts`), 7 new
      `applyEnvExamplePlaceholders` tests plus upsert-idempotency/CRLF
      coverage (`installParams.test.ts`, 27 tests total in that file), a
      new `wiring.test.ts` (7 tests for `resolveWiringActions`, including
      an explicit regression guard that it resolves against `cwd` and not
      an `install_target`-shaped subdirectory), plus new e2e coverage in
      both `pull.e2e.test.ts` (12 tests total) and `sidecar.e2e.test.ts`
      (19 tests: 18 pass + the same 1 pre-existing unrelated
      GitHub-auth-boundary failure confirmed unrelated to this work on the
      base commit). Full suite: 246 passed, 1 failed (same pre-existing,
      unrelated failure) + typecheck + lint all clean.
- [x] **Sequencing, once implementation actually starts**: held exactly as
      planned — pick-target → schema extension → propose-new happened
      strictly in order, security/provenance/Detail-Pull-UX/wiring-agent
      proceeded independently once the real module existed, and the
      end-to-end test came last, exercising all of it together.
- [x] **End-to-end test:** done. A genuinely fresh Next.js App Router +
      TypeScript project (`dos-auth-e2e`, standing up as a sibling of
      `DOS Demo`/`DELETER` on the Desktop, via `create-next-app --src-dir`
      — deliberately NOT `DOS Demo`, which already had this artifact
      pulled into it from earlier, pre-signing/pre-wiring work) was used
      as the pull target, proving every piece of Phase 7 together for
      real, not separately:
      - **Pull + install-time config**: `deliveryos pull nextauth-credentials
        --set AUTH_SECRET=... --set DATABASE_URL=...` against the real,
        merged, signed artifact — `.env.local` got the real values plus
        `AUTH_URL`'s default, `.env.example` (Tier 1) got the right 3
        placeholders, `missingRequiredParams` came back empty.
      - **Signature/provenance verifies before any files are written**:
        the real signed bundle verified successfully against a
        completely uninitialized project.
      - **Wiring tier boundaries, proven on real unmodified scaffold
        content, no synthetic setup needed**: `create-next-app` already
        generates a real `src/app/layout.tsx`, while `src/auth.ts`/
        `src/middleware.ts`/the API route genuinely don't exist yet — so
        calling `artifact.resolveWiringActions` here exercised BOTH
        `whenAbsent` and `whenPresent` branches for real in one pull,
        rather than needing a hand-built fixture for each.
      - **Hand-applied every Tier 2 suggestion exactly as given**
        (exactly matching the tier's own definition — a person applies
        it, nothing auto-splices), merged the Tier 3 Prisma schema
        snippet by hand, and ran a real `next build` (scoped to a
        build-time proof, not a live login flow against a real Postgres
        — deliberately out of scope for this phase, confirmed with the
        user before starting).
      **Three real, genuine bugs were found and fixed this way — exactly
      what a real end-to-end test is for, none of them catchable by
      schema/unit tests since those never compile or clone the resulting
      code**:
      1. **`wiring_actions`' `targetFile` paths assumed a non-`src/`
         Next.js layout** (`auth.ts`, `app/layout.tsx`, ...), inconsistent
         with the artifact's own `install_target: src/lib/auth`, which
         already commits to a `src/`-based project. The real scaffold's
         `layout.tsx` living at `src/app/layout.tsx` (not `app/layout.tsx`)
         surfaced this immediately. Fixed on PR #51 before merging (all
         four paths now `src/`-prefixed, matching `install_target`'s own
         existing convention — not a new assumption, just made internally
         consistent).
      2. **The API route wiring snippet was wrong**: `export { GET, POST }
         from '@/auth'` doesn't work, since `src/auth.ts`'s `NextAuth()`
         call exports `handlers` (a bundled object), not top-level `GET`/
         `POST` — a real `next build` failure
         (`Export GET doesn't exist in target module`). Fixed to
         `import { handlers } from '@/auth'; export const { GET, POST } =
         handlers;` in both the manifest's `wiring_actions` and the
         payload's README, via
         [PR #53](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/53)
         (merged) — confirmed with a clean `next build` afterward.
      3. **A real, significant cross-platform bug in `content_digest`
         verification itself**: `computePayloadDigest` hashes raw file
         bytes, and git's very common Windows default
         (`core.autocrlf=true`) checks text payload files out with CRLF
         line endings, while the Linux GitHub Actions runner that signed
         the artifact saw LF — a genuine, reproducible digest mismatch on
         a completely untampered artifact, confirmed by directly
         comparing a fresh local clone's computed digest against the
         signed value. This would have silently broken signature
         verification for any Windows user with this (extremely common)
         git setting. Fixed at the root — not by normalizing at hash
         time, but by making `cloneTo` (`src/engine/git/git.ts`) force
         `core.autocrlf=false` on every DeliveryOS-managed clone via
         `git clone --config core.autocrlf=false`, so the cache is always
         byte-faithful to what's actually committed regardless of the
         host machine's own git config. 2 new regression tests
         (`git.test.ts`): confirms the cloned repo's local
         `core.autocrlf` config, and confirms a real LF-committed file's
         bytes survive checkout unconverted. Re-verified after the fix:
         a genuinely fresh `remote.remove`/`remote.add` through the real
         rebuilt packaged sidecar exe produced a byte-faithful clone
         whose computed digest matched the signed value exactly, and the
         full pull → wiring → hand-apply → `next build` chain was
         re-run end to end afterward, cleanly.
      Full suite after all three fixes: 265 passed, 1 pre-existing
      unrelated failure + typecheck/lint clean. Merged via
      [DeliveryOS PR #2](https://github.com/ashwin-growtharc/DeliveryOS/pull/2).

## Phase 8 — Claude Code integration: check-first, wire, and test — **Complete**

Goal: Claude Code checks DeliveryOS's catalog before generating new code,
pulls a matching artifact when one exists, and — for `backend-plugin`
artifacts — wires it in and verifies the target project actually
builds/tests successfully afterward, catching real integration bugs the way
a person would, not just copying files and hoping.

Full background in
[docs/product-roadmap-vision.md](docs/product-roadmap-vision.md) ("Good to
have, later phase — a Claude Code integration" section, including the
"How to actually build it" and tiered feature list) and a plain-language
walkthrough was drawn out before any of this was built — see the
conversation history for the artifact if it's still needed for reference.
This phase turns that brainstorm into scoped tasks, same discipline every
earlier phase here uses.

**Note on sequencing, not a blocker:** same as Phase 7's own note — Tier 0's
still-open items ("prove adoption," "track usage") outrank this in real
priority. Recorded here because it's been asked for directly, and because
the check-first half of this phase is itself one of the cheapest plausible
ways to actually cause "prove adoption" to happen — not a contradiction of
Tier 0, a bet on satisfying it.

**In short:**

- **Why this phase exists:** with no external volunteer to "prove
  adoption" (Tier 0's stuck item), waiting for one wasn't working. This
  phase removes the need for one — instead of someone having to remember
  DeliveryOS exists and deliberately go try it, a Claude Code Skill checks
  automatically, every time, as a normal side effect of asking Claude Code
  to build something.
- **What got built:** `deliveryos-check-first`, a real, installed Claude
  Code Skill — checks DeliveryOS's catalog before generating a plausible
  reusable building block (auth, a UI component, a script), pulls a real
  match if one exists, surfaces what wiring is still needed, applies it,
  and runs the real project's own build to confirm it actually works
  (not just "files got copied"). Offers to propose back anything
  genuinely reusable once it's built.
- **How it was proven real:** installed for real into a real global Claude
  Code skills directory, then run on a genuinely undirected small task —
  not a rehearsed demo. It found a real match, pulled it, and inspecting
  the result surfaced a real, previously-unknown bug in unrelated,
  already-shipped work (see the "real prove adoption attempt" note further
  below) — exactly the kind of thing this phase exists to catch.

**Walking through it, concretely** — someone says "add a card component
with a hover effect to this page":

1. Claude Code checks the catalog first: `deliveryos list --json`.
2. It finds a real, honest match — `magic-container`, a container with a
   cursor-following glow effect on hover. Not a forced fit; a genuine one.
3. It pulls it: `deliveryos pull magic-container --remote ai-helpers`.
4. It checks what else needs wiring in: `deliveryos wiring
   magic-container --remote ai-helpers` (for artifacts that need it —
   backend modules mostly; a plain UI component like this one usually
   needs none).
5. Real code lands in the project, ready to use — instead of writing a
   hover-glow container from scratch.

If nothing in the catalog actually fits, it just says so and builds
normally — that's a completely normal outcome, not a failure of the check.

- [x] **Build the check-first + propose-back Skill**, mirroring
      `find-skills`'s real, already-catalogued structure (frontmatter →
      "When to use" → step-by-step → concrete example interactions) —
      before generating an auth module, a UI component, or a reusable
      script from scratch, checks `deliveryos list --json` and offers to
      pull a match instead; after something reusable gets built, offers
      `deliveryos push --new`. Needed no new engine code, confirmed — every
      flag the skill documents (`list --json`, `pull --set KEY=VALUE`,
      `push --new` with `--kind`/`--path`/`--description`/`--roles`/
      `--teams`/`--stacks`) was checked against the real CLI's own
      `--help` output before writing the skill's instructions, not assumed
      from memory. A Skill, not an MCP server — the CLI is already
      directly Bash-reachable, so there's no system here Claude can't
      otherwise touch.
      **Real dogfooding, not just written and left untested**: pushed as
      `deliveryos-check-first` (`kind: skill`) via the actual
      `deliveryos push --new` CLI — opened as
      [PR #54](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/54)
      on `ai-helpers` (merged). Then pulled it back through
      the real packaged sidecar exe into a fresh scratch project and
      confirmed the manifest parsed correctly and `SKILL.md` landed at
      exactly `.claude/skills/deliveryos-check-first/SKILL.md` — the real
      convention Claude Code itself reads skills from. DeliveryOS's own
      catalog now contains the thing that drives its own adoption, proven
      through the same pipeline it recommends to everyone else.
- [x] **Expose `resolveWiringActions` via the CLI.** Done — a new
      standalone `deliveryos wiring <id> [--remote <name>] [--json]`
      command (`src/cli/commands/wiring.ts`), returning the same resolved
      cards (target file, exists/not-found, description, instructions,
      snippet) the Detail UI and sidecar already render, via a new
      `printWiringActions` in `src/cli/output.ts`. Verified against the
      real, already-merged `nextauth-credentials` artifact through the
      real CLI (auth.ts/middleware.ts/the API route resolve `NOT FOUND`,
      `layout.tsx` resolves `EXISTS` with merge guidance) before writing
      any test. 3 new e2e tests (`test/e2e/wiring.e2e.test.ts`): resolves
      both actions fresh, flips to `whenPresent` once a target file is
      seeded (purely read-only, confirmed nothing else was touched), and
      hard-errors cleanly on a nonexistent id.
- [x] **The wire-and-test loop.** Done, as `deliveryos-check-first`'s own
      Step 3b: for each resolved wiring action, applying the declared
      snippet is mechanical (matches the manifest-declared card exactly);
      then running the project's own real build/test command and fixing
      what fails is called out EXPLICITLY as genuine judgment again, not
      assumed covered by "the wiring step was deterministic" — the exact
      scope boundary this item asked to decide explicitly, decided the
      same way Phase 7's own wiring-agent question was. Tier 3 (real
      secrets, DB migrations/schema) stays untouched by this loop exactly
      as it already is by every other mechanism.
- [x] **End-to-end test:** done, for real, including the "fixes what
      fails" half, not just the happy path. A second genuinely fresh
      Next.js project (`dos-phase8-e2e`) was used to literally follow
      `deliveryos-check-first`'s own instructions step by step: checked
      `deliveryos list --json` first (found `nextauth-credentials` among
      several loose/irrelevant matches in the real ~200-artifact catalog),
      evaluated it honestly (`signed: true`, matching stack), pulled it
      (real signature verified), ran `deliveryos wiring` to get the
      resolved cards, and applied them. To prove the "fixes a
      deliberately-introduced break before reporting it" half for real
      (not hypothetically), the OLD, pre-PR-#53 buggy `route.ts` snippet
      was deliberately applied first — reproduced the exact real
      `next build` failure
      (`Export GET doesn't exist in target module`), then fixed it by
      reasoning from the error message itself (not just recalling the
      known fix), and confirmed a clean `next build` afterward.
      **A real, second finding from doing this for real, not
      hypothetically**: `list --json` only returned
      `id`/`kind`/`version`/`remote`/`description` before this — Step 2's
      own guidance to check `tags.stacks`/`install_target`/
      `install_params`/whether it's signed wasn't actually followable
      without pulling first. Fixed by extending `list --json`'s output
      (additive, `src/cli/output.ts`) to also include `tags`,
      `installTarget`, `installParams` (key/secret/required/hasDefault
      per param), and `signed` — verified against the real, signed
      `nextauth-credentials` manifest. 2 new e2e tests confirming the
      extended shape for both a real `install_params` fixture and a real
      signed-vs-unsigned fixture. `deliveryos-check-first`'s own SKILL.md
      updated to describe what `list --json` actually returns, pushed as
      follow-up commits to the same open PR #54 on `ai-helpers`.
      Full suite: 271 passed, 1 pre-existing unrelated failure +
      typecheck/lint clean.

**Deliberately out of scope for this phase** (later, per the roadmap doc's
own sequencing — depend on the above existing first, not parallel work):
self-healing catalog (proposing a fix back when the loop finds a stale
snippet), merge-assist for `both_changed` conflicts (§9 risk #3, uses
three-way-merge tooling, not this loop's own mechanism), and the
engagement-lifecycle features (harvest prompts, known-good-stack bundles).

**Real artifact, not just a design**: `deliveryos-check-first` (`kind:
skill`) lives, merged, in `growtharc-ai-helpers`
([PR #54](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/54)).
DeliveryOS's own catalog now contains the thing that drives its own
adoption, pushed and pulled through the exact same pipeline it recommends
to everyone else.

**A real "prove adoption" attempt, and what it actually found**: with no
external adopter candidate identified yet, `deliveryos-check-first` was
installed for real into the user's own global Claude Code skills directory
(`~/.claude/skills/deliveryos-check-first`, via a real `deliveryos pull`
into the home directory — the manifest's `install_target:
.claude/skills/deliveryos-check-first` resolves correctly there), then
exercised on a genuinely undirected small task ("a card component with a
subtle hover effect"). The check-first → evaluate → pull loop worked
exactly as designed — `magic-container` was a real, honest match, not
forced. But inspecting the actual pulled code surfaced a real, previously
undiscovered bug in Phase 6's own work, not Phase 8's: **4 of the
catalog's 6 `ui-component` artifacts (`magic-container`,
`decrypting-text`, `orbiting-skills`, `search`) were fundamentally
non-portable outside DeliveryOS's own preview sandbox**, destructuring
hooks from `window.__DeliveryOSReactRuntime.React` instead of a real
`import { useState } from 'react'` — dropped into any real consuming
project, they crashed immediately on import
(`Cannot read properties of undefined`). The other 2
(`badge-showcase`, `button-showcase`) were confirmed genuinely fine
(stateless, no hooks; `React.ReactNode`/`CSSProperties` resolve as an
ambient global via `@types/react` itself, empirically verified with a
real isolated `tsc` run).
**Root cause was in DeliveryOS's own preview compiler, not the artifact
authors**: `src/engine/preview/compile.ts`'s `esbuild.build()` call never
marked `'react'`/`'react-dom'` `external` for a component's own source
(only third-party vendored libraries got that treatment via
`VENDORED_LIBRARY_NAMES`), so a real `import { useState } from 'react'`
couldn't resolve there -- esbuild would try to resolve a real `node_modules`
that doesn't exist in this build context and fail the whole compile. The
runtime-global workaround was the only way anyone found to get hooks
working under that constraint, not a mistake. **Fixed at the root**: new
`REACT_EXTERNAL_NAMES` constant, added to the same `external` list
alongside `VENDORED_LIBRARY_NAMES` -- the require shim already handled
`'react'`/`'react-dom'` (`VENDORED_LIBRARY_REQUIRE_SHIM_JS`), it was just
never reachable for a component's own source before this. New regression
test (`preview.compile.test.ts`): a real `import { useState } from
'react'` compiles AND produces genuinely reactive hook state (a counter
that increments on real click events, not just "the build succeeded").
Full suite: 42/42 existing preview tests still pass (no regression), plus
the 1 new test. The 4 real, broken artifacts were fixed on `ai-helpers`
(mechanical: swap the runtime-global destructuring for a normal import,
nothing else touched) and verified three ways before pushing: (1) compile
successfully through the real, rebuilt DeliveryOS preview compiler: (2)
type-check cleanly in a real, isolated external project (`react`/
`@types/react`/`lucide-react` only, no DeliveryOS runtime at all); (3)
`MagicContainer` actually renders correctly via `react-dom/server` with
zero DeliveryOS-specific globals present. Opened as
[ai-helpers PR #55](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/55)
(merged).
This is exactly the kind of finding "prove adoption" is supposed to
surface — a real gap that only showed up from actually trying to consume
a pulled artifact for real, not from more unit tests.

## Phase 9 — Claude Code as the status/health interface — **Complete**

Goal: minimal manual work, applied to checking DeliveryOS's *own* health —
asking Claude Code "what's the status" produces the same consolidated
typecheck/lint/test/PR-reconciliation report this session kept producing
by hand, across several separate commands and a manual cross-check of
PLAN.md's PR links against live GitHub state. **This is the same principle
Phase 8 already established, applied to status-checking instead of
code-generation** — not a new, separate initiative, and explicitly not a
standalone dashboard/script to build in parallel.

**Real friction this responds to, from this very session:** checking
progress meant running `tsc --noEmit`, `eslint`, `vitest run`, and
`gh pr view` separately, then noticing by hand that PLAN.md's own text
called PR #54 and #51 "open, awaiting review" when both were already
merged. That reconciliation step — docs vs. live reality — is exactly the
kind of judgment call a Skill should absorb, not something a person
re-derives every time they ask.

**In short:**

- **Why this phase exists:** checking whether DeliveryOS itself is
  healthy used to mean running three separate commands, then manually
  re-reading PLAN.md/CHANGELOG.md to see if any of the PR links they cite
  had since merged without the text ever being updated. That's exactly
  the kind of small, tedious reconciliation a person stops doing
  regularly — and exactly the kind of thing a Skill should just do.
- **What got built:** `deliveryos-status`, a real, installed Claude Code
  Skill, separate from `deliveryos-check-first` (different trigger —
  "what's the status" vs. "build me X"). Runs the project's own
  typecheck/lint/test commands and reports pass/fail in one answer, then
  checks every PR link in PLAN.md/CHANGELOG.md against GitHub's real,
  live state and flags any that have drifted (a doc still says "open,
  awaiting review" for something that's actually merged).
- **How it was proven real:** run for real against this very repo, not
  staged. It genuinely found 8 real cases of exactly that drift — PRs
  that had merged after their write-up but before anyone went back and
  updated the text — and they were fixed as a direct result.

**Walking through it, concretely** — someone asks "is everything passing,
and are the docs up to date?":

1. Claude Code runs `npm run typecheck`, `npm run lint`, `npm test` and
   reports: typecheck clean, lint clean, tests 270/271 (1 pre-existing,
   already-confirmed-unrelated failure).
2. It greps PLAN.md/CHANGELOG.md for every PR link, checks each one's
   real state via `gh pr view`, and compares that against what the
   nearby doc text actually claims.
3. It reports, plainly: "PR #51 is described as 'open, awaiting review'
   in PLAN.md, but it's actually merged — worth updating." Or, just as
   often and just as valid an outcome: "No drift found — the docs match
   reality."

- [x] **Built as a genuinely separate companion skill, `deliveryos-status`**
      — not a new step bolted onto `deliveryos-check-first`. Their trigger
      moments don't overlap (check-first fires on "build me X"; status
      fires on "what's the status") and Claude Code's own skill
      auto-invocation matches a request's phrasing against the skill's
      `description` field, so blending both into one description would
      weaken auto-triggering for both. Runs the same three commands this
      session ran separately (`npm run typecheck`, `npm run lint`,
      `npm test`) and summarizes pass/fail in one answer, surfacing real
      failure output rather than a bare badge.
- [x] **The doc-sync check, taught as judgment, not a hardcoded parser**:
      grep both files for the real PR-URL pattern
      (`https://github\.com/[^)]+/pull/[0-9]+`, grep-verified against this
      repo's own docs), dedupe, `gh pr view <url> --json state,mergedAt`
      for real state, then read each mention's surrounding text and judge
      in plain reading comprehension whether it claims merged/open/closed
      — deliberately not keyword-matching, since real phrasing varies
      ("merged," "landed," "open, awaiting review, not yet merged" all
      appear in this repo's own history). Handles the real edge cases
      explicitly: a genuinely `CLOSED` (never merged) PR isn't drift
      against doc text that also says closed; a `gh pr view` failure
      reports "state unknown," never a silent skip or an assumed
      mismatch; owner/repo is always resolved from the URL itself, since
      this repo's own docs link PRs on both `growtharc-ai-helpers` and
      DeliveryOS's own repo.
- [x] **Confirmed: no new engine code.** Every check is an existing
      CLI/`gh` call; nothing in `src/` changed for this phase.
- [x] **Decided explicitly**: stays a request-triggered snapshot, never a
      persistent/self-refreshing status page. Every underlying check is
      already fast and stateless — a persistent page would mean building
      real new infrastructure (a server, a poll schedule, staleness
      handling) to solve a problem a ~30-second on-demand run already
      fully solves, directly against this phase's own stated goal.
      **Real dogfooding, not just written and left untested**: pushed as
      `deliveryos-status` (`kind: skill`) via the actual
      `deliveryos push --new` CLI, opened as
      [PR #56](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/56)
      on `ai-helpers` (merged). Pulled back through the
      real packaged sidecar exe into the same global skills directory
      `deliveryos-check-first` already lives in
      (`~/.claude/skills/deliveryos-status`), confirming it lands where
      Claude Code actually reads skills from.
      **A genuine run-through of the skill's own instructions against
      this real repo, not a staged demo**: typecheck/lint/test all ran
      for real (270 passed, 1 pre-existing unrelated failure — the same
      one this whole session has confirmed unrelated). The doc-sync check
      found **7 real, genuine drift cases**, none manufactured: 3 in
      PLAN.md and 4 in CHANGELOG.md, all the same shape (PR #4/#50/#51/#54
      still described as "open, awaiting review" / "not yet merged" long
      after they'd actually merged) — exactly the class of bug this phase
      exists to catch, caught for real by literally following the skill's
      own written instructions, then fixed. Re-ran the check afterward to
      confirm zero remaining drift in either file.

## Phase 10 — Claude Code wired directly into the DeliveryOS app UI — **Complete (items 1, 2, and 3 all done)**

Goal: pressing **Pull** on a `backend-plugin` artifact in the app itself
triggers check → pull → wire → test automatically, and Scan/Add New
auto-fill their fields (description, tags, and — concretely useful, not
speculative — `install_params`, by reading the code for `process.env.X`
usage) instead of a person typing them in by hand.

Full background in
[docs/product-roadmap-vision.md](docs/product-roadmap-vision.md) ("A
bigger, later step — wiring this directly into the app UI") — this phase
turns that brainstorm into scoped tasks, same discipline every earlier
phase here uses.

**Note on sequencing, not a blocker, stated as directly as Phase 7/8/9's
own notes were:** this is explicitly gated on Phase 8's simpler,
ask-first version actually being tried for real first — building the
in-app version before anyone's confirmed the CLI version even helps would
repeat the exact mistake Tier 0 already flagged twice this session, just
at a bigger scale. Recorded here because it was asked for directly, not
because that gate has been satisfied.

**In short:**

- **Why this phase exists:** Phase 8 made "check first" something you ask
  Claude Code for in conversation. This phase asks: could the app itself
  do the mechanical half automatically, the moment someone clicks
  **Pull**, instead of needing a conversation at all? And separately —
  could Scan/Add New fill in an artifact's own config fields by actually
  reading the code, instead of a person typing them in by hand?
- **What got built (items 1 and 3):**
  1. **Deterministic apply-and-test on Pull** — the app applies a
     backend-plugin's mechanical wiring itself (only ever a genuinely
     fresh file; anything that already exists is left alone, even when a
     merge-guidance snippet is offered) and runs the project's real
     build, reporting pass/fail right in the existing Pull/Push progress
     log. No AI involved in this half at all — it's exactly the same
     deterministic mechanism Phase 7's wiring agent already proved, just
     triggered by a click instead of a person copying a snippet.
  2. **Auto-filling Add New's `install_params`, `stacks`, `description`,
     and `owner` from real code analysis — for every kind, not just
     backend-plugin.** When proposing a NEW artifact, the app reads the
     actual payload for real, mechanical facts: `process.env.X`/Prisma
     `env("X")` usage (→ `install_params`), real `import`/`require`
     specifiers and `package.json` dependencies against a small known-
     package table (→ `stacks`, e.g. `next`→`nextjs`, `@prisma/client`→
     `prisma`), a real JSDoc comment already parsed by the docgen step for
     `ui-component` (previously extracted and then silently discarded — a
     genuine bug fix, not new detection), real frontmatter for the four
     markdown kinds, and a leading block comment for anything else — all
     falling back to blank rather than ever inventing text. `owner`
     defaults from the local machine's real git identity
     (`git config user.name`), not a guess. Every field stays freely
     editable/removable before proposing, same as `install_params` always
     was. `componentTypes` and `roles`/`teams` are not guessed
     *mechanically* — see the next bullet for how `componentTypes`'
     gap actually got closed instead.
  3. **"Suggest with Claude" — real judgment for the two fields static
     analysis honestly can't fill.** Built after direct feedback that
     mechanical detection alone left too much blank on components with no
     JSDoc/env-var signal (`description`, `componentTypes`) — the first
     AI-invoking capability in Add New's autofill; everything above is
     regex/AST only. An explicit "Suggest with Claude ✨" button (never
     automatic — costs real latency and a real API call) on the
     Description step shells out to a real `claude -p` subprocess with
     the payload's own source piped to it via stdin, asking for strict
     JSON (`{description, componentTypes}`); a second button on the
     Component Type step re-runs (or reuses the cached result from) the
     same call. Both fields stay fully editable, same as every other
     autofilled field. **`roles`/`teams` are still not touched even by
     this** — they're organization-internal concepts (who owns this,
     which team) that aren't recoverable from the code by a model any
     more than by a regex; an LLM guessing an org's team names would just
     sound more confident while being equally made up.
     **Two real, tested findings that shaped how this actually got
     built, not assumed:**
     - **The tool-restriction flags are not a hard sandbox.** `--bare`
       (used in item 2's own settled design) breaks authentication
       outright here — it skips keychain reads, so a nested invocation
       can't find real credentials (confirmed via a real failed call:
       "Not logged in"). Dropped it. Worse: `--allowedTools ''` did
       nothing at all in real testing (a call given zero allowed tools
       still ran a real Bash command), and `--disallowedTools` naming
       every real tool explicitly blocked it on 2 of 3 real attempts but
       let it through on the third. This is accepted as a known,
       stated limitation rather than a solved one — DeliveryOS's own
       engine already runs arbitrary trusted shell commands on this same
       machine under the same user (`verifyBuild.ts`, real `git`
       pushes), so this doesn't introduce a new class of risk, but it
       means item 2's own "CLI-enforced tool restriction" framing needs
       revisiting whenever that item is actually built.
     - **A real Windows command-injection bug, found and fixed, not
       shipped.** A global npm install of `claude` is a `.cmd` shim on
       Windows, not a raw `.exe` — `execFileSync('claude', ...)` fails
       with `ENOENT` without `shell: true` (and `execFileSync('claude.cmd', ...)`
       fails a different way, `EINVAL`, confirming this isn't a name
       issue). But `shell: true` means argv gets concatenated into a
       shell command line unescaped — putting the arbitrary,
       payload-derived prompt text directly in argv would have been a
       real command-injection hole (a component file containing a stray
       `&`/`"`/`^` could break out into an arbitrary second command).
       Fixed by never putting the prompt in argv at all: it's piped to
       the child's stdin via the `input` option instead (confirmed
       empirically that `claude -p` reads from stdin when piped) — only
       fixed, hardcoded flag strings this code controls ever pass
       through the shell-concatenated argv.
     New `src/engine/scan/suggestMetadata.ts`
     (`buildSuggestionPrompt`/`parseSuggestionResponse` kept pure and
     unit-tested directly; the real subprocess call itself verified by
     manual dogfood, not an automated test spawning a real `claude`
     process each run). New `artifact.suggestMetadata` sidecar command.
     **Real, unstaged verification**: ran it against a real sign-in
     form component with zero JSDoc/frontmatter signal — returned "A
     sign-in form component that collects email and password input and
     calls a submit handler with the entered credentials." and
     `componentTypes: ["form"]`, both genuinely accurate and in the
     real catalog's own tag style. Also verified the failure path
     cleanly (simulated `claude` missing from PATH → a real,
     non-crashing `SuggestionError`, not a hang or a crash). 10 new unit
     tests.
     **Four fixes from a later top-to-bottom code review, same day**:
     (1) the subprocess call was originally `execFileSync` (blocking) --
     converted to real async `execFile`, writing the prompt to the
     child's own stdin by hand (the async form has no `input`
     convenience option the sync ones do). Proved the fix for real: fired
     a slow suggestion call and a fast, unrelated `remote.list` call at
     the same running sidecar 200ms apart -- the fast one answered at
     1.6s while the slow one was still running until 9.7s, confirming the
     whole process no longer freezes during a live AI call.
     (2) the embedded payload source (real code, possibly not the
     proposer's own) is now wrapped in explicit
     `<UNTRUSTED_SOURCE>`/`</UNTRUSTED_SOURCE>` delimiters with an
     instruction to treat it as inert data, never instructions --
     mitigates prompt injection, though it's not a substitute for the
     tool-restriction flags actually holding (they don't, reliably --
     see item 2's own corrected note above).
     (3) the Component Type button was silently overwriting an
     already-edited Description (one shared handler touched both fields
     regardless of which button fired it) -- each button now only
     touches the field(s) it's actually associated with.
     (4) the suggestion cache was keyed only by payload path, missing a
     kind change made via Review's own Edit links -- now keyed by
     (payload path, kind) together.
- **Item 2, now built too — "want help fixing this?" on a real build
  failure.** The original unrestricted-`--allowedTools` plan was dropped
  once this project proved that flag unreliable; redesigned so the
  subprocess needs no tool access at all (it gets the failing file's
  content + the real build error, returns strict JSON, and the app
  itself does every write) — see the item's own checklist entry below
  for the full design and real verification. Explicit go-ahead was given
  directly in chat before any of this was built, same as every other
  AI-invoking piece this phase.
- **A real, honest limitation found while proving item 3 for real**:
  running the `install_params` detection against the actual, already-
  shipped `nextauth-credentials` artifact finds *nothing*, because
  `AUTH_SECRET`/`AUTH_URL` are read implicitly by Auth.js's own library
  internals and `DATABASE_URL` lives in the consuming project's own
  schema file, not this payload's source. Pure static analysis can't see
  either — a real, structural boundary, not a bug to paper over.

**Walking through it, concretely:**

*Pulling an existing artifact (real, verified — not a mock):*
1. Someone clicks **Pull** on `nextauth-credentials` in the app.
2. The app pulls it, applies the wiring automatically, and runs the
   target project's real build — all visible in the existing progress
   log, no terminal needed. This was run for real, against the actual
   signed artifact, into a genuinely fresh Next.js project: all 3
   fresh-file actions applied correctly, the one file that already
   existed (`layout.tsx`) was correctly left alone, and the real
   `next build` passed.
3. If the build fails instead, the app now offers "want help fixing
   this?" for whichever file(s) the same pull just auto-wired — real,
   verified: reproduced the exact real bug this project hit before
   (`export { GET, POST } from '@/auth'`) plus a self-contained typo bug,
   both through the rebuilt packaged sidecar exe. Reviewing and clicking
   Apply writes the real fix, re-runs the real build to confirm it
   actually passes, and logs the attempt; a fix that doesn't actually
   work gets rolled back automatically, confirmed by forcing that case
   for real and watching the original file come back byte-for-byte.

*Proposing a brand-new artifact (a genuinely separate flow, no Pull
involved, real for every kind — verified against the real rebuilt
packaged sidecar exe, not just tests):*
1. Someone opens Add New, picks a kind, and picks a payload — a
   ui-component with a real JSDoc comment on it, a skill folder with a
   real `SKILL.md`, or a freeform backend-shaped payload.
2. The moment the payload is picked, the app scans it for real signals:
   a ui-component's JSDoc comment (verified: a component with `/** A
   small counter widget shown on the dashboard. */` above it produced
   exactly that as the pre-filled description), a skill's real
   frontmatter (verified: a real `description:` field in `SKILL.md`
   came through unchanged), a backend payload's leading comment plus its
   real `@prisma/client` import and `process.env.AUTH_SECRET` reference
   (verified: produced `stacks: [prisma, typescript]` and a real
   `AUTH_SECRET` install_param, both correct). The Owner field defaults
   from the real local git identity (verified: `ashwin-growtharc`,
   exactly matching this machine's own `git config user.name`).
3. Everything stays editable. A payload with none of these signals (no
   comment, no matching imports, no env vars) leaves those fields blank
   rather than fabricating anything — verified directly: a plain
   payload with no signals produced `stacks: [typescript]` (a real fact,
   the file extension) and no `description` key at all, not an invented
   one.
4. If Description/Component type are still blank because there's
   genuinely nothing mechanical to find, an explicit "Suggest with
   Claude ✨" button offers real judgment instead — verified for real: a
   sign-in form component with no JSDoc at all got back "A sign-in form
   component that collects email and password input and calls a submit
   handler with the entered credentials." and `componentTypes: ["form"]`
   from a live `claude` call, both accurate. Still just a suggestion —
   editable/overwritable before Propose, same as everything else here.

- [x] **Deterministic apply-and-test on Pull, no agent involved yet.** Done.
      New `applyDeterministicWiring` (`src/engine/pull/applyWiring.ts`) —
      auto-writes ONLY the genuinely safe case: a resolved wiring action
      where the target file doesn't exist yet (`whenAbsent`, which the
      schema itself requires to declare a complete, verbatim snippet).
      Anything that already exists is left completely untouched, even
      when a `whenPresent.snippet` is offered — that snippet is merge
      GUIDANCE for a person (e.g. "wrap `{children}` in
      `<SessionProvider>`"), not the file's own full content; overwriting
      a real, existing file with just that fragment would destroy the
      rest of it. New `detectBuildCommand`/`runProjectBuild`
      (`src/engine/pull/verifyBuild.ts`) — the smallest real heuristic
      matching this project's own proven target ecosystem: a
      `package.json` with a `"build"` script means `npm run build`;
      anything else reports `ran: false`, not an error (a project with no
      detectable build command is a normal outcome). New
      `pullAndAutoWire` (`src/engine/pull/pullAndAutoWire.ts`) — a
      genuinely SEPARATE orchestration function, not a change to
      `pullArtifact` itself: the CLI's `deliveryos pull` and every
      existing test keep using the plain function, exactly as Phase 7
      left it (Tier 2 never auto-applied by default). New sidecar command
      `artifact.pullAndAutoWire`; the app's own Pull action
      (`runArtifactAction` in `app.js`) opts into it only for artifacts
      that actually declare `wiring_actions` — every other artifact (the
      overwhelming majority) keeps calling the plain `artifact.pull`,
      unchanged, same "gate on field presence" convention every earlier
      Phase 7/8 piece already used. New `'wiring'`/`'build'` progress
      stages surface through the app's existing progress-log UI, no new
      UI surface built for this half.
      **Real, unstaged verification**: pulled the real, signed
      `nextauth-credentials` artifact into a genuinely fresh Next.js
      project via the real rebuilt packaged sidecar exe's new
      `artifact.pullAndAutoWire` command. All 3 fresh-file wiring actions
      (`src/auth.ts`, `src/middleware.ts`, the API route) were applied
      automatically and correctly; `src/app/layout.tsx` (which
      `create-next-app` already generates) was correctly left in
      `needsReview`, genuinely untouched — confirmed on disk, not just
      from the returned result. The real project's own `next build` then
      ran automatically and passed, with zero manual wiring by a person
      at any point. 5 new unit tests (`applyWiring.test.ts`) + 7 new unit
      tests (`verifyBuild.test.ts`, including two that actually run a
      real passing and a real failing build command, not mocked) + 1 new
      sidecar e2e test proving the mixed applied/needs-review/build-result
      shape end to end.
      **Security fix, found in a later top-to-bottom code review and
      fixed the same day**: `applyDeterministicWiring` originally resolved
      `target_file` via plain `path.resolve(cwd, targetFile)` with no
      containment check before writing to it — a manifest declaring
      `target_file: "../../../../evil.txt"` (or an absolute path)
      genuinely escapes the project entirely, proved directly (and via a
      test temporarily run against the pre-fix code, confirmed to
      actually write the file outside the project, before the fix was
      restored). Fixed with a new `resolveContainedTargetFile`
      (`src/engine/pull/wiring.ts`), used by both the read-only resolver
      (which had the identical unguarded pattern) and, as an independent
      second layer, the actual write site itself. An escaping target is
      now refused and reported as needing manual review, never silently
      applied. 8 new unit tests.
      **A second fix from the same review**: `runProjectBuild` used
      blocking `execSync`, freezing the entire single-process sidecar
      (and every other in-flight/new command) for the build's whole
      duration. Converted to real async (`exec`, promisified) — see
      item 3's own "Suggest with Claude" entry below for the matching fix
      to `suggestMetadata` and the real concurrency proof that covers
      both.
- [x] **"Want help fixing this?" — an explicit escalation step on
      failure, not an automatic one.** Offered only after Pull's own
      build verification (item 1) actually fails, never fired
      unsupervised the instant Pull is clicked.
      **The original plan (unrestricted `--allowedTools "Bash,Read,Edit"`,
      gated on that flag actually enforcing a boundary) was dropped, not
      built** — this project already proved that enforcement unreliable
      (`--allowedTools ''` still let a real Bash call run;
      `--disallowedTools` blocked it 2 of 3 real attempts, not 3 of 3).
      **Redesigned to not need that mechanism to be safe at all**, and
      this is the design that actually got built:
      - The subprocess gets **no tool access whatsoever** — not
        restricted, granted none. It receives exactly two things: the
        failing file's real content and the real build error text, both
        delimited the same way item 3's `<UNTRUSTED_SOURCE>` wrapping
        already does (new `<UNTRUSTED_FILE_CONTENT>`/
        `<UNTRUSTED_BUILD_ERROR>` blocks, `buildFixPrompt` in the new
        `src/engine/pull/fixBuildFailure.ts`).
      - It responds with strict JSON only — `{"fixed_file": "<complete
        corrected file>"}` or `{"fixed_file": null, "reason": "..."}` —
        never a diff, never prose (`parseFixResponse`).
      - **The app itself writes the fix**, through a real file write
        (`applyBuildFix`) re-validated for containment the same way
        `applyDeterministicWiring` already is — the model never touches
        disk or runs a command, so there's nothing for a tool-restriction
        flag to need to hold in the first place.
      - **Scoped to only the files item 1's own auto-wiring just wrote**
        (`AppliedWiringResult.applied`) — never an arbitrary file guessed
        from build-error text, which would require unreliably inferring
        the guilty file from free-text output, exactly the kind of
        guessing this project has consistently refused to do elsewhere.
      - **Re-verifies for real after writing**: re-runs the target
        project's real build (`runProjectBuild`, already built for item
        1) to confirm the fix actually worked, not just that a
        plausible-looking file came back. **If the rebuild still fails,
        the original file is restored immediately** (auto-rollback) —
        leaving a broken write in place just because a fix was
        *attempted* would leave the project worse than the original
        failure, a real regression, not a neutral outcome.
      - **A human still confirms before anything is applied** — the
        proposed content is shown for review (reusing the exact
        `.wiring-action-snippet` display Tier-2 wiring cards already use,
        no new "how DeliveryOS shows code" convention) with explicit
        Apply/Discard buttons; nothing is written on Discard.
      - **A new audit trail** (`.deliveryos/build-fix-log.jsonl`,
        `buildFixLogPath` in `paths.ts` — the first append-only log file
        anywhere in this codebase, confirmed no prior convention existed
        to extend): one entry per fix actually *applied* (never on a
        request or a discard, which leave no trace by design), recording
        the real before/after content, real cost/duration pulled from
        `claude`'s own `--output-format json` envelope, and whether it
        was kept or rolled back.
      - Extracted the shared subprocess-invocation logic
        (`src/engine/claude/runClaudeSubprocess.ts`) out of item 3's
        `suggestMetadata.ts` rather than duplicating it a second time —
        it encodes two hard-won, real Windows-specific fixes (the
        `.cmd`/`shell:true` `ENOENT`/`EINVAL` issue, and piping the
        prompt via stdin instead of argv to avoid command injection); two
        independent copies would be a real drift risk for
        security-sensitive code. Deliberately still has no `cwd` option —
        a leaked tool call (it has leaked, empirically) runs wherever the
        sidecar itself lives, never inside the user's real project.
      **Real, unstaged verification, not just unit tests**: reproduced
      the actual historical `auth.ts` bug this project hit before
      (`export { GET, POST } from '@/auth'` →
      `Export GET doesn't exist in target module`) in a fresh scratch
      project through the rebuilt packaged sidecar exe. Genuinely
      interesting, honest finding along the way: asked twice with only
      the file+error (no other context), the model correctly said it
      couldn't determine the fix both times, rather than guess — a real,
      appropriate "I don't know" outcome, not a shortcoming. Switched to
      a self-contained bug fully determinable from the file+error alone
      (a typo'd import, `'react-domm'`) and verified the complete real
      pipeline end to end: request → correct proposed fix → apply →
      real `npm run build` passes → audit log has the exact right entry.
      Then forced a fix that doesn't actually work and confirmed the
      rollback path for real: the original file was restored byte-for-
      byte on disk, and the audit log's second entry correctly recorded
      `rolledBack: true`. 18 new unit tests
      (`fixBuildFailure.test.ts`), including a real rollback test and a
      real path-traversal-refusal test (nothing written outside a
      throwaway trap root, matching the discipline already established
      when the item 1 traversal bug was fixed).
- [x] **Auto-fill Scan/Add New's own fields from real code analysis.**
      Shipped in two passes: first scoped specifically to `install_params`
      (the concrete, closable gap this item originally named), then
      extended — after direct feedback that autofill should cover more
      than one field and not read as backend-plugin-only — to `stacks`,
      `description`, and `owner`, for every kind, not just
      backend-plugin-shaped payloads. Every signal added is still a real,
      mechanical fact read straight from the payload/environment, never a
      generated guess:
      - `install_params`: New `detectInstallParams`
        (`src/engine/scan/detectInstallParams.ts`) — walks a payload's
        real source for actual `process.env.X` **and** Prisma's own
        `env("X")` schema syntax (a real, distinct convention, added
        after finding it mattered — see below), proposing
        key/secret-guess/required for each. `required` defaults `true`
        (a plain regex can't reliably tell whether a call site has its
        own fallback; wrong-in-the-safe-direction beats silently marking
        something optional that the code actually needs); `description`
        is deliberately left blank, for a person to fill in themselves.
      - `stacks`: new `detectStacks`
        (`src/engine/scan/detectStacks.ts`) — real `import`/`require`
        specifiers and `package.json` dependencies against a small,
        already-verified-against-the-real-catalog lookup table
        (`next`→`nextjs`, `react`→`react`, `@prisma/client`/a `.prisma`
        file→`prisma`, `express`→`express`), plus real file extensions
        present (`.ts`/`.tsx`→`typescript`, else `.js`/`.jsx`→
        `javascript`). Never invents a tag string not already in real use.
      - `description`: for `ui-component`, wires through
        `ComponentDoc.description` — `react-docgen-typescript`'s own
        parse of a real JSDoc comment directly above the component, which
        was already being computed and then silently discarded
        (`detectUiComponents.ts` previously hardcoded `undefined` with a
        comment claiming no reliable signal existed — that was stale; the
        real, author-written text was sitting right there unused, a
        genuine bug fix as much as new detection). For the four markdown
        kinds, reuses the existing `guessDescriptionFromFrontmatter`,
        now also available from Add New's own manual payload-pick path
        (previously wired into the Scan path only). For everything else,
        a new `extractLeadingComment`
        (`src/engine/scan/extractLeadingComment.ts`) reads a real leading
        block/line comment off a payload's conventional entry file
        (`index.*`/`main.*`), returning nothing if none exists — never a
        fallback to some arbitrary file's comment. A new orchestrator,
        `detectArtifactMetadata` (`src/engine/scan/detectArtifactMetadata.ts`),
        picks the right source per kind and combines all three signals
        into one result.
      - `owner`: defaults from the local machine's real git identity
        (`git config user.name`, via the already-existing
        `getCommitIdentity` in `src/engine/git/git.ts`, exposed through a
        new `git.identity` sidecar command) — confirmed to exactly match
        the convention already used in every real shipped manifest
        (`owner: ashwin-growtharc`, not an email or a display name).
      **Deliberately still not attempted**: `componentTypes`
      (button/badge/effect/animation/...) and `roles`/`teams`. Checked
      real catalog values and concluded there's no equally reliable code
      signal for either — they require a semantic judgment about what a
      component *is* or who owns it, not a fact a regex or import scan
      can safely make. Guessing wrong there silently would repeat exactly
      the failure mode `scan.ts`'s own doc comment already warned against
      for `roles`/`teams` — left manual, on purpose, not a gap that was
      missed.
      The single sidecar command changed from `artifact.detectInstallParams`
      to `artifact.detectMetadata(payloadPath, kind)`, called from the
      same `pickPayload` moment as before; the Add New wizard's
      `install-params` step, stacks tag picker, and description field are
      all pre-filled together, with description/owner only ever filling
      an empty field (never clobbering something already typed).
      **Real, unstaged verification against the actual rebuilt packaged
      sidecar exe** (not just unit tests): ran `artifact.detectMetadata`
      against four real fixtures — a ui-component with a real JSDoc
      comment (`"A small counter widget shown on the dashboard."` came
      back verbatim), a skill folder with a real `SKILL.md` frontmatter
      description, a backend-shaped payload with a real leading comment
      plus a real `@prisma/client` import and `process.env.AUTH_SECRET`
      reference (`stacks: [prisma, typescript]`, one real install_param,
      both correct), and a plain payload with none of these signals
      (`stacks: [typescript]` only, no description key at all — honest,
      not fabricated). `git.identity` returned this machine's real
      `ashwin-growtharc` / `ashwin.b@growtharc.com`. 13 new unit tests
      (`detectStacks.test.ts`, `extractLeadingComment.test.ts`), 7 new
      unit tests (`detectArtifactMetadata.test.ts`), plus a new
      `detectUiComponents.test.ts` case proving the `doc.description`
      wiring.
      **A real, honest limitation, found by running the original
      `install_params` detection against the actual shipped
      `nextauth-credentials` artifact, not hidden**: it detects
      **nothing** there. `AUTH_SECRET`/`AUTH_URL` are read
      implicitly by Auth.js's own internal library code, never referenced
      in this artifact's own payload source at all; `DATABASE_URL` lives
      in the CONSUMING project's own `prisma/schema.prisma` (Tier 3,
      deliberately never part of this payload), not the
      `prisma-schema-snippet.prisma` reference file this payload actually
      ships. Pure static analysis over a payload's own text genuinely
      cannot see either of these — a real, structural limit of what this
      mechanism can catch, stated plainly rather than papered over. It
      still does exactly what it was built for: an artifact whose own
      payload code contains real, explicit env-var references. 10 new
      unit tests (`detectInstallParams.test.ts`), 2 new push e2e tests
      (a real `installParams` option landing in a real committed
      manifest, and confirming omitting it entirely is zero regression).
      **Frontend verification note**: the new wizard step was checked for
      syntax validity and structural consistency with every existing
      step's own convention, not re-verified via a full interactive
      browser click-through this round — a deliberate scope call (see
      the standing "avoid heavy GUI simulation" guidance), not an
      oversight.
      **Two more fixes from the later top-to-bottom review**: bracket
      notation (`process.env['X']`) was invisible to the original
      dot-notation-only regex — real, valid, sometimes-seen syntax, now
      detected too, deduped against the dot-notation form. And the
      recursive "list every source file, skip node_modules/dotfiles" walk
      — copy-pasted near-verbatim across this file, `detectStacks.ts`,
      `detectArtifactMetadata.ts`, and `suggestMetadata.ts` — is now one
      shared `listFilesRecursively` (`src/engine/scan/listFiles.ts`).
**Phase 10 is now complete.** Item 2 (above) was the one piece that
genuinely needed a separate, explicit go-ahead beyond items 1/3's own —
a real Claude Code subprocess invoked from a GUI button is a materially
different risk than a terminal conversation someone is actively
watching. That go-ahead was given directly, in chat, and the redesign it
was given for (no tool access, app writes the fix, human confirms, real
rebuild verification with auto-rollback) is what actually got built —
not the original unrestricted-`--allowedTools` plan, which this project
had already found doesn't hold up.

## Phase 11 — A design-kit bundle, plus a design-quality check — **Not started, brainstormed only**

Goal: a real design-kit (five components + a guideline doc covering
approved patterns, anti-patterns, layout rules, and voice/tone) can be
pulled as one bundle into a fresh project, and after Claude Code builds UI
from it, a design-quality check runs — mechanical anti-pattern detection
first, an explicit AI-judgment ask for the subjective cases, a proposed fix
a person confirms before it lands — reusing Phase 10's exact
apply→verify→offer-to-fix shape, pointed at design quality instead of
build correctness.

Full background in
[docs/product-roadmap-vision.md](docs/product-roadmap-vision.md) ("A
design-kit bundle" section) — this phase turns that brainstorm into scoped
tasks, same discipline every earlier phase here uses.

**Two things corrected by research before this got scoped, not assumed:**

1. **The real app's own frontend can't be the source material.**
   `src-tauri/spike-ui/app.js` is confirmed vanilla JS — its own header
   comment says so directly ("vanilla JS, single-page, no framework"), and
   it's built from 60+ raw `document.createElement()` calls, not JSX. The
   existing `kind: ui-component` pipeline (`detectUiComponents.ts`,
   docgen) hard-requires `.tsx`/`.jsx`. On reflection this was pointing at
   the wrong source anyway — the Tauri shell is desktop-app chrome, not
   representative of the real Next.js/React stack client engagements
   actually use (the same stack Phase 7 already confirmed). **The real
   target instead: five components (Button, TopBar, Card, Feedback,
   Input) authored fresh as real React/TSX, styled from
   [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md)'s actual tokens** — proven
   through the same unmodified `kind: ui-component` pipeline
   `expanding-tabs`/`magic-container` already use.
2. **Ship it as one `kind: template` bundle, not five separate
   `kind: ui-component` entries.** Five separate artifacts pulled together
   would quietly reintroduce the exact unsolved problem named elsewhere in
   the roadmap doc — independent artifacts with no mechanism to resolve
   conflicts between them. One `kind: template` bundle (the same
   whole-directory, Pull-only mechanism `arcos-cli`/`launchpad-template`
   already proved) sidesteps it entirely — one pull, no multi-artifact
   wiring needed. Individual components stay live-previewable anyway:
   `compileLocalPreview` (Phase 6, Phase D) already proves preview works
   straight off a local payload directory, no separate catalog entry
   required.

- [x] **Author the real target and pick the guideline doc's real content**
      — five components (Button, Card, TopBar, Feedback, Input), styled
      from DESIGN_SYSTEM.md's real tokens. **Light values only, not "both
      light and dark" as originally written here** — this repo's own real
      design system is confirmed light-only (see the dark-mode preview
      contrast fix earlier in Phase 6); there is no dark palette anywhere
      to match, so a dark variant would have been invented, not sourced.
      Guideline doc (`GUIDELINES.md`) covers: color tokens (including
      status colors and the radius/spacing scale, neither of which
      DESIGN_SYSTEM.md's own markdown documents — recovered from the app
      shell's real `style.css` `:root` and written down for reuse for the
      first time), type scale, a layout-grid note, per-component
      placement/usage rules, a concrete anti-patterns list, and a
      voice/tone note. Pushed as one `kind: template` bundle via the
      existing, unmodified `push --new` path — real PR opened:
      [growtharc-ai-helpers#57](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/57).
      **Payload folder structure, corrected from this task's original
      "fully flat, no subfolders at all" phrasing**: `findPreviewEntryFile`
      looks for a fixed `preview.tsx` filename in ONE directory, so five
      components genuinely sharing one flat `components/` directory would
      collide on that filename — confirmed by direct investigation of
      `docgen.ts`/`resolveArtifactPreview.ts` before writing anything.
      Landed on one subdirectory per component
      (`components/Button/{Button.tsx,preview.tsx}`, etc.) under a shared
      `components/` parent — still "flat" in the sense this task actually
      cared about (no premature *category* grouping like `forms/`
      unifying unrelated components), just not literally flat files. The
      rule for when a category folder IS warranted is written into
      `GUIDELINES.md` itself: only once 3+ genuinely related components
      exist that would otherwise clutter the list (e.g. `Input`/`Select`/
      `Checkbox` → `forms/`); a single component never gets a folder just
      to avoid looking loose.
      **A real bug found and fixed while authoring `Input`'s preview**: a
      CSF variant function is called directly as a plain JS function, not
      rendered through React (`docs/ui-components-feature-design.md`'s
      own Phase C correction) — calling `useState()` inside the variant
      function itself is a genuine rules-of-hooks violation (no active
      render pass, no dispatcher active yet), confirmed by hand: it threw
      `Cannot read properties of null (reading 'useState')` the instant
      the variant was selected, with an otherwise-blank preview and zero
      console errors (the harness's own try/catch swallows it into a
      `postMessage`, not a thrown/visible error) — caught only by
      actually rendering the compiled output in a real browser, not by
      the text-based dogfood check alone, which had already passed.
      Fixed by moving the `useState` call into a real component the
      variant merely returns an element for (mirroring the proven
      `Signin1` pattern), never inline in the variant function itself.
      Verified for real: `compileLocalPreview` against all 5 components
      (props schemas + expected token hex values all present), then each
      one actually rendered and interacted with in a real browser
      (typing into `Input`, switching its variants) before pushing.
- [x] **The mechanical anti-pattern detector — start with one narrow,
      real rule, not a vague general one.** `detectUiComponents.ts`/
      `docgen.ts` only ever call `react-docgen-typescript` as a black
      box (confirmed by grepping all of `src/engine` for
      `ts.createSourceFile`/`JsxElement`: zero matches) — it returns
      prop docs, never a raw AST, so it couldn't be reused for this.
      `src/engine/scan/detectSelfNesting.ts` is the first code anywhere
      in this repo to `import * as ts from 'typescript'` directly and
      walk a real JSX tree. First real rule, deliberately narrow rather
      than "detect all nested cards" (legitimate nesting exists — a stat
      card inside a dashboard card is fine, confirmed with a real
      dogfood fixture that correctly produces no warning): flags a
      component whose JSX renders itself nested exactly two levels deep
      (`<A><A/></A>`) — clarified directly with the user, since this
      task's own original phrasing ("nested directly inside itself, two
      or more levels deep") was ambiguous between this and flagging any
      self-nest at all. A single self-nest (one `<A/>` inside A's own
      render, depth 1 — e.g. a real tree-node/nested-accordion
      component) is explicitly allowed and never flagged; confirmed with
      a second real dogfood fixture (`TreeNode`, legitimately recursive)
      producing no warning while a genuinely broken two-level `StatCard`
      fixture does, both through the real built detector, not just the
      isolated unit tests. Plugs into the existing, already-generic
      `ScanCandidate.warnings` array (`detectUiComponentCandidates`) —
      reaches both display surfaces (the CLI's `scan` output and the Add
      New wizard's Review-step `.hint-banner` warnings) with zero new
      plumbing, confirmed by reading both call sites before writing
      anything. 8 new tests (7 unit, against `detectSelfNestingWarnings`
      directly — including the "different component nested" and
      "multiple separate chains in one file" cases PLAN.md explicitly
      calls out; 1 integration, through the real
      `detectUiComponentCandidates` entry point). Widen the rule set
      later, once this one's false-positive rate is actually known, not
      assumed.
- [x] **"Suggest with Claude" for the subjective anti-patterns a rule
      can't catch** — reuses Phase 10 item 3's exact proven subprocess
      shape (stdin-piped prompt, strict JSON out, untrusted-source
      delimiters) via `src/engine/scan/suggestAntiPatterns.ts`; the one
      shared piece worth factoring out, `readPayloadSource`, was
      exported from `suggestMetadata.ts` rather than duplicated. Sits on
      the Add New wizard's Review step, gated identically to the live
      preview above it. **Explicit button, never automatic** — same rule
      Phase 10 already established, since it costs a real API call and
      real latency. **Two real scope decisions confirmed with the user
      before building**: the button uses the app's reserved AI-accent
      styling (`.btn-accent`, precedented by the Scan button, per
      `DESIGN_SYSTEM.md`'s "AI tones for AI-specific elements only" rule
      — the Description step's own suggest buttons don't follow this,
      confirmed to be an existing inconsistency, not a pattern to
      extend); findings render in a new `.hint-banner-ai` variant
      (`accent-500` border, not item 2's `gold-500`) so an AI judgment
      call reads visibly differently from a deterministic mechanical
      warning. The anti-patterns reference is a concise, hardcoded list
      (in the spirit of `GUIDELINES.md`'s own list, generalized beyond
      the five design-kit components) applied to any `kind: ui-component`
      candidate under review, not gated on the design-kit being pulled
      locally.
      **Verified with a real `claude -p` call, not mocked**: a planted
      `ConfirmDialog` fixture (a red "Delete" button next to a
      barely-visible, low-opacity "cancel") correctly produced two real
      findings — the intended low-contrast-cancel-next-to-destructive
      issue, PLUS a genuine, unplanted bonus finding (an 8px/6px
      border-radius inconsistency actually present in the fixture); a
      clean `CleanCard` fixture correctly produced `[]`, not an invented
      issue. 13 new unit tests mirroring `suggestMetadata.test.ts`'s
      exact shapes (prompt-injection delimiter check, malformed-JSON
      handling, empty-array-is-valid).
- [x] **The fix step reuses Phase 10 item 2's exact approved design** — no
      tool access, strict JSON in/out, the app applies the fix through its
      own existing write path (`src/engine/scan/fixAntiPattern.ts`,
      structurally mirroring `fixBuildFailure.ts`), a human confirms
      before it lands (the same real two-click ask → preview → Apply/
      Discard flow, per-finding rows on the Review step), a real check
      verifies it, auto-rollback if it doesn't actually work. **Two real
      gaps in "nothing new to design here," resolved with the user
      first**: neither item 2's mechanical warnings nor item 3's AI
      findings say which FILE a finding is about (confirmed by reading
      both) — resolved by extending the fix prompt itself to ask which
      file needs the change, then re-validating that file resolves
      safely inside the candidate's own payload directory (reusing
      `resolveContainedTargetFile`, already fully generic, rooted at the
      payload instead of a real project's `cwd` — zero new
      path-traversal logic needed) before writing anything, never
      trusting the model's own answer blindly. And unlike a real
      project, this candidate has no build command to re-run for
      verification — `compileLocalPreview` (confirmed to always
      recompile fresh from disk, never cached, and to genuinely throw on
      a real syntax/bundle error) stands in for "a real rebuild," with
      the same honest caveat `runProjectBuild` already has: it verifies
      "does it still compile," not "is the anti-pattern actually gone."
      Its own audit log, `.deliveryos/design-fix-log.jsonl` (kept
      separate from `build-fix-log.jsonl` rather than shared, so neither
      needs a discriminant field) — a real edit to a real file on disk
      either way, same standard regardless of whether the target's been
      pushed yet.
      **Verified with a real, full request→apply cycle, not mocked**:
      run against the real `ConfirmDialog` fixture from item 3 (the
      low-contrast-cancel-next-to-destructive finding) — correctly named
      `ConfirmDialog.tsx` as the target, and the real fix gave Cancel a
      visible border, full opacity, matching font-weight, and a readable
      size, a genuinely sensible secondary-button treatment, not just
      "didn't crash." Applied for real, verified via a real
      `compileLocalPreview` call, file on disk confirmed correct
      afterward. The rollback path (a deliberately broken fixed-file)
      is covered by a real, non-mocked unit test — a genuine esbuild
      syntax error, real rollback, file on disk confirmed restored to
      the original. 17 new unit tests mirroring
      `fixBuildFailure.test.ts`'s exact shapes, including the
      path-traversal-refusal trap-directory technique.
- [x] **Open scoping question, resolved: add empty/error/loading-state
      coverage now, not deferred.** User chose to add it to the
      already-merged bundle rather than wait for a follow-up. Resolving
      it surfaced a second real gap: motion rules were named in the same
      roadmap-doc sentence as empty/error/loading states ("easy to forget
      until it's needed") but never made it into this file's scoped task
      list at all — user chose to add both together rather than split
      them across two passes.
      **Confirmed the edit path before touching anything**: re-running
      `push --new` on `design-kit` throws `IdCollisionError` immediately
      (not viable); `push`'s edit-mode diff logic
      (`src/engine/push/push.ts`) has zero `kind`-specific branching —
      it diffs `install_target` against the pristine snapshot
      regardless of kind, so a `kind: template` artifact can be pushed
      as a real edit exactly like any other kind. The "templates are
      Pull-only" note in the `arcos-cli`/`launchpad-template` retros is
      scoped to those artifacts' own shape (a 75-file whole-repo mirror,
      where a push-back diff would be unbounded) — not a code-level
      gate, and not applicable to `design-kit`'s much smaller payload.
      **Three new components** (`EmptyState`, `ErrorState`, `Skeleton`),
      same conventions as the original five — inline
      `React.CSSProperties`, real `DESIGN_SYSTEM.md` hex tokens,
      `function X(props)` never `React.FC`, own
      `components/<Name>/{Name.tsx,preview.tsx}` subdirectory each.
      `ErrorState` reuses `EmptyState`'s exact layout with a
      danger-toned icon circle (`#FFE5E0`/`#A2341F`) instead of a
      neutral one, so the two read as visually distinct at a glance, not
      just by copy. `Skeleton` is the concrete real example the new
      Motion section points at: a `prefers-reduced-motion` override that
      disables its pulse entirely (`animation: none`), never just slows
      it, mirroring `DESIGN_SYSTEM.md`'s own Accessibility rule.
      **New `## Motion` section in `GUIDELINES.md`**, placed after
      Layout grid (a similarly foundational, token-like rule): ordinary
      hover/focus transitions at `.15s ease` (the exact value already
      live in `Button.tsx`'s hover-opacity transition), up to `.2s
      ease-out` for a larger reveal, nothing slower — this kit has no
      large entrance animations by design. New usage-rule bullets for
      all three components and a new anti-pattern entry (never strip or
      override `Skeleton`'s reduced-motion behavior "for snappiness").
      **Verified for real before pushing**: `compileLocalPreview` against
      each of the three new components confirmed a clean compile, real
      docgen props (including `Skeleton`'s `variant` default of
      `"text"`), expected hex tokens present in the compiled output, and
      for `Skeleton` specifically that the compiled HTML contains a real,
      functioning `@media (prefers-reduced-motion: reduce)` rule setting
      `animation: none`.
      Pushed as a real edit via `deliveryos push design-kit --bump minor`
      (not `--new`) — real PR opened:
      [growtharc-ai-helpers#58](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/58),
      version `1.0.0` → `1.1.0`, exactly the 8 expected file changes
      (manifest bump, `GUIDELINES.md` edit, 3 new component pairs).
- [ ] **A real Detail view for the design-kit itself — currently doesn't
      exist.** Checked directly against `renderDetail` in
      `src-tauri/spike-ui/app.js`: it has exactly two kind-specific
      branches (`ui-component`'s live preview iframe, and the
      backend-plugin section gated on `install_params`/`wiring_actions`
      presence, deliberately "never a kind check"). Neither applies to
      `kind: template`, so a design-kit artifact today falls through to
      the plain generic Detail view — description, kind/version/owner,
      tags, Pull button. Nothing renders the guideline's tokens, type
      scale, or a component grid; no theme toggle. Add a new section,
      gated the same way the backend-plugin section already is (on real
      field/file presence — e.g. a `GUIDELINES.md` at the payload root —
      never a `kind` check, matching this codebase's own established
      convention): render the guideline's color tokens and type scale
      read straight from `GUIDELINES.md`, a grid of every component in
      `components/` with a real live preview each via
      `compileLocalPreview` (already proven, Phase 6 Phase D — no new
      engine work needed for this part), and a light/dark toggle re-
      rendering each preview in both themes. Respect the flat-vs-folder
      rule from item 1 when walking `components/` for the grid — don't
      assume a fixed directory depth.
- [ ] **End-to-end test:** pull the real bundle into a fresh project,
      confirm all five components render and live-preview correctly via
      `compileLocalPreview`, deliberately build a component with a planted
      anti-pattern (same-component-nested-twice), confirm the mechanical
      check catches it, confirm the fix step corrects it and a real
      rebuild passes afterward, and confirm the new Detail-view section
      renders the guideline's tokens/type scale and every component's
      live preview correctly, in both themes.

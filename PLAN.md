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

## Phase 6 — UI Components — **Done, pending one human glance at the native app**

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
never reached `main`, fixed via a follow-up PR before continuing. The only
thing left is a human glance at the native Tauri app (see the first
checklist item) — nothing else here is simulated or fixture-only anymore.

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

- [ ] **Propose → merge → pull, full loop:** a real React Button component
      (with a `preview.tsx`) proposed via Add New's Scan-originated wizard,
      confirm `artifacts/<id>/manifest.yaml` + payload + `preview.png` land
      correctly in the remote, a real PR opens with the image embedded and
      visible in both the PR body and the Files-changed diff, merge it, then
      `pull` it into a *different* project and confirm the live sandboxed
      preview renders (hover state included) in the app.
      **Propose→merge→pull now proven for real, up to the native-app
      glance**: `search` (#45) and `magic-container` (#46) were genuinely
      proposed, pushed, and merged into `ai-helpers`; both were then
      `deliveryos pull`ed for real into `DOS Demo` (a genuinely different
      local project, registered against a different original remote —
      `arcos-poc` — with no prior history of either component), landing
      correctly (`src/ui/MagicContainer/`, `src/ui/Search/`, both lockfile
      entries added). Compiled both pulled copies through the real
      `compilePreviewHtml` pipeline and rendered the result in a real DOM
      (jsdom): `magic-container` renders its actual gradient-border markup
      AND now returns a real docgen props schema (`className`) — confirming
      the `React.FC<Props>` fix survived the full push→merge→pull round
      trip, not just the original authoring project; `search` renders a
      real `<svg>` (its `lucide-react` icon) plus its real recent-searches
      content. **Only remaining gap**: an actual human glance at the native
      Tauri window with its project folder pointed at `DOS Demo`, to
      confirm hover state and visual polish — everything below that bar is
      now proven the same way every other phase in this codebase is
      (real git, real compile, real render), not simulated.
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
      ("a today-sized bug, not a someday one"). Done, on branch
      `fix-lockfile-race` — wrapped the read-modify-write in
      `proper-lockfile` (a small, pure-JS, `mkdir`-based advisory lock —
      no native bindings, confirmed by reading its source, so this can't
      repeat the `playwright-core` SEA-packaging surprise from earlier
      this session), keyed on the lockfile path itself with
      `realpath: false` (so the very first lock in a fresh project doesn't
      require the file to already exist). `upsertEntry` is now `async`;
      updated its three call sites (`pull.ts`, `push.ts`, `sync.ts`,
      each already `async` or made so) and every test call site (14 across
      4 e2e test files, mechanically prefixed with `await`). Two new
      regression tests in `lockfile.test.ts`, both verified BY HAND to
      actually catch the race (temporarily bypassing the lock, with a
      small artificial delay between the read and the write to force the
      interleaving a real race would have): five concurrent upserts of
      *different* ids all survive (without the lock, only 1 of the 5
      survived — a real, dramatic loss, not an occasional flake); a mixed
      burst of repeated same-id updates alongside brand-new distinct ids
      never drops one of the distinct ids (without the lock, one of the
      three distinct ids vanished). A same-id-only version of the second
      test was tried first and quietly turned out to be a non-test: N
      racing writers to the SAME id can only ever produce "last write
      wins" (exactly one valid entry), with or without a lock, since
      there's nothing else for a same-id-only race to lose — caught this
      by deliberately running it against the unlocked code too and seeing
      it pass regardless, before trusting it. Full suite (192 tests, one
      pre-existing unrelated failure) + typecheck + lint all clean.
- [ ] Prove adoption — get one real engineer outside the build team to
      pull/push something they'd have built anyway. Not something engine
      work can do on its own; revisit once there's an actual candidate
      person/task.
- [ ] Close the GitHub-polling loop (cross-cutting section of
      product-roadmap-vision.md) — named from lived experience, not
      invented for the doc.
- [ ] Ship the security/provenance model
      ([scalable-architecture-research.md §3.3](docs/scalable-architecture-research.md))
      — a real liability the moment anything beyond a UI button is shared
      further, not hypothetical. Also a hard prerequisite for Phase 7 per
      that phase's own checklist below, not just a Tier 0 nice-to-have.
- [ ] Track real usage as a number, not a feeling (ARCHITECTURE.md §9 risk
      #6) — pulls/pushes/reuse counted from day one, the only way "prove
      adoption" above becomes evidence instead of anecdote.

## Phase 7 — Backend plug-and-play artifacts — **Not started, brainstormed only**

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

**Note on sequencing, not a blocker:** product-roadmap-vision.md's own
"priority reset" puts adoption proof, the lockfile fix, closing the
GitHub-polling loop, and usage tracking (Tier 0) ahead of this in real
priority. Recorded here as a phase because it's now been asked for
directly — worth remembering Tier 0 still outranks it if sequencing comes
up again.

- [ ] Pick one real, concrete auth/login implementation to model this on —
      every kind proven so far (`agent-asset`, `ui-component`) started from a
      real target, not a hypothetical; this one hasn't yet.
- [ ] Extend the manifest schema with install-time *parameters* (e.g. a
      declared list of required env vars/config keys), not just the existing
      fixed-string `post_install` command — the real schema gap already
      identified; a real auth module can't be meaningfully pulled without it.
- [ ] Ship the security/provenance model (cosign signing + SLSA-style
      attestation at merge time, verified at Pull) — treated as a hard
      prerequisite for this phase, not later polish, per the roadmap doc's
      own reasoning about credential-handling artifacts.
- [ ] Detail/Pull UX for non-visual artifacts: rendered README, a
      required-config checklist collecting the project's own values (never
      the artifact's own defaults), and a signed/provenance badge — no live
      preview attempted.
- [ ] Propose-new flow: manual/CLI-driven only at first, no Scan — "is this
      generic enough to share" is a judgment call Scan can't safely make yet
      for backend code the way it can for a React component.
- [ ] Wiring agent, scoped to the three-tier model already designed
      (auto-applies / proposes-and-confirms / never-touches) — at minimum
      tier 1 and tier 2 working for the one real target artifact.
- [ ] **End-to-end test:** propose the real auth module, merge it, pull it
      into a *different* project, confirm install-time config is actually
      collected and applied, confirm the signature/provenance verifies
      before any files are written, and confirm the wiring agent's tier
      boundaries hold (auto-applies what's mechanical, asks before touching
      the app root, never touches the real secret values).

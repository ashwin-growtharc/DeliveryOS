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
- [ ] Notifications for available updates / PR review status
      **Deliberately deferred** — the auto-sync feature already surfaces new updates via an in-app toast, which covers the current single-user, app-in-the-foreground usage pattern. Native OS notifications (visible even when the app isn't focused/is minimized) matter more once there's a reason to expect the app running unattended in the background — revisit then, not now.
- [ ] Lifecycle/deprecation states (§9 risk #5)
- [ ] Success metrics, using the tiered metrics-ethics model (§9 risk #6) to avoid an accidental leaderboard
- [ ] **End-to-end test:** simulate a full week of drift (someone stops syncing, a remote changes upstream, another person edits the same resource) and confirm drift detection, auto-sync, and notifications all surface correctly with no manual intervention required.

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

---

## Later phases — lighter detail until Phase 2 is proven

## Phase 3 — Tauri app

- [ ] Spike: package the TypeScript engine as a Tauri sidecar process; confirm size and startup latency are acceptable (§9 risk #11) *before* committing further
- [ ] Confirm who owns the Rust shell layer (§9 risk #10) before starting
- [ ] Build the Rust shell + webview skeleton
- [ ] Wire up Browse / Pull / Push UI (per the mockups already built) to the engine via the sidecar
- [ ] Packaged installer per OS, code-signed (§9 risk #7)
- [ ] Auto-update wired up
- [ ] **End-to-end test:** someone *outside the builder team* runs a fresh install on a clean machine, times it, and completes a full pull → edit → push cycle through the UI alone, no terminal. Installer isn't called "stable" until this passes (§9 risk #7, borrowed from ArcOS's day-1-install runbook).

## Phase 4 — Team rollout

- [ ] Design and build auth/SSO (first time it's actually needed — §9 risk #9)
- [ ] Profiles: saved tag-filter queries per role/team (§5.3 Filter 1)
- [ ] Runtime stack routing (§5.3 Filter 2, uses the `tags.stacks` field added in Phase 0)
- [ ] Multi-remote support beyond just ArcOS
- [ ] Per-resource review overrides
- [ ] Decide the kind-sprawl question (§9 risk #1) before opening up beyond the 1–2 kinds proven in Phase 2
- [ ] **End-to-end test:** two people, two different profiles (e.g. Sales and Engineering), each sign in, each see genuinely different Browse results, each independently complete a full pull → edit → push cycle without seeing or affecting the other's content.

## Phase 5 — Polish

- [ ] Drift detection (`deliveryos doctor` equivalent, surfaced in the app)
- [ ] Background auto-sync on an interval
- [ ] Notifications for available updates / PR review status
- [ ] Lifecycle/deprecation states (§9 risk #5)
- [ ] Success metrics, using the tiered metrics-ethics model (§9 risk #6) to avoid an accidental leaderboard
- [ ] **End-to-end test:** simulate a full week of drift (someone stops syncing, a remote changes upstream, another person edits the same resource) and confirm drift detection, auto-sync, and notifications all surface correctly with no manual intervention required.

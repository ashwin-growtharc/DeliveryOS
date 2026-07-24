# Changelog

All notable changes to DeliveryOS are recorded here, phase by phase. See
[PLAN.md](PLAN.md) for the roadmap and [ARCHITECTURE.md](ARCHITECTURE.md) for
design rationale.

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

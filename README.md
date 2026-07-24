# DeliveryOS

Standalone, org-wide artifact-sharing platform. See [ARCHITECTURE.md](ARCHITECTURE.md)
for the full design (five-layer model, kinds, manifest schema, decisions, risks).
See [PLAN.md](PLAN.md) for the phase-by-phase task breakdown — start there for
"what do I actually build next." See [CHANGELOG.md](CHANGELOG.md) for what's
shipped so far, and [REQUIREMENTS.md](REQUIREMENTS.md) for what needs to be
installed on a machine to build/run it.

**Status:** Phases 0-2 (MVP/POC) done — `remote add` / `list` / `pull` /
`push` all work end to end, verified against real GitHub, including a real
ArcOS-catalog artifact (see [docs/manual-smoke-test-push.md](docs/manual-smoke-test-push.md)
and [docs/phase-2-retro.md](docs/phase-2-retro.md)). Phase 3 (Tauri app):
sidecar-packaging spike done and green (see
[docs/phase-3-spike-results.md](docs/phase-3-spike-results.md)) — the
TypeScript engine packages as a standalone ~88MB executable a Tauri shell can
spawn and talk to over stdio, no Node install required on the end user's
machine. UI wiring, installer signing, and auto-update are next. No auth
system yet.

**Relationship to ArcOS:** standalone project, not an ArcOS extension. Physically
nested inside the `arc_os` folder for convenience only — its own git repo,
ignored by ArcOS's `.gitignore`, no code or dependency relationship. Phase 2
proved ArcOS's catalog assets can be mapped into DeliveryOS manifests and
pulled/pushed for real — see [docs/phase-2-retro.md](docs/phase-2-retro.md)
for what that did and didn't cover.

## CLI

```
npm install
npm run build

deliveryos remote add <git-url> [--name <name>]   # register a git-backed remote
deliveryos list [--remote <name>] [--json]         # list available artifacts
deliveryos pull <id> [--remote <name>]             # pull an artifact locally

deliveryos push <id> [--remote <name>]             # push a local edit as a PR
deliveryos push <id> --new --remote <name> --path <dir> --kind <kind> \
  --owner <owner> --description <text> [--install-target <path>] \
  [--artifact-version <semver>] [--review-required] \
  [--roles a,b] [--teams a,b] [--stacks a,b]        # propose a new artifact as a PR
```

`push` opens a real GitHub pull request (via `gh auth token` — run `gh auth
login` once if you haven't) against the artifact's owning remote. Requires a
GitHub-hosted remote (Phase 1 is GitHub-only). See
[docs/manual-smoke-test-push.md](docs/manual-smoke-test-push.md) for a
worked example of both modes against a real repo.

Each remote is a plain git repo with one manifest per artifact:

```
<remote root>/artifacts/<id>/manifest.yaml
<remote root>/artifacts/<id>/payload/...    # copied to install_target on pull
```

A manifest can instead set `payload_path: <path relative to remote root>` to
point at a real file or directory living anywhere else in the repo, instead
of duplicating it under `artifacts/<id>/payload/` — this is how a repo with
its own pre-existing file layout (like ArcOS's `catalog/`) becomes a remote
without restructuring itself.

The remote registry/cache lives under `~/.deliveryos` (override with the
`DELIVERYOS_HOME` env var, e.g. for tests); the per-project lockfile lives at
`.deliveryos/lock.json` in whatever directory you run `pull` from.

## Development

```
npm run typecheck
npm run lint
npm test
```

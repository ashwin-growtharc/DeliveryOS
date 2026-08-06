# DeliveryOS

An internal artifact-sharing platform: browse, pull, and propose changes to
shared resources (AI agents/skills, starter templates, whole projects) as
real GitHub pull requests — via a CLI or a desktop app, both backed by the
same engine. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full design and
[PLAN.md](PLAN.md) for what's built vs. planned per phase.

**Status:** Phases 0-2 (engine: `remote add`/`list`/`pull`/`push`) are done
and verified against real GitHub. Phase 3 (desktop app) has a working UI —
Browse, Pull, Push, Settings, a live progress log, Open Folder — built on
top of the same engine via a sidecar process. A "UI Components" page
(live, sandboxed-iframe previews of pushed React/TS and plain-HTML
components, grouped by a `componentTypes` tag) is also done, including
Storybook-style variant tabs and a generated props-controls panel on a
component's Detail view — see
[docs/ui-components-feature-design.md](docs/ui-components-feature-design.md)
and `PLAN.md`'s Phase A/B/C entries. Phase 7 (`kind: backend-plugin` —
auth/login-style artifacts, e.g. a real email/password Auth.js module) is
now **complete**: install-time config collection, keyless signing verified
at pull time before any files are written, a deterministic wiring agent
(auto-applies mechanical setup, suggests but never silently applies edits
to existing project files), a Detail view surfacing all of it, and a real
end-to-end test against a freshly-scaffolded second project — see
`PLAN.md`'s Phase 7 "In short" summary for the plain-language version.
Phase 8 (a Claude Code Skill — check the catalog before generating new
code, pull a match, wire it in, and verify the target project actually
builds) is now **complete** and pushed for real as `deliveryos-check-first`
on the project's own catalog. Phase 9 (the same principle, applied to
checking DeliveryOS's own health/status instead of generating code) is
also **complete**, as `deliveryos-status`. Phase 10 (wiring the check→
pull→wire→test loop directly into the app's own **Pull** button) is
scoped in `PLAN.md` but not started. See
[CHANGELOG.md](CHANGELOG.md) for what's shipped, [PLAN.md](PLAN.md) for
what's left, and the [docs index](#docs-index) below for everything else.

**Relationship to ArcOS:** standalone project, not an ArcOS extension.
Physically nested inside the `arc_os` folder for convenience only — its own
git repo, no code/dependency relationship.

## Setup

```
npm install
npm run build
```

See [REQUIREMENTS.md](REQUIREMENTS.md) for what needs to be installed on the
machine first (Node version, `gh` CLI, and — for the desktop app only — Rust
+ MSVC Build Tools on Windows).

## CLI

```
deliveryos remote add <git-url> [--name <name>]   # register a git-backed remote
deliveryos list [--remote <name>] [--json]         # list available artifacts
deliveryos pull <id> [--remote <name>]             # pull an artifact locally

deliveryos push <id> [--remote <name>]             # push a local edit as a PR
deliveryos push <id> --new --remote <name> --path <dir> --kind <kind> \
  --owner <owner> --description <text> [--install-target <path>] \
  [--artifact-version <semver>] [--review-required] \
  [--roles a,b] [--teams a,b] [--stacks a,b] \
  [--component-types a,b] [--post-install <cmd>]    # propose a new artifact as a PR
```

`push` opens a real GitHub pull request (via `gh auth token` — run
`gh auth login` once if you haven't) against the artifact's owning remote.
Requires a GitHub-hosted remote.

`--post-install` (propose-new only) is whatever one-line shell command a
fresh pull of this artifact should run afterward — `npm install`,
`pip install -e ".[dev]"`, anything. DeliveryOS doesn't know or care what it
is, it just runs it in `install_target`. Omit it if the artifact needs no
setup step. See
[docs/manual-smoke-test-push.md](docs/manual-smoke-test-push.md) for a
worked example of both push modes against a real repo.

### Manifest format

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

## Desktop app

The same engine, wrapped in a Tauri (Rust + webview) shell. The engine runs
as a bundled sidecar process the app talks to over stdio — see
[docs/phase-3-spike-results.md](docs/phase-3-spike-results.md) for why.

### Running it in dev mode

```
npm run build && npm run build:sidecar
cd src-tauri
npx tauri dev
```

(On Windows, make sure Rust's `~/.cargo/bin` is on `PATH` first.) This opens
the app window and keeps it live-reloading on frontend changes — but **not**
on sidecar/engine changes; re-run `npm run build:sidecar` from the repo root
and restart `tauri dev` after editing anything under `src/`.

### Opening DevTools (for console errors / logs)

Right-click anywhere in the app window and choose **Inspect**, or press
**F12** — this opens the same Chromium DevTools you'd see in a browser,
since the app's UI is a webview. Useful panels:

- **Console** — JS errors from the frontend (`src-tauri/spike-ui/*.js`).
- **Network** — not used; the app never makes HTTP calls, it talks to the
  sidecar over stdio, so you won't see engine activity here.

**Sidecar/engine-side output** doesn't show up in DevTools at all — it's a
separate OS process. To see it:
- In dev mode, the sidecar's stderr is inherited by the terminal you ran
  `npx tauri dev` from — engine crashes/uncaught errors print there.
- The engine's actual responses/errors surface in the app as toast
  notifications (bottom-right) — the message shown is the real underlying
  error (e.g. a real git error), not a generic "something went wrong."
- The Detail view's progress log (added in Phase 3) shows live stage-by-stage
  status during Pull/Push — that's the closest thing to a live log the app
  exposes today.

### Building a real installer

```
cd src-tauri
npx tauri build --target x86_64-pc-windows-msvc
```

Produces an `.msi` and an NSIS `.exe` under
`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/`. Not yet
code-signed (see [PLAN.md](PLAN.md)'s Phase 3 checklist).

## Development

```
npm run typecheck
npm run lint
npm test
```

The frontend (`src-tauri/spike-ui/*.js`) has no automated test coverage
(ESLint only scans `.ts` files) — verify UI changes by hand; see
[docs/manual-ui-clickthrough.md](docs/manual-ui-clickthrough.md).

## Docs index

| Doc | What's in it |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Full design: five-layer model, artifact kinds, manifest schema, decisions, open risks |
| [PLAN.md](PLAN.md) | Phase-by-phase checklist — what's done, what's next |
| [CHANGELOG.md](CHANGELOG.md) | What's actually shipped, phase by phase |
| [REQUIREMENTS.md](REQUIREMENTS.md) | What to install on a machine to build/run this (Node, `gh`, Rust/MSVC for the app) |
| [docs/demo-guide.md](docs/demo-guide.md) | Non-technical walkthrough for showing DeliveryOS to anyone |
| [docs/demo-script.md](docs/demo-script.md) | Step-by-step live demo script (what to click, what to say, anticipated Q&A) |
| [docs/growtharc-brand-guidelines.md](docs/growtharc-brand-guidelines.md) | Color palette, typography, and component patterns already applied to the desktop app UI |
| [docs/manual-smoke-test-push.md](docs/manual-smoke-test-push.md) | How to verify `push` against a real GitHub repo by hand |
| [docs/manual-ui-clickthrough.md](docs/manual-ui-clickthrough.md) | How to verify the desktop app by hand (no automated GUI test suite exists) |
| [docs/phase-2-retro.md](docs/phase-2-retro.md) | What broke proving the engine against real ArcOS catalog content |
| [docs/artifact-arcos-cli-retro.md](docs/artifact-arcos-cli-retro.md) | Adding a whole-repo, Pull-only artifact (`arcos-cli`) |
| [docs/artifact-launchpad-template-retro.md](docs/artifact-launchpad-template-retro.md) | Adding an artifact from a non-ArcOS project (`launchpad-template`) |
| [docs/ui-components-feature-design.md](docs/ui-components-feature-design.md) | Design for the "UI Components" preview pipeline and sidebar page (see `PLAN.md` Phase A/B) |
| [docs/phase-A-preview-packaging-spike.md](docs/phase-A-preview-packaging-spike.md) | Phase A spike write-up: proving the sandboxed-iframe + esbuild preview pipeline survives the sidecar's Node SEA packaging |
| [docs/phase-3-spike-results.md](docs/phase-3-spike-results.md) | Sidecar-packaging feasibility spike: size/latency numbers |
| [docs/phase-3-ui-scope.md](docs/phase-3-ui-scope.md) | What the desktop app UI does and deliberately doesn't do yet, and why |
| [docs/release-process.md](docs/release-process.md) | Manual runbook for cutting a signed release with working auto-update (no CI exists yet) |
| [docs/product-roadmap-vision.md](docs/product-roadmap-vision.md) | Long-term roadmap brainstorm: backend/data-engineering artifact kinds, org/team/access maturity, voice AI, a VSCode-based IDE surface |
| [docs/scalable-architecture-research.md](docs/scalable-architecture-research.md) | Target architecture research: catalog indexing, provenance/signing, policy-as-code, org/team modeling — grounded in Backstage, Sigstore/SLSA, OCI/Helm, and multi-tenant RBAC prior art |

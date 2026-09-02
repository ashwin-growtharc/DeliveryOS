# DeliveryOS

Share code across your org without copy-paste. Register a git repo as a
**remote**, pull an **artifact** out of it into your project, edit it, and
propose the change back as a real GitHub pull request.

An artifact is anything worth reusing: a Claude Code agent or skill, a design
system, a starter template, a whole backend feature. Two front ends — a CLI
and a desktop app — over one engine.

```
deliveryos remote add https://github.com/your-org/catalog.git
deliveryos list
deliveryos pull email-code-auth
```

## Setup

```
npm install
npm run build
npm link          # puts `deliveryos` on your PATH
```

Node 22.12+ and the `gh` CLI (`gh auth login` once, for `push`).

Without `npm link` there is no `deliveryos` command — run it as
`node dist/index.js <command>` instead, or `npm run dev -- <command>` to run
straight from TypeScript without building.

## Running it

There are two front ends over the same engine. **Neither is a web app — there
is no server and no localhost.**

**The CLI** is a terminal command:

```
deliveryos list
deliveryos pull email-code-auth
```

**The desktop app** is a native window:

```
npm run build
npm run build:sidecar
cd src-tauri
npx tauri dev
```

It needs Rust and, on Windows, MSVC Build Tools — see
[REQUIREMENTS.md](REQUIREMENTS.md). More detail in
[Desktop app](#desktop-app) below.

## CLI

### Remotes

| Command | What it does |
|---|---|
| `remote add <git-url> [--name <name>]` | Register a git-backed remote |
| `remote list [--json]` | List registered remotes |
| `remote remove <name>` | Unregister a remote and delete its local cache |

### Using artifacts

| Command | What it does |
|---|---|
| `list [--remote <name>] [--json]` | List available artifacts, with local status |
| `pull <id> [--set KEY=VALUE] [--no-wire]` | Pull an artifact into the current project |
| `remove <id>` | Remove a previously-pulled artifact |
| `config <id> --set KEY=VALUE` | Change an install param without re-pulling |
| `check-updates [--apply]` | Check for newer versions; `--apply` updates eligible ones |

### Contributing back

| Command | What it does |
|---|---|
| `push <id> [--bump patch\|minor\|major]` | Propose your local edits as a PR |
| `push <id> --description <text>` | Metadata-only edit — no payload touched, no version bump |
| `push <id> --new --path <dir> --kind <kind> --owner <owner> --description <text>` | Propose a brand-new artifact |
| `scan -r <remote>` | Find reusable content already in your project and print a ready-to-run `push` for each |

`push --new` also accepts `--install-target`, `--artifact-version`,
`--review-required`, `--post-install`, and `--roles`/`--teams`/`--stacks`/
`--component-types`. Run `deliveryos push --help` for the full list.

### Backend plugins

| Command | What it does |
|---|---|
| `wiring <id> [--json]` | Show the artifact's wiring suggestions against this project |
| `wire-with-claude <id>` | Hand the wiring to a real interactive Claude Code session |
| `scaffold-backend-plugin --path <dir> --consumer-file <file>` | Draft `install_params`/`wiring_actions` for you to review |

### Maintenance

| Command | What it does |
|---|---|
| `check-pending-pushes` | Ask GitHub what actually happened to your open PRs |
| `check-drift <id> -r <remote> -s <path>` | Has the artifact's original external source changed? |

## Claude Code skills

DeliveryOS ships six skills, in two groups.

**Authoring** — one per artifact kind, for turning something you already have
into a pullable artifact. They live in this repo's `.claude/skills/`:
`ui-component-extractor`, `feature-extractor`, `starter-kit-extractor`,
`backend-plugin-authoring`.

**Usage** — for driving DeliveryOS from Claude Code. Published as artifacts,
so pull them into whichever project you want them in:

```
deliveryos pull deliveryos-check-first   # check the catalog before writing new code
deliveryos pull deliveryos-status        # typecheck, lint, tests, and real PR state
```

Both need the `claude` CLI authenticated. See [docs/skills.md](docs/skills.md)
for what each one does and why.

## How it behaves

**`push`** opens a real pull request against the artifact's owning remote
(GitHub only, authenticated via `gh auth token`). A real payload change always
bumps the version; `--bump` only chooses a *larger* bump than the default
patch. Passing only metadata flags edits metadata alone.

**`pull`** wires a `backend-plugin`'s declared `wiring_actions` automatically:
a target file that doesn't exist yet is written; a file that already exists is
**left completely untouched** and named in the summary. It then reruns your
project's build to confirm nothing broke. `--no-wire` skips all of it for
scripted or CI use.

**`pull --set KEY=VALUE`** (repeatable) supplies an `install_param` up front.
Values are written to `.env.local` at the project root, never inside the
artifact. Anything still missing is reported, not fatal — fill it in later
with `config`, which does *not* re-run wiring, so only code reading
`process.env` at runtime picks it up.

**`check-updates --apply`** only touches an artifact that is byte-for-byte
identical to its pristine snapshot. Anything with local edits is reported and
left alone; merging a local edit against a new upstream version is not
attempted.

## Manifest format

A remote is a plain git repo with one manifest per artifact:

```
<remote root>/artifacts/<id>/manifest.yaml
<remote root>/artifacts/<id>/payload/...    # copied to install_target on pull
```

A manifest can set `payload_path: <path relative to remote root>` to point at
files living elsewhere in the repo instead of duplicating them under
`payload/` — that's how a repo with its own existing layout becomes a remote
without restructuring.

`install_target` is relative to the project root and may not escape it. It
*may* be the project root itself — the right shape for a scaffold artifact
whose whole job is to drop config files at the top level.

A root-target artifact works through the whole lifecycle: pull, status, push,
update and remove. Every one of those is scoped to the artifact's own
**footprint** — the top-level entries its payload provided, recorded in the
pristine snapshot at pull time — so the rest of your project is never reported
as part of the artifact, and never deleted along with it.

The one case that refuses is a root-target artifact whose pristine snapshot has
gone missing: without it there is no record of which files belong to the
artifact, and `push`/`remove` will not guess at the project root. Re-pull to
rebuild the snapshot.

The remote registry and cache live in `~/.deliveryos` (override with
`DELIVERYOS_HOME`). The per-project lockfile is `.deliveryos/lock.json`.

## Desktop app

The same engine in a Tauri shell, talking to the engine as a bundled sidecar
process over stdio.

Launch it with the commands under [Running it](#running-it) above.

`tauri dev` live-reloads on frontend changes. After editing anything under
`src/` you must re-run `npm run build:sidecar` and restart — the engine is a
separate compiled binary, not loaded from source. On Windows, put Rust's
`~/.cargo/bin` on `PATH` first.

### Packaging an installer

All four build steps are required, in order. `tauri.conf.json` silently depends
on the first three: `bundle.externalBin` needs the sidecar, `bundle.resources`
needs `esbuild.exe` and `deliveryos.exe`, and both of those build scripts
assume `npm run build` already produced `dist/`. Skip one and `tauri build`
either fails outright or — worse — succeeds with a **stale binary baked into
the installer**.

```
npm run build           # tsc -> dist/
npm run build:sidecar   # -> build/deliveryos-engine-*.exe + build/esbuild.exe
npm run build:cli       # -> build/deliveryos-cli.exe
cd src-tauri
npx tauri build
```

Output, under `src-tauri/target/release/bundle/`:

| File | What it is |
|---|---|
| `nsis/deliveryos_<version>_x64-setup.exe` | **The one to distribute.** Per-user install, no admin rights, and it puts `deliveryos` on the user's PATH. |
| `msi/deliveryos_<version>_x64_en-US.msi` | Also produced — **don't ship it** |
| `<each of the above>.sig` | Detached signature the auto-updater checks. Only produced when the signing env vars are set — see [docs/release-process.md](docs/release-process.md). An unsigned local build has no `.sig` files at all. |

**Check the version in the filename before you ship it.** Only a plain
`npx tauri build` writes to `target/release/bundle/`; passing
`--target x86_64-pc-windows-msvc` writes to
`target/x86_64-pc-windows-msvc/release/bundle/` instead. Both paths can
exist side by side, and the one you didn't just build holds a stale
installer that looks exactly as legitimate as the fresh one.

**Ship the NSIS `.exe`, not the MSI.** The CLI-onto-PATH step runs from
`src-tauri/nsis/path-hook.nsh` via `bundle.windows.nsis.installerHooks`, and
that mechanism is NSIS-only. Someone who installs the MSI gets the app but no
`deliveryos` command, with nothing telling them so. WiX has an equivalent
(`fragmentPaths` + an `<Environment>` element); it isn't built yet.

The PATH hook compiles and the installer builds, but the *runtime* behaviour —
that `deliveryos` really lands on PATH on install and is cleanly removed on
uninstall — has not been verified end to end on a clean machine. Walk
[docs/manual-smoke-test-cli-install.md](docs/manual-smoke-test-cli-install.md)
once before relying on it in front of anyone.

Signing and the `latest.json` the updater expects are covered in
[docs/release-process.md](docs/release-process.md). Neither installer is
code-signed today.

**Debugging:** F12 opens Chromium DevTools. The Network panel stays empty by
design — the frontend talks to the sidecar over stdio, and fonts are vendored
locally. Engine output goes to the terminal running `tauri dev`; engine errors
surface in-app as toasts showing the real underlying message.

## Development

```
npm run typecheck     # tsc, strict
npm run lint          # eslint
npm test              # vitest
npm run lint:css      # design-token bypasses in the desktop UI
npm run ui:contrast   # WCAG contrast report for every text rule, both themes
npm run ui:themes     # theme resolution across all 6 OS/preference combinations
npm run ui:fonts      # prove the UI renders with the network blocked
```

The desktop frontend has no automated GUI test suite — see
[docs/manual-ui-clickthrough.md](docs/manual-ui-clickthrough.md) to verify
changes by hand.

## Docs

| Doc | What's in it |
|---|---|
| [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md) | **Start here if you are not building it.** What it is, who it is for, and one small journey — plain language, no code |
| [ARCHITECTURE.md](ARCHITECTURE.md) | The design: layer model, artifact kinds, manifest schema, decisions, open risks |
| [PLAN.md](PLAN.md) | What's shipped and what's next |
| [CHANGELOG.md](CHANGELOG.md) | Detailed release notes, phase by phase |
| [REQUIREMENTS.md](REQUIREMENTS.md) | What to install to build and run this |
| [docs/backend-plugin-lifecycle.md](docs/backend-plugin-lifecycle.md) | Every backend-plugin stage: install, wire, merge, uninstall, secrets, updates |
| [docs/skills.md](docs/skills.md) | The six Claude Code skills: what each does, and how to get them |
| [docs/release-process.md](docs/release-process.md) | Runbook for cutting a signed release with working auto-update |
| [docs/manual-smoke-test-update-and-refusals.md](docs/manual-smoke-test-update-and-refusals.md) | By-hand runbook: the `src/`-project update path, the `install_target` denylist, and audit-log redaction |

---

**Relationship to ArcOS:** standalone project, not an ArcOS extension. It
lives inside the `arc_os` folder for convenience only — separate git repo, no
code or dependency relationship.

# The MCP server

`deliveryos mcp` runs a Model Context Protocol server over stdio, exposing the
catalog to an MCP client (Claude Code, Claude Desktop, or anything else that
speaks the protocol). It is **read-only**.

---

## Why this exists

An agent working in a project cannot currently see what DeliveryOS has. The
catalog is 237 artifacts across three remotes — 80 skills, 68 agents, 35 rules,
30 commands, plus components, templates and backend plugins — and the only ways
to look at it are a CLI a person types into and a desktop app a person clicks.
So the agent that would most benefit from knowing "there is already a
`code-reviewer` agent for this" is the one party that cannot ask.

This closes that, and nothing more. It does not let an agent install anything.

---

## Architecture: before and after

### Before

Two driving adapters, each wired straight into the engine:

```
   CLI (src/cli/**)  ─────────┐
                              ├──────►  engine (src/engine/**)  ──►  git, fs, GitHub
   Tauri sidecar             ─┘
   (src/sidecar.ts)
```

Neither adapter declared what it needed from the core; both imported engine
functions directly and shaped arguments inline. That is fine until you want to
test an adapter in isolation, at which point there is no seam:
`test/e2e/sidecar.e2e.test.ts` builds a ~100-line subprocess harness with manual
request/response correlation, because driving the sidecar any other way is
impossible.

### After

A third driving adapter, and the first one with a declared port:

```
                                     ┌─ ports.ts ─────────────┐
   MCP (src/mcp/server.ts) ─────────►│  DeliveryOsReadPort    │
                                     │  listCatalog           │
                                     │  refreshCatalog        │
                                     │  readArtifact          │
                                     └───────────┬────────────┘
                                                 │
                              engineAdapter.ts ──┴──►  engine  ──►  git, fs
                                     ▲
   CLI ─────────────────────────────┘ (composition root:
   src/cli/commands/mcp.ts             binds the port to the real engine)

   CLI (other commands) ──────────►  engine        (unchanged)
   Tauri sidecar        ──────────►  engine        (unchanged)
```

Three files, one rule each:

| File | Role | May import the engine? |
|---|---|---|
| `src/mcp/ports.ts` | Declares `DeliveryOsReadPort` | Types only |
| `src/mcp/server.ts` | Tool definitions, validation, formatting | Types only |
| `src/mcp/engineAdapter.ts` | Binds the port to `src/engine/**` | Yes — the only one |

`src/cli/commands/mcp.ts` is the composition root: it is where
`createEngineReadPort()` is actually called. `buildMcpServer` takes its port as
a **required** argument rather than defaulting to the real one, which is what
keeps `server.ts` free of any runtime dependency on the core.

**This is checked, not asserted.** `test/unit/mcp.architecture.test.ts` fails
the build if `server.ts` or `ports.ts` gains a value import from `../engine/`,
if more than one file in `src/mcp/` reaches the core at runtime, if the port
grows a `pull`/`push`/`remove`-shaped method, if anything in `src/mcp/**` or
`src/engine/**` writes to stdout, or if the server gains a non-stdio transport
(see [Why `cwd` is a tool argument](#why-cwd-is-a-tool-argument)). Without that,
the seam decays silently: the fake port in the tests stops resembling production
while every test keeps passing.

### What the seam bought

`test/unit/mcp.server.test.ts` covers the entire tool surface — 14 tests — with
a fake port. No subprocess, no filesystem, no git remote, no fixtures. It runs
in **87 ms**. The equivalent coverage for the sidecar needs a spawned process
per scenario, and `vitest.config.ts` already caps workers to half the cores
because those tests were starving each other.

`test/e2e/mcp.e2e.test.ts` then covers only what a subprocess can prove and an
in-memory transport cannot: that the command is wired into the CLI, that the
adapter reaches a real catalog on disk, and that **stdout carries JSON-RPC and
nothing else**.

---

## The tools

All four require `cwd` — the absolute path of the project being worked in.
Whether an artifact is installed is a property of that project, not the machine.

| Tool | Does | Network |
|---|---|---|
| `search_artifacts` | Finds by query, kind, remote, install status. Ranked, capped, reports the total. | No |
| `get_artifact` | Full manifest plus the primary document. | No |
| `catalog_overview` | Counts by kind/remote/status; names any manifest that failed to load. | No |
| `refresh_catalog` | Fetches every remote from git, then summarises. | **Yes** |

`refresh_catalog` is the only one annotated `readOnlyHint: false` /
`openWorldHint: true`. It writes to the caches under `~/.deliveryos` and can
hang on an unreachable remote. Saying otherwise would be convenient and false.

### Two details worth knowing

**Results are capped.** `search_artifacts` defaults to 20 rows, max 100, and
reports `total` and `truncated`. Returning 237 full manifests would spend an
agent's context on a directory listing.

**`post_install` is exposed as the command string.** The desktop app coerced it
to `!!` in both places it touched it, so nobody could see *what* would run on
their machine. An agent recommending an artifact can now quote the command.
`contentDigest` and `signature` are exposed the same way — usually `null`,
because only 3 of 230 artifacts are signed (`sign-artifacts.mjs` skips every
kind except `backend-plugin`), and an agent should be able to say "this is not
signed" accurately.

---

## Why read-only

Every mutating operation in this system either writes into a person's project
or opens a PR against a shared remote. The multi-user work in the preceding
batch exists precisely because those paths destroy work when two actors
disagree — a stale `push` silently reverted a colleague's merged change, and a
CLI `pull` overwrote local edits with no guard.

An agent is a second actor. Adding mutation is a separate decision with its own
consent model, not a widening of this interface — which is why "no mutating
method" is enforced on the **port**, not just on today's tool list.

### So how does an agent actually install something?

It runs the CLI, the same way a person would. DeliveryOS is a command-line tool,
and Claude Code already has a terminal — so read-only MCP costs the agent
nothing it could otherwise do. What changes is *where the approval happens*: the
user sees `deliveryos pull <id> --remote <r>` and approves that specific
command, rather than approving a tool named `artifact_pull` once and having it
invoked on their behalf thereafter.

`get_artifact` returns the command ready to run, so the handoff is exact rather
than reconstructed:

```
found        : email-code-auth (backend-plugin)
installs to  : <project>/src/lib/auth
post_install : "cd ../../.. && npm install next-auth@beta"
signed       : yes
=> run       : deliveryos pull email-code-auth --remote ai-helpers
```

That `post_install` line is the point. It is an arbitrary shell command from a
manifest that executes on the user's machine (`pull.ts` → `execSync`), and
before this surface existed it was invisible until it had already run — the
desktop app coerced it to `!!` in both places it touched it. An agent can now
read it out **before** anyone runs anything.

Note the honest limit: if the user approves the pull, that command runs either
way. The gain is disclosure and a per-invocation decision, not a sandbox.

### What would have to be true to expose `pull`

Recorded in PLAN.md Stage 3, not attempted here:

1. **Plan/apply separation.** The engine writes through `console.*` at 56 sites
   across 11 files, so "tell me what this would do" is not separable from doing
   it. Dry-run-by-default needs that first.
2. **`--no-wire` is not a substitute.** It still runs `execSync(post_install)`.
3. **The refusal paths need an agent-legible contract.** Stale-push and
   local-edit refusals now throw typed errors; an agent driving `pull` has to
   handle them rather than retry with `--force`, which is exactly how a second
   actor destroys a first actor's work.

---

## Why `cwd` is a tool argument

`docs/agent-surface-plan.md` Stage 2 required *session-configured project scope,
never a tool argument*, on the grounds that the engine validates paths **within**
`cwd` while validating `cwd` itself nowhere — so an agent-supplied project path
is an escape.

That is correct for a surface that **writes**. Pulling a payload into an
agent-chosen directory is a genuine escape. This surface writes nothing:

- document contents come from the **remote cache**, never from `cwd`
  (`resolvePrimaryDoc(entry.remoteName, manifest.id, …)`)
- `cwd` reaches only the lockfile read and the pristine-snapshot comparison
- the tools return `localStatus` and `installTarget` — never file contents

So the residual exposure is an existence oracle over paths the calling agent can
almost always already `stat` itself. Against that, out-of-band registration
would make the server unusable in the one client that matters — an editor whose
whole job is the project it is open in.

The half of the rule that still bites **is** enforced: `assertUsableProjectDir`
requires an absolute path to a directory that exists, on every tool, with e2e
coverage. It lives in the adapter rather than in each `cwd` zod schema
deliberately — one gate every tool funnels through beats four copies.

**This argument depends on the transport, and that dependency is pinned.**
"The caller can already `stat` it" holds for a local stdio client and fails for
a remote one: over streamable HTTP or SSE the agent would be probing the
*server's* filesystem, which it could not otherwise reach — and the code would
still read as safe. That is the `needsApproval` failure shape PLAN.md's Phase 16
is built around: a gate that holds on one surface and is *assumed* to hold on
all of them. Hence the fourth architecture gate. Adding a transport means
deleting that test, and deleting it is where this decision gets re-examined.

---

## Configuring a client

The server is a subcommand, not a second binary, so it shares one `bin`, one
SEA build and one version string with the CLI.

**This repo is already wired.** [`.mcp.json`](../.mcp.json) is committed, so
Claude Code offers to enable the server on opening the repo. It runs
`npx tsx src/index.ts mcp`, which needs nothing beyond `npm install` — `tsx` is
a devDependency, and pointing at `bin.deliveryos` instead would require a build
because that resolves to the gitignored `dist/`.

Verified through the SDK's own `StdioClientTransport` — the transport Claude
Code itself uses — not just a hand-rolled spawn: all four tools respond, the
error paths refuse correctly, and `npx` resolves fine on Windows because
`cross-spawn` handles the `.cmd` shim. Cold start is **~4.3 s** (that is `npx`
plus `tsx` compiling, paid once per session, not per call). Pointing at
`node dist/index.js mcp` after `npm run build` is faster if that ever matters.

**Claude Code** (`.mcp.json` in the project, or `claude mcp add`):

```json
{
  "mcpServers": {
    "deliveryos": {
      "command": "deliveryos",
      "args": ["mcp"]
    }
  }
}
```

**On Windows**, `bin.deliveryos` resolves to `deliveryos.cmd`, and a `.cmd`
cannot be `CreateProcess`'d directly — the same `EINVAL` that
`scripts/build-sidecar.mjs` documents for `npx.cmd`. Either go through `cmd`:

```json
{ "command": "cmd", "args": ["/c", "deliveryos", "mcp"] }
```

or point at the packaged executable, which sidesteps it entirely:

```json
{ "command": "C:\\path\\to\\deliveryos-cli.exe", "args": ["mcp"] }
```

---

## Packaging

The server survives Node SEA packaging, and this was verified by building a
real `.exe` and driving it over stdio — not assumed. `@modelcontextprotocol/sdk`
has no dynamic `require()`, no `createRequire`, no `import()`, and never reads
its own `package.json`, so esbuild resolves every import statically and nothing
is left for the SEA `require` shim to fail on. That is exactly the property
`playwright-core` lacks, which is why `renderPreviewImage.ts:26-55` has to
document a workaround for it.

`scripts/build-cli.mjs` needed no changes: it already bundles `dist/index.js`.
Verified in this repo, not only in a scratch directory -- `npm run build:cli`
then driving `build/deliveryos-cli.exe mcp` over stdio returns the real
237-artifact catalog. Cost is about +1.3 MB, mostly `ajv`.

### Why not fastmcp

`fastmcp` wraps the same SDK and adds sessions, auth, SSE and OpenAPI import —
all dead weight for a stdio server with four read-only tools. It depends on
**zod ^4** while this repo is on zod 3.25, which is the same type-identity
collision described below but across a major version inside a dependency we do
not control. And its tail (`execa`, `file-type`, `@apidevtools/swagger-parser`)
is precisely the dynamic-require class that already breaks under SEA. The
official SDK was proven end-to-end; taking the unproven path bought nothing.

### The one build gotcha

`tsconfig.json` needed this:

```json
"paths": {
  "zod/v3": ["./node_modules/zod/v3/index.d.cts"],
  "zod/v4/core": ["./node_modules/zod/v4/core/index.d.cts"]
}
```

The SDK's `server/zod-compat.d.ts` imports `zod/v3` and `zod/v4/core`. Under
`moduleResolution: node10`, which ignores `exports` maps entirely, those resolve
to the `.d.ts` twins while our own `import { z } from 'zod'` resolves via the
`types` field to `.d.cts` — producing two structurally identical but distinct
declarations of every zod class. The symptom is
`TS2589: Type instantiation is excessively deep and possibly infinite` and
`tsc` exit 2. It is not avoidable by choosing a different SDK API; the low-level
`Server` + `setRequestHandler` route hits it too, plus a hard `TS2345`.

Blast radius is nil — nothing else in `src/` imports either specifier, and no
`baseUrl` is needed (TS ≥4.1 resolves `paths` relative to the tsconfig).

---

## Known costs

Measured against the live 237-artifact catalog:

| | |
|---|---|
| `catalog_overview` | 271–352 ms |
| `search_artifacts` | 135–227 ms |
| `get_artifact` | ~108–186 ms |
| `refresh_catalog` | **5.9 s** — three remotes, real git fetch |
| cold start via `npx tsx` | ~4.3 s, once per session |

`get_artifact` rebuilds the catalog per call (`buildCatalogWithSkipped` is
~141 ms of it). Memoizing is the obvious fix and is deliberately **not** done
here: the module-level catalog state removed in this same batch is exactly what
a naive cache would reintroduce, and cache invalidation for a long-lived process
that `refresh_catalog` can mutate underneath needs its own design. An agent
reading ten artifacts pays about two seconds; that is acceptable, and it is
recorded rather than hidden.

## Not covered

`wire-with-claude` is structurally impossible over MCP: it is the only
`stdio: 'inherit'` call in `src/` (`launchInteractiveClaudeSession.ts:51`) and
hands the terminal to an interactive Claude session. It cannot be a tool call.

# The MCP server

`deliveryos mcp` runs a Model Context Protocol server over stdio, exposing the
catalog to an MCP client (Claude Code, Claude Desktop, or anything else that
speaks the protocol).

**Eight tools: six that read, two that write.** It installs nothing — there is
no `pull` tool and that is deliberate. The two writes are `add_remote`, which
registers where artifacts come from, and `contribute_artifact`, which opens a
pull request from local edits and is reachable only through a preview.

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

Everything that acts on a project needs `cwd`, the absolute path of the project
being worked in — whether an artifact is installed is a property of that
project, not of the machine. The two remote tools need no project at all.

| Tool | Does | Writes | Network |
|---|---|---|---|
| `search_artifacts` | Finds by query, kind, remote, install status. Ranked, capped, reports the total. | — | No |
| `get_artifact` | Full manifest plus the primary document, `postInstall` quoted verbatim, and the exact `pullCommand`. | — | No |
| `catalog_overview` | Counts by kind/remote/status; names any manifest that failed to load. | — | No |
| `list_remotes` | Where artifacts come from, with URLs. Says plainly when nothing is configured. | — | No |
| `refresh_catalog` | Fetches every remote from git, then summarises. | `~/.deliveryos` | **Yes** |
| `add_remote` | Registers a git repository as a source and clones it. | `~/.deliveryos` | **Yes** |
| `preview_contribution` | What contributing would publish: every file, its status, the version bump. Publishes nothing. | — | No |
| `contribute_artifact` | Opens a pull request from local edits. Requires a token from the preview. | **a shared remote** | **Yes** |

**The annotations are derived from `src/capabilities.ts`, not typed here.** That
matters because they decide behaviour: Anthropic's directory requirements state
that read-only tools may run *without per-call confirmation* while destructive
ones always prompt. So "what does this operation do" has one source, and a tool
registered without a capability entry throws rather than taking SDK defaults.

Note `preview_contribution` is annotated as a write despite publishing nothing.
It is declared against `artifact.push`, which mutates; annotating it read-only
would be convenient and would misstate which capability it belongs to.

**The server's own `instructions` are composed from the ports it was built
with.** A server with no config or contribute port says it is read-only; one
with them names its writing tools. That string was once an unconditional
literal claiming *"They cannot pull, push, or modify anything"* while
`add_remote` and `contribute_artifact` were live — a description asserting the
opposite of the code, in runtime output rather than a comment.
`mcp.instructions.test.ts` now asserts the prose and the composition agree in
both directions.

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

## Why it does not install anything

Every mutating operation in this system either writes into a person's project
or opens a PR against a shared remote. The multi-user work that preceded this
exists precisely because those paths destroy work when two actors disagree — a
stale `push` silently reverted a colleague's merged change, and a CLI `pull`
overwrote local edits with no guard.

An agent is a second actor. So exposure is decided per operation, in
`src/capabilities.ts`, and enforced at server-construction time: a capability
declared `mutates` cannot be registered as a tool unless it is named in
`RISKY_CAPABILITIES_ALLOWED_ON_MCP` with a written reason. Three are:

| Capability | Why it is allowed |
|---|---|
| `catalog.refresh` | Writes only the caches under `~/.deliveryos`; touches no project file |
| `remote.add` | Clones into `~/.deliveryos`; needs no project directory at all; refuses a duplicate name before cloning |
| `artifact.push` | Only reachable behind a preview and a single-use token — see below |

`pull` is **not** on that list, and the reasons are recorded rather than vague:
`pullArtifact` has no atomicity or rollback on any path, `post_install` is
arbitrary shell from a manifest that no approval dialog can honestly summarise,
and the worst case (10 min `post_install` + 5 min build) exceeds MCP client
timeouts.

## Contributing back, and why it is two tools

`contribute_artifact` is the only tool here whose mistakes land on **other
people's work**. `docs/agent-surface-plan.md` recorded why push was not an
agent surface at all:

> Push is all-or-nothing over the whole pulled folder with **no diff preview
> and no confirmation** (verified). An agent pushing a filled-in risk register
> would publish client data to a shared repo.

That is concrete. Phase 15 ships a `risk-register` whose own README says *"fill
in your own copy, never push it back"*, and a scoping calculator whose instance
half is *"a specific client's quoted number"* — against `ARCHITECTURE.md`'s hard
rule, *"No customer data in any DeliveryOS-shared remote, ever."*

So the precondition is met rather than waived:

1. **`preview_contribution`** returns the exact file list, statuses and version
   bump, publishing nothing. `planPush.equivalence.e2e.test.ts` pins that the
   preview promises exactly what the push commits — proven by making the
   preview hide a file and watching the test report *"the push committed
   BRAND-NEW.md, which the preview never promised."*
2. **`contribute_artifact`** requires the token that preview returned. The token
   is a digest over the project, the artifact, the exact file set and the
   versions — so editing a file afterwards invalidates it. It is consumed
   **before** the push is attempted, so a failure burns it too, and it mixes a
   per-instance nonce so a restart invalidates every outstanding token.

Three refusals, each for a stated reason:

- **`force` is unreachable** — there is no parameter for it. `push.ts:653-658`
  records that the desktop app has no force affordance because *"a one-click
  force over a colleague's merged change is exactly the operation that should
  stay hard."* An MCP tool is a one-click affordance.
- **An open `pendingPr` refuses.** Not politeness: `push.ts:624` reads it as
  `hasOwnPushInFlight` and **disables the stale-push guard entirely** for the
  next push. Contributing on top of one removes a safety check rather than
  queueing behind it.
- **Propose-new refuses.** That is authoring, not contributing, and
  `push.ts:772` never records a `pendingPr` for it — so DeliveryOS would never
  follow the PR up.

The PR body says an agent assembled the diff. The precedent is the forced-stale
block: *"the PR reviewer is the only remaining safeguard and has to be told
explicitly."*

### Why the token consumption order matters

If `pushBranch` succeeds and `pulls.create` then fails, a branch is already on
the shared remote and **nothing deletes it** (`git.ts:76-82` documents the
leftover as an expected condition), with no `pendingPr` written because that
happens only after the PR opens. Agents retry by default. Consuming the token
on success alone would let a retry create a second branch, then a third.

The nonce covers the same case across a restart: the token is *derived*, so it
would still recompute identically while the consumed set is empty — accepted,
second orphaned branch. `pendingPr` cannot cover it, because the PR never
opened.

### So how does an agent actually install something?

It runs the CLI, the same way a person would. DeliveryOS is a command-line tool,
and Claude Code already has a terminal — so having no install tool costs the agent
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
Code itself uses — not just a hand-rolled spawn: every tool responds, the
error paths refuse correctly, and `npx` resolves fine on Windows because
`cross-spawn` handles the `.cmd` shim. Cold start is **~4.3 s** (that is `npx`
plus `tsx` compiling, paid once per session, not per call). Pointing at
`node dist/index.js mcp` after `npm run build` is faster if that ever matters.

### Which clients

**Any client that speaks MCP**, not just Claude. The server is built on the
official `@modelcontextprotocol/sdk` over stdio and contains no client-specific
logic — Claude Code and Claude Desktop, but equally Cursor, VS Code's agent
mode, Windsurf, Zed, Cline, Continue, a Gemini or OpenAI agent, or anything you
write yourself against the SDK.

That portability was paid for, not assumed. The setup interview in
`list_remotes`/`add_remote` would have been a natural fit for MCP
**elicitation**, which lets the server ask the user directly. It was rejected:
elicitation is supported in Claude Code but returns `-32601 Method not found`
in Claude Desktop, so it would have worked in exactly one client. The interview
lives in the server `instructions` and the tool descriptions instead, and the
agent drives it — a shape that works everywhere. See the note at
`src/mcp/server.ts:679`.

What differs between clients is only **where the config lives and what shape it
takes** — Claude Code reads `.mcp.json`, Cursor and VS Code each have their own
file and their own schema. The parts that matter are the same everywhere: a
command, its arguments, and stdio. Check your client's own documentation for
the exact key names rather than assuming the block below transfers verbatim.

One honest caveat, and it is about the catalog rather than the protocol: `skill`
and `agent` artifacts install into `.claude/skills/` and `.claude/agents/`,
which mean something to Claude Code specifically. Other kinds do not —
backend plugins, UI components and templates install to ordinary project paths.
So any client gets full discovery and working code for most kinds; a Claude
skill pulled from Cursor lands in a directory Cursor does not read. `kind` is
deliberately an open string (`schema.ts:105`), so nothing in the design blocks
adding a client-specific kind later.

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
all dead weight for a stdio server with a small curated tool set. It depends on
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

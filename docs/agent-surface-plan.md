# One core, many surfaces — MCP, and the command registry that makes it safe

**Status: research + proposal. Nothing here is built.** Written to be approved,
amended, or rejected.

Prompted by a real direction from the DeliveryOS discussion: *"you give me an
MCP, I'll connect it to my Claude instance or some AI harness, and I'll drive it
using that."* The question is not "can we add MCP" — we can. It's **how to add a
third consumer of the engine without tripling the drift we already have, and
without turning a local dev tool into a remote-code-execution path.**

Grounded in: an audit of both existing surfaces, hexagonal-architecture
research, BuilderIO's `agent-native` framework as prior art, and a second pass
over the discussion transcript.

---

## 1. MCP is not a new feature

It's the third consumer that makes an already-tracked problem worth fixing.
`PLAN.md`'s own "What's next" lists it: *"the CLI exposes 15 commands and the
sidecar 40, with nothing shared between them, so they drift."* MCP moves the cost
of ignoring that from 2× to 3×.

**The engine is already a clean core.** Zero `console.*` in hand-written engine
code (the only hits under `src/engine/` are inside generated third-party
bundles), zero `process.cwd()`, zero `commander` imports. `interface GithubClient`
(`src/engine/github/github.ts:6-31`) is already a real driven port with two
implementations. `ProgressCallback` (`src/engine/pull/pull.ts:53`) is already an
injected output port.

**What's missing is one layer above it.** Neither surface derives argument
handling from a schema — the sidecar uses three ad-hoc helpers
(`src/sidecar.ts:118-135`), the CLI uses commander reducers. That's *why* the
drift is invisible:

| Invisible drift | Evidence |
|---|---|
| `--remote` optional in CLI `wiring`, **required** in sidecar `checkSourceDrift` | `src/cli/commands/wiring.ts` vs `src/sidecar.ts:708` |
| CLI `list` reports skipped manifests; sidecar **silently drops them** | `src/cli/commands/list.ts:25-37` |
| 91 lines of `toPushOptions` exist **only** on the CLI; sidecar casts raw | `src/cli/commands/push.ts:65` vs `src/sidecar.ts:410` |
| CLI `check-updates --apply` hits **all** artifacts; sidecar requires an `id` | `src/sidecar.ts:457` |
| **No CLI equivalent of `catalog.refresh`** | the cache-staleness gap `README.md` already documents |
| `hasWiring` dispatch gate written **three times** | `pull.ts:54-57`, `app.js:4554`, split across two sidecar keys |
| `remote add`/`remove` orchestration written twice | `remoteAdd.ts:13-27` vs `sidecar.ts:169-187` — the sidecar comment admits it *"mirrors `runRemoteAdd`'s order exactly"* |

**Scale:** 42 distinct operations after dedup (25 sidecar-only, 2 CLI-only,
15↔13 overlapping). Coverage through the real surface: sidecar 12/40 (30%), CLI
9/15 (60%). Real coverage lives in the engine — 59 files in `test/unit/`.

---

## 2. What `agent-native` proves

`defineAction` returns a **plain inert object**, not a class or registrar
(`packages/core/src/action.ts:1136-1197`). Three details worth copying:

1. **Schema → JSON Schema converted once, at definition time**
   (`action.ts:1535`); the MCP adapter does no runtime conversion
   (`mcp/build-server.ts:2064-2085`).
2. **Surface is a context value, not a code path.** `ctx.caller` ∈ `"cli" |
   "mcp" | "http" | "frontend" | …` (`action.ts:35-43`), and `authorize` is baked
   *inside* `run` (`action.ts:1266`) so no surface can forget it.
3. **Risk is declared, not inferred** — `readOnly`, `needsApproval`, `audit`
   (default-on for mutations).

### The lesson: put the gate *inside* the handler, not beside it

This is the most valuable thing in the whole framework, and it's stated in their
own source comment (`action.ts:1250-1256`):

> *"`run` is the one thing all six dispatch sites (agent loop, HTTP route,
> frontend, MCP, A2A, CLI) go through… `needsApproval` took the flag route and is
> consequently honoured only inside the agent loop."*

Verified enforcement of `needsApproval`:

| Surface | Enforced? |
|---|---|
| Agent loop | Yes — `production-agent.ts:6109-6215`, fail-closed on a throwing predicate |
| MCP | Yes — elicitation + single-use DB nonce, `build-server.ts:1912-2013` |
| **HTTP** | **No.** The normal `/_agent-native/actions/<name>` route never consults it; only the WebMCP surface *excludes* gated actions (`action-routes.ts:903`) |
| **CLI** | **No.** `scripts/runner.ts:404-415` calls `run` directly; zero references |
| A2A | Excluded rather than gated (`action-filters-a2a.ts:184`) |

`authorize` works everywhere because `wrapRunWithAuthorize` bakes it **inside**
`run` (`action.ts:1258-1275`). `needsApproval` fails on two surfaces because it's
a flag an adapter has to remember to read.

**Design rule for us:** every gate — exposure, approval, effect classification —
must be enforced by wrapping the handler, so an adapter physically cannot skip
it. A flag beside the handler is a flag someone will forget.

**Two other anti-patterns to avoid.** It is **default-exposed** (`mcpTool ??
(agentTool !== false)`, `action.ts:1221`) — reachable unless you opt out. And
`hasMcpOAuthScope` **returns `true` when scopes are undefined**
(`oauth-token.ts:76-82`), so non-OAuth callers are unscoped rather than denied.

### Two mechanisms worth copying wholesale

**Static guards.** `guards/` is ten *source-code scanners* — not runtime
interceptors — centralised in one place (`cli/doctor.ts:57-68`):
`no-unscoped-credentials`, `no-env-credentials`, `no-env-mutation`,
`no-localhost-fallback`, `db-tool-scoping`, and others. Opt-out requires an
inline comment with a reason.

That's how you prevent the flag-drift bug class *mechanically* — **but only
inside CI, and this repo has none.** No `.github/`, no workflows, no hooks, while
58 unit-test files, ~10 e2e files, `lint --max-warnings 0`, `typecheck` and six
`ui:*` audit scripts all exist and pass. Nothing runs any of them but a human who
remembers to.

A guard with no CI is a script someone remembers to run — precisely the
discipline-not-mechanism failure the guard was meant to replace. The reference
implementation even gates its strictness on `Boolean(process.env.CI)`, so ported
as-is it would silently no-op here.

**So CI is the precondition, not a nice-to-have.** ~20 lines running three
commands that already pass turns 58 test files from documentation into
enforcement. The guard contract is worth adopting *after* that, and the
three-outcome convention below is the part that matters.

**Audit as the outermost wrapper.** `resolveAuditAttach` (`audit/config.ts:49-58`)
defaults ON for mutations, opt-in for reads, and attaches *outside* everything
else (`action.ts:1062-1064`) — **so denials get recorded too**. Redaction happens
before storage: ~20 sensitive key names, heuristics for bearer tokens, ≥32-char
opaque strings, `sk_`/`ghp_`/`AKIA`/`AIza` prefixes, and webhook URLs with the
secret in the path (`audit/redact.ts:14-63`). Their header comment: *"The audit
log must never become a secondary store of secrets."*

### Their flagship rule names a bug class we already have

From their `AGENTS.md`, stated as the single most repeated cause of user reports
in that repo:

> *"A `catch`, default, or coercion that returns a value callers cannot
> distinguish from success is a bug, not a guard. 'Absent' and 'unreadable' must
> be different values; a truncated run is not a completed one; a dropped payload
> is not an empty one… each layer coerces a failure into a clean value, so every
> layer above it reports something confidently wrong and nobody can see it.
> Prefer a loud, typed failure over a plausible-looking normal state."*

DeliveryOS has independently hit this three times — and **fixed only one**:

| Instance | Status |
|---|---|
| `verifyBuild` reported "npm not on PATH" identically to "your code doesn't compile" | **Fixed** (Phase 10's timeout/tool-not-found work) |
| Sidecar `list` **silently drops** skipped manifests the CLI reports (`src/cli/commands/list.ts:25-37`) | **Open** — a parse failure coerced into a clean empty list |
| A stale remote cache makes `list` report "no such artifact" for one that exists | **Open** — §7.1; a dropped payload reported as an empty one |

Both open instances become *worse* under MCP, because an agent will relay
"that artifact doesn't exist" as fact. They're worth fixing on their own merit.

They also mechanised the rule as a guard literally named `no-silent-coercion`.

### Their guard design has three outcomes, not two

Worth copying exactly: **exit 0 passed, exit 1 failed, exit 2 could not run.** A
diff-scoped guard that can't resolve a base ref exits 2, renders as SKIPPED, and
the runner then **refuses to print "All checks passed"** — in CI it fails the
run. Their comment: *"Never reintroduce an `exit(0)` for a check that inspected
nothing; that is the flagship rule above, violated inside the thing that enforces
it."*

Directly applicable: `deliveryos-status` today reports pass/fail. "Could not run"
is a third state it should have, for exactly this reason.

Their newer guards are also **diff-scoped**, checking only lines the current
branch added — but that exists because that repo carries thousands of
pre-existing violations. A codebase this size should fail on the whole tree and
clear the backlog. Adopt the diff machinery only if a guard's first run produces
a backlog you won't clear.

**Verdict: steal the pattern, not the framework.** `@agent-native/core` is one
package with 77 runtime + 31 peer dependencies (Drizzle, Nitro, React, yjs), no
split. Its registry is also *not* a catalog competitor — shadcn-schema doc
distribution, no manifests or versioning.

---

## 3. The design: a command registry

One typed definition per operation, consumed by every surface. A table, not a
framework.

```ts
defineCommand({
  name: 'artifact.pull',
  input: z.object({ id: z.string(), remote: z.string().optional() }),
  effect: 'writes-local',        // 'reads' | 'writes-local' | 'writes-shared' | 'spends'
  emitsProgress: true,
  surfaces: ['cli', 'sidecar'],  // explicit allowlist, never inherited
  run: (input, ctx) => pullArtifact(ctx.projectDir, input.id, …, ctx.onProgress),
});
```

**Stays per-surface, because it genuinely can't be unified:** progress sinks
(sidecar writes JSON-RPC lines at `src/sidecar.ts:739`; CLI passes `undefined`),
stdout formatting (and the sidecar's hard stdout ban at `src/sidecar.ts:5-8`,
which every CLI action body violates by design), flag ergonomics, and
confirmation gating.

---

## 4. The five problems that decide whether this works at all

Found by working through what actually breaks. Any one of these unaddressed
makes the MCP server either useless or dangerous.

### 4.1 There is no `cwd` — and that's a security problem, not just an ergonomic one

Every engine function takes `cwd`/`projectDir` as a parameter. The CLI gets it
from `process.cwd()`; the sidecar gets it from the app, which knows which project
the user selected. **An MCP server has neither.** Claude Desktop spawns it from
its own install directory, not from the user's project.

So `projectDir` has to come from somewhere — and if it's a plain tool argument,
it's **agent-influenceable**. The engine's containment checks
(`resolveContainedPath`, `resolveContainedTargetFile`) all validate paths
*within* `cwd`. They do not validate `cwd` itself. An agent talked into
`projectDir: "C:\Users\me\.ssh"` gets writes there, and every containment check
still passes.

**The transcript already contains the answer.** Vaibhav described exactly this:

> *"our MCP will ask the user: do you have a UI library? … after three, four
> questions the configuration is done. And that MCP for that given client now has
> all the information. So we might need one server for a given client. In that
> server layer we are going to persist everything — even a local SQL file. That's
> sufficient."*

So: **a session-config step, persisted server-side, not a per-call argument.**
`projectDir` is registered once by the human (out-of-band — a config file or an
explicit `configure` call the human answers), and every tool call resolves
against that. Tools never accept a project path.

### 4.2 `remote add` via MCP is a remote-code-execution chain

This one I initially missed entirely. Consider:

1. Agent calls `remote add <attacker-url>`
2. Agent calls `pull <id>` from it
3. `pullArtifact` runs the manifest's `post_install` — **an arbitrary shell
   command** (`src/engine/pull/pull.ts`, 10-minute timeout)

Two findings make this materially worse than "most artifacts are unsigned":

- **You don't even need `post_install`.** The auto-run denylist
  (`SENSITIVE_TARGET_PREFIXES`, `src/engine/pull/wiring.ts:46`) is applied
  **only** to `wiring_actions.targetFile` (`:176`, its sole use). Nothing applies
  it to `install_target`, which the schema checks only for `..` escapes. So
  `install_target: .git/hooks` parses, passes containment (it *is* inside the
  project), and `cpSync` writes an executable hook there. `.claude/` isn't on the
  list at all — and `test/unit/manifest.schema.test.ts:73` explicitly blesses
  `.claude/agents/my-agent.md` as an ordinary target.
- **A valid signature does not gate any of it.** `computePayloadDigest` hashes
  files under the payload path; **the manifest is never an input**
  (`src/engine/provenance/digest.ts:33-51`). So `post_install`, `post_remove`,
  `install_target`, `payload_path` and `wiring_actions` all sit outside the
  signature — a fully valid signature is compatible with an arbitrary
  `post_install`.

That's arbitrary code execution reachable from two tool calls, and signing does
not prevent it.

**`remote add` and `remote remove` must never be MCP tools.** Full stop, not
"gated." Remote registration is a human trust decision made out-of-band. MCP
`pull` operates only on already-registered remotes.

### 4.3 `config --set` puts secrets into model context

I had `config` in the safe tier. **That's wrong.** `config <id> --set
AUTH_SECRET=<value>` as a tool call means the secret value travels through the
agent's context window — into the conversation transcript, into whatever the
client logs, and to the model provider. The CLI keeps it local; a terminal
doesn't forward what you type to anyone.

**agent-native solved exactly this, and states the principle**
(`secrets/substitution.ts:1-12`):

> *"The raw secret value NEVER enters the model's context — substitution happens
> after the agent emits its tool call and before the request is dispatched."*

The agent emits `${keys.AUTH_SECRET}`; server-side `resolveKeyReferences` swaps
in the real value. Four supporting layers: an AES-256-GCM vault that **refuses to
start in production without key material** (`secrets/crypto.ts:1-31`); read-back
is **masked to `last4()` only**, never plaintext (`secrets/storage.ts:126`); the
**write path is HTTP handlers, not agent actions** (`secrets/routes.ts`), with
workspace writes gated to org owners/admins; and outbound scrubbing of injected
secret values from results (`automation/index.ts:247-271`).

They also name the residual gap honestly: there is **no framework-wide scrubber
on successful tool inputs**. Nothing stops an action schema accepting a plaintext
secret as a string — that's in model context by construction, before any
framework code runs. Their answer is architectural, not a runtime interceptor.

**Recommendation:** exclude `config --set` from MCP for Stage 2. The desktop form
and the CLI already cover it, and "the write path is not an agent action" is the
cleaner answer than trying to sanitise one. If a real need appears, the
`${keys.X}` reference form is the shape to adopt — not a literal value with
redaction bolted on.

### 4.4 Our own audit logs would store secrets in plaintext

Found while checking DeliveryOS against agent-native's rule that *"the audit log
must never become a secondary store of secrets."*

`WiringMergeLogEntry` and `BuildFixLogEntry` store **full file content** —
`before: string; after: string` (`src/engine/pull/requestWiringMerge.ts:225-226`,
`:296-297`). And there is **no redaction anywhere in the engine** (verified: the
only `sanitize` references are about path segments, not values).

So if `applyBuildFix` or `applyWiringMerge` ever touches a file containing a
credential, that credential is written verbatim into
`.deliveryos/wiring-merge-log.jsonl`. Two aggravating factors: the AI flows can
target *any* file the manifest names, and `.deliveryos/` gets **no gitignore
check at all** — only `.env.local` does, and that's a warning, not enforcement.

This is **independent of MCP** and worth fixing regardless. Minimum: a
`looksSecret()`-style redaction pass before append, modelled on
`audit/redact.ts:14-63`, plus extending the gitignore check to cover
`.deliveryos/`.

### 4.5 A single `pull` can block for fifteen minutes

`pullAndAutoWire` runs `post_install` (10-min timeout,
`POST_INSTALL_TIMEOUT_MS`) and then a real project build (5-min timeout,
`BUILD_VERIFY_TIMEOUT_MS`). Worst case, one tool call blocks for ~15 minutes with
no output. Clients will time out; the operation keeps running; the agent has no
idea what happened.

**Correction — my first answer here was wrong.** I proposed "expose
`pull --no-wire` only, so no `post_install`/build runs." **`--no-wire` does not
stop `post_install`.** The branch calls `pullArtifact`
(`src/cli/commands/pull.ts:57`), which runs `execSync(manifest.post_install)`
unconditionally (`src/engine/pull/pull.ts:282`) — and then prints the output
eight lines later, so it is visibly running. The flag skips wiring actions and
the build check, nothing else. Its help text (*"just copy the payload… nothing
else in the project should be touched"*, `pull.ts:37-39`) is **incorrect and
should be fixed regardless of MCP.**

So the only real options are: return a job handle immediately with a
`get_status` tool, or give `pullArtifact` a genuine no-execute mode that
`--no-wire` currently only claims to be. The second is the smaller change and
fixes a wrong help string at the same time.

---

## 5. The safety model (revised)

**Read-vs-write was the wrong axis.** It would have shipped a read-only server
with no use case — `deliveryos-check-first` already gives Claude Code catalog
access by shelling out. The axis that actually predicts risk is **what the
operation can reach**:

| Effect | Operations | MCP? |
|---|---|---|
| **`reads`** | `list`, `wiring`, `check-drift`, `check-updates` (no apply), `readInstallParamValues`, log readers | **Yes** |
| **`writes-local`** — lands in the user's own project, reversible | `pull --no-wire`, `scan` | **Yes** (§4.5) |
| **`writes-shared`** — visible to the whole org, someone has to clean it up | `push`, `remote add`/`remove` | **`push` = Stage 3 decision. `remote add`/`remove` = never (§4.2).** |
| **`spends`** — costs real money, and writes on a human's prior say-so | the six AI `request*`/`apply*` pairs | **Never** |
| **structurally impossible** | `wire-with-claude` (TTY-inheriting interactive session) | **Never** |
| **secret-bearing** | `config --set` | **Never as a literal (§4.3)** |

Two operations need a call I initially got wrong:

- **`remove`** — I called it "reversible." It isn't, quite: it deletes
  `installTarget` and every `wiredFiles` entry. If the user edited those, the work
  is gone. Note the existing inconsistency: the **app confirm-gates Remove**
  (`app.js:4780`) but the **CLI doesn't**. Since MCP can't rely on a client
  prompting, `remove` sits with `push` as a Stage 3 decision, not Stage 2.
- **`push`** — the specific reason isn't general caution. Push is all-or-nothing
  over the whole pulled folder with **no diff preview and no confirmation**
  (verified). An agent pushing a filled-in risk register would publish client
  data to a shared repo.

**The mechanism stays as designed:** exposure is **default-closed** and declared
per operation, enforcement is central and **fails closed** — precisely to avoid
agent-native's own bug where MCP honoured `needsApproval` and its CLI silently
did not.

---

## 6. The MCP surface is curated, not generated

42 operations do **not** become 42 tools. A large tool surface burns client
context and makes the agent worse at choosing. The registry is internal; the MCP
surface is a deliberately small, task-shaped facade:

| Tool | Wraps |
|---|---|
| `deliveryos_search_catalog` | `list` + freshness (§7.1) |
| `deliveryos_inspect_artifact` | manifest, kind, install params, signed status, wiring preview |
| `deliveryos_pull` | `pull --no-wire` |
| `deliveryos_project_status` | `check-updates` + `check-drift` + configured/wired state |
| `deliveryos_scan_project` | `scan` |
| `deliveryos_activity` | the two audit-log readers |

Six tools, not forty-two. Each returns structured data plus a human-readable
summary, because agents relay prose better than they relay JSON.

---

## 6b. Bonus: the same repo answers the SharePoint question

Parked earlier as "orthogonal, needs its own scoping." It turns out
`agent-native` has solved this shape twice, and the pattern ports directly.

`FileUploadProvider` (`file-upload/types.ts:55-90`) and `PlatformAdapter`
(`integrations/types.ts:279-427`) share one idea: **explicit capability
negotiation instead of assumed uniformity.**

```ts
capabilities?: Partial<PlatformAdapterCapabilities>  // declare what you can do
assertPlatformCapability(adapter, capability)         // enforce at the call site
```

Applied to DeliveryOS's remote backends:

| Backend | `opensPullRequests` | `hasVersionHistory` | `supportsAtomicWrite` |
|---|---|---|---|
| GitHub | ✅ | ✅ | ✅ |
| SharePoint | ❌ | ✅ | ❌ |
| S3 / plain folder | ❌ | ❌ | ❌ |

`push` then **asserts** `opensPullRequests`, so a SharePoint remote fails with a
real, specific message instead of half-working — which is what the discussion was
actually worried about (*"HR compliance are not using Git anywhere"*).

Three details worth copying with it: a **narrow required core** plus optional
capability blocks; **per-request config resolution** (their S3 impl resolves from
env *or* the secret store, `file-upload/s3.ts:71-100`); and a runtime
`registerFileUploadProvider()` registry rather than a compile-time union.

Still its own phase — but no longer an open question about *shape*.

## 6c. Dry-run by default

`agent-native package inspect|add|eject` is **dry-run by default**; `--apply`
is required before anything is written (`cli/package-lifecycle.ts:140-151`). The
inventory pass called this manifest-driven "copy this unit into app-owned source"
flow the single most copyable idea in the repo — and it's the same problem `pull`
solves.

It is the right destination — MCP `pull` returning *"here is what would land,
and what it would overwrite"*, with `apply: true` triggering the argument-bound
approval round-trip from §5.

**But it is not the cheap early win I first called it.** The reference gates one
call at the end of a path that always plans and always reports, which works
because its CLI takes an injectable `io` and `spawn`. DeliveryOS writes through
`console.*` **directly inside commander action closures — 56 sites across 11
files, with no returned exit codes.** Planning and reporting aren't separable
today. So this depends on Stage 1, not an afternoon.

## 7. Edge cases, and the tests that prove them

Not hypotheticals — each maps to real code paths in this repo. **But read this
list smaller than it first appears:** path containment, `install_target` and
`payload_path` escapes, five `removeArtifact` containment cases, lockfile
concurrency and the signature fail-closed paths **already have tests** against
the surfaces that exist today. Only two items below are genuinely new work, and
only once an MCP server exists — §7.6's negative list and §7.7's
advertised-equals-callable assertion. The rest are either covered or are bugs to
fix rather than tests to write.

### 7.1 Stale catalog reports an artifact as nonexistent

There is no CLI `catalog.refresh`, and the local cache doesn't refetch on every
call. An MCP `list` can therefore confidently report "no such artifact" for one
merged an hour ago. **This happened in real use while writing this document** —
the cache had to be checked by hand.

> **Test:** merge an artifact upstream, call `search_catalog` without refreshing,
> assert the result carries a `catalogFetchedAt` (or auto-refreshes). Never a bare
> empty list.

### 7.2 Three concurrent writers on the lockfile

The lockfile has a real inter-process lock, added after a genuine race between
background auto-sync and a manual pull. MCP is a **third** writer — and the
desktop app may have the same project open, auto-syncing.

> **Test:** MCP `pull` of artifact A concurrent with the app's auto-sync tick
> touching artifact B → assert both lockfile entries survive. This mirrors the
> existing `lockfile.test.ts` concurrency tests.
>
> **Test:** two MCP clients (Desktop + Code) connected simultaneously, both
> pulling → no lost entry, no corrupt JSON.

### 7.3 The gitignore warning gets swallowed

`applyInstallParams` returns a warning when `.env.local` isn't gitignored — as
*text*. An agent may simply not relay it, and a real secret-exposure warning
disappears.

> **Test:** assert the warning is a **structured field** in the tool result, not
> only prose, so a client can surface it independently of the model's summary.

### 7.4 Old-shape lockfile entries

`removeArtifact` deliberately **refuses** for entries with no recorded
`installTarget`, with a "locate and delete manually" message.

> **Test:** old-shape entry → clean typed error through the MCP boundary, not a
> stack trace or a crash.

### 7.5 Path-escape attempts

> **Test:** any tool argument resembling a path (`id`, `remote`) that escapes the
> configured project → refused. And a negative test that **no tool accepts a
> project path at all** (§4.1).

### 7.6 Negative tests — what must *not* be reachable

> **Test:** `tools/list` does **not** contain `remote add`, `remote remove`,
> `config`, `push`, `remove`, `wire-with-claude`, `scaffold-backend-plugin`, or
> any of the six AI `request*`/`apply*` pairs.

These are the cheapest and most valuable tests here: they fail loudly the day
someone adds a surface flag carelessly, which is exactly how agent-native's own
gap happened.

### 7.7 Advertised must equal callable

agent-native's `withoutExternalOptOuts` strips opt-outs from the action registry
**itself**, not just from the listing (`build-server.ts:463-478`), and rebinds
`tool-search` to close over the *advertised* set (`:432-448`) — so nothing is
ever "hidden from `tools/list` but still reachable via `tools/call`."

> **Test:** for every excluded operation, assert `tools/call` **also** rejects it
> — not merely that it's absent from `tools/list`. Absence from a listing is not
> an access control.

### 7.8 No session context means refuse, never fall back

Their catalog filter **denies by default when there is no request context**
(`mcp-client/visibility.ts:29-31`), with a source comment forbidding a dev
fallback.

> **Test:** start the MCP server with no configured project, call every tool →
> all refuse with a "configure a project first" error. Specifically assert none
> of them silently resolves against `process.cwd()`.

### 7.9 Audit-log redaction (independent of MCP)

Per §4.4.

> **Test:** run `applyWiringMerge` on a file containing a plausible credential
> (`sk-…`, a 40-char token) → assert the appended `.jsonl` entry does **not**
> contain it verbatim.

### 7.10 Unsigned artifact from a registered-but-untrusted remote

Even with `remote add` excluded, a remote registered long ago may host an
artifact whose `post_install` is hostile.

> **Test — as originally written, invalid.** It asserted `post_install` does not
> run under `--no-wire`. It does (§4.5). The real test is the inverse, and it is a
> *bug* test rather than an MCP one: assert that `--no-wire` **does** currently
> execute `post_install`, so the behaviour is pinned while the help text is
> corrected — then flip the assertion once a genuine no-execute mode exists.

---

## 8. Staged plan

Each stage is worth doing even if the next never happens.

### Stage 0 — CI, then the real bugs (no MCP dependency, do this regardless)

**CI comes first, before anything else in this document.** ~20 lines running
`lint`, `typecheck` and `test` — all three already exist and pass. Without it,
every guard proposed here is a script someone remembers to run, and 58 test
files stay documentation rather than enforcement.

Then, in order:

- The confirmed bugs in
  [docs/hardening-ledger.html](hardening-ledger.html) — seven of them are
  user-visible today and none needs a design decision. The two that matter most
  here: `install_target` never passes through the auto-run denylist (§4.2), and
  `applyUpdate` resolves `install_target` raw while `pull` records the
  `adaptSrcDirPath`-shortened form, so **no `app/`-layout project can ever update
  any `src/`-prefixed artifact**.
- Port `audit/redact.ts` (195 lines, zero imports, ships with its own spec) and
  call it at the two audit-log append sites — closes §4.4 the same day.
- Extract `addRemote`/`removeRemote` into `src/engine/remote/` — one function
  instead of five re-implemented steps per surface
- Collapse the `hasWiring` gate from three copies to one
- Add the two missing CLI tests: `remote add` success path, `remote remove` cache
  deletion
- Fix the skipped-manifest drop **and** `buildCatalog`'s unbounded
  `lastSkippedManifests` array **together** — wiring `takeSkippedManifests()`
  into the long-lived sidecar on its own makes the first call return N duplicates

### Stage 1 — the command registry

One `defineCommand` table; both existing surfaces migrate onto it. Schema-derived
validation replaces the ad-hoc helpers, which is what makes §1's invisible drift
visible. Introduces `effect` as a first-class field.

### Stage 2 — `deliveryos mcp`, six curated tools

Stdio. Session-configured project scope (§4.1). `reads` + `writes-local` only,
`pull` restricted to `--no-wire` (§4.5). All of §7's negative tests written
**first** — they're the guardrail, not the afterthought.

### Stage 3 — decide `push`, `remove`, and `config` separately

With Stage 2 in real use. Each needs its own answer: `push` needs a diff preview
first, `remove` needs a confirmation story, `config` needs the by-reference form.

### Deliberately not doing

- **A full hexagonal refactor.** Ports for `fs`, clock and subprocess would each
  have one implementation; Cockburn's own guidance is "two, three or four ports."
  `GithubClient` became a port when a real second consumer appeared;
  `src/engine/git/git.ts` still constructs `simpleGit()` inline at five call sites
  (`:21`, `:56`, `:99`, `:115`, `:138`) because nothing has needed otherwise.
- **Adopting `@agent-native/core`** (§2).
- **Fixing the known engine leaks** — `paths.ts:17` reading `DELIVERYOS_HOME`
  from env, `githubAuth.ts:15` hardcoding `execFileSync('gh', …)`, three direct
  `execSync` calls, `spawn('claude')`. Real, none blocking.
- **An HTTP surface.** Nearly free once the registry exists; nobody has asked,
  and it doesn't fit a tool that operates on the local filesystem.

---

## 8b. How to frame Stage 1 for approval

Worth stating, because it changes who owns the idea. At ~33:00 in the 2 Sep call,
Vaibhav describes RK's "Arc actions": wrapping any function with an input/output
schema plus *"the security layer"* so it becomes *"understandable by LLMs — MCP in
itself"* — and concludes you can expose an entire engine as MCP, **but only if you
wrap the whole thing as actions first.**

That is the command registry in §3, described by the person who would approve it,
before this proposal existed. Framing Stage 1 as *applying his pattern to
DeliveryOS* is both more accurate and considerably easier to approve than
presenting it as something found in a reference repo.

The same call also raises the bar this project already uses for when a port is
worth building — a real second implementation. He named SharePoint, S3 and *"a
folder somewhere"* as where clients actually keep their libraries, while only
local and GitHub work today. So `RemoteBackend` (§6b) is the one port that
already clears that bar.

## 9. Open questions

1. **Who is the first real MCP consumer?** `deliveryos-check-first` already
   covers Claude Code by shelling out. The real gain is *other* harnesses —
   Claude Desktop, another framework. Stages 0 and 1 don't depend on the answer;
   Stage 2 does.
2. **Does `pull --no-wire` via MCP actually help anyone?** Without wiring it's
   "copy files in" — useful for a UI component or a template, much less so for a
   backend plugin, which is the kind that needs wiring most. If the honest answer
   is no, Stage 2 shrinks to catalog discovery, and the case for MCP at all gets
   weaker. Worth deciding before building, not after.
3. **SharePoint / S3 as a remote backend.** Still its own phase, but §6b settles
   the *shape* — a capability-negotiating `RemoteBackend` port, ported from
   `PlatformAdapter`/`FileUploadProvider`. The open part is which backends are
   actually wanted, by whom.

4. **Persistent approval — deliberately not adopting theirs.** Worth recording
   why. Their one-shot grants are argument-hash-bound with a short TTL, but
   "always allow" is a **per-tool-name, per-user boolean, unbounded in time**
   (`agent/tool-approval-migrations.ts:48-67`). Approving one `push` therefore
   approves every future `push`. They mitigate it well — the policy-setting
   action carries `agentTool: false` so an agent cannot self-authorize — but the
   asymmetry is a real accepted risk. For `push` specifically, unbounded consent
   is the wrong default; the argument-bound single-use grant is the one to copy.

---

## 10. What was not examined

Stated so the blind spots are known rather than assumed away. `packages/core`
alone is **2,528 files / ~976k lines** (roughly half `.spec.ts`), plus 19 sibling
packages — reading all of it was never the plan.

Covered in depth: `mcp/` (50 files), `guards/`, `audit/`, `review/`, `secrets/`,
the approval path across all six surfaces, `action.ts`, `integrations/` and
`file-upload/` interfaces, `cli/` command surface and `package-lifecycle.ts`, and
a full inventory of all 20 packages plus ~90 `core/src` subsystems.

Their stated intent has now been read too — `PRODUCT.md` (*"the agent is part of
the application contract rather than a separate assistant layered on top"*) and
`AGENTS.md`, which is where the `no-silent-coercion` rule and the three-outcome
guard design above came from. `CLAUDE.md` is an empty file.

**Not read:** implementation bodies of `client/` (260k lines), `server/` (130k),
`agent/` (89k) beyond the approval path, `deploy/`, the `db` schema, `create.ts`
(4,126 lines), 8 of 10 guard bodies, `feature-flags/` (so I can't say whether a
flag is a usable per-tool kill switch), every `.spec.ts`, the ~50 `.agents/skills/`
documents, and root `templates/`/`examples/`/`e2e/`.

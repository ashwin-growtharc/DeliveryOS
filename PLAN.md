# DeliveryOS — phase plan

Where the project is and what's next.

The phase list was renumbered on 2026-08-28. It had reached 32 phases, several
of which were single bug fixes, and the later entries carried their whole
implementation narrative — 80, 140, even 212 lines apiece. That is a changelog,
not a plan. Related work is now merged into 15 phases; the blow-by-blow record
is preserved in [docs/plan-archive.md](docs/plan-archive.md), and
[CHANGELOG.md](CHANGELOG.md) still has the detailed release notes.

See the [renumbering map](#renumbering-map) at the bottom — code comments
referencing old phase numbers still reconcile through it.

---

## Phase 0 — Engine MVP — **Done**

Goal: `deliveryos pull` works against one throwaway test remote, no auth, no UI.

- Manifest schema and parser, remote registry, local cache clone
- `remote add`/`list`/`remove`, `list`, `pull`
- Per-project lockfile at `.deliveryos/lock.json`

## Phase 1 — Push — **Done**

Goal: `deliveryos push` opens a real GitHub PR from a local edit.

- Edit mode (diff against a pristine snapshot) and propose-new mode
- Version bumping, `--bump` for a larger-than-patch bump
- Metadata-only edits that touch no payload and bump no version

## Phase 2 — ArcOS as a remote — **Done** *(MVP/POC complete here)*

Goal: pull a real ArcOS catalog asset, edit it, push a real PR against `arc_os`.

- Proved the model against a repo with its own pre-existing layout
- `payload_path`, so a remote doesn't have to restructure itself to qualify

## Phase 3 — Desktop app — **Done** *(installer and fresh-machine test deferred)*

Goal: a real desktop app wraps the engine.

- Tauri shell (Rust + webview); the engine runs as a bundled stdio sidecar
- Browse, Detail, Pull, Push, Settings, and a live progress log
- **Deferred**: a signed installer per OS, and a fresh-machine install test

## Phase 4 — Team rollout — **Deferred, out of sequence**

Goal: multi-user profiles, role-based filtering, and real auth.

Blocked on GrowthArc not having real SSO/identity infrastructure yet. Rather
than block everything else, Phase 5 was done next, since nothing in it depends
on auth. Not started: auth/SSO, saved profile filters, stack-based routing,
per-resource review overrides.

## Phase 5 — Polish — **Mostly done**

Goal: round out the single-user app before team rollout.

- Drift detection (`check-updates`), with a distinct state for locally-edited
- Background auto-sync on a timer, silent unless it finds something
- Browse by tag, bulk "Pull all", metadata-only edits
- Scan: find reusable content already in a project and propose it
- **Deferred**: OS-level notifications, lifecycle/deprecation states,
  success-metrics tracking

## Phase 6 — UI Components — **Done**

Goal: a UI-component artifact can be proposed, reviewed with a real live
preview, and pulled.

- Sandboxed-iframe + esbuild preview pipeline, surviving Node SEA packaging
- Variant tabs and a props panel generated from the component's own types
- `preview.png` rendered at push time and embedded in the PR body
- Lazy-mounted preview grid, so a large design kit doesn't compile at once

## Phase 7 — Backend plug-and-play — **Done**

Goal: prove `kind: backend-plugin` the way UI components were proven.

- Install-time config collection (`install_params`), written to `.env.local`
- Signature verification **before** any file is written
- A wiring agent that applies mechanical setup and *suggests* — never
  silently applies — edits to existing project files
- `pull` auto-wires by default: a missing target file is written, an existing
  one is left untouched and named in the summary (`--no-wire` opts out)
- "Merge all with Claude", "already wired" detection, a persistent connection
  status panel, and a plain-language "How installing this works" explainer

## Phase 8 — Claude Code integration — **Done**

Goal: Claude Code checks the catalog before writing new code, and can answer
"what's the status".

- `deliveryos-check-first`: check the catalog, pull a match, wire it, verify
  the build
- `deliveryos-status`: one consolidated health answer
- The same check→pull→wire→test loop behind the app's own Pull button and
  Add New's autofill

## Phase 9 — Design kits and whole-project templates — **Done**

Goal: a `kind: template` bundle pulls as one unit and is reviewable before it
lands.

- Detail shows colour tokens, a component grid and a route map
- A design-quality check against the kit's own `GUIDELINES.md`

## Phase 10 — Backend-plugin operations — **In progress**

Goal: close the operational gaps a real code audit found in the install path —
plain engineering a real install feature normally has.

- Uninstall: `remove` deletes what was installed, plus a symmetric
  `post_remove` teardown
- Secrets safety net, `post_install` timeouts, post-pull secret rotation
- A real update-apply path — only for artifacts byte-identical to their
  pristine snapshot; anything locally edited is reported, never touched
- `scaffold-backend-plugin`: drafts `install_params`/`wiring_actions` from a
  real consumer file, for a human to review
- **Open**: config-form autofill's remaining sub-cases (deliberately descoped)

## Phase 11 — `wire-with-claude` and the embedded terminal — **Done**

Goal: hand the last mile — wiring a pulled plugin into the rest of a project —
to a real Claude Code session rather than a restricted subprocess.

- `deliveryos wire-with-claude <id>` builds context from the artifact's real
  resolved lockfile paths, never a hand-typed guess
- The desktop app runs the same thing in a terminal embedded in its own window
- A second real backend-plugin (`email-code-auth`) built to exercise it

## Phase 12 — Dark mode and the design system — **In progress**

Goal: the desktop app's own chrome is a real design system, not per-screen
decisions.

- A genuine dark palette (not an inversion), toggled from the sidebar
- Token layer completed: text colour, type, spacing, radius, motion, z-index
- Fonts vendored locally, so the app renders identically offline
- Enforced by `lint:css`, a contrast test in `npm test`, and a theme matrix
- **In progress**: responsive breakpoints, error states on the remaining
  views, keyboard reachability, primitive consolidation. See branch
  `overhaul/design-system-and-hygiene`

## Phase 13 — Quality passes — **Done**

Goal: audit the whole codebase rather than fixing only what gets reported.

- Two full-codebase audit passes, each fixing real bugs found by review
- A three-agent audit of the UI, engine and docs, which found a
  whole-project-delete bug in `remove` and an unlocked shared cache
- The test suite made genuinely green: two long-standing "flaky" failures were
  not flaky — one asserted the opposite of what the code does and passed only
  by reading another test's leftover state

## Phase 14 — Authoring and navigation — **Done**

Goal: make the hardest kind authorable, and the catalog navigable.

- A `backend-plugin-authoring` skill covering the failure modes only found by
  pulling one into a fresh project
- Starter Kits and Backend Plugins as their own sidebar destinations

## Phase 15 — Delivery tooling — **v1 proposed, awaiting PR review**

Goal: carry a delivery methodology — a scoping calculator, a risk register, a
friction log — the same way the catalog already carries code, without client
data ever reaching a shared remote.

Scoped in [docs/delivery-tools-requirements.md](docs/delivery-tools-requirements.md).
Approved 2026-09-01: the template/instance split, files over a live in-app
tool, and the v1 scope below. **Ashwin B owns** the risk library and
friction-log conventions. No first-test engagement identified yet — v1 was
built anyway, on the understanding that "done" still means a real engagement
used one, not that these three PRs merged.

- Three artifacts, each a real, working payload plus a required `README.md`
  stating the rule (fill in your own copy, never push it back) and the
  named owner: `scoping-calculator` (`dataset` — a real `.xlsx` with working
  formulas: day rate × complexity multiplier × days per phase, phases
  matching the delivery playbook order), `risk-register` (`doc` — a
  pre-listed risk library by engagement type: data platform / web app /
  AI-agent build, plus a blank live-register table), `friction-log` (`doc` —
  a weekly capture format, with the scrub-step rule written into its own
  README as a required step, not a judgment call)
- All three tagged `stacks: delivery-tooling`, so they're findable as a group
  even with no dedicated Browse category yet
- Proposed as real PRs against `growtharc-ai-helpers`: [#70](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/70)
  (risk-register), [#71](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/71)
  (friction-log), [#72](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/72)
  (scoping-calculator) — none merged yet, pending the same human review every
  other artifact goes through
- The shared blank and the filled-in copy are **never the same file** — blank
  inside `install_target`, filled copy outside it, so `push` structurally
  cannot see client data. Same split `.env.example`/`.env.local` already uses
- **Deferred, neither blocks v1**: a "Suggest" button filing a GitHub issue
  (small — octokit, `gh` auth and the `repo` token scope are already in place),
  and an "Improve the template" flow that edits the upstream copy (modelled on
  `metadataEdit`, which already opens a PR without reading local files)
- **Not doing**: a live tool inside DeliveryOS's own preview — the iframe has
  no `allow-same-origin`, so it can compute but can never save
- **Definition of done, still open**: one real engagement used one of these
  and we know whether it helped — not "three PRs merged"

## Phase 16 — One core, many surfaces — **Stage 2 read-only surface landed**

Goal: make the engine reachable from a third consumer (an MCP server, so any AI
harness can drive DeliveryOS) without tripling the CLI-vs-sidecar drift this
file already tracks under "What's next".

Full research and design in
[docs/agent-surface-plan.md](docs/agent-surface-plan.md) — grounded in an audit
of both existing surfaces, hexagonal-architecture research, and a systematic read
of BuilderIO's `agent-native` framework as real prior art (its MCP subsystem,
approval path across all six of its surfaces, guards, audit, secrets, and stated
design intent).

**The one design rule everything else follows from.** `agent-native` documents
its own bug in a source comment: `authorize` is honoured on all six of its
surfaces because it's baked *inside* `run`, while `needsApproval` is *"honoured
only inside the agent loop"* because it took the flag route — verified absent
from its CLI and its normal HTTP route. So: **every gate here — exposure,
approval, effect — must be enforced by wrapping the handler, never by a flag an
adapter is trusted to read.**

**The finding that reframes it:** MCP is not a new feature. It's the third
consumer that makes an already-known problem worth fixing. The engine is
*already* a clean core — no `console.*` in hand-written engine code, no
`process.cwd()`, no `commander` imports, `GithubClient` already a real port with
two implementations. What's missing is one shared layer above it.

**In-process, not shelling out, and not HTTP.** MCP calls the same engine
functions the CLI and sidecar already call, over stdio. The sidecar is proof the
shape works — it is an MCP server in all but protocol. Shelling out to the
`deliveryos` binary with agent-supplied arguments would reintroduce the exact
Windows shell-injection class this project already hit twice (Phase 7's
command-injection finding, Phase 11's argv-splitting bug). An HTTP API is also
wrong here: DeliveryOS operates on the local project, the local lockfile and
local git — the agent runs on the same machine as the files.

### Stage 0 — CI first, then the real bugs (do this regardless of MCP) — **Landed and verified**

**CI was the precondition for everything else in this phase, and it has now
run green on an independent machine** (draft PR #27, run `33742110681`).
Every step passed: install, codegen drift, lint, typecheck, design tokens, the
theme matrix and font-resolution browser audits, and the full 842-test suite. `.github/workflows/ci.yml` runs lint, typecheck, a
generated-file drift check, two browser audits and the full suite on
`windows-latest`; the runner choice and step ordering are in
[CHANGELOG.md](CHANGELOG.md). Until it landed, nothing ran any of the gates but
a human who remembered to — and a static guard without CI is a script someone
remembers to run, which is the exact failure the guard was meant to replace (the
reference implementation even gates its strictness on `Boolean(process.env.CI)`,
so ported as-is it would silently no-op here).

> **It has now run, and it worked.** Draft PR #27 executed it for the first
> time. Both runs report `event: pull_request` against the branch head, which
> settles the assumption the plan rested on: `pull_request:` resolves the
> workflow from the merge commit, not from the base branch. Had it resolved
> from base, the `.github`-less `main` would have produced **zero runs** —
> which presents as *nothing happening* rather than as a failure.
>
> It found a real defect on the first attempt, and not either of the two
> predicted as environmental (both of those passed). `artifact.push`'s progress
> assertion passed locally only because `gh` was authenticated on the developer
> machine; on a clean runner push throws at `getGithubToken()` before emitting
> anything. See [CHANGELOG.md](CHANGELOG.md) for the full account and the
> reason that assertion must not be loosened back to a bare `> 0`.
>
> So "all gates pass" no longer carries a silent "on one machine" caveat — for
> anything verified on or after `3b336c8`. Earlier claims in this file and in
> [CHANGELOG.md](CHANGELOG.md) predate the first run and should be read with
> that in mind.

The confirmed defects triaged in
[docs/hardening-ledger.html](docs/hardening-ledger.html) landed with it, on
branch `tier0/hardening-and-ci`; they are listed in the Tier 0 track below.
Against this list specifically:

- Done: `audit/redact.ts` ported and applied — at **four** audit-log append
  sites, not the two this list assumed, and with three documented deviations
  from the source. Closes the plaintext half of the Tier 0 item below
- Done: the sidecar no longer drops skipped manifests, together with
  `buildCatalog`'s unbounded `lastSkippedManifests` array — `catalog.list` and
  `catalog.refresh` now return `{ entries, skipped }`
- **Wrong when written**: the two "missing" CLI tests are not missing. `remote
  add`'s success path and `remote remove`'s cache-directory deletion both
  already exist, in `test/e2e/pull.e2e.test.ts`
- **Open**: extract `addRemote`/`removeRemote` into `src/engine/remote/`. The
  orchestration exists twice today (`src/cli/commands/remoteAdd.ts:13-27` vs
  `src/sidecar.ts:169-187`, whose own comment admits it "mirrors `runRemoteAdd`'s
  order exactly")
- **Open**: collapse the `hasWiring` dispatch gate from three copies to one
  (`src/cli/commands/pull.ts:54-57`, `src-tauri/spike-ui/app.js:4554`, and split
  across two sidecar keys)

### Stage 1 — the command registry

One typed definition per operation (name, input schema, `mutates`,
`emitsProgress`, `costsRealMoney`, an explicit `surfaces` allowlist, approval
posture, handler). Both existing surfaces migrate onto it. Schema-derived
validation replaces `requireString`/`optionalString`/`optionalStringRecord`
(`src/sidecar.ts:118-135`) and commander's ad-hoc reducers — which is what makes
today's **invisible drift** visible: `--remote` optional in CLI `wiring` but
required in sidecar `checkSourceDrift`; 91 lines of `toPushOptions` that exist
only on the CLI; no CLI equivalent of `catalog.refresh` at all. The
skipped-manifest example this list used to lead with is now fixed under Tier 0
— which is the point: it took a person noticing, because nothing made the two
surfaces disagree visibly.

Deliberately stays per-surface: progress sinks, stdout formatting, flag
ergonomics, and confirmation gating.

Paired with a **static guard** (`agent-native`'s `guards/` + `doctor` pattern, ten
source scanners in one place): fail the build if a registry entry reaches the MCP
allowlist without a declared `effect`, or if an `effect: 'writes-shared'` entry
reaches it at all. That is how the flag-drift bug class gets prevented
mechanically rather than by discipline. Copy their **three-outcome** convention
too — passed / failed / **could not run** — where a guard that inspected nothing
refuses to report success. `deliveryos-status` should gain that third state for
the same reason.

### Stage 2 — `deliveryos mcp` — **read-only half landed**

**What shipped:** `deliveryos mcp`, a stdio MCP server exposing four read-only
tools (`search_artifacts`, `get_artifact`, `catalog_overview`,
`refresh_catalog`). Architecture, client configuration and measured costs in
[docs/mcp-server.md](docs/mcp-server.md).

It is the third driving adapter and the first with a **declared port**.
`src/mcp/server.ts` depends on `DeliveryOsReadPort` and nothing under
`src/engine/**`; `engineAdapter.ts` is the single binding;
`src/cli/commands/mcp.ts` is the composition root. Enforced by
`test/unit/mcp.architecture.test.ts`, not by convention.

**"Advertised must equal callable" is satisfied structurally rather than by
stripping a registry:** there is no mutating method on the port at all, so
there is nothing to strip. The architecture test fails the build if the port
grows a `pull`/`push`/`remove`-shaped method.

**One correction to what this section said.** The planned test —
`await expect(client.callTool(...)).rejects.toThrow()` — does not work.
`McpServer` converts an unknown-tool `-32602` into a **resolved** result
`{ isError: true, ... }`. The rejection form passes for the wrong reason and
would keep passing the day someone actually exposes `artifact_pull`. Assert on
`res.isError`.

**One deliberate deviation, and why.** This section required
*session-configured project scope, never a tool argument*, on the grounds that
"every containment check in the engine validates paths within `cwd` while
validating `cwd` itself nowhere — so an agent-supplied project path is a real
escape." That reasoning is correct for a surface that **writes**: `pull` into
an agent-chosen directory is a genuine escape.

This surface writes nothing. `cwd` is used only to read the lockfile and to
compare install targets against pristine snapshots; the tools return
`localStatus` and `installTarget`, never file contents (those come from the
remote cache). The residual exposure is an existence oracle over paths the
calling agent can almost always already `stat` itself. Against that, requiring
out-of-band registration would make the server unusable in the one client that
matters most — an editor whose whole job is the project it is open in.

So `cwd` stays a tool argument, and the part of the rule that still bites is
enforced: it must be an absolute path to a directory that exists
(`assertUsableProjectDir`, with e2e coverage). **When `pull` is reconsidered
under Stage 3, the session-scope rule applies to it in full** — this deviation
does not carry forward to a mutating tool.

**And the argument is pinned to the transport it depends on.** "The calling
agent can already `stat` that path itself" is true for a *local stdio* client
and false for a remote one — over streamable HTTP or SSE, an agent-supplied
`cwd` probes the **server's** filesystem, which the caller could not otherwise
reach, and the safety argument silently stops holding while the code still reads
as safe. That is the same shape as the `needsApproval` bug this phase is built
around: a gate that holds on one surface and is *assumed* to hold on all of
them. So `mcp.architecture.test.ts` has a fourth structural gate asserting the
server is stdio-only. Adding a second transport means deleting that test, and
deleting it is where this decision gets re-examined instead of inherited.

**Still open from this section:** dry-run-by-default is not needed by a
read-only surface, so it stays open — but it is **much cheaper than this
document claimed**, and the claim is corrected below rather than repeated. The
`--no-wire` warning stands unchanged.

#### The original design, for reference



Stdio, in-process. Two things decide whether it is safe at all:

- **Session-configured project scope, never a tool argument.** An MCP server has
  no meaningful `cwd`, and every containment check in the engine validates paths
  *within* `cwd` while validating `cwd` itself nowhere — so an agent-supplied
  project path is a real escape. The project is registered once by the human,
  out-of-band, and **every tool refuses when no project is configured** rather
  than falling back to `process.cwd()`.
- **Dry-run by default** — the right destination, but Stage-1-dependent, not an
  afternoon. The reference gates one call at the end of a path that always plans
  and always reports, because its CLI takes an injectable `io`/`spawn`.
  ~~DeliveryOS writes through `console.*` inside commander closures at 56 sites
  across 11 files, so planning and reporting aren't separable yet.~~
  **Corrected — this was wrong, and it was never right.** Counted against the
  real source: `src/engine/**` has **zero** `console.*` in hand-written code
  (the 44 apparent hits are string literals inside `*.generated.ts` vendored
  bundles). Every site is CLI-layer — 74 across 12 files in
  `src/cli/commands/`, 88 across 13 including `src/cli/output.ts`. The site
  count matched nothing then or now.
  The *inference* was the real error: **CLI print sites cannot block plan/apply
  separation, because the engine never prints.** It already returns structured
  data to every caller, `src/cli/output.ts` is already a presentation module,
  and `deliveryos check-updates` vs `--apply` is a working plan/apply split
  over a mutating operation. Most decisively, `applyUpdate.ts:262` already
  computes `computeChangedFiles(payloadSrc, pristineTarget)` — the plan —
  *before* the `rmSync` at `:275`, then discards it on every refusal path.
  A real `planPull()` is ~60–80 lines composing already-pure functions, not a
  phase of work. This contradicted `PLAN.md`'s own line above, which was right.
  **And note:** `--no-wire` is *not* a safe substitute — it still runs
  `execSync(manifest.post_install)` (`src/cli/commands/pull.ts:93` → `src/engine/pull/pull.ts:407`). The help
  text that claimed otherwise was corrected under Tier 0; the behaviour is
  unchanged and pinned by a characterization test, so this remains true of any
  MCP surface that reaches for `--no-wire` as a safety measure.

Exposes six task-shaped tools, not 43 operations — `agent-native`'s own code
comment records that dumping ~105 schemas (~100k tokens) was a recurring footgun.
And **advertised must equal callable**: excluded operations are stripped from the
registry the server sees, not merely hidden from `tools/list`.

### Stage 3 — decide `push`, `remove` and `config` separately, with evidence

Each needs its own answer, not one policy: `push` needs a diff preview first (it
is all-or-nothing over the whole folder today, with no confirmation); `remove`
needs a confirmation story (the app confirm-gates it at `app.js:4867-4871`, the CLI
does not); `config --set` needs a by-reference form, because a literal secret in
a tool call is in model context by construction (`agent-native` solved this with
`${keys.NAME}` indirection plus keeping secret writes off agent actions
entirely).

### The safety rule this phase exists to protect

Every `apply*` handler in the sidecar today **assumes a human already clicked
something** (`src/sidecar.ts:536-546`, `:569-579` -- the APPLY halves; `:524`/`:554` are the read halves, which write nothing) — that confirmation lives in
the desktop UI, not the handler. So: exposure is **default-closed** (opt in per
operation, never inherited), every gate wraps the handler rather than sitting
beside it, and the six AI `request*`/`apply*` pairs (build-fix, wiring-merge,
wiring-placement, anti-pattern-fix) stay off MCP entirely — each spends real
money and writes real files on a human's prior say-so.

**`remote add`/`remove` are excluded outright, not gated.** Register a remote,
pull from it, and the manifest's `post_install` runs arbitrary shell — code
execution from two tool calls. Two things make it worse than "most artifacts are
unsigned": `install_target: .git/hooks` **used to** write an executable hook via
`cpSync` with no `post_install` needed at all, because the auto-run denylist at
`src/engine/pull/wiring.ts:46` was applied only to `wiring_actions.targetFile`.
That half is closed — Tier 0 now checks `install_target` against the same list
at pull and update time. What still stands: **a valid signature doesn't gate any
of it**,
because `computePayloadDigest` never takes the manifest as an input
(`src/engine/provenance/digest.ts:33-51`), leaving `post_install`,
`install_target` and `wiring_actions` outside the signature entirely. Remote
registration stays a human trust decision made out-of-band.

`wire-with-claude` also stays CLI-only: it spawns a TTY-inheriting interactive
session, which structurally cannot be a one-request/one-response tool call.

### Deliberately not doing

- **A full hexagonal refactor.** Ports for `fs`, clock and subprocess would each
  have exactly one implementation; Cockburn's own guidance is that apps have
  "two, three or four ports." `GithubClient` became a port only when a real
  second consumer (tests) appeared.
- **Adopting `@agent-native/core`** — one package, 77 runtime + 31 peer
  dependencies (Drizzle, Nitro, React, yjs), no split. Steal the pattern, not the
  framework. Its registry is also *not* a competitor to the catalog: shadcn-schema
  doc distribution, no manifests or versioning.
- **Fixing the known engine leaks** — `paths.ts:17` reading `DELIVERYOS_HOME`
  from env, `githubAuth.ts:15` hardcoding `execFileSync('gh', …)`, three direct
  `execSync` calls, `spawn('claude')`. All real, none blocking.
- **An HTTP surface.** Nearly free once the registry exists; nobody has asked,
  and it doesn't fit a local-filesystem tool.
- **Persistent "always allow" approval.** `agent-native` has it, but scoped
  per-tool-name and unbounded in time — approving one `push` would approve every
  future one. Their single-use, argument-hash-bound grant is the half worth
  copying; the persistent half is not.

**Found along the way, and it settles a question parked earlier:** the
SharePoint/S3 remote-backend idea from the discussion has a known shape now.
`agent-native`'s `PlatformAdapter` and `FileUploadProvider` both use **explicit
capability negotiation** instead of assumed uniformity — a backend declares what
it can do, and call sites `assert` the capability. Ported here, that's a
`RemoteBackend` port where GitHub declares `opensPullRequests: true`, SharePoint
declares `false`, and `push` asserts it — so a SharePoint remote fails with a
real message instead of half-working. Still its own future phase; no longer an
open question about shape.

**Answered.** The first consumer is Claude Code in this repo, and it is wired:
`.mcp.json` is committed, running `npx tsx src/index.ts mcp` so a fresh clone
needs only `npm install`. Verified through the SDK's own `StdioClientTransport`
— the one Claude Code uses — with all four tools, the error paths, and a real
`refresh_catalog` against the live remotes. Note this does change every
teammate's Claude Code session: they will be prompted to approve the server on
opening the repo. The remaining question is the useful one: **does an agent
reading this catalog actually change what gets built** — which only shows up in
use, not in a test.
`deliveryos-check-first` already gives Claude Code catalog access by shelling out
to the CLI, so the real gain is *other* harnesses. Stages 0 and 1 don't depend on
that answer; Stage 2 does. Second open question: does `pull` via MCP genuinely
help anyone once it's dry-run-first and wiring-free — because if not, Stage 2
shrinks to catalog discovery and the case for MCP weakens.

## Tier 0 hardening — **In progress**

A cross-cutting track: fix what's broken and prove someone outside the build
team benefits, rather than build more on an unproven foundation.

- Done: the lockfile race between auto-sync and a manual pull/push; PR
  merge/close status polled on the same tick as version drift; the
  security/provenance model
- Done: CI at `.github/workflows/ci.yml` — lint, typecheck, a generated-file
  drift check, two browser audits and the full suite, on `windows-latest` for
  its preinstalled Edge; `ui:screenshots` as `workflow_dispatch`, `ui:contrast`
  excluded as a report that cannot fail
- Done: 16 e2e teardowns moved onto `rmDirWithRetry` — the Windows EPERM/EBUSY
  race that fails a whole file with every test in it passing
- Done: `pristinePath` segment assertion, and `readLockfile` dropping entries
  whose `id` is not usable as a single path segment — a hand-edited `lock.json`
  could `rmSync` outside the project
- Done: `install_target` checked against `SENSITIVE_TARGET_PREFIXES` at pull and
  update time, with `.deliveryos/` added; `.claude/` deliberately excluded and
  pinned by tests
- Done: `install_params` newline injection into `.env.local` refused and
  reported, at the write site rather than in the schema
- Done: `install_target` read from the lockfile in `applyUpdate`, `catalog` and
  `push` — the `push` path had been opening PRs deleting payloads upstream
- Done: a vanished artifact reported by `check-updates --apply`, not a silent
  no-op
- Done: a failed post-push cache reset reported on `PushResult` and through
  `onProgress`; `--no-wire`'s help text corrected, its behaviour left unchanged
  and pinned as a characterization test
- Done: 70 test files / 759 tests, from 69 / 710; lint and typecheck clean.
  Full narrative in [CHANGELOG.md](CHANGELOG.md)
- Done — the audit logs no longer store secrets in plaintext. Found while
  checking this repo against `agent-native`'s rule that *"the audit log must
  never become a secondary store of secrets."* `src/engine/audit/redact.ts` is
  applied at all four `.jsonl` append helpers. The gitignore half of that item
  is still open, below.
- **Open**: get one engineer outside the build team to actually adopt it
- **Open**: track real usage numbers — deferred until there's an adopter to
  design the tracking around
- **Open — one live instance left of a silent-coercion bug class.**
  `agent-native`'s `AGENTS.md` names this as the single most repeated cause of
  user reports in that repo: *"a `catch`, default, or coercion that returns a
  value callers cannot distinguish from success is a bug, not a guard… a dropped
  payload is not an empty one."* The sidecar dropping skipped manifests is fixed,
  as are the swallowed post-push cache reset and the unreported vanished
  artifact. Still open: a stale remote cache makes `list` report "no such
  artifact" for one that exists. It gets worse under Phase 16, because an agent
  will relay it as fact.
- **Open — the signature covers payload bytes only.** `computePayloadDigest`
  (`src/engine/provenance/digest.ts:33-51`) never takes the manifest, so
  `post_install`, `install_target` and `wiring_actions` all sit outside it — a
  valid signature is compatible with an arbitrary `post_install`. Fixing it is a
  breaking cross-repo protocol change against `growtharc-ai-helpers`' signing
  workflow, and needs every signed artifact re-signed.
- **Open — `post_remove`/`post_install` are read LIVE from the mutable remote**
  at removal and update time, with nothing pinned. `removeArtifact` refuses to
  re-read `install_target` because it is "remote-controlled, MUTABLE"
  (`src/engine/pull/removeArtifact.ts:153`), then executes that same manifest's
  *current* `post_remove` forty lines later. `LockEntry` records nothing to pin
  to, and six existing tests depend on the live read.
- **Open — two false status messages on the build path.** `verifyBuild`
  (`src/engine/pull/verifyBuild.ts`) reports an unparseable `package.json`
  identically to "no build script", and `pullAndAutoWire` returns `{ran: false}`
  — defined as "no build command detected" — when it merely chose not to run
  one. Both need a widened `BuildVerificationResult`; three existing tests assert
  the wrong string today.
- **Open — `test/` is not typechecked at all.** `tsconfig.json` excludes it
  *and* scopes `include` to `src/**/*.ts`, and vitest transpiles without
  checking. 7 real type errors hide there today, across 3 files.
- **Open — `src-tauri/spike-ui/app.js` has zero lint coverage.** It is not in
  ESLint's `ignores`; the only config object carrying rules is scoped to
  `files: ['**/*.ts']`, so `--print-config` reports `rules: 0` for all 7,464
  lines. ~15 browser globals would leave a 2-warning backlog. Blocks "Split
  `app.js`" under What's next.
- Done: `.deliveryos/` now carries its own `.gitignore` in every project it
  lands in — written by `ensureProjectDeliveryOsDir`, which is the single way
  that directory gets created. Inside the directory rather than appended to the
  project's own `.gitignore`, which belongs to whoever owns the repo. This is
  also what makes the stale-absolute-path bug unreachable: a committed
  `lock.json` was the delivery mechanism.
- Done: `push` refuses a stale-version push, naming the files that changed both
  upstream and locally — the second pusher's edits reverted a merged change as
  an ordinary forward diff git had no reason to flag, and two concurrent pushes
  bumping to the same version left the loser's change never offered as an update
  to anyone; `--force` stamps the overlap into the PR body
- Done: `pull` refuses to overwrite local edits on the CLI (the app had always
  confirm-gated it), and `--force` fetches first — `pullArtifact` was the one
  major operation that never fetched
- Done: `post_install` surfaced before a pull, verbatim and ungated, in Detail,
  `list --json` and the CLI; the Configuration tab no longer hides itself for an
  artifact whose only side effect is a command
- Done: `check-updates --apply` prints the changed-file set `applyUpdate` had
  already computed, used to delete files, and thrown away
- Done: commit identity passed with `git -c` instead of baked into the shared
  cache clone, and existing baked-in config cleared with `--unset-all` — the
  first pusher on a shared box had won forever
- Done: four defects an independent review found in those guards, one of which
  broke a single user's ordinary push → merge → push; the stale-push guard now
  skips while your own `pendingPr` is in flight, since content comparison cannot
  tell "builds on" from "overwrites"
- Done: first real browser coverage of the desktop UI —
  `test/e2e/detailDisclosure.e2e.test.ts`, four tests against the real
  `index.html` with a stubbed engine; one UI defect had already shipped because
  nothing in the repo could catch it
- Done: 775 tests, from 766; lint and typecheck clean. Full narrative in
  [CHANGELOG.md](CHANGELOG.md)
- **Open — the audit logs still hold full file bodies.** Redaction reduces
  credential exposure and the directory is no longer committed by accident, but
  a private project's source is still copied verbatim into a local file. Worth
  deciding whether `before`/`after` need to be full bodies at all, or whether a
  bounded diff would serve the Activity panel just as well.
- **Open — `redactEmbeddedSecrets` is a heuristic, not a parser.** camelCase
  (`authSecret`) and SCREAMING_SNAKE are both covered now, but a secret reaching
  a log in any other shape — assigned through an intermediate variable, say —
  still passes.
- **Open — `compareVersions` is asymmetric on prerelease versions.**
  `1.0.0-beta.1` vs `1.0.0` and the reverse **both** return 1:
  `Number('0-beta')` is `NaN`, `NaN !== NaN` is true, and the comparator then
  takes the "greater" branch in both directions
  (`src/engine/sync/sync.ts:28`). Unreachable from `manifest.version` — the
  schema enforces `/^\d+\.\d+\.\d+$/` — and reachable only from a hand-edited
  lockfile. Shared by `checkForUpdates`, `applyUpdate` and now the push
  staleness check.
- **Open — the signing pipeline structurally excludes 92% of the catalog.**
  `sign-artifacts.mjs:98` in the artifact repo is
  `if (manifest.kind !== 'backend-plugin') continue;`, so all 213 skills,
  agents, rules and commands are unsigned **by design**, not adoption lag. 3 of
  230 artifacts are signed.
- **Open — signatures are self-attesting.** The artifact declares its own
  `certificate_identity`, which `src/engine/provenance/verify.ts:59` passes
  straight to sigstore — the party being verified chooses the verification
  parameters. A "require signatures" setting would need a pinned expected
  identity **per remote**, and `RemoteEntry`
  (`src/engine/remote/remoteRegistry.ts:7`) is `{ name, url, addedAt }` with
  nowhere to put one.
- **Open — `review_required` is read by nothing.** Declared and required in the
  manifest schema (`src/engine/manifest/schema.ts:159`), written only on
  `push --new`, unsettable from the desktop wizard, and `false` in 229 of 230
  manifests.
- **Open — `owner` is unverified free text.** Never compared to the pushing
  identity; already `ai-helpers-import` on 210 of 230.
- **Open — an in-flight change is invisible to everyone else.** `pendingPr` is
  per-project-per-machine and `GithubClient` has no `pulls.list`, so nobody can
  see that a colleague already has a PR open on the artifact they are about to
  edit.
- Decided, not open: **the app has no force affordance for `push`, and should
  not get one.** A one-click force over a colleague's merged change is exactly
  the operation that should stay hard, and the app already has the safe
  resolution — discard the local edit, take the current version, re-apply.
  Recorded here so it is not later filed as a gap.
- **Open — performance, measured against the real 230-artifact catalog.** Not
  in scope for this track, but the numbers contradict the assumption that
  artifact *count* is what hurts. The Tauri host spawns a fresh 118 MB sidecar
  **per RPC** with a measured ~1.1 s floor, and opening one Detail card fires
  10–13 of them unqueued, four being literal duplicates. `computeChangedFiles`
  (`src/engine/push/diff.ts:142`) costs ~5 ms per pulled file pair and runs on
  every Browse navigation — 811 ms measured for one 153-file design kit.
  `refreshCatalog` (`src/engine/catalog/catalog.ts:127`) fetches every remote
  sequentially with no timeout, ~6–8 s each. The preview cache is unbounded and
  never evicts stale compiler generations — 70.9 MB for 9 artifacts, 33.8 MB of
  it already dead. And `buildCatalog` is 141 ms for 237 entries with no
  memoization, called ~2× per RPC.

---

## What's next

Ordered by what blocks value, not by phase number.

1. **Finish Phase 12** — responsive breakpoints (there are none today), error
   states on the remaining views, keyboard reachability, toast dismissal, and
   consolidating 10 chip classes and 5 card classes into one of each.
2. **Make the gates real** — CI now exists and runs lint, typecheck and the
   full suite on every push, but ESLint still does not cover the 343KB desktop
   frontend at all and `test/` is still not typechecked, so what CI enforces is
   narrower than it looks. The frontend now has its first real *behavioural*
   gate — `test/e2e/detailDisclosure.e2e.test.ts`, four browser tests against
   the real `index.html` — which is what caught the last UI defect class, but
   it is coverage, not static analysis: the 7,464 lines still lint to
   `rules: 0`.
3. **Split `app.js`** — 7,464 lines in one IIFE. Deferred until ESLint covers
   it, so the move happens with a linter watching.
4. **A shared command surface** — the CLI exposes 15 commands and the sidecar
   40, with nothing shared between them, so they drift. Now scoped properly as
   **Phase 16** (see above), which found this is worse than described: the
   `hasWiring` gate exists in three places, and the surfaces silently disagree on
   things like whether `--remote` is required. The "only the sidecar copy has
   tests" line was imprecise — sidecar `remote.add`/`remove` are genuinely
   asserted, and so — contrary to what this line originally said — are the CLI
   equivalents: `remote add`'s success path and `remote remove`'s
   cache-directory deletion are both really asserted in
   `test/e2e/pull.e2e.test.ts`.

Deliberately unranked: **Phase 15 (delivery tooling)**'s v1 is proposed
(3 PRs, awaiting review), but "done" is a real engagement using one of them —
not something that belongs on a list ordered by engineering effort.

---

## Renumbering map

Old numbers appear in `CHANGELOG.md` and in code comments. They resolve here:

| Old | New |
|---|---|
| 0–5 | unchanged |
| 6, 18 | Phase 6 — UI Components |
| 7, 12, 19, 20, 21, 23, 24, 32 | Phase 7 — Backend plug-and-play |
| 8, 9, 10 | Phase 8 — Claude Code integration |
| 11 | Phase 9 — Design kits |
| 13, 16, 17, 29 | Phase 10 — Backend-plugin operations |
| 25, 27, 28 | Phase 11 — `wire-with-claude` |
| 14 | Phase 12 — Dark mode and the design system |
| 15, 22, 26 | Phase 13 — Quality passes |
| 30, 31 | Phase 14 — Authoring and navigation |

*DeliveryOS · Pre-Phase-16 triage · 2 Sep 2026*

# Hardening Ledger

*Sixteen defects found while validating the MCP proposal — most of which have nothing to do with MCP, and eleven of which affect people using DeliveryOS today. Plus the one piece of missing infrastructure that makes the proposal's own safety mechanism a no-op.*

## The call

Don't write the MCP test suite. Write the tests that pay off whether or not MCP ever ships — which is most of them — and fix the bugs the investigation turned up along the way. Concretely, in this order:

1. **Add CI.** There isn't any. One workflow running the three scripts that already exist.
2. **Fix the seven confirmed bugs** in the ledger below. All are user-visible today; none require a design decision.
3. **Copy one file** — `audit/redact.ts` — to stop writing plaintext secrets into the audit log.
4. **Then** revisit Stage 1. The registry is a good idea whose payoff is invisible until CI can enforce it.

## Three facts that reorder the plan

*Each one independently changes what's worth building first*

**Infrastructure — There is no CI**

No `.github/`, no workflows, no git hooks, no husky. Yet the repo ships 58 unit test files, ~10 e2e files, `lint --max-warnings 0`, `typecheck`, and six `ui:*` audit scripts. Nothing runs any of them but a human who remembers to.

**Sponsor direction — Building is on hold**

From the 2 Sep call, ~37:44: *"right now, don't start coding anything."* The week's priority is playbook material for leadership sign-off — *"then we start building."* Stage 2 is premature by the sponsor's own instruction.

**Existing coverage — The scary paths are already tested**

Path containment, `install_target` and `payload_path` escapes, five `removeArtifact` containment cases, lockfile concurrency and signature fail-closed paths all have tests. The proposal's §7 list is less novel than it reads.

Together these invert the plan's priority. Its centrepiece is a static guard that "fails the build" when a command reaches the MCP allowlist without a declared `effect`. There is no build to fail. The reference implementation this was drawn from enforces its equivalent with `strictSkips = Boolean(process.env.CI)` — with no CI, the whole mechanism silently no-ops, which is exactly the discipline-not-mechanism failure the guard was meant to replace.

## Confirmed bugs

*Verified against the source this session — each has a file:line you can open*

### Projects without a `src/` directory can never update any artifact
*Verified · User-facing*

`pull` computes the install target through `adaptSrcDirPath`, which strips a leading `src/` when the consuming project doesn't use that convention, and records the shortened path in the lockfile. `applyUpdate` resolves `manifest.install_target` raw. The two never match, so the relocation guard fires on every update — forever — and blames the artifact: *"This version moved install_target … Remove and re-pull it instead."* Any `app/`-layout project pulling any `src/`-prefixed artifact hits this permanently.

**Where** `src/engine/sync/applyUpdate.ts:163` vs `src/engine/pull/pull.ts:218` · guard fires at `applyUpdate.ts:168`

### The auto-run denylist guards one field and misses the other
*Verified · Security*

`SENSITIVE_TARGET_PREFIXES` — `.git/`, `.github/workflows/`, `.vscode/`, `.husky/` — is referenced exactly once, for `wiring_actions.targetFile`. Nothing applies it to `install_target`, which the schema only checks for `..` escapes. So `install_target: .git/hooks` parses, passes containment (it *is* inside the project), and `cpSync` writes an executable hook there. No `post_install` required. `.claude/` isn't on the list at all, and the schema test suite explicitly blesses `.claude/agents/my-agent.md` as an ordinary target.

**Where** `src/engine/pull/wiring.ts:46` defined, `:176` sole use · `src/engine/manifest/schema.ts:147` · `test/unit/manifest.schema.test.ts:73`

### A swallowed failure can leave the cache serving unmerged PR content
*Verified · Regression risk*

After a push, the remote cache is reset off the push branch. That reset is wrapped in a bare `catch {}`. The comment twelve lines above documents the exact production incident this guards against — *"A `pull` immediately after a `push` installed the user's own unreviewed PR content"* — and the catch re-opens it. The stated mitigation ("the next fetchAndReset would recover the cache anyway") isn't a guarantee: `pullArtifact` never fetches. And this is the most likely reset to fail, since it runs immediately after the push's network I/O.

**Where** `src/engine/push/push.ts:638-642` · rationale for the guard at `:625-637`

### The audit log writes file contents verbatim, with no redaction anywhere
*Verified · Secrets*

`WiringMergeLogEntry` and `BuildFixLogEntry` both store `before` and `after` as full file contents. There is no redaction pass anywhere in the engine — the only `sanitize` references concern path segments. The AI flows can target any file a manifest names, so any credential in a touched file lands verbatim in `.deliveryos/wiring-merge-log.jsonl`. Aggravating: `.deliveryos/` gets no gitignore check at all; only `.env.local` does, and that's a warning rather than enforcement.

**Where** `src/engine/pull/requestWiringMerge.ts:225-226` · `src/engine/pull/fixBuildFailure.ts:195-211` · gitignore check at `installParams.ts:164-170`

### `--no-wire` does not stop `post_install`, and its help text says it does
*Verified · Docs + design*

The `--no-wire` branch calls `pullArtifact`, which runs `execSync(manifest.post_install)` unconditionally. The flag skips wiring actions and the build check, nothing else — and the same branch prints the post-install output eight lines later, so it is visibly running. The help text ("just copy the payload and write install_params") is wrong. This is also what breaks the MCP proposal's §4.5 mitigation and its §7.10 test, both of which assume `--no-wire` means no execution.

**Where** `src/cli/commands/pull.ts:57` → `src/engine/pull/pull.ts:282` · help text at `pull.ts:37-39`

### Skipped manifests accumulate forever in the sidecar
*Verified · Latent*

`buildCatalog` appends to a module-level `lastSkippedManifests` array and never clears it; only `takeSkippedManifests()` drains it. Its own doc comment claims it holds "the most recent `buildCatalog()` call." In the CLI this is invisible — one call, one take, process exits. In the long-lived sidecar, `buildCatalog` runs on every list, pull, push, scan and sync, and the array grows unbounded. **This matters because of the fix below it:** the moment anyone wires `takeSkippedManifests()` into the sidecar, the first call returns N duplicate copies. Fix both together or the fix produces a new wrong answer.

**Where** `src/engine/catalog/catalog.ts:50-52` appends · `:64` declares · `:66-68` drains

### The sidecar silently drops manifests the CLI reports
*Verified · Correctness*

`src/cli/commands/list.ts:25` is the only caller of `takeSkippedManifests()` in the entire source tree. Six other `buildCatalog()` call sites ignore it, the sidecar's `catalog.list` among them. A manifest that failed to parse becomes an absence rather than a reported problem — a parse failure coerced into a clean empty list.

**Where** `src/sidecar.ts:149-152` · other droppers: `pull.ts:83`, `push.ts:255`, `scan.ts:73`, `applyUpdate.ts:79`, `sync.ts:78`, `sync.ts:172`

## Reported, not yet independently verified

*Single-source with a file:line — worth confirming before acting, listed by consequence*

### Payload symlinks defeat containment entirely
*Reported · Security*

Containment is purely lexical — `path.resolve` plus a prefix check, never `fs.realpathSync` — so a symlink anywhere in the destination path is invisible to it, while `cpSync` runs with the default `dereference: false`. Two escapes were reproduced empirically on Node v24.14.1: a payload directory symlink pulled outside content *in*, and a destination that already contained a junction let a re-pull write *out*. The second shape is ordinary in pnpm and monorepo workspaces.

**Where** `src/engine/pull/pull.ts:270` · `src/engine/paths.ts:197-199`

### Signatures cover payload bytes only — not the fields that execute
*Reported · Trust model*

`computePayloadDigest` hashes files under the payload path; the manifest is never an input. So `post_install`, `post_remove`, `install_target`, `payload_path`, `install_params` and `wiring_actions` are all outside the signature. A *fully valid* signature is compatible with an arbitrary `post_install`. Separately, an unsigned artifact skips verification silently at the first statement of the function, and `PullResult` has no field in which to report that it was never verified.

**Where** `src/engine/provenance/verify.ts:25-27` · `src/engine/provenance/digest.ts:33-51` · `pull.ts:24-42`

### `post_remove` is re-read from the mutable remote after install
*Reported · Trust model*

`removeArtifact` deliberately refuses to re-read `install_target` from the manifest because it is "a remote-controlled, MUTABLE field" — then forty lines later re-resolves that same manifest and executes its *current* `post_remove`. The same applies to `applyUpdate`: an artifact with no `post_install` at v1.0.0 can ship one at v1.0.1, executed when the user clicks Update. The fix is symmetry — pin the command to what the lockfile recorded, exactly as `installTarget` already is.

**Where** `removeArtifact.ts:150-170` vs `:228-241` · `applyUpdate.ts:201-223`

### Three status messages state things about the project that aren't true
*Reported · Correctness*

An unparseable `package.json` returns `undefined` from build detection, which renders as *"No build command was found, so nothing could be verified automatically"* followed by *"There's nothing else to do."* — about a project whose build config is broken. A pull with no wiring actions returns `{ran: false}`, which is *defined* as "no build command could be detected", producing the same false claim about projects that plainly have one. And an artifact whose manifest failed to parse falls through `applyUpdate`'s one bare `continue`, so asking about that specific artifact answers *"No updates available."*

**Where** `verifyBuild.ts:63-68` · `pullAndAutoWire.ts:40-46` with `postInstallHealthSummary.ts:101-125` · `applyUpdate.ts:86-90`

### Four smaller conflations
*Reported*

`install_params` keys and defaults are unconstrained strings written into `.env.local` by raw interpolation, so a newline injects extra env lines (`schema.ts:36,39` → `installParams.ts:136-140`). `pristinePath` skips the `assertSafePathSegment` its sibling path builders apply, and feeds a recursive delete (`paths.ts:119-121`). `applyWiring` files a security refusal into the same `needsReview` array as an ordinary "look at this file" (`applyWiring.ts:38-66`). And both audit-log readers drop unparseable lines without counting them, in logs whose own comments call torn writes routine (`fixBuildFailure.ts:334-339`).

## What to actually write

*Ordered by payoff per hour — every row uses infrastructure that already exists*

| Work | What it buys | Cost |
| --- | --- | --- |
| A CI workflow — `.github/workflows/ci.yml` | Runs `lint`, `typecheck` and `test` — all three already exist and pass. Turns 58 test files from documentation into enforcement, and is the precondition for every guard in Phase 16. | ~20 lines |
| Fix + test `applyUpdate`'s src-dir mismatch — `applyUpdate.ts:163` | Unblocks updates for every non-`src/` project. Pull with `install_target: src/lib/x` into a project with a root `app/`, bump the version, assert `applied === true`. | 1 line + 1 test |
| Copy `audit/redact.ts` — `from agent-native, 195 lines` | Zero imports, no framework coupling, ships with a 124-line spec. Apply at the two audit-log append sites. Closes the plaintext-secrets gap the same day. | copy + 2 calls |
| Run `install_target` through `isSensitiveTargetPath` — `pull.ts, before cpSync` | Closes the `.git/hooks` write. Table-test the prefixes plus `.claude/` and `.deliveryos/`; assert refusal and that the file is unchanged. | 1 call + 6 cases |
| Give `buildCatalog` its own skip list — `catalog.ts:50-64` | Must land before wiring skips into the sidecar, or the first call returns duplicates. Test: call `buildCatalog()` twice, take once, assert length 1. | 2 lines + 1 test |
| Report the push cache-reset failure — `push.ts:638-642` | Add a field to `PushResult`; stub `fetchAndReset` to throw on the second call and assert the warning surfaces rather than the cache silently sitting on the push branch. | 1 field + 1 test |
| Symlink escape tests — `test/unit, no git needed` | Two cases: a payload symlink pulling outside content in, and a junction in the destination letting a re-pull write out. Both were reproduced already, so the assertions are known before the fix. | 2 tests |
| Extract `runCli` to a shared helper — `currently triplicated` | Copy-pasted verbatim into three e2e files. Pure friction removal — every new e2e test currently starts with a fourth copy. | ~15 lines |

Two details that make all of this cheaper than it looks. First, hostile manifests don't need checked-in fixtures or git: `test/unit/pull.test.ts` already establishes writing the remote cache directly to disk under a temp `DELIVERYOS_HOME`, which skips cloning entirely. Second, both `pullArtifact` and `removeArtifact` take a test-only timeout override as their last parameter — so a hostile `post_install` test doesn't have to wait out a ten-minute ceiling. One Windows-specific trap: use `rmDirWithRetry` from `execHelpers` in teardown for any test that runs a subprocess, or a surviving grandchild holds a lock and cleanup fails with EPERM.

## Deliberately not doing

*Each of these was considered and rejected for a stated reason*

The §7 MCP test suite

Ten scenarios for a surface that doesn't exist, whose sponsor has paused building, and much of whose substance is already covered against the surfaces that do exist. Two of them are worth writing the day an MCP server starts — the exact-equality assertion on `tools/list` and its paired `tools/call` negative proving an excluded tool is denied rather than merely hidden — and not before.

The static guard system, for now

Right idea, wrong order. A guard with no CI is a script someone remembers to run. The contract is ~150 lines of dependency-free code and stays cheap to adopt later; the three-outcome convention (pass / fail / *could not run*) is the part genuinely worth copying, and it only means anything inside a CI run.

Dry-run-by-default as an early win

It reads like a copy and isn't. The reference implementation gates one call at the end of a path that always plans and always reports, which works because its CLI takes an injectable `io` and `spawn`. DeliveryOS writes through `console.*` directly inside commander action closures — 56 sites across 11 files, no returned exit codes. That's a Stage 1 refactor, not an afternoon.

Diff-scoped guards

They exist upstream because that repo has thousands of pre-existing violations to work around. A codebase this size should fail on the whole tree and fix the backlog. Adopt the diff machinery only if a guard's first run produces one you won't clear.

## One thing worth telling Vaibhav

*From the 2 Sep call — it makes Stage 1 an easier sell*

Around 33:00 he describes "Arc actions": wrapping any function with an input/output schema plus "the security layer" so it becomes "understandable by LLMs — MCP in itself," and concludes that you can expose an entire engine as MCP *but only if* you wrap the whole thing as actions first. That is the command registry, described by the person who'd approve it, months before the proposal was written.

Framing Stage 1 as *applying his pattern to DeliveryOS* rather than as a pattern found in a reference repo is both more accurate and considerably easier to approve. The same call also settles the shape of the SharePoint question — he named SharePoint, S3 and "a folder somewhere" as where clients actually keep their libraries, and today only local and GitHub work. That's the one port with a real second implementation waiting, which is exactly the bar he set for when a port is worth building at all.

- `Verified` — opened and confirmed in the source this session
- `Reported` — single-source with a file:line — confirm before acting

Sources: full read of both plan documents · the 1h34m call transcript · four parallel investigations across `src/engine`, `src/cli`, `src/sidecar.ts`, `test/` and the `agent-native` reference repo · direct verification of every claim marked Verified.

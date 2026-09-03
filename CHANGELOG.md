# Changelog

All notable changes to DeliveryOS are recorded here, newest first. See
[PLAN.md](PLAN.md) for the phase-by-phase roadmap and
[ARCHITECTURE.md](ARCHITECTURE.md) for design rationale.

---

## The catalog, readable by an agent (branch `tier0/multi-user-hardening`)

`deliveryos mcp` runs a Model Context Protocol server over stdio. It exposes
four read-only tools over the same engine the CLI and the desktop app use, so
an agent working in a project can finally see what DeliveryOS has.

The gap it closes: the catalog is 237 artifacts across three remotes -- 80
skills, 68 agents, 35 rules, 30 commands, plus components, templates and
backend plugins -- and the only ways to look at it were a CLI a person types
into and an app a person clicks. The one party that would most benefit from
knowing "there is already a `code-reviewer` agent for this" was the only one
that could not ask.

775 tests before, 813 after. `lint --max-warnings 0` and `typecheck` clean.
Full detail and client configuration in [docs/mcp-server.md](docs/mcp-server.md).

> **Every gate result in this entry is from one developer machine.** The CI
> workflow added in the preceding batch has executed **zero** times: it exists
> only on unpushed `tier0/*` branches, and `origin/main` has no `.github`
> directory, so GitHub has never had a workflow to run. Read "clean" throughout
> this entry as "clean locally, unverified by CI." Pushing a `tier0/*` branch
> and opening a PR without merging would exercise both the suite and the CI file
> itself for the first time.

`.mcp.json` is committed, so Claude Code offers to enable the server on opening
this repo — verified end to end through the SDK's own `StdioClientTransport`,
the transport Claude Code itself uses, rather than only a hand-rolled spawn.
**This changes every teammate's Claude Code session:** they get an approval
prompt on first open.

### The third driving adapter

DeliveryOS already had two adapters over one core -- the CLI and the Tauri
sidecar -- but neither declared what it needed from the engine; both imported
engine functions directly. That works until you want to test one, at which
point there is no seam: `test/e2e/sidecar.e2e.test.ts` builds a ~100-line
subprocess harness with manual request/response correlation because driving the
sidecar any other way is impossible.

This adapter declares a port. `src/mcp/server.ts` depends on
`DeliveryOsReadPort` and nothing under `src/engine/**`; `engineAdapter.ts` is
the one file that binds it; `src/cli/commands/mcp.ts` is the composition root
where the binding actually happens. `buildMcpServer` takes its port as a
**required** argument rather than defaulting to the real one -- the convenience
of a default would have cost exactly the property that makes the seam worth
having.

The payoff is not architectural taste. `test/unit/mcp.server.test.ts` covers
the whole tool surface with a fake port -- no subprocess, no filesystem, no git
remote -- in **87 ms**. That is the difference between a guardrail people keep
and one they delete when it gets slow.

- **The boundary is enforced, not documented.**
  `test/unit/mcp.architecture.test.ts` fails the build if `server.ts` or
  `ports.ts` gains a value import from `../engine/`, if more than one file in
  `src/mcp/` reaches the core at runtime, or if the port grows a
  `pull`/`push`/`remove`-shaped method. Verified by injecting each violation
  and watching it go red. Without it the seam decays silently -- the fake port
  stops resembling production while every test keeps passing.

### Read-only, on purpose

Every mutating operation here either writes into someone's project or opens a
PR against a shared remote, and the multi-user batch immediately preceding this
one exists *because* those paths destroy work when two actors disagree. An
agent is a second actor. So there is no `pull`, `push` or `remove` tool, and
"no mutating method" is enforced on the **port** rather than on today's tool
list -- adding mutation should require revisiting the consent question, not
just appending a `registerTool` call.

`test/unit/mcp.server.test.ts` asserts `artifact_pull`, `artifact_push` and
`artifact_remove` are all uncallable -- via `tools/call`, not merely absent
from `tools/list`. Asserted on `isError` rather than `rejects.toThrow()`,
because `McpServer` converts an unknown-tool `-32602` into a *resolved* result:
the rejection form passes for the wrong reason and would keep passing the day
someone actually exposes `artifact_pull`.

### Removed the module-level catalog state

`buildCatalog` recorded skipped manifests into a module-level array that callers
drained afterwards via `takeSkippedManifests()`. That was safe only by accident
-- the Tauri host spawns one sidecar **process per RPC**, so no two builds ever
overlapped in one process. A long-lived MCP server removes that mask, and
`refreshCatalog` awaits every remote fetch before building, so one request could
drain another's list and report a broken catalog as a clean one. Silent, and
pointing the wrong way: you would be told the catalog is fine when a manifest
had been skipped.

`buildCatalogWithSkipped()` now returns `{ entries, skipped }` with the array
local to the call. Two independent agents flagged this as the blocker before any
long-lived process, and it was fixed before the server was written rather than
after it misbehaved.

### `resolvePrimaryDoc`

`resolvePayloadDir` returns two different *kinds* of path and every caller had
to know which it got: the `payload_path` escape hatch "may name a single file or
a directory" (`schema.ts:150-158`), and both shapes are common. A caller that
assumes "directory" reads nothing for the first group; one that assumes "file"
throws `EISDIR` on the second.

Measured against the real catalog: of 100 artifacts sampled, **45 resolve to a
file and 49 to a document inside a directory**. A naive implementation would
have silently returned nothing for roughly half the catalog. The fork is now
resolved once, in the core, and reports which shape it found.

It also truncates at 64 KB and *says* it truncated -- an agent handed half a
document without being told will answer confidently from the half it saw.

### stdout is a wire, not a log

`src/sidecar.ts:5-8` had asserted this in a comment since the sidecar was
written, and nothing enforced it. A stray `console.log` corrupts the JSON-RPC
stream and reaches the user as an opaque parse error nowhere near its cause --
and every other file in `src/cli/commands/` opens with one, so copying a
neighbour in is the obvious mistake.

Now three things enforce it: an ESLint `no-console` rule scoped to
`src/mcp/**`, `src/engine/**`, `src/sidecar.ts` and `src/cli/commands/mcp.ts`
(which passed with zero violations on the day it was added); a static test; and
an end-to-end assertion that every stdout line from a real spawned
`deliveryos mcp` parses as JSON-RPC. Verified by injecting a `console.log` and
watching all of them fail.

### One deliberate deviation from the plan

`docs/agent-surface-plan.md` Stage 2 required *session-configured project
scope, never a tool argument*, because "every containment check in the engine
validates paths within `cwd` while validating `cwd` itself nowhere." That is
correct for a surface that **writes** -- `pull` into an agent-chosen directory
is a genuine escape.

This surface writes nothing. `cwd` is read-only here: the lockfile, and a
comparison of install targets against pristine snapshots. The tools return
`localStatus` and `installTarget`, never file contents, which come from the
remote cache. Against a residual existence oracle over paths the calling agent
can usually `stat` anyway, out-of-band registration would make the server
unusable in the client that matters most -- an editor whose whole job is the
project it is open in.

So `cwd` stays an argument, and the half of the rule that still bites is
enforced: absolute path, existing directory, checked on every tool, with e2e
coverage. A relative `cwd` would otherwise resolve against the *server*
process and report install status for a directory nobody named. **This does not
carry forward to a mutating tool** -- PLAN.md records that the session-scope
rule applies to `pull` in full.

**The argument is also pinned to the transport it rests on.** "The calling agent
can already `stat` that path itself" is true for a local stdio client and false
for a remote one: over streamable HTTP or SSE, an agent-supplied `cwd` probes
the *server's* filesystem, and the justification stops holding while the code
still reads as safe. That is the `needsApproval` failure shape -- a gate that
holds on one surface and is assumed to hold on all of them. So the architecture
test has a fourth assertion: the server is stdio-only. Adding a transport means
deleting that test, which is where the decision gets re-examined rather than
inherited. Verified by injecting a `streamableHttp` import and watching it name
the offending file.

### Build notes

- **Not `fastmcp`.** It wraps the same SDK and adds sessions, auth, SSE and
  OpenAPI import -- all dead weight for a stdio server with four read-only
  tools. It depends on **zod ^4** against this repo's 3.25, and its tail
  (`execa`, `file-type`, `swagger-parser`) is the dynamic-require class that
  already breaks under SEA. The official SDK was verified end to end, including
  a real SEA `.exe` driven over stdio; the unproven path bought nothing.
- **One `tsconfig.json` change**, six lines: `paths` mapping `zod/v3` and
  `zod/v4/core` to their `.d.cts` twins. Under `moduleResolution: node10`,
  which ignores `exports` maps, the SDK's `zod-compat.d.ts` and our own
  `import { z } from 'zod'` resolve to two structurally identical but distinct
  declarations of every zod class -- `TS2589`, `tsc` exit 2. Not avoidable by
  picking a different SDK API. Blast radius nil: nothing else in `src/` imports
  either specifier.
- **`get_artifact` costs ~186 ms** against the live catalog because it rebuilds
  the catalog per call. Memoizing is deliberately not done here -- it would
  reintroduce exactly the module-level state removed above, and invalidation
  for a process `refresh_catalog` can mutate underneath needs its own design.
  Recorded rather than hidden.

---

## Two people, one artifact (branch `tier0/multi-user-hardening`)

The multi-user paths here were not lightly tested — they had never run. 257
commits, one author, five and a half weeks, so every guard that only matters
once a second person exists had never been exercised by one. The previous batch
already showed what that costs: a payload-deleting `push` bug that had never
fired for exactly one reason, which was that there had only ever been one
pusher. This batch went looking for the rest — and then an independent review
found four more defects in the fixes themselves, one of which broke the
*single*-user workflow. 766 tests before, 775 after; `lint --max-warnings 0` and
`typecheck` clean.

### Push

- **`push` never checked whether you had edited a stale version.**
  `lockEntry.version` was read into scope and never used; there was no
  `compareVersions` in `src/engine/push/push.ts` at all. Your files are the
  version you pulled plus your edits, and the staging loop copies them
  *wholesale* over current upstream — and since the commit is made off the
  current tip, any file two people both touched came back as an ordinary forward
  diff reverting the first person's merged change. Git had no reason to flag it,
  and the PR body said only "modified: foo.ts". There was a second, quieter
  flavour: two concurrent pushes both bumping `1.0.0 → 1.0.1` merge cleanly,
  because it is the same change on both sides, and `sync.ts`'s
  `compareVersions(remote, local) > 0` is then false **forever** — so the second
  person's change was never offered as an update to anyone, on any machine.
  Refused now, naming the files that changed both upstream *and* locally, since
  that is what says whether work is about to be lost. Regression test in
  `test/e2e/push.e2e.test.ts`, verified failing first — without the guard it
  shows A's merged change silently reverted.
- **`--force` exists, and stamps the overlap into the PR body.** A wall with no
  door is wrong when several people are validating one artifact — but a forced
  stale push can still revert a merged change, and the reviewer is then the only
  safeguard left, so the overlapping files are written into the PR body
  (`src/engine/push/prContent.ts`) rather than resolved silently.

### Pull

- **`pull` overwrote local edits with no guard at all on the CLI.** The desktop
  app has always confirm-gated this; the CLI had nothing — and "re-pull to get
  the latest" is exactly the instinct people reach for once artifacts are
  shared. `pullArtifact` copies the payload over `install_target` wholesale, so
  on an artifact someone had edited, that was silent data loss. Refused now
  unless `--force` (`src/engine/pull/pull.ts`, `LocalEditsWouldBeLostError` in
  `src/engine/errors.ts`). The app passes `force: true` after its own confirm
  dialog, so its overwrite button is unchanged. Regression test in
  `test/e2e/applyUpdate.e2e.test.ts`.
- **And `--force` now fetches first, because `pullArtifact` was the one major
  operation that never fetched** — `push`, `applyUpdate`, `checkForUpdates`,
  `refreshCatalog` and `scan` all do. That is not a convenience: without it,
  `--force` would have discarded real edits in favour of an arbitrarily stale
  cache, destroying work for nothing. The two refusal messages were written as a
  pair — `push` says "commit, then `pull --force`", which is only sound advice
  because `pull --force` actually refreshes. The regression test's `--force`
  assertion deliberately bumps the fixture remote in between, so a non-fetching
  force fails it.

### What you can see before a pull

- **`post_install` was shown nowhere before a pull.** Every occurrence in
  `src-tauri/spike-ui/app.js` was a `!!` coercion. It was absent from Detail,
  absent from `list --json` — the surface `deliveryos-check-first` reads
  specifically to judge trust *without* pulling — and was only announced
  mid-pull, after the payload had already been copied. Meanwhile
  `wiring_actions`, which is declarative and reviewable, has always been fully
  surfaced with snippets; the arbitrary shell string was not. Now in all three
  places, verbatim (`src/engine/catalog/catalog.ts`, `src/cli/output.ts`,
  `app.js`). The Configuration tab also no longer hides itself for an artifact
  whose only side effect is a command.
- Checked and deliberately not changed: no new gate or prompt in front of it.
  Printing matches how `wiring` already shows its snippets, and a confirmation
  prompt would change what every existing script does.

### Update

- **`update` told you a version number and nothing else** — while `applyUpdate`
  had already computed the old-vs-new file sets, *deleted* files based on them,
  and thrown the comparison away. A hundred lines further up, the refusal path
  will happily name five of your own changed files. Now carried on the result
  and printed (`src/engine/sync/applyUpdate.ts`,
  `src/cli/commands/checkUpdates.ts`). Regression test in
  `test/e2e/applyUpdate.e2e.test.ts`.

### Identity

- **Commit identity was baked into the shared cache clone.**
  `addConfig(..., 'local')` persisted it into
  `~/.deliveryos/remotes/<name>/.git/config` and nothing ever cleared it
  (`src/engine/git/git.ts`). On a personal machine that is a harmless rewrite of
  the same value, which is why it never surfaced; on any shared box or CI runner
  the **first** pusher's identity won over everyone else's global config from
  then on. Passed with `git -c` now, and existing baked-in config is cleared so
  affected machines recover.
- Also corrected: two code comments this branch's predecessor made stale, which
  still claimed `.deliveryos/` is not gitignored.

---

### What the review of these fixes caught

An independent review found four defects in the guards above. One of them broke
a single person's ordinary workflow — guards written to protect a second user
instead broke the first. Recorded plainly, because the suite was green for all
four.

- **The stale-push guard fired on your own merged push.** `push` records
  `pendingPr` but never advances `lockEntry.version` — only
  `resolvePendingPushes` does, and that is a manual command plus a 20-minute
  background tick. So the most ordinary flow there is, push → merge → push
  again, left the lockfile on the old version while the working copy already
  contained the merged content. The guard then told a solo CLI user "someone
  else's change merged in between", named their own file as one they were about
  to revert, and pointed them at `pull --force` — which would have discarded the
  edit in progress. All three claims false. **Content comparison could not
  rescue this, and it was tried first**: a second edit legitimately differs from
  upstream while still *containing* it, and bytes cannot distinguish "builds on"
  from "overwrites" without a real three-way merge. `pendingPr` can, because
  `push` is the only thing that sets it — the guard now skips while your own
  push is in flight, trading a rare miss (someone else merging while your PR is
  also open, which the PR review then catches) for not blocking the single most
  common workflow. The overlap calculation is content-aware regardless, so the
  message no longer accuses you of reverting a file whose local copy already
  matches upstream. The existing two-cwd e2e test structurally could not catch
  this, because A's merge never lands against A's own lockfile; the regression
  test in `test/e2e/push.e2e.test.ts` uses **one** cwd and one person, seeds its
  own artifact, and was verified failing with the exact false message it was
  written against.
- **The identity fix recovered one push late.** `getCommitIdentity` reads
  *effective* git config, where local wins, and it ran ~450 lines before
  `clearPersistedIdentity` — so on a shared box already poisoned by the old
  behaviour, the first push after upgrading still resolved and committed under
  the first pusher's name. Cleared before the read now, not just before the
  commit. And `--unset-all` rather than `--unset`: a key with multiple values
  made `--unset` fail and leave both in place, so a clone with duplicated
  `[user]` entries never recovered at all (`src/engine/git/git.ts`).
- **`pull --force` could announce one command and run another.** The CLI
  resolved the manifest from the local cache and printed `post_install` from it,
  but `--force` makes `pullArtifact` fetch and re-resolve — so the command that
  actually executed came from a different manifest, which directly undermines
  the point of surfacing it. The announce now comes from the engine's own
  progress hook, which fires from the manifest it is about to execute, so it is
  right in both cases (`src/cli/commands/pull.ts`, `src/engine/pull/pull.ts`).
- **The new pull guard used the lockfile's raw absolute path.** Every other
  consumer of `lockEntry.installTarget` re-validates it against cwd, and this
  was the one new one that did not — so a renamed project folder made
  `existsSync` false, the whole guard silently vanished, and the pull overwrote
  local edits exactly as before. It now compares the target this pull is
  actually about to write to.
- Every one of the four has a regression test proven failing first.

### The desktop UI

- **A UI defect shipped because nothing in this repo could catch it.**
  `src-tauri/spike-ui/app.js` is the one part of this codebase no tooling
  reaches: ESLint's only rule-bearing config is scoped to `**/*.ts` —
  `--print-config` reports `rules: 0` for all 7,464 lines — tsconfig excludes
  it, and `lint:css` checks design-token bypasses rather than whether rendered
  text says what it means. Every UI change in this work was signed off "reviewed
  by hand," and one shipped anyway: the new `post_install` lifecycle step quotes
  a real shell command with blank lines around it, but
  `.lifecycle-step-description` is set via `textContent` and had no
  `white-space` rule, so both line breaks collapsed to single spaces and the
  command ran inline into the surrounding prose. Legibility is the entire point
  of surfacing it, and a command buried mid-paragraph is exactly what someone
  skims past. Fixed in `src-tauri/spike-ui/style.css`; every other lifecycle
  description is a single paragraph with no line breaks (verified: 0 of 8), so
  `pre-wrap` changes nothing for them.
- **The desktop UI has real browser test coverage for the first time.**
  `test/e2e/detailDisclosure.e2e.test.ts` drives the real `index.html` in a real
  browser against a stubbed engine, on the seam
  `test/e2e/uiOperationStore.e2e.test.ts` established —
  `invoke('sidecar_call', ...)` rather than `window.DeliveryOS.call`, because
  `sidecar.js` loads afterwards and overwrites the latter. Four tests, all
  covering things only a browser can see: the `post_install` command appears
  verbatim **and** on its own line, asserted through computed `white-space`
  rather than the string, because the string was always right and the rendering
  was not (verified to fail when the CSS rule is removed); the Configuration
  section shows for a command-only artifact, asserted on the *section* rather
  than a tab button, since with one applicable tab the app deliberately skips
  the tab chrome and what matters is whether a person can see it; `catalog.list`
  is accepted in **both** the old bare-array and the new `{ entries, skipped }`
  shapes, which is what `normalizeCatalogResult` exists for; and the
  skipped-manifest notice names *which* artifact, since `reason` alone never
  does and the notice was unactionable without it.
- **`StalePushError` told everyone to "re-run with `--force`", including desktop
  users, who have no way to pass a flag.** The message now describes the
  resolution that actually exists in the app — discard the local edit, take the
  current version, re-apply — in both surfaces, and mentions the CLI flag as the
  CLI's own option (`src/engine/push/push.ts`).
- Checked and deliberately not changed: **the app has no force affordance for
  push, and should not get one.** A one-click force over a colleague's merged
  change is exactly the operation that should stay hard, and the app already has
  the safe resolution.

## CI, and the hardening it made worth doing (branch `tier0/hardening-and-ci`)

CI where there was none, then the defects found by auditing what CI would now be
protecting. Almost none of them were about the surface that prompted the audit —
they were live bugs in `pull`, `push`, `update` and `remove` that surfaced only
because someone re-read paths nobody had re-read since they were written. 69 test
files / 710 tests before, 70 / 759 after; `lint --max-warnings 0` and `typecheck`
clean.

### CI

- **Nothing ran any of the gates but a human who remembered to.** There was no
  `.github/`, no workflow and no hook, while the repo shipped 58 unit test
  files, ~10 e2e files, `lint --max-warnings 0`, `typecheck` and six `ui:*`
  audit scripts — [PLAN.md](PLAN.md)'s own "What's next" already said so.
  `.github/workflows/ci.yml` now runs them. The runner is **windows-latest, not
  ubuntu**, for two reasons: Edge ships preinstalled, so
  `chromium.launch({ channel: 'msedge' })` resolves — and the browser tests here
  *hard-fail* rather than skip when no channel is available
  (`test/e2e/uiOperationStore.e2e.test.ts:168`, `renderPreviewImage.test.ts`) —
  and this project's real bug history is overwhelmingly Windows-specific. Step
  order is deliberate: `npm ci` already runs the six codegen scripts (they are
  package.json's `prepare`), so no generate step belongs in the workflow; `git
  diff --exit-code` then proves nobody hand-edited a tracked generated file; and
  the two browser audits run **before** `npm test`, so an unresolvable Edge
  fails in one minute rather than twenty. Gates use `!cancelled()` rather than
  `continue-on-error`, which would report the job green with a failing gate.
- Checked and deliberately left out: `ui:contrast` is not a CI gate, because it
  has no `process.exit` anywhere — it is a report that cannot fail, and
  `test/unit/uiContrast.test.ts` already gates the same shared implementation
  inside `npm test`. `ui:screenshots` asserts nothing either, so it is a
  `workflow_dispatch` job that uploads PNGs instead of a gate.
- **The e2e teardowns would have made that CI flaky.** Four unit tests already
  used `rmDirWithRetry`, but no e2e test did — and `pull`/`wiring`/`checkUpdates`
  e2e are exactly the files that spawn subprocesses. `src/engine/execHelpers.ts:52`
  records why plain `fs.rmSync` is not enough: a killed process's surviving
  grandchild holds a lock, and `rmSync`'s own `maxRetries` does not reliably
  retry that EPERM/EBUSY, so on a slower runner the whole *file* reports failed
  with every test in it passing. 16 teardowns converted across
  `test/e2e/pull.e2e.test.ts`, `test/e2e/wiring.e2e.test.ts` and
  `test/e2e/checkUpdates.e2e.test.ts`; three `it`s became async to await it.

### The update path

- **Three readers re-derived `install_target` instead of trusting the
  lockfile.** `pullArtifact` records the `adaptSrcDirPath`-*shortened* target: in
  a project with a root `app/` and no `src/`, an artifact declaring
  `install_target: src/lib/x` actually lands in `lib/x`. One root cause, three
  call sites, increasing severity. `src/engine/sync/applyUpdate.ts`'s relocation
  guard compared the two and refused **every** update, forever, for every
  artifact whose target starts with `src/`, with a message blaming the new
  version for a move that never happened — no fixture used a `src/` prefix, so
  no test caught it. `annotateCatalog` (`src/engine/catalog/catalog.ts`) diffed a
  directory that does not exist; `listFilesRecursive` returns `[]` for a missing
  root, so every pristine file read as `deleted` and the artifact was permanently
  `edited_locally` no matter how cleanly it was pulled — which is also why fixing
  only `applyUpdate` would have *looked* broken end to end. And
  `src/engine/push/push.ts` built the same all-deleted changeset, where it is
  destructive: the only guard is `changedFiles.length === 0`, which an
  all-deleted set passes, so the staging loop `rmSync`'d every payload file in
  the remote cache and **opened a PR deleting the artifact's entire payload
  upstream**, on a shared remote. Found while auditing the other two, not
  reported by a user. `catalog` and `push` now prefer `lockEntry.installTarget`
  — where the payload actually landed, and both already had the entry in scope;
  `applyUpdate` adapts the manifest value the way `pull` does and accepts
  *either* spelling, because `adaptSrcDirPath` is filesystem-dependent and a
  project that gained a root `app/` after the pull would otherwise produce a
  fresh false relocation. Both candidates derive from the same manifest string,
  so a genuine relocation still fails both. Regression tests in
  `test/e2e/applyUpdate.e2e.test.ts`, verified failing first with the exact
  "moved install_target" refusal.
- Checked and deliberately not changed: the relocation guard itself. A new e2e
  control case publishes a version that really does move `install_target` to a
  different string and asserts it is **still** refused with nothing written — a
  "fix" that made that case pass would have deleted a real safety guard.
- **A vanished artifact reported nothing at all.** `applyAvailableUpdates`
  (`src/engine/sync/applyUpdate.ts`) used a bare `continue` when an artifact was
  not in the catalog, contradicting `ApplyUpdateResult`'s own documented contract
  — "always set when `applied` is false — a person should never see a silent
  no-op". Every other degradation in that loop calls `report()`; this one
  returned nothing, so `check-updates --apply` printed "No updates available."
  for a project whose artifact had actually been removed upstream, its remote
  unregistered, or its manifest broken. `report` is now declared above the lookup
  and `availableVersion` is optional — echoing `previousVersion` instead would
  have read as "1.0.0 → 1.0.0 available". `src/cli/commands/checkUpdates.ts` grew
  the absent-version branch; the sidecar and `app.js` needed no change (both read
  the field only inside the `applied` branch), and the app's Update button now
  surfaces the real reason instead of silently reporting nothing. Regression test
  in `test/e2e/applyUpdate.e2e.test.ts`, which returned `[]` beforehand.
- Checked and deliberately not changed: the *second* bare `continue`, for an
  artifact that is present and already current. That one is intentional — a bulk
  apply should stay focused on real updates — and a new test pins it so nobody
  "fixes" it too.

### Refusals

- **A hand-edited lockfile entry could delete outside the project.**
  `pristinePath` was the one path builder in `src/engine/paths.ts` that did not
  sanitize its segment: `remoteCachePath`, `wireContextPath` and
  `previewCachePath` all call `assertSafePathSegment`, while `pristinePath`
  joined `id` straight in — and its result is what `removeArtifact` hands to
  `fs.rmSync(recursive, force)`. Every other caller reaches it through a catalog
  match, and `parser.ts` refuses any manifest whose id differs from its own
  folder name, so a traversing id cannot arrive that way. `removeArtifact` is the
  exception: it looks its entry up **only** in the lockfile (`resolveArtifact`'s
  failure is tolerated), and `lock.json` is a plain project-local JSON file
  anyone can hand-edit — an entry with id `../../victim` and a perfectly valid
  contained `installTarget` deleted `<cwd>/.deliveryos/pristine/../../victim`.
  Fixed in two layers: `readLockfile` now drops entries whose id is not usable as
  a single path segment — dropped, never thrown, because every lockfile-touching
  command reads through that one function and throwing over a single hand-edited
  line would blank a whole catalog listing, so `LockfileCorruptError` keeps its
  existing contract of JSON that will not parse at all and nothing else — and
  `pristinePath` then asserts as its three siblings do, as a backstop for any
  caller building an id some other way. Making it throw meant auditing its read
  paths: `annotateCatalog` now wraps `pristinePath`, `readPayloadFootprint` and
  `computeChangedFiles` in **one** `try`, so a single unusable entry degrades to
  `pulled` for itself alone instead of taking every other artifact's listing with
  it — this repo has blanked a catalog that way twice. `push` and
  `removeArtifact` keep throwing, which is correct for single-artifact mutating
  commands. Regression tests in `test/unit/removeArtifact.test.ts`,
  `test/unit/lockfile.test.ts` and `test/unit/paths.test.ts`.
- Checked and deliberately not changed: the filter validates `id` only, not
  `version`/`remote`. Every real entry has all three, but widening it widens the
  set of entries a real user could silently lose, and `remote` is already
  asserted downstream by `remoteCachePath`.
- **`install_target` could install an executable git hook with no `post_install`
  involved at all.** `SENSITIVE_TARGET_PREFIXES` (`src/engine/pull/wiring.ts`)
  has existed since a security review, but was only ever applied to
  `wiring_actions.targetFile`. `install_target` walked straight past it into
  `fs.cpSync`: the schema checks it only for `..` escapes, and `.git/hooks` *is*
  inside the project, so containment passed too — an artifact could drop a git
  hook or a CI workflow. Now refused at pull time (`src/engine/pull/pull.ts`) and
  on the update path too, since an artifact pulled before this fix would
  otherwise keep updating into one. `.deliveryos/` joins the list — it holds
  `lock.json` and the pristine snapshots that every status check, push and update
  diffs against. Refused at pull time and deliberately **not** in the manifest
  schema: a schema rejection makes `discoverManifests` skip the manifest, which
  vanishes the artifact from the catalog entirely — this file records exactly
  that taking all 234 artifacts down. A refused pull is visible and specific.
  Regression tests in `test/unit/pull.test.ts` and `test/unit/wiring.test.ts`;
  all five denylist targets installed happily before the fix.
- Checked and deliberately not changed: **`.claude/` is not on the denylist**,
  and `test/unit/manifest.schema.test.ts:73` stays exactly as it is. `deliveryos
  scan` itself *generates* `.claude/agents/<file>` and `.claude/skills/<dir>`
  install targets, and real agent artifacts install to `.claude/agents/<id>.md`
  — denying it would make every scanned agent and skill artifact in the catalog
  unpullable, the same outage class. Both that and a `.gitlab/` lookalike are
  pinned by tests so a later "tightening" fails loudly.
- **A manifest's `install_params` could write arbitrary extra keys into a real
  project's environment.** They were interpolated raw into `KEY=VALUE`
  (`src/engine/pull/installParams.ts`); `key` is only `z.string().min(1)` and
  `default` is an unconstrained string, so a newline in either ended the line
  early and everything after it became its own top-level `.env.local` entry —
  `NODE_OPTIONS`, `DATABASE_URL`, whatever the manifest chose. A **non-secret**
  `default` is applied with zero user interaction, so nobody had to click
  anything; and because `parseEnvLines` can never match a newline-bearing key,
  the raw write always took the append branch, so the injection re-appended on
  every single pull, compounding. Now refused and reported, never mangled — a
  sanitized key would write the value under a name the manifest never declared,
  and `readInstallParamValues` would then never find it again. Refused at the
  **write** site rather than by tightening `InstallParamSchema`, for the same
  skip-the-whole-manifest reason as above; the new `ENV_KEY_PATTERN` is
  deliberately identical to `parseEnvLines`' own regex, so writer and reader
  cannot drift apart. Surfaced as `installParamWarning` through `PullResult` →
  CLI → sidecar → toast, mirroring `gitignoreWarning`'s existing path.
  Regression tests in `test/unit/installParams.test.ts` and
  `test/e2e/pull.e2e.test.ts`; four of the five cases verified failing first (the
  fifth is an over-match negative control).

### Redaction

- **Three audit logs stored whole file bodies, with no redaction anywhere in the
  engine** — `WiringMergeLogEntry` and `BuildFixLogEntry` (`before`/`after`), and
  `DesignFixLogEntry`. The AI flows can target any file a manifest names, so a
  credential in a touched file landed verbatim in a `.jsonl` under
  `.deliveryos/`, which nothing gitignores; the only `sanitize` references in the
  engine were about path segments, not values. `src/engine/audit/redact.ts` is a
  port of `agent-native`'s `audit/redact.ts`, keeping only the two functions this
  needs and dropping the structural-JSON half, which has no consumer here, and it
  is applied at the three append helpers
  (`src/engine/pull/requestWiringMerge.ts`, `src/engine/pull/fixBuildFailure.ts`,
  `src/engine/scan/fixAntiPattern.ts`) rather than at the call sites, so no
  future caller can forget. Rollback is unaffected, and asserted rather than
  assumed: both `applyWiringMerge` and `applyBuildFix` restore from an in-memory
  `before` read taken before the append, never from the log, and the new tests
  force a real rollback and assert the restored file equals the original
  **unredacted** bytes. Regression tests in `test/unit/redact.test.ts`,
  `test/unit/requestWiringMerge.test.ts` and `test/unit/fixBuildFailure.test.ts`.
- Three deviations from the ported source, all documented in the file header.
  (1) `process.env.X` / `import.meta.env.X` references are preserved — without
  this, `secret: process.env.AUTH_SECRET` redacted to `[redacted]`, and `auth.ts`
  is the file the wiring-merge flow touches most often, so the Activity diff
  would have gone blank exactly where it is most useful; a hardcoded literal is
  still redacted, and an env reference contains no secret. (2) The key's leading
  `\b` widened to `(?:\b|_)`, because a faithful port does **not** redact
  `AUTH_SECRET = "hunter2"` at all: `_` is a word character, so there is no
  boundary between `AUTH_` and `SECRET` and the pattern never matches — a
  pre-existing upstream gap. The trailing `\b` is unchanged, which is what keeps
  `max_tokens`, `MAX_TOKENS` and `user_token_count` from being flagged; verified.
  (3) Connection strings are matched on the **value's** shape —
  `scheme://user:pass@host` — rather than on the field name, because
  `DATABASE_URL=postgres://user:pw@host/db` was not redacted at all:
  `SENSITIVE_KEY` knows `webhook_url` but has no plain `url`. Adding a bare `url`
  to `SENSITIVE_KEY` instead would have been far worse — `AUTH_URL`, `API_URL`
  and `NEXT_PUBLIC_APP_URL` are ordinary non-secret config (`AUTH_URL` is a real
  `install_param` in this repo's own fixtures), and blanking them would gut the
  Activity diff for no gain. Only the credentials are replaced; the scheme, host
  and path stay readable, because knowing *which* database was configured is
  exactly what an audit log is for. The username may be empty —
  `redis://:password@host` is a real form.
- **There was a fourth audit log.** `wiring-placement-log.jsonl`
  (`src/engine/scan/suggestWiringPlacement.ts`) stores no file bodies, so it
  never had the before/after exposure the other three did, but its
  `rebuildOutput` is a real project build's captured output — which can print an
  environment dump on failure — and it was the one such field still appended raw.
  Now redacted at its own append helper, matching the other three. Both this and
  the connection-string gap were found by executing the new manual smoke-test
  runbook end to end rather than by reading the code, which is the point of
  having one.
- Stated now rather than discovered later: this is a heuristic, not a parser —
  `export const authSecret = "hunter2"` (camelCase) still passes through. And
  redaction does **not** make `.deliveryos/` safe to commit; the logs still hold
  full file bodies, so the gitignore gap stays open in [PLAN.md](PLAN.md).

### Correctness

- **The app silently dropped manifests it could not load** — two defects that
  had to be fixed together. `buildCatalog` appended to a module-level
  `lastSkippedManifests` and never cleared it; only `takeSkippedManifests`
  drained it, so its own doc comment claiming "the most recent `buildCatalog()`
  call" was simply false — a single process calls `buildCatalog` more than once
  on several paths (`resolveArtifact`'s own default parameter, `pull`'s
  resolve-then-pull, `push`'s collision check), and a later drain returned the
  same skipped manifest once per call. It is now cleared at the start of the
  build, which makes the contract true, and the declaration moved above
  `buildCatalog` — it had worked only because nothing calls `buildCatalog` during
  module evaluation. And `src/cli/commands/list.ts` was the **only** caller of
  `takeSkippedManifests` in the whole tree: the sidecar never called it, so a
  manifest that failed to parse was silently dropped from `catalog.list` — a
  parse failure coerced into a clean empty result, and a broken artifact looked
  simply *absent* in Browse while the CLI reported it. `catalog.list` and
  `catalog.refresh` now return `{ entries, skipped }`. The two could not land
  separately: wiring `takeSkippedManifests` into the sidecar on its own would
  have returned N duplicate copies on the first call. The **wire format** had to
  change rather than gain a `catalog.skipped` command, because the Tauri host
  spawns one sidecar *process per RPC* (`src-tauri/src/lib.rs`) — a follow-up
  call would be a brand-new process whose module-level record is empty, and would
  always report nothing. `app.js` gained a `normalizeCatalogResult` accepting
  both the old array and the new object, deliberately rather than out of
  politeness: `test/e2e/uiOperationStore.e2e.test.ts` drives the real UI against
  a stubbed engine returning an array, and that test has no reason to know about
  an engine-side wire change. The skipped notice renders after the catalog, never
  instead of it — the same rule `list.ts` already documents. Regression tests in
  `test/unit/catalog.test.ts` ("does not duplicate it", verified failing with
  length 2) and `test/e2e/sidecar.e2e.test.ts`.
- Checked and deliberately not changed: the other six `buildCatalog` callers
  (`pull`, `push`, `scan`, `applyUpdate`, `sync` ×2) still ignore the record.
  They are mid-operation paths, not listings, and reporting a skipped manifest
  from inside a pull would be noise.
- **A failed post-push cache reset was swallowed by a bare `catch {}`.** That
  reset (`src/engine/push/push.ts`) guards a real incident the comment above it
  records — a pull straight after a push installed the user's own unreviewed PR
  content — so swallowing its failure left exactly that state with nothing
  anywhere saying so. "The next `fetchAndReset` would recover it" is not a
  guarantee: `pullArtifact` never fetches, and this is the most likely reset to
  fail, since it runs straight after the push's own network I/O. Now reported on
  `PushResult` **and** through `onProgress` — both, because `onProgress` is the
  only channel available when the push itself threw and no `PushResult` exists at
  all. Regression test in `test/e2e/push.e2e.test.ts`, verified returning
  `undefined` first.
- **`--no-wire`'s help text described a behaviour it does not have.** It claimed
  "nothing else in the project should be touched"; that branch calls
  `pullArtifact`, which runs the manifest's `post_install` unconditionally
  (`src/cli/commands/pull.ts`). The text is corrected. The **behaviour** is
  deliberately unchanged — changing it would silently break any script relying on
  `post_install` running — and is now pinned by a test named CHARACTERIZATION
  (known defect) in `test/e2e/pull.e2e.test.ts`, so that giving `--no-wire` a
  real no-execute mode stays a deliberate decision rather than an accident.

---

### What the review of this branch caught

An independent review of these changes found five defects, two of them
introduced by the fixes above. Recorded rather than quietly folded in, because
the suite was green for all five.

- **Trusting the lockfile's `install_target` re-armed the payload deletion it
  was meant to close.** That field is an *absolute* path, and `.deliveryos/` is
  not gitignored — so a lockfile genuinely arrives in another clone, or survives
  the project folder being renamed. A stale absolute target does not exist,
  `listFilesRecursive` returns `[]` for a missing directory, every pristine file
  reports `deleted`, and the `changedFiles.length === 0` guard does not fire.
  `removeArtifact` already re-validates the same field and says in a comment
  that lock.json is "never trusted blindly"; `push` and `annotateCatalog` did
  exactly that. Both now re-validate against the current cwd, and `push` refuses
  outright when the resolved target is not on disk — the check that closes the
  class rather than one trigger. Before the fix `pushArtifact` *resolved*: it
  opened the PR. `test/e2e/push.e2e.test.ts`.
- **Deviation 3's regex was quadratic.** `[a-z0-9+.-]*` was unanchored and had
  to be followed by `://`, so every position in a long run of those characters
  consumed the whole run and backtracked one character at a time — 7.1 s at
  128 KB, 82 s at 256 KB, 11.5 minutes at 1 MB, in one synchronous `replace`.
  Reachable rather than theoretical: `redactEmbeddedSecrets` is deliberately the
  non-truncating entry point, and `buildError`/`rebuildOutput` reach it at up to
  10 MB. Now anchored on `://` with a bounded lookbehind; 128 KB went from
  7165 ms to 0 ms with identical behaviour.
- **camelCase credential fields still leaked.** Deviation 2 fixed
  SCREAMING_SNAKE and did nothing for a case transition, so
  `const jwtSecret = "hunter2"` passed through — in the very convention the
  TypeScript files this protects actually use. Added as a fourth, deliberately
  case-*sensitive* pass: the main pattern's `i` flag makes a `(?<=[a-z0-9])`
  lookbehind match after uppercase too, which would redact `notasecret`. Bare
  `Key` is excluded, since `cacheKey`/`rowKey`/`sortKey` are ordinary
  identifiers — all pinned by tests.
- **The bulk "Pull all" loop dropped `installParamWarning` entirely**, in the
  one path that pulls the most artifacts at once. Now reported per-artifact, and
  deliberately not through `failures`, which would have made `endProgress` call
  the whole batch failed over a refused param.
- **`applyInstallParams` contradicted itself twice.** It returned the gitignore
  warning ("we just wrote a secret") even when every key had been refused and
  nothing was written, and `missingRequiredParams` counted a required param as
  satisfied when its key turned out to be unwritable — so the health summary
  read "fully configured" beside a warning saying the opposite.
- The skipped-manifest notice also never named *which* artifact (`reason` alone
  never does — the CLI prints `path` for exactly this reason) and rendered as a
  single 230px cell in an auto-fit grid instead of a banner.

## Design system and hygiene overhaul (branch `overhaul/design-system-and-hygiene`)

Numbered phases stop here. [PLAN.md](PLAN.md) merged the original 32 into 15
on 2026-08-28, so continuing the old sequence in this file would invent a
"Phase 33" that the plan no longer has. Entries below Phase 32 keep their
original numbers and reconcile through PLAN.md's renumbering map.

### Tier 0 hardening

- **Sidecar prototype dispatch**: an RPC named after an `Object.prototype`
  member (`constructor`, `toString`) resolved to the inherited function and
  was dispatched. Now refused.
- **Four unvalidated `JSON.parse` sites on untrusted input** guarded, so a
  corrupt lockfile/registry/bundle reports as itself rather than escaping as a
  raw `SyntaxError` stack trace.
- **`applyUpdate` ran `post_install` without `DELIVERYOS_PROJECT_ROOT`**,
  which broke `check-updates --apply` for every backend plugin (the authoring
  skill mandates `cd "$DELIVERYOS_PROJECT_ROOT"`, and unset that expands to
  `cd ""`). Same 1 MB `maxBuffer` trap fixed alongside it.
- **The remote cache clone is locked** during refresh, and `push` no longer
  leaves it parked on a half-built branch.
- **Two long-standing "flaky" test failures** turned out to be real and are
  fixed; the suite passes deterministically.

### `install_target` at the project root

- A guard added here refused a root `install_target` at the SCHEMA level,
  which **took the whole catalog down**: `deliveryos list` returned nothing
  but a validation error, because a root target is the correct shape for a
  scaffold artifact and one of the 234 catalog artifacts uses it. The guard
  now lives only in `remove`, where the deletion actually happens.
- **One bad manifest no longer blanks the catalog.** `discoverManifests` threw
  on the first invalid manifest, making all 234 unreachable for everyone.
  Invalid manifests are skipped and reported after the catalog, not instead of
  it.
- **A root `install_target` now works through the whole lifecycle**, not just
  `pull`. It was pullable but then permanently `not_pulled`, and could never
  be pushed, updated or removed, because every other call site passed
  `allowRoot: false`. Each operation is now scoped to the artifact's
  **footprint** — the top-level entries its payload provided, recorded in the
  pristine snapshot at pull time — via new `isRootInstall` /
  `readPayloadFootprint` helpers and a `topLevelScope` option on
  `computeChangedFiles`. `remove` deletes only those entries, never the root
  directory. Where the snapshot is missing the footprint is unknowable and the
  operation refuses rather than guess at the project root.
- Two further defects found on the update path: `applyAvailableUpdates`
  re-snapshotted with a bare `fs.cpSync(installTarget, pristineTarget)` (throws
  `ERR_FS_CP_EINVAL` for a root install, and would snapshot the user's entire
  project if it didn't), and its clean-check diffed unscoped. Both paths now
  share one exported `writePristineSnapshot`.

### Design system, dark mode and the Detail view

- Theme blocks collapsed into one system; opacity-as-muted-text replaced with
  real colour tokens; type, fonts, radii, motion and spacing swept onto the
  scale tokens.
- **Fonts vendored**, so the UI no longer depends on the network to render.
- Real error states, and dark-mode defects fixed by direct inspection rather
  than by report.
- Backend-plugin Detail revamped: one loading treatment, identity first,
  scannable wiring.

### An in-flight operation survives navigation

- Reported as "if I go back while pulling, things are broken" — four failures
  behind one sentence, all from the progress panel treating the DOM as its
  source of truth. Progress now accumulates into an operation store keyed by
  artifact, and the panel is a pure render of it.
- `test/e2e/uiOperationStore.e2e.test.ts` is the **first automated test of the
  desktop frontend**, which had never had any.

### Packaging

- **The NSIS installer never compiled.** `path-hook.nsh` called `${StrRep}`
  from the uninstall section, where NSIS permits only `"un."`-prefixed calls —
  a hard `makensis` error. The MSI bundled fine, which is what made it easy to
  miss, and an MSI installee gets no `deliveryos` on PATH at all. Now uses
  `${UnStrRep}`. The PATH hook's runtime behaviour remains unverified on a
  clean machine; see `docs/manual-smoke-test-cli-install.md`.
- **The CLI reported a version it wasn't.** `.version('0.1.0')` is a hardcoded
  literal (tsconfig's `rootDir: src` blocks importing package.json), and it
  stayed behind while package.json, tauri.conf.json and Cargo.toml moved to
  0.1.2 — so the binary shipped *inside* the 0.1.2 installer said 0.1.0.
  `test/unit/cliVersion.test.ts` now fails the build if the four drift.
- **The documented bundle output path was wrong**, in both the README and
  `docs/release-process.md`: a plain `npx tauri build` writes to
  `src-tauri/target/release/bundle/`, not the `x86_64-pc-windows-msvc/`
  variant they named — which on a machine that has built both holds a stale
  installer indistinguishable from the fresh one.

### The UI described work that never happened

- `pull` announced `Verifying artifact signature...` on every pull, though
  `verifyArtifactSignature` returns immediately for an unsigned artifact —
  contradicting the Detail panel's own "Unverified — no provenance signature
  yet" badge on the same screen. Now emitted only when there is a signature or
  bundle to check.
- `Applying install-time configuration...` likewise announced itself for
  artifacts declaring no `install_params`, pointing at an `.env.local` change
  never made. Now gated on real `install_params`.
- **"Verify build" was offered on artifacts that cannot affect the build.** The
  build chip sat outside all gating, so a pulled `skill` showed a status panel
  containing nothing else — and clicking it turned into a green "Build
  passing" that read as if the `SKILL.md` had been validated. It was the host
  project's unrelated build. Now gated on the same
  `install_params || wiring_actions || post_install` check the lifecycle
  explainer already used.

### Docs

- README rewritten; `REQUIREMENTS.md` restructured by audience (running the
  app, running the CLI, building from source) rather than by build phase;
  `docs/skills.md` added, documenting the six Claude Code skills that nothing
  described anywhere.
- `.gitattributes` added to stop line-ending noise on committed generated
  files.

---

## Phase 32 — "Merge with Claude" had no reference for a file's own canonical content

- Found by direct testing: a one-character typo in a freshly-wired
  `auth.ts` made "Merge with Claude" refuse outright, with nothing to
  review. Root cause: the merge only ever had `whenPresent.snippet` to
  offer as reference content, which is `undefined` for the common case
  (a file the artifact fully owns, `whenPresent` is prose-only).
- Fixed: falls back to `whenAbsent.snippet` -- the artifact's own real,
  known-good standalone content -- whenever `whenPresent` doesn't supply
  its own, whether or not `whenPresent` was declared at all.
- `docs/backend-plugin-lifecycle.md` brought up to date: a new "Connect
  it to your app" stage for `wire-with-claude` (previously missing
  entirely), `post_install`/`post_remove`/`DELIVERYOS_PROJECT_ROOT`
  properly explained, and an overclaiming line in the doc's own summary
  corrected.

## Phase 31 — Two more sidebar destinations: Starter Kits and Backend Plugins

- New sidebar items **Starter Kits** (kind: `template`) and **Backend
  Plugins** (kind: `backend-plugin`), each a single-kind grid reusing
  Browse's own card rendering (now shared via a new `buildResCard`
  helper) -- the same shortcut-into-one-kind idea `UI Components`
  already had, without needing that page's live-preview machinery.
- Backend-plugin artifacts now get a real plug-shaped icon everywhere a
  kind icon shows up (Browse, Detail, Tag Folder) instead of the
  generic fallback diamond -- no `KIND_ICON` entry existed for this
  kind until now.

## Phase 30 — A `backend-plugin-authoring` skill, for both human and AI authors

- New `.claude/skills/backend-plugin-authoring/SKILL.md` documenting how
  to correctly author a `kind: backend-plugin` manifest -- the three-tier
  wiring model, `post_install`/`post_remove` conventions including
  `DELIVERYOS_PROJECT_ROOT`, dependency-version-pinning discipline, and
  the `.env`/`.env.local` gotcha -- built on top of (not duplicating)
  `deliveryos scaffold-backend-plugin`, and grounded entirely in real
  bugs found this phase and the one before it, not hypotheticals.

## Phase 29 — `post_remove`, and a real dogfood of a genuinely large backend-plugin

- New `post_remove` manifest field, symmetric with `post_install` --
  runs before the install target is deleted, but never blocks removal
  on failure (reported as a warning instead), since `removeArtifact`
  exists specifically so nobody gets stuck mid-removal.
- Fixed a second, distinct Windows EPERM race: a killed `post_remove`
  command's grandchild process could still hold a lock on the install
  target right as it was being deleted. Fixed with a retrying delete
  helper, in production code, not just test cleanup.
- **Found and fixed a critical, real filesystem-pollution bug in
  already-shipped manifests**: a fixed-depth relative `cd ../../..` in
  `post_install` silently overshot into the *parent* of the real
  project once Phase 26's own `adaptSrcDirPath` fix shortened
  `install_target`'s effective depth for root-`app/` projects. Found
  real evidence of this on the user's own Desktop folder; deleted only
  after explicit confirmation. Root-fixed with a new
  `DELIVERYOS_PROJECT_ROOT` absolute-path env var passed to both
  `post_install` and `post_remove`, replacing every depth-counted
  relative `cd` across all affected manifests.
- Dogfooded a real, already-published, genuinely large artifact
  (`nextauth-credentials` -- Prisma + bcrypt + Postgres) and found it
  was missing `post_install` entirely, an unpinned `prisma` dependency
  that can grab an incompatible major version, and a real Prisma-CLI
  `.env`-vs-`.env.local` gotcha. A local-test copy now starts/stops a
  real Postgres container via Docker through `post_install`/
  `post_remove`, verified end to end.

## Phase 28 — An embedded terminal for "Wire with Claude", and a Detail-view UI/UX pass

- "Wire with Claude" now runs in a real terminal embedded inside the
  DeliveryOS window itself (via a new Rust PTY module and vendored
  `xterm.js`), instead of requiring a separate system terminal.
- Fixed a real Windows-only bug where the embedded terminal couldn't
  launch npm-shimmed CLIs at all (`CreateProcessW` error 193) --
  routed through `cmd.exe /C` on Windows, verified with a standalone
  Rust example rather than only through the full GUI.
- Fixed a real wiring bug where the new PTY Tauri commands were
  incorrectly routed through the sidecar RPC helper instead of called
  directly.
- Detail view: Configuration tab now leads (was last); Connection
  Status panel moved above the installation explainer and given real
  visual weight; both Connection Status and Wiring now show an
  immediate loading state instead of a blank gap.
- **Follow-up, found by re-reviewing the same Detail view**: the
  Configuration tab's own install-params form was the one loading
  region that never got the spinner+"Loading…" treatment its two
  siblings did — fixed to match. Also found and fixed the real reason
  it looked inconsistent even where it *was* present: `.spinner` had no
  `display` set, so it only rendered as a proper 14px ring inside an
  already-flex parent (Connection Status) — dropped into a plain div
  (Wiring, Install params), it collapsed to a sliver. Fixed once, at
  the component level (`display: inline-flex` on `.spinner` itself),
  rather than requiring every call site to remember to wrap it.

## Phase 27 — `deliveryos wire-with-claude`: the wiring step stays in DeliveryOS

- New `deliveryos wire-with-claude <id>` -- reads an already-pulled
  backend-plugin's real lockfile paths, writes a real context file, and
  hands off to a REAL interactive `claude` session (not a restricted,
  headless subprocess) to connect it to the rest of your project. No
  more manually opening a separate editor and pasting a hand-written
  prompt.
- Considered and rejected giving DeliveryOS's own restricted AI
  subprocess real write access instead -- that exact design was already
  tried and walked back once (see Phase 10) after finding a real
  Windows command-injection risk and confirming Claude Code's own
  tool-restriction flags aren't reliably enforced. This command avoids
  reopening that: it launches the already-trusted interactive `claude`
  binary under its own normal permission model, not a flag-granted one.
- Found and fixed a real bug while dogfooding: the interactive starting
  message got silently truncated by shell word-splitting on Windows;
  `JSON.stringify`-quoting the argv element fixed it.
- `docs/backend-plugin-demo-script.md`'s existing-project path rewritten
  around the new command.

## Phase 26 — Two real bugs found by the user's own rehearsal, fixed

- **The demo prompt undersold "actually wire it"**: an agent following it
  correctly avoided a fake mock but stopped at a well-documented,
  unimplemented seam. `docs/backend-plugin-demo-script.md`'s combined
  prompt now says explicitly: don't stop at a documented seam, actually
  call the real functions in this same turn, and confirm the login flow
  end to end before finishing.
- **`wiring_actions`/`install_target` hardcoded a `src/`-prefixed path**,
  silently assuming `--src-dir` -- confirmed dead on a real root-`app/`
  project (Next.js's own routing never looks under `src/app` once a
  root `app/` exists). Fixed with a hybrid: a new deterministic
  `adaptSrcDirPath` (`src/engine/paths.ts`) handles the mechanically-
  certain case for free; a new AI-assisted fallback
  (`suggestWiringPlacement.ts`, a new "Ask Claude where this goes ✨"
  button, mirroring the existing "Merge with Claude" ask/apply/rollback
  pattern) only for genuine ambiguity, never a silent guess.
- Verified for real: full test suite green, real dogfood against a
  fresh root-`app/` project and a genuinely ambiguous one (including a
  real `claude` subprocess call through the actual sidecar RPC), and
  `examples/backend-plugin-demo` (`src/`-dir) reconfirmed unaffected.
- `DOS backend test` (the user's own rehearsal project) fixed live:
  both artifacts re-pulled to their correct root-relative locations, its
  `tsconfig.json` alias corrected to match, `auth-seam.ts`/
  `auth-actions.ts` wired for real, and the whole login flow (real
  email, real code, real session, real sign-out) verified in a real
  browser.
- Engine-only change -- the already-open PRs (#67, #68, #69) on
  `growtharc-ai-helpers` are unaffected and remain open.

## Phase 25 — A second real backend-plugin (`email-code-auth`), and a stakeholder demo runbook

- **`email-code-auth`**: passwordless email login built for a stakeholder
  demo that needed something simpler than `nextauth-credentials` (no
  Prisma, no bcrypt, no database) -- a stateless 6-digit code instead of
  Auth.js's built-in Email provider, which turns out to require a
  database adapter. Two real bugs found and fixed while verifying: Node's
  `crypto` module doesn't run in the Edge Runtime reachable from
  `middleware.ts` (fixed with `crypto.subtle`); a missing
  `callbacks.authorized` meant `middleware.ts` never actually blocked an
  unauthenticated request despite being wired up.
- **Paired with `kortix-auth-shell`** on one sample app -- a UI-component
  pull and a backend-plugin pull connected by a few real lines, proving
  the two pull types cooperate on one real feature.
- **Fixed a real, separate bug found in the process**: `kortix-auth-shell`
  (and the `ui-component-extractor`/`feature-extractor` skills) used a
  vendored-runtime React-import workaround that an earlier engine fix
  already made both unnecessary and actively harmful (it crashes once
  genuinely pulled into a real project). Fixed the payload and both
  skill docs.
- Every lifecycle row dry-run for real against `email-code-auth` through
  the actual `deliveryos` CLI/engine, not manual file copying.
- New: `docs/backend-plugin-demo-script.md`, a presenter's runbook.
- Not pushed to `growtharc-ai-helpers` yet -- verified against a local
  test remote only, pending the user's own rehearsal.

## Phase 24 — A plain-language "How installing this works" panel, and a merged audit trail

- **Detail now shows a plain-language walkthrough of the whole install
  lifecycle** -- 11 rows (install, auto-wiring, build-break recovery,
  file-exists merge, the after-install summary, audit, uninstall, secrets,
  rotating a secret, reconfiguring, updating), open by default above the
  existing Connection-status chips, gated on real presence rather than a
  `kind` check, with "View →" links jumping straight to the live section
  for anything that has one.
- **Found while building it: the Activity tab's "every AI proposal is
  logged and viewable" claim wasn't fully true.** The build-fix log
  (`.deliveryos/build-fix-log.jsonl`, existing since Phase 10) had no
  reader and was never shown anywhere -- only file-exists merges reached
  the Activity tab. Fixed: `BuildFixLogEntry` now carries
  `remoteName`/`artifactId`, a new `readBuildFixLog` reader + sidecar RPC
  were added, and the Activity tab now merges both logs into one
  chronological feed, each entry labeled `MERGE` or `BUILD FIX`.
- Verified live via CDP against the real `nextauth-credentials` artifact.

## Phase 23 — "Already wired" detection

- **The Wiring section no longer offers "Merge with Claude" for a file
  that's already correctly wired.** `resolveWiringActions` now compares a
  target file's real content against `whenAbsent.snippet` and marks an
  exact match `alreadyWired: true` -- shown as a green "Already wired ✓"
  badge instead of "EXISTS," excluded from "Merge all" and from the
  Connection-status panel's review count. Found via direct testing: 3 of
  4 real wiring targets for `nextauth-credentials` were already correct
  from an earlier pull, but the button still offered itself, wasting a
  click and a real `claude` call each time.

## Phase 22 — A full codebase swarm, and 7 real bugs fixed

- Three parallel review passes (security-focused, deep review of
  Phases 18-21's own new code, broad engine-wide sweep) found and fixed 7
  real bugs, each with a new regression test: `pull`'s new default
  falsely reporting "no build command found" for non-backend-plugin
  artifacts; a preview cache-key collision serving the wrong component's
  HTML for same-named components in different category folders; a
  request-guard gap letting the Connection-status panel render stale
  data; a duplicate-concurrent-apply race in "Apply all proposed
  merges"; missing path-containment checks on `install_target`
  (`push.ts`, `catalog.ts`) and `sourcePath` (`checkDrift.ts`);
  `pendingPr`/`wiredFiles` silently dropped on re-pull; and untrusted
  `wiring_actions` able to auto-write to `.git/`, `.github/workflows/`,
  `.vscode/`, `.husky/` with no confirmation for unsigned artifacts.

## Phase 21 — A persistent "Connection status" panel

- **Detail now shows a persistent "is this actually connected?" panel**
  for any pulled artifact with `install_params`/`wiring_actions` --
  real-time chips for Configured (N/M) and Wired (N/M, K need review),
  recomputed fresh every time Detail opens, plus a new `artifact.verifyBuild`
  RPC behind an explicit **Verify build** button (never run automatically,
  since a real build isn't free). Replaces relying on the old post-pull
  toast/banner, which only ever answered this question in the moment
  right after an action and forgot the instant you navigated away.
- Two real usability bugs found via direct user testing, fixed same-day:
  a "needs review" chip with no way to actually reach what it was
  naming (now a real button that jumps straight to it), and **Verify
  build** giving no visible confirmation to someone watching the button
  rather than the chip (now also fires a toast).
- Also found and fixed, in the real `nextauth-credentials` artifact
  itself: its `layout.tsx` wiring action declared guidance text as if it
  were a complete file, caught by "Merge with Claude" correctly refusing
  to guess -- fixed at the source, version 1.0.1, pushed.

## Phase 20 — "Merge all with Claude"

- **The Detail view's per-file "Merge with Claude" button now has a batch
  counterpart**: when 2+ wiring actions target files that already exist,
  a "Merge all with Claude" control proposes a merge for every one of
  them (sequentially, never concurrent) and a follow-up "Apply all
  proposed merges" applies every real proposal (also sequential, each
  with its own build-verify/rollback/audit-log entry) -- one honest
  refusal never blocks the rest. No engine/sidecar changes needed; it's
  the same `requestWiringMerge`/`applyWiringMerge` calls, just
  orchestrated across every file from one button. Dogfooded against
  `nextauth-credentials`'s real 4 wiring actions: 3 honest refusals, 1
  real merge applied and logged.

## Phase 19 — `deliveryos pull` defaults to auto-wiring

- **`deliveryos pull` now auto-wires a `backend-plugin`'s `wiring_actions`
  by default** -- the same safe behavior the desktop app's Pull button
  already had (new files written verbatim, existing files never touched,
  build reverified afterward, one plain-language summary printed), just
  not previously available from the CLI at all. `--no-wire` opts back
  into the old plain-copy-only behavior for scripted/CI use. Prompted by
  benchmarking DeliveryOS's own flow against shadcn/Clerk/Stripe-style
  dev-tool UX and platform-team trust expectations -- the safety model
  already matched best practice, the CLI just wasn't using it.

## Phase 18 — Template component-grid preview performance

- **A `kind: template` artifact's Components grid (e.g. `kortix-design-kit`)
  is now cached and lazy**, matching what the main UI Components list
  already did. Root cause: every component's preview compiled uncached, all
  at once, on every tab open. `previewCachePath`/`getOrCompilePreview`
  gained an optional `subKey` so multiple previews can share one
  `(remoteName, id, version)` cache root without colliding; new
  `compileTemplateComponentPreview` wires the `preview.compilePayloadComponent`
  RPC to it; the grid now builds card shells immediately but only compiles
  a component's preview once it scrolls into view (`IntersectionObserver`,
  same pattern `uiComponentsListObserver` already used). Measured against
  the real `kortix-design-kit` payload: ~1.6s cold vs. ~0.2s cached, per
  component.

## Phase 17 — Backend-plugin scaffolding assistant

- **New `deliveryos scaffold-backend-plugin --path <dir> --consumer-file
  <file> [...]`** -- scaffolds a draft `wiring_actions`/`install_params`
  YAML for a backend-plugin manifest. Not "extraction": mechanical
  detection where it's safe (`install_params`, via the existing
  `detectInstallParams.ts`), an AI-suggested draft where it's judgment
  (`wiring_actions`, via new `suggestWiringActions.ts`), always
  human-reviewed -- never writes to a real manifest. Validated by hand
  against the real `nextauth-credentials` artifact before shipping: 3
  correct integration points suggested, 0 false positives on a
  deliberate distractor file.

## Phase 16 — A real update-apply path

- **`deliveryos check-updates --apply`** and a new sidecar
  `artifact.applyUpdate` RPC actually apply an available update now,
  instead of `check-updates` only ever reporting "installed -> available."
  Deliberately conservative: only applies when the current install has
  zero local edits (byte-for-byte identical to its pristine snapshot) --
  an artifact with real local edits is reported, never guessed at or
  silently skipped.
- **Fixes a real bug** in the app's existing "Update" button (previously
  just a plain re-pull under a friendlier label): a plain pull never
  deletes a file a newer version actually removed, so it would silently
  survive forever. The new path diffs the old pristine snapshot against
  the new payload and deletes exactly those files. Both the single-artifact
  "Update" button and the bulk "Pull all" action now use it for
  already-pulled, no-wiring-declared artifacts.
- Consolidated `pull.ts`/`verifyBuild.ts`'s duplicated `isExecError`/
  `isToolNotFoundError` helpers into `src/engine/execHelpers.ts`.

## Phase 15 — Full-codebase audit and fix pass

- **Dark-mode palette redesigned** after real visual review caught two
  problems the original hex-value review missed: the neutral surfaces
  read as muddy brown (now a cool charcoal, with only the deliberate
  accent tints keeping real hue), and `card` was barely lighter than
  `surface` while `surface-tertiary`/`surface-inset` were accidentally
  LIGHTER than `card` -- backwards relative to light mode's own
  direction. Corrected; DESIGN_SYSTEM.md's dark-mode table updated to match.
- **Security fixes**: path-traversal via untrusted manifest
  `install_target`/`payload_path` closed in 4 places (`pull.ts`, `push.ts`,
  `payloadDir.ts`'s `resolvePayloadDir`, new shared `resolveContainedPath`
  in `paths.ts`); `removeArtifact.ts`'s primary delete target re-validated
  for containment (previously only `wiredFiles` was); `remoteCachePath`
  now sanitizes `name` (matching its sibling `previewCachePath`); a
  case-sensitive filename exclusion in `pullPayloadComponent.ts` fixed.
- **Data-loss fixes**: `fixBuildFailure.ts`/`requestWiringMerge.ts` now
  refuse (rather than silently truncate-and-overwrite) a file over 8000
  chars; `bumpVersion` gained a `default` case instead of silently
  returning `undefined`; `branchName.ts` no longer produces an invalid
  double-slash ref for an unslugifiable id; `sync.ts`'s merged-PR branch
  no longer drops `installTarget`/`wiredFiles`; `lockfile.ts` throws a
  clear `LockfileCorruptError` instead of a raw `SyntaxError` on corrupt
  `lock.json`; `runClaudeSubprocess.ts` gained a real `maxBuffer`.
- **Frontend fixes**: per-row (not shared module-level) request-token
  guards for the build-fix/wiring-merge/design-fix rows, fixing a
  cross-row response collision; Add New's Enter-key handler no longer
  hijacks Enter on a focused button; `--font-mono` now defined; new
  adaptive `--icon-fg-warm`/`--icon-fg-cool` tokens fix dark-mode icon
  contrast; the Documentation tab's markdown iframe is now theme-aware;
  `loadUiComponentPreview` checks `row.isConnected` before acting on a
  stale resolution; `beginProgress`'s internal `listen()` call can no
  longer leave the progress panel stuck; dead `.detail-card` CSS class
  removed; toast stack gained `aria-live`, 3 search inputs gained
  `aria-label`.
- **Concurrency**: `remoteRegistry.ts`'s add/remove now use the same
  `proper-lockfile` pattern as `lockfile.ts`. (A separate, real
  cross-command git-sequence race in the sidecar was found but
  deliberately not fixed this pass -- see PLAN.md's Phase 15 entry.)
- **CLI/sidecar parity**: added `deliveryos remote list` and
  `deliveryos check-pending-pushes`; `deliveryos list` now reports
  `localStatus`; sidecar's `artifact.push` now validates `bump`;
  `artifact.applyInstallParams` now returns the same "doesn't re-run
  wiring_actions" note the CLI already printed.
- **Docs**: ARCHITECTURE.md/DESIGN_SYSTEM.md corrected in place (both had
  drifted badly -- fictional nav/AI-component sections, a stuck-at-Phase-0
  header); README.md's CLI section filled in with every previously-missing
  command and flag.
- **Tests**: 5 new previously-zero-coverage files
  (`paths.test.ts`, `remoteRegistry.test.ts`, `runClaudeSubprocess.test.ts`,
  `githubAuth.test.ts`, `output.test.ts`), plus regression tests added to
  8 existing suites for every fix above.

## Phase 14 — Dark mode

- **Dark mode toggle in the desktop app.** New `--ink` token replaces 28
  text-role usages of `--primary-700`/`--primary-800` (kept, unchanged,
  for their other role: the 5 solid-fill button/chip backgrounds paired
  with white text). Pale accent tints (`sage-100`, `sand-100/200`,
  `sky-100`, `success/warning/danger-100`) get real darkened dark-mode
  equivalents, with `success/warning/danger-600` lightened to match, so
  badges/banners don't render as bright light-mode patches on a dark
  page. Defaults to `prefers-color-scheme`, overridden either direction
  once the user makes an explicit choice via a new toggle button in the
  context strip (new `i-theme-sun`/`i-theme-moon` icons, persisted to
  `localStorage`). A small inline head script in `index.html` applies a
  saved choice before first paint to avoid a flash of the wrong theme.

## Phase 13 — Backend plug-and-play: basic hygiene (in progress)

- **Configuration tab reuses an already-existing value.**
  `renderInstallParamsSection` (`app.js`) only ever pre-filled each field
  from `param.default` -- reopening Configuration after filling in 2 of 3
  required fields showed all 3 blank again, even though 2 were already
  saved for real in `.env.local`. New read-only sidecar RPC
  `artifact.readInstallParamValues` (`src/sidecar.ts`) resolves the same
  manifest `artifact.applyInstallParams` already does, then filters
  `readExistingEnvValues` down to only the keys THIS artifact's own
  `install_params` declare, so one artifact's config can never leak into
  another's form. `renderInstallParamsSection` is now async (with its own
  `installParamsRequestId` request-token guard, matching the wiring/drift/
  activity sections) and prefers a real existing value over `param.default`
  when filling `input.value` -- same `provided > existing > default`
  precedence `resolveInstallParamValues` already established. Degrades to
  today's default-only prefill if the RPC call fails for any reason. New
  sidecar e2e test covering both the reuse and the no-leak case.
- **Post-pull secret rotation: `deliveryos config <id>`.** The engine-level
  `applyInstallParams` RPC (`src/sidecar.ts`) already existed, but nothing
  outside the sidecar could call it -- no CLI command wrapped it, and
  `cli/commands/pull.ts` told CLI-only users to "edit `.env.local` directly"
  instead. New `deliveryos config <id> [--remote <name>] --set KEY=VALUE`
  (`src/cli/commands/config.ts`) wraps the exact same real sequence the
  sidecar handler already used (`resolveArtifact` -> `resolveInstallParamValues`
  against `readExistingEnvValues` -> `applyInstallParams`), and reports the
  same `missingRequiredParams`/`gitignoreWarning` output `pull.ts` already
  does. Also prints its own honest, undecorated note that it does NOT
  re-run `wiring_actions` -- a rotated value only reaches code that reads
  `process.env` at runtime, since a real re-wire path is still the
  separate, deferred "A real update-apply path" item below.
- **Uninstall: `deliveryos remove <id>`.** There was no way to cleanly back
  out a pulled artifact at all -- `removeRemoteEntry` only unregisters a
  git remote, never a pulled artifact's own files, and nothing recorded
  which files a pull's wiring had created fresh vs. which already existed
  in the project. `LockEntry` gains two additive fields: `installTarget`
  (the real resolved path `pullArtifact` copied a payload to) and
  `wiredFiles` (`applyDeterministicWiring`'s own `applied` list, recorded
  by `pullAndAutoWire` via a second `upsertEntry` call right after wiring
  runs, only when it created something). New `removeEntry`
  (`src/engine/lockfile/lockfile.ts`) mirrors `upsertEntry`'s real
  inter-process lock. New `removeArtifact`
  (`src/engine/pull/removeArtifact.ts`) deletes the install directory
  (falling back to resolving it via the manifest for an old-shape entry
  with no recorded path), deletes every real `wiredFiles` entry
  (re-validated for containment, never trusted blindly), deletes the
  pristine snapshot, then drops the lockfile entry last -- and reports,
  never auto-touches, anything that predates the pull or went through the
  AI wiring-merge flow (`filesNeedingManualReview`) or is still sitting in
  `.env.local` (`envParamsStillSet`). Wired up as a CLI command, the
  `artifact.remove` sidecar command, and a confirm-gated Remove button in
  Detail. 11 new unit tests plus an updated e2e assertion for the
  lockfile's new shape.
- **Secrets safety net for `.env.local`.** `applyInstallParams` writes
  real secret values into `.env.local` with zero check anywhere that the
  file is actually gitignored -- a real path to committing a secret to a
  shared remote. New `checkEnvLocalGitignoreCoverage` (same `ignore`-
  package pattern as `push/diff.ts`'s `loadIgnoreFilter`) warns clearly
  when it isn't covered, whether by no `.gitignore` at all or one that
  just doesn't happen to include it -- never auto-edits `.gitignore`,
  only warns. Only checked when a call actually wrote something (mirrors
  `upsertEnvFile`'s own no-op-on-empty gate), so the overwhelming
  majority of artifacts with no `install_params` never trigger a
  pointless check. Surfaced as its own distinct toast -- never folded
  into the calm post-install health summary -- everywhere a real
  pull/configure can write a secret: plain pull, `pullAndAutoWire`, the
  Configuration tab's apply button, and bulk pull (aggregated once,
  since every artifact in one run shares the same `.gitignore`). 11 new
  unit tests.
- **Timeouts on build/install commands.** Neither the build check
  (`runProjectBuild`/`execAsync` in `src/engine/pull/verifyBuild.ts`) nor
  the post-install command (`execSync` in `src/engine/pull/pull.ts`) had a
  timeout at all -- a hung/interactive command blocked indefinitely.
  Both now carry a real one (`BUILD_VERIFY_TIMEOUT_MS` = 5min,
  `POST_INSTALL_TIMEOUT_MS` = 10min). Also closed a real, confirmed gap
  where "the tool to run this isn't on PATH" looked identical to "the
  code doesn't compile": both call sites now report a genuine timeout and
  a genuine missing-tool case as their own distinct, honest outcome
  (`BuildVerificationResult`'s new additive `timedOut`/`toolNotFound`
  fields; `PostInstallError`'s message text gains distinct prefixes for
  the same two cases). The "tool not found" detection was verified
  empirically first, not assumed from docs: on Windows, `exec`/`execSync`
  route through cmd.exe, so a missing tool never throws a Node-level
  ENOENT -- it's the shell reporting an ordinary-looking non-zero exit
  with its own "not recognized"/"not found" wording. 6 new unit tests
  (`test/unit/verifyBuild.test.ts`, `test/unit/pull.test.ts`) exercise
  real hung/missing-tool commands with test-only timeout overrides, not
  mocks. One real, confirmed limitation found along the way, deliberately
  left as a known gap (bigger than this item's scope): on Windows, killing
  a timed-out command only terminates the immediate shell wrapper, not the
  grandchild process it actually spawned -- a "timed out" command can keep
  running in the background afterward.
- **Follow-up found via review, not speculative**: the timeout work above
  landed real `timedOut`/`toolNotFound` data, but nothing downstream
  actually used it. The plain-language health narrator
  (`buildPostInstallHealthSummary`, Phase 12) treated a timeout or a
  missing build tool identically to a genuine compile failure --
  misleading framing, since neither is "the code doesn't build." Worse:
  Detail's "Want help fixing this?" AI button still got offered for both,
  even though an AI code-fix can't repair a hung process or make a
  missing tool exist. Both now get their own distinct, honest sentence in
  the narrator, and the AI-fix offer is never shown for either case. 2 new
  unit tests.

## Phase 12 — Backend plug-and-play, unlocked further

- **A visible audit trail for the wiring-merge log.** Each
  `wiring-merge-log.jsonl` entry is now tagged with the artifact that
  caused it (fixed before it ever shipped, since the wiring-merge PR was
  still open/unmerged), so a project with more than one pulled
  backend-plugin artifact doesn't mix their entries together. New
  "Activity" Detail tab, gated on real matching entries existing, shows
  what was proposed, applied, or rolled back, with before/after content
  behind a `<details>` disclosure. 6 new/updated unit tests, real
  dogfood via a throwaway script confirmed filtering and ordering.
- **Post-install health narrator.** Closed a real, confirmed gap: the
  toast shown after an auto-wired Pull never mentioned still-missing
  required `install_params` at all -- silently dropped. New
  `buildPostInstallHealthSummary` (deliberately deterministic, not an AI
  call -- every input is already a known fact) synthesizes wiring
  applied/needsReview, the build result, and missing install params into
  one coherent plain-language summary, shown both as the Pull toast and
  as a persistent Detail banner (the toast fades; the banner doesn't).
  9 new unit tests covering every real scenario (clean pass, missing
  params, build failure with a capped output excerpt, no build command
  detected, nothing left to do).
- Reviewed the original 6-item Phase 12 brainstorm against this
  project's own discipline (only build what's proven needed) before
  committing to anything -- 4 of the 6 items were deferred or descoped
  with reasons recorded in PLAN.md; only the two above were built.

## Phase 7 — Backend plug-and-play: AI wiring merge

- **Closed a real, previously-unaddressed gap in Tier-2 wiring**: when a
  `wiring_action`'s target file already existed at pull time, the only
  option was "review it yourself" -- even a static `whenPresent.snippet`
  the artifact's author wrote was just merge guidance text, never
  applied. New "Merge with Claude" button in Detail's wiring section:
  reads the real existing file, proposes a genuine merged version via a
  real Claude subprocess, applies it on confirmation, and re-runs the
  project's real build to verify -- auto-rolling back if it doesn't
  actually keep the project building. Same ask→apply→verify→rollback
  shape already proven for the build-fix and design-fix flows, with its
  own audit log (`wiring-merge-log.jsonl`).
  Dogfooded for real against the actual `nextauth-credentials` artifact
  on a real scratch project: an honest `mergedFile: null` refusal on a
  genuine library conflict (better-auth vs. NextAuth, never guessed or
  forced), a real rollback when a proposed merge broke the build for an
  unrelated environment reason (a missing path alias), and a clean merge
  + passing rebuild for a genuinely additive case (adding an auth
  middleware export while preserving an unrelated existing export and
  merging two matcher arrays). 19 new unit tests.

## Phase 11 — Design-kit bundle & design-quality checks

- **Phase 11's last open item, run for real: the full design-quality
  end-to-end test.** Pulled the real `design-kit` bundle (now 10
  components) into a fresh scratch project via the real CLI, confirmed
  every component compiles/live-previews clean, then planted a genuine
  self-nesting anti-pattern in a new component simulating "Claude Code
  built UI from the kit." A real `deliveryos scan` correctly flagged it;
  the real fix flow (a real Claude subprocess call, then a real apply +
  recompile) fixed it for real, confirmed by re-checking the fixed file
  no longer trips the detector. Phase 11 is now fully done.
- **Source-drift detection for extracted artifacts.** Once a project or
  component is extracted from a real external codebase (via the
  `starter-kit-extractor`/`ui-component-extractor` skills), nothing
  previously tracked whether that real source had since changed. New
  `src/engine/drift/` module hashes each source file at extraction time
  (`SOURCES.json` at the payload root) and re-hashes it later to report
  `unchanged`/`drifted`/`source-missing` — via a new `deliveryos
  check-drift` CLI command and a "Check for source drift" Detail tab,
  both gated on real `SOURCES.json` presence. Verified against the real
  `kortix-design-kit` artifact and Suna's actual source on disk.
- Fixed Detail's Type Scale section rendering blank for any design kit
  whose `GUIDELINES.md` names its table columns differently than the
  original `design-kit` artifact (found via `kortix-design-kit`, whose
  real Suna-derived table has no `Element`/`Weight` columns at all) —
  now falls back across known column names, and correctly converts
  `rem`-based sizes to pixels.
- Scan can now detect a whole standalone project (not just a single
  component) as a pullable `kind: template` candidate, requiring both a
  real build script and real routing evidence so it doesn't over-flag
  every package in a monorepo. Ships alongside a new
  `starter-kit-extractor` skill for the human/AI judgment work of
  cleaning one up.
- Fixed two Detail-view bugs found from real use: switching views no
  longer leaves the new view scrolled to the old view's position, and a
  brand-new artifact's tabs now correctly default to the intended lead
  tab (Design/Components) instead of getting stuck on Configuration just
  because it resolved first. Also moved the per-component "Pull" button
  into the component's own detail view and reordered Detail's tabs so
  the visual content leads.
- A full review pass on the Detail-tabs/markdown/pull-component work
  (two review agents plus manual verification) found and fixed several
  real bugs: a markdown XSS gap where `javascript:` links rendered live
  (fixed with a URL-scheme allowlist), a tab-state race where a
  same-artifact refresh could silently steal the active tab, a
  stale-data bug when returning from a component's detail view mid-
  refresh, a leaked iframe listener, a component-pull bug that silently
  dropped nested files and overwrote existing ones on re-pull, an
  empty-`GUIDELINES.md` tab-visibility bug, and unwrapped long tokens
  clipping off the markdown frame's edge.
- Fixed a "Back to Browse" infinite loop after visiting a component's
  own detail view, and added a "Pull" button per component in the
  Components tab so a single component's file(s) can be copied into a
  project without pulling the whole artifact.
- Detail view now renders real markdown (headers, tables, links, code
  fences) instead of literal text, via a vendored markdown parser inside
  a sandboxed iframe with escaped HTML and a safe-URL allowlist. Also
  split Detail's growing pile of sections into tabs
  (Preview/Configuration/Documentation/Design/Components/Routes), only
  showing tabs that actually apply to a given artifact.
- Detail view now shows a real route/page map for whole-app templates,
  parsed directly from the artifact's own `src/routes.tsx` rather than a
  hand-maintained description.
- Shipped `growtharc-react-vite-starter`, the company's whole starter
  kit (Vite+React+TS, routing/layout, Azure AD SSO) as one pullable
  template, merged from real project branches with several real bugs
  fixed along the way (import-casing, dead CSS, a missing route, an
  invalid SCSS lint config).
- Added a generic README fallback in Detail for artifacts that have
  neither `GUIDELINES.md` nor install params, so config-only artifacts
  still show their setup instructions.
- Added a dedicated per-component detail view for design-kit's grid,
  showing every variant, a live props panel, and full usage-rule text.
- Grew the catalog with three real artifacts pulled from a GrowthArc
  project template: `azure-msal-sso` (Azure AD/Entra SSO backend
  plugin), four new design-kit components, and `react-vite-lint-scaffold`
  (a lint/tooling starter template) — each with real bugs found and
  fixed in the source before shipping.
- Matched Detail's visual polish to an earlier pitch mockup (bigger
  token swatches, real applied type samples, per-component usage-rule
  captions, a real layout-rules strip), and re-verified the mockup's
  other two scenes (the check-first skill, and a live unscripted demo)
  still hold up for real.
- Added a real Detail view for design-kit templates: live color/type
  tokens parsed from `GUIDELINES.md`, a component grid, and a light/dark
  theme toggle.
- Extended design-kit with `EmptyState`, `ErrorState`, and `Skeleton`
  components, plus a Motion section in `GUIDELINES.md` documenting
  transition timing.
- Built the "fix" step for design findings: an explicit ask/apply flow
  that identifies the right file, applies a fix, recompiles to verify,
  and auto-rolls back on failure.
- Added "Suggest with Claude" for anti-patterns a mechanical rule can't
  catch — an explicit, opt-in button that calls Claude Code to review a
  component and surface subjective issues (e.g. low-contrast text,
  inconsistent border radius).
- Added the first mechanical anti-pattern detector: flags a component
  that renders itself nested exactly two levels deep, while correctly
  allowing legitimate single-level recursion (e.g. a tree node).
- Shipped the design-kit bundle itself: five real components (Button,
  Card, TopBar, Feedback, Input) plus a `GUIDELINES.md` documenting the
  design system's radius/spacing/color tokens for the first time. Found
  and fixed a real rules-of-hooks bug in one component's preview along
  the way.

## Preview engine fixes (dark mode & sizing)

- Fixed a real dark-mode contrast bug in previews: components using
  `dark:` Tailwind classes were rendering against the viewer's own OS
  color scheme instead of a pinned light theme, explaining both a
  contrast complaint and a "background changes on its own" report.
  Pinned the preview compiler to light mode so `dark:` variants never
  activate, fixing every past and future component that uses them in
  one change.
- Chasing that fix, found and fixed three more bugs: a missing
  cache-version bump meant the fix wasn't reaching already-compiled
  previews; a translucent-surface component looked muddy against the
  preview frame's opaque background (removed the fill/border); and a
  hover-lift micro-interaction was getting clipped by the iframe's zero
  padding (fixed with a small padding, sized into the height
  measurement).
- That padding fix caused two regressions — a button row started
  wrapping unexpectedly, and any component using `min-height: 100vh`
  grew its preview to the maximum size via a feedback loop — both
  traced to the same root cause and fixed by reverting the padding
  change.
- Fixed a separate, narrower bug found while investigating the above:
  the "not yet mounted" check inferred that state from a literal 0×0
  measurement, which could also happen briefly for other reasons;
  replaced with a direct check of whether React has actually mounted
  anything yet.

## Phase 10 — Claude Code wired into the app UI

- "Want help fixing this?": on a build failure, an AI subprocess (no
  tool access, strict JSON in/out) proposes a fix from just the failing
  file and the error; a person reviews and applies it, the app re-runs
  the real build to confirm, and auto-rolls back if the fix didn't
  work. Every applied fix is recorded in a new audit log.
- The same code-review pass found five more real bugs, fixed the same
  day: blocking subprocess calls that froze the whole sidecar process
  during a slow AI call (made async); a prompt-injection gap where
  untrusted payload source wasn't clearly delimited from instructions;
  two "Suggest with Claude" UI bugs; a duplicated file-walking helper
  consolidated into one; and a detection gap for bracket-notation
  `process.env['FOO']` closed.
- Security fix: a path-traversal bug in the automatic wiring writer let
  a malicious `target_file` (e.g. `"../../../../evil.txt"`) write
  outside the target project. Fixed with a containment check applied at
  two independent layers.
- Added "Suggest with Claude" to Add New's autofill: an explicit button
  that calls a real `claude -p` subprocess to fill `description`/
  `componentTypes` when static analysis has no signal. Found and fixed a
  real Windows command-injection bug before shipping, and confirmed
  Claude Code's own tool-restriction flags aren't reliably enforced, so
  the design doesn't depend on them.
- Extended autofill to cover `stacks`, `description`, and `owner` for
  every artifact kind — each always sourced from a real mechanical fact
  (imports, JSDoc, git identity), never fabricated, and left blank when
  there's no real signal.
- Shipped deterministic apply-and-test on Pull: an artifact declaring
  `wiring_actions` now auto-applies safe file-writes (never overwriting
  an existing file) and runs the target project's own build
  automatically, reported in the progress log. Also added code-driven
  autofill for Add New's `install_params`, scanning a proposed
  artifact's real source for env-var references.

## Phase 9 — Claude Code as the status/health interface

- Shipped `deliveryos-status`, a Claude Code Skill for asking "what's
  the status": runs typecheck/lint/test and reports pass/fail, plus a
  doc-sync check that greps PLAN.md/CHANGELOG.md for PR links and flags
  any that describe a PR as still open when GitHub shows it merged. A
  real run against this repo found and fixed eight such stale-doc cases.

## Phase 8 — Claude Code check-first

- Installing `deliveryos-check-first` into a real global Claude Code
  skills directory and running it on an undirected task surfaced a
  real, previously-undiscovered bug: 4 of the catalog's 6 UI components
  destructured React hooks from a runtime global instead of a normal
  `import`, so they crashed immediately outside DeliveryOS's own preview
  sandbox. Root-caused to the preview compiler never marking `react`/
  `react-dom` as external, and fixed for good.
- Added a `deliveryos wiring` CLI command exposing Tier 2 wiring
  actions, and taught the skill a real wire-and-test loop (apply a
  snippet, run the build, fix what fails). A second end-to-end run
  found one more gap: `list --json` wasn't returning enough for the
  skill to evaluate a match without pulling first; fixed by extending
  it.
- Shipped `deliveryos-check-first` itself: a Claude Code Skill that
  checks the catalog automatically on relevant tasks instead of relying
  on someone remembering to look, so reuse becomes a side effect of
  normal engineering work.

## Phase 7 — Backend plug-and-play artifacts

- An end-to-end test in a genuinely fresh Next.js project proved the
  whole loop (pull, install-time config, signature verification,
  wiring) together for real, and found three real bugs no unit test
  could catch: a wiring path assumption that didn't match the
  artifact's own install location, a wrong API-route wiring snippet, and
  a cross-platform bug where Windows' default git line-ending setting
  silently broke signature verification.
- Shipped the security/provenance model: keyless Sigstore signing in
  CI, verified before any files are written on pull. Proven with a real
  signed artifact, and confirmed to fail closed against both a tampered
  payload and a forged certificate identity.
- Shipped the wiring agent (Tier 1 + Tier 2): safe placeholders are
  auto-filled from install params, and a new `wiring_actions` manifest
  field lets an artifact declare the handful of edits a project needs —
  surfaced as suggestions, never auto-applied.
- Shipped Detail/Pull UX for non-visual artifacts: a project's own
  `.env.local` gets an artifact's declared install params applied
  automatically, with a required-config checklist and provenance badge
  in Detail. Fixed a real bug where configuring one missing value made
  every other already-set value look missing again.
- Extended the manifest schema with `install_params`, `content_digest`,
  and a `signature` field, fully backward-compatible with every
  existing manifest.
- Pushed Phase 7's real target: an Auth.js v5 + Prisma Credentials login
  module for Next.js, with install params and a README documenting
  manual wiring steps.

## Tier 0 hardening

- Closed a real lockfile race between background auto-sync and a
  concurrent manual pull/push (fixed with proper file locking), and
  closed the "check GitHub by hand" gap by wiring PR merge/close-status
  polling into the same auto-sync tick that already checks for version
  drift.

## Phase 6 — UI Components

- Closed out Phase 6's end-to-end test checklist against a live remote.
  Found a real bug where a fix had been pushed to a PR branch after the
  PR already merged, so it never reached `main` — fixed via a follow-up
  PR. Then walked the full edit + drift-detection loop across two
  different projects, confirming `check-updates` jumps straight to the
  true latest version and a re-pull picks up the real change.
- Fixed a real docgen bug where `React.FC<Props>`-style components
  silently returned no prop schema — converting to a plain typed
  function fixes it. Vendored `lucide-react` so components importing it
  actually compile, plus a starter set of 16 Radix UI primitives, which
  surfaced a real gap where portal-based Radix components (Dialog,
  Popover, Select, Tooltip) couldn't resolve `react-dom` at all; fixed
  by vendoring that too.
- Fixed a real intermittent preview-rendering bug (a stale, months-old
  cached preview was still running long-superseded compiler logic) by
  keying the preview cache to a compiler-version constant, so any
  future compiler fix invalidates every cached preview at once.
  Investigating it surfaced a much more serious regression: the packaged
  desktop app's sidecar had been crashing on startup for every single
  command since a dependency was added, because Node's packaged-
  executable format can't resolve certain dynamic imports. Fixed by
  making that import lazy — a real platform limit that means the
  packaged app can never generate PR preview images itself; only the
  CLI can.
- Fixed real navigation complaints: Detail's "Back" button now returns
  to the real entry point instead of always landing on Browse, a
  successful propose from Scan's Review flow returns to Scan with the
  rest of that batch intact, and every inert PR-link became a real
  clickable "View PR" button.
- Fixed a broken PR preview image on the very first live PR:
  private-repo images aren't fetchable from GitHub's raw-content host by
  an unauthenticated request, and GitHub's PR-body renderer strips
  `data:` URI images entirely. Fixed by pointing at the PR's
  Files-changed tab instead when the repo is private.
- Shipped PR preview images and real version bumps on edit: a proposed
  or edited UI component's PR now embeds a real screenshot (captured
  with a real headless browser against the live-preview HTML), and
  edit-mode push finally writes an updated `manifest.yaml` — previously
  edits never bumped the version at all, so drift detection could never
  see a real edit.
- Fixed a scrollbar-flash bug during a component's resize/animation
  transitions, and documented a related, non-fixable platform limit:
  content meant to visually extend beyond its box (a tooltip, a
  dropdown) can never escape an iframe's box in current Chrome/Firefox.
- Added real Tailwind CSS generation to the preview pipeline (previously
  a Tailwind-authored component's preview had correct structure but zero
  visual styling), then fixed a packaged-app-only bug where Tailwind's
  CSS reset silently failed to load in the packaged executable, and
  vendored a short allow-list of common UI-kit libraries (`framer-motion`,
  `clsx`, `tailwind-merge`, `class-variance-authority`) so pasted
  components using them actually compile — fixing a real ESM/CJS
  interop bug along the way.
- Surfaced the real underlying error message in "Preview unavailable"
  placeholders instead of a bare, unhelpful message, and added a
  `ui-component-extractor` skill documenting how to bring an arbitrary
  pasted React component (from v0, shadcn, etc.) into a project so it
  compiles and is picked up by Scan.
- Fixed two gaps in Scan's auto-scaffolded preview: a required prop with
  a literal-union type or no sensible default got an invalid or blank
  placeholder value (fixed by picking a real allowed value or using the
  prop's own name), and a required function-typed prop got a real
  callable no-op instead of a placeholder that would throw if called.
- Wired structural UI-component detection into Scan (CLI, sidecar, and
  app): a purely deterministic heuristic (no AI call) finds components
  with a real props interface, auto-scaffolds a preview file, and gives
  the scanned candidate a real live preview plus import-safety warnings
  in Review.
- Fixed two real ResizeObserver bugs behind "different style on every
  refresh" and a later regression of the same fix: the observer was
  briefly watching the wrong element (a timing gap before React's first
  render), and a later fix for that re-introduced the bug in the real
  app specifically because measuring an element by resizing it put that
  same element back in the observer's own watch path — fixed by
  measuring a detached clone instead.
- Reworked the UI Components page's layout twice based on real
  feedback: first into a size-to-content masonry grid (several real
  bin-packing/measurement bugs fixed along the way), then simplified to
  a plain vertical list, removing the masonry dependency entirely. Also
  made the preview frame's width shrink to fit each component's real
  content, mirroring how height already worked, and fixed two serious
  regressions that width work introduced — a feedback loop that could
  shrink text to one character per line, and a permanent layout
  corruption from ever reporting a 0×0 pre-mount measurement. A
  separately reported hover-border-overflow bug could not be reproduced
  under rigorous testing and was left open.
- Added Storybook-style interactive controls to Detail: a component's
  props schema is derived automatically from its TypeScript interface,
  and variant switching/prop editing happen live against the same
  loaded preview. An independent code-review pass found and fixed four
  real bugs, including a listener leak and missing error handling
  around a broken variant.
- Added the "UI Components" feature itself: a new sidebar page shows
  real pushed React/TS and plain HTML/CSS/JS components as live,
  interactive preview cards, compiled via esbuild into a self-contained
  document and rendered inside a sandboxed iframe with a strict CSP. A
  code-review pass caught and fixed 7 further issues, including an
  observer leak and a click dead-zone over the live preview.

## Phase 5 — Polish

- Reworked the growtharc-ai-helpers import for real structural fidelity:
  agents/commands/rules now preserve their real category subfolders
  instead of flattening into one directory, and Scan now also looks at
  `.claude/commands`/`.claude/rules`. The catalog grew to 210 artifacts.
- Added `deliveryos scan`: finds agents/skills in a project that aren't
  tracked yet and proposes them, with a guessed description from
  frontmatter. Verified with a real end-to-end propose → merge → pull
  round trip.
- Added remote removal (`deliveryos remote remove`), and fixed a latent
  bug where a single-file payload always got wrapped in a directory
  convention, breaking `pull` whenever `install_target` was itself
  meant to be a file.
- Added an Edit button to Detail (and matching CLI flags) so an
  already-tracked artifact's description/roles/teams/stacks can change
  without touching its payload, via the same PR flow. Add New gained
  matching Stack and Team fields (previously roles-only), and tag
  values (stacks/roles/teams) now normalize case so "python" and
  "Python" no longer created two separate tag folders.
- Fixed the shared progress panel staying visible after navigating away
  from its artifact, a related layout bug where a long path could force
  the whole page wider than the viewport, and — found in a follow-up
  review pass — a Tag Folder "Pull all" that never showed the progress
  log at all plus a panel-position bug that pinned it to the window
  bottom regardless of content.
- Restyled the tag value list twice based on feedback (boxed icons →
  breadcrumb list → a card grid with an artifact count per tag), and
  fixed a CSS-specificity bug where hiding the artifact grid behind an
  expanded tag category silently didn't work.
- Added tag-based bulk pull as its own Tag Folder view: picking a tag
  category and value opens a dedicated page listing every artifact with
  that tag, each with its own inline Pull/Push button plus a "Pull all"
  for the whole folder.
- Fixed a crash proposing a new artifact from a single file via the
  file picker.
- Added transparency about what happens after a push opens a PR: the
  artifact's lockfile entry now tracks the PR, and Detail shows a
  "Check push status" button, resolving to `edited_locally`, still-open,
  or a real re-sync depending on the PR's actual state.
- Fixed a real bug found demo-prepping `arcos-cli`: running a pulled
  Python tool generates cache files that `.gitignore` correctly
  excludes, but the local-edit detector didn't know about `.gitignore`
  at all and misread the cache as a local edit, breaking a real push.
- Fixed `push --new` copying a whole project folder's payload
  unfiltered (including a nested `.git/` directory and anything the
  project's own `.gitignore` excludes), and fixed it crashing whenever
  a proposed id contained a space or uppercase letter, since git branch
  names can't contain whitespace — the id is now slugified and
  validated client-side first.
- Fixed Browse's "Refresh" button only re-reading the local cache
  instead of actually fetching from the remote, so a newly merged
  artifact never appeared until something else happened to trigger a
  fetch, and fixed `edited_locally` having no way to resolve in the UI
  (added a "Discard local edit and re-sync" option).
- Restyled the desktop app end to end against the ArcAI design system:
  renamed color tokens to match, corrected heading weights, added
  AI-specific button/badge variants, an accessible focus ring, and a
  reduced-motion mode. Also fixed three places using the AI-reserved
  accent color for plain, non-AI UI.
- Closed several real filter/sort/search gaps: multi-select kind chips,
  a Remote filter, a Sort control, broader search (kind/owner/tags), and
  generalized "Pull all" to respect whatever filters are active. Add
  New's Kind field now offers every kind already in the catalog plus a
  way to add a new one, and Roles/Stack/Team became a reusable
  chip-picker instead of a raw comma-separated text field.
- Turned Add New into a step-by-step wizard (progress bar, Next/Back, a
  final Review step with per-field Edit links) — later scoped to only
  Scan's flow after feedback that stepping through mostly-blank fields
  for a direct Add New felt worse, not better.
- Rebuilt the app's navigation around a left sidebar (Browse, Browse by
  tag, Settings, Scan, Add New), replacing the old top bar, with
  "Browse by tag" as its own real destination. Removed the "AI guessed"
  sparkle badge from Scan results as a gimmick rather than useful
  signal, since every field is editable anyway.
- Added drift detection (`check-updates`): compares a pulled artifact's
  recorded version against the remote's current one, with a distinct
  "both changed" state when it's also been locally edited.
- Added background auto-sync: a 20-minute timer reruns the same check
  automatically, staying quiet unless it finds something.

## Phase 3 — Tauri app

- Added `src/sidecar.ts`, a JSON-over-stdio dispatcher wrapping the
  engine, and packaged it as a standalone Node executable — the
  foundation letting a desktop UI talk to the engine with no Node
  install needed on the target machine.
- Built the real Tauri desktop UI (Browse, Detail, Add-new, Settings)
  via one generalized sidecar-call Rust command, styled with the
  ArcFlow brand system, with live progress visibility during Pull/Push
  (a real, named-stage activity log instead of a fake percentage bar).
  Deliberately deferred: onboarding/sign-in, sync/drift banners,
  conflict resolution, version history, profile switching.
- Restructured Browse cards so the whole card opens Detail, with
  Pull/Push happening from there, and added an "Open folder" button in
  Detail — fixing two real bugs found in QA (an unscoped permission,
  and a wrong API that opened files in an editor instead of revealing
  them).
- Added a "Setup command" field for a brand-new artifact's own install
  step (`--post-install`), verified end-to-end via a real PR merge and
  pull.
- Real MSI/NSIS installers build successfully; cold-start latency
  measured acceptable.
- Fixed several real bugs found in QA: the "Refresh" button (and any
  button sharing its busy-state helper) could get stuck showing
  "Working..." after two overlapping actions raced; a pull's "pristine
  snapshot" was taken before `post_install` ran, so its generated files
  were misread as local edits; `post_install`'s own output could have
  corrupted the sidecar's JSON stream; and the Rust host could leak
  orphaned sidecar processes on certain error paths.

## Phase 2 — ArcOS as a remote

- Added an optional `payload_path` manifest field so pull/push can read
  from a pre-existing file/directory elsewhere in a remote's repo,
  instead of requiring the fixed `artifacts/<id>/payload/` convention.
- Wrote real manifests for two ArcOS catalog assets, using
  `payload_path` to point at their real files.
- Proved the full pull → edit → push → PR loop end to end against real
  ArcOS catalog content, via a personal scratch fork since forking the
  shared repo is disabled at the org level. Left open: whether ArcOS's
  own multi-reviewer convention applies to catalog assets.

## Post-Phase-2 addendum — two more real artifacts

- Added `arcos-cli`, a full pull-only mirror of the real `arc_os` repo,
  and `launchpad-template`, sourced from an entirely unrelated Next.js
  starter kit — confirming the manifest/pull/push mechanics are
  genuinely payload-agnostic, with zero engine changes needed for
  either.

## Phase 1 — Push

- Added `deliveryos push`: pushes a local edit as a branch + real
  GitHub PR, and a `--new` mode to propose a brand-new artifact the same
  way.
- Diff detection via a pristine snapshot taken at pull time; PR
  creation via Octokit, authenticated through the ambient `gh` CLI;
  id-collision detection on propose-new.
- Fixed two bugs found in QA before release: a cache-isolation bug
  where a second push could build on a prior push's leftover commit,
  and a flag-name collision with Commander's own `--version`.

## Phase 0 — Engine MVP

- Added `deliveryos remote add`, `deliveryos list`, and `deliveryos
  pull` — the core loop of registering a git-backed remote, listing its
  artifacts, and copying one to its manifest's `install_target`, tracked
  in a project-local lockfile.
- Manifest schema (zod) with an intentionally open-ended `kind` field.

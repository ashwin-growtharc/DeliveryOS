# DeliveryOS — phase-by-phase task plan

Companion to [ARCHITECTURE.md](ARCHITECTURE.md), which explains *what* and
*why*; this file tracks *what's done and what's next*, phase by phase. See
[CHANGELOG.md](CHANGELOG.md) for detailed release notes and
[README.md](README.md) for usage.

**Phases 0–2 are the MVP/POC**: single developer, no auth, no UI, CLI only.
They proved the core loop — pull, edit, push, review, merge — works end to
end against one real remote before anything else got built.

---

## Phase 0 — Engine MVP — **Done**

Goal: `deliveryos pull` works against one throwaway test remote, no auth, no UI.

- Manifest schema + runtime validator (zod), matching ARCHITECTURE.md
- A lockfile tracking what's installed per machine
- `remote add`, `list`, and `pull` commands
- A small real test remote with sample manifests to pull against
- Verified end to end: add → list → pull lands files correctly and updates the lockfile

## Phase 1 — Push — **Done**

Goal: `deliveryos push` opens a real GitHub PR from a local edit.

- GitHub API integration for branch creation, commit, and PR opening
- Diff detection against the lockfile
- Handles "edit an existing resource" and "propose a new one" as distinct cases, with id-collision detection on propose-new
- Verified end to end, both automated and against a real GitHub repo (two QA bugs found and fixed along the way — see CHANGELOG.md)

## Phase 2 — ArcOS as a remote (MVP/POC complete here) — **Done, with a caveat**

Goal: pull a real ArcOS catalog asset, edit it, push a real PR against `arc_os`.

- Manifests written for real ArcOS catalog assets, ArcOS's `catalog/` registered as a remote
- Proven against a personal scratch copy of the catalog (forking the real org repo is disabled), not the shared repo itself
- Full pull → edit → push loop proven end to end for real
- **Caveat**: respecting `arc_os`'s own multi-reviewer convention is not yet proven against the real repo
- Two more real artifacts added afterward to prove the pattern generalizes with zero engine changes: `arcos-cli` and `launchpad-template`

---

## Phase 3 — Tauri app — **Done (installer + fresh-machine test deferred)**

Goal: a real desktop app wraps the engine.

- Spiked packaging the engine as a Tauri sidecar; size and cold-start latency both came back acceptable
- Rust shell + webview built
- Browse, Pull, Push (edit + propose-new), Detail, and Settings wired to the engine, with a live progress log
- Auto-update wired up (checks for, downloads, and installs new versions)
- **Deferred, deliberately**: a signed installer per OS (not needed until distributing beyond the builder's own machine) and a true "fresh machine, non-builder person" install test

## Phase 4 — Team rollout — **Deferred, out of sequence**

Goal: multi-user profiles, role-based filtering, and real auth.

Blocked on GrowthArc not having real SSO/identity infrastructure yet — rather
than block everything else on that, Phase 5 was done next instead, since
nothing in it depends on auth. Not started: auth/SSO, saved profile filters,
stack-based routing, multi-remote support beyond ArcOS, per-resource review
overrides.

## Phase 5 — Polish — **Mostly done, a few items deferred**

Goal: round out the single-user app before team rollout.

- Drift detection (`check-updates`) — surfaces when a pulled artifact has an upstream update, with a distinct state when it's also been locally edited
- Background auto-sync on a timer, silent unless it actually finds something
- Tag-based bulk pull in the app (Browse by tag, "Pull all")
- Edit an already-tracked artifact's metadata (description/roles/teams/stacks) without touching its payload
- Scan a project for agents/skills not yet in the catalog and propose them
- Restyled the app to match the ArcAI design system
- Several rounds of real UX fixes: closed filter/search/sort gaps, added a step-by-step Add New wizard (later scoped to Scan-only after feedback), rebuilt navigation around a left sidebar with its own Browse-by-tag page, and fixed recurring "Back" button / return-to-scan navigation bugs
- Fixed a stale preview-cache bug and a packaged-app startup crash (from `playwright-core`)
- Fixed a docgen bug and vendored `lucide-react` plus a starter set of Radix UI primitives
- **Deferred/not started**: OS-level notifications for updates and PR status, lifecycle/deprecation states, and success-metrics tracking

## Phase 6 — UI Components — **Done**

Goal: a UI-component artifact can be proposed, reviewed with a real live
interactive preview, merged as a normal PR, and pulled into a different
project where it renders live — with drift detection flagging future updates.

- A live, sandboxed-iframe preview compiler for React/TSX and plain HTML/CSS/JS components
- Storybook-style variant tabs and a generated props-controls panel, with no hand-written schema
- Scan detects genuinely reusable components in a project and proposes them, with import-safety checks and auto-scaffolded previews
- PR preview images, automatic version bumps on edit, and a safe fallback for private repos
- Full loop proven for real against a live remote: propose → merge → pull → renders correctly (including hover state) in a different project, drift detection catching a later update
- Fixed a dark-mode contrast bug and several preview-sizing/scrollbar edge cases found via real screenshots along the way

## Tier 0 hardening — **In progress**

A cross-cutting priority list, tracked ahead of new artifact kinds: fix
what's already broken and prove someone outside the build team actually
benefits, rather than build more on an unproven foundation.

- Fixed a real lockfile race between background auto-sync and a concurrent manual pull/push
- Closed the "go check GitHub by hand" gap — PR merge/close status is now polled on the same auto-sync tick that already checks for version drift
- Shipped the security/provenance model (see Phase 7 below)
- **Still open**: get one real engineer outside the build team to actually adopt it; track real usage numbers (deliberately deferred until there's an adopter to design the tracking around)

## Phase 7 — Backend plug-and-play artifacts — **Complete**

Goal: prove `kind: backend-plugin` the way UI components were proven in
Phase 6 — using one real artifact (email/password login for Next.js).

- Manifest schema extended with install-time parameters (secrets/config values the puller provides — never the original author's own values)
- A real signing/verification pipeline: keyless Sigstore signing in CI, verified before any files are written on pull
- Detail/Pull UX: rendered README, a required-config form, and a signed/provenance badge
- A deterministic "wiring agent": auto-fills the safe placeholders and *suggests* — never silently applies — the handful of edits a project needs to actually wire the module in
- Proven end to end on a real NextAuth + Prisma login module, pulled into a genuinely fresh Next.js project, through a real `next build`
- Found and fixed three real bugs this way: a wrong wiring snippet, a path-convention mismatch, and a Windows line-ending bug that would have silently broken signature verification for any Windows user
- **AI wiring merge**: closed a real, previously-unaddressed gap where a Tier-2 wiring action's target file already existing was a dead end ("review it yourself," nothing else, even with a static merge-guidance snippet). A new "Merge with Claude" button in Detail's wiring section proposes a real merged version of the existing file, applies it, and re-runs the project's real build to verify — auto-rolling back if it doesn't actually keep the project building. Same ask→apply→verify→rollback shape already proven for build-fix and design-fix. Dogfooded for real against the actual `nextauth-credentials` artifact: an honest refusal on a genuine library conflict (never guessed), a real rollback when a proposed merge broke the build for an unrelated environment reason, and a clean merge + passing rebuild for a genuinely additive case.

## Phase 8 — Claude Code integration: check-first — **Complete**

Goal: Claude Code checks the catalog before writing new code, pulls a real
match, wires it in, and verifies the target project still builds.

- `deliveryos-check-first`, a real installed Claude Code Skill: checks the catalog before generating a plausible reusable building block, pulls a genuine match, surfaces remaining wiring, and offers to propose back anything new
- Wiring actions exposed via a standalone `deliveryos wiring` CLI command
- A real, undirected dogfood run found a real bug: 4 of the catalog's 6 UI components were non-portable outside DeliveryOS's own preview sandbox (they destructured React hooks from a runtime global instead of a normal `import`), crashing immediately in any real consuming project. Root-caused to the preview compiler itself and fixed.

## Phase 9 — Claude Code as the status/health interface — **Complete**

Goal: asking "what's the status" gives one consolidated answer instead of
running several commands and cross-checking docs by hand.

- `deliveryos-status`, a companion Skill: runs typecheck/lint/test and reports pass/fail in one answer
- Also greps PLAN.md/CHANGELOG.md for every PR link, checks each against live GitHub state, and flags any doc text that's gone stale (e.g. still says "open" for something already merged)
- A real run against this repo found and fixed several genuine cases of exactly that drift

## Phase 10 — Claude Code wired directly into the app UI — **Complete**

Goal: clicking **Pull** on a backend-plugin artifact automatically wires it
in and verifies the build; Add New auto-fills its own fields from the code.

- Deterministic apply-and-test on Pull: safe wiring actions are auto-applied (only ever a genuinely new file — anything that already exists is left alone), and the project's real build runs automatically, reported in the existing progress log
- "Want help fixing this?" — on a build failure, an AI subprocess with no tool access and strict JSON in/out proposes a fix; a person reviews and applies it, a real rebuild confirms it worked, and it auto-rolls back if it didn't
- Add New auto-fills `install_params`, `stacks`, `description`, and `owner` from real code analysis (env vars, imports, JSDoc/frontmatter, local git identity) — always a real mechanical fact, never a fabricated guess, left blank when there's no real signal
- "Suggest with Claude" — an explicit, opt-in button for the two fields static analysis honestly can't fill (description, component type)
- Found and fixed a real Windows command-injection risk and confirmed Claude Code's own tool-restriction flags aren't reliably enforced, redesigning the whole feature so nothing depends on them holding

## Phase 11 — A design-kit bundle, plus a design-quality check — **Done**

Goal: a real design-kit bundle can be pulled into a project, and after
Claude Code builds UI from it, a design-quality check catches real
anti-patterns before they land.

- A real design-kit shipped as one `kind: template` bundle: 8 components (Button, Card, TopBar, Feedback, Input, EmptyState, ErrorState, Skeleton) plus a `GUIDELINES.md` covering color/type/spacing tokens, layout, motion, voice/tone, and a concrete anti-patterns list
- A mechanical anti-pattern detector (e.g. a component nested inside itself) plus an AI-judgment check for the subjective cases, both routed through the existing Review flow with a human confirming before any fix lands
- A real Detail view for the kit: live color/type tokens, a live component grid, per-component usage rules, and a light/dark theme toggle
- Catalog growth from a real GrowthArc project template: a new backend-plugin (`azure-msal-sso`, Azure AD/Entra SSO), four more design-kit components, a lint/tooling starter template, and eventually the whole cleaned-up project as one pullable template (`growtharc-react-vite-starter`)
- Detail view gained: a route/page map for whole-app templates, a dedicated per-component view (variant tabs + live props controls), real markdown rendering (replacing raw literal text) split into Preview/Documentation/Design/Components/Routes tabs, and a way to pull a single component's files without pulling the whole bundle
- A new `starter-kit-extractor` skill (alongside the existing UI-component one) plus a Scan detector that recognizes whole buildable projects as template candidates
- Several real bugs found via hands-on use and review passes, each fixed: a markdown XSS gap (unsafe `javascript:` link/image URLs), a "Back to Browse" infinite loop after visiting a component's detail view, a handful of tab-state/stale-data races, and Detail's Type Scale section rendering blank for any design kit whose `GUIDELINES.md` names its table columns differently than the original `design-kit` (found via `kortix-design-kit`)
- Source-drift detection: a `SOURCES.json` recorded at extraction time (hashing each real source file) lets `deliveryos check-drift` and a new Detail tab later report whether the real external project an artifact was ported from has since changed — `unchanged`/`drifted`/`source-missing` per file, verified against the real `kortix-design-kit` artifact and Suna's actual source on disk
- **Full end-to-end test, done for real**: pulled the real `design-kit` bundle (now 10 real components) into a fresh scratch project via the real CLI, confirmed every component compiles/live-previews clean via `compileLocalPreview`, then planted a genuine self-nesting anti-pattern in a new component simulating "Claude Code built UI from the kit." A real `deliveryos scan` run correctly flagged it with the exact mechanical warning; the real fix flow (`requestAntiPatternFix` → a real Claude subprocess, then `applyAntiPatternFix`) proposed and applied a real fix, verified it via a real recompile, and a follow-up check confirmed the fixed file no longer trips the detector — genuinely resolved, not just papered over. Audit log entry confirmed on disk.

## Phase 12 — Backend plug-and-play, unlocked further — **Both scoped-in items done**

Goal: reuse the exact trust shape already proven in Phase 7/10 (no tool
access on the propose step, a human confirms, a real rebuild verifies,
auto-rollback if it doesn't hold) at more points in a backend-plugin install
— so the feature gets genuinely more useful to a non-builder, not more
complicated.

Reviewed against this project's own established discipline (only build
what's proven needed; don't design for a hypothetical) before committing
to anything — most of the original 6-item brainstorm didn't hold up (see
"Deferred/descoped" below for the rest and why).

- **A visible audit trail — done.** Each `wiring-merge-log.jsonl` entry is
  now tagged with the artifact that caused it (`remoteName`/`artifactId`,
  fixed before it ever shipped — PR #23 was still open), so a project with
  more than one pulled backend-plugin artifact doesn't mix their entries
  together. New "Activity" Detail tab (gated on real matching entries
  existing) shows what was proposed, applied, or rolled back, with
  before/after content behind a `<details>` disclosure.
- **Post-install health narrator — done.** New, deliberately deterministic
  (no AI call — every input is already a known fact, not a judgment call)
  `buildPostInstallHealthSummary` turns wiring applied/needsReview, the
  build result, and any still-missing `install_params` into one coherent
  plain-language summary — closing a real, confirmed gap where the old
  toast silently never mentioned missing install params at all. Shown both
  as the Pull toast and as a persistent Detail banner (the toast fades;
  the banner doesn't), computed once server-side so both agree.

**Deferred/descoped (see the earlier scoping note in this file's history
for the full reasoning):** pre-flight compatibility check (needs a second
real conflicting backend-plugin artifact to design against first);
plain-English change plan (overlaps with what Detail's wiring cards already
show); talk-to-install (no shown pain point); multi-plugin orchestration
(no dependency/data-flow concept exists yet, echoes the "wrong source
material" mistake Phase 11 already corrected once).

**Deferred, not descoped — needs something to exist first:**

- **Pre-flight compatibility check**: before Pull, read the target project
  and flag a real, concrete conflict (e.g. an existing ORM the plugin
  assumes isn't there). Genuinely valuable, but "the plugin's own
  assumptions" isn't a concept the manifest schema has today, and there's
  only one real backend-plugin artifact with a stack assumption at all
  (`nextauth-credentials`, NextAuth+Prisma) — nothing real to genuinely
  conflict against yet. Revisit once a second real backend-plugin artifact
  with a different stack assumption exists to design and test this
  against for real, not synthetically.
- **Plain-English change plan**: a stakeholder-readable summary shown
  before Apply. Lower priority, not wrong — Detail's wiring cards already
  show `targetFile`/`description`/`instructions`/exists-or-not per action
  structurally; a prose wrapper on top is more an audience/style choice
  than a functional gap. Worth doing after the two items above, not before.

**Not pursuing for now:**

- **Talk to install** (a natural-language front end for `install_params`):
  no evidence the existing form is actually painful, and natural language
  can't manufacture a real secret or DB connection string from a
  description anyway — the person still has to supply or generate the
  real value either way. A solution without a shown problem.
- **Multi-plugin orchestration** (sequence multiple plugins, thread real
  values between them): the most premature item by far. No dependency/
  data-flow concept exists anywhere in the manifest schema, and only two
  real backend-plugin artifacts exist total (`nextauth-credentials`,
  `azure-msal-sso`), neither designed to compose with the other. Building
  this now means inventing a whole new architecture speculatively, with
  nothing real to validate it against — the same "wrong source material"
  mistake Phase 11's own scoping note already caught and corrected once.

**Sequencing note, stated directly, not assumed:** Tier 0's own still-open
item — get one real engineer outside the build team to actually adopt
DeliveryOS — arguably outranks all of Phase 12. Building more
backend-plugin surface before anyone outside the build team has used what
already exists risks the exact thing Tier 0 exists to guard against:
building more on an unproven foundation.

## Phase 13 — Backend plug-and-play: basic hygiene — **In progress (3 of 5 items done)**

Goal: close the bare-minimum operational gaps a real code audit found in
the `backend-plugin` install path — none of these need AI, they're plain
engineering that a real install feature normally has and this one
currently doesn't.

Same loop as Phase 12: **plan it, code it, review it, test it for real,
iterate**, one item at a time, no abstraction beyond what each item
actually needs. Ranked by risk, not by build order.

- **Uninstall (highest priority) — done.** `LockEntry` gained two additive
  fields (`src/engine/lockfile/types.ts`): `installTarget` (the real
  resolved path a pull actually copied a payload to, recorded by
  `pullArtifact` itself) and `wiredFiles` (which files
  `applyDeterministicWiring` created FRESH for an artifact — recorded by
  `pullAndAutoWire` via a second, separate `upsertEntry` call right after
  its own wiring step runs, only when it created at least one file). New
  `removeEntry` (`src/engine/lockfile/lockfile.ts`) mirrors `upsertEntry`'s
  own real inter-process lock. New `removeArtifact`
  (`src/engine/pull/removeArtifact.ts`) does the actual uninstall: deletes
  `installTarget` (falling back to resolving it via the manifest for an
  old-shape entry with no recorded path), deletes every real `wiredFiles`
  entry (re-validated for containment via `resolveContainedTargetFile`,
  never trusted blindly even though it's DeliveryOS's own prior write),
  deletes the pristine snapshot, and drops the lockfile entry last. Never
  touches `.env.local` or a file that merely existed before the pull (or
  went through the AI wiring-merge flow) — both are only ever reported
  (`envParamsStillSet`/`filesNeedingManualReview`) so a person knows to
  look, never auto-deleted. Wired up as `deliveryos remove <id>`
  (`src/cli/commands/remove.ts`), the `artifact.remove` sidecar command,
  and a confirm-gated Remove button in Detail (visible under the same
  "already pulled" gate as Open folder/Edit).
- **Secrets safety net (highest priority) — done.** New
  `checkEnvLocalGitignoreCoverage` (`src/engine/pull/installParams.ts`,
  same `ignore`-package pattern as `push/diff.ts`'s `loadIgnoreFilter`)
  warns clearly whenever a pull/configure actually writes a real secret
  into `.env.local` and that file isn't covered by the project's own
  `.gitignore` — whether because none exists at all, or one exists but
  doesn't happen to include it. Never auto-edits `.gitignore` — warns,
  doesn't silently fix. Only checked when something was actually written
  that call (mirrors `upsertEnvFile`'s own no-op-on-empty gate), so the
  overwhelming majority of artifacts with no `install_params` never
  trigger a pointless check. Surfaced as its own distinct toast — never
  folded into the calm post-install health summary — everywhere a real
  pull/configure can write a secret: plain pull, `pullAndAutoWire`, the
  Configuration tab's apply button, and bulk pull (aggregated once, since
  every artifact in one run shares the same `.gitignore`).
- **A real update-apply path.** `checkForUpdates`
  (`src/engine/sync/sync.ts`) only prints `installed → available`; nothing
  re-pulls or re-runs `wiring_actions` for any artifact kind today. For
  backend-plugin specifically this is where a real security fix would
  need to land. Needs: an actual "pull the new version and re-wire without
  clobbering local edits" flow — reusing the existing wiring-merge shape
  for any file a local edit touched.
- **Timeouts on build/install commands — done.** Both the build check
  (`execAsync` in `src/engine/pull/verifyBuild.ts`, `BUILD_VERIFY_TIMEOUT_MS`
  = 5min) and the post-install command (`execSync` in
  `src/engine/pull/pull.ts`, `POST_INSTALL_TIMEOUT_MS` = 10min) now carry a
  real timeout instead of hanging indefinitely. Both also now tell "the
  tool to run this isn't on PATH at all" apart from "it ran and hit a real
  problem" apart from "it timed out" — confirmed empirically (not assumed
  from docs) that on Windows `exec`/`execSync` route through cmd.exe, so a
  missing tool never throws a Node-level ENOENT; it's the shell itself
  reporting an ordinary-looking non-zero exit with "is not recognized as an
  internal or external command" (POSIX shells: exit 127 / "command not
  found", included for parity though not directly exercised here).
  `BuildVerificationResult` gained additive `timedOut`/`toolNotFound`
  fields; `PostInstallError`'s message text gained distinct prefixes for
  the same two cases (nothing currently branches on `PostInstallError`'s
  message programmatically, so text distinction was sufficient — no new
  error type). One real, confirmed limitation found along the way and
  deliberately not fixed here (bigger than this item's scope): on Windows,
  killing a timed-out command only terminates the immediate shell wrapper,
  not the actual grandchild process it spawned — a "timed out" build/
  install can keep running in the background after being reported as
  timed out.
- **Post-pull secret rotation.** The engine-level `applyInstallParams` RPC
  already exists (`src/sidecar.ts`) but nothing calls it except the
  sidecar itself — no CLI command wraps it, and `cli/commands/pull.ts`
  tells users to "edit `.env.local` directly" instead. It also never
  re-runs wiring, so a rotated value only reaches code that reads
  `process.env` at runtime. Needs: a real `deliveryos config` (or similar)
  command that goes through the same path the UI already has.

---

## What's next

- **Phase 13** (backend plug-and-play: basic hygiene) — in progress, 3 of 5 items done (uninstall, secrets safety net, timeouts), see above
- **Phase 12** — both scoped-in items done; the rest deferred/descoped, see above
- **Phase 4** (team rollout: auth/SSO, profiles, multi-remote) — deferred until GrowthArc has real identity infrastructure
- **Phase 3's installer** — a signed, packaged installer per OS is not started; not needed yet at this stage
- **Phase 3's fresh-machine install test** — deferred, needs a genuinely uninvolved person on a clean machine
- **Phase 5's** OS-level notifications, lifecycle/deprecation states, and success-metrics tracking — not started
- **Tier 0's** "prove adoption with a real outside engineer" and real usage-number tracking — still open

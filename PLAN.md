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

## Phase 13 — Backend plug-and-play: basic hygiene — **In progress (5 of 6 items done)**

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
- **Post-pull secret rotation — done.** New `deliveryos config <id>
  [--remote <name>] --set KEY=VALUE` (`src/cli/commands/config.ts`) wraps
  the exact same real sequence the sidecar's own `artifact.applyInstallParams`
  RPC already used (`resolveArtifact` -> `resolveInstallParamValues` against
  `readExistingEnvValues` -> `applyInstallParams`), so a CLI-only user no
  longer has to "edit `.env.local` directly" as `pull.ts` used to tell them.
  Reports the same `missingRequiredParams`/`gitignoreWarning` output
  `pull.ts` already does, plus its own honest, undecorated note that it does
  NOT re-run `wiring_actions` — a rotated value only reaches code that reads
  `process.env` at runtime, since that's still the separate, bigger,
  deliberately-deferred "real update-apply path" item below.
- **Configuration-form autofill/suggestions.** The Detail Configuration
  tab's `install_params` form (rendered around `app.js`'s existing
  `install_params` loop, ~line 1265/1837) is still a blank input per field
  today — none of Phase 10 item 3's autofill discipline has been applied
  to this, the *puller's* form (only the *author's* Add New form got it).
  Found via a real example (`azure-msal-sso`'s 3 required
  `VITE_APP_MSAL_*` fields) that these split into three real cases, not
  one — reviewed and re-scoped (not treated as one unit, given how
  differently sized/risky the three actually are):
  - **Reuse an already-existing value — done.** Confirmed a real, concrete
    bug: `renderInstallParamsSection` only ever pre-filled from
    `param.default` (the manifest author's own hardcoded value), never
    from a real value already sitting in `.env.local` from an earlier
    partial fill or prior pull — `readExistingEnvValues(cwd)` already
    existed and already powered this exact "don't re-ask for an
    already-configured value" guarantee at *apply* time
    (`resolveInstallParamValues`'s own doc comment), but the *form's own
    display* never read it back. Reopening Configuration after filling in
    2 of 3 required fields showed all 3 blank again, even though 2 were
    already saved for real. Fixed with a new, deliberately minimal
    read-only sidecar RPC, `artifact.readInstallParamValues`
    (`src/sidecar.ts`) — resolves the same manifest `artifact.
    applyInstallParams` already does, then filters `readExistingEnvValues`
    down to only the keys THIS artifact's own `install_params` declare
    (never leaking another artifact's config into this form). No new
    engine-layer function: the filter is small and obvious enough to stay
    inline, so it's covered by a real sidecar e2e test instead
    (`test/e2e/sidecar.e2e.test.ts`) rather than a separate unit. Wired
    into `renderInstallParamsSection` (`app.js`, now async, with its own
    `installParamsRequestId` request-token guard matching the wiring/
    drift/activity sections' established discipline): a real existing
    value now wins over `param.default` when pre-filling `input.value`,
    same `provided > existing > default` precedence
    `resolveInstallParamValues` already established. Degrades to today's
    default-only prefill if the RPC call fails for any reason — never
    blocks the Configuration tab from rendering.
  - **A genuine local signal** (e.g. `VITE_APP_MSAL_REDIRECT_URI` from the
    target project's own `vite.config` dev-server port) — deliberately
    deferred, not descoped. This needs real per-framework/per-key-shape
    detection (Vite's port, Next's port, whatever convention the next real
    example uses) that risks becoming an ever-growing pile of special
    cases rather than one bounded feature — same "wait for a second real
    example before generalizing" caution already applied to Phase 12's
    deferred pre-flight-check and Phase 13's still-open update-path item.
    Revisit once a second real backend-plugin artifact needs this kind of
    signal.
  - **Neither** (e.g. an Azure AD app registration's Client ID — lives
    entirely outside the project, nothing to scan) — no new code needed.
    `param.description` already exists and already CAN carry a "where to
    find this" hint; `azure-msal-sso`'s own real descriptions today just
    don't use it that way. An authoring-quality question for whoever
    writes a manifest, not an engine gap.

---

## Phase 14 — Dark mode — **Done**

Goal: a real dark mode for the desktop app's own chrome, toggled from the
context strip, not just a naive color inversion.

- **Token audit before touching anything.** `style.css` had exactly one
  `:root` block and zero existing `data-theme`/`prefers-color-scheme`
  infrastructure. `--primary-700/800/900` (navy) turned out to be doing
  double duty: 28 of its 33 usages were plain body/UI text color, the
  other 5 were solid-fill button/chip backgrounds (`.btn-primary`,
  `.chip.active`) paired with white text on top. Migrating all 33 blindly
  would have made primary buttons render light-on-light in dark mode; the
  fill-role 5 needed to stay a fixed brand color across both themes.
- **New `--ink` token**, equal to `--primary-700`'s value in light mode
  (so introducing it changed nothing visually), replaces all 28 text-role
  usages. `--primary-700/800/900` themselves are left untouched in both
  themes, now serving only their fill role. Two other dangling tokens the
  CSS already referenced but never defined (`--text-secondary`, and a
  second, unrelated `--ink` fallback inside the pre-existing
  whole-app-template light/dark preview feature) got real values too.
- **Pale accent tints get real dark equivalents, not a blanket fixed
  look**: `sage-100`, `sand-100/200`, `sky-100`, `success/warning/danger-100`
  each got a darkened panel color for dark mode, with
  `success/warning/danger-600` lightened to match (both are exclusively
  used as a text/bg pair, confirmed via a full-file grep before touching
  either). Saturated standalone accents (`gold-500`, `danger-500`,
  `accent-500/600`, `cyan-500/600`, `mint-500`, `sage-500/700`, gradients)
  are left constant — already vivid enough to read on a dark surface, and
  the point of a fixed palette there is brand identity, not adaptation.
- Defined via `@media (prefers-color-scheme: dark)` for the no-explicit-
  choice default, plus `:root[data-theme="dark"]`/`:root[data-theme="light"]`
  overrides that win either direction once the user has toggled explicitly.
- **Toggle**: new `theme-toggle-btn` in the context strip (next to "Change
  folder"), new `i-theme-sun`/`i-theme-moon` icon symbols following the
  existing sprite-sheet convention (sun shown while dark — click to go
  back to light — and vice versa). `app.js`'s `toggleTheme`/`initTheme`
  set/read the `data-theme` attribute and persist the choice to
  `localStorage` (`deliveryos.theme`, same convention as the existing
  `deliveryos.projectDir` key); a live `prefers-color-scheme` listener
  keeps the icon in sync with OS changes for as long as no explicit choice
  has been made yet. A small inline `<script>` in `index.html`'s `<head>`
  applies any saved choice synchronously, before first paint, so there's
  no flash of the wrong theme while `app.js` (loaded at the end of body)
  is still parsing.
- No test-suite coverage exists for `spike-ui/`'s vanilla JS/CSS/HTML
  (confirmed: `eslint.config.js` only targets `**/*.ts`, and no test file
  references these files) — verified instead via `node --check` on
  `app.js` (parses cleanly), a brace-balance check on `style.css` (298
  open/close), and an svg-tag-balance check on `index.html` (9/9), plus a
  full manual line-by-line audit of every `--primary-700/800` usage before
  migrating it.

## Phase 15 — Full-codebase audit and fix pass — **Done**

Goal: a real, thorough bug/gap/improvement audit across the entire
codebase (backend engine, CLI, sidecar, frontend), not scoped to one
feature area -- 6 parallel research agents each covering a distinct slice
(core artifact lifecycle, remote/sync/push/git, scan/catalog/preview,
CLI+sidecar, frontend, tests+docs), followed by personal verification of
every finding against the actual code (not trusted at face value) and a
fix pass through everything confirmed real.

- **Security (path traversal / arbitrary file ops) — fixed, 5 confirmed
  instances of the same bug class.** `manifest.install_target`/
  `payload_path` are untrusted (an artifact author's own manifest, not
  something DeliveryOS controls) but were resolved with plain
  `path.join`/`path.resolve` and no containment check in FOUR places:
  `pull.ts` (both fields), `push.ts` (`payload_path`), and
  `payloadDir.ts`'s `resolvePayloadDir` (`payload_path`) -- a crafted
  manifest could write/read/delete outside the intended remote-cache or
  project directory the moment anyone pulled or pushed it. New shared
  `resolveContainedPath(root, candidate)` (`src/engine/paths.ts`,
  generalizing `wiring.ts`'s existing `resolveContainedTargetFile`) closes
  all four. `removeArtifact.ts`'s `installTarget` deletion had the same
  gap -- re-validated now, matching the "defense in depth" treatment its
  own `wiredFiles` deletion already had, failing loud (not silently
  no-op'ing) since this is the PRIMARY thing being removed. `remoteCachePath`
  (`paths.ts`) never sanitized `name` (unlike its sibling
  `previewCachePath` two lines below it) -- `remote add --name ../../../X`
  could clone outside the cache root; now uses the same
  `assertSafePathSegment` guard. `pullPayloadComponent.ts`'s
  `EXCLUDED_FILENAMES` check was case-sensitive (unlike its sibling
  exclusion sets), letting `Preview.tsx` leak into pulled projects.
- **Data-loss/correctness bugs — fixed.** `fixBuildFailure.ts`/
  `requestWiringMerge.ts` silently truncated a target file to 8000 chars
  before asking the model for "the full corrected/merged file," then
  blindly wrote the response back as the file's entire new content -- for
  any file over the cap, the model never saw (and so couldn't reproduce)
  content past the truncation point, and the rebuild-verify safety net
  doesn't reliably catch a truncated result that still happens to compile.
  Both now refuse outright (a clear reason, no subprocess call) for an
  oversized file rather than risk silent deletion. `bumpVersion` had no
  `default` case in its switch -- an invalid runtime value (reachable via
  the sidecar's `artifact.push`, which cast `options.bump` without
  validating it, unlike the CLI's own `parseBumpKind`) silently returned
  `undefined`, surfacing many calls later as an unrelated "version:
  Required" error; now throws immediately, and `parseBumpKind` moved to
  `version.ts` as a shared export both the CLI and sidecar call.
  `branchName.ts`'s `slugifyForRef` produced an invalid double-slash git
  ref for an id that strips to nothing (e.g. `"???"`) -- now falls back to
  a short hash of the original id. `sync.ts`'s `resolvePendingPushes`
  merged-PR branch wrote a bare `{id, version, remote}` instead of
  spreading the existing entry, silently dropping `installTarget`/
  `wiredFiles` the moment a pushed edit's PR got merged (the closed-PR
  branch 3 lines below already spread correctly). `lockfile.ts`'s
  `readLockfile` had an unguarded `JSON.parse` -- a corrupted `lock.json`
  crashed every lockfile-touching command with a raw `SyntaxError`; now
  throws a new, clear `LockfileCorruptError`. `pull.ts` never checked the
  payload source existed before `fs.cpSync`, nor validated `payload_path`
  containment -- both fixed alongside the security fix above.
  `runClaudeSubprocess.ts` had no `maxBuffer` set (silently defaulting to
  Node's 1MB cap, killing a large real response with a raw buffer-overflow
  error) -- now 10MB. Its Windows zombie-process-on-timeout gap (killing a
  timed-out call only terminates the immediate shell wrapper, not the real
  `claude` process underneath) is the exact same class already found,
  confirmed, and deliberately left as a documented known limitation for
  `verifyBuild.ts`/`pull.ts`'s own timeouts earlier this project --
  documented the same way here for consistency, not fixed differently.
- **Frontend (spike-ui) bugs — fixed.** `wiringMergeRequestId`/
  `buildFixRequestId` were shared MODULE-LEVEL request-token counters used
  to guard every "Merge with Claude"/"Want help fixing this?" row on the
  page at once -- clicking Ask on one row while a DIFFERENT row's request
  was still in flight silently discarded that other row's result the
  moment it resolved, even though the two rows target unrelated files. Now
  scoped to each row's own closure, still guarding the originally-intended
  case (a row's own second click superseding its first request) without
  the cross-row collision; `renderDesignFixRow` gained the same guard it
  was missing despite its own doc comment claiming to mirror
  `renderBuildFixRow`. The Add New form's Enter-key handler hijacked Enter
  on any focused `<button>` inside the form (only excluded tag-picker
  inputs/textareas) into "go to next step," making Back/Review/"Choose
  file…"/"+ Add param"/"Suggest with Claude" all unreachable via keyboard
  -- now excludes `BUTTON` too. `--font-mono` was referenced by 5 CSS rules
  but never defined in `:root`, silently falling back to the generic
  monospace font; now a real token. `skill`/`command`/`java`/`typescript`/
  `go`/teams icon swatches paired a fixed hardcoded hex fg color with a bg
  token (`sand-100`/`sky-100`) that DOES get a real dark-mode tint,
  dropping to ~2.2-2.5:1 contrast in dark mode -- new adaptive
  `--icon-fg-warm`/`--icon-fg-cool` tokens fix the pairing (same root
  cause found independently for `doc`/the tag-icon fallback, which used
  `--primary-700`, the deliberately-fixed brand token, instead of `--ink`).
  The Documentation tab's markdown iframe had a hardcoded light-only
  `<style>` with no background set at all -- a stark white rectangle
  inside an otherwise dark Detail card; now themed at render time.
  `loadUiComponentPreview` had no check for the row having been detached
  from the DOM (a category-tab switch re-renders the whole list) before a
  stale compile resolved -- would still spawn a live iframe and register a
  real window-level listener for a row nothing shows anymore; now checks
  `row.isConnected` first. `beginProgress`'s `listen()` call could
  previously throw before any caller's own try block (every one of the 7
  call sites awaits `beginProgress()` BEFORE its try, deliberately, to
  close a progress-subscription race), leaving the panel stuck on
  "Working…" forever with no `endProgress(false)` ever reached -- now
  caught internally, degrading to "no live progress lines this action" but
  never leaking out of `beginProgress` itself. Also: dead `.detail-card`
  CSS class removed from `index.html` (zero matching rule anywhere),
  `aria-live="polite"` added to the toast stack, `aria-label` added to 3
  search inputs missing one.
- **Concurrency — one real gap fixed, one deliberately deferred.**
  `remoteRegistry.ts`'s `addRemoteEntry`/`removeRemoteEntry` were an
  unlocked read-modify-write (same race class `lockfile.ts`'s own
  `upsertEntry` was already fixed for) -- now wrapped in the same
  `proper-lockfile` pattern, both now `async`. The sidecar's `handleLine`
  loop fires each command without awaiting the previous one, and `push`/
  `sync.checkForUpdates`/`sync.resolvePendingPushes` all mutate the same
  on-disk git clone (`cachePath(remoteName)`) with zero locking --
  confirmed real, but a correct fix means wrapping `pushArtifact`'s entire
  ~340-line git-mutating span (from `fetchAndReset` through the final
  `pushBranch`, spanning several early-return branches for edit/propose-
  new/metadataEdit modes) in a lock with a `finally`-guaranteed release --
  deliberately NOT attempted here: a rushed lock that leaks on one exit
  path in a large, safety-critical function would be worse than the
  current narrow race (two people/processes pushing/syncing the SAME
  remote at literally the same moment). Left as a documented, real,
  deliberately-deferred item.
- **CLI/sidecar parity gaps — fixed.** `deliveryos remote list` and
  `deliveryos check-pending-pushes` didn't exist at all (the sidecar's own
  `remote.list`/`sync.resolvePendingPushes` RPCs always had this) -- both
  added. `deliveryos list` never computed `localStatus` (pulled/edited/
  not-pulled), unlike the app's own Browse view over the exact same
  catalog data -- the sidecar's private `annotateCatalog` function was
  extracted to `src/engine/catalog/catalog.ts` (a real, shared engine
  function now, not sidecar-only) and wired into the CLI's `list` command
  too. The sidecar's `artifact.push` handler cast `options.bump` without
  validating it (unlike the CLI's own `parseBumpKind`) -- now validates via
  the same shared function. The sidecar's `artifact.applyInstallParams`
  never returned the CLI's own "this does not re-run wiring_actions"
  caveat -- now does, surfaced as part of the app's success toast.
  `collectSetFlag`'s duplication between `pull.ts`/`config.ts` was
  reviewed and found to be an ALREADY-deliberate, already-documented
  decision (`config.ts`'s own comment explains why) -- left as-is rather
  than re-litigated.
- **Documentation — corrected in place, not rewritten wholesale.**
  `ARCHITECTURE.md` was stuck describing "Phase 0... built" with a
  6-phase roadmap table (0-5) and a kind table calling `template` "not yet
  managed" -- corrected with clear notes pointing at PLAN.md as the
  current source of truth, rather than attempting to rewrite its entire
  original 5-layer design-proposal narrative (itself never fully built as
  written -- profiles/role-routing, `dataset`/`snippet`/`config`/
  `reference` kinds, "ArcOS as a remote" -- left as historical context,
  clearly labeled). `DESIGN_SYSTEM.md`'s Navigation section described a
  fictional `Home`/`Studio`/`Monitor`/`Library`/`Admin` route structure
  with client-side redirects; its "AI Components"/"Animations" tables
  named components (`GlowCard`, `AIBadge`, `PulseIndicator`, `AISparkle`,
  `StreamingText`, `ArcAIPromptBox`) and animations (`pulse-glow`,
  `gradient-shift`, `shimmer-border`, `breathing`, `neural-pulse`) with
  zero matches anywhere in the real app -- all corrected to describe what
  actually ships (the real sidebar, the real "Suggest/Merge/Want help
  fixing" ✨ buttons, `.hint-banner-ai`). Also fixed: a `gradient` button
  variant that `style.css` itself already says has no counterpart, and an
  Accessibility-section reference to `primary-500`, a token that doesn't
  exist. Phase 14's dark-mode tokens (`--ink`, `--text-secondary`,
  `--icon-fg-warm/cool`, `--font-mono`, the full dark palette) documented
  for the first time. `README.md`'s CLI section was missing
  `check-updates`, `check-drift`, `scan`, `wiring`, `remote list`,
  `remote remove`, `check-pending-pushes`, `pull --set`, and edit-mode
  metadata-only push -- all added.
- **Test coverage — added for every fix above, plus 4 previously-untested
  files.** New `test/unit/paths.test.ts` (the new `resolveContainedPath`
  helper + `remoteCachePath` sanitization), `remoteRegistry.test.ts`
  (previously zero coverage, including a real concurrent-add race test),
  `runClaudeSubprocess.test.ts` (previously zero coverage; the codebase's
  only `child_process` mock, since a real `claude` invocation isn't
  hermetic), `githubAuth.test.ts` (previously zero coverage; every real
  e2e test explicitly stubs this out, so none of its 3 branches had ever
  actually run anywhere), and `output.test.ts` (previously zero coverage).
  Extended `pull.test.ts`, `payloadDir.test.ts`, `removeArtifact.test.ts`,
  `branchName.test.ts`, `lockfile.test.ts`, `fixBuildFailure.test.ts`,
  `requestWiringMerge.test.ts`, and the `sync.resolvePendingPushes`/
  `pull` e2e suites with regression tests for each fix. Full suite:
  566 tests, only the one pre-existing GitHub-auth-boundary e2e failure
  (real, expected, unrelated to this pass) plus occasional
  resource-contention flakiness on a Playwright preview-render test under
  full parallel load (both confirmed pre-existing, re-verified in
  isolation each time).

## What's next

- **Phase 13** (backend plug-and-play: basic hygiene) — in progress, 5 of 6 items done (uninstall, secrets safety net, timeouts, post-pull secret rotation, config-form reuse-existing-value autofill); real update-apply path not started, and config-form autofill's other two sub-cases (genuine local signal, neither) deliberately deferred/descoped, see above
- **Phase 12** — both scoped-in items done; the rest deferred/descoped, see above
- **Phase 4** (team rollout: auth/SSO, profiles, multi-remote) — deferred until GrowthArc has real identity infrastructure
- **Phase 3's installer** — a signed, packaged installer per OS is not started; not needed yet at this stage
- **Phase 3's fresh-machine install test** — deferred, needs a genuinely uninvolved person on a clean machine
- **Phase 5's** OS-level notifications, lifecycle/deprecation states, and success-metrics tracking — not started
- **Tier 0's** "prove adoption with a real outside engineer" and real usage-number tracking — still open

# DeliveryOS — Organization Resource Sharing Platform

**Status:** draft, unratified. **Name:** DeliveryOS (decided).
**Origin:** grew out of exploring ArcOS's catalog/distribution model; scoped out
as its own project rather than an ArcOS extension.

---

## 1. What this is, in one paragraph

DeliveryOS is an internal platform for sharing reusable "resources" across the whole
organization — AI agent skills, starter-code templates, reference docs,
spreadsheets, or anything else people reuse across projects. Anyone can browse
what's available, pull the latest version onto their machine, and contribute
improvements back — all through a desktop app, with no terminal required. Under
the hood it's git-backed, so every change still goes through normal review.

## 2. In plain terms — a real example

Imagine Priya, starting a new client project. Today she'd message a colleague,
dig through old Slack threads, or copy an old project folder and hope it's not
outdated.

With DeliveryOS: she opens an app on her laptop (like opening Slack — a normal app,
no terminal). Inside is a list of things the company has decided are worth
sharing — starter kits, checklists, useful AI helpers. She finds what she
needs, clicks **Get it**, and it appears on her computer, ready to use.

Weeks later she notices the checklist is missing a step. Instead of fixing her
own copy and letting that fix die on her laptop, she clicks **Suggest this
change**. Whoever owns that checklist reviews and approves it, and now it's
the official version — the next person who clicks "Get it" automatically gets
Priya's improvement, with zero effort on their part.

**One-sentence summary:** it's an internal app store for the company's reusable
stuff — except unlike a normal app store, anyone can also submit an
improvement back, and approved changes automatically become what everyone
else gets next time.

## 3. The problem it solves

Today, reusable stuff (templates, docs, AI configs) lives scattered across
people's machines, Slack messages, and one-off repos. There's no single place
to discover what exists, no easy way to keep a local copy up to date, and no
easy way to contribute an improvement back without knowing git.

### 3.1 Why not just use GitHub directly?

Fair question, since DeliveryOS is built entirely on top of GitHub. Worth being
precise about what it actually adds.

**What stays exactly GitHub, unchanged:** storage, version history, PRs,
code review, merging. DeliveryOS doesn't reinvent any of this (§6's storage
decision is explicit about that) — every Push is a literal GitHub PR.

**What DeliveryOS adds on top:**

| Problem | GitHub alone | DeliveryOS |
|---|---|---|
| Non-technical people (HR, sales, exec) using it | Assumes you know what a repo, clone, branch, and PR are | Click "Get it" / "Suggest a change" — no git vocabulary needed |
| Resources spread across many repos | You need to already know which repo to go look in | One Browse screen aggregates every registered remote in one place |
| "Is this relevant to me" | No concept of role — everyone sees the same repo | Profiles + tags filter automatically (a PM never sees Java agents) |
| Getting something *working*, not just downloaded | `git clone` gives you files, nothing else | Pull also runs `post_install` (e.g. `npm install`) and lands files in the right spot — ready to use immediately |
| Knowing if your local copy is stale | Nothing tracks this across repos for you | One lockfile tracks versions across every remote, and Sync flags what's outdated |
| Contributing something brand-new | You need to already know fork/branch/PR mechanics | "Add new" scaffolds the manifest and handles the git mechanics for you |

**The honest one-liner:** GitHub is the plumbing — storage, history, review.
DeliveryOS is the tap — a friendly, cross-repo, role-aware front end for people who
shouldn't have to know GitHub exists underneath. If everyone at GrowthArc
were already comfortable with git, DeliveryOS would mostly be unnecessary. The
entire reason it exists is that most of the intended audience (sales, HR,
PMs) isn't, and shouldn't need to be.

## 4. Full architecture — five layers

```
LAYER 1 — WHAT GETS SHARED (the artifacts)
  agent-asset   (ArcOS skills / agents / commands / rules)
  template      (starter-code repos, e.g. "Pattern 02 kit")
  doc           (reference documents, playbooks)
  dataset       (spreadsheets, csvs, structured data)
  ... open-ended, new kinds can be added later

LAYER 2 — WHERE IT LIVES (storage)
  Shared Remotes — plain git repos, nothing custom-built
    - ArcOS catalog/        (existing, first remote)
    - templates registry
    - docs / sheets registry
    - ... more remotes over time
  Each item in a remote carries a small manifest: name, kind,
  description, owner, version, who it's for (see Layer 4)

LAYER 3 — THE ENGINE (shared logic, one codebase)
  - reads manifests, applies your profile filter
  - keeps a lockfile per machine: what's installed, what version
  - Pull:  fetch matching items from remotes -> install locally
  - Push:  local edit -> branch -> commit -> opens a PR
  (this is the only place actual logic lives — everything
   above and below just calls into it)

LAYER 4 — WHO SEES WHAT (team / org)
  - every artifact is tagged: which roles/teams it's for
    e.g. roles: [sales, pm]   teams: [delivery]
  - a "profile" is a saved filter, one per role
    e.g. profile "sales" = only artifacts tagged role:sales
  - a person sets their profile once; Pull only ever shows
    them what matches — no noise, no irrelevant clutter
  - Review stays with whoever owns the remote (e.g. ArcOS's
    own "core changes need 2 reviewers" rule keeps applying —
    DeliveryOS doesn't override anyone's existing review bar)

LAYER 5 — HOW PEOPLE INTERACT (interfaces)
  Desktop App (Tauri: Rust shell + OS webview UI)
    <- what most people use, no terminal
  CLI (Node)              <- optional, for engineers
  both call the same Engine (TypeScript) — the app reaches it as
  a bundled background sidecar process; the CLI runs it directly.
  Same engine code either way — no duplicate logic.
```

**A full cycle, tying every layer together:**

1. Priya sets her **profile** to "sales" once (Layer 4).
2. She opens the **Desktop App** (Layer 5), which asks the **Engine** (Layer 3)
   to list what's available.
3. The Engine reads manifests from the **Remotes** (Layer 2), filters to only
   what's tagged for her profile, and shows her matching **artifacts**
   (Layer 1).
4. She clicks Pull → Engine downloads it, updates her local lockfile.
5. She edits it, clicks Push → Engine opens a branch + PR against the remote
   that owns it.
6. Whoever owns that remote reviews under their own rules and merges → the
   update lands back in Shared Remotes, ready for the next person's Pull.

### 4.1 Artifact kinds in detail

Layer 1's `kind` list, expanded with what would actually populate each one:

| Kind | Sub-types | Concrete example | Status |
|---|---|---|---|
| **agent-asset** | skill, agent, command, rule | `code-reviewer` agent, `engagement-kickoff` skill, `discovery-kickoff` command, `model-agnostic-core` rule — literally ArcOS's existing catalog, unchanged | Already exists (ArcOS). Payload should target the open `AGENTS.md` standard (see §10.1) rather than a DeliveryOS-proprietary format. |
| **template** | starter-code scaffolds | The `pattern02` engagement starter that `arcos init` already scaffolds; also `repo-skeleton` (README/LICENSE/`.gitignore`/`pyproject.toml` starter) and `eval-harness-skeleton` (pytest `conftest.py` + structure) — both already their own rows in ArcOS's `inventory.yaml`, i.e. already recognized as reusable IP distinct from the catalog | Exists in ArcOS, not yet a DeliveryOS-managed kind |
| **doc** | playbooks, runbooks, checklists, one-pagers | A "Day-1 install runbook," a client-discovery checklist, an onboarding guide | Proposed, not built |
| **dataset** | spreadsheets, csvs, reference tables | A pricing sheet, a rate-card spreadsheet, a standard project-estimate template | Proposed, not built |
| **snippet** | small reusable code fragments (not a full template) | A boilerplate auth-check function, a standard logging setup | Proposed, not built |
| **config** | shared tool/IDE configuration | `ci-skeleton` — ArcOS's own GitHub Actions CI workflow (lint + pytest), also already its own `inventory.yaml` row | Proposed, not built |
| **reference** | curated external GitHub repos/projects | `NousResearch/hermes-agent` — the external repo ArcOS's own `docs/CONVENTIONS.md` already cites as the source of its `plans/`/`.plans/` split pattern | Proposed, not built |

Two things worth being explicit about:

1. **Only `agent-asset` is real today.** Everything else is proposed, not yet
   built. Phase 0–3 (§9, Scope creep risk) should prove the model with just
   1–2 new kinds — recommend **template** and **doc**, since those map
   directly to the original "GitHub starter code / Excel" motivation — before
   adding datasets/snippets/configs.
2. **`kind` stays open-ended by design** (§6 decisions table) — a new kind is
   added by writing a manifest with a new `kind:` value, not by editing a
   locked schema the way ArcOS requires.
3. **`reference` behaves differently from every other kind.** Every other kind
   points at a remote DeliveryOS actually owns, so Push can open a governed PR
   against it. A `reference` points at someone else's external repo — DeliveryOS has
   no authority to open a PR there. So for `reference`:
   - **Pull** still works normally: clone/checkout the external repo, or just
     bookmark it, depending on `install_target`.
   - **Push** only updates DeliveryOS's own manifest/notes about *why the reference
     matters* (e.g. "this is the pattern we borrowed for X") — never the
     external project itself. Contributing back to the external repo is a
     normal, separate open-source PR, outside DeliveryOS entirely.
4. **`agent-asset` uses the same generic Pull/Push as every other kind —
   decided, not deferred.** Claude Code does have a native marketplace
   auto-update mechanism (`forcedPlugins` + `strictKnownMarketplaces`, see
   §10.2), and integrating with it directly was considered. **Decision:**
   skip that integration for now — good to have later, not necessary. It
   would mean maintaining two different Pull code paths and depending on
   enterprise configuration DeliveryOS doesn't control. The generic Engine path
   (copy files, run against manifests) covers `agent-asset` exactly like
   every other kind, with no special case.

## 5. Process flowmaps

Four everyday processes, each drawn out step by step.

### 5.1 Pull flow — "Get it"

```
  Open the App
     |
     v
  Browse / Search
  (only shows items matching your profile)
     |
     v
  Click "Pull"
     |
     v
  Engine checks the manifest + your local lockfile
     |
     v
  Engine fetches the files from the owning Remote
     |
     v
  Files land on your machine, lockfile updated
```

### 5.2 Push flow — "Suggest a change"

```
  Edit a pulled resource locally
     |
     v
  Click "Push"
     |
     v
  Engine creates a branch + commit, opens a Pull Request
     |
     v
  Owner reviews it, under their own rules
     |
     +---> changes requested --> back to "Edit locally"
     |
     +---> approved & merged  --> lands in Shared Remotes
                                  (next Pull picks it up automatically)
```

### 5.3 Who sees what — two filters, not one

ArcOS's own [ADR-0006](../docs/adr/0006-profiles-and-routing.md) uses two
filters together, not just one — worth copying that shape rather than
stopping at profiles alone:

```
  Admin tags each artifact          Admin defines profiles
  (roles, teams)                    (e.g. "sales" = role:sales)
          \                                /
           \                              /
            v                            v
              Every Browse / Pull request
                        |
                        v
          Filter 1 — your PROFILE (who you are)
          Engine keeps only artifacts tagged for your role
                        |
                        v
          Filter 2 — your CURRENT PROJECT (what you're in)
          Engine detects stack signals in the current folder
          (package.json, pyproject.toml, lockfiles, etc.) and
          keeps only artifacts tagged for that stack
                        |
                        v
   You only ever see what's relevant to both who you are
              AND what you're currently working in
```

Without Filter 2, a backend engineer with the full engineering profile would
still see Java/Spring assets while sitting in a Python repo. Filter 2 removes
that noise automatically, with no extra action from the person.

### 5.4 Roadmap flow — build order

```
  Phase 0: Engine MVP (CLI only, one remote)
     |
     v
  Phase 1: Push (PR automation)
     |
     v
  Phase 2: ArcOS registered as a remote (proves the model)
     |
     v
  Phase 3: Tauri app (the real UI ships)
     |
     v
  Phase 4: Team rollout (profiles, multi-remote)
     |
     v
  Phase 5: Polish (drift detection, auto-sync)
```

## 6. Key decisions made so far

| Decision | Choice | Why |
|---|---|---|
| Relationship to ArcOS | Standalone new project, not an ArcOS extension | ArcOS's schemas/governance (closed asset-kind enum, frozen 22-row inventory) are deliberately narrow to AI-agent assets for one team. Extending it would mean fighting its own ADRs. Instead, **ArcOS becomes one of DeliveryOS's sources**. |
| Audience | Whole org, eventually — not just engineers | Must work for non-technical roles (HR, sales, exec, finance), not just developers. |
| Primary interface | Desktop app | A terminal UI was considered and rejected — it still requires terminal comfort most non-engineering roles won't have. A pure web UI was considered next, but writing files to a user's machine from a browser tab isn't possible, so a local companion process would be needed anyway. Since something has to be installed locally either way, the UI and the local engine access are combined into one installable app instead of split into two things (a web page plus a separate background agent). |
| Desktop app framework | Tauri (revised from Electron) | Ease of install across the whole org was named the deciding constraint, and Tauri wins on exactly that: no bundled Chromium, so the installer is single-digit MB instead of 150MB+, installs faster, and uses far less background memory once running — all of which matter more the more machines this rolls out to. The cost is narrow: Tauri's native shell is Rust, so whoever builds/maintains that thin layer needs to know Rust; the UI and engine stay web-tech either way. |
| Engine language | TypeScript / Node, not Python | The desktop app's UI is web-tech, so the shared engine (manifest parsing, remote sync, lockfile, push-as-PR) is written in TypeScript. **One consequence of the Electron → Tauri switch:** Electron's native process is Node, so the engine could run natively in-process; Tauri's native shell is Rust, which can't run TypeScript directly. The engine instead runs as a small bundled background process (a "sidecar") that Tauri's Rust shell launches and communicates with — same engine code, same CLI, just one extra moving part instead of a fully in-process call. **Note this is not the same argument ArcOS considered and rejected in [ADR-0004](../docs/adr/0004-tooling-language-and-tri-target-build.md).** ArcOS rejected TypeScript because "we publish to Claude Code, we don't modify it" — Claude Code being TypeScript was irrelevant to a plugin publisher. DeliveryOS's reason is different and still valid: DeliveryOS's UI is inherently web-tech, and keeping the engine in the same language as the CLI avoids maintaining two implementations. Two different projects, two different — non-contradictory — conclusions. |
| Storage backend | Git (no custom database/server) | Free version history, free review via PRs, no new infrastructure to run. Same call ArcOS already made successfully. |
| How "contribute back" works | `push` = branch + commit + PR against the owning repo, never a direct write to main | Preserves whatever review bar each resource's owning repo already has (e.g., ArcOS's "core changes need 2 reviewers" rule keeps applying). |
| Artifact typing | Open/extensible `kind` vocabulary, not a closed enum | DeliveryOS's whole point is not knowing every future resource type in advance — unlike ArcOS, which deliberately locks its enum down. |
| Data discipline | No customer data in any DeliveryOS-shared remote, ever | Same hard rule ArcOS enforces ([docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)), carried over explicitly rather than assumed — matters more for DeliveryOS than for ArcOS since `doc`/`dataset` kinds make it much easier to tempt someone into uploading a real client deliverable. Protects future productization the same way it protects ArcOS's H3 option. |

## 7. Resource manifest (draft shape)

```yaml
id: pattern02-starter
kind: template          # template | doc | dataset | snippet | agent-asset | config | ...
description: Pattern 02 engagement scaffold
owner: senior-ai
version: 1.2.0
refresh: quarterly      # re-review cadence, separate from lifecycle state (see §9 item 5)
tags:
  roles: [engagement-lead, pm]
  teams: [delivery]
  stacks: [python, any]  # feeds §5.3 Filter 2 (current-project stack routing) — borrowed
                         # from ArcOS's real catalog frontmatter; without this field,
                         # Filter 2 has nothing to filter on
source_repo: growtharc/deliveryos-templates
install_target: ./
review_required: true
```

## 8. Phased roadmap (detail — see 5.4 for the flow view)

**Phases 0–2 are the MVP/POC.** Single developer, no auth system, no UI —
just proving the core loop (pull, edit, push, review, merge) works end to
end against one real remote. Auth, profiles, and the desktop app are all
deliberately deferred past this point; see risk #9 in §9.

| Phase | Deliverable |
|---|---|
| **0 — Engine MVP** | TypeScript engine: manifest schema, one remote, lockfile, `deliveryos pull` via CLI only (no UI yet). No auth — uses whatever git/GitHub credentials are already on the developer's own machine. |
| **1 — Push** | `deliveryos push` branch + PR automation. Still no auth system — same local credentials as Phase 0. |
| **2 — ArcOS as a remote** | Register ArcOS's `catalog/` as a DeliveryOS remote — proves "governed source feeding a general distributor." **MVP/POC complete at this point.** |
| **3 — Tauri app** | Rust shell + webview UI around the same engine (run as a bundled sidecar process): browse/pull/push/profile UI, packaged installer, auto-update wired up |
| **4 — Team rollout** | Auth/SSO (first time it's needed — see risk #9), profiles (saved tag filters per role/team), multi-remote support, per-resource review overrides |
| **5 — Polish** | Drift detection (`deliveryos doctor` equivalent surfaced in the app), background auto-sync, notifications |

## 9. Open questions / risks

Roughly ordered by how much it would hurt if left unresolved.

1. **Kind sprawl is already happening, contradicting our own discipline.**
   The plan says Phase 0–3 should prove the model on just 1–2 new kinds
   (`template` + `doc`), but discussion has since added `reference` and
   `asset` on top of the original 6 — 8 kinds named before a single one
   beyond `agent-asset` is built. This is the exact failure mode ArcOS's own
   docs warn about for itself. **Decision needed:** trim back to the
   original 1–2 for Phase 0–3, and explicitly park the rest.
   [`plans/STEP-1.5-QUALITY-GATES.md`](../plans/STEP-1.5-QUALITY-GATES.md)
   has a reusable shape for this kind of decision — instead of a flat
   trim-back, it poses an explicit menu (ratify the safe parts now, defer
   the expansion decision to a named future sync) rather than deciding
   everything at once. Worth using that shape here instead of a one-line cut.

2. **No security/provenance model, despite going org-wide from day one.**
   Push auto-generates PRs using someone's stored GitHub credentials.
   Undesigned: what that token can access, whether artifacts are signed, and
   how a compromised laptop couldn't push something malicious disguised as a
   legitimate resource. Notably, ArcOS's *own*
   [future-extensions doc](../plans/ARCOS-FUTURE-EXTENSIONS.md) flags exactly
   this ("signed/provenance-tracked assets") as mandatory once something goes
   external — and DeliveryOS is external-to-one-team from the start.
   [`plans/arcflow/`](../plans/arcflow/) *names* arc-identity (SSO/roles) and
   arc-vault (secrets) in a roadmap diagram for a different, unrelated
   product — **these don't exist and aren't being built.** Correction: not a
   dependency to check, just a naming pattern spotted in passing. DeliveryOS
   is standalone and needs to design its own auth/credential handling from
   scratch — see risk #9 below.

3. **Conflict resolution is hand-waved.** §5.3's Sync only designs the
   "take theirs or keep mine" case for when local edits and upstream changes
   collide. A real merge — both sides changed different parts of the same
   file — has no designed behavior yet.

4. ~~`agent-asset`'s special-cased Pull is a second code path.~~ **Resolved:**
   decided against integrating with Claude Code's native marketplace for now
   (§4.1 callout 4) — good to have later, not necessary. `agent-asset` uses
   the same generic Pull/Push path as every other kind, so this is no longer
   a two-code-path problem.

5. **No lifecycle/deprecation model.** ArcOS has
   `maturity: planned|draft|alpha|stable|deprecated`. DeliveryOS's manifest (§7) has
   `version` but nothing for "this resource is being retired" — no designed
   way to sunset something without just deleting it and breaking everyone
   still pulling it. Real ArcOS assets also carry a `refresh: quarterly`
   field, distinct from `maturity` — a re-review cadence, not just a
   terminal deprecated state. Added to §7's manifest; the actual lifecycle
   states (`maturity`-equivalent) are still undesigned.

6. **No success metric.** ArcOS defined exactly two (adoption %,
   median time-to-first-deliverable) before building anything. DeliveryOS has none
   yet — no way to say whether it's actually working once built.
   [`plans/PULSE-SUITE-SOLUTION-02.md`](../plans/PULSE-SUITE-SOLUTION-02.md)
   has a tiered metrics-ethics model worth reusing the moment DeliveryOS
   starts tracking Pull/Push activity as an adoption signal: team-level
   metrics always visible, individual detail restricted, recognition/
   leaderboard features off by default. Avoids turning "who pulls/pushes the
   most" into an accidental leaderboard.
   [`runbooks/day-1-install.md`](../runbooks/day-1-install.md) also
   establishes a governance principle relevant here: install time is the
   *leading indicator* for adoption, and a failed install step should be
   escalated, never worked around.

7. **App distribution mechanics still hand-waved.** Beyond "signed
   installer," nothing addresses code-signing/notarization specifics —
   unsigned installers trigger real OS security warnings on both Windows and
   Mac, directly undermining the "very easy install" goal named as the top
   priority.
   [`runbooks/day-1-install.md`](../runbooks/day-1-install.md) has a
   concrete acceptance test worth reusing for Phase 3 sign-off: someone
   **outside the builder team** runs a fresh install and times it before the
   installer is called "stable" — not the people who built it.

8. ~~Naming.~~ **Resolved:** DeliveryOS.

9. **Auth — deliberately deferred, not a blocker for MVP/POC.** The
   Phase 3+ app will eventually need identity (who is this person, what
   profile/role do they have), likely via standard OAuth/OIDC against
   whatever IdP GrowthArc already uses. But Phases 0–2 (the MVP/POC) need
   none of this — a single developer proving the pull/push/review loop uses
   their own existing git/GitHub credentials, same as running git by hand.
   Auth only becomes a real requirement at Phase 4 (team rollout), once more
   than one person's identity needs to be known. DeliveryOS is standalone —
   no dependency on unbuilt internal infrastructure (see corrected note on
   risk #2) — whatever gets built here will be built from scratch, later.

10. **Rust skill gap.** Tauri's native shell is Rust — someone on the team
    needs enough Rust to build and maintain that thin layer (the UI and
    engine stay TypeScript regardless). Worth confirming who owns this
    before Phase 3 starts.

11. **Sidecar packaging.** Bundling the TypeScript engine as a background
    process inside a Tauri app (rather than running fully in-process, as it
    would in Electron) hasn't been prototyped yet — needs a small spike to
    confirm packaging size and startup latency are acceptable before
    committing further.

## 10. Foundations borrowed from ArcOS

Six things found while re-reading the rest of ArcOS's docs that DeliveryOS should
build on rather than reinvent.

### 10.1 AGENTS.md as an open standard

[plans/ARCOS-FUTURE-EXTENSIONS.md](../plans/ARCOS-FUTURE-EXTENSIONS.md) flags
that `AGENTS.md` is now a **Linux-Foundation-stewarded standard**, read
natively by 28+ tools (Codex, Copilot, Cursor, Windsurf, Aider, Zed, Claude
Code). ArcOS itself is moving toward emitting one `AGENTS.md`-shaped core
instead of maintaining bespoke per-tool builds forever. DeliveryOS's `agent-asset`
kind should target this same standard rather than inventing a fifth
proprietary format — see the note on that row in §4.1.

### 10.2 Claude Code's native mandatory auto-update (parked, not adopted)

[runbooks/distribution.md](../runbooks/distribution.md) shows Claude Code
already supports org-wide, zero-user-action distribution today:
`forcedPlugins` + `strictKnownMarketplaces` + `autoUpdate: true` in managed
settings. Integrating `agent-asset` Pull with this was considered and
explicitly **decided against for now** (§4.1 callout 4) — good to have
later, not necessary. Keeping it here as a known option to revisit, not a
current dependency.

### 10.3 TypeScript vs. Python — two different questions

[ADR-0004](../docs/adr/0004-tooling-language-and-tri-target-build.md)
deliberately kept ArcOS's own tooling in Python, rejecting a rewrite in
TypeScript "to align with Claude Code" as pure cost with no payload benefit.
DeliveryOS's choice of TypeScript (§6) is not the same question — it follows from
DeliveryOS's UI being web-tech and wanting one engine shared by the CLI and the app,
not from trying to match Claude Code's implementation language. Recorded
explicitly in §6 so the two projects' choices don't read as contradicting
each other.

### 10.4 Two filters, not one, for "who sees what"

[ADR-0006](../docs/adr/0006-profiles-and-routing.md) combines install-time
**profiles** (who you are) with runtime **tag routing** based on the current
project's detected stack (who you are *and* what you're currently in). Folded
into §5.3 above — DeliveryOS's team/review layer now uses the same two-filter shape.

### 10.5 "No customer data, ever"

[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) treats this as a hard rule,
not a risk to monitor — customer artifacts live in customer-specific repos
that depend on ArcOS, never the reverse. Carried into DeliveryOS's decisions table
(§6) explicitly, since DeliveryOS's `doc`/`dataset` kinds make the temptation to
violate it much easier than it ever was for ArcOS's AI-agent-only catalog.

### 10.6 MCP as a precedent for open-spec thinking

[mcp/README.md](../mcp/README.md) — ArcOS's planned eval-runner and
observability servers use MCP specifically because it's a public,
model-agnostic spec with swappable implementations. Same instinct DeliveryOS already
leans on with git as the storage backend and, per §10.1, `AGENTS.md` as the
`agent-asset` payload: prefer an existing open standard over inventing a
proprietary one wherever one already exists.

## 11. Next steps

Pick one to start:
1. Scaffold the Phase 0 engine (TypeScript, manifest schema + one test remote + `deliveryos pull` via CLI) in a new repo.
2. Design the app distribution/install story before building anything that depends on it.
3. Decide the kind-sprawl trim-back (§9 item 1) before starting Phase 0.

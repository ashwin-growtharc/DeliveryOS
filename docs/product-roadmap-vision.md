# DeliveryOS — Long-Term Product Roadmap (Brainstorm)

**Status:** brainstorm / vision-setting, not yet planned into phases —
same status tier as [ui-components-feature-design.md](ui-components-feature-design.md)
before it became Phase 6. Nothing here is committed; it exists so the shape
of "where this eventually goes" is written down instead of living only in
conversation. **Owner:** unassigned. **Related:** [ARCHITECTURE.md](../ARCHITECTURE.md),
[PLAN.md](../PLAN.md).

## Why this doc exists

Two artifact kinds are real today: `agent-asset` (AI agents/skills/commands,
sourced from ArcOS) and `ui-component` (React/HTML components with live
sandboxed previews). Both proved the same underlying claim — that `kind` is
a free-form string ([schema.ts:7](../src/engine/manifest/schema.ts:7)), so a
new artifact category is a new `kind:` value plus kind-specific Scan/Preview
support, never an engine change. This doc extrapolates that pattern forward:
what's the next wave of kinds, what platform maturity has to grow alongside
them, and what bigger bets (voice AI, an IDE surface) sit further out.

This is explicitly **the end-state conversation, not a sequencing decision.**
ARCHITECTURE.md §9 risk #1 already warns against naming many kinds before
proving one — that discipline still applies when this gets turned into real
phases later. This doc is allowed to name things further out than we'd
actually build next; turning any one section into a real Phase N (with its
own scoped brainstorm doc, the way UI Components got one) is a separate,
later decision.

## Priority reset — what's real-value vs. still speculative

A direct gut-check on this whole doc, worth stating plainly before the
waves below: some of what's named here is a validated extension of a real
problem, and some of it is solution-first speculation with no evidence of
felt pain behind it yet. Sorting that honestly changes what should actually
happen next.

**The single highest-priority problem isn't a new kind at all.** Every real
push recorded in [CHANGELOG.md](../CHANGELOG.md) (`expandedtabs`,
`decrypting-text`, `magic-container`...) is the builder testing the loop —
not another engineer using it to solve their own work. PLAN.md's own Phase 3
end-to-end test ("someone *outside the builder team* runs a fresh install...
completes a full pull → edit → push cycle") is **explicitly deferred**, and
ARCHITECTURE.md §9 risk #6 already names "no success metric — no way to say
whether it's actually working." No wave below fixes that; getting one real
person to adopt this for one real task does, and it's cheaper than any of
them.

**Tier 0 — solve these before any new kind, all independent of any product
decision:**

1. **Prove adoption.** Get one real engineer, outside the build team, to
   pull/push something they'd have built anyway. Everything else here is
   still speculative until this happens once.
2. **Fix the lockfile race** ([scalable-architecture-research.md §3.7](scalable-architecture-research.md)) — a real bug today, not a scale problem.
3. **Close the GitHub-polling loop** (see below) — validated because it was named from lived experience, not invented for this doc.
4. **Ship the security/provenance model** ([scalable-architecture-research.md §3.3](scalable-architecture-research.md)) — a real liability the moment anything beyond a UI button is shared further, not a hypothetical.
5. **Track real usage as a number, not a feeling.** ARCHITECTURE.md §9 risk
   #6 ("no success metric") is itself a Tier 0 problem, not just a later
   nice-to-have — pulls/pushes/reuse counted from day one is what turns "we
   think this is useful" into evidence, and it's what actually proves #1
   happened rather than leaving it anecdotal. Cheap, foundational, and it's
   the only way any of the tiers below get a real go/no-go signal instead of
   another round of brainstorming.

**Tier 1 — validated-shaped, worth building once Tier 0 is real:** backend
plug-and-play artifacts and data-engineering artifacts both map to an
obvious, already-observed duplication problem (the same auth/pipeline code
rebuilt per engagement) — Waves 1 and 2 below.

**Good to have, later phase — placed there by choice, not for lack of a
case:** a Claude Code integration (MCP/skill) that checks DeliveryOS before
generating new code and offers to propose reusable code back — arguably the
single strongest adoption lever in this whole doc, and cheaper to build than
Wave 4's IDE surface, but sequenced after Tier 0 anyway.

**Stretch, needs real design care before it's buildable:** passive
cross-project duplicate detection — noticing the same pattern recurring
across client engagements without anyone proposing it — deliberately not
scoped further here, since it runs straight at the "no customer data, ever"
rule and needs its own design pass first.

**Parked, not now — kept in the plan, not deleted, but with no validated
pain behind them yet:** voice AI integration and a VSCode-based IDE surface
(Waves 3 and 4 below). Both stay written down for when real usage actually
surfaces a specific complaint pointing at them — neither gets designed
further on spec before that.

## The shape so far

| Kind | What it is | Discovery mechanism | Preview mechanism | Status |
|---|---|---|---|---|
| `agent-asset` | ArcOS's AI agents/skills/commands | Manual — ArcOS's own catalog is the source | None needed (text/markdown) | Real, proven (Phase 2) |
| `ui-component` | React/HTML components | Scan parses a project for extractable components | Live sandboxed iframe + generated props controls | Real, proven (Phase 6, e2e tests still open) |

Every future row in this table costs roughly the same two things: a
**discovery mechanism** (how does DeliveryOS notice a candidate artifact
exists in a project?) and a **preview mechanism** (how does a person judge
"is this the thing I want" before pulling, without reading raw source?).
Kinds that can't cheaply answer both are more expensive than they look.

## Cross-cutting: the user flow itself — closing the GitHub loop, project context, agents in the flow

Every wave above adds a new *kind*. This section is about the thing the user
flagged directly: today's loop is Browse → Pull → edit → Push → **go check
GitHub by hand** → merge → Pull again. That manual GitHub round-trip, plus
the lack of any concept of "what kind of project is this," is what stands
between "a working tool" and "a product people reach for by default."

### What's already solved vs. what's actually still open

Worth being precise here, since PLAN.md's Phase 5 already built more of this
than it might seem:

| Already real | Still genuinely open |
|---|---|
| Drift detection (`check-updates` / "Check for updates") | **PR review-status notifications** — approved / changes-requested / merged is still a manual GitHub check. PLAN.md Phase 5 named this and **deliberately deferred it**, with an explicit revisit condition: "matters more once there's a reason to expect the app running unattended in the background." Worth re-opening that condition now — if the goal is genuinely "a product everyone uses," the app running in the background (or an IDE-extension/tray presence, see Wave 4) is exactly the scenario that condition was waiting for. |
| Background auto-sync (20-min timer, silent unless it finds something) | Same mechanism could poll PR status the same way it polls version drift — no new architecture, same reentrancy-guarded tick, just a second thing it checks. |
| Bulk pull by tag, "Pull all" | One-command install that also *wires up* the artifact (see agents below) — today "pull" still means "files land," not "this is integrated." |
| Scan finds new candidates in a project | Scan has no concept of *why* this project exists (scratch/client/internal/brownfield) — see next section. |

### Project context as a first-class concept (not just role/team)

§5.3 of ARCHITECTURE.md already has two filters — **who you are** (profile)
and **what stack you're in** (detected from the folder). The user's
scratch / client-onboarded / internal / existing-project-improvement
distinction is a real third one, because it changes *behavior*, not just
what's visible:

| Project context | What changes |
|---|---|
| **From scratch** | Most permissive. Wants a *bundle*, not one artifact at a time (see below) — a fresh Next.js client project probably wants "template + auth + CI config" installed together. |
| **Client-onboarded** | Push should default to **pull-only, propose-back disabled**, not just discouraged — a client repo's customizations must never have a live path back into a shared remote. This is the same "no customer data, ever" rule (§6) already governing `dataset`/data-pipeline kinds, applied to *where artifacts can flow from*, not just what they can contain. |
| **Internal (GrowthArc's own tooling)** | Full read-write, exactly today's behavior — this very repo is that case. |
| **Existing-project improvement (brownfield)** | Needs a **fit check before install** — does this artifact assume a folder structure, a dependency version, a naming convention this project doesn't have — surfaced *before* files land, not discovered after. |

Mechanically this is a `deliveryos init`-time declaration (or a best-effort
auto-detect — a fresh empty folder vs. an existing `package.json` vs. a repo
already carrying client-identifying markers) stored alongside the lockfile,
consulted by both Pull (what does it default to/warn about) and Push
(is propose-back even offered).

### Agents in the flow

Four distinct roles, each answering a friction point already named above or
earlier in this doc — not "add AI" for its own sake, but because each of
these is a judgment call a fixed rule genuinely can't make safely:

1. **Fit-check agent** (Pull-time, brownfield context) — before writing
   files into an existing project, checks real compatibility (dependency
   versions present, folder conventions, naming collisions) and surfaces a
   warning/adaptation instead of a blind copy.
2. **Wiring/integration agent** (install-time, every context) — this is the
   actual answer to "plug and play... connect to apps/projects." Today's
   `post_install` is one fixed shell command. A real integration means
   editing the *consuming* project — adding an import, registering a route,
   updating an env template — the way a person would when wiring in a
   library by hand. This is the single biggest lever on "does this feel
   like a real product" vs. "files got copied somewhere."

   **Scope limits (candidate framework, not decided) — this needs bounds
   or it becomes untrustworthy fast:**

   | Tier | What it covers | Behavior |
   |---|---|---|
   | Auto-applies | Mechanical, reversible, same edit every time — adding an import line, appending to a routes array in a pattern the project already uses consistently, adding a placeholder line to `.env.example` | Applied without asking |
   | Proposes, waits for confirmation | Touches existing logic — wrapping the app root in a provider, merging into a config object that already carries local customizations, editing a file with unrelated changes nearby | Shown as a diff; applied only on explicit confirmation |
   | Never touches | Judgment calls a fixed rule — or an agent — shouldn't make silently: real secret *values* (only ever placeholders), database schema/migrations, anything in a client-onboarded project without an explicit opt-in (see the project-context table above), deleting or overwriting existing code | Left as a plain checklist item for a person, never attempted |

   The failure mode this guards against: an agent confident enough to
   silently "wire things up" is also confident enough to silently wire
   them up *wrong*. When it can't tell which tier something falls into,
   it should degrade to a checklist entry, not guess.
3. **Scrub/genericity-check agent** (Propose-time, data-pipeline and
   backend-plugin kinds especially) — already flagged in Wave 1/2 as a
   judgment call Scan can't make mechanically ("is this actually generic,
   does it leak client data or business logic"). Natural agent task.
4. **Status/notification agent** — watches PR state and update-availability
   across everything pulled, and surfaces it proactively. Doesn't strictly
   need to be LLM-based (a poller works, see the table above) — but framing
   it as an agent that also explains *why* something needs attention
   ("changes requested — reviewer wants X") is more useful than a bare
   status change.

### Making push/pull actually easy

- **One verb, not a ceremony** — `deliveryos add <id>` doing browse-context
  → pull → wire, in one action, is the shadcn/npm-install feel worth aiming
  for, instead of today's separate remote-add/list/pull/push steps.
- **Bundles/recipes** — propose and pull *sets* of related artifacts
  together for a given project context (e.g. "scratch client-project
  starter" = template + auth + CI config in one action), rather than one
  Browse click at a time. This is also the natural unlock for backend and
  data-engineering kinds once they exist — nobody wants to hand-assemble
  five artifacts to stand up one pipeline.
- **Meet people where they already are** — the IDE surface (Wave 4) and
  closing the notification loop (above) both point at the same thing: the
  less often someone has to context-switch to a separate app or to GitHub,
  the more this becomes a default habit instead of an occasional tool.

## Wave 1 — Backend plug-and-play artifacts (auth/login, and similar)

**The idea:** the same Pull/Push loop, applied to backend building blocks —
an auth/login module, a rate-limiter, a webhook-verification helper,
standard middleware. Kept generic for now (no concrete real target picked
yet, unlike `ui-component`'s real Button/Card) — grounding this in one real
implementation is the first thing to do once this stops being a brainstorm.

**What's genuinely different from `ui-component`:**

- **No visual preview.** You can't screenshot an auth flow the way you
  screenshot a Button. Detail view probably needs to show: the manifest's
  description, a rendered README, the list of required env vars /
  config the installer will need to fill in, and maybe a "files this will
  touch" summary — closer to a diff preview than a live render.
- **Install isn't just file-copy.** `post_install` already exists in the
  manifest (a one-line shell command run in `install_target`), but a real
  auth module likely needs *parameters*, not just a command — e.g. "what's
  your session-secret env var named," "which ORM/user table." Nothing in
  the current manifest shape (§7 of ARCHITECTURE.md) has a slot for
  install-time prompts. This is a real schema gap, not just a UI gap.
- **Security/provenance stops being theoretical.** ARCHITECTURE.md §9 risk
  #2 ("no security/provenance model") was written as a background concern
  when the only kinds were agents and buttons. An auth/login artifact *is*
  a credential-handling surface — a malicious or careless push here has a
  materially different blast radius than a bad Button. This risk should be
  treated as a hard prerequisite for shipping backend-plugin kinds
  org-wide, not a nice-to-have polish item.
- **Discovery is harder than Scan.** `ui-component`'s Scan works because
  "is this a component" is mechanically checkable (a React file with a
  default export, roughly). "Is this auth module reusable/generic enough to
  share" is a judgment call a scanner can't safely make — more likely this
  category starts as manual/CLI-driven propose-new only, no Scan, until a
  real pattern for "genuinely reusable backend code" emerges from use.

## Wave 2 — Data engineering artifacts

**The idea:** pipelines, transforms, dbt-style models, standard ETL/ELT
scaffolds, reference schemas — the `dataset`/`config` kinds named back in
ARCHITECTURE.md §4.1 but never built, generalized a bit further.

**What's genuinely different:**

- **Directly touches the one hard rule already decided:** "no customer data
  in any DeliveryOS-shared remote, ever" (§6). A data-pipeline kind is
  exactly the temptation case that rule was written for — a real
  transform/schema is very easy to accidentally carry a real client's
  column names, sample rows, or business logic. Whatever Scan/propose flow
  this gets needs an explicit, visible "are you sure this is
  scrubbed/generic" checkpoint, not just a policy written in a doc nobody
  reads at propose-time.
- **Preview mechanism is genuinely unsolved.** A live sandboxed iframe
  doesn't make sense for a dbt model or an Airflow DAG. Candidates, all
  unevaluated: a rendered lineage/DAG diagram, a schema table, a sample
  (synthetic, never real) data preview. Closer in spirit to §13 of the
  UI-components doc ("preview for large/multi-file artifacts") than to
  anything solved today.
- **"And so on" beyond this** (the user's own framing) — once backend and
  data-engineering both exist, the remaining named-but-unbuilt kinds from
  §4.1 (`template`, `doc`, `snippet`, `config`, `reference`) become much
  cheaper to pick up, since the discovery/preview questions will have been
  answered twice already by then.

## Wave 2.5 — the broader taxonomy: artifact kinds by team/discipline

Backend and data-engineering are two instances of a more general pattern:
every functional team/discipline in an org is a candidate source of
shareable artifacts, not just engineering sub-specialties. Naming the fuller
map here — not as a commitment to build all of it, just so the space is
visible instead of discovered one kind at a time.

**Engineering-adjacent (technical, already PR-comfortable — cheapest to add,
same shape as `ui-component`/backend-plugin):**

| Discipline | Candidate kind | Example artifacts |
|---|---|---|
| Data engineering | `data-pipeline` | ETL/ELT scaffolds, dbt models, orchestration DAGs (Wave 2 above) |
| Data science / ML | `ml-artifact` | model artifacts, feature-engineering snippets, notebook templates, eval harnesses — distinct from data engineering: DE moves/shapes data, DS builds models on top of it |
| DevOps / infrastructure | `infra` | Terraform/Pulumi modules, Dockerfiles, Kubernetes manifests, CI/CD templates |
| QA / testing | `test-harness` | test suite scaffolds, eval frameworks, load-test scripts |
| Security | `security-config` | scanning configs, threat-model templates, compliance checklists |
| Mobile | `mobile-component` | iOS/Android equivalent of `ui-component` |
| Design | `design-asset` | design tokens, Figma-to-code mappings — this project already has its own [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md) as a candidate first artifact |

**Cross-org (non-technical — same `kind` mechanics, but hits a wall Scan/PR
review doesn't solve, see the gate below):**

| Discipline | Candidate kind | Example artifacts |
|---|---|---|
| Product/PM | `pm-template` | PRD templates, discovery-kickoff frameworks (ArcOS already has some of this as `agent-asset` skills) |
| Sales/Marketing | `sales-asset` | pitch decks, proposal templates, case-study formats |
| Customer Success/Support | `playbook` | runbooks, escalation checklists |
| Analytics/BI | `bi-asset` | dashboard templates, curated SQL query libraries, shared metric definitions |
| HR/People ops, Finance/Legal | `org-doc` | onboarding docs, SOW/contract templates |

**The gate between the two groups matters more than any individual kind
name.** Everything in the engineering-adjacent group can use Pull/Push
exactly as it works today — those teams already live in git and already
review via PRs. Everything in the cross-org group runs into something
`kind` doesn't fix: non-technical people won't comfortably "open a PR" no
matter how good the manifest schema is. That's not a per-kind problem to
solve five separate times — it's one shared, currently-undesigned question:
**does Push stay PR-shaped for those roles, or does it need an entirely
different review UI?** This is downstream of (and probably blocked on) the
same Phase 4 profiles/access work in the next section — treat any
cross-org-group kind as gated on that decision, not just on writing its
manifest schema.

## Platform maturity track — runs alongside the kind waves, not after them

The user's "org, team, project management, easy access and installation"
point isn't a new kind — it's PLAN.md's existing **Phase 4 (Team rollout)**
and the deferred half of **Phase 3**, re-surfacing because more artifact
kinds make the lack of it hurt more:

- **Org/team/project management, access control** = Phase 4's auth/SSO +
  profiles (saved tag-filter queries per role/team) + per-resource review
  overrides. Currently blocked on GrowthArc not having a real IdP yet
  (PLAN.md's Phase 4 deferral note) — that blocker doesn't go away just
  because more kinds exist. Worth re-checking periodically, not re-deciding
  here.
- **Easy access and installation** = the deferred half of Phase 3: a
  packaged, code-signed installer per OS, and the outside-tester
  clean-machine e2e test. Both were deliberately deferred as "not needed at
  POC/dev stage" — that calculus changes once backend/data kinds mean
  *more* people, potentially less technical ones, need to install this.

Both of these compound with each new kind rather than being solved once —
worth remembering that when a future "let's finally do Phase 4" conversation
happens, it should account for whatever kinds exist by then, not just the
original two.

**The systems side of this** — how org/team/project should actually be
modeled, how the catalog scales past a live git read on every Browse, and
how security/provenance gets a real answer — is worked out in its own
doc: [scalable-architecture-research.md](scalable-architecture-research.md).
That doc grounds each piece in a real adjacent system (Backstage, Sigstore/
SLSA, OCI/Helm, multi-tenant RBAC patterns) rather than inventing a scheme
from scratch.

## Stretch idea — cross-project duplicate detection (needs care, not now)

Every discovery mechanism so far — Scan, propose-new, the catalog index —
only surfaces an artifact once a person decides it's worth sharing. The
bigger unlock would be **passive**: noticing that the same auth pattern, the
same rate-limiter, the same CSV-ingestion scaffold shows up nearly
identically across several client engagements, and surfacing *that* as a
candidate — without anyone having had to think to look.

**Why this is worth naming, not just building:** it runs straight at the
one hard rule this whole project already protects — "no customer data in
any DeliveryOS-shared remote, ever" (§6 of ARCHITECTURE.md). Any real
version of this has to compare *structure* across client repos (shapes,
patterns, control flow) without ever centrally storing, transmitting, or
exposing actual client code or business logic. That's a materially harder
and higher-stakes design problem than anything else in this doc — likely a
local-only comparison (e.g. structural hashing/embedding computed and
compared without a central index of the raw code itself), not a service
DeliveryOS itself hosts. **Not scoped further here on purpose** — this
needs its own dedicated design pass before anyone builds toward it, not a
few bullet points in a brainstorm doc.

## Good to have, later phase — a Claude Code integration (MCP/skill)

**Different in kind from Waves 1–4 below: not a new artifact kind, and not
parked for lack of validated value — placed here as good-to-have, later
phase, by explicit choice, not because the case for it is weak.**

The observation this comes from: this entire project is built through
Claude Code, and a `ui-component-extractor` *skill* already bridges Claude
Code into DeliveryOS for one specific case (pulling a pasted component into
the preview pipeline). The idea is to generalize that bridge into the
actual first-line interface for the whole loop:

- **Pull-side:** before Claude Code generates an auth module, a UI
  component, or a pipeline scaffold from scratch on a real engagement, it
  checks DeliveryOS's catalog first — "does GrowthArc already have one?" —
  and offers to pull instead of generating new code.
- **Push-side:** after something reusable gets built during a real
  engagement, Claude Code can prompt to propose it back, the same moment
  the pattern actually exists, instead of waiting for a separate, later
  Scan pass.

**Why this is a stronger adoption lever than Wave 4's IDE surface, and
cheaper to build:** Wave 4 needs a VSCode extension or fork, a new UI
surface, and (per its own write-up) an audience tradeoff against the Tauri
app. This needs no new UI at all — Claude Code already supports skills and
MCP servers, which is exactly the shape this requires. It also attacks
Tier 0's #1 problem (zero adopters outside the builder) more directly than
anything else in this document: the barrier today isn't tool quality, it's
that DeliveryOS is a separate thing to remember to open. Putting the check
inside the tool already being used for every task removes that barrier
without asking anyone to change their habits.

Placed at good-to-have/later-phase by explicit direction, not because the
reasoning above is wrong — revisit once Tier 0 is real and there's a
concrete engagement to build the first version against.

## Wave 3 (parked, not now) — voice AI integration

**Parked as of this reprioritization** — no validated pain behind it yet;
kept written down, not designed further, until real usage points at it.

The user named Parakeet (NVIDIA's ASR model) and Whisperflow (Whisper-based
system-wide dictation) as things to think about integrating. **This is the
least-shaped idea in this doc** — worth being honest about what's actually
still undecided rather than guessing an answer:

- Is this a **new artifact kind** — i.e., a voice-interface plugin someone
  can Pull into their own project, the same way a Button or an auth module
  is pulled?
- Or is this an **interaction modality for DeliveryOS itself** — dictating
  a Push description, a Browse search query, or a Scan review decision by
  voice instead of typing? This reads more like it belongs to the IDE
  surface below than to the kind system.
- Or both, at different times.

Flagging this rather than picking one, since picking wrong here is expensive
to unwind later and nothing forces a decision yet.

## Wave 4 (parked, not now) — a DeliveryOS IDE surface

**Parked as of this reprioritization** — no validated pain behind it yet;
kept written down, not designed further, until real usage points at it.

The user was explicit: **not** a from-scratch IDE — building on VSCode
instead (the way Cursor, Windsurf, and Void did), most likely starting as a
VSCode extension rather than a full fork. The idea: bring Browse/Pull/Push
into the editor directly, so a developer proposing a component or pulling
an auth module never leaves the place they're already working.

**The real tension worth naming now, not deciding now:** ARCHITECTURE.md §6
picked Tauri specifically because the audience is "whole org, eventually —
not just engineers" (HR, sales, exec, finance need to Browse/Pull too, and
none of them live in an editor). A VSCode-based surface only ever reaches
the engineering slice of that audience. Two honest framings:

1. The IDE surface **replaces** the Tauri app for engineers, and the Tauri
   app narrows to serve non-technical roles only.
2. The IDE surface **adds a second front door** alongside the Tauri app,
   both talking to the same sidecar/engine — extension vs. fork, and
   "which UI for which audience," genuinely undecided.

An extension (thin, talks to the existing engine/sidecar the same way the
Tauri shell does) is the far cheaper starting point either way — it rides
on VSCode's own release cadence instead of maintaining a fork, and can be
scoped down/killed without having bet the whole desktop-app strategy on it.
A fork is a much bigger, much later bet, if ever.

## Open questions carried forward (not answered here, on purpose)

1. Manifest schema gap: does `post_install` grow install-time *parameters*
   (not just a fixed shell command), or does that live somewhere else
   entirely? Backend-plugin kinds need this; nothing today provides it.
2. Security/provenance model (§9 risk #2) — was "nice to have," should
   probably become a real prerequisite once an auth/login kind is real.
3. Preview mechanism for non-visual, multi-file artifacts (data pipelines,
   backend modules) — genuinely unsolved, not just unbuilt.
4. Voice AI: new kind, new interaction modality, or both — undecided.
5. IDE surface: extension vs. fork, replaces vs. adds-to the Tauri app —
   undecided, and probably the single highest-leverage decision in this
   whole doc once it's time to actually pick.
6. Cross-org kinds (sales, HR, support, etc.) all share one blocking
   question — does Push stay PR-shaped for non-technical roles, or does it
   need a different review UI entirely — rather than each needing its own
   answer.
7. PR review-status notifications — PLAN.md Phase 5 deferred this pending
   "the app running unattended in the background" being a real scenario.
   Worth a fresh look now rather than assuming that condition still holds.
8. Project context (scratch/client/internal/brownfield) as a stored,
   consulted-by-Pull-and-Push concept — currently doesn't exist at all;
   today's lockfile has no notion of *why* a project exists.
9. Wiring/integration agent scope — a candidate three-tier framework now
   exists above (auto-applies / proposes-and-confirms / never-touches), but
   which concrete edits sort into which tier is still a judgment call, not
   a designed rule — revisit once a real backend-plugin artifact exists to
   test it against.

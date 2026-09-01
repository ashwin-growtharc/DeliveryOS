# Delivery tools in DeliveryOS — requirements, for approval

**Status: approved 2026-09-01, v1 built.** Ashwin B owns the risk library and
friction-log conventions (§6.3). No first-test engagement was identified
before building — v1 shipped as three real PRs against `growtharc-ai-helpers`
anyway; §7's "one real engagement actually used it" bar for done still stands.

Covers three requested tools — a **scoping calculator**, a **risk register**,
and a **friction log** — and answers the real question behind them: can
DeliveryOS carry business/delivery tooling, not just code, and what shape
would that actually take?

Every constraint below was verified against this repo's real code, not
assumed. Citations are given so anyone reviewing can check them.

---

## 1. The three tools

| Tool | What it's for | Who touches it |
|---|---|---|
| **Scoping calculator** | Effort + fee estimate for a proposal. Bridges sales and delivery — the delivery team's real effort model feeding the number sales quotes. | Sales, delivery lead |
| **Risk register** | Common risks per engagement type, pre-listed, so each project starts from institutional memory rather than a blank page. | Delivery lead, PM |
| **Friction log** | A running weekly capture of what didn't work, so it can actually be fixed rather than re-encountered. | Whole engagement team |

---

## 2. The finding that shapes everything: template vs. instance

Each of these three tools is really **two different things**, and DeliveryOS
can only carry one of them.

| | The template | The instance |
|---|---|---|
| **What it is** | The rate model, the pre-listed risk library, the friction-log format | This client's fee, this project's live risks, this engagement's weekly entries |
| **Reusable across engagements?** | Yes — that's the whole point | No, by definition |
| **Contains client data?** | No | **Yes — almost always** |
| **Belongs in a shared remote?** | Yes | **Never** |

DeliveryOS is architecturally built to distribute the **template**, and is
structurally hostile to holding the **instance** — which is correct, not a
gap. `ARCHITECTURE.md:322` states the rule directly: *"No customer data in
any DeliveryOS-shared remote, ever"* — and, notably, already predicted this
exact risk, warning that `doc`/`dataset` kinds *"make it much easier to tempt
someone into uploading a real client deliverable."*

**So the proposed model is the same one every code artifact already follows:**

> Pull the template into the engagement's own repo. Fill it in there. It stays
> there. Only push back an improvement *to the template* — never the filled-in
> copy.

That is exactly how a UI component works today: you pull it, you edit your own
app, and you push back an improvement to the component — not your app.

---

## 3. What the code actually allows (verified, not assumed)

Three findings materially constrain the design.

### 3.1 A pulled component can compute, but can never save

The preview iframe is `sandbox="allow-scripts"` with **no
`allow-same-origin`** (`src-tauri/spike-ui/app.js:1230`, and five other
call sites), which gives it an opaque origin — `localStorage`,
`sessionStorage`, and `IndexedDB` all throw. A strict CSP
(`default-src 'none'`, `src/engine/preview/compile.ts:768`) additionally
blocks `fetch`, XHR, and WebSockets.

Real React 19 runs inside, so a calculator would genuinely calculate
(`compile.ts:465-467`). But the iframe→parent protocol is exactly four
messages — `ready`, `variantChanged`, `error`, `contentHeight` — and none of
them reaches the sidecar or writes to disk (verified: zero RPC calls from any
message handler).

**Consequence: a scoping calculator rendered in DeliveryOS's preview could
compute a number and would then lose it.** Every preview surface is also a
height-clamped card (max 640px, `app.js:1071-1073`) — there is no full-page
host a real tool UI could occupy.

*This is a deliberate security boundary, not a bug. It should not be widened
for these three tools.*

### 3.2 There is no data store of any kind

Everything DeliveryOS writes into a project is fixed-shape:
`.deliveryos/lock.json` (a typed `LockEntry`), five append-only audit
`.jsonl` logs (fixed event shapes), pristine payload snapshots, and
`.env.local` (flat `KEY=VALUE`). There is **no** SQLite, no document store,
nothing keyed per-artifact for author-defined records, and nothing that grows
a user-entered list (`src/engine/paths.ts`; verified absent by search).

**Consequence: DeliveryOS cannot hold a risk register's rows or a friction
log's entries.** Those live in the engagement's own repo, as files.

### 3.3 The manifest schema is closed — and silently deletes unknown fields

`ManifestSchema` (`src/engine/manifest/schema.ts:117-215`) is a plain
`z.object` with no `metadata`/`extra` field and no `.passthrough()`. Zod
strips unknown keys at parse time, and `push` re-serialises the *validated*
object back to `manifest.yaml` (`src/engine/push/push.ts:444,563`) — so a
custom field an author adds is not merely ignored, it is **physically deleted
from the file on the next push**.

**Consequence: any structured metadata these tools need must either fit
existing fields (`tags.roles`/`teams`/`stacks`, free-text arrays) or requires
a real schema change.** Nothing should rely on custom manifest keys.

---

## 4. Per-tool requirements

Each tool below is described twice: a plain worked example first, then the
formal requirements. The examples all follow one running scenario — **GrowthArc
wins a Snowflake data-platform build for a retail client** — so the three tools
can be seen connecting to each other rather than as three separate ideas. Names
and numbers in the examples are illustrative.

### 4.1 Scoping calculator

**In practice**

*The shared template* — a blank calculator with the effort model already in it:

> Discovery = 5 days · Architecture = 8 days · Ingestion = 12 days · …
> × complexity multiplier × day rate

*The engagement's own copy* — the actual quote, which stays in the engagement
and is never pushed back:

> RetailCo: 47 days total → the fee sales sends them

*What gets pushed back:* after delivery, discovery turns out to have really
taken 9 days, not 5. **The template's number** is corrected and pushed, so the
next proposal is priced from reality. RetailCo's fee is never pushed.

**Requirements**

- **Template half (goes in DeliveryOS):** the effort model — phases, roles,
  day-rate structure, complexity multipliers. Phases should align with the
  delivery playbook already drafted (discovery → architecture → ingestion →
  transformation → consumption → testing → migration) so an estimate is
  built from the same phases the project is actually run in.
- **Instance half (never pushed back):** a specific client's quoted number.
- **Computation required:** yes — this is the only one of the three that
  genuinely needs to calculate.
- **Recommended shape:** a **spreadsheet template** (`kind: dataset`).
  Deliberately not a web tool: sales already work in spreadsheets, a
  spreadsheet computes natively with zero engineering, and it needs no
  sandbox, no data store, and no new UI. `ARCHITECTURE.md:175`'s own example
  for the `dataset` kind is literally *"a standard project-estimate
  template."*
- **Sensitivity:** the rate card is commercially sensitive **internally**.
  Even the template should be treated as internal-only, and must never reach
  a public or client-shared remote.

### 4.2 Risk register

**In practice**

*The shared template* — a pre-written library of what commonly goes wrong on
this kind of engagement:

| Common risk | Typical mitigation |
|---|---|
| Source-system owner unreachable | Name and contact them in discovery, before design |
| PII discovered late in a source | Classify every source up front |
| Source data quality worse than promised | Profile real data in week 1, not month 2 |

*The engagement's own copy* — the live register for this client:

> *Risk:* Salesforce owner on leave until March · *Owner:* Priya ·
> *Impact:* high · *Status:* open

*What gets pushed back:* the engagement hits a risk nobody had listed — the
client's VPN blocked our IPs for two weeks. That line is added to the **shared
library**, so the next project starts already knowing to check for it.

**Requirements**

- **Template half:** the genuinely valuable part — a **pre-listed risk
  library per engagement type** (data platform / web app / AI-agent build),
  each with a typical mitigation. This is institutional memory, and it is the
  thing worth pulling.
- **Instance half:** this engagement's live register — risk, owner,
  likelihood, impact, mitigation, status.
- **Computation required:** trivial at most (a likelihood × impact score).
- **Recommended shape:** `kind: doc` — a markdown table pulled into the
  engagement repo and filled in there. Because it lives in that repo, git
  history shows how the risks actually evolved week to week.
- **Known limitation:** markdown task-list checkboxes render as
  `disabled` and are non-interactive; there is no persistence for them
  (`src-tauri/spike-ui/app.js:2081-2114`). A register is therefore a table
  someone edits in their editor, not a clickable UI. **Accepted for v1** —
  making it interactive would require §3.1 and §3.2 to change.

### 4.3 Friction log

**In practice**

*The shared template* — just the format: each week, write down what slowed you
down.

*The engagement's own copy* — this project's weekly entries:

> *Week 3:* Lost 6 days waiting for Snowflake credentials — we only asked for
> them after architecture was done.

*What gets pushed back* — this is the tool where the whole loop is the point:

1. **Friction noticed** — "lost 6 days waiting on credentials"
2. **Generalised** — "credentials should be requested during discovery, not
   after architecture"
3. **Pushed back** — a new line in the shared discovery checklist
4. **Next engagement** pulls that checklist, asks in week 1, and never loses
   those 6 days

*The scrub step, concretely:* the raw entry might read *"the client's IT lead
never replied."* What gets pushed back must read *"source-system owners are
often slow to respond — request access during discovery."* No client name, no
person's name.

**Requirements**

- **Template half:** the format and the weekly capture prompts.
- **Instance half:** the actual weekly entries for one engagement.
- **The distinctive property:** this tool's entire purpose is to *generate
  improvements* — a friction entry that generalises ("the source-system owner
  was unreachable for three weeks") should become a new line in the discovery
  checklist, pushed back as a real PR. **The friction log is the Push loop
  applied to process rather than code.** Of the three, it's the one that most
  directly justifies putting this in DeliveryOS at all.
- **Recommended shape:** `kind: doc`.
- **Required discipline — the scrub step:** raw entries will name clients,
  vendors, and people. Anything pushed back must be **generalised first**, by
  a person, deliberately. This must be written into the artifact's own README
  as a rule, not left to judgement in the moment.

---

## 5. Options considered and rejected

| Option | Verdict |
|---|---|
| **Live micro-frontend inside DeliveryOS's preview** | **Rejected for v1.** §3.1 — it can compute but cannot save, and is confined to a ≤640px card. A calculator that loses its answer is a demo, not a tool. Widening the sandbox to fix this would dismantle a deliberate security boundary for three artifacts that don't need it. |
| **Build a real data store + full-page tool surface in DeliveryOS** | **Rejected for now.** A genuinely large feature (§3.2), justified only if real usage proves files aren't enough. Building it before that repeats the "design for a hypothetical" mistake this project has already caught and corrected twice (see `PLAN.md`'s Phase 11 and Phase 12 scoping notes). |
| **Custom manifest fields to describe these tools** | **Rejected — actively unsafe.** §3.3: they're silently stripped and then deleted from the file on the next push. |
| **Plain files pulled into the engagement repo** | **Recommended.** Zero new engineering, works with what's already shipped, keeps client data out of shared remotes by construction. |

---

## 6. Real problems this proposal does not solve

Named deliberately, rather than discovered later.

1. **`doc` and `dataset` have no first-class UX.** Both are marked *"Proposed,
   not built"* in `ARCHITECTURE.md:174-175`. Concretely: they get no Browse
   sidebar category (only UI Components / Starter Kits / Backend Plugins
   have one), and a `doc` artifact with no `README.md` renders a Detail view
   with a **blank content area** — every tab is gated on files it doesn't
   have. **Mitigation for v1:** require every one of these artifacts to ship
   a real `README.md`, which does render properly.
2. **No way to distinguish one doc from another.** Nothing separates "this is
   a checklist" from "this is a runbook" from "this is a risk library." The
   kind-agnostic `tags.stacks`/`roles`/`teams` fields could carry a
   convention (e.g. `stacks: [delivery-tooling]`), but nothing enforces it.
3. **Curation ownership is unresolved.** A risk library nobody maintains
   decays into noise within a year. **This needs a named owner before it
   ships**, not after.
4. **The scrub step is a human promise, not a mechanical guard.** Nothing
   prevents someone pushing a filled-in register containing client data to a
   shared remote. A real guard (a warning on push for artifacts tagged as
   delivery tooling) is worth considering — but only once the convention in
   (2) exists to detect them.
5. **Documentation drift found while researching this:** `ARCHITECTURE.md:182`
   states *"Only `agent-asset` is real today. Everything else is proposed, not
   yet built."*, which is now false —
   `ui-component`, `backend-plugin`, and `template` have all shipped. Worth
   fixing separately; unrelated to this proposal, but noted since it was
   found here.

---

## 7. Proposed scope

**In scope for v1**

- Three artifacts authored and pushed to the catalog: `scoping-calculator`
  (`dataset`), `risk-register` (`doc`), `friction-log` (`doc`).
- Each ships a real `README.md` — required, per §6.1 — stating what it is,
  how to fill it in, and the rule that the filled-in copy is never pushed back.
- A tagging convention so these are findable as a group.
- One real engagement uses at least one of them, for real.

**Explicitly out of scope for v1**

- Any change to the preview sandbox, the manifest schema, or the app's UI.
- Any data store, interactive checkboxes, or in-app tool surface.
- A dedicated Browse category — not worth it until there are enough of these
  artifacts to be worth filtering.
- Any mechanical guard against pushing client data (see §6.4) — the
  convention has to exist first.

**Definition of done for v1:** one real engagement has pulled one of these and
used it, and we know whether it helped. Not "three artifacts exist in the
catalog."

---

## 8. What's being approved

1. **The template/instance split** (§2) — that DeliveryOS carries the
   template, and the filled-in copy never leaves the engagement's own repo.
2. **Files over a live in-app tool** (§5) — accepting that the scoping
   calculator is a spreadsheet, not a web app, for v1.
3. **A named owner** for the risk library and friction-log conventions
   (§6.3), before anything ships.
4. **The v1 scope** (§7), including the "one real engagement actually used
   it" bar for done.

Open question for the approver: **which upcoming engagement is the first real
test?** Without one, this is three more files nobody pulls.

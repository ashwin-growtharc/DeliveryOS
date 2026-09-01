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

## Tier 0 hardening — **In progress**

A cross-cutting track: fix what's broken and prove someone outside the build
team benefits, rather than build more on an unproven foundation.

- Done: the lockfile race between auto-sync and a manual pull/push; PR
  merge/close status polled on the same tick as version drift; the
  security/provenance model
- **Open**: get one engineer outside the build team to actually adopt it
- **Open**: track real usage numbers — deferred until there's an adopter to
  design the tracking around

---

## What's next

Ordered by what blocks value, not by phase number.

1. **Finish Phase 12** — responsive breakpoints (there are none today), error
   states on the remaining views, keyboard reachability, toast dismissal, and
   consolidating 10 chip classes and 5 card classes into one of each.
2. **Make the gates real** — ESLint does not cover the 343KB desktop frontend
   at all, `test/` is not typechecked, and there is no CI. Nothing enforces
   any of it on a push.
3. **Split `app.js`** — 7,464 lines in one IIFE. Deferred until ESLint covers
   it, so the move happens with a linter watching.
4. **A shared command surface** — the CLI exposes 15 commands and the sidecar
   40, with nothing shared between them, so they drift. `remote add`/`remove`
   exist twice and only the sidecar copy has tests.

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

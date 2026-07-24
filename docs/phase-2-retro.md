# Phase 2 retro: ArcOS as a remote

Per PLAN.md's Phase 2 exit criteria, this is the write-up of what broke and
what was harder than expected — the checkpoint for deciding whether Phase 3
(the Tauri app) is worth building yet.

## What was actually tested, and what wasn't

PLAN.md's literal goal is "pull a real ArcOS catalog asset, edit it, push a
real PR against `arc_os`, respecting its own review rules." **That is not
quite what happened, and the difference matters:**

- Forking `growtharc/arc_os` is disabled at the GitHub org level (403 on
  `POST /repos/growtharc/arc_os/forks`), so testing directly against a fork
  wasn't possible.
- Rather than risk any real action against the actual, actively-developed,
  ~29-collaborator `growtharc/arc_os` repo (5 open PRs and 4 live branches at
  the time of testing), a separate scratch repo,
  `ashwin-growtharc/arc_os-catalog-poc`, was created and hand-seeded with
  copies of the two real catalog files (`catalog/agents/code-reviewer.md`,
  `catalog/skills/engagement-kickoff/SKILL.md`, copied byte-for-byte as of
  2026-07-24) plus the two new DeliveryOS manifests.
- The full pull → edit → push → PR loop was proven end-to-end against
  **that scratch repo**, not the real one. The resulting PR
  ([arc_os-catalog-poc#1](https://github.com/ashwin-growtharc/arc_os-catalog-poc/pull/1))
  is real (real branch, real commit, real diff, real GitHub PR, immediately
  flipped to draft), but it's against a personal copy, not `arc_os` itself.

**Consequence:** the "respecting `arc_os`'s own review rules" half of the
exit criterion was not actually exercised — a personal repo has no
CODEOWNERS, no real reviewer pool, and no actual review happened. This phase
proves the *mechanism* works; it does not prove ArcOS's real review process
integrates cleanly with it. That's still open.

## Finding: the "2 reviewers for core" rule doesn't clearly apply here anyway

Independent of the fork/scratch-repo substitution above, ArcOS's own current,
*ratified* conventions (`docs/CONVENTIONS.md`, ADR-0001) define "core" as
`prompts/`, `evals/`, `runbooks/`, `docs/`, `mcp/`, `inventory.yaml` — not
`catalog/`. `inventory.yaml` itself tags every catalog-kind row (`skill`,
`agent`, `command`, `rule`) as `layer: shell`, not `layer: core`.
`code-reviewer` isn't in the inventory at all (`inventory_exempt: true`), so
it has no `layer` signal whatsoever. ADR-0004 (which would reclassify
`catalog/` as core) is still **Proposed**, not Accepted.

**Net effect:** neither `code-reviewer` nor `engagement-kickoff` is
unambiguously "core" under ArcOS's own current rules, so "confirm the 2
reviewer rule still applies" can't be verified as literally true or false —
it's an open governance question, not a DeliveryOS bug. Recommend: whoever
owns ADR-0004 (its own "Deciders" line) ratifies or rejects it before this
exit criterion can be called fully resolved.

Also worth noting: `arc_os` is a private repo on a plan where GitHub branch
protection can't be enabled at all (`403 Upgrade to GitHub Pro`), so today
the "2 reviewers" rule is purely a human/documented convention — nothing
technical currently enforces it, for *any* path in the repo, catalog or not.

## What broke / was harder than expected

1. **Manifest discovery is rigid to the entire-repo level, not a subfolder.**
   `deliveryos remote add` always clones a whole repo; there is no
   sparse/subdirectory registration concept. Registering "just `catalog/`"
   as PLAN.md's wording suggests isn't literally what happens — the whole
   `arc_os`-shaped repo gets cloned, and new `artifacts/<id>/manifest.yaml`
   files must live at the repo root, as siblings of `catalog/`, not nested
   inside it.

2. **Payload duplication would have been a bad outcome, so the engine
   needed one small addition.** DeliveryOS's original convention
   (`artifacts/<id>/payload/`) would have meant either restructuring ArcOS's
   real catalog or committing a second, driftable copy of each real file.
   Added an optional `payload_path` field to the manifest schema (a path
   relative to the remote root, pointing at the *real* existing file or
   directory) so `pull`/`push` read from and diff against the real location
   instead. Fully backward-compatible — every Phase 0/1 manifest without
   this field is unaffected. This was the one genuine engine change Phase 2
   needed; reviewed and QA'd on its own before being used here.

3. **DeliveryOS's manifest schema can't represent everything ArcOS's real
   frontmatter carries.** `tags.patterns` (e.g. `[pattern02]`,
   `[cross-pattern]`) and `tags.tools` (e.g. `[claude-code, opencode,
   codex]`) have no equivalent field in DeliveryOS's `tags: {roles, teams,
   stacks}` shape. `tags.teams` is required by DeliveryOS but ArcOS has no
   team-tagging axis to map from — left empty (`[]`), not fabricated.
   ArcOS's `maturity: alpha` state has no equivalent to DeliveryOS's
   `version` (ArcOS has no version concept at all) — resolved by seeding
   both assets at `1.0.0` as a DeliveryOS-side starting point, independent
   of ArcOS's own maturity state machine. None of this blocked the loop —
   the real frontmatter survives untouched in the real payload file itself
   — but it means DeliveryOS's own `list`/future-filtering can't yet see
   pattern/tool tags that ArcOS's own catalog already tracks. Not patched
   now, to avoid the kind-sprawl-adjacent trap of growing DeliveryOS's
   schema around one source's specific vocabulary (see ARCHITECTURE.md §9
   risk #1).

4. **No draft-PR support in the engine.** `push` always opens a fully
   visible, non-draft PR. For this test, drafted it manually right after
   (`gh pr ready <n> --undo`). If Phase 2/3 expects repeated real pushes
   against a real, watched repo, a `draft` option threaded through
   `openPullRequest`/`PushOptions` would be a small, same-shape addition —
   not done now since it wasn't required for a one-off POC push.

5. **Real, intermittent network/GitHub flakiness**, unrelated to DeliveryOS
   itself: DNS resolution to `github.com` failed intermittently during this
   session's testing, and GitHub's API returned one transient `500 Internal
   Server Error` on a branch push. Both resolved on retry. Not a DeliveryOS
   bug, but worth knowing `push` has no built-in retry logic of its own
   (consistent with ARCHITECTURE.md §9's explicit "no network retry/backoff"
   scope boundary for this phase) — a flaky network currently surfaces as a
   hard failure the user must retry by hand.

6. **Operator error, not a DeliveryOS bug, worth recording anyway:** while
   preparing this test, a shell script that was supposed to seed the
   separate scratch repo failed its `git clone` step (a transient DNS
   failure, see above) but didn't correctly abort — a subsequent `cd`
   silently failed too, and the rest of the script kept running *in the
   wrong directory*, committing and pushing scratch-repo content directly
   onto `delivery-os`'s own `main` branch on GitHub. Caught immediately,
   fixed with a follow-up correction commit (not a history rewrite, since it
   was already pushed/public) restoring the correct content. Lesson: any
   future scripted `cd` into a freshly-cloned directory should verify
   `pwd` equals the expected path before doing anything destructive — this
   is now standard practice for this kind of operation going forward.

## Go/no-go recommendation for Phase 3

**Conditional go**, with two things worth resolving first, neither of which
blocks starting Phase 3's spike work:

- The unresolved "is `catalog/` core or shell" governance question (ADR-0004)
  should get a real decision before DeliveryOS is used against the actual
  `arc_os` repo for real (as opposed to this scratch-repo proof).
- The full loop has now only been proven against a personal, unreviewed
  scratch repo. Before calling the MVP/POC *fully* done in the sense PLAN.md
  originally intended, it would be worth one real attempt against
  `growtharc/arc_os` itself — once there's a lower-risk way to do that (e.g.
  a maintainer explicitly enables forking, or grants a feature-branch
  workflow) — to see whether a real reviewer pool and real CODEOWNERS
  interact with a DeliveryOS-opened PR any differently than this proof did.

Everything else — the mechanical pull/edit/push/PR loop, manifest mapping
from real ArcOS frontmatter, and the `payload_path` design for pointing at
real files without duplicating them — worked as designed.

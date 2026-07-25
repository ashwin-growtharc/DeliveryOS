# Artifact retro: `launchpad-template` (first non-ArcOS source)

Follow-on to Phase 2 ([docs/phase-2-retro.md](phase-2-retro.md)) and the
`arcos-cli` artifact retro ([docs/artifact-arcos-cli-retro.md](artifact-arcos-cli-retro.md)):
`launchpad-template` is DeliveryOS's first real artifact sourced from a
project that has nothing to do with ArcOS at all — Launchpad's actual
Next.js/TypeScript "Hello World" starter kit, mirrored into a brand-new
scratch remote, `ashwin-growtharc/launchpad-template-poc`. This is the
independent, black-box verification of that artifact via the real, built
CLI, and a check on whether the engine actually is as payload-agnostic as
ARCHITECTURE.md claims.

## What was actually tested

Using a fresh scratch `DELIVERYOS_HOME` and a fresh scratch project cwd,
separate from both the `arcos-cli` scratch environment and any earlier
manual testing session:

1. `deliveryos remote add git@github.com:ashwin-growtharc/launchpad-template-poc.git --name launchpad-poc`
   — hit a transient failure on the first attempt (`ssh: Could not resolve
   hostname github.com: Name or service not known`), succeeded immediately
   on retry. This is the same class of intermittent DNS flakiness Phase 2's
   retro already documented as a known, non-DeliveryOS-bug risk of this
   environment — noted again here for completeness, not treated as a new
   finding.
2. `deliveryos list --json` — `launchpad-template` appears correctly:
   ```
   {"id":"launchpad-template","kind":"template","version":"1.0.0","remote":"launchpad-poc", ...}
   ```
   Manifest confirms `owner: launchpad`, `version: 1.0.0`,
   `payload_path: template`, `post_install: npm install`,
   `tags.stacks: [typescript, nextjs, any]`.
3. `deliveryos pull launchpad-template` — cloned the real 20 tracked files
   to `<cwd>/launchpad-template/`, ran `npm install` for real, updated the
   lockfile, exit 0.
4. Spot-checked real files landed: `launchpad-template/package.json`,
   `launchpad-template/app/page.tsx` — both present, along with the rest of
   the 20 tracked files (`.cursor/rules/brand.mdc`, `.env.example`,
   `.github/copilot-instructions.md`, `.github/workflows/deploy.yml`,
   `.gitignore`, `app/api/hello/route.ts`, `app/globals.css`,
   `app/layout.tsx`, `CLAUDE.md`, `guidelines/brand.md`,
   `guidelines/favicon.svg`, `guidelines/logo.svg`, `idea.md`, `lib/db.ts`,
   `next.config.js`, `public/favicon.svg`, `tailwind.config.ts`,
   `tsconfig.json` — verified by diffing the remote cache's file list
   against the pulled copy's file list directly, not by sampling).
5. `npm install` (the `post_install` command) completed with exit 0:
   `added 118 packages, and audited 119 packages in 57s`. `node_modules/`
   was confirmed present after the run. A `package-lock.json` was generated
   as a side effect of the install (not one of the 20 originally tracked
   files) — the pulled directory has 21 files outside `node_modules`/`.next`
   for that reason, which is expected `npm install` behavior, not a
   DeliveryOS discrepancy.
6. Lockfile (`.deliveryos/lock.json`) after pull:
   ```json
   { "version": 1, "entries": [ { "id": "launchpad-template", "version": "1.0.0", "remote": "launchpad-poc" } ] }
   ```
   Correct id, version, and remote.

## Does the engine need to bend for a non-Python, non-ArcOS project? No — confirmed.

The expectation going in was that nothing in DeliveryOS's manifest schema
or pull/push mechanics would need to change, since the engine is
intentionally payload-agnostic. **Confirmed, not just assumed:**

- The manifest schema's `kind` field (`src/engine/manifest/schema.ts`) is
  deliberately a plain, open-ended `z.string()`, not a closed enum — using
  `kind: template` for a Next.js starter kit (the same `kind` value used by
  `arcos-cli`, a Python whole-repo mirror) required no schema change,
  because the field was never coupled to ArcOS's vocabulary in the first
  place.
- `tags.stacks` already existed as a free-form string array from Phase 0
  specifically to carry runtime-stack information (`[typescript, nextjs,
  any]` here, vs. `[python, any]` for `arcos-cli`) — no new field needed.
- The `payload_path` mechanism (added in Phase 2 for ArcOS's `catalog/`)
  works identically here: `payload_path: template` points at Launchpad's
  real `template/` directory relative to the remote root, same convention,
  same code path — nothing ArcOS-specific was ever baked into it.
- `post_install` is executed as a completely generic shell command
  (`execSync(manifest.post_install, { cwd: installTarget, stdio: 'pipe' })`
  in `src/engine/pull/pull.ts`) with no language- or ecosystem-specific
  branching whatsoever. `pip install -e ".[dev]"` and `npm install` are
  just two different opaque strings to that same call.

**Net finding: the original expectation was correct.** Zero engine changes
were needed to onboard a completely different project type; see the
zero-diff confirmation below.

## `npm install` post_install result

Unlike `arcos-cli`'s Python/pip dependency (which required checking
Python/pip availability first), `npm` is unconditionally available in this
environment and the install was run for real with no gating. It succeeded
cleanly: exit 0, `node_modules/` created with 118 packages, no
`PostInstallError` surfaced. `npm audit` reports 2 known vulnerabilities (1
high, 1 critical) in the resulting `node_modules/` tree — this is a
property of Launchpad's pinned dependency versions (e.g. `next@14.2.18`),
not something DeliveryOS's pull/post_install mechanism introduced or could
reasonably filter; noted here for completeness only.

## Staleness risk: same as `arcos-mirror`, same caveat applies

`launchpad-template-poc`'s `template/` directory is a **manual, one-time
copy** of `C:\Users\AshwinB\Desktop\Launchpad\template\`'s 20 git-tracked
files as of this testing session — not a submodule, not fetched live, no
active sync. If Launchpad's real starter kit changes (a dependency bump, a
new guideline file, an updated `CLAUDE.md`), this scratch mirror will
silently drift out of date exactly the same way `arcos-mirror/` can. Same
recommendation as the `arcos-cli` retro: treat this as "Launchpad's template
as of 2026-07-24," not "Launchpad's template, live," until real drift
detection/sync exists (Phase 5, per PLAN.md).

## What was harder than expected

Nothing engine-side. The only friction was the transient DNS resolution
failure on `remote add`'s first attempt — an environment/network flake,
resolved by an immediate retry, consistent with the exact same class of
flakiness Phase 2's retro already flagged as a known, pre-existing risk
(no DeliveryOS-side retry/backoff logic exists yet, by design, per
ARCHITECTURE.md §9).

## Engine changes required: none

Zero `src/`/`test/` diffs were needed for this artifact either. `git
status` / `git diff --stat` on the engine directories are clean going into
and coming out of this verification — pure manifest + mirrored-content
addition on the remote side, proving the engine really is payload-agnostic
across two unrelated source ecosystems (Python/ArcOS and
TypeScript/Launchpad) with the exact same code paths.

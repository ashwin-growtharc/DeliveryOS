# Phase 3 UI: scope cut from the original mockup

`ui-mockup.html` (repo root) is a static "every scenario" showcase with 10
sections. PLAN.md's Phase 3 checklist names only "Browse / Pull / Push" as
this phase's target — auth, profiles, sync, and conflict resolution are
explicitly named in Phase 4/5 instead. This doc records, per section, what
got built for real vs. deliberately omitted, and why — so the cut is a
visible decision, not something buried in code.

| # | Mockup section | Verdict | Why |
|---|---|---|---|
| 1 | Onboarding (sign-in / profile / GitHub connect / sync) | **Omitted** | Sign-in and profile confirmation need Phase 4 auth (ARCHITECTURE.md §9 risk #9, explicitly deferred). GitHub auth is already handled ambiently via `gh auth token`, not a UI flow. The app opens straight to Browse. |
| 2 | Browse (search, kind chips, cards, 4 states) | **Built, simplified** | Real search/filter/cards from real `catalog.list`. Reduced to 3 honest states derivable from local data alone: `Not pulled` / `Pulled` / `Edited locally`. Dropped "Update available" (see #4). |
| 3 | Resource detail | **Built, simplified** | Description/meta/tags/install-path are real manifest fields. Version history section cut — the manifest/lockfile model has no history at all, only the current version; faking one entry would be worse than omitting it. |
| 4 | Sync banner ("N updates available") | **Omitted** | Requires comparing the lockfile version against the remote's genuinely current version, which needs a fresh `git fetch` per remote — a new capability, and exactly PLAN.md's own Phase 5 "drift detection" line item. Building it now would be the scope creep ARCHITECTURE.md §9 risk #1 warns against. |
| 5 | Conflict resolution | **Omitted** | ARCHITECTURE.md §9 risk #3: explicitly hand-waved, no design exists yet. "Keep mine / Take theirs / View diff" buttons with no real merge logic behind them would be a fake UI, not a simplified one. |
| 6 | Push flow (edit → push → PR preview → review → merged) | **Built, simplified** | Edit-locally and click-Push are real (`artifact.push`). "PR preview" became "PR result" — shown after the real PR opens, not before. "Owner reviews" / "Merged" are static explanatory text, not live status — DeliveryOS doesn't poll GitHub for PR state. |
| 7 | Add new (propose a brand-new resource) | **Built, simplified** | Real form → `artifact.push` with `isNew:true`. The drag-and-drop dropzone became a native file/folder picker (Tauri's dialog plugin) — more reliable in a webview. Roles are free-text, recorded but not filtered on (filtering is Phase 4). |
| 8 | Profile comparison | **Omitted** | Needs Phase 4 profiles entirely. |
| 9 | Settings (profile switcher + remotes) | **Built, simplified** | Dropped the profile switcher (Phase 4). Remotes list + "Add remote" are fully real (`remote.list`/`remote.add`). Dropped "Remove" — no `removeRemoteEntry` exists in the engine; no UI was built for a capability that isn't there. Shows the real `addedAt` timestamp, not a fabricated "synced N hours ago" (no sync-timestamp tracking exists). |
| 10 | Notification toasts | **Built, simplified** | Real toasts for pull success, push success (with the real PR link), and any sidecar error (verbatim engine message). Dropped "approved and merged" (needs PR-status polling) and "update available" (tied to the omitted sync banner). |

## One infra gap the mockup didn't anticipate

The lockfile and pristine snapshots are scoped to a working directory (like
`package-lock.json`), matching the CLI's "run inside a project folder"
model — but a desktop app has no natural cwd. The UI needed a **project
folder picker** (persisted in `localStorage`, re-validated on load) as
required infrastructure, not optional polish — without it, Browse can't show
accurate status and Pull/Push can't work at all.

## Architecture notes

- **No frontend framework** — plain HTML/CSS/JS. Four real screens didn't
  justify a build step or a dependency Tauri's static `frontendDist` doesn't
  currently expect.
- **One generalized Rust command** (`sidecar_call`, replacing the spike's
  hardcoded `run_list`) — every future sidecar command (Phase 4/5) needs zero
  new Rust code, just a new `command` string from the frontend.
- **Spawn-per-call, not a long-lived sidecar process** — every UI action
  pays the sidecar's cold-start cost (~108ms median, per
  [phase-3-spike-results.md](phase-3-spike-results.md)). Acceptable for
  discrete actions (Browse refresh, Pull, Push, Add remote); would need
  revisiting only if Phase 5's background auto-sync needs a persistent
  process.

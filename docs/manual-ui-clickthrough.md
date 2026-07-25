# Manual click-through runbook: DeliveryOS desktop app (Tauri UI)

No standard browser-automation-style tool exists for a native Tauri window
the way it does for web pages, so the Rust shell (`src-tauri/`) + spike UI
(`src-tauri/spike-ui/`) can't be exercised by an automated test the way
`test/e2e/sidecar.e2e.test.ts` exercises the sidecar's JSON protocol
directly -- there's no equivalent of `npm test` for clicking through the
actual window. This runbook is the human-followable substitute: it drives
the actual app, click by click, against a real GitHub remote.

(Note: ad hoc native-window automation -- Win32 API mouse/keyboard input
targeting the window by title, `System.Windows.Automation`'s accessibility
tree for element positions, `PrintWindow` for screenshots -- has been used
successfully in this environment for one-off verification and bug repro,
including reproducing a real click-order race condition. It's a real
capability worth knowing about, but it's manually scripted each time, not a
reusable, checked-in automated test suite -- this runbook remains the
canonical repeatable verification path.)

**Re-run this after any future change to `src-tauri/spike-ui/**` (HTML/CSS/JS)
or to the sidecar command surface (`src/sidecar.ts`'s `commands` map, request
args, or result shapes)** — those are exactly the two places a change could
silently break the UI without any automated test catching it, since
`sidecar.e2e.test.ts` only proves the sidecar's protocol is correct, not that
the UI calls it correctly or renders the result correctly.

## Prerequisites

1. `npm install` (repo root), then:
   ```
   npm run build
   npm run build:sidecar
   ```
   Confirm this produced `build/deliveryos-engine-x86_64-pc-windows-msvc.exe`
   — `tauri.conf.json`'s `bundle.externalBin` points at this exact path, and
   the app will fail to spawn the sidecar (every button will error) if it's
   missing or stale.
2. Rust toolchain + (Windows) MSVC Build Tools installed — see
   [REQUIREMENTS.md](../REQUIREMENTS.md#phase-3-tauri-desktop-app). Only
   needed once; the first `tauri dev`/`tauri build` compiles the Rust shell
   and can take a few minutes, later runs are fast.
3. `gh auth login` completed (`gh auth status` shows you logged in) — needed
   for the real-push steps below.
4. A throwaway scratch GitHub repo, seeded with one artifact so Browse has
   something real to show. Create a fresh one (recommended, so this runbook
   doesn't depend on state left over from other manual testing):
   ```
   gh repo create <you>/deliveryos-ui-smoke-test --private --clone
   cd deliveryos-ui-smoke-test
   mkdir -p artifacts/ui-smoke-artifact/payload
   cat > artifacts/ui-smoke-artifact/manifest.yaml <<'EOF'
   id: ui-smoke-artifact
   kind: doc
   description: Manual UI click-through smoke artifact
   owner: your-team
   version: 1.0.0
   tags:
     roles: []
     teams: []
     stacks: []
   source_repo: https://github.com/<you>/deliveryos-ui-smoke-test
   install_target: ui-smoke-artifact
   review_required: false
   EOF
   echo "# ui-smoke-artifact" > artifacts/ui-smoke-artifact/payload/README.md
   git add -A && git commit -m "seed ui smoke artifact"
   git push
   cd ..
   ```
5. A separate scratch **project folder** — this is where Pull will actually
   place files, distinct from the remote repo above:
   ```
   mkdir deliveryos-ui-project-scratch
   ```
6. Launch the app from the repo root:
   ```
   npx tauri dev
   ```
   (equivalently, `cargo tauri dev` if you have the `tauri-cli` cargo plugin
   installed instead). This runs against `src-tauri/spike-ui` directly, no
   frontend build step (it's a static HTML/CSS/JS page, no bundler). To test
   the actual packaged installer instead of dev mode, run `npx tauri build`
   once and launch the produced `src-tauri/target/release/deliveryos.exe`
   (or the MSI/NSIS installer under `src-tauri/target/release/bundle/`).

Every button in the app disables itself and shows "Working..." while its
sidecar call is in flight (each call spawns a fresh sidecar process) — wait
for that to clear before checking the result.

## Part 1: Settings — remotes list

1. Click **Settings** in the top nav.
2. On a fresh `DELIVERYOS_HOME` (i.e. you haven't run the CLI or this app on
   this machine before, or you've cleared `~/.deliveryos`), confirm the
   "Remotes" card shows **"No remotes registered yet."** — not a crash, not a
   stuck "Loading…" spinner.
3. In the "Add remote" form, enter the scratch repo's clone URL (e.g.
   `https://github.com/<you>/deliveryos-ui-smoke-test.git`), leave "Name"
   blank, click **Add remote**.
4. Confirm:
   - A green success toast appears, reading something like
     `Added remote "deliveryos-ui-smoke-test" (https://github.com/<you>/deliveryos-ui-smoke-test.git)`
     (the name was derived from the URL since "Name" was left blank).
   - The "Remotes" card now lists that remote (name, URL, "added <ISO
     timestamp>"), replacing the "No remotes registered yet." message.
   - The form clears itself (both fields empty) after success.

## Part 2: Change project folder + restart persistence

1. In the top bar, click **Change folder**. The native OS folder picker
   opens (this is `tauri-plugin-dialog`, a real system dialog — confirm it
   actually looks native, not an in-page fake).
2. Select the `deliveryos-ui-project-scratch` folder created above.
3. Confirm the top bar's "Project" field now shows that folder's full path
   (not "No folder selected"), and Browse loads (see Part 3).
4. **Restart check:** close the app window entirely, then relaunch it
   (`npx tauri dev` again, or reopen the packaged exe). Confirm the same
   folder path is shown immediately on launch, with **no folder-picker
   prompt** — the app should go straight to Browse with that folder already
   selected. (This works via `localStorage` under the key
   `deliveryos.projectDir`, which the WebView2 profile persists across
   restarts — if this fails, the most likely cause is `initialize()` in
   `app.js` not reading it back, or the stored path no longer resolving.)

## Part 3: Browse

1. With the project folder selected, click **Browse** (or it's already
   there after Part 2).
2. Confirm a real card appears for `ui-smoke-artifact`: kind badge "doc",
   name "ui-smoke-artifact", the description text from the manifest, "v1.0.0
   · your-team" in the footer row, and a status badge reading **"Not
   pulled"**.
3. Type into the **"Search resources"** box:
   - A substring of the id (e.g. `ui-smoke`) — confirm the card still shows.
   - Something that matches nothing (e.g. `zzz-nonexistent`) — confirm the
     grid empties and **"No artifacts match."** appears.
   - Clear the search box — confirm the card reappears.
4. Confirm the kind filter chips above the grid include an **"All"** chip
   (active by default) plus one chip per distinct kind present (here just
   "doc"). Click the "doc" chip — card stays visible; click "All" — still
   visible (sanity that filtering doesn't accidentally hide everything).
5. Click **Refresh** — confirm it re-runs `catalog.list` (a "Working..."
   flash on the button) and the card/badge are unchanged.

## Part 4: Pull

1. Click the **Pull** button on the `ui-smoke-artifact` card (or open the
   card first — clicking anywhere else on the card opens the Detail view,
   which has its own Pull button and the same badge/meta fields).
2. Confirm a success toast reading `Pulled ui-smoke-artifact`.
3. Confirm the card's badge flips from "Not pulled" to **"Pulled"**, and its
   action button disappears (nothing to do while status is "pulled").
4. Outside the app, confirm the files actually landed:
   ```
   type deliveryos-ui-project-scratch\ui-smoke-artifact\README.md
   ```
   (or `cat` on macOS/Linux) — should show the seeded content.

## Part 5: Edit + Push

1. Outside the app, in a text editor, edit
   `deliveryos-ui-project-scratch\ui-smoke-artifact\README.md` — add a line,
   save.
2. Back in the app, click **Refresh** on the Browse toolbar (or navigate
   away and back to Browse, which reloads the catalog).
3. Confirm the card's badge flips to **"Edited locally"**, and its action
   button now reads **Push**.
4. Click **Push**. Confirm:
   - A success toast reading something like
     `Pushed ui-smoke-artifact: opened PR #<n> (https://github.com/<you>/deliveryos-ui-smoke-test/pull/<n>)`.
   - Open the printed URL in a browser: confirm a real PR exists, titled
     `[DeliveryOS] Update ui-smoke-artifact (v1.0.0)`, whose diff shows
     exactly your edit under `artifacts/ui-smoke-artifact/payload/README.md`.
   - Back in the app, the card's badge returns to **"Pulled"** (the fresh
     `catalog.list` after push diffs against the same pristine snapshot,
     which the push didn't change).
5. Cleanup (courtesy, not required): close the PR and delete the
   `deliveryos/ui-smoke-artifact/...` branch.

## Part 6: Add-new

1. Click **+ Add new** on the Browse toolbar.
2. Fill in the form:
   - Artifact ID: `ui-addnew-smoke`
   - Kind: `doc`
   - Payload: click **Choose file…** or **Choose folder…** and pick some
     small local file/folder (e.g. create a scratch file with a line of
     text first).
   - Description: any text.
   - Owner: any text.
   - Roles: leave blank or `pm, eng`.
   - Remote: confirm the dropdown lists `deliveryos-ui-smoke-test` (from
     `remote.list`), select it.
3. Click **Propose**.
4. Confirm a success toast (`Proposed ui-addnew-smoke: opened PR #<n> ...`),
   the form resets, and the view returns to Browse.
5. Open the printed PR URL: confirm a real PR exists, titled
   `[DeliveryOS] Propose new artifact: ui-addnew-smoke`, with new files
   `artifacts/ui-addnew-smoke/manifest.yaml` and
   `artifacts/ui-addnew-smoke/payload/...` in the diff — nothing else
   changed.
6. Cleanup (courtesy): close the PR and delete the
   `deliveryos/ui-addnew-smoke/...` branch.

## Part 7: Error cases

1. **Garbage remote URL.** In Settings, submit the "Add remote" form with a
   URL that isn't a real git repo (e.g. `not-a-real-url`). Confirm:
   - A clear **red error toast** appears (not a silent no-op, not an
     unhandled-exception dialog, not an app crash) — the message should be
     the real underlying git error (`GitOperationError`'s message,
     surfaced verbatim), not a generic "something went wrong."
   - The "Remotes" list is unchanged (nothing partially added).
2. **Duplicate remote name.** Submit "Add remote" again with a URL/name that
   matches an already-registered remote (e.g. re-submit the
   `deliveryos-ui-smoke-test` URL from Part 1 with no name, so it derives
   the same name again). Confirm:
   - A clear red error toast, containing wording like `A remote named
     "deliveryos-ui-smoke-test" is already registered`.
   - The "Remotes" list still shows exactly **one** entry for that name —
     not duplicated, not corrupted.

## Note

This runbook exists because there is no GUI automation tool available in
this environment for testing a native Tauri window — it substitutes for
automated UI testing, which `test/e2e/sidecar.e2e.test.ts` deliberately
cannot cover (that suite proves the sidecar's stdin/stdout protocol is
correct in isolation, not that the UI's HTML/JS wiring calls it correctly or
renders its results correctly). **Re-run this by hand after any change to
`src-tauri/spike-ui/**` or to the sidecar's command surface
(`src/sidecar.ts`)**, since nothing in the automated suite would catch a
regression in that layer.

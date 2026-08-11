# Manual smoke test: CLI auto-install onto PATH

`scripts/build-cli.mjs` and the NSIS install hook
(`src-tauri/nsis/path-hook.nsh`) that adds `deliveryos.exe` to the current
user's PATH were written and hand-traced for correctness, but **neither
has been run through a real build** — the Rust/Tauri toolchain this
needs wasn't reachable in the environment they were written in. This is
the real verification that step still needs, not a formality. Run it
once after any change that touches `scripts/build-cli.mjs`,
`src-tauri/nsis/path-hook.nsh`, or the `bundle.resources`/
`bundle.windows.nsis` entries in `src-tauri/tauri.conf.json`.

## Prerequisites

- `npm install` done.
- The Rust/Tauri toolchain working locally (`cargo --version` succeeds;
  `npx tauri dev` already launches the app today).
- Ideally: a second, less PATH-cluttered machine or VM to repeat Part 3
  on — a dev machine with dozens of tools already on PATH can mask both
  a duplicate-detection bug and a genuinely-missing-entry bug equally
  easily.

## Part 1: the CLI exe itself, standalone

1. Build it:
   ```
   npm run build
   npm run build:cli
   ```
2. Confirm it's genuinely self-contained — copy just the one file to a
   bare scratch directory with no `node_modules`/`package.json` nearby,
   and run it from there directly by full path:
   ```
   copy build\deliveryos-cli.exe C:\scratch\deliveryos.exe
   C:\scratch\deliveryos.exe --version
   C:\scratch\deliveryos.exe list --json --remote <a-real-registered-remote>
   ```
   Both should work with no `node`/`node_modules` present at all. If
   `list` fails, that's a real bundling bug (something the CLI needs
   didn't get pulled into the SEA blob) — fix it before moving on to the
   installer parts below, since Part 2/3 would just reproduce the same
   failure through more steps.

## Part 2: the full build

1. Set the updater signing key env var (see `docs/release-process.md`
   step 1) — `tauri build` will fail without it.
2. Build everything in the order `docs/release-process.md` now documents:
   ```
   npm run build
   npm run build:sidecar
   npm run build:cli
   cd src-tauri
   npx tauri build
   ```
3. Confirm this actually succeeds. A typo'd `.nsh` path/macro name in
   `tauri.conf.json`, or a real NSIS syntax error in `path-hook.nsh`,
   only surfaces here — this is the first point either can be checked at
   all.
4. Before writing/trusting anything below, find out where the
   `deliveryos.exe` resource actually landed relative to `$INSTDIR` —
   `path-hook.nsh`'s own `DeliveryOsResolveCliDir` macro checks two
   possible locations defensively for exactly this reason (the real
   layout couldn't be confirmed without this build). Install the NSIS
   output from step 2, then check both:
   ```
   dir "%LOCALAPPDATA%\...\DeliveryOS\deliveryos.exe"
   dir "%LOCALAPPDATA%\...\DeliveryOS\resources\deliveryos.exe"
   ```
   (adjust the base path to wherever the installer actually put it —
   `currentUser` mode installs under the user's own profile, not
   `Program Files`). Whichever one is real, the macro should have found
   it; if neither exists, or the file's somewhere else entirely, that's
   a real bug in the resource-path assumption to fix.

## Part 3: the actual PATH behavior — the part that matters most

1. **Before installing**, open a terminal and run `deliveryos --version`
   — confirm it genuinely fails (`command not found` / not recognized),
   so the "after" check below is a real before/after, not a no-op.
2. Note your current `PATH` value for comparison later:
   ```
   echo %PATH% > C:\scratch\path-before.txt
   ```
3. Run the real NSIS installer produced in Part 2.
4. **Open a brand-new terminal window** — not the one the installer ran
   from, and not one that was already open before the install. This is
   the single most important step: `WM_WININICHANGE`/`WM_SETTINGCHANGE`
   only notifies already-running processes that something changed, it
   does not retroactively rewrite an already-running shell's own
   inherited environment block. Testing in the wrong terminal will look
   broken even if the install actually worked, or look like it worked
   when it didn't — this is the real, common false-positive/negative to
   avoid.
5. In that new terminal: `deliveryos --version` should now work.
6. Diff PATH before/after:
   ```
   echo %PATH% > C:\scratch\path-after.txt
   fc C:\scratch\path-before.txt C:\scratch\path-after.txt
   ```
   Confirm the only difference is the one new DeliveryOS directory
   appended — nothing else changed, nothing duplicated.
7. Run the installer a **second time** (repair/reinstall over the
   existing install) and repeat steps 4-6 — confirm the entry does not
   get duplicated (the hook's `${StrStr}` presence check should make
   this a no-op the second time).
8. Uninstall. Open **another** brand-new terminal and confirm
   `deliveryos --version` now fails again, and that `PATH` (checked the
   same diff way) is back to exactly its pre-install value.

## Part 4 (if you have time): the length-guard edge case

The install hook refuses to write PATH at all, and shows a message box
instead, if the existing value is already within ~120 characters of
NSIS's own (unverified-from-here) string-length limit — this is a real
safety check that's never been exercised. To test it for real:

1. Temporarily pad your user PATH with junk entries until it's close to
   1000 characters (`setx PATH "%PATH%;C:\some\very\long\padding\path..."`
   a few times, or edit it directly via System Properties).
2. Run the installer and confirm you see the message box instead of a
   silent failure, and that PATH afterward is byte-for-byte unchanged
   from before this test (the whole point of the guard).
3. Restore your real PATH afterward — don't leave the padding in place.

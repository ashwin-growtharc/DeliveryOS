# Release process (manual)

There is no CI/GitHub-Actions automation for DeliveryOS yet — this is a
deliberate scope boundary, not an oversight. Every release is built and
published by hand, from the builder's own machine, following the steps
below. Automating this (a GitHub Actions workflow that builds, signs, and
publishes on tag push) is a reasonable next step once releases stop being
solo-developer-local, but it is out of scope for now.

This process exists because auto-update (see PLAN.md's Phase 3 checklist) is
wired up: the app checks `tauri.conf.json`'s `plugins.updater.endpoints` for a
`latest.json`, verifies its signature against the public key embedded in
`tauri.conf.json`, and — if a newer version is found — downloads and installs
it. Every step below exists to produce and publish exactly what that check
expects.

## 1. Set the signing key env vars

The updater signs and verifies every update artifact with a minisign keypair.
The private key already exists at `~/.tauri/deliveryos.key` (generated via
`tauri signer generate --ci`) and must **never** be committed to this repo —
`.gitignore` has a defensive `*.key`/`*.key.pub` entry as a belt-and-suspenders
safety net, but the key's real home is outside the repo entirely.

Before running `tauri build`, set:

- `TAURI_SIGNING_PRIVATE_KEY_PATH` = `~/.tauri/deliveryos.key` — **or**,
  instead of a path, `TAURI_SIGNING_PRIVATE_KEY` set to the key file's raw
  string contents directly. Either one works; only set one of the two.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — only needed if the key was generated
  with a password. The key currently in use was generated **without** one
  (`tauri signer generate --ci` skips the password prompt), so this can be
  left unset for now.

  Adding a password to the key later is a reasonable security improvement
  once this process is anything more than solo-developer-local — an
  unencrypted private key sitting on disk is fine for a single builder's own
  machine, less fine the moment more people or machines are involved in
  cutting releases.

PowerShell example:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = "$HOME\.tauri\deliveryos.key"
```

## 2. Bump the version

Edit `version` in `src-tauri/tauri.conf.json` (e.g. `"0.1.0"` →
`"0.2.0"`). This becomes both the installer's version and the version string
the updater compares against.

## 3. Build

```
npm run build
npm run build:sidecar
npm run build:cli
cd src-tauri
npx tauri build
```

The first three steps are a real precondition `tauri.conf.json` already
silently depends on, not optional housekeeping: `bundle.externalBin`
needs `build/deliveryos-engine-*.exe` (from `build:sidecar`),
`bundle.resources` needs `build/esbuild.exe` (also `build:sidecar`) and
`build/deliveryos-cli.exe` (`build:cli`), and both of those build scripts
assume `npm run build` (tsc) has already produced `dist/`. Skipping any
of the three leaves `tauri build` either failing outright or — worse —
succeeding with a stale binary silently baked into the installer.

Because `bundle.createUpdaterArtifacts: true` is set in `tauri.conf.json`,
this produces not just the installer but a matching detached signature file
alongside it, under:

```
src-tauri/target/release/bundle/msi/*.msi(.sig)
src-tauri/target/release/bundle/nsis/*.exe(.sig)
```

That is where a plain `npx tauri build` (the command in step 2) puts them.
Passing `--target x86_64-pc-windows-msvc` instead writes to
`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/`. Both directories
can exist on the same machine from different builds, so confirm the version
in the filename is the one you just cut before publishing it — a stale
installer from the other path is indistinguishable at a glance.

**Publish the NSIS `.exe`, not the MSI.** Both used to "just work" equally
with the updater, but that's no longer true now that the `deliveryos` CLI
gets installed onto PATH automatically (`src-tauri/nsis/path-hook.nsh`,
via `bundle.windows.nsis.installerHooks`) — that mechanism is NSIS-only.
Someone who installs via the MSI today gets the app but not the CLI on
PATH, with no error telling them so. WiX has its own equivalent
(`bundle.windows.wix.fragmentPaths` + a `<Environment>` element) but
that's real, separate follow-up work, not built yet — until it is, NSIS
is the only installer format that sets up the CLI.

## 4. Hand-write `latest.json`

The updater endpoint (`plugins.updater.endpoints` in `tauri.conf.json`)
expects a `latest.json` shaped like this:

```json
{
  "version": "0.2.0",
  "notes": "What changed in this release.",
  "pub_date": "2026-07-26T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of the .sig file, verbatim>",
      "url": "https://github.com/ashwin-growtharc/DeliveryOS/releases/download/v0.2.0/deliveryos_0.2.0_x64-setup.exe"
    }
  }
}
```

- `version` — must match the version just bumped in step 2 (no leading `v`).
- `notes` — freeform, shown nowhere in the current UI (the app doesn't
  surface release notes), but keep it meaningful for humans reading the
  release page.
- `pub_date` — RFC 3339 timestamp.
- `platforms.windows-x86_64.signature` — the **entire contents** of the
  `.sig` file produced in step 3, pasted in as-is (it's already a single
  base64-ish line).
- `platforms.windows-x86_64.url` — the direct GitHub Release download URL
  for the installer uploaded in step 5. Must point at the same asset
  filename being uploaded.

## 5. Publish the GitHub Release

```
gh release create v0.2.0 <installer> <installer>.sig latest.json \
  --title "v0.2.0" --notes "What changed in this release."
```

This is the step where the tag/filenames matter for real: `tauri.conf.json`'s
configured endpoint is:

```
https://github.com/ashwin-growtharc/DeliveryOS/releases/latest/download/latest.json
```

`releases/latest/download/<asset>` always resolves to whatever the most
recent published release's asset of that exact name is — so `latest.json`
must be uploaded as an asset named exactly `latest.json` on every release,
and the release itself must be the repo's actual latest (don't mark it a
draft or a pre-release, and don't publish an older version after a newer one
— GitHub's "latest" is the most recently published non-prerelease release,
not the highest semver).

## 6. Verify

There is no automated check that a real release's `latest.json` is correct.
The expectation is one manual confirmation at actual release time: after
publishing, launch a build running the *previous* version and click "Check
for updates" in Settings, and confirm it finds the new version, downloads,
installs, and relaunches cleanly. (During development of the auto-update
wiring itself, this was verified against a local fake `latest.json` server
instead of a real release — see the note in PLAN.md's Phase 3 checklist.
That local test proves the check/compare/download machinery works; it does
not replace verifying a real published release at least once.)

## Scope note

No CI/GitHub Actions automation exists for any of the above. Every release
is built, signed, and published by hand from the builder's own machine. This
is deliberate for the project's current solo-developer stage, not a gap
waiting to be filled incidentally — automating it is a real (but currently
out of scope) future task.

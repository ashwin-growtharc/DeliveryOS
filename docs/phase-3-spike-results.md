# Phase 3 spike: Tauri sidecar packaging — results

Per PLAN.md's Phase 3 first checklist item: "package the TypeScript engine as
a Tauri sidecar process; confirm size and startup latency are acceptable
*before* committing further." This is that spike's write-up. Windows-only,
per the current "Windows for now" scope decision — see
[REQUIREMENTS.md](../REQUIREMENTS.md) for what a Mac build needs later.

## What was built

- `src/sidecar.ts` — a thin newline-delimited-JSON dispatcher over stdin/stdout, wrapping the *existing* engine functions directly (only `catalog.list` implemented for the spike). Never touches `src/cli/**` (which prints directly to stdout and would corrupt the JSON stream).
- Packaged via Node's built-in Single Executable Application (SEA) feature — `scripts/build-sidecar.mjs` bundles it with esbuild and injects it into a copy of `node.exe`, producing a genuinely standalone executable (confirmed to run with Node stripped from `PATH`).
- A minimal Tauri v2 shell (`src-tauri/`) with a one-button spike UI (`src-tauri/spike-ui/`) that spawns the sidecar via `tauri-plugin-shell`, sends one request, and displays the JSON response.
- Real MSI and NSIS installers built via `cargo tauri build`.

None of this touches `src/cli/`, `src/engine/`, or `test/` — confirmed additive-only, and all 54 existing tests pass unchanged throughout.

## Measured results

| Metric | Result | Threshold band |
|---|---|---|
| Sidecar binary size | 92,187,136 bytes (87.92 MiB / 92.19 MB) | **Green** (< 100 MB) |
| MSI installer | 37.78 MB | **Green** (< 120 MB) |
| NSIS installer | 25.44 MB | **Green** (< 120 MB) |
| Cold-start latency (spawn → first response) | Initial sample (n=12): 103.4–145.1ms, median 107.8ms. Independent QA re-test (n=5, full app launch): 108.7–**391.2ms**, 40% landing in the 200–500ms band | **Green on the median, yellow-band tail** |

The size numbers are unambiguous and were independently re-verified byte-for-byte. Sidecar-only spawn latency (bypassing the Tauri window entirely) is consistently fast (85–148ms across independent re-tests). The variance shows up specifically in full `app.exe` launches — likely WebView2 initialization, first-run disk/cache state, or antivirus scanning of a freshly-written executable — not in the sidecar itself.

## Honest framing, not a clean green light on latency

An earlier pass reported a tightly-clustered 12-sample dataset (spread of only 42ms) as evidence latency was solidly green. Independent QA re-testing found this understated real variance — a 391ms outlier and a 40% yellow-band rate in a small re-test sample. This isn't a fabrication (the original log file is real and matches what was reported), just an unrepresentative sample size for a metric with this much run-to-run variance. Even the worst case measured (391ms) is still well short of the 500ms red line, so this doesn't block proceeding — but treat "cold start is fine" as "fine on the median, worth monitoring," not "settled."

## Recommendation: proceed to the rest of Phase 3, with two follow-ups

1. **Proceed** with the Rust shell + real UI wiring (against `ui-mockup.html`'s structure and the ArcFlow brand guidelines the user pointed to), packaged installer, and auto-update work — nothing here blocks that.
2. **Before calling latency fully settled**, collect a larger sample (n=30+) of full cold app launches, spaced out to avoid disk-cache bias, and investigate what's actually driving the outliers (WebView2 init variance vs. AV scanning vs. first-paint cost) — worth doing once the real UI exists anyway, since that's a more representative launch path than the one-button spike.
3. **Known latent bug to fix before wiring `pull` into the sidecar for real**: `pullArtifact`'s `post_install` step uses `stdio: 'inherit'`, which would corrupt the sidecar's NDJSON stream if a manifest with `post_install` is ever pulled through the app. Needs `stdio: 'pipe'` before the real Pull UI is wired up — not needed for this spike (only `catalog.list` was exercised), but noted here so it isn't rediscovered the hard way.

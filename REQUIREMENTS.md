# Requirements

Two very different lists depending on what you're doing. Find your row:

| You are… | Read |
|---|---|
| Given the installer and want to run the app | [Running the desktop app](#running-the-desktop-app) |
| Using the `deliveryos` CLI | [Running the CLI](#running-the-cli) |
| Building DeliveryOS from source | [Building from source](#building-from-source) |

**You do not need Rust, MSVC or Node to *run* DeliveryOS.** Those are build
tools — Rust compiles to a native binary, and both shipped executables embed
their own Node runtime. They appear only under "Building from source".

---

## Running the desktop app

You were handed an installer. Almost nothing is required.

| Requirement | Notes |
|---|---|
| **Windows 10/11** | The NSIS installer runs per-user — **no administrator rights needed**. |
| **WebView2** | Handled for you. The installer silently downloads it if missing (needs an internet connection during install). Already present on Windows 11 and recent Windows 10. |
| **git** | **The one thing you must install yourself.** Every remote operation shells out to it — without git there is no catalog, and nothing can be pulled or pushed. |

Optional, only for specific features:

| Requirement | Unlocks | Without it |
|---|---|---|
| **`gh`**, authenticated (`gh auth login`, `repo` scope) | Proposing changes back as a PR | Browse, pull, remove and update all still work. Only `push` fails. |
| **`claude`**, authenticated | Every AI feature: "Suggest with Claude", the build-fix flow, wiring merge suggestions, Wire with Claude — and the two published skills, which *are* Claude skills | The rest of the app is unaffected. |

**Getting the CLI too:** install the **NSIS `.exe`**, not the `.msi`. The `.exe`
puts `deliveryos` on your PATH automatically; the MSI installs the app but
silently leaves you without the CLI. (The PATH hook has not yet been verified
against a real build — see `docs/manual-smoke-test-cli-install.md`.)

**One thing the packaged app can never do:** generate `preview.png` when
pushing a UI component. Node SEA cannot load `playwright-core` in any form.
Push still succeeds, just without the image. The CLI run from source can do it.

## Running the CLI

The shipped `deliveryos.exe` is self-contained — **it does not need Node**.
Requirements are the same as above: `git` always, `gh` for `push`, `claude` for
AI features.

One extra, worth knowing because it isn't about DeliveryOS at all: an
artifact's own `post_install` may need whatever tooling *that artifact* uses —
usually `npm`. A missing tool is reported as a warning, never a hard failure.

| Requirement | Notes |
|---|---|
| Microsoft Edge or Chrome | Only for generating `preview.png` when pushing a `ui-component`. Uses an already-installed browser rather than downloading one. Edge ships with Windows. Degrades gracefully: no image, push still succeeds. |

## Building from source

Everything below is build-time only. None of it is needed by anyone you give
the installer to.

### The engine and CLI

| Requirement | Version | Why |
|---|---|---|
| Node.js | >= 22.12.0 | The build toolchain, and the minimum for `@octokit/rest` (ESM-only) to load via native `require(esm)` under this project's CommonJS build — see `package.json`'s `engines`. |
| npm | bundled with Node | Installs dependencies. |

```
npm install
npm run build
npm link          # puts `deliveryos` on your PATH
```

Verify with `npm run typecheck && npm run lint && npm test`.

### The desktop app

| Requirement | Notes |
|---|---|
| Rust toolchain (`rustup`, `rustc`, `cargo`) | Tauri's native shell is Rust. `winget install Rustlang.Rustup` on Windows, or rustup.rs elsewhere. |
| **Windows:** MSVC C++ Build Tools | Tauri links against MSVC (`link.exe`), not MinGW. `winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools"`, or the "Desktop development with C++" workload. Multi-GB download. |
| **macOS:** Xcode Command Line Tools | `xcode-select --install`. Needed for WKWebView and linking. |
| Tauri CLI | Already a devDependency (`@tauri-apps/cli`) — `npm install` gets it. |

```
npm run build && npm run build:sidecar
cd src-tauri && npx tauri dev
```

**A Mac build cannot be produced from Windows, or vice versa** — Tauri compiles
against the real OS toolchain. The same source builds on any platform; getting
a macOS binary needs a real Mac or a macOS CI runner.

**Code signing** is not set up. Needed before distributing a real installer: a
Windows code-signing certificate, and an Apple Developer ID plus notarization
credentials for macOS. Tracked in ARCHITECTURE.md §9 risk #7.

## When something fails

| What you see | What's missing | Fix |
|---|---|---|
| `git` errors on `remote add`, or an empty catalog | git | Install git and reopen your terminal |
| `Failed to get a GitHub token via "gh auth token"` on `push` | `gh`, or it isn't authenticated | `gh auth login` — needs `repo` scope |
| "Suggest with Claude" / build-fix / Wire with Claude fail | `claude` not on PATH or not authenticated | Install Claude Code and sign in |
| `deliveryos: command not found` after installing the app | You installed the `.msi` | Install the NSIS `.exe` instead, or add the install directory to PATH by hand |
| `deliveryos: command not found` after building from source | `npm link` not run | `npm link`, or use `node dist/index.js <command>` |
| Push succeeds but the PR has no preview image | No Chrome/Edge, or you used the packaged app | Expected. The packaged app can never render previews; use the CLI from source if you need one |
| An artifact's `post_install` fails with a missing tool | That artifact's own tooling (usually `npm`) | Install what the artifact needs; DeliveryOS itself is fine |
| One artifact missing, others fine | That manifest failed validation | `deliveryos list` prints skipped manifests and the reason to stderr |

See [README.md](README.md) for usage and [docs/skills.md](docs/skills.md) for
the Claude Code skills.

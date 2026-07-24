# Requirements

Everything needed on a machine to build and run DeliveryOS, kept current as
new phases add new prerequisites. See [README.md](README.md) for usage once
these are installed.

## Core (Phases 0-2 — CLI engine)

| Requirement | Version | Why |
|---|---|---|
| Node.js | >= 22.12.0 | Runtime; also the minimum needed for `@octokit/rest` (ESM-only) to load via native `require(esm)` under this project's CommonJS build — see `package.json`'s `engines` field. |
| npm | bundled with Node | Installs `package.json` dependencies. |
| git | any recent version | `remote add`/`pull`/`push` shell out to it via `simple-git`. |
| GitHub CLI (`gh`) | any recent version, **authenticated** (`gh auth login`) | `push` gets a GitHub token via `gh auth token` to open PRs. Needs `repo` scope at minimum. |

Install: `npm install` at the repo root. Verify: `npm run typecheck && npm run lint && npm test`.

## Phase 3+ (Tauri desktop app)

| Requirement | Notes |
|---|---|
| Rust toolchain (`rustup`, `rustc`, `cargo`) | Installed via `winget install Rustlang.Rustup` on Windows, or `rustup.rs`'s installer elsewhere. Tauri's native shell is Rust. |
| **Windows only:** MSVC C++ Build Tools | Tauri on Windows links against MSVC (`link.exe`), not MinGW. Install via `winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools"`, or the Visual Studio Installer's "Desktop development with C++" workload. Large (multi-GB) download. |
| **Windows only:** WebView2 Runtime | Tauri's webview on Windows. Ships with Windows 11 and recent Windows 10 by default; only needs manual install on older/stripped-down Windows images. |
| **macOS only:** Xcode Command Line Tools | `xcode-select --install`. Needed for Tauri's macOS build (WKWebView, linking). |
| Tauri CLI | Added as a dev dependency once Phase 3 scaffolding starts (`@tauri-apps/cli`); not yet added as of Phase 2. |

**Cross-platform note:** a Mac build cannot be produced from a Windows
machine (or vice versa) — Tauri needs to compile against the real OS
toolchain. The same source should build on any platform with zero code
changes once it's written in a portable way; getting an actual macOS binary
requires running the build on a real Mac or a macOS CI runner (e.g. GitHub
Actions' `macos-latest`), not local cross-compilation.

**Code signing** (needed before a real installer can be distributed, not for
local dev/testing): a Windows code-signing certificate, and an Apple
Developer ID + notarization credentials for macOS. Neither is set up yet;
tracked as Phase 3 scope (ARCHITECTURE.md §9 risk #7).

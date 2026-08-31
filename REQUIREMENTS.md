# Requirements

**Short version: you need `git`. Everything else is optional or already handled.**

You do **not** need Rust, MSVC or Node to *run* DeliveryOS. Those are build
tools — they only appear under [Building from source](#building-from-source).

Find your row:

| You are… | Go to |
|---|---|
| Given the installer, want to run the app | [Running the desktop app](#running-the-desktop-app) |
| Using the `deliveryos` CLI | [Running the CLI](#running-the-cli) |
| Building DeliveryOS from source | [Building from source](#building-from-source) |

---

## Step 1 — Check what you already have

Paste this into a terminal. Anything that errors is something you don't have yet.

```
git --version       # required — nothing works without it
gh --version        # only for `push`
claude --version    # only for the AI features
node --version      # only if building from source (need 22.12+)
```

## Step 2 — Install what's missing

| Tool | Windows | macOS | Linux |
|---|---|---|---|
| **git** | `winget install Git.Git` | `brew install git` | `sudo apt install git` |
| **gh** | `winget install GitHub.cli` | `brew install gh` | `sudo apt install gh` |
| **claude** | `npm install -g @anthropic-ai/claude-code` | same | same |
| **Node 22.12+** | `winget install OpenJS.NodeJS` | `brew install node` | [nodejs.org](https://nodejs.org) |

Then sign in to the two that need it:

```
gh auth login       # choose GitHub.com, and grant the `repo` scope
claude              # sign in on first run
```

> **Reopen your terminal after installing anything.** A new tool won't be on
> your PATH in a window that was already open. This is the single most common
> "I installed it and it still says not found".

---

## Running the desktop app

You were handed an installer. Almost nothing is required.

| Requirement | What you need to do |
|---|---|
| **Windows 10/11** | Nothing. The installer runs per-user — **no admin rights needed**. |
| **WebView2** | Nothing. The installer downloads it if missing (needs internet during install). Already present on Windows 11 and recent Windows 10. |
| **git** | **The one thing you must install yourself.** See Step 2 above. |

Optional, each unlocking one thing:

| Install | Unlocks | Without it |
|---|---|---|
| `gh` + `gh auth login` | Proposing changes back as a pull request | Browse, pull, remove and update all still work — only `push` fails |
| `claude` + sign-in | All AI features: Suggest with Claude, build-fix, wiring merge, Wire with Claude | Everything else is unaffected |

**Want the CLI too?** Install the **NSIS `.exe`**, not the `.msi`. The `.exe`
puts `deliveryos` on your PATH automatically; the `.msi` installs the app and
silently leaves you without the CLI.

> The PATH step compiles but its runtime behaviour hasn't been verified on a
> clean machine yet — see `docs/manual-smoke-test-cli-install.md`.

**One thing the packaged app can never do:** generate `preview.png` when
pushing a UI component. Push still succeeds, just without the image. The CLI
run from source can do it.

---

## Running the CLI

The shipped `deliveryos.exe` is self-contained — **it does not need Node.**

Same as above: `git` always, `gh` for `push`, `claude` for AI features.

Two things worth knowing:

- **An artifact may need its own tooling.** If an artifact runs a setup step on
  install, that step may need `npm` or similar. A missing tool is reported as a
  warning, never a hard failure — DeliveryOS itself is fine.
- **Edge or Chrome** is used only to generate `preview.png` when pushing a
  `ui-component`. It uses a browser you already have rather than downloading
  one, and Edge ships with Windows. No browser just means no image; the push
  still succeeds.

---

## Building from source

Everything here is build-time only. **None of it is needed by anyone you hand
the installer to.**

### The engine and CLI

Needs **Node.js 22.12+** and npm (bundled with Node). The version floor is real:
`@octokit/rest` is ESM-only and needs `require(esm)` support — see
`package.json`'s `engines`.

```
npm install
npm run build
npm link          # puts `deliveryos` on your PATH
```

Check it worked:

```
deliveryos --version
npm run typecheck && npm run lint && npm test
```

No `npm link`? Run it as `node dist/index.js <command>` instead, or
`npm run dev -- <command>` to skip the build and run straight from TypeScript.

### The desktop app

Also needs a native toolchain, because Tauri's shell is Rust.

| Requirement | Install |
|---|---|
| Rust | `winget install Rustlang.Rustup`, or [rustup.rs](https://rustup.rs) |
| **Windows:** MSVC C++ Build Tools | `winget install Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools"` — multi-GB download. Tauri links against MSVC, not MinGW. |
| **macOS:** Xcode Command Line Tools | `xcode-select --install` |
| Tauri CLI | Nothing — already a devDependency, `npm install` gets it |

```
npm run build && npm run build:sidecar
cd src-tauri && npx tauri dev
```

On Windows, make sure Rust's `~/.cargo/bin` is on your PATH first.

**You can't build a Mac app on Windows, or vice versa.** The same source builds
on either, but a macOS binary needs a real Mac or a macOS CI runner.

**Code signing isn't set up.** Needed before distributing a real installer: a
Windows code-signing certificate, and an Apple Developer ID plus notarization
for macOS. Tracked in ARCHITECTURE.md §9 risk #7.

---

## When something fails

| What you see | Fix |
|---|---|
| `git` errors on `remote add`, or an empty catalog | Install git, then **reopen your terminal** |
| `Failed to get a GitHub token via "gh auth token"` | `gh auth login` — needs the `repo` scope |
| Suggest with Claude / build-fix / Wire with Claude fail | Install `claude` and sign in, then reopen your terminal |
| `deliveryos: command not found` after installing the app | You installed the `.msi`. Install the NSIS `.exe` instead |
| `deliveryos: command not found` after building from source | Run `npm link`, or use `node dist/index.js <command>` |
| Push worked but the PR has no preview image | Expected — the packaged app can never render previews. Use the CLI from source if you need one |
| An artifact's setup step fails with a missing tool | Install what *that artifact* needs (usually `npm`). DeliveryOS itself is fine |
| One artifact missing, the rest fine | That manifest failed validation. `deliveryos list` prints which and why to stderr |

---

See [README.md](README.md) for how to use it, [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md)
for what it's for, and [docs/skills.md](docs/skills.md) for the Claude Code skills.

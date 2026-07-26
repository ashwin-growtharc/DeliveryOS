# DeliveryOS demo script

A live walkthrough script for presenting DeliveryOS — open this in VS Code
and follow top to bottom. Roughly 15-20 minutes including questions.

## Before you start

- [ ] `gh auth login` done on this machine (`gh auth status` to confirm)
- [ ] Rust + MSVC Build Tools installed (only needed to run the app itself, not to read code)
- [ ] Have a scratch project folder ready (e.g. `C:\Users\AshwinB\Desktop\demo-project`, empty)
- [ ] Optional: close other apps so the demo window isn't cluttered

## Resetting to a clean slate (before a re-run, or before tomorrow)

If you've already pulled things into a demo folder (e.g. from a rehearsal),
run these to start genuinely fresh — otherwise cards will show "Pulled"
instead of "Not pulled" and the walkthrough won't match what you're saying.

**1. Delete the project folder's DeliveryOS state** (lockfile + pristine
snapshots — this alone resets every card back to "Not pulled" without
deleting the actual pulled files, if you want to keep them around to look
at):
```powershell
Remove-Item -Recurse -Force "<project folder>\.deliveryos"
```

**2. Or, for a fully clean folder**, delete the pulled artifact folders too
(adjust names to whatever you actually pulled):
```powershell
Remove-Item -Recurse -Force "<project folder>\arcos-cli"
Remove-Item -Recurse -Force "<project folder>\launchpad-template"
Remove-Item -Recurse -Force "<project folder>\.claude"
```

**3. `arcos-cli` specifically also installs a real `pip` package** (via its
`post_install`) — if you pulled it before, `arcos` stays registered on your
system even after deleting the folder above. Remove it too:
```powershell
pip uninstall arcos -y
```
(Confirm it's really gone: `arcos --help` should then say "command not
found.")

**4. If you also want to clear registered remotes** (Settings will show
empty, requiring you to re-add them live — only do this if you *want* to
demo the "Add remote" step from scratch):
```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.deliveryos"
```

Steps 1-3 are the normal "reset between rehearsals" routine. Step 4 is only
if you specifically want to re-demo registering a remote from an empty
Settings screen.

## 1. Open in VS Code — orient the audience (2 min)

Open the `delivery-os` folder in VS Code. Say:

> "This is DeliveryOS — an internal app store for reusable stuff: AI agents,
> starter templates, even whole codebases. You browse what's available,
> click Pull to get a working copy on your machine, and if you improve
> something, click Push and it opens a real GitHub pull request — no git
> knowledge required."

Point at the repo structure briefly, no need to open files yet:
- `src/` — the engine (TypeScript): manifest parsing, pull/push logic, GitHub integration
- `src-tauri/` — the desktop app shell (Rust) and UI (`spike-ui/`, plain HTML/JS)
- `docs/` — all the design/decision write-ups, if anyone wants to dig in later
- `PLAN.md` / `CHANGELOG.md` — what's built, phase by phase, kept honestly up to date the whole way

## 2. Launch the app (1 min)

In a terminal, from the repo root. If this is a fresh terminal window,
`cargo` may not be on `PATH` yet — run this first if `npx tauri dev` below
complains it can't find `cargo`/`cargo metadata`:

```powershell
$env:Path += ";$env:USERPROFILE\.cargo\bin"
```

Then:

```powershell
npm run build; npm run build:sidecar
cd src-tauri
npx tauri dev
```

While it launches, say:

> "Under the hood this is a Rust shell wrapping the same engine as a
> background process — so the CLI and the app share 100% of the same
> logic, nothing's duplicated."

## 3. Settings — register a source (2 min)

Click **Settings**. Say:

> "First, you point it at a git repo — any repo, that's the only source of
> truth. No DeliveryOS server, no database."

Add remote: `git@github.com:ashwin-growtharc/arc_os-catalog-poc.git`
(name it `arcos-poc`). It appears in the Remotes list.

## 4. Pick a project folder (30 sec)

Click **Change folder**, pick your scratch demo folder. Say:

> "This is just — where do the files land on my machine."

## 5. Browse (2 min)

Switch to **Browse**. Four cards should appear:

| Card | Kind | What it demonstrates |
|---|---|---|
| `code-reviewer` | agent | A single file — AI assistant instructions |
| `engagement-kickoff` | skill | A single file — a checklist/playbook |
| `arcos-cli` | template | An **entire codebase** — the real ArcOS project |
| `launchpad-template` | template | An **entire codebase** — a real Next.js starter kit |

Say:

> "Same mechanism for all four — a two-line instruction file, or a whole
> software project. DeliveryOS doesn't care which."

Try the search box and kind filter chips. Click a card to open **Detail** —
show the description/version/owner/tags/install path.

## 6. Pull — the fast case (2 min)

From Detail, click **Pull** on `engagement-kickoff` (fast, no setup step).
Point out the **progress log** appearing live, then **Done**. Badge flips to
**Pulled**. Click **Open folder** — real Explorer window opens on the real
pulled file.

## 7. Pull — the "whole project" case (2-3 min, this is the big one)

Open `launchpad-template`, click **Pull**. While it runs (`npm install`
happening for real), say:

> "This isn't copying a template folder — it's fetching the actual starter
> kit and running its real setup command automatically. Watch the log."

When done, open a terminal in the pulled `launchpad-template` folder and
run:
```powershell
npm run dev
```
Open `http://localhost:3000` in a browser — show the real running site.
Stop the server (Ctrl+C) when done.

*(If short on time, skip actually running the dev server and just show the
files landed + `node_modules` populated via Open Folder.)*

## 8. Edit + Push (3 min) — the "aha" moment

Edit the pulled `engagement-kickoff` file (or `launchpad-template`'s
`app/page.tsx`) — change one line, save. Back in the app, badge flips to
**Edited locally**, Detail now shows a **Push** button.

Click **Push**. Say, while it runs:

> "It's diffing your change, drafting a commit message, and opening a real
> GitHub pull request — the exact same review process any engineer would
> use. This person never touched git."

Show the toast with the PR link — open it in a browser, show the real diff.

## 9. Check for updates + auto-sync (1 min)

Back in Browse, click **Check for updates**. Say:

> "This also runs quietly in the background every 20 minutes on its own —
> you'll get a toast if something you're using has a newer version
> upstream, without asking."

If a card shows **Both changed** (edited locally AND updated upstream),
point it out:

> "If you've edited something AND it changed upstream, it won't silently
> overwrite your work — it makes you confirm first."

## 10. Anticipated questions

**"Does `remote add` work with any repo, or only your own?"**
`remote add`/Pull work with **any git repo you can read** — public, or
private if you have access. No special registration needed on the repo's
side (unless you want to use the lighter `payload_path` convention to avoid
duplicating files, but that's optional).

**Push is different**: it needs you to have **write access to create a
branch directly on that repo** — it doesn't fork. So you can pull from
anything you can see, but you can only propose changes back to repos you
(or your git/GitHub credentials) actually have push access to. That's not a
DeliveryOS limitation — it's the same permission model as pushing a branch
by hand.

**"Is this connected to a server / does GrowthArc need to host anything?"**
No server, no database. Every "remote" is just a plain git repo. The engine
runs locally on each person's machine.

**"What about security — can anyone push anything?"**
Push always goes through a real GitHub pull request, reviewed under
whatever rules that repo already has (branch protection, required
reviewers, etc.) — DeliveryOS doesn't bypass or weaken that, it just
automates opening the PR.

**"Is this signed / is the installer safe to distribute?"**
Not yet — deliberately deferred (see PLAN.md). At this POC stage, running
the installer on your own machine works fine (one click through a Windows
security warning). Signing only matters once distributing to other people.

## 11. What's built vs. what's next

**Built (all of Phases 0-3, and most of Phase 5):**
- CLI: `remote add`, `list`, `pull`, `push` (edit + propose-new)
- Desktop app: Browse, Detail, Pull, Push, Settings, live progress log, Open
  Folder, auto-update checking
- Drift detection + background auto-sync (checks for upstream updates
  automatically)
- Proven against real content: two real ArcOS catalog assets, a full ArcOS
  codebase, and a real Launchpad starter kit — from three different real
  sources

**Deliberately deferred, not forgotten** (all documented in PLAN.md with the
reasoning):
- **Team rollout / auth / SSO** — GrowthArc doesn't have a real
  identity provider yet, so building real login would mean inventing fake
  infrastructure. Everything works today via each person's own GitHub
  credentials — genuinely fine for one person, and still fine for several
  people using their own machines/credentials. What's missing is *profiles*
  (auto-filtering Browse by role — Sales sees different things than
  Engineering) and *verified* identity — both need that real auth system
  first.
- **Code signing** — not needed until distributing outside this room.
- **Native OS notifications** — in-app toasts already cover it for now.
- **Lifecycle/deprecation states, success metrics** — not built yet.

Say, closing:

> "Everything you just saw is real — real files, real GitHub PRs, real
> running code. The only thing standing between this and a full org
> rollout is a real identity system to plug into — everything else here
> already works."

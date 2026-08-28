# The `backend-plugin` lifecycle, start to finish

Every stage below is real, shipped behavior — grounded in the actual
engine code, CLI commands, and desktop app, not aspirational. See
[ARCHITECTURE.md](../ARCHITECTURE.md) for how `backend-plugin` fits into
the rest of the artifact model.

| Stage | What happens |
|---|---|
| [Install](#install) | Signature verified before any file lands, config form collects what it needs, `post_install` installs whatever real dependencies it needs |
| [Wire in](#wire-in) | Safe new files auto-applied, build runs automatically |
| [Build breaks](#build-breaks) | AI proposes a fix, you confirm, rebuild verifies, auto-rollback if it doesn't hold |
| [File already exists](#file-already-exists) | AI proposes a real merge instead of "go do it yourself," backed by the artifact's own reference content even when the manifest gives no explicit merge snippet |
| [Connect it to your app](#connect-it-to-your-app) | Wiring the backend into YOUR specific pages/routes is project-specific — a real AI session (in-app or CLI) does this, then re-verifies the build |
| [After install](#after-install) | Plain-language summary of what worked and what's still on you |
| [Audit](#audit) | Every AI proposal/apply/rollback logged and viewable per-artifact |
| [Uninstall](#uninstall) | `deliveryos remove` cleanly reverts what was pulled, running a real teardown command first if the artifact declared one |
| [Secrets](#secrets) | Warns if your `.env.local` isn't gitignored; never silently proceeds |
| [Rotate a secret](#rotate-a-secret) | `deliveryos config --set` — CLI parity with the UI |
| [Reconfigure](#reconfigure) | Form remembers what you already filled in (fixed a real bug where it forgot) |
| [Update](#update) | Actually applies now — deletes files the new version removed, refuses (not guesses) if you've made local edits |
| [Timeouts](#timeouts) | Build/install commands can't hang forever, and "tool not found" reads differently than "it broke" |

That's the full lifecycle: install → wire → fix → merge → connect →
configure → rotate → update → uninstall.

---

## Install

```bash
deliveryos pull <id> --remote <name> --set KEY=VALUE ...
```

Before a single file is copied, `pullArtifact` (`src/engine/pull/pull.ts`)
checks whether the manifest declares a `signature`. If it does, the payload's
real sha256 is recomputed and compared against the manifest's own
`content_digest`, a sibling `signature.bundle` file is required to exist, and
a real `sigstore` verification runs against the declared
`certificate_identity`/`oidc_issuer`. Any mismatch throws before anything
touches disk. An artifact with no `signature` at all (most of them) skips
this — it's opt-in per artifact, not a universal gate.

The Detail view's Configuration tab renders a real form generated from the
manifest's own `install_params` — one field per declared value, each marked
secret/non-secret, each showing its own description. A required field with
no default renders as `(secret -- never defaulted)` rather than a fake
placeholder. Values are resolved in precedence `--set`/form input `>`
existing `.env.local` value `>` the param's own `default`, then written to
`.env.local` at the project root — **never** into the artifact's own
`install_target`, so a secret never ends up in the pristine snapshot
DeliveryOS keeps for update-checking. A missing required value is reported,
not a hard failure — `pull` still succeeds and tells you exactly what's
still needed.

If the manifest declares `post_install`, it runs right after the payload
lands — this is the artifact's own chance to run `npm install` for
whatever real dependencies its code actually imports (a plugin that
never installs its own dependencies is a real, confirmed bug class this
closed). It runs with an absolute `DELIVERYOS_PROJECT_ROOT` env var set
to the real consuming project's root, specifically so it never has to
guess its way there with a relative `cd ../../..` — a real, confirmed
bug: a fixed-depth `cd` silently overshoots once a project's own
`src/`-vs-root convention shortens `install_target`'s effective depth,
landing npm installs in the wrong folder entirely. A failing
`post_install` aborts the pull outright, before anything is recorded as
installed — unlike its uninstall-time counterpart (see
[Uninstall](#uninstall)), there's nothing yet to leave a person stuck
in the middle of.

## Wire in

As of the CLI's own default behavior (previously only the desktop app's
Pull button did this), every pull also resolves the manifest's declared
`wiring_actions` and applies whatever's genuinely safe automatically:

- A target file that **doesn't exist yet** gets the manifest's
  `whenAbsent.snippet` written verbatim, as a real, complete new file.
- A target file that **already exists** is left completely untouched —
  named in the summary instead (see [File already exists](#file-already-exists)).

Immediately after, the project's own real build command runs to confirm
nothing broke. `--no-wire` (CLI) reverts to the old plain-copy-only
behavior, for scripted/CI use that shouldn't touch anything else in the
project.

## Build breaks

If the automatic build-verify step (above, or after a merge — see below)
fails, "Want help fixing this?" offers an AI-proposed fix: a Claude
subprocess with **no tool access** and strict JSON in/out reads the real
build error and the real file, proposes a fixed version, and stops there —
nothing is written yet. A person reviews the diff and clicks **Apply**;
only then does it get written, the build reruns for real, and if it still
doesn't pass, the original file is restored automatically. There is no
outcome where a broken fix is left in place silently — either it verifiably
fixed things, or the project is back exactly where it started.

## File already exists

Before this existed, a wiring target that already existed was a dead end —
"go merge this yourself," full stop, even when the manifest shipped a
`whenPresent` merge-guidance snippet. **Merge with Claude** turns this into
a real, reviewed option: a Claude subprocess reads the real existing file
plus the manifest's own instructions/guidance, and either proposes a
complete merged file or an honest refusal naming exactly what information
is missing to do it safely, rather than guessing.

A real, confirmed gap this closed: a `whenPresent` with only prose
instructions and no snippet of its own (the common case — e.g. "this
artifact expects to own this file, review before replacing it") used to
leave the merge with nothing concrete to work from at all, so it could
only ever refuse — even for something as trivial as reverting a single
stray character someone typed into a file the artifact fully owns. It
now falls back to the same `whenAbsent.snippet` a fresh install would
have written — real, known-good reference content either way — so a
genuine refusal is now reserved for cases that actually need one (a real
library conflict, content it truly can't reconcile), not just "no
snippet happened to be declared for this branch."

Nothing is written until you click **Apply**. When applied, the project's
real build reruns to verify it, with the exact same automatic rollback
guarantee as [Build breaks](#build-breaks): a merge that breaks the build
never survives.

**Merge all with Claude** (Phase 20) is the same mechanism, batched: when
an artifact has more than one existing-file wiring action (`nextauth-credentials`
has four), one button proposes a merge for every one of them — sequentially,
never concurrent, since each is a real subprocess call and a shared
build-verify step can't race reliably — then a second **Apply all proposed
merges** button applies every real proposal, each with its own independent
verify/rollback. One file's honest refusal never blocks the others. Real
run against `nextauth-credentials`'s actual four wiring actions: three
honest refusals (a vague instruction with nothing concrete to merge), one
real merge, applied and verified in one click. Still exactly one human
confirmation before anything is written — it just now covers every file
that click applies to, instead of requiring one click per file.

## Connect it to your app

`wiring_actions` (the two stages above) only cover files with a fixed,
predictable path every project shares (`middleware.ts`, a specific API
route) — that's a real, closed set. Actually connecting the backend's
own functions to YOUR app's specific login page, dashboard, and routing
is a different problem: it depends on which UI you happen to have,
which is different for every project, with no fixed convention to write
a `wiring_action` against. Automating it would mean guessing; that's not
this tier's job.

```bash
deliveryos wire-with-claude <id> --remote <name>
```

This reads the artifact's own real, already-resolved lockfile paths (the
exact files this pull produced, never a hand-typed guess), writes them
to a real context file, then hands off to a genuine interactive `claude`
session — in the desktop app, a real terminal opens right inside the
window; on the CLI, the same session opens in your own terminal. It
connects the backend to your actual pages, confirms the login flow
really works, then re-runs the project's real build one more time before
handing back a plain pass/fail summary.

This is deliberately NOT DeliveryOS's own restricted, no-tool-access AI
subprocess (the same one used for [Build breaks](#build-breaks) and
[File already exists](#file-already-exists)) — that flags a bounded,
single-file proposal for review. This step needs a real, unrestricted
coding session instead, so it opens the same trusted `claude` you'd run
by hand, under its own normal permission prompts, rather than trying to
grant a restricted subprocess broad write access a flag can't reliably
enforce. Commit or branch first, same as before any real coding session.

## After install

Every pull that goes through the auto-wiring path ends with one
plain-language summary — not four separate facts you have to
cross-reference yourself:

> *Wiring was applied automatically to 3 files. `src/app/layout.tsx`
> already exists and needs a manual look. The build passes.*

or, when something's still missing:

> *Before this feature actually works, real values are still needed for:
> AUTH_SECRET, DATABASE_URL.*

This deliberately isn't an AI call — every fact in it (what got wired, what
needs review, whether the build passed, what params are still missing) is
already fully known by the time it runs; a plain deterministic sentence-builder
is the right tool for stating known facts, not a judgment call.

That summary is tied to the moment right after the pull, though — reopen
the artifact tomorrow and it's gone. **Connection status** (Detail's own
persistent panel, always visible for a pulled artifact with
`install_params`/`wiring_actions`) is the version that answers "is this
still actually connected?" any time you come back, not just once: real
chips for how many required values are genuinely set, how many wiring
targets exist versus still need review, both recomputed fresh from the
real project every time Detail opens — never a memory of what happened
last time. Build status is the one exception, shown as "not checked yet"
until you click **Verify build**, since running a real build isn't free
enough to do silently every time this page opens.

## Audit

Every AI-proposed merge — proposed, applied, or rolled back — is appended
to `.deliveryos/wiring-merge-log.jsonl` (one entry per attempt, whether or
not the target file changed), viewable per-artifact in Detail's **Activity**
tab: what file, what was proposed (a real before/after diff, expandable),
whether the rebuild passed, whether it was rolled back. A merge that was
proposed but discarded without applying leaves no trace — the log only
records things that actually touched disk. (Build-fix proposals keep their
own separate, equivalent log; it isn't merged into this same per-artifact
view since it isn't scoped to one artifact's own wiring.)

## Uninstall

```bash
deliveryos remove <id>
```

If the manifest declares `post_remove` — the symmetric counterpart to
`post_install`, for an artifact that started something with its own
lifecycle (a local dev database via Docker, say) — it runs first, while
`install_target` still exists to reference. Unlike `post_install`, a
failing `post_remove` never blocks the removal itself: it's reported as
a warning, not a hard error, since trapping someone with both a broken
teardown *and* an artifact DeliveryOS now refuses to finish uninstalling
would be strictly worse than the teardown just failing on its own.

Then it deletes `install_target` and the artifact's pristine snapshot,
and drops its lockfile entry — but is deliberately conservative about
anything it didn't create itself:

- Only deletes wiring-created files it has an actual record of writing
  (`wiredFiles` in the lockfile) — a file that already existed before this
  artifact was pulled, or one that went through the human-reviewed merge
  flow, is **never** auto-deleted.
- Never touches `.env.local` — install_param values may be shared with
  other artifacts or just left as a harmless residue; it's reported as an
  FYI (`envParamsStillSet`), not silently removed.
- Anything it declined to delete for either reason is printed under an
  explicit "Needs your attention — not touched automatically" section, by
  name, not just a vague "some things may remain."

## Secrets

The moment `pull` (or `config`, below) writes a real secret value into
`.env.local`, it checks whether that file is actually covered by
`.gitignore` in this project. If it isn't, it says so plainly:

> *DeliveryOS just wrote a real secret value into .env.local, but it does
> not look like .gitignore covers that file — if this project is
> committed to git, that secret could get pushed to a shared remote. Add
> ".env.local" (or ".env*.local") to .gitignore.*

It never edits `.gitignore` on your behalf, and it never silently
proceeds without telling you — a genuinely fresh project (no `.gitignore`
at all yet) gets exactly the same warning as one with an incomplete one.

## Rotate a secret

```bash
deliveryos config <id> --remote <name> --set KEY=VALUE
```

Rotates or adds `install_params` values in `.env.local` without a re-pull —
same resolution/write logic `pull` itself uses, same `.gitignore` check.
The Detail view's **Apply configuration** button in the Configuration tab
is genuine CLI/UI parity: both call the same underlying resolve-and-apply
path, not two independent implementations that could drift. Explicitly
documented (and printed to the user) that this does **not** re-run
`wiring_actions` — a rotated value only reaches code that reads
`process.env` at runtime; anything already spliced into a file by wiring
is unaffected by a config change alone.

## Reconfigure

Reopening an already-pulled artifact's Configuration tab shows real,
already-saved values, not a blank form asking you to remember what you
typed last time. This was a real, confirmed bug until it was fixed: the
form only ever pre-filled from the manifest author's own `default`, never
from a value already sitting in `.env.local` from an earlier partial fill —
found via a real example (`azure-msal-sso`'s three required
`VITE_APP_MSAL_*` fields), where filling in 2 of 3 and reopening the form
showed all three blank again, even though two were genuinely saved. Fixed
with a small, deliberately read-only `artifact.readInstallParamValues`
RPC: a real existing value now wins over the manifest's own default when
pre-filling the form, matching the exact `provided > existing > default`
precedence the write path already used — the form's own display just
hadn't been taught to read it back.

## Update

```bash
deliveryos check-updates --apply
```

Actually applies an available update now, rather than only reporting
`installed → available` and leaving the rest to you. Only ever touches an
artifact whose current install is byte-for-byte identical to its own
pristine snapshot — a real local edit is reported, never guessed at or
silently overwritten, since safely merging a local edit against a new
upstream version isn't attempted. For an eligible artifact, it diffs the
old pristine snapshot against the new version's payload to find and
**delete** files the new version actually removed (a plain recursive copy
alone never does this — a real, confirmed bug this closes), reruns
`post_install` if declared, and advances the pristine snapshot and
lockfile version together. One artifact's update failing never aborts a
batch of several.

## Timeouts

Every build or install-time command DeliveryOS runs on your behalf —
`post_install`, the automatic post-wiring build check, a build-fix/merge's
own re-verify — has a bounded timeout. A command that hangs gets killed
and reported as a **timeout**, in its own distinct wording from a genuine
compile failure:

> *The build was killed for running too long after this pull, not because
> of a real compile problem — it may just be slow, or genuinely stuck.*

A command that can't even start because the tool it needs isn't on `PATH`
gets its own distinct message too:

> *The build could not run at all after this pull — the tool it needs
> isn't installed or on this machine's PATH.*

Conflating either of these with "the code doesn't compile" would be
actively misleading — an AI code-fix can't repair a hung process or make
a missing tool exist, so the app only ever offers "Want help fixing this?"
for a genuine compile failure, never a timeout or missing-tool case. (One
honestly-documented gap: on Windows, killing a timed-out command currently
only terminates the shell wrapper, not the actual underlying process — a
"timed out" build can keep running in the background after being reported
as timed out. Found along the way, not yet fixed.)

---

## The bottom line, from your side of the terminal

None of the thirteen stages above are things you have to orchestrate
yourself — they're what happens *while you run one command*. From where
you're sitting:

- **You pull one thing, and it either works or tells you exactly why it
  doesn't yet.** Not "probably fine," not a silent partial success you
  discover later at 2am — a plain sentence naming what's wired, what
  still needs your eyes, and whether the build actually passes.
- **Anything that requires judgment gets a real proposal, not homework.**
  A file that already has your own code in it doesn't become "go figure
  it out yourself" — it becomes a diff you read and click Apply on, or an
  honest "I can't tell what you need without more information," never a
  guess dressed up as confidence.
- **Nothing DeliveryOS itself proposes is ever written without you
  clicking something first** — not once: not the merge, not the build
  fix, not the update. The one thing that *is* automatic (writing a
  brand-new file from the manifest's own declared content) is also the
  one thing with nothing to guess at — there was no existing file to
  overwrite, no judgment call to make. **Connect it to your app** is the
  one deliberate exception: it hands off to a real, unrestricted coding
  session (the same `claude` you'd run by hand) rather than a single
  bounded proposal, so its one confirmation covers the whole session,
  not one file at a time — say so explicitly if anyone asks "does this
  ever write without asking."
- **If you change your mind, you get your project back**, not a folder
  full of mystery files — `deliveryos remove` undoes exactly what it
  created and is explicit about the two things it won't touch (a file
  that already existed, your `.env.local`), rather than silently
  guessing either way. That covers what DeliveryOS itself wired in;
  whatever a **Connect it to your app** session wrote afterward is
  real, normal code in your project now, same as anything you'd typed
  yourself — your own git history is the undo button for that part.
- **Every proposal DeliveryOS itself made to your files is one click
  away from being read again** — not just "it happened," but the
  actual before, the actual after, and whether the rebuild confirmed
  it. A **Connect it to your app** session isn't part of that same log
  (it's not a bounded proposal to begin with) — commit or branch before
  running it for exactly this reason.

What's still genuinely yours to do, every time: writing your own database
migration, reading a file DeliveryOS flagged rather than trusting it was
fine, and deciding what to do when Claude's honest answer is "I don't have
enough to go on." That's not a gap in the tooling — it's the line the
tooling draws on purpose, between "safe enough to do for you" and
"actually your call."

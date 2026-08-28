# Claude Code skills

DeliveryOS ships six skills. They divide cleanly by who they're for.

**Authoring skills** turn something you already have — a component, a feature,
a project, a backend integration — into a pullable artifact. They live in this
repo and are available whenever you have it open in Claude Code.

**Usage skills** let Claude Code drive DeliveryOS itself. They're published to
the catalog, so you pull them into whichever project you want them in.

---

## Authoring an artifact

One skill per artifact kind. Each exists because the kind has real failure
modes that only show up when you actually pull the result into a fresh
project — not things the manifest schema catches.

| Skill | Produces | Use it for |
|---|---|---|
| `ui-component-extractor` | `kind: ui-component` | A single React component you found or were given — v0, 21st.dev, shadcn, Aceternity, Tailwind UI |
| `feature-extractor` | `kind: ui-feature` | A multi-file slice that only makes sense together — an auth flow, a billing page, a chat panel |
| `starter-kit-extractor` | `kind: template` | A whole project or design system, from a tiny scaffold to a multi-page app |
| `backend-plugin-authoring` | `kind: backend-plugin` | Anything with install params and wiring — auth, a database layer, a mailer |

These are in `.claude/skills/` in this repo. Open DeliveryOS in Claude Code and
invoke one by name.

**What each one actually does for you**

- **`ui-component-extractor`** makes the component compile in DeliveryOS's
  preview pipeline and be found by `deliveryos scan`, and hand-writes a
  `preview.tsx` with realistic example data rather than generic placeholders —
  a preview full of `Lorem ipsum` tells a reviewer nothing about whether the
  component is right.
- **`feature-extractor`** rewires the slice to prop callbacks instead of
  whatever backend the source happened to use, and states plainly what the
  installing project still has to supply. A feature that silently assumes your
  auth provider is worse than one that says it needs one.
- **`starter-kit-extractor`** physically assembles the artifact, runs the
  project's own tooling to find real bugs, and verifies it end to end in a
  headless browser — including that interactivity and animation actually work.
- **`backend-plugin-authoring`** covers the failure modes found by really
  pulling a plugin into a fresh project: a missing `post_install`, a fixed
  relative `cd` that breaks once `adaptSrcDirPath` shortens `install_target`,
  dependency version drift, and Prisma's `.env` vs `.env.local` split.

## Using DeliveryOS from Claude Code

Both are published as artifacts. Pull them into any project:

```
deliveryos pull deliveryos-check-first
deliveryos pull deliveryos-status
```

They install to `.claude/skills/<id>/` in that project.

| Skill | What it does |
|---|---|
| `deliveryos-check-first` | Before writing new code, checks the catalog for something reusable — then pulls it, wires it in, and verifies the build |
| `deliveryos-status` | Runs typecheck, lint and tests, and cross-checks the real state of pushed PRs |

`deliveryos-check-first` is the one that changes how the tool feels day to day:
it makes "is this already solved?" the default question instead of an
afterthought.

Both need the `claude` CLI installed and authenticated — they *are* Claude Code
skills, so nothing about them works without it. Nothing else in DeliveryOS
depends on `claude`; the CLI, `pull`/`push` and the desktop app all work fully
without it.

## Not a DeliveryOS skill

`.claude/skills/` also contains **`ui-ux-pro-max`**, a general-purpose UI/UX
design skill. It's a third-party skill kept here because it's useful while
working on the desktop app's own interface — it has nothing to do with
DeliveryOS's artifact model and isn't something DeliveryOS ships or maintains.

## Distribution

The four authoring skills are **not** published to any catalog, and neither the
desktop installer nor the CLI installs them anywhere. They only exist for
someone who has this repo checked out. If you want a colleague to be able to
author artifacts, they need the repo — or the skills need publishing with
`deliveryos push --new`, the same as any other artifact.

The two usage skills are already published to the `ai-helpers` remote, which is
why `pull` works for them.

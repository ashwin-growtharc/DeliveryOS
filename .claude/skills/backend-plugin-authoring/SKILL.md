---
name: backend-plugin-authoring
description: "Write or fix a real, correct DeliveryOS kind:backend-plugin manifest.yaml + payload -- install_params, wiring_actions, post_install, post_remove -- covering the real failure modes only found by actually pulling one into a fresh project (missing post_install, a fixed relative cd silently breaking once adaptSrcDirPath shortens install_target, dependency version drift, Prisma's .env vs .env.local split), not just the schema's happy path"
tools: Read, Write, Edit, Bash, Grep, Glob
---

# Backend Plugin Authoring

Writes (or fixes) a `kind: backend-plugin` DeliveryOS artifact: real code
that has to *integrate* into an existing project rather than just sit
there to be edited -- it touches files that might already exist, needs
real secrets to work, can break a build if it's wrong, and (for anything
non-trivial) needs real npm dependencies installed and possibly a real
local service running before it does anything useful.

This document is written for a human author and an AI agent equally --
every rule here was learned by actually pulling a real backend-plugin
into a fresh, real project and watching it fail, not by reading the
schema and guessing. Read `docs/backend-plugin-lifecycle.md` first if
you haven't seen the CONSUMER side of this (what `deliveryos pull`/
`config`/`remove` actually do with what you're about to write) --
this skill is the other half: how to write something that survives
contact with that mechanism.

## When to activate

- "Package this as a backend-plugin" / "make this pullable as auth/SSO/
  a payments module/whatever" / "write a manifest for this."
- Fixing a real, reported bug in an existing backend-plugin artifact --
  "this artifact's post_install doesn't work," "a fresh pull is broken,"
  "the wiring landed in the wrong place."
- Reviewing someone else's (or an AI's) draft manifest before it ships.

## Why this needs its own process, not just the schema's happy path

Every rule below traces to a REAL bug, found by actually pulling a real
artifact into a fresh project -- not a theoretical edge case:

1. **A manifest with no `post_install` at all silently ships a backend
   that can't run.** Confirmed twice, independently: `email-code-auth`/
   `kortix-auth-shell` (missing `next-auth`/`framer-motion`/`lucide-react`)
   and, separately, the real published `nextauth-credentials` (missing
   `next-auth`/`@auth/prisma-adapter`/`@prisma/client`/`bcryptjs`/`prisma`
   entirely) -- a real pull left every one of these with wired files
   importing packages that were never installed. `deliveryos pull`
   doesn't infer your dependencies from your source; you have to say so.
2. **A `post_install` that `cd`s back to the project root using a fixed
   relative path (`cd ../../..`) is a real, confirmed filesystem-pollution
   bug, not just fragile.** `post_install`/`post_remove` both run with
   `cwd: installTarget`, not the project root -- correct for a
   `kind:template` whose `install_target` IS the whole project, wrong for
   a backend-plugin merging into an existing one. The natural fix -- `cd`
   back up as many levels as `install_target` has segments -- breaks the
   moment `adaptSrcDirPath` (the engine's own `src/`-vs-root convention
   detection) shortens that effective depth for a project that doesn't
   use `--src-dir`. Confirmed the hard way: this silently installed real
   npm packages into a real user's Desktop folder (one level above the
   actual project) instead of the project itself -- it "worked" only
   because Node's own upward `node_modules` search happened to still
   find them. Use `DELIVERYOS_PROJECT_ROOT` (below), never a relative `cd`.
3. **`npm install -D <tool>` with no version pin can grab a completely
   incompatible major version.** Confirmed the hard way: a plain
   `npm install -D prisma` grabbed `prisma@8.0.0-rc.12` -- a totally
   restructured CLI with no `generate`/`migrate dev` commands at all,
   breaking every instruction the artifact's own README gave. Pin real,
   known-good major versions in `post_install` explicitly.
4. **A tool your `post_install` doesn't run may not read the same env
   file your framework does.** Confirmed the hard way: DeliveryOS writes
   every `install_param` to `.env.local` (matching Next.js's own
   convention -- Next.js's dev/build both read it fine), but the Prisma
   CLI, run standalone via `npx prisma ...`, only reads a plain `.env` by
   default and never touches `.env.local` at all. If your artifact needs
   a CLI tool that isn't your framework's own dev server, say so in the
   README -- don't assume "it's in `.env.local`" is enough.

## The three-tier model -- what goes where

This is the actual division of labor between what DeliveryOS automates
and what stays manual, and it's load-bearing: getting a field's tier
wrong means either something that should be automatic isn't, or
something that should never be automatic (a database migration) gets
treated like it could be.

| Tier | Manifest field | What it is | Automation |
|---|---|---|---|
| **1** | `install_params` | Env-var-shaped config (API keys, URLs, secrets) | Fully automatic -- collected via a form (app) or `--set` (CLI), written to `.env.local`, `.env.example` placeholders derived from it directly. No separate declared action for this exists on purpose (schema.ts's own doc comment: redeclaring the same keys twice would just be drift risk for no benefit). |
| **2** | `wiring_actions` | Concrete file edits at the INSTALLING PROJECT's own root/conventions (`auth.ts`, `middleware.ts`, an API route) | Auto-written ONLY when the target file doesn't exist yet (`whenAbsent.snippet`, the pull's own default unless `--no-wire`). NEVER auto-splices into an existing file -- offered as a proposed merge, one explicit human (or "Merge with Claude") confirmation required. |
| **3** | *(nothing -- no field)* | DB schema/migrations, and anything else genuinely too risky to automate | A deliberate, permanent NEVER-touch -- not a lesser form of Tier 2, not a future TODO. Ship a reference file (e.g. a `*-schema-snippet.prisma`) plus clear README prose telling the installer exactly what to do by hand. This is surfaced PASSIVELY (the file exists, the README says so) and that's the whole mechanism. |

If you're tempted to add a `wiring_action` that would splice into a
database schema file, or a `post_install` step that runs a real
migration against a database that might already have real data in it --
stop. That's Tier 3. Document it; don't automate it.

## Process

### 1. Scope the payload -- decide what's actually shipped vs. referenced

The payload (`artifacts/<id>/payload/`) is code that gets copied
verbatim into the installing project's `install_target`. Ship the real,
working source files (Tier 1/2 code) here. For Tier 3 material (a
database schema), ship a clearly-named REFERENCE file (never the
project's own live schema path -- DeliveryOS never writes there) plus a
README explaining the manual merge step. See `nextauth-credentials`'s
own `prisma-schema-snippet.prisma` as real, working precedent.

### 2. Write the manifest's core fields

```yaml
id: my-plugin              # matches the artifacts/<id>/ folder name
kind: backend-plugin
description: One real sentence -- what it does, what it needs (a
  database? an API key?), and what makes it different from any sibling
  artifact (e.g. "no database" for email-code-auth vs. Prisma-backed
  nextauth-credentials).
owner: your-team-or-username
version: 1.0.0              # strict x.y.z, bump on every real change
tags:
  stacks: [nextjs, typescript]   # whatever real stacks apply
source_repo: https://github.com/your-org/your-repo.git
install_target: src/lib/my-plugin   # see step 4's DELIVERYOS_PROJECT_ROOT note
review_required: false
```

`install_target` -- write it assuming `src/` (the common convention);
the engine's own `adaptSrcDirPath` automatically adapts it for a project
that doesn't use `--src-dir` at pull time. You don't need to (and
shouldn't try to) handle that yourself in the manifest.

### 3. Declare `install_params` (Tier 1)

One entry per real config value the payload's own code reads from
`process.env`. Real constraints, schema-enforced:
- `secret: true` marks a value that must never be defaulted (a
  session secret, a DB password) -- the schema itself refuses a
  `secret` param that also declares a `default`.
- A non-secret value CAN have a real, working `default` (e.g.
  `AUTH_URL: http://localhost:3000`) -- do this whenever there's a
  genuinely sensible one; it's one less thing the installer has to type.
- Write a real `description` for each -- it's the only context a
  person filling in the Configuration form gets.

### 4. Write `post_install` -- and use `DELIVERYOS_PROJECT_ROOT`, never a relative `cd`

If your payload's own source imports ANY package not already a
dependency of a typical consuming project (check this for real -- read
every import in every payload file), `post_install` MUST install it.
No `post_install` at all is the single most common real bug found this
way -- assume you need one unless you've actually confirmed otherwise.

`post_install` runs with `cwd: installTarget` (not the project root) --
correct for a `kind:template` whose `install_target` IS the whole
project, wrong for almost every backend-plugin, which needs to install
into the CONSUMING project's own `package.json`. The engine sets a real
environment variable, `DELIVERYOS_PROJECT_ROOT`, to the real, absolute
project root for exactly this reason -- use it, don't count `..`
segments:

```yaml
post_install: node -e "const {execSync}=require('child_process');process.chdir(process.env.DELIVERYOS_PROJECT_ROOT);execSync('npm install my-real-dep@6 another-dep',{stdio:'inherit'})"
```

Why a `node -e` one-liner instead of a shell `cd ... && npm install`:
`post_install` is executed via `execSync`, which uses `cmd.exe` on
Windows and `/bin/sh` elsewhere -- environment-variable syntax differs
(`%VAR%` vs `$VAR`), but `process.env.X` inside a `node -e` script is
identical on every platform. This is the same reason every other
cross-platform command in this catalog's real manifests (`node -e
"console.log(1)"`-shaped test commands, etc.) already uses `node -e`
rather than shell-specific syntax.

**Pin real dependency versions, especially anything with its own CLI**
(Prisma, any code-generator, any tool with a `migrate`/`generate`-shaped
command). `npm install -D sometool` grabs whatever's currently latest --
confirmed the hard way this can be a completely different major version
with a restructured CLI. Write `sometool@6`, not bare `sometool`, once
you've confirmed which major your artifact's own instructions assume.

If your `post_install` also starts a real local service (a throwaway
Docker container for local dev, say), make it idempotent -- a re-pull
shouldn't fail because the container already exists from last time
(`docker rm -f <name> 2>/dev/null; docker run -d --name <name> ...`,
wrapped in the same `node -e`/`try`/`catch` shape for cross-platform
safety). If you do this, you almost certainly also need step 6.

### 5. Declare `wiring_actions` (Tier 2)

Run the scaffolding command first rather than hand-writing these from
scratch -- it mechanically drafts both `install_params` and
`wiring_actions` by comparing your payload against real files in an
already-working consumer project:

```
deliveryos scaffold-backend-plugin --path <payload-dir> \
  --consumer-file <real-file-that-already-wires-this-in> \
  [--consumer-file <another-one> ...] \
  --out wiring-actions-draft.yaml
```

This writes a DRAFT, never a finished manifest -- review every
`targetFile` and `snippet` yourself before copying anything in. Real
rules the draft (and your own hand-written entries) must follow:

- `targetFile` is resolved against the INSTALLING PROJECT's own root,
  never `install_target`-relative -- `auth.ts`, not `lib/my-plugin/auth.ts`.
  Write it assuming `src/`, same as `install_target` -- `adaptSrcDirPath`
  adapts it automatically at resolve time.
- `whenAbsent.snippet` is REQUIRED (schema-enforced) -- a file that
  doesn't exist yet has nothing to conflict with, so there's always a
  complete, real file to hand over. This is what `deliveryos pull`
  auto-writes by default.
- `whenPresent` is OPTIONAL. Omit it entirely when the file existing
  already IS the whole signal ("this artifact expects to own this file,
  review before replacing it" -- e.g. the NextAuth API route). Include a
  `whenPresent.snippet`-less `instructions` string (guidance, not a full
  file) when a real merge is plausible (e.g. "add this matcher entry to
  your existing middleware's `config.matcher` array").
- Never declare a `wiring_action` targeting a database schema file, a
  git hook, a CI workflow, or an editor auto-run config -- Tier 3, or
  refused outright by the engine's own safety checks either way.

### 6. Write `post_remove` if `post_install` started anything

New, symmetric field: runs during `deliveryos remove`, before any files
are deleted (so it can still reference files inside `install_target`,
e.g. a `docker-compose.yml`), with the same `DELIVERYOS_PROJECT_ROOT`
env var available. **Unlike `post_install`, its failure never blocks
the removal** -- reported as a warning, but the artifact is still fully
removed either way (a hard-fail here would trap someone with both a
broken side effect AND a DeliveryOS that refuses to finish uninstalling
it -- strictly worse than either failure alone). Only declare this if
`post_install` genuinely started something with its own lifecycle
(a container, a background process) -- most backend-plugins don't need
one at all.

```yaml
post_remove: node -e "const {execSync}=require('child_process');try{execSync('docker rm -f my-plugin-dev-db',{stdio:'inherit'})}catch(e){process.exitCode=1}"
```

### 7. Ship Tier 3 passively -- never automate it

For anything the three-tier model rules out (database schema, real
migrations): ship a real, correctly-named reference file in the payload
(`*-schema-snippet.prisma` or equivalent for your ORM), and write the
manual steps as real, numbered instructions in the payload's own
`README.md` -- exactly what to copy where, and the exact command to run
afterward (`npx prisma migrate dev`, or equivalent). That file existing,
and the README saying so, IS the entire mechanism -- there is nothing
else to build here, and nothing here should try to auto-merge into a
project's real, possibly-already-populated schema file.

### 8. Verify for real -- pull it, don't just read it

Same standard as every other artifact this session: a fresh, genuinely
empty test project, a real `deliveryos pull` (via a `local-test`-shaped
local git remote if you're not ready to push for real -- see
`docs/backend-plugin-demo-script.md`'s own setup for the pattern), and
watch what actually happens:

1. Does the build pass with ZERO manual intervention beyond filling in
   `install_params` and applying the suggested wiring? If not, something
   is missing from `post_install`.
2. If you declared `install_params` with real defaults meant to make
   local dev "just work" (a local dev database, say), confirm it
   actually does -- don't assume a default resolves correctly.
3. Walk the REAL functional flow this artifact provides (a real login,
   a real API call) -- not just "the build compiles." A build passing
   proves imports resolve; it proves nothing about whether the feature
   actually works.
4. If you declared `post_remove`, actually run `deliveryos remove` and
   confirm whatever `post_install` started is genuinely gone (check a
   real running container/process list, don't just trust the exit code).

### 9. Push

`deliveryos push --new` has no CLI flags for `install_params`/
`wiring_actions`/`post_install`/`post_remove` -- write/finish the
manifest by hand on the remote's own local cache and validate it
parses against the real schema before committing:

```
node -e "
const { ManifestSchema } = require('./dist/engine/manifest/schema.js');
const { parse } = require('yaml');
const fs = require('fs');
const result = ManifestSchema.safeParse(parse(fs.readFileSync('manifest.yaml', 'utf-8')));
console.log(result.success ? 'VALID' : JSON.stringify(result.error.issues, null, 2));
"
```

## Worked examples

**`email-code-auth`** -- passwordless email login, deliberately no
database (a stateless HMAC-derived code instead of a stored token).
Real bugs found and fixed on this exact artifact: no `post_install` at
all (added, installing `next-auth@beta`); the fixed-`cd` filesystem-
pollution bug (fixed, switched to `DELIVERYOS_PROJECT_ROOT`); Node's
`crypto` module doesn't run in the Edge Runtime `middleware.ts` reaches
(fixed with Web Crypto's `crypto.subtle`, a global in both runtimes).

**`kortix-auth-shell`** (a `kind: ui-feature`, same install_target/
post_install rules apply) -- same missing-`post_install` bug (`framer-
motion`/`lucide-react` never installed), same fixed-`cd` bug, both
fixed the same way.

**`nextauth-credentials`** -- Prisma + bcrypt + a real Postgres
`DATABASE_URL`, 4 `wiring_actions` including a root-layout
`SessionProvider` wrap. The artifact this skill's whole "real
dogfooding" standard was proven against: found completely missing
`post_install` (nothing installed at all), a real `prisma@8` version-
drift trap (pinned to `prisma@6`), and confirmed the Prisma-CLI
`.env`-vs-`.env.local` split for real. A local-test variant additionally
adds a real `post_install`/`post_remove` pair starting/stopping a
throwaway local Postgres container -- verified end to end: pull starts
a real container, `deliveryos remove` actually destroys it (confirmed
via `docker ps`, not assumed).

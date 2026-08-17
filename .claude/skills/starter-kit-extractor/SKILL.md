---
name: starter-kit-extractor
description: "Turn a real, existing project (a live repo or local folder, from a tiny scaffold to a large multi-page app) into a working, pullable DeliveryOS kind:template artifact -- physically assembled, cleaned of real bugs found by actually running its own tooling, and verified end-to-end (including real interactivity/animation) in a headless browser"
tools: Read, Write, Edit, Bash, Grep, Glob, Agent
---

# Starter Kit Extractor

Turns a whole existing project -- someone's real app, a company template
repo, a scaffold someone already built and wants to make reusable -- into a
real, working `kind: template` artifact in a DeliveryOS remote: pulled as
one unit (`install_target: <artifact-id>`, never merged into an existing
project), not a component or a config file.

## When to activate

- "Make this our starter kit" / "turn this project into a DeliveryOS
  template" / "package this repo so people can pull it whole."
- The source is a real project directory or repo -- not a single pasted
  component (that's `ui-component-extractor`) and not a handful of config
  files (that's just a plain `push --new`).

## This produces a REPLICA, not a reinterpretation

The output should be the same real app -- same pages, same look, same
structure, same behavior -- not a simplified, reorganized, or
"improved" version of it. The ONLY changes allowed are:

1. Genuine, confirmed bugs (step 3's categories: a broken import, dead
   CSS, an undefined token, a missing route, dead-code logic, an
   actually-invalid CSS value) -- each one verified as real, never
   assumed, and each one documented in the README's cleanup section.
2. Required adaptations to fit DeliveryOS's own conventions: real secret
   values become `install_params` instead of hardcoded env values;
   preview-safe stand-ins in `components/` swap a router/context
   dependency for a plain prop (never a redesign of the component itself).

Never rewrite working code "while you're here," never restructure
directories beyond what step 4's conventions require, never simplify a
real feature because it looks complex, never drop a real page/route/
component that isn't actually dead. If something in the source looks
questionable but you can't confirm it's a genuine bug (not just an
unfamiliar pattern), leave it as-is and note the uncertainty rather than
"fixing" a guess.

## How this differs from `ui-component-extractor`

That skill promotes ONE component out of pasted source into
`src/ui/<Name>/`, to be scanned and pulled individually. This skill takes
a WHOLE project -- routing, layout, pages, auth, build tooling, the works
-- and ships it as one cohesive, pullable unit. A project can (and often
should) go through both: extract its genuinely reusable page-shell pieces
(`Header`, `Footer`, `Layout`, ...) into a design-kit-shaped `components/`
directory as part of THIS skill's own process (see "Payload structure
conventions" below), while the whole assembled app ships as the template
itself.

## Hard constraints this process has to work within

These aren't style preferences -- they're how the engine actually behaves,
confirmed against real code, not assumed:

1. **`payload_path` cannot cross repositories.** `pullArtifact`/
   `pushArtifact`/`compileArtifactPreview` (`src/engine/pull/pull.ts` and
   friends) all resolve a payload strictly relative to the OWNING remote's
   own local clone. If the source project lives in a different repo than
   the target DeliveryOS remote, its content must be physically COPIED
   into that remote's own `artifacts/<id>/payload/` tree -- never
   referenced in place, and `payload_path` is not an escape hatch for this
   (it's for a remote registering its own already-tracked files, e.g.
   ArcOS's real catalog, not for pulling in a genuinely separate repo).

2. **`kind: template` conventions**, confirmed against real, already-shipped
   manifests (`arcos-cli`, `launchpad-template`), not guessed:
   - `install_target: <artifact-id>` -- a named subdirectory. Never `"."`
     (that's reserved for a different shape: an artifact that MERGES into
     an existing project, e.g. a lint/tooling scaffold).
   - `review_required: false`.
   - `post_install: <setup command>` (`npm install`, `pip install -e
     ".[dev]"`, etc.) -- runs once, right after the payload copy.
   - Real required config (API keys, tenant IDs, anything the installing
     PROJECT must supply) goes in `install_params`, never hardcoded or
     defaulted with a real-looking value. `ManifestSchema`
     (`src/engine/manifest/schema.ts`) refuses a `secret: true` param that
     also declares a `default` -- schema-enforced, not just a convention.

3. **`push --new` (CLI) has no flags for `install_params`/`wiring_actions`.**
   Confirmed twice against real pushes: a hand-written `manifest.yaml`
   placed inside `--path` gets miscategorized as a payload file and copied
   verbatim, not used as the manifest. Fix: push the payload via CLI flags
   only first, then `git fetch`/`checkout` the pushed branch directly in
   the remote's real local cache (`~/.deliveryos/remotes/<name>`),
   hand-edit `manifest.yaml` there, validate with
   `ManifestSchema.safeParse(...)` before committing, `git push
   origin HEAD:<branch>`, then `git checkout main` to leave the cache
   clean.

## Process

### 1. Survey before reading -- scale the approach to the project's size

Don't start by reading every file. First, cheaply establish the shape of
the whole project:

- `package.json` (or the stack's equivalent): framework, real dependency
  list, scripts (`dev`/`build`/`test`/`lint`).
- The real directory tree (respecting `.gitignore` -- `find`/`Glob`, not a
  manual walk), config files (`vite.config.*`, `tsconfig*.json`,
  `eslint.config.*`, `.stylelintrc*`, tailwind config, ...).
- The real entry point(s) -- `main.tsx`/`index.tsx`, the root `App`
  component, the routing config file.
- Any existing `README`/docs already in the source -- often names the
  real intent behind pieces that aren't obvious from code alone.

**For a small project** (roughly: fits in a normal Explore pass, a few
dozen files), read the real source directly, file by file, as you assemble
it.

**For a large or very large project** (a real multi-page app, a monorepo,
hundreds of components): don't try to hold the whole thing in your own
context. Launch multiple `Explore`/general-purpose agents IN PARALLEL,
each scoped to one real subsystem -- e.g. one on routing + page structure,
one on layout/design-tokens/theming, one on auth/data-fetching, one on
state management -- and have each report back concretely what's real,
what's reusable, and what's dead weight, with file:line citations. Then
assemble from their findings, spot-checking anything load-bearing
yourself rather than re-reading everything they already covered. This
mirrors how this same session handled `GA_Global_Template_ReactTS`'s
three separate real pieces (`azure-msal-sso`, four design-kit components,
`react-vite-lint-scaffold`) before ever attempting the combined whole-repo
assembly -- survey and extract the real, separable pieces first, THEN
assemble the cohesive whole from already-understood parts, not the other
way around.

### 2. Classify everything -- real content vs. cruft vs. secrets

- **Real, ship it**: actual pages/routes, actual layout/shell components,
  actual design tokens, actual auth/data-fetching wiring, actual build
  tooling config.
- **Build output / never ship**: `node_modules/`, `dist/`/`build/`,
  `.next/`, `.turbo/`, coverage output, `.git/` (skip unconditionally
  while walking the payload, regardless of `.gitignore` content -- git
  itself never applies `.gitignore` to `.git`, so a project's own
  `.gitignore` typically doesn't even list it).
- **Editor/IDE cruft**: `.vscode/` (unless the project deliberately checks
  in shared settings), `.idea/`.
- **Real secrets -- never copy real values.** `.env`/`.env.local` files
  with real-looking secrets: don't ship the values. Convert each real
  required variable into an `install_param` (`secret: true` for anything
  that looks like a credential) instead -- the installing project supplies
  its own value at Pull time. `.env.example`/`.env.*.local` files that are
  just placeholder scaffolding for the ones above: usually safe to drop
  entirely once `install_params` covers the same ground (real, confirmed
  precedent: four near-identical `.env.*.local` files with fake
  placeholder values were dropped this way in `growtharc-react-vite-starter`).
- **Stock framework boilerplate nobody meant to ship**: the default Vite
  counter demo, a CRA spinning logo, a fresh Next.js starter page -- if
  `main.tsx`/the entry point still renders the framework's own out-of-the-
  box demo content instead of the project's real app, that's a real bug in
  the SOURCE (not something to preserve faithfully), and gets replaced
  with the real app's actual entry chain.
- **Draft/duplicate files**: `X copy.tsx`, `AuthProvider copy.tsx`,
  `Foo2.ts` sitting next to `Foo.ts` -- grep for real references to each
  candidate; if one is genuinely never imported anywhere, or is a stale
  fork of a real file that WAS wired in, drop it, don't ship both.
  Same for two parallel implementations of the same concern (this
  session found a real example: a context-based `useAuth` hook alongside
  a second hook bypassing context entirely -- only the one actually wired
  through the app shipped).
- **Legacy/redundant configs superseded by a newer tool version**:
  `.eslintrc.js` sitting alongside a flat `eslint.config.js` (ESLint 9's
  flat config doesn't read the old format at all), a `.huskyrc` next to
  real `.husky/` hooks, etc. -- drop the superseded one, don't carry
  dead config forward.

### 3. Read every real file you're about to ship -- don't blindly copy

This is the step that actually catches bugs, and it only works if you
read the real content, not skim it. Real, confirmed categories of bugs
found this way (not hypothetical -- each of these was a genuine bug in a
real source project, caught only by actually reading the file, not by any
tool):

- **Import-casing bugs that only worked by accident.** `./header.scss`
  importing a file actually named `Header.scss` -- silently fine on a
  case-insensitive filesystem (Windows/macOS default), a real broken
  import on case-sensitive Linux CI. Fix the casing to match the real
  filename.
- **Dead CSS with no matching markup anywhere** -- a `.dropdown-menu`/
  `.user-profile-wrap` block styling elements that don't exist in any
  JSX. Drop it, don't port it forward.
- **CSS custom properties that were never actually defined** -- a
  stylesheet referencing `--font-weight-normal` when the real design-token
  file only defines `--font-weight-regular`; the browser silently falls
  back to its own default (sometimes numerically identical, which is why
  this hides so well), never producing an error. Fix the reference to the
  token that's actually defined.
- **Orphaned files** -- confirm via grep whether a component is ever
  actually referenced in the real route tree/import graph before shipping
  it. A near-duplicate of a real, wired-in component that itself is never
  imported anywhere is dead weight, not a real alternative.
- **Missing routes that are real dead-ends in the source** -- no route for
  bare `/`, or a guard/redirect target (`/unauthorized`, `/login`) that's
  never actually registered as a route despite the guard logic redirecting
  there. These are real, user-facing bugs in the source, not something to
  preserve faithfully.
- **Dead-code guards** -- a conditional redirect whose real branch is
  commented out, so the function always falls through to the same
  `<Outlet/>` regardless of the condition it claims to check. Restore the
  real intended behavior.
- **Actually-invalid CSS values that happen to silently no-op** -- e.g.
  `background-color: none` (not a legal CSS value; `transparent` is) --
  these don't error, they just silently do nothing, and are typically
  only caught once a real linter/build actually runs against them (step 4
  below), not by reading alone.

### 4. Assemble the payload for real -- with a stable, feature-aware structure

Since `payload_path` can't cross repos, physically copy (or write) content
into the target remote's own `artifacts/<id>/payload/` tree. Reuse
already-fixed pieces from OTHER existing artifacts in the same remote
where the content is genuinely the same (don't re-derive or re-fix
something already fixed elsewhere -- `growtharc-react-vite-starter` reused
`azure-msal-sso`'s already-fixed auth payload and `react-vite-lint-scaffold`'s
already-cleaned tooling configs verbatim, rather than re-solving either).

#### Payload structure conventions -- where things go, and why

These aren't arbitrary; several map directly to real DeliveryOS Detail-view
features that only work if content lives at the expected path:

| Path | What goes here | Why this exact path |
|---|---|---|
| `README.md` (payload root) | Setup steps, required env vars, what the template includes | Read verbatim by `artifact.readPayloadFile`, rendered in Detail's Documentation tab |
| `GUIDELINES.md` (payload root) | Color tokens, type scale, spacing/radius, layout notes, per-component usage rules -- see `parseGuidelinesTokens.ts` for the exact expected heading structure (`## Color tokens`, `## Type scale`, `## Spacing & radius scale`, `## Layout grid`, `## Per-component usage rules`) | Drives Detail's Design AND Components tabs (`artifact.parseGuidelines`) -- get the headings right or the structured extraction silently returns nothing |
| `src/routes.tsx` | The real route tree, built with `createBrowserRouter([...])` | This EXACT conventional path is what `artifact.parseRoutes`/`parseRoutesTree.ts` looks for -- put the route tree anywhere else and Detail's Routes tab simply won't find it |
| `src/layout/` | Page-shell components used by the router (`Header`, `Footer`, a `Layout` wrapping `<Outlet/>`) | Distinct from `src/ui/` (generic shared primitives) and from `components/` (below) -- these are structural/app-shell, not general-purpose |
| `src/pages/` | One file per real route/page | Keep pages thin; real logic belongs in `src/lib/<concern>/`, not duplicated per page |
| `src/lib/<concern>/` | Auth, data-fetching, and other real app-level wiring, one subdirectory per concern (`src/lib/auth/`, not everything dumped in one `utils.ts`) | Mirrors this session's own real precedent (`src/lib/auth/{msalInstance,AuthContext,AuthProvider,useAuth,ProtectedRoute,...}.ts(x)`) |
| `src/design-tokens/` | Real CSS custom properties / theme files, copied from the source verbatim (these are usually already correct, unlike ad-hoc component CSS) | Kept separate from component-level styles so the real token source of truth is obvious |
| `components/<Name>/<Name>.tsx` + `components/<Name>/preview.tsx` | Self-contained, preview-only versions of the project's OWN real page-shell pieces (`Header`, `Footer`, `Layout`, `RootErrorBoundary`, ...) | Gives the template artifact its OWN live Components/Design tabs in Detail (same `artifact.parseGuidelines`/`listPayloadComponents` mechanism `design-kit` uses) -- write these as genuinely self-contained (no cross-directory imports; the compile sandbox rejects them), with any router/context dependency swapped for a plain prop, matching `ui-component-extractor`'s own react-import-fix precedent |

A component can legitimately exist in BOTH `src/layout/` (the real,
production version the app actually renders) and `components/<Name>/`
(a separately-authored, preview-safe stand-in) -- these are two different
audiences (the running app vs. someone browsing Detail before pulling
anything), not a contradiction. Document this explicitly in `GUIDELINES.md`'s
own intro if you do this, so it doesn't read as accidental duplication.

#### Writing `GUIDELINES.md` -- new documentation, extracted values only

Almost no source project already has a file shaped like this -- it's new
documentation you write, not something copied over. But every value in it
must trace back to something REAL in the source, never invented:

- **Color tokens**: pull the actual hex values from the source's own real
  theme/CSS-custom-property files (`:root { --color-brand-300: #1e3c53;
  ... }`, a `tailwind.config` theme block, a Sass `$variables` file --
  whatever this project's own real source of truth is). Group and label
  them the way the source itself does (a `--color-feedback-danger-*` ramp
  stays a ramp, don't flatten it).
- **Type scale**: the real `font-family` stack(s) actually declared
  (`--font-family-base: 'IBM Plex Sans', sans-serif` is a REAL, citable
  value; "looks like a sans-serif app" is not), the real sizes/weights
  actually used for headings vs. body vs. UI text -- read the real CSS,
  don't estimate from how a screenshot looks. If the source only defines
  ONE typeface for everything (no separate serif/display face), say so --
  don't invent a second one because other design-kit examples in this
  repo happen to have one; `growtharc-react-vite-starter`'s own real
  `GUIDELINES.md` explicitly notes it has a single typeface throughout,
  unlike `design-kit`'s own convention, because that's what its real
  tokens actually define.
- **Spacing & radius scale**: the real numeric scale the source's own
  tokens define (`--spacing-size-md: 3rem`, `--border-radius-lg: 1rem`,
  ...) -- if the source has no consistent scale at all (ad-hoc pixel
  values scattered per component), don't manufacture one; note that
  explicitly instead of inventing a clean scale that doesn't exist.
- Cite the real file each value came from in the doc's own intro
  paragraph (`growtharc-react-vite-starter`'s real `GUIDELINES.md` opens
  with exactly this: "Tokens below are sourced directly from this
  artifact's own real `src/design-tokens/theme-global.css`/`globals.css`") --
  this is what makes the doc auditable against the real source later,
  not just prose someone has to trust.
- **If the source genuinely has no real, extractable design-token file at
  all** (inline styles with no shared scale, wildly inconsistent ad-hoc
  values, no theme file of any kind) -- don't write a `GUIDELINES.md` that
  invents one. Skip it entirely; Detail's Design/Components tabs simply
  won't apply for this artifact (same "gate on real presence, never
  fabricate" rule as everywhere else in this process), and that's the
  honest outcome for a project that genuinely has no real design system
  to extract.

#### `manifest.yaml`

```yaml
id: <artifact-id>
kind: template
description: "..."
owner: <owner>
version: 1.0.0
source_repo: <where this was extracted from>
install_target: <artifact-id>
review_required: false
post_install: npm install   # or the real equivalent for this stack
install_params:
  - key: REAL_REQUIRED_ENV_VAR
    description: "..."
    required: true
    secret: false   # true for anything credential-shaped
```

### 5. Verify the tooling for real -- never assume clean

Run this project's REAL scripts against the REAL assembled payload, in
this order, fixing whatever actually breaks:

1. Install real dependencies (`npm install`/`pip install`/etc.) in a real
   scratch copy.
2. Typecheck (`tsc -b`, or the stack's equivalent).
3. Build (`vite build`, `next build`, ...) -- confirms the whole thing
   actually compiles together, not just each piece in isolation.
4. Lint/format/stylelint/whatever the project's own tooling includes.
5. Any existing test suite.

**Two real, previously-unknown bugs in a real source project were only
caught this way**, in this exact session, not by reading source alone:
`stylelint-config-standard` cannot parse SCSS-specific syntax (`@use`,
`@mixin`) at all -- silently invisible until stylelint was ACTUALLY run,
fixed by switching to `stylelint-config-standard-scss`; and a real,
invalid `background-color: none` value, only surfaced once the SCSS
parsing fix let stylelint actually reach that rule. Neither would have
been caught by inspection -- run the real tools.

### 6. Verify real interactivity and animation end-to-end

Compiling clean is not the same as working. For anything with real
client-side behavior -- routing, auth guards, animations, interactive
state -- actually run the assembled app (`vite preview`, or the stack's
real dev/start command) and drive it with a real headless browser
(`playwright-core`'s `chromium.launch({channel: 'msedge', headless:
true})` -- this exact technique already works in this environment with no
extra setup) to confirm the REAL behavior, not just that it compiles:

- **Routing**: does navigating to a real route actually render that
  page? Does an auth guard actually redirect when unauthenticated (real,
  confirmed technique: fake-but-syntactically-valid env vars, a real
  build+preview server, a real Playwright check confirming `/` redirects
  to `/unauthorized` and that page's real content renders)?
- **Animation**: does a `framer-motion`/CSS-transition/scroll-triggered
  animation actually fire? A real click that's supposed to trigger a
  layout animation should be confirmed by driving the actual interaction
  and checking the resulting DOM/class state changed, not just that the
  animation library's import resolved.
- **Interactive state**: does clicking a real interactive element (a tab,
  an accordion, a modal trigger) actually update the DOM the way the
  source code claims it should?

For a **large, many-paged site**, don't try to exhaustively click through
every page -- verify the real critical paths (the main entry flow,
primary navigation, one or two representative interactive/animated
moments that exercise the riskiest real wiring) rather than attempting
full coverage neither the user nor a real code review would expect for an
artifact of this kind.

### 7. Document what was actually found and fixed

A real "What was cleaned up from the source" section in the README,
specific about each real fix (not "various improvements") -- this is both
honesty about what changed from the original source and a genuinely
useful record for anyone later auditing why the artifact's content
differs from where it came from.

### 8. Push

`push --new` via CLI flags only first (no `install_params`/
`wiring_actions` support there -- see the hard constraint above), then
add those directly on the pushed branch in the remote's real cache,
schema-validated via `ManifestSchema.safeParse` before committing. Real
PR, with the real verification evidence (what was run, what it confirmed)
in the description -- not just "assembled and pushed."

## Worked example

`growtharc-react-vite-starter` (this same session, real PRs:
[growtharc-ai-helpers#63](https://github.com/ashwin-growtharc/growtharc-ai-helpers/pull/63)
onward) is a complete, real run of this whole process: surveyed a real
source template (`GA_Global_Template_ReactTS`), reused two already-
extracted pieces (`azure-msal-sso`, `react-vite-lint-scaffold`) rather
than re-deriving them, assembled the rest fresh (`src/routes.tsx`,
`src/layout/`, `src/design-tokens/`, `src/pages/`), found and fixed every
real bug category listed in step 3 plus the two genuinely new
tooling-specific ones in step 5, verified the assembled auth+routing
chain end-to-end with a real headless-browser check, and later had its
own real page-shell pieces (`Header`, `Footer`, `Layout`,
`RootErrorBoundary`, plus a synthetic `AppShell` combining them) extracted
into `components/` so its own Detail view shows a live Design/Components
grid, not just a README. See this repo's own `PLAN.md` (search for
"whole-repo template for the company starter kit") and `CHANGELOG.md` for
the complete, real account.

# UI Components in DeliveryOS — Feature Design (Brainstorm Draft)

**Status:** brainstorm / not yet planned into phases. **Owner:** unassigned.
**Related:** [ARCHITECTURE.md](../ARCHITECTURE.md) (kind system, manifest,
Pull/Push model), [DESIGN_SYSTEM.md](../DESIGN_SYSTEM.md) (visual language
this reuses).

## TL;DR — the whole flow, end to end

Everything below goes deep on one piece at a time. Here's the whole loop,
in plain English, before any of the detail:

1. You ask Claude Code to pull the reusable pieces (buttons, cards,
   navbars) out of a project.
2. Claude Code finds them, tidies each one into its own little package —
   the real component plus a small demo file — and leaves them sitting
   in your project. Nothing's shared yet.
3. DeliveryOS's Scan notices these new pieces.
4. For each one, you (or Claude Code, from the terminal) hit "Propose" —
   DeliveryOS shows a **real, working preview right there**, so you see
   exactly what you're about to share, not just a description.
5. DeliveryOS opens a normal GitHub Pull Request — with a picture of the
   component right in it — same as any other code review.
6. Someone reviews it and merges it. Nothing DeliveryOS-specific here,
   it's genuinely just GitHub.
7. It's now live in the shared catalog. Anyone on the team can browse
   "UI Components," see it rendered live and interactive (not a
   screenshot), and pull it straight into their own project in one
   click.
8. If it changes later, everyone who already has it gets told an update
   is available, and can grab the new version the same way.

```
flowchart TD
    subgraph P1["Your project"]
        A["Ask Claude Code:<br/>'extract reusable components'"]
        A --> B["Button.tsx + preview.tsx<br/>left in your project"]
    end

    subgraph D["DeliveryOS"]
        B --> C["Scan notices them"]
        C --> E["Review & Propose<br/>(see it live, right there)"]
    end

    subgraph G["GitHub"]
        E --> F["Pull Request opened<br/>(with a preview image)"]
        F --> H["Reviewed & merged<br/>(ordinary GitHub review)"]
    end

    subgraph CAT["Shared catalog"]
        H --> I["Live for everyone,<br/>under 'UI Components'"]
    end

    subgraph P2["Someone else's project"]
        I --> J["Pull it in,<br/>one click"]
        J --> K["Real, interactive component<br/>in their own code"]
    end

    K -. "later: it gets updated" .-> C
```

Every section from here on is answering "okay, but what actually happens
at step N" for one specific step above.

## 1. The idea, in one paragraph

Today DeliveryOS shares agents, skills, commands, rules, templates, and docs.
The next kind is **UI components** — buttons, navbars, headers, cards, and
other reusable frontend pieces that an AI coding agent (e.g. Claude Code)
extracts from a real project. The one hard requirement that makes this
different from every existing kind: browsing a UI component in DeliveryOS
must show a **real, interactive, live preview** — hover states, focus
states, animations, actual working DOM — not a static screenshot, the way
component-doc sites like [seraui.com](https://seraui.com/docs/verify-badge)
render their components live on the page.

## 2. Data model — minimal schema change, reusing what exists

DeliveryOS's manifest (`src/engine/manifest/schema.ts`) already keeps `kind`
open-ended and deliberately avoids special-casing any one kind
(`ARCHITECTURE.md` §4.1 — even `agent-asset` uses the plain generic
Pull/Push path). This feature should follow the same discipline: no new
required schema fields.

| Need | Mechanism | Why no schema change |
|---|---|---|
| Mark an artifact as a UI component | `kind: "ui-component"` | Just another value in the existing open `kind: z.string()` |
| Framework (React, Vue, plain HTML) | Reuse the existing `tags.stacks` field (e.g. `stacks: ["react"]`) | `stacks` already means "tech stack" and already feeds Filter 2 (current-project stack routing, §5.3 of ARCHITECTURE.md) |
| Component category (button, navbar, header, card, ...) | **New tag dimension**, `tags.componentTypes: ["button"]` | Same free-form-array shape as `roles`/`teams`/`stacks` already use — Browse-by-tag's existing category-tabs/value-list/Tag-Folder machinery works on it with zero new filtering logic |
| Preview entry point | **Filename convention**: a co-located `preview.tsx` / `preview.vue` / `preview.html` sitting next to the component's source inside `payload_path` | Same spirit as `post_install` being an optional, convention-driven file — not a new manifest field |

Example manifest:

```yaml
id: primary-button
kind: ui-component
description: Primary CTA button with hover/press/disabled states
owner: frontend-guild
version: 1.0.0
tags:
  roles: [frontend]
  teams: [design-system]
  stacks: [react, typescript]
  componentTypes: [button]
source_repo: growtharc/deliveryos-ui-components
install_target: src/components/Button
payload_path: artifacts/primary-button/payload
review_required: true
```

`payload_path` folder contents: `Button.tsx`, `Button.module.css` (or
Tailwind classes inline), `preview.tsx` (the CSF-style demo file, §5).

## 3. Sidebar / UX

A new top-level sidebar item, **"UI Components"** — not folded into the
existing Browse-by-tag page, because its card needs a live rendered
preview, not text + an icon (a fundamentally different card template).

- Underline tabs across the top for category (Buttons / Navbars / Headers
  / Cards / ...) — reuses the `.tab-row` pattern already built for Kind
  filtering.
- Below: a grid of cards, each containing a live sandboxed preview + name
  + a "Pull" / "View code" action.
- Clicking a card opens a bigger Detail view: larger preview, the
  variant/controls panel (§5), and the full source.
- Previews lazy-render via `IntersectionObserver` — a grid of 50 button
  variants should not eagerly boot 50 iframes at once.

## 4. Preview rendering architecture

### 4.1 What was ruled out, and why

Researched real-world prior art before designing this (Storybook, Bit.dev,
Backlight.dev, zeroheight, CodeSandbox Sandpack, StackBlitz WebContainers,
react-live/react-runner, Web Components/Shadow DOM). Summary:

| Approach | Build timing | Offline? | Verdict for DeliveryOS |
|---|---|---|---|
| Storybook | Heavy build per project | Yes, once built | Too heavy — needs a full per-artifact build pipeline (deps, webpack/vite config) for what should be a small, independently-pushed snippet |
| Bit.dev / Backlight.dev / zeroheight | Build on ingest (hosted) | **No** | Wrong reference class — these are SaaS platforms with cloud build farms; DeliveryOS has no backend by design |
| CodeSandbox Sandpack | Client-side bundler, per-preview | Partial — wants npm registry access | Close, but the npm-fetch dependency conflicts with "works offline" |
| StackBlitz WebContainers | Real Node-in-WASM, per-preview | Partial — same npm dependency, heavier | Not built to be embedded outside StackBlitz's own product; highest resource cost surveyed |
| react-live / react-runner | In-browser JSX transform, no bundler | Yes | Too limited — single-file only, no real module resolution, no sandboxing of its own (same-realm eval) |
| Web Components / Shadow DOM | Compile-to-WC per component | Yes, once compiled | No general React→WC compiler exists for arbitrary pre-existing React source; solves style isolation, not script sandboxing |
| **Sandboxed iframe + local esbuild** | **Local, at preview time** | **Yes** | **Chosen** — see below |

### 4.2 The chosen architecture

```
   pushed component source (React/Vue/HTML)
                 |
                 v
   ┌─────────────────────────────┐
   │  Compiler adapter (per       │   <- the ONLY framework-specific part
   │  framework: React/TS, Vue,   │
   │  HTML, ...)                  │
   │  - compiles source           │
   │  - derives a props schema    │
   │    (docgen, see §5)          │
   └─────────────────────────────┘
                 |
                 v
   local esbuild bundle, vendored
   React/Vue runtime, inlined CSS
                 |
                 v
   single self-contained HTML doc
   (<style> + plain <script> IIFEs —
    see §7.5's Phase B note: no
    "type=module", since an IIFE has
    no module system to satisfy any
    import/require at all)
                 |
                 v
   <iframe sandbox="allow-scripts">   <- opaque origin: NO allow-same-origin
     srcdoc="<that HTML doc>"           (the one non-negotiable security rule)
   </iframe>
                 |
                 v
   cached by (artifact id, version) hash
   next view is instant, no rebuild
```

**Compilation happens locally**, via the native `esbuild` binary already in
this repo's `devDependencies` (used today for `build:sidecar`) — not
esbuild-wasm, not a hosted bundler, no npm-registry round trip. Bundle
against a small set of **vendored** framework runtimes DeliveryOS ships
with the app itself (a pinned React/ReactDOM build, a pinned Vue runtime),
so there's no per-artifact dependency resolution. Plain HTML/CSS/JS
components skip the bundle step entirely — straight to `srcdoc`.

**Security is the one non-negotiable rule**: `sandbox="allow-scripts"`,
deliberately **without** `allow-same-origin`. This is the single most
commonly-botched detail in "safe" iframe sandboxing — adding
`allow-same-origin` back would let a malicious pushed component reach
`window.parent`, cookies, and localStorage. Omitting it gives the frame a
genuinely opaque origin, enforced by the browser itself, regardless of
what the pushed script tries to do.

**Extensibility**: this is a pluggable **compiler-adapter** interface, not
a React-specific pipeline — every framework adapter implements the same
contract (`compile(source) → { bundle, propsSchema }`), and the
rendering/sandboxing/caching machinery around it never changes. React +
TypeScript and plain HTML/CSS/JS ship first (most common real-world case,
plus the free zero-build path); Vue, Svelte, and Angular are each one more
adapter later, not a redesign.

## 5. Storybook-style interactive controls

Fixed live preview alone (hover/focus/animation work, but no prop
switching) was the cheaper option; the decision was to build real
Storybook-style controls instead. Mechanism, closely mirroring how
Storybook itself actually works (just computed locally, not via a
project-wide build):

1. **Prop schema, auto-derived, not hand-written.** Run
   `react-docgen-typescript` (pure TS, offline, no network) against the
   component's own `Props`/`interface` definition to extract a controls
   schema — name, type, default, enum values. This is the same technique
   Storybook's own "autodocs" uses. The extracting agent never hand-writes
   a controls schema; it falls out of the TypeScript types that already
   exist on the component.
2. **Named variants via CSF-style exports.** `preview.tsx` is a mini
   Storybook CSF (Component Story Format) file:
   ```tsx
   export const Primary = () => <Button variant="primary">Click me</Button>;
   export const Disabled = () => <Button disabled>Click me</Button>;
   ```
   Each exported variant becomes a tab/dropdown on the preview card.
3. **Live prop editing inside the sandbox, via postMessage.** The controls
   panel (dropdowns/toggles/text inputs generated from the docgen schema)
   lives in the parent DeliveryOS UI, outside the sandbox. On change, it
   posts `{ props }` into the iframe; a small harness script inside the
   bundle listens and re-renders
   (`root.render(<Component {...props} />)`). Never reach directly into
   the iframe's `window` — the opaque-origin boundary from §4.2 stays
   intact either way.
4. Vue's equivalent of docgen is parsing `defineProps`/`<script setup>`
   via `@vue/compiler-sfc` — same shape, a different adapter.

**Phase C correction, real-implementation gaps this section's original
sketch left open** (see `PLAN.md`'s Phase C entry for the full write-up):

- **A CSF variant must be CALLED, not wrapped as a component.** Point 3's
  `root.render(<Component {...props} />)` assumes something already knows
  which `Component` and starting `props` a given variant represents — but
  `export const Primary = () => <Button variant="primary">...</Button>`
  is a zero-arg function; re-rendering it as `React.createElement(Primary,
  editedProps)` would silently ignore whatever props were edited, since
  `Primary` itself never reads props at all. The real mechanism: the
  harness calls the variant function directly (a plain JS call, not
  through React) and reads `.type`/`.props` off the returned element —
  standard, documented React object shape, not a hack.
- **`srcdoc` iframes have an opaque `"null"` origin** — this section's
  "never reach directly into the iframe's `window`" is right, but §8's
  `event.origin`/`event.source` validation guidance is imprecise: `origin`
  is useless here (every `srcdoc` iframe on the page shares the same
  opaque `"null"` string, including multiple grid cards mounted-but-hidden
  behind Detail simultaneously). Only `event.source` — a reference check
  against a specific `contentWindow`/`window.parent` — is sound.
- **Minification breaks name-based matching.** The controls panel looks up
  a props schema by the currently-rendering component's name; esbuild's
  minifier (already on, `minify: true`) renames top-level identifiers,
  which changes that runtime `.name`. Fixed with `keepNames: true` on the
  `esbuild.build()` call — cheap, esbuild's own documented escape hatch
  for exactly this problem.
- **One compile call gets everything, upfront** — the bundle includes ALL
  variants (not just one), and the whole point of bundling this way is
  that variant switching and prop editing both happen against the same
  already-loaded iframe via `postMessage`, with no recompile and no
  further sidecar round-trip per interaction.
- **The docgen schema never enters the iframe bundle.** It's derived once
  server-side from the original unbundled `.tsx` source (the real
  TypeScript compiler, unlike the esbuild adapter which never
  type-checks) and returned in the sidecar's JSON response — the parent
  UI builds control widgets from it directly; only plain prop *values*
  (never the schema, never code) cross the `postMessage` boundary.
- **Docgen file-discovery convention**: runs against every non-preview
  `.tsx`/`.jsx` file sibling to `preview.tsx` in the artifact's own
  payload directory, matched by docgen's `displayName` against whichever
  component the harness reports rendering — avoids requiring `preview.tsx`
  to explicitly declare its own Props interface.

## 6. Extraction / Scan flow

Scan today parses frontmatter in `.claude/agents|skills|commands|rules`.
UI components need a genuinely different detection heuristic: scanning
for component-shaped exports (a function returning JSX with a co-located
`Props` type) — **not** frontmatter. Decision: route this through the
**existing** Scan → Review & propose → wizard pipeline rather than
building a parallel UI, reusing real, tested infrastructure.

**The glob can't assume one folder-naming convention.** An early version
of this design assumed a glob like `src/components/**/*.tsx` — that
would silently miss a project using `src/ui/*.tsx`, or `elements/`, or
`design-system/`, or any other convention (every team names it
differently). Relying on a folder name to *find* candidates is the wrong
foundation. Instead: scan broadly — `src/**/*.{tsx,jsx}` (excluding
`node_modules`, and probably `pages/`/`app/`/`routes/` as a first-pass
noise filter) — and let the **structural heuristic** (does this file
export something that returns JSX, ideally with a `Props` type) do the
real filtering. Cast a wide net structurally, filter semantically, not by
folder-naming convention.

Two knock-on benefits of reusing that pipeline:
- If no `preview.tsx` exists yet, Scan can **auto-scaffold a minimal
  stub** (`export const Default = () => <ComponentName
  {...inferredExampleProps} />`) — same spirit as today's "AI guessed"
  description, left fully editable in Review.
- **Review becomes a live visual check** ("does this actually render
  right?") instead of just reading text fields — a bigger UX win here
  than it is for agents/skills, since the component can be seen, not just
  described, before it's proposed.

## 7. Push / Pull / Edit mechanics — grounded in the real engine

`pullArtifact`/`pushArtifact` (`src/engine/pull/pull.ts`,
`src/engine/push/push.ts`) never branch on `kind` anywhere. A
`ui-component` artifact rides through two of the three flows with **zero
new engine code**.

### 7.1 Pull — unchanged

`fs.cpSync(payloadSrc, installTarget, {recursive:true})` copies the whole
payload folder (`Button.tsx`, `preview.tsx`, any `.module.css`) into
wherever `install_target` says (e.g. `src/components/Button/`), runs
`post_install` if set, snapshots a pristine copy via `pristinePath(cwd,
id)` for later diffing, upserts the lockfile. Identical to pulling a
template or a doc today.

`preview.tsx` lands in the consumer's real project alongside the real
component — not a gap needing an exclusion filter, the same convention
real component libraries already use (`Button.stories.tsx` sitting next
to `Button.tsx`). No new mechanism needed.

### 7.2 Push (edit mode) — unchanged, but exposes a real pre-existing gap

`computeChangedFiles` diffs `installTarget` against the pristine snapshot
and copies back whatever changed (real source, the demo file, or both) to
the remote's `payload/` dir, branches, commits, opens a PR. Pulling a
button, tweaking its hover color, and pushing gets the exact same
edit-mode PR flow every other kind gets.

**The gap**: edit-mode push stages only the changed payload files — it
never touches `manifest.yaml`, and `PushOptions` has no `version` field
outside propose-new mode. `manifest.yaml` isn't even part of what's
copied into `install_target` on Pull, so there's no local copy to edit
even if a pusher wanted to bump it by hand. **There is, today, no way for
a normal content-edit push to change `version` at all**, short of someone
manually editing the PR's diff on GitHub after DeliveryOS already opened
it.

This is a pre-existing gap for every kind, but it's load-bearing here,
not cosmetic:
- `checkForUpdates` (`src/engine/sync/sync.ts`) does a pure
  `compareVersions(remote.version, lockfile.version)` — no content
  hashing. If version never bumps, **nobody who already pulled the
  component is ever told an update exists**, even after the edit PR
  merges.
- The preview cache (§7.5) is keyed on `(id, version)`. If version never
  changes, the cache never invalidates either — a merged styling fix
  could sit upstream indefinitely while every existing puller's copy,
  cache included, silently stays stale.

**Concrete fix needed**: edit-mode push needs an explicit version-bump
input — a `--bump patch|minor|major` CLI flag / a field in Detail's Edit
form — defaulting to an automatic patch bump whenever payload *content*
(not just metadata) actually changed.

**The PR's `preview.png` needs to regenerate on edits too.** §7.4's
screenshot step was scoped to propose-new; it needs the same
file-presence-gated step on every edit-mode push, or GitHub's free
before/after image diff would show a stale screenshot pretending nothing
visually changed — actively misleading, worse than no image.

**Once merged with a real version bump**, everything downstream is
already fully generic: `checkForUpdates` flags `update_available` (or
`both_changed` if the puller also has local edits), and a fresh Pull
replaces the whole payload folder atomically — `Button.tsx` and
`preview.tsx` always arrive as a matched pair, so there's no risk of
pulling a new component against a stale demo file. One thing that stays a
genuine open risk rather than something this feature solves: a puller
who locally edited only `preview.tsx` while an upstream update changes
`Button.tsx`'s props out from under it is a real merge conflict — the
same unresolved risk `ARCHITECTURE.md` §9 risk #3 already names ("a real
merge has no designed behavior yet"), not something new here.

### 7.3 Push (propose-new mode) — one real schema addition

Everything else already works generically (`payloadPath`, `kind`,
`owner`, `roles`/`stacks`/`teams`, `installTarget`, `postInstall` are
already plain options `pushArtifact` accepts). The only actual code, not
just UI:

1. `src/engine/manifest/schema.ts` — add `componentTypes:
   z.array(z.string()).default([])` to `ManifestSchema.tags`. This is the
   one real schema change (§2's "no schema change" claim was about
   nothing being *required*; this is optional/additive, same shape as
   `roles`/`teams`/`stacks`).
2. `src/engine/push/push.ts` — thread `options.componentTypes` into
   `candidateManifest.tags` (propose-new branch), and add
   `componentTypes?: string[]` to `MetadataEditOptions` so it's
   retaggable later without touching the payload.
3. `app.js` — a fourth tag-picker in Add New (reusing `createTagPicker`,
   same pattern as Roles/Stack/Team), and add `'componentTypes'` to the
   existing `TAG_CATEGORIES` array so Browse-by-tag picks it up
   automatically, no new filtering logic.

Concretely, on submit: `pushArtifact`'s `isNew` branch builds the manifest
object, validates with `ManifestSchema.safeParse`, and writes it with
`stringifyYaml(manifest)` to `artifacts/<id>/manifest.yaml` inside the
cloned remote cache — literally where the YAML gets written, unchanged.
`listPayloadFiles` walks the component's folder recursively (respecting
`.gitignore`), copies each file into `artifacts/<id>/payload/`, and
manifest + every payload file get committed on a new branch, pushed, and
opened as a PR via the existing `buildProposeNewPrContent` template.

### 7.4 PR preview image

Two complementary mechanisms, not one:

1. **Free.** Commit a rendered `preview.png` alongside the component's
   payload (`artifacts/button/preview.png`). GitHub's own "Files changed"
   tab automatically renders it as an image diff — no markdown needed,
   and later edits even get a before/after image comparison for free.
2. **Deliberate.** Also embed it inline in the PR body (built by
   `buildProposeNewPrContent`) via
   `![Button preview](https://raw.githubusercontent.com/<owner>/<repo>/<branch>/artifacts/button/preview.png)`.
   `raw.githubusercontent.com` serves files from any pushed branch,
   merged or not, so this works the moment the branch is pushed — no
   hosting, no GitHub Pages, no CI required.

**Where the PNG comes from**: reuse the exact same compiled `srcdoc`
bundle from §4's pipeline (no separate build), render it once headlessly,
and screenshot the first/default CSF variant only — full variant
inspection is what the live app preview is for, the PR image is just an
at-a-glance check.

| | GUI path (Review & propose) | CLI path (Claude Code, autonomous) |
|---|---|---|
| Mechanism | Reuse Tauri's own webview — already rendering the live preview on the Review step at the exact moment Propose is clicked | No webview is open — needs a real headless render |
| New dependency | None | Headless Chrome via Playwright, pointed at the system's already-installed Chrome (`channel: 'chrome'`) — **not** bundling its own Chromium, meaningfully lighter than default Puppeteer |

Since the CLI path is likely the *more* common one for "extract
everything and propose it" (§11), the engine needs the headless-render
capability regardless — the Tauri-webview shortcut only covers the GUI
case.

**Honest tension**: every other claim in this doc has been "`pushArtifact`
never branches on kind." A screenshot step is the first real exception —
but it's framed as gated on **file presence** (does a `preview.*` exist in
this payload?), not a kind check, keeping it consistent with how
`post_install` already works (conditional on the field being present, not
on kind). Also worth naming honestly: committed PNGs bloat git history a
bit over time (binary, doesn't diff cleanly, regenerated on every visual
edit) — mitigate with modest fixed dimensions and compression, not a
blocker.

### 7.5 The one genuinely new, non-engine piece: the preview cache

The compiled `srcdoc` bundle from §4's pipeline is a derived build
artifact, not source — it must **never** be committed to the remote and
never appears in the manifest. It lives purely in a local cache keyed by
`(remote name, artifact id, version)`, computed on first view, invalidated
on version bump (a stale entry is simply never looked up again — nothing
explicitly prunes it off disk; see the still-open gap noted in `PLAN.md`'s
Phase B entry).

**Phase B correction to this section's original phrasing**: the cache is
**global** (`previewCachePath(remoteName, id, version)` under
`deliveryOsHome()`, alongside `remotesCacheRoot()`), **not** a
`pristinePath`-style sibling scoped to the cwd's `.deliveryos/` directory
as originally proposed here. The reasoning: `pristinePath` only makes
sense for an artifact that's already been *pulled* into a specific
project — but the whole point of the "UI Components" page is showing a
live preview of catalog entries **before** anyone decides to pull them,
read directly off the remote's own cache. A compiled preview for a given
`(remote, id, version)` is identical no matter which project folder
happens to be open, so a cwd-scoped cache would just recompile the same
output pointlessly per project.

**Phase B correction on vendoring**: React 19 ships no UMD build at all
(only `cjs/`, confirmed by inspecting `node_modules/react/umd/` — it
doesn't exist), so "vendored framework runtime" isn't a prebuilt file
DeliveryOS ships and loads as a global script the way this section
originally implied. Instead, `scripts/generate-vendored-react-runtime.mjs`
uses esbuild itself, ahead of time, to bundle a tiny shim (`import React
from 'react'; import { createRoot } from 'react-dom/client'; window.X =
{...}`) into one minified browser-safe IIFE, written to a gitignored
generated `.ts` file as a plain string constant and imported normally —
compiled directly into the sidecar bundle at build time, so there's no
runtime file resolution needed even inside the packaged, no-`node_modules`
`.exe`. The component's own bundle then uses a classic JSX transform
(`jsx: 'transform'` + a custom `jsxFactory`/`jsxFragment`) pointing at that
vendored global, rather than a real `import`/`require` of react/react-dom
— an IIFE has no module system at runtime, so marking those packages
`external` (this section's original assumption) doesn't work at all for a
non-ESM output format; there's nothing at runtime to satisfy an
unresolved `require('react')`.

## 8. Security notes (summary)

- Pushed component code is **never** rendered in the main webview DOM —
  always through the sandboxed iframe described in §4.2.
- `sandbox="allow-scripts"` with **no** `allow-same-origin`, always.
- A strict inline CSP (`<meta http-equiv="Content-Security-Policy">`
  inside the `srcdoc` string, since response headers aren't available for
  `srcdoc` documents) restricting `script-src`/`connect-src`/`img-src` to
  only what's actually needed.
- Parent ↔ iframe communication only via `postMessage`, with
  `event.origin`/`event.source` validated on receipt.
- Compilation (esbuild) runs locally on the consuming machine, not as a
  build executing on a shared CI/server — narrows the blast radius of a
  malicious `postinstall`-style trick to the individual machine doing the
  preview, same trust boundary as running `git clone` + reading the code
  yourself already implies.

## 9. Phased rollout (proposed)

| Phase | Scope |
|---|---|
| **A — Spike** | Prototype the sandboxed-iframe + local-esbuild pipeline end to end for one hardcoded example component. De-risk packaging size/latency before committing further (same spirit as ARCHITECTURE.md risk #11's sidecar-packaging spike). |
| **B — React + TS adapter, fixed preview** | **Done** — see `PLAN.md`'s Phase B entry. Shipped `tags.componentTypes`, the "UI Components" sidebar page, and the React/TS + plain-HTML compiler adapters with a single default-state preview (no controls yet). |
| **C — Storybook-style controls** | **Done** — see `PLAN.md`'s Phase C entry. Shipped `react-docgen-typescript` prop-schema extraction, all-variant bundling with a `postMessage` variant-switching/prop-editing protocol into Detail's new live preview, and the generated controls panel. |
| **D — Scan integration** | Extend Scan with the component-detection heuristic (glob-based, not frontmatter), auto-scaffolded `preview.tsx` stubs, and the live-preview Review step. |
| **E — Additional framework adapters** | Vue (via `@vue/compiler-sfc`), then Svelte/Angular as needed — each is one more adapter behind the same interface, not a redesign. |
| **F — Preview for large artifacts (roadmap, not blocking)** | Everything above assumes one small, atomic component. A `template`/starter-kit artifact (a whole scaffolded project, not a single Button) needs a fundamentally different notion of "preview" — showing how to *use* it, not rendering it in an iframe. Explicitly deferred: keep in mind when designing §3's pipeline so it doesn't accidentally assume "always one component," but don't solve it now. |

## 10. Open questions carried forward

- ~~Caching location/invalidation.~~ **Resolved (§7.5):** a global
  `previewCachePath(remoteName, id, version)` under `deliveryOsHome()`
  (not cwd-scoped — see §7.5's Phase B correction for why), keyed by
  (remote, id, version), never pushed/pulled. Explicit pruning of
  superseded versions' cached HTML is still an open gap, not solved here.
- ~~How much of the docgen/compile step should happen at **pull** time
  (pre-warm the cache) vs. lazily at first **view**?~~ **Resolved
  (Phase C):** lazily, at first view — `getOrCompilePreview`'s existing
  read-through cache already covers the "don't recompile every view"
  concern; pre-warming at pull time was never actually implemented and
  isn't needed for the interactive controls to work well in practice.
- ~~Does `install_target` need special handling for a UI component?~~
  **Resolved (§7.1):** no — `pullArtifact` is fully kind-agnostic; a
  component installs exactly like every other kind.
- ~~Multi-file components with extra co-located assets.~~ **Resolved
  (§7.1):** `payload_path` already supports a whole folder; a
  co-located `preview.tsx` landing in the consumer's project alongside
  the real component is expected, matching how `*.stories.tsx` files
  already work in real component libraries.
- **New gap, flagged in §11:** there's no "Propose all" bulk action for
  propose-new mode. Browse has bulk "Pull all"; proposing 15 extracted
  components today means clicking "Review & propose" 15 separate times
  (or scripting 15 separate `deliveryos push --new` CLI calls). Worth a
  bulk-propose flow later, same shape as Browse's existing bulk pull.

## 11. Worked example: extracting components from a real project

Ties §6/§7 together as one concrete walkthrough.

### Step 0 — Claude Code's extraction happens outside DeliveryOS entirely

Telling Claude Code "extract all reusable UI components from this
project" is just normal coding work — Read/Grep/Edit/Write, no DeliveryOS
involvement yet. Two different starting situations, two different amounts
of work:

**Situation A — components already live in their own files**
(`src/components/Button.jsx`, `src/components/Card.jsx` already
separate). The easy case: nothing moves, no import paths change — Claude
Code just writes a `preview.tsx` next to each existing file.

**Situation B — everything is jammed into one `components.tsx`**, with a
page like `Dashboard.jsx` importing several components from it. This
needs real splitting first:

```jsx
// BEFORE — src/components.tsx: Button and Card both defined in one file
export function Button({ children, variant = 'primary' }) {
  return <button className={`btn btn-${variant}`}>{children}</button>;
}
export function Card({ title, children }) {
  return <div className="card"><h3>{title}</h3>{children}</div>;
}

// BEFORE — src/pages/Dashboard.jsx: imports both from that one file
import { Button, Card } from '../components';
export function Dashboard() {
  return <Card title="Welcome"><Button variant="primary">Get started</Button></Card>;
}
```

```
AFTER
src/
  components/
    Button/
      Button.tsx      <- the real component, physically moved out of components.tsx
      preview.tsx     <- NEW -- demo file, only for DeliveryOS's catalog preview
    Card/
      Card.tsx
      preview.tsx
  pages/
    Dashboard.jsx     <- import path fixed, otherwise untouched
```

```tsx
// AFTER — src/components/Button/Button.tsx: the "main" file, the real, working code
export function Button({ children, variant = 'primary' }: ButtonProps) {
  return <button className={`btn btn-${variant}`}>{children}</button>;
}
```

```tsx
// AFTER — src/components/Button/preview.tsx: demo-only, for the catalog's
// live preview + controls -- NOT the thing being distributed
import { Button } from './Button';
export const Primary = () => <Button variant="primary">Get started</Button>;
export const Secondary = () => <Button variant="secondary">Cancel</Button>;
```

```jsx
// AFTER — src/pages/Dashboard.jsx: same page, just pointed at the new location
import { Button } from '../components/Button/Button';
import { Card } from '../components/Card/Card';
export function Dashboard() {
  return <Card title="Welcome"><Button variant="primary">Get started</Button></Card>;
}
```

**"Do we push `preview.tsx` or the main `.tsx`?"** — both, always
together, never either/or. `payload_path` points at the whole folder
(`src/components/Button/`), which contains both files. `Button.tsx` is
the actual product — what a consuming project gets on Pull.
`preview.tsx` rides along in the same folder purely so DeliveryOS can
render a live preview when browsing/reviewing — scaffolding for the
catalog experience, not the thing being distributed (same relationship a
`.stories.tsx` file has to its real component in any normal repo).

**`Dashboard.jsx` itself is never extracted, never pushed.** It's a
page — specific to this one app, not reusable — so it's not a
UI-component candidate at all. The only thing that happens to it is the
mechanical import-path fix shown above: ordinary local refactoring, done
once, staying entirely inside the original project. It never becomes a
DeliveryOS artifact.

At the end of this step, nothing has touched GitHub or any DeliveryOS
remote — just real files sitting in the project.

**A variant worth naming explicitly: a flat convention, e.g.
`src/ui/button.tsx` sitting alongside many other components in one
shared folder** (no per-component subfolder at all — a very common
real-world layout). This doesn't require restructuring the original
project either: `button.tsx` already stands alone, so Claude Code reads
it, generates `preview.tsx`, and stages a *copy* of both into a synthetic
payload location built just for the push (a temp dir, never the
project's real `src/ui/` folder) — the original file never moves.

This surfaces three layouts that are genuinely **decoupled**, not one
convention flowing through the whole pipeline:

1. **The source project's own layout** — however that team happens to
   organize things (`components/Button/Button.tsx`, `ui/button.tsx`,
   `elements/`, whatever). Never touched by extraction, beyond the
   Situation-B case where components are genuinely entangled in one file.
2. **DeliveryOS's payload-staging layout** — always one folder per
   component (`Button.tsx` + `preview.tsx` together), regardless of
   what #1 looked like. This isn't arbitrary: a directory-shaped payload
   copied onto a file-shaped `install_target` is a real, already-hit bug
   (the same one the CHANGELOG documents fixing for the
   growtharc-ai-helpers import) — so the payload for a UI component is
   always a folder, on principle, not by accident.
3. **The consuming project's `install_target` layout** — defaults to
   something like `src/components/button/` in whoever pulls it,
   independent of what #1 was. If someone wants their own project laid
   out flat instead, that's a manual reorg after pulling, same as
   reorganizing any other pulled template today — DeliveryOS doesn't try
   to preserve or replicate the origin project's folder convention on the
   far end.

### Step 1 — Scan finds them

Either you click **Scan** in the sidebar, or Claude Code runs `deliveryos
scan --remote growtharc-ui-components` from the terminal. Scan walks the
component glob (`src/components/**/*.tsx`), finds `Button`/`Card`/
`Navbar`, checks each isn't already in that remote's catalog by id, and
returns one candidate per component — auto-scaffolding a `preview.tsx`
stub for any that don't have one yet. Nothing's proposed yet.

### Step 2 — one "Review & propose" per component, two possible paths

| | GUI (a person) | CLI (Claude Code, autonomous) |
|---|---|---|
| Entry point | Click "Review & propose" on a Scan result | `deliveryos push button --new --remote growtharc-ui-components --path src/components/Button --kind ui-component --owner frontend-guild --description "Primary CTA button" --stacks react,typescript` |
| What's different | Opens the step-by-step wizard; the Review step **renders Button live** via the sandboxed-iframe pipeline before proposing | No GUI at all — one invocation per discovered component, e.g. in a loop |
| What's the same | Both call the exact same engine function underneath | `pushArtifact(id, { isNew: true, payloadPath, kind: 'ui-component', ... })` |

### Step 3 — what `pushArtifact` actually does, for `Button`

```
sequenceDiagram
    participant CC as Claude Code / You
    participant Eng as DeliveryOS Engine
    participant Cache as Local git cache
    participant GH as GitHub

    CC->>Eng: push button --new --remote ui-components ...
    Eng->>Cache: fetch + reset to remote's current tip
    Eng->>Eng: check "button" isn't already an id in the catalog
    Eng->>Cache: copy Button.tsx, preview.tsx into artifacts/button/payload/
    Eng->>Eng: compile preview.tsx (§4 pipeline), headless-render default variant
    Eng->>Cache: write artifacts/button/preview.png + manifest.yaml
    Eng->>Cache: create branch, commit manifest + payload + preview.png
    Cache->>GH: push branch
    Eng->>GH: open PR (body embeds the preview.png via raw.githubusercontent.com)
    GH-->>CC: PR opened (number + URL) -- Files changed tab renders preview.png automatically
```

This repeats once per component — `Button`, `Card`, `Navbar` each get
their own branch and their own PR (see the bulk-propose gap noted in
§10).

### Step 4 — ordinary GitHub review, then it's live

Whoever owns `growtharc-ui-components` reviews each PR exactly like any
GitHub PR (manifest diff + new source files) and merges — no
DeliveryOS-side approval step exists, it's genuinely just GitHub
underneath. Once merged, `Button` shows up for everyone else under the
"UI Components" sidebar page, rendered live via the sandboxed-iframe
pipeline, and is pullable into any other project.

## 12. Edge cases and failure handling

The one recurring principle across all of these: **anything about the
*preview* fails soft** (degrade to no-preview, never block the artifact
existing) — **anything about the *manifest/artifact itself* fails hard
and loud** (existing `DeliveryOsError` subclasses, a clear message, no
silent corruption).

### 12.1 Already handled, today, no new code

"What if the source folder doesn't exist" — already covered. `push.ts`:

```ts
if (!fs.existsSync(options.payloadPath)) {
  throw new ManifestValidationError(`--path "${options.payloadPath}" does not exist`);
}
```

If Claude Code says "extract Button" but the folder got renamed/deleted
before `push --new` actually runs, this throws a clear, existing error —
not a crash. Same error class every other kind already relies on.

### 12.2 Scan / extraction time

- **False positives** from the glob heuristic (page components, HOCs,
  test files matching "function returning JSX"). Not dangerous — Review
  is still a required step before anything's proposed, just noisy. An
  exclude-glob (`**/*.test.tsx`, `**/pages/**`) helps, but the real
  safety net (nothing auto-pushes without confirmation) already exists.
- **Id collisions within one scan batch** — two different `Button`s in
  `forms/` and `marketing/`. Different from the existing
  `IdCollisionError` (checks against the *remote*, not sibling
  candidates in the same scan) — Scan needs its own dedupe, by folder
  path (`forms-button`, `marketing-button`), same shape as the real fix
  already used when the growtharc-ai-helpers import hit filename
  collisions across categories.
- **Component escapes its own folder** — imports `../../../utils/foo`
  from elsewhere in the original project. Probably the most realistic
  real-world failure, since components are rarely 100% self-contained.
  Best handling: catch this *before* proposing — Scan/the wizard
  statically checks for any relative import escaping the payload root
  and flags it in Review ("this isn't self-contained yet"), rather than
  letting it fail opaquely at compile time.

### 12.3 Compile time (esbuild / docgen)

- **Genuine syntax/type errors** — surface the raw esbuild message
  directly (same pattern as `PostInstallError` capturing stdout/stderr
  today), never an opaque crash.
- **Unresolved imports** the vendored runtime doesn't cover (`lodash`, an
  internal design-system package, a chart library). A failed preview
  build must **never** block propose/push/pull — degrade to "no live
  preview, text-only card," the same way an unrecognized `kind` already
  falls back to a neutral icon instead of breaking.
- Vue SFC compile failure — same degrade-gracefully answer.

### 12.4 Headless-render time (the PR screenshot)

- **Never settles** (infinite CSS animation, a runaway interval) —
  timeout after ~3–5s and take whatever's on screen, or skip the image
  entirely. Not fatal.
- **Headless Chrome missing** on the machine running a CLI-driven push —
  log a warning, skip `preview.png`, still open the PR without an image.
  Worse UX, not a blocker.
- **Reads `localStorage`/cookies for a legitimate reason** (a saved
  theme) — blocked by the opaque sandbox origin, throws inside the
  iframe. Not a bug, the correct security tradeoff — document as a known
  limitation and extraction guidance: well-designed components should
  receive such values as props, not read them directly.

### 12.5 Push / pull time

- **Concurrent extraction, same id** — already effectively handled:
  `buildBranchName` embeds a UTC timestamp + 4 random hex chars per push,
  so branch names never collide even for the same id. Worst case is two
  competing PRs, resolved like any duplicate PR — a human problem, not a
  system one.
- **`install_target` collision on Pull** — two different component
  libraries both naming something `Button`, pulled into the same
  project. This is a **pre-existing engine gap**, not new to
  `ui-component` — `pullArtifact`'s `fs.cpSync` overwrites whatever's
  already at that path for *any* kind today. More likely to bite here
  since name collisions are far more common in frontend land than, say,
  agent ids.

### 12.6 Data model

- **Untagged `componentTypes`** — the component still exists and pulls
  fine, just needs an "Uncategorized" fallback tab in the UI Components
  page so it isn't silently invisible under the category tabs.
- **Mistagged `stacks`** (says `react`, code is actually Vue) — wrong
  adapter gets picked, compile fails — same graceful-degradation path as
  the unresolved-import case above, not a special case.

## 13. Future work: preview for large/multi-file artifacts (not yet designed)

Flagged explicitly, deliberately **not** solved here — this is a separate
design problem layered on top of everything above, kept only as a marker
so §4's pipeline doesn't get built in a way that quietly assumes "there's
always exactly one small component" (see Phase F, §9).

### 13.1 What the problem actually is

Everything in this doc assumes the artifact is one small, self-contained
thing — a Button, a Card. "Preview" means render it live in a sandboxed
iframe, done. But DeliveryOS already has a `template` kind (a whole
starter-code scaffold — e.g. `pattern02-starter`: a full project skeleton,
possibly frontend + backend + config + its own dependency tree). For
something that size, "render it live in an iframe" doesn't mean
anything — you can't boot an entire multi-file app inside a tiny preview
card the way you can a single Button.

The real question: **when someone's browsing the catalog and sees a
starter-kit artifact, how do they understand what it actually does and
how to use it, before pulling it?** For a Button, they see it by
hovering it. For a whole project template, there's no equivalent single
live-render.

### 13.2 Why it's a genuinely different problem, not an extension

The sandboxed-iframe + local-esbuild pipeline (§4) was built on an
assumption — one component, one compile, one render — that doesn't hold
here at all. This isn't "make the same pipeline handle a bigger input";
it needs its own separate approach entirely.

### 13.3 Candidate directions (unevaluated, just named)

- A rendered README/quickstart preview (setup steps, maybe screenshots
  the template's own author included).
- A file-tree preview, so someone can see the shape of what they're
  pulling before committing to it.
- A static screenshot or short GIF of the running result, rather than
  attempting any live render at all.
- A heavier StackBlitz/WebContainer-style **actual runnable sandbox** —
  explicitly ruled out in §4.1 for single components (too heavy, wants
  npm-registry access) but potentially the *right* tool specifically
  here, since a full project with a real dependency tree is exactly what
  StackBlitz is built for. Worth reconsidering in this narrower context
  even though it lost for the component case.

### 13.4 Why this stays deferred, not solved now

It's a legitimately separate feature-design problem stacked on an already
large one. The only thing worth doing now (§9 Phase F) is making sure §4
isn't built in a way that assumes "there's always exactly one component" —
actually designing what a template preview looks like is its own
follow-up conversation, not something to improvise inside this one.

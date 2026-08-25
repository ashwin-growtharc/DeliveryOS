---
name: feature-extractor
description: "Turn a cohesive, multi-file feature slice from a real app (an auth flow, a billing settings page, a chat panel -- several files that only make sense together, smaller than a whole project) into a working DeliveryOS kind:ui-feature artifact -- generically wired via prop callbacks instead of the source's specific backend/provider, with an explicit, honest account of what backend integration the installing project still has to supply"
tools: Read, Write, Edit, Bash, Grep, Glob, Agent
---

# Feature Extractor

Turns a real, cohesive chunk of an existing app -- not one component, not the
whole project -- into a `kind: ui-feature` artifact: several files that only
work together (a login flow's card shell + primitives + form + OAuth button;
a settings page's layout + fields + save-state handling), genericized away
from whatever specific backend/provider the source used, and pulled as one
unit into a real project's own tree.

## When to activate

- "Extract this feature into DeliveryOS" / "package this login flow as a
  pullable artifact" / "can we pull whatever auth UI already exists instead
  of building it from scratch" -- when the answer to "does DeliveryOS already
  have this" turns up a real, substantial multi-file chunk of a larger app
  that a single component or a whole-project extraction both fit badly.
- The source is bigger than one component (`ui-component-extractor`'s job)
  but smaller than a whole installable project (`starter-kit-extractor`'s
  job) -- a *feature*, not a primitive and not an app.

## Why this needed its own skill, not a stretch of the other two

Confirmed directly against the schema (`src/engine/manifest/schema.ts`)
before writing this: `install_params` and `wiring_actions` are generic,
optional fields on every manifest (`.default([])`), not restricted to
`kind: backend-plugin` -- so nothing stops a UI-shaped artifact from
declaring them. But neither existing extractor's *process* ever generates
them, and neither is shaped for what actually makes a feature slice hard:

1. **`ui-component-extractor`** assumes one file, one `preview.tsx`, no
   cross-file wiring. A real feature slice is several files that reference
   each other and usually share one real backend dependency running through
   all of them (every step of an auth flow calls the same auth SDK).
2. **`starter-kit-extractor`** assumes you want the *whole* app, replicated
   faithfully, changes only for confirmed bugs and secret-to-`install_param`
   conversion. A feature slice is deliberately a FRACTION of the source app
   -- most of what surrounds it (routing, other pages, the rest of the
   backend) is neither wanted nor portable, and the slice itself is usually
   tangled with exactly the source's own specific backend/provider (a
   specific SDK, a specific auth vendor) in a way that has to be untangled,
   not preserved.

That untangling -- separating "this is genuinely generic presentation" from
"this is coupled to the source's own backend" -- is this skill's actual job.
Skipping it produces an artifact that LOOKS pullable but silently only
works with the exact backend the source happened to use, which is worse
than an honest "you must wire this" gap: it fails at runtime, not at
review.

## This produces a GENERICIZED slice, not a faithful replica

Unlike `starter-kit-extractor`'s "replica, not reinterpretation" rule, real
rewriting is expected and central here -- but only along one axis:

- **Ship as-is (mechanical fixes only, same as `ui-component-extractor`
  step 2)**: markup, layout, styling, animation, local component state
  (open/closed, which step of a multi-step flow is showing, form field
  values before submit) -- anything that doesn't call out to a specific
  backend/provider.
- **Genericize (real rewriting, the point of this skill)**: any place the
  source calls a specific backend/provider directly (a Supabase client, a
  specific auth SDK, a hardcoded API endpoint) gets replaced with a prop
  callback (`onSubmitEmail`, `onSignInWithProvider`, `onSave`) that the
  installing project implements against ITS OWN backend. The component's
  job becomes "collect the input, show the right state, call the prop" --
  never "know how auth actually happens."
- **Never invent functionality the source doesn't have.** Genericizing a
  call is replacing a concrete implementation with an abstract seam in the
  same place -- not adding new features, error states, or flows the
  original component didn't have.
- **Drop what's inextricably specific to the source app** and say so
  explicitly (a source's own SSO/home-realm-discovery logic, its own mobile
  app deep-link handoff, its own i18n catalog, its own desktop-shell
  detection) -- these aren't bugs to fix or seams to genericize, they're
  real product decisions specific to that one app that don't belong in a
  generic artifact. Listing them plainly in the README (see step 6) is part
  of the deliverable, not an afterthought.

## Process

### 1. Find the real feature boundary

Don't start from "everything with 'auth' in the name." Read the actual
entry point (the page/route the user asked about) and its real import
graph, and draw the line where genuine cohesion stops:

- **In**: files that exist only to make this one flow work, and would be
  dead code without it (the flow's own card shell, its own step components,
  a form primitive built specifically for it).
- **Out**: app-wide utilities the flow merely USES but doesn't own (a
  generic `Button`/`Input` design-system primitive the whole app already
  shares, a generic `cn()` classname helper, app-wide toast/loading
  components) -- note these as assumed dependencies in the README (step 6)
  instead of dragging the whole design system along.
- **Out**: sibling features that share a directory by convention but aren't
  actually part of THIS flow (a phone-verification or MFA step-up screen
  living in the same `features/auth/` folder as the main login flow is a
  separate feature slice in its own right, not a required part of this one
  -- confirm with a real grep for cross-references before assuming either
  way).

### 2. Classify every file: generic presentation vs. backend-coupled logic

For each in-scope file, decide which bucket it's in (see "GENERICIZED
slice" above) and note EVERY concrete integration point found -- every
direct call to a specific backend/provider/SDK, with its file and the
real shape of what it needs (inputs, return value, error shape). This list
is the spec for step 3, and later becomes the README's integration
section (step 6) -- don't lose it.

### 3. Genericize the backend-coupled logic

For each integration point from step 2:

- Replace the concrete call with a prop callback on the component that
  needs it, typed against the REAL shape the source's own call site
  expects/returns (a fabricated, simplified shape is worse than none --
  it'll mismatch the first time someone actually wires a real backend to
  it).
- Keep the surrounding logic (loading state while the callback is
  pending, how a thrown error surfaces, what happens on success) intact --
  that orchestration is genuinely generic and is exactly what makes the
  extracted piece worth pulling instead of rebuilding from scratch.
- If the source's own logic is inseparable from a decision only that
  specific backend can make (e.g. "does this provider require email
  confirmation before first sign-in" or the SSO/home-realm-discovery
  branch mentioned above) -- that's signal the surrounding piece belongs
  in step 1's "out" pile, not a seam to force through a prop.

### 4. Apply the mechanical react-import fix

Identical to `ui-component-extractor` step 2 (reused verbatim, not
reinvented): swap `import React, { ... } from 'react'` for the vendored-
runtime destructure, convert any `React.FC<Props>` value-level annotation
to a plain typed function declaration, leave every other import (Tailwind
classes, `framer-motion`, `clsx`, an allow-listed `@radix-ui/react-*`
primitive) untouched. Do this AFTER genericizing (step 3), not before --
genericizing often removes imports (the backend SDK itself) that would
otherwise need the same treatment for nothing.

Two feature-slice-specific mechanical fixes, beyond `ui-component-extractor`'s
own list, both confirmed as real (not theoretical) against the worked
example below:

- **`motion/react` -> `framer-motion`**: some real apps import the newer
  `motion/react` package name; it's the same API as `framer-motion`, which
  is what's actually vendored (`VENDORED_LIBRARY_NAMES` in `compile.ts`).
  A plain rename is enough.
- **Framer Motion's `m` component needs a `<LazyMotion>` provider to
  animate at all -- `motion` (the full component) doesn't.** A source app
  using `m.div` (the lighter, tree-shakeable form) almost always wraps its
  ROOT in a `<LazyMotion features={...}>` provider somewhere far outside
  the feature slice you're extracting -- that provider never gets pulled
  in, and without it `m.div` silently mounts at its own `initial` style
  and never transitions to `animate`. This is NOT a rendering delay: the
  element sits at `opacity: 0` (or whatever `initial` said) indefinitely,
  it's interactable (Playwright can still fill/click it) but invisible --
  the exact "looks broken in a screenshot, but every scripted interaction
  still passes" trap `ui-component-extractor` step 6 warns about, and
  precisely how this was actually caught: interaction assertions all
  passed on the first real run, and only a real screenshot plus a
  computed-style check on the wrapper (`getComputedStyle(el).opacity`)
  surfaced that nothing was actually visible. Fix: replace `m` with
  `motion` (the always-available full component) wherever the source used
  it -- functionally identical for a slice this size, and removes the
  otherwise-invisible dependency on infrastructure that lives outside the
  extracted files entirely.

### 5. Place the payload and write real previews

`src/ui/<feature-id>/` inside the target remote's own payload tree (same
cross-repo constraint as `starter-kit-extractor` -- physically copy/write,
`payload_path` is not an escape hatch for a separate source repo), one
subfolder per real file, plus a `preview.tsx` per component that genuinely
renders standalone (the composed multi-step form, the shell, the OAuth
button on its own).

Preview callbacks must be believable stand-ins, not empty no-ops --
`onSubmitEmail={async (email) => { await delay(400); return { ok: true }; }}`
demonstrates the loading/success state the component actually has; a bare
`() => {}` looks identical whether the component's pending-state logic
works or is broken. Same realistic-data bar as `ui-component-extractor`
step 4 otherwise (real copy, real placeholder email addresses, no
`"Option 1"`/`"Label"` leftovers).

### 6. Write the README's integration contract -- the deliverable this skill exists for

This is the section neither other extractor needs, because neither
produces something with a real, unimplemented seam. Be concrete, not
vague:

- **What this includes**: the real files, in one sentence each.
- **What this deliberately does NOT include**, and why (step 1's "out"
  pile, plus step 3's "inseparable from one backend" pile) -- so nobody
  discovers the gap by surprise later.
- **Integration contract**: one entry per prop callback from step 3 --
  its real signature, what the installing project's implementation is
  expected to do, and what the component does with the result (matches
  the same rigor `nextauth-credentials`'s real `wiring_actions` instructions
  already hold backend-plugin authors to, just expressed as props instead
  of file edits).
- **Assumed shared dependencies** from step 1 (the design-system `Button`/
  `Input` the installing project is expected to already have, or a note
  that they need substituting).

### 7. Generate `wiring_actions` only for real, mechanical file edits

`wiring_actions` (`WiringActionSchema`) exists for "create/edit this exact
file at this exact path" -- the same shape `backend-plugin` uses. A pure
UI feature slice usually needs NONE: the actual integration point is
"implement this prop," which has no file for `wiring_actions` to target
and belongs in the README's integration contract (step 6) instead. Only
add a real `wiring_actions` entry when there's a genuine file the
installing project needs created or touched beyond the payload itself
(e.g. a barrel export, a route registration) -- don't manufacture one
just to populate the field. Where one is genuinely needed, follow
`nextauth-credentials`'s real convention exactly (`whenAbsent.snippet`
must be complete, valid file content -- confirmed this session as the
exact defect a hand-authored `wiring_actions` entry can otherwise ship
with, undetected until a real "Merge with Claude" call honestly refuses
to apply broken guidance text as code).

### 8. Verify -- NOT via `deliveryos scan`

`deliveryos scan`'s `detectUiComponentCandidates` only treats a folder as
"dedicated" (payload = that real folder, in place) when EXACTLY ONE file
in it structurally parses as a component with real props
(`siblingCountByFolder.get(folder) === 1`, confirmed directly in
`detectUiComponents.ts`). A real feature slice's whole point is several
files with props sharing one folder and importing each other -- scan
would instead fall through to its "flat convention" path and stage each
file into its OWN isolated synthetic folder, flagging every cross-file
import as an escaping-import warning and breaking the composition. Scan
is built to discover undeclared candidates in an existing codebase, not
to validate a hand-assembled multi-file artifact -- don't reach for it
here; a `kind: ui-feature` manifest is always hand-authored (step 9),
the same way `starter-kit-extractor` hand-authors `kind: template`.

The real verification:

1. Compile each composed preview directly via `compileLocalPreview(payloadDir)`
   (`src/engine/preview/resolveArtifactPreview.ts`) -- it just finds
   `preview.tsx` in the given folder and bundles from there with esbuild,
   so cross-file relative imports WITHIN the payload resolve normally
   regardless of how many sibling files also have props. Run this from a
   one-off script the same way this session's other engine-function spikes
   already do, not by going through scan.
2. Load the compiled HTML in a real headless browser (`playwright-core`,
   `chromium.launch({channel: 'msedge', headless: true})`) and confirm the
   composed flow actually works when driven end-to-end with the preview's
   mock callbacks (type an email, submit, see the mock pending/success
   state resolve) -- not just that it renders once statically.
3. Confirm nothing genericized still imports the source's original
   backend/provider -- a leftover import is the exact failure mode this
   skill exists to prevent, and it's mechanical to grep for once step 3's
   integration-point list exists.
4. Optional, secondary check: once pushed and pulled into a fresh
   consuming project, a later `deliveryos scan` in THAT project should
   propose nothing new from inside this feature's own installed folder
   (it's already tracked, so `isNew` excludes it) -- a real, if narrow,
   confirmation that this artifact doesn't silently reappear as noise in
   someone else's next scan.

### 9. `manifest.yaml` conventions

```yaml
id: <feature-id>
kind: ui-feature
description: "..."
owner: <owner>
version: 1.0.0
source_repo: <where this was extracted from>
install_target: src/features/<feature-id>   # merges into the installing
                                             # project's own tree, same
                                             # convention as backend-plugin --
                                             # never "." (reserved for a
                                             # project-wide merge) and never
                                             # a bare ui-components/<id>
                                             # (that convention is for a
                                             # single standalone component)
review_required: false
wiring_actions: []   # only if step 7 found a real one
```

### 10. Record source-drift tracking (optional, same as the other two extractors)

If the real source is available locally, `writeSourcesFile`
(`src/engine/drift/recordSources.ts`) per genuinely-ported file, same
"skip entirely if the source isn't available locally, never for a
hand-written preview.tsx" rule as `ui-component-extractor` step 7 and
`starter-kit-extractor` step 8.

### 11. Push

Same hard constraint as `starter-kit-extractor`'s step 9: `push --new`
via CLI flags has no `wiring_actions`/`install_params` support, so push
the plain payload first, then hand-edit `manifest.yaml` directly on the
remote's own local cache, `ManifestSchema.safeParse` before committing,
real PR with real verification evidence in the description.

## Worked example

`kortix-auth-shell` (this same session): extracted from Suna's real
`apps/web/src/app/(auth)/auth/page.tsx` + `features/auth/*`. In-scope:
the card shell/frame, the shared step primitives (header, field label,
notice strips, six-box code input), a password-reveal input, a generic
OAuth button, and a composed multi-step email+password+code form -- all
genuinely reusable presentation and state-machine logic. Out of scope,
explicitly: SAML/SSO home-realm discovery, native-mobile session handoff,
the CLI/Slack/Teams/tunnel consent screens sharing the same directory,
phone/MFA step-up -- each inseparable from Suna's own product decisions
or its specific Supabase backend, not generic seams. Every Supabase call
(`signInWithOtp`, `signInWithPassword`, `signUp`, `signInWithOAuth`,
`verifyOtp`) became a typed prop callback with the real request/response
shape the source's own server actions used, documented in the README's
integration contract. See this repo's own `PLAN.md`/`CHANGELOG.md` for
the complete account.

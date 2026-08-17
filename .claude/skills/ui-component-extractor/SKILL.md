---
name: ui-component-extractor
description: Ingest a pasted/found React UI component (from v0, 21st.dev, shadcn, Aceternity, Tailwind UI, etc.) into a DeliveryOS project so it compiles in DeliveryOS's preview pipeline and is correctly picked up by `deliveryos scan`, with a hand-written preview.tsx using realistic example data instead of generic placeholders
tools: Read, Write, Edit, Bash, Grep, Glob
---

# UI Component Extractor

Turns an arbitrary React component someone found or pasted (a chat reply, a
component-marketplace snippet, a design-tool export) into a real, working
artifact in a DeliveryOS-managed project: `src/ui/<Name>/<Name>.tsx` +
`src/ui/<Name>/preview.tsx`, compilable by DeliveryOS's preview pipeline and
detectable by `deliveryos scan`.

## When to activate

- The user pastes React component source and asks to "add" it to a project
  that uses DeliveryOS for UI-component sharing.
- The user asks you to prep a found component (from a UI kit site, a
  teammate's snippet, etc.) so it can be scanned/proposed as a DeliveryOS
  artifact.

## Why this needs its own process, not a plain copy-paste

Two failure modes show up constantly with real-world component source, and
both are silent — nothing errors until someone actually tries to preview or
scan the result:

1. **The pipeline vendors React itself.** DeliveryOS's preview compiler
   (`compile.ts`) bundles with esbuild against a custom `jsxFactory` that
   reads `window.__DeliveryOSReactRuntime.React` — there is no real `react`
   package on disk at preview-compile time. A completely normal
   `import React, { useState } from 'react'` fails to bundle with
   `Could not resolve "react"`. A short, explicit allow-list of common
   UI-kit dependencies is ALSO vendored the same way (see
   `VENDORED_LIBRARY_NAMES` in `compile.ts`): **`framer-motion`, `clsx`,
   `tailwind-merge`, `class-variance-authority`, `lucide-react`, and a
   starter set of `@radix-ui/react-*` primitives (`slot`, `dialog`,
   `dropdown-menu`, `popover`, `select`, `tooltip`, `tabs`, `checkbox`,
   `switch`, `label`, `accordion`, `avatar`, `radio-group`, `separator`,
   `alert-dialog`, `toast`)** — a component that imports any of these
   needs no workaround at all, step 2 below is a no-op for them. Any
   OTHER third-party import (a date picker, a charting library, a Radix
   primitive not in this list, anything not on it) is left completely
   untouched and will fail with a real, honest
   `Could not resolve "..."` error for Review to see — don't try to route
   around it; if it comes up repeatedly, that's a signal to add it to the
   allow-list instead (see `scripts/generate-vendored-libraries.mjs`'s
   own `LIBRARIES` array).

2. **Scan's detector requires an EXPORTED component with a non-empty props
   map.** `detectUiComponentCandidates` (`src/engine/scan/detectUiComponents.ts`)
   uses `react-docgen-typescript`, which only documents a file's *exported*
   symbols (confirmed empirically: an unexported inner component is
   invisible to it, full stop — there is no parser option to override this).
   A very common shape in pasted UI-kit code is a demo wrapper: the file's
   actual default export is a zero-prop convenience function that hardcodes
   one example usage of an *internal, unexported* component that has all
   the real props. Scan silently finds nothing in that file — not a false
   positive (which this whole feature already tolerates and expects Review
   to catch), but a **false negative**: a genuinely reusable component that
   never gets proposed at all.

Both are mechanical, and both need to be fixed at ingestion time — not by
changing DeliveryOS's own detector or compiler, which have their own
already-tested, deliberately conservative reasons for behaving this way.

## Process

### 1. Identify the real reusable component

Read the pasted source. If the default/top-level export takes no props
(or only trivial ones) and its whole body is just "render an internal
component with one hardcoded example," that internal component — not the
wrapper — is the actual reusable artifact. Promote it:

- Make the props-bearing component the file's own `export default`.
- Give the file the SAME NAME as the component (`ExpandedTabs.tsx` for
  `ExpandedTabs`, not `Tabs2.tsx` if the wrapper was called `Tabs2`).
- Delete the wrapper function entirely — its hardcoded example usage
  becomes real example data in `preview.tsx` (step 4), not dead code left
  behind in the component file.

If the pasted file already exports its real, props-bearing component
directly, skip this step.

### 2. Apply the mechanical react-import fix

Replace the file's React import with the vendored-runtime destructure,
keeping only the hooks/APIs actually used, plus a type-only import so
`React.FC`/`React.ComponentType`/etc. type positions still resolve (erased
entirely by esbuild, so it costs nothing at bundle time):

```tsx
declare const window: any;
const { useState, useRef, useEffect } = window.__DeliveryOSReactRuntime.React;
import type React from 'react';
```

(List only the hooks the file actually calls — `useState`, `useEffect`,
`useRef`, `useMemo`, `useCallback`, whatever's present. Drop the
`import type React from 'react'` line if the file never references the
`React` namespace in a type position.)

**If the component is typed as `const X: React.FC<XProps> = (...) => {}`,
convert it to a plain typed function declaration:**
`function X(props: XProps) { ... }`. This is not a style preference —
`React.FC<Props>` as a value-level type annotation requires TypeScript to
actually RESOLVE the real `React.FC` generic via a genuine `'react'`
module to unwrap it, which silently fails (Scan's docgen returns zero
props — not an error, just nothing) in every real ingested payload
directory, since none of them ship their own `node_modules/react`. A
plain typed function only needs the local `XProps` interface, never
`React.FC` itself, so it's unaffected. Confirmed empirically (a 4-way
test: function-decl vs. `const`-with-`React.FC`, each with/without the
type-only `react` import — only the `React.FC` form ever came back with
zero docs) and via a real regression: `magic-container`, pushed and
scanning fine, rendered with no interactive props in Detail until
converted from `const MagicContainer: React.FC<MagicContainerProps> = ({...}) => {...}`
to `function MagicContainer({...}: MagicContainerProps) { ... }`.

Leave every other import completely alone: Tailwind class strings, CSS
imports, `framer-motion`, `clsx`, icon libraries, etc. If one of those
can't resolve in DeliveryOS's sandboxed compile, that's real, useful
signal for Review — don't try to strip or shim it away here.

Tailwind utility classes need no workaround at all: `compileReactPreview`
(`compile.ts`) generates real CSS at compile time from the component's own
class usage (via Tailwind's own JIT engine, run server-side against the
component's raw source — see `generateTailwindCss`), so a component
styled entirely with Tailwind classes renders fully styled, not just
structurally correct.

### 3. Place the file

`src/ui/<ComponentName>/<ComponentName>.tsx` — a dedicated folder per
component, so Scan treats it as an in-place candidate (its real payload
folder, nothing copied/staged) rather than falling into the flat/shared
staging path.

### 4. Write `preview.tsx` by hand, with REALISTIC example data

Do not rely on Scan's own auto-scaffold for this (it deliberately only
fills in bare type-based placeholders — `"Label"`, `() => {}`, the first
enum member — good enough to not be blank/invalid, never meant to be the
finished article). Write a real one:

- Import the component, build one or more named exports (`Default`, plus
  any other meaningfully different real-world variant) the same way this
  codebase's existing preview fixtures do.
- Every prop value should look like something a real screen would actually
  show — genuine option labels, genuine copy, a realistic count — never
  `"Option 1"` / `"Item A"` / `"Sample text"`. See the worked example
  below for the bar to hit.
- If the pasted source's original wrapper had a hardcoded example usage
  (step 1), that's usually your best source for realistic data — carry it
  into `preview.tsx` rather than inventing something new.

This applies to EVERY component whose rendering actually depends on its
props, not just option-list-shaped ones like the Dropdown below — a
component with no real data to render is empty or visibly broken in the
live preview, whatever shape its props take:

- A **table/data-grid** needs real rows (genuine column values, not
  `"Row 1"`/`"Cell"`), or it renders as an empty header with nothing
  underneath.
- A **chart** needs a real-looking series (plausible values across a
  believable range/time axis), or it renders as a blank plot area.
- An **avatar/image-based** component needs a working image source — a
  real `https://` URL the sandbox's `img-src data:`-only CSP will
  actually block, so use a real inline `data:image/...;base64,...` (or
  the component's own documented fallback-initials path or hosted image), never a URL that
  silently fails to load.
- A **list/carousel/feed** needs enough real items to show the
  interaction it's actually for (a carousel with one slide never
  demonstrates paging).
- A **form field** needs a real label and a real placeholder/value, never
  `"Label"`/`"Enter text"` left over from the auto-scaffold.
- An **empty/error-state** component (the one kind that's SUPPOSED to
  show minimal content) still needs real, specific copy ("No projects
  yet — create your first one to get started", not "No data") and a
  real action label if it takes one, not a placeholder.

The test is always the same: would a person looking at this preview see
something that reads as a real product screen, or would they see
placeholder text/an empty shell and have to imagine what it's for? If
it's the latter, the data isn't realistic enough yet.

### 5. Verify

From the project root:

```
deliveryos scan --remote <name>
```

Confirm the component appears as a `ui-component` candidate with no
`warnings`. If it's missing, re-check step 1 (still not the actual
exported, props-bearing component?) or step 3 (folder shared with another
detected component, or sitting directly in `src/` — either sends it down
the flat-staging path instead, which still works but is worth knowing
about). If it appears but the Review-step live preview shows
`Preview unavailable -- <message>`, the message now names the real
failure (unresolved import, syntax error) — fix step 2 if it's `react`,
otherwise decide whether the underlying dependency is worth resolving for
real or is acceptable to leave failing for Review to see.

## Worked example: a Dropdown/Select

Pasted source (a typical shape: hooks from `'react'`, Tailwind classes,
generic placeholder data):

```tsx
import React, { useState } from 'react';

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  options: DropdownOption[];
  defaultValue?: string;
  onChange?: (value: string) => void;
}

export default function Dropdown({ options, defaultValue, onChange }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(defaultValue ?? options[0]?.value);

  const selectedLabel = options.find((o) => o.value === selected)?.label ?? '';

  const select = (value: string) => {
    setSelected(value);
    setOpen(false);
    onChange?.(value);
  };

  return (
    <div className="relative inline-block w-56 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-md border border-gray-300 bg-white px-3 py-2 shadow-sm hover:border-gray-400"
      >
        <span>{selectedLabel}</span>
        <span className="text-gray-400">&#9662;</span>
      </button>
      {open && (
        <ul className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
          {options.map((option) => (
            <li
              key={option.value}
              onClick={() => select(option.value)}
              className={`cursor-pointer px-3 py-2 hover:bg-gray-50 ${
                option.value === selected ? 'font-medium text-indigo-600' : 'text-gray-700'
              }`}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

This one already exports the real, props-bearing component directly, so
step 1 is a no-op. `src/ui/Dropdown/Dropdown.tsx`, with only step 2
applied:

```tsx
declare const window: any;
const { useState } = window.__DeliveryOSReactRuntime.React;
import type React from 'react';

interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  options: DropdownOption[];
  defaultValue?: string;
  onChange?: (value: string) => void;
}

export default function Dropdown({ options, defaultValue, onChange }: DropdownProps) {
  // ...unchanged body...
}
```

`src/ui/Dropdown/preview.tsx` — realistic example data, not `Option A`/
`Option B`:

```tsx
import Dropdown from './Dropdown';

const sortOptions = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
];

export const Default = () => <Dropdown options={sortOptions} defaultValue="newest" />;

// A second real-world shape: a short list, a different default selected --
// exercises the component at a different option count than the first
// export, still entirely realistic content.
const roleOptions = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'editor', label: 'Editor' },
  { value: 'admin', label: 'Admin' },
];

export const RolePicker = () => <Dropdown options={roleOptions} defaultValue="editor" />;
```

## A verified real-world case: the wrapper-around-an-unexported-component shape

`ExpandedTabs` (an animated tab bar using `framer-motion`) is a real
example of the step-1 case: the pasted file's actual default export was a
zero-prop `Tabs2()` that just rendered an internal, unexported
`ExpandedTabs` with one hardcoded 5-tab array. Confirmed empirically with
`react-docgen-typescript` directly: parsing the original file returned
zero component docs (the unexported `ExpandedTabs` is invisible to it),
so `deliveryos scan` found nothing for that file at all.

Fix applied: renamed the file to `ExpandedTabs.tsx`, made `ExpandedTabs`
itself the default export with its real `ExpandedTabsProps`, deleted the
`Tabs2` wrapper, and moved its hardcoded 5-tab array into `preview.tsx` as
the `Default` export's example data (plus a second, differently-shaped
`SettingsSubNav` variant). Re-parsing found the component immediately;
`deliveryos scan` picked it up with zero warnings on the next run.
`framer-motion` itself was left completely untouched in the component's
own source (still a plain `import { AnimatePresence, motion } from
'framer-motion'`) — it's on the vendored allow-list, so it compiled and
actually animated with no workaround needed at all, confirmed both by a
successful `compilePreviewHtml` call and by a real browser click that
switched the selected tab and re-triggered framer-motion's layout
animation.

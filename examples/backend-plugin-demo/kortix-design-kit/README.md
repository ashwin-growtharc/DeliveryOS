# Kortix design kit

The Kortix/Suna design system, extracted as a pullable unit: the real token
layer as importable CSS, a written design specification, and a set of the real
UI primitives ported to stand alone with live previews.

Extracted from `kortix-ai/suna` — `apps/web` (Next.js, React 19, Tailwind v4).

## ⚠️ Licence — read before pulling this into client work

**Suna is licensed under the Elastic License 2.0**, not Apache/MIT. See the
repo's own `LICENSE`. ELv2 permits use, copying, distribution and derivative
works, but it carries real limitations — notably you may **not** provide the
software to third parties as a managed or hosted service, and you may not
remove or obscure licensing/copyright notices.

Practical consequences for reuse here:

- `GUIDELINES.md` and `tokens/*.css` are extracted **values and
  documentation** — colours, sizes, easings, and prose written for this kit.
  Low risk, but they still describe Kortix's proprietary visual identity.
- `components/**` is **Kortix's own source code**, ported. Redistributing it
  into a client deliverable is a licensing decision, not just a technical one.
- **Do not ship Kortix's brand identity to a client.** `KortixLogo` and the
  `kortix-*` accent names are Kortix's trademark and brand, and no licence
  makes those reusable in someone else's product. Use them as a reference
  implementation; rename and recolour before anything ships externally.

If you only want the *structure* — the token architecture, the elevation model,
the component API shapes — take the patterns and re-derive the values for the
client's own brand. That is the intended use of this artifact.

## What's in here

```
GUIDELINES.md                  the design specification (drives the Design tab)
tokens/kortix-tokens.css       @theme + light/dark tokens + keyframes
tokens/kortix-component-css.css hand-written CSS the utilities don't generate
components/<Name>/             ported primitives, each with a live preview
```

### `tokens/`

`kortix-tokens.css` is the real thing, copied out of
`apps/web/src/app/globals.css` unchanged: the `@theme inline` block (semantic
colours, `kortix-*` accents, type scale, radius, motion, all keyframes), the
`:root` and `.dark` variable blocks, the `@custom-variant dark`, and the
`color-scheme` declarations that make `light-dark()` resolve without `dark:`
variants. It deliberately leaves out Suna's app-specific base resets, markdown
and prose styling, fumadocs bridge tokens, scrollbar plugins, and per-feature
utility classes — those are Suna's app, not its design system.

Use it in a Tailwind v4 project:

```css
@import 'tailwindcss';
@import './tokens/kortix-tokens.css';
@import './tokens/kortix-component-css.css'; /* only if you use Loading */
```

It requires Tailwind **v4** (`@tailwindcss/postcss`). There is no
`tailwind.config.*` and there should not be one — in v4 the CSS *is* the theme.

Verified: compiles clean through Tailwind v4.3.3, and the semantic utilities
(`bg-popover`, `text-kortix-green`, `shadow-md`, `animate-shake`) all resolve to
real declarations.

### `components/`

Each folder is self-contained and previewable: `<Name>.tsx`, a local `cn.ts`,
any sibling primitive it depends on (copied in, because the preview sandbox
rejects cross-directory imports), a generated `preview-css.ts`, and a
hand-written `preview.tsx` with realistic Kortix-shaped example data.

These are **preview-safe ports, not rewrites**. The component source is the
real file with only mechanical import rewrites applied:

| Real import | Becomes | Why |
|---|---|---|
| `@/lib/utils` | `./cn` | same `clsx` + `twMerge`, verbatim |
| `motion/react` (`m`) | `framer-motion` (`motion`) | `motion/react` isn't available in the sandbox; `m` also requires an app-wide `<LazyMotion>` boundary that doesn't exist here |
| `@phosphor-icons/react` | inline local SVG | Phosphor isn't available in the sandbox |
| umbrella `radix-ui` | scoped `@radix-ui/react-*` | only the scoped packages are available |
| `@/lib/z-stack`, `@/features/icon/*` | inlined / removed | app-shell coupling, not design system |

Everything else — every class string, every variant, every prop — is unchanged.
The real production versions still live in `apps/web/src/components/ui/`; these
are a second audience (someone browsing before pulling), not a fork.

**Styling note.** DeliveryOS's preview compiler runs Tailwind **v3** against
component source, which cannot resolve Suna's v4 `@theme` tokens — so
`bg-popover` and friends would compile to nothing and every preview would render
unstyled. Each folder therefore ships a generated `preview-css.ts` containing
**real Tailwind v4 output**, compiled against `tokens/kortix-tokens.css` while
scanning that component's own source, which `preview.tsx` injects in a `<style>`
tag. The styling in the previews is genuinely Suna's, not an approximation.

Regenerate it with `scripts/gen-preview-css.mjs` (needs `@tailwindcss/cli@4`).

## What was cleaned up from the source

Only genuine, confirmed problems were changed; everything else was ported
as-is. Two real inconsistencies were found and are documented rather than
silently patched — see *Known drift in the source* in `GUIDELINES.md`:

1. **The elevation ladder was restored.** All eight `--shadow-*` tokens were
   deleted from `globals.css` by PR #5386 (`98e5fd0a72`, "Migrate icon library
   to Phosphor icons", 2026-07-30), a commit that otherwise has nothing to do
   with elevation. The deleted block's own comment warned exactly what would
   happen: *"Must live in @theme (not :root) or the shadow-\* utilities silently
   keep Tailwind's stock bottom-only values."* That is the state Suna is in
   today — every `shadow-*` in the app renders stock Tailwind shadows, and
   `/design-system`'s Shadows section renders swatches bound to
   `--shadow-2xs … --shadow-2xl` that now resolve to nothing.
   `tokens/kortix-tokens.css` restores the block verbatim from the commit's
   parent, clearly marked. **This is a real, live bug in Suna** and worth fixing
   there; it's a one-file change.
2. **`--background` dark disagrees with its own comment — left alone.** The
   value is `oklch(0.17 0 0)` = `#0f0f0f`, but its inline comment says
   `/* canvas #090909 */` and the documented ramp at `globals.css:623-643`
   lists dark canvas as `#090909` (≈ `oklch(0.14 0 0)`). Every other one of
   that ramp's 15 roles matches its token exactly. Which side is stale is
   genuinely unclear — the canvas may have been lightened deliberately — so
   nothing was changed. Flagged for whoever owns the ramp.

Nothing else in the token layer was altered. The hex values in `GUIDELINES.md`
are computed sRGB conversions of the real `oklch` authoring values (the `oklch`
is the source of truth); the converter was validated against that same
documented ramp, matching 14 of 15 roles exactly, with the 15th being drift #2
above.

## Not included, and why

These were considered and deliberately left out rather than faked. Each depends
on something the preview sandbox genuinely cannot provide, and a hollowed-out
stand-in would misrepresent the real component:

- **Chart** (`recharts`), **DataGrid** (`ag-grid`), **MermaidRenderer**
  (`mermaid`), **EmojiPicker** (`frimousse`, ~782 KB dataset), **DateRangePicker**
  / **Calendar** (`react-day-picker`), **Command** (`cmdk`), **Drawer** (`vaul`)
  — unavailable third-party runtimes.
- **Toast** — exports only imperative functions and needs `sonner`'s `<Toaster>`
  mounted elsewhere; there is no component to preview.
- **Sidebar**, **RightSidebarProvider** — require their own provider, a
  `sidebar_state` cookie, and a zustand store.
- **Card** — depends on `next/link` and an app hook (`use-proximity-hover`).
- **Wallpaper/shader components** — WebGL via `next/dynamic` with `ssr: false`.
- **The 90 `dot-matrix/dotm-*` variants** — self-contained and visually
  striking, but they all sit on `@/lib/dotmatrix-core` + `@/lib/dotmatrix-hooks`
  and belong as their own artifact rather than buried in a design kit.

The full classified inventory of all 211 source files under
`apps/web/src/components/ui/` — including which are app-coupled and why — was
produced during extraction; ask if you want it appended here.

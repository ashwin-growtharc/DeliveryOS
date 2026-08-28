# Kortix design system

Every value in this document is extracted from Suna's own real source — no
value here was estimated, rounded, or invented:

- **Tokens**: `apps/web/src/app/globals.css`. This is Tailwind **v4**; there is
  no `tailwind.config.*` anywhere in `apps/web`, so that CSS file *is* the
  theme. Colours are authored in `oklch()`; the hex column in every table below
  is a computed sRGB conversion provided for eyeballing and for tooling that
  can't read `oklch` — **the `oklch` value is the source of truth**. The
  conversion was validated against the neutral ramp `globals.css:623-643`
  documents in prose: 14 of its 15 roles match exactly (the 15th is a real
  drift in the source — see *Known drift* at the end).
- **Fonts**: `apps/web/src/app/(system)/fonts/roobert.ts`,
  `roobert-mono.ts`, wired in `apps/web/src/app/layout.tsx`.
- **Component APIs**: each component's own file under
  `apps/web/src/components/ui/`.
- **Usage rules**: the live styleguide at route `/design-system`
  (`apps/web/src/app/(public)/(marketing)/design-system/page.tsx`) plus the
  repo's own `.claude/skills/kortix-design-system/SKILL.md`.

The token layer is shipped as real, importable CSS in `tokens/`:
`kortix-tokens.css` (theme + light/dark + keyframes) and
`kortix-component-css.css` (the hand-written spinner classes that are neither
utilities nor tokens, so nothing generates them).

**About `components/`**: those are preview-safe standalone ports of the real
primitives, so this artifact's Detail view has a live, browsable component
grid. They are the real source with only mechanical import rewrites applied
(see README). The real, production versions still live in
`apps/web/src/components/ui/` — two audiences, not accidental duplication.

## Philosophy

Black and white plus one accent. Calm, spacious, legible. Hierarchy comes from
**surface lift** (canvas → surface-1 → surface-2), never from opacity on type.
Blue is a signal only — hyperlinks, focus, selection — **never a fill or a
background**. No decoration that doesn't carry information.

Reuse > compose > create, in that order.

## Color tokens

**Neutral surfaces & ink** — the whole system's backbone. Light and dark are
genuine inverses anchored on `#ffffff`/`#000000`.

| Token | Light | Dark |
|---|---|---|
| `--background` | `#ffffff` | `#0f0f0f` |
| `--pane` | `#ffffff` | `#0c0c0c` |
| `--card` | `#f4f4f4` | `#141414` |
| `--popover` | `#ffffff` | `#141414` |
| `--secondary` | `#ececec` | `#1c1c1c` |
| `--muted` | `#ececec` | `#1c1c1c` |
| `--accent` | `#f4f4f4` | `#141414` |
| `--input` | `#ececec` | `#1c1c1c` |
| `--foreground` | `#000000` | `#ffffff` |
| `--muted-foreground` | `#666666` | `#999999` |
| `--primary` | `#000000` | `#ffffff` |
| `--primary-foreground` | `#ffffff` | `#090909` |
| `--border` | `#e2e2e2` | `#262626` |

`--foreground-strong` aliases `--foreground` and `--foreground-weak` aliases
`--muted-foreground` in both themes — they exist so call sites can express
intent, not new colour.

**Signal & feedback**

| Token | Light | Dark |
|---|---|---|
| `--ring` | `#0099ff` | `#0099ff` |
| `--destructive` | `#e7000b` | `#ff6467` |
| `--destructive-foreground` | `#fafafa` | `#fafafa` |
| `--hover` | `#0000000b` | `#ffffff0f` |
| `--active` | `#00000013` | `#ffffff1a` |

`--ring` is identical in both themes — it is the one signal colour, and it does
not shift with the surface. `--hover`/`--active` are deliberately translucent
ink rather than solid surfaces, so an interaction tint blends over whatever is
behind it (canvas, a surface, an image).

**Brand accents (`kortix-*`)** — the *only* sanctioned source of semantic UI
colour. Identical in light and dark by design.

| Token | Hex | Means |
|---|---|---|
| `--kortix-green` | `#199338` | success, running, connected |
| `--kortix-red` | `#f14b4c` | error, failed |
| `--kortix-orange` | `#d18b19` | warning, needs attention |
| `--kortix-yellow` | `#cca300` | pending, informational |
| `--kortix-blue` | `#2b91f7` | brand, links, primary emphasis |
| `--kortix-purple` | `#ab80d6` | (available; no assigned state) |
| `--kortix-base` | `#0099ff` | alias of `--ring` — focus rings |

Idle/neutral state uses `--muted-foreground`, not a brand accent.

**Charts** — a single warm amber-to-brown ramp, identical in both themes:
`--chart-1 #ffd230`, `--chart-2 #fe9a00`, `--chart-3 #e17100`,
`--chart-4 #bb4d00`, `--chart-5 #973c00`.

**Sidebar** — its own surface family so the shell can differ from content:
`--sidebar #f4f4f4` / `#141414`, `--sidebar-accent #ececec` / `#1c1c1c`,
`--sidebar-border #e2e2e2` / `#1a1a1a`, `--sidebar-primary #0099ff` (both).

**Emoji & glyph tints** — two *separate* hue families used by the emoji and
project-icon pickers, authored as `light-dark()` pairs (which resolve without
any `dark:` variant because `:root`/`.dark` set `color-scheme`). Six emoji hues
(red, amber, green, teal, blue, violet) and eight glyph hues (grey, red,
orange, yellow, lime, blue, purple, magenta), each with a pale `fill` and a
higher-contrast `ring`. The split is an accessibility requirement, not a style
choice: the picker's active cell is the only selection cue, a pale fill cannot
reach WCAG 1.4.11's 3:1 against `--popover` at any saturation, so the 1px inset
ring carries the contrast (measured 3.03–3.19:1). Never flatten the pair to a
single colour. Full values: `globals.css:243-292`.

**Never** use raw Tailwind palette classes (`bg-blue-500`, `text-red-400`), raw
hex, or manual `dark:` palette hacks in app code. Semantic tokens and
`kortix-*` only.

## Type scale

One typeface family throughout — **Roobert** (variable, weights 100–900,
upright + italic) with **Roobert Mono** for code. There is no separate
serif or display face; if a design calls for one, it is not in this system.

| Role | Font | Token | Size | Line height |
|---|---|---|---|---|
| Body / UI default | Roobert (`--font-sans`) | `--text-sm` | `0.875rem` | `calc(1.25 / 0.875)` |
| Small / meta | Roobert | `--text-xs` | `0.8125rem` | `calc(1 / 0.8125)` |
| Base prose | Roobert | `--text-base` | `1rem` | `calc(1.5 / 1)` |
| Lead | Roobert | `--text-lg` | `1.125rem` | `calc(1.75 / 1.125)` |
| Section page title | Roobert | `--text-xl` | `1.25rem` | `calc(1.75 / 1.25)` |
| Detail title | Roobert | `--text-2xl` | `1.5rem` | `calc(2 / 1.5)` |
| Display | Roobert | `--text-3xl` … `--text-8xl` | `1.875rem` … `6rem` | `1` at `5xl`+ |
| Code | Roobert Mono (`--font-mono`) | `--text-sm` | `0.875rem` | forced `1.2`, weight forced `500` |

`html` stays at `font-size: 100%` on purpose so browser and OS zoom keep
working — readable sizes are adjusted through these tokens, never by shrinking
the root.

There is **no `--font-weight-*` token scale**; weights are applied as ordinary
utilities. The real conventions in use are: row/panel title `text-sm
font-medium`, row meta `text-xs text-muted-foreground`, section page title
`text-xl font-medium`, detail title `text-2xl font-semibold tracking-tight`.
`body` itself is set to `font-medium`.

Both faces ship the same OpenType feature set, applied globally on `html` and
`body`: `'ss10' on, 'ss09' on, 'ss03' on, 'ss04' on, 'ss14' on, 'palt'`, with
`text-rendering: optimizeLegibility` and antialiased smoothing. A surface that
drops these will not match the rest of the product.

Named sizes only — no arbitrary `text-[11px]`, except where
`Badge size="xs"`/`"tabular"` already define it.

## Spacing & radius scale

**Radius** — derived from one base, `--radius: 0.625rem` (10px):

| Token | Value | Surface |
|---|---|---|
| `--radius-sm` | `calc(var(--radius) - 4px)` → 6px | status icon tiles |
| `--radius-md` | `calc(var(--radius) - 2px)` → 8px | panels, rows, tables — the default |
| `--radius-lg` | `var(--radius)` → 10px | larger containers |
| `--radius-xl` | `calc(var(--radius) + 4px)` → 14px | large surfaces |
| `--radius-2xl` | `1rem` (16px) | main form elements; a literal, not derived |

Also `--border-width: 1.5px`. Pills (buttons in pill contexts, badges) use
`rounded-full`. Never `rounded-xl`/`rounded-2xl` on app containers, and never
nest rounding (parent and child both rounded).

**Spacing: there is no named spacing-step scale, and this document will not
invent one.** What genuinely exists is Tailwind v4's single spacing multiplier,
`--spacing: 0.23rem`, plus exactly one named token, `--spacing-sidebar:
1.5rem`. Everything else is stock Tailwind spacing utilities against that
multiplier. Note the multiplier is *not* Tailwind's default `0.25rem` — every
numeric spacing utility in Suna is ~8% tighter than stock, which is precisely
why a component pasted in from elsewhere reads slightly loose.

The real, observable spacing *rhythm* (from the reference views, not from
tokens) is:

| Layer | Value |
|---|---|
| Section wrapper → body | `space-y-5` |
| Search + content block | `space-y-4` |
| List of rows / disclosures | `space-y-2` |
| Settings major sections | `space-y-8` |
| Tab panel content | `space-y-6` |
| Panel inner padding | `px-4 py-5` (standard), `px-4 py-3` (compact row) |
| Row internal gap | `gap-3` row, `gap-2` button groups, `gap-1.5` title/meta |

## Elevation

Eight steps, each layering three shadows — a tight contact shadow that grounds
the surface, a directional depth layer with negative spread so there's no side
bleed, and a 0-offset ambient halo so the shadow reads **softly on all four
sides** rather than as a hard bottom-only smear. Colours use `light-dark()`, so
dark mode switches automatically and `dark:shadow-*` is never needed.

| Step | Use |
|---|---|
| *(none — border only)* | panels, rows, tables: anything in page flow is flat |
| `shadow-2xs` | hairline lift: inputs, thumbnails |
| `shadow-xs` | chips, slider thumbs, glass panels |
| `shadow-sm` | sticky bars, segmented controls, hover lift |
| `shadow-md` | dropdowns, selects, popovers, hover cards |
| `shadow-lg` | modals, sheets, toasts |
| `shadow-xl` | command palette, floating windows |
| `shadow-2xl` | marketing surfaces, large previews |

Elevation means "floats above the page". In-flow surfaces get a border, not a
shadow. Overlays pair the shadow *with* a hairline border
(`bg-popover border shadow-md`) — the shadow adds depth, the border still draws
the edge. Tinting is allowed only where a glow carries meaning
(`shadow-md shadow-kortix-base/20`).

**This ladder is currently missing from Suna's `globals.css`** — see *Known
drift*. `tokens/kortix-tokens.css` restores it, which is why the numbers above
are real and citable.

## Motion

| Token | Value |
|---|---|
| `--duration-fast` | `100ms` |
| `--duration-normal` | `150ms` |
| `--duration-moderate` | `200ms` |
| `--duration-slow` | `300ms` |
| `--duration-slower` | `500ms` |
| `--ease-default` | `cubic-bezier(0.2, 0, 0, 1)` |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` |

Ordinary hover/focus changes use `--duration-normal`. Accordion/collapsible
open-close is `0.2s ease-out`. Error feedback is a damped, transform-only
horizontal shake: `--animate-shake: shake 400ms var(--ease-in-out) both`.

**Icon swaps are cross-faded, never hard-swapped.** When a button's icon
changes on state (copy → copied, play → pause), both icons share one
fixed-size box and morph with **scale `0.25 → 1`, opacity `0 → 1`, blur
`4px → 0`** on a spring of `{ type: 'spring', duration: 0.3, bounce: 0 }`,
always with `initial={false}` so nothing animates on first paint. `bounce: 0`
is what keeps it buttery rather than playful. Pair with `active:scale-[0.97]`
press feedback and `transition-colors` hover.

Every animation must respect `prefers-reduced-motion`. The spinner family in
`tokens/kortix-component-css.css` is the canonical real example: under reduced
motion the arc's grow/shrink and the spoke stepping are dropped, but a calm
constant rotation is kept — a loader still has to signal activity. Removing the
motion entirely and removing the signal entirely are different things.

## Layout grid

No fixed column-grid system. Content is laid out with flex/grid in a bounded
centre column, not a 12-column grid.

The canonical section shell is `mx-auto w-full max-w-2xl` with
`px-4 py-10 pb-20 lg:py-20` and `space-y-5` between header and body. The header
puts title and description on the left and the primary action on the right, and
stacks on mobile (`flex-col sm:flex-row`); content always sits **below** the
header, never beside it. Mobile-first — test narrow width.

Panels are `bg-popover rounded-md border` surfaces. Padding never sits on a
bordered element that hosts flush children (tables, lists, internal seams) —
it goes on the inner sections, so a table can sit edge-to-edge.

## Per-component usage rules

- **Button**: one primary (`default`) per view — never two competing.
  `destructive`/`danger` is for the action that actually deletes or
  irreversibly changes something, never decorative. `ghost`/`link`/`text` are
  the lowest-emphasis actions on a view, never a primary CTA. Icons in buttons
  are `size-3.5 shrink-0` (dense) or `size-4` (header), always `shrink-0`. For
  a confirm/cancel pair use `destructive` + `outline`, never `destructive` +
  `ghost` — the contrast gap is too wide and cancel stops reading as a real
  option.
- **Badge**: a status chip, not a label decoration. Use `size="sm"`/`"xs"` in
  dense rows and `size="tabular"` for counts so digits don't jitter. The
  `solid` variant drives its colour from the `badgeColors` map via inline
  `color-mix`, so it is the one place a named hue is legitimate; every other
  variant must stay on semantic tokens.
- **Input**: always pair with a real `Label` for anything the user fills in
  deliberately — never rely on `placeholder` as the label, it disappears on
  first keystroke. `variant="popover"` is the form-in-panel variant. Invalid
  state gets `aria-invalid`, which also triggers the shake — set it on the real
  validation failure, not on every keystroke.
- **Textarea**: use the autosize behaviour for anything free-form (a prompt, a
  description); a fixed-height textarea that scrolls internally hides content
  the user is actively writing.
- **Status**: covers `StatusBadge`, `StatusDot` and `DiffStat`. Status must never
  depend on colour alone — pair the tone with real text. `pulse` on `StatusDot` means
  *actively running*, not merely "recent"; a permanent pulse is noise.
  `DiffStat` renders nothing when both counts are zero, by design — don't
  paper over that with a "0 changes" chip.
- **InfoBanner**: pick the `tone` that matches real severity — `destructive`
  only for what actually failed, `warning` for reversible-but-risky, `info` for
  everything else. Every tone carries its own glyph as well as its tint; never
  strip the glyph to "simplify", and never pair a tone with a contradicting
  icon.
- **Empty**: for "nothing here yet", never for a failure. Copy must be specific
  ("No agents yet — deploy your first one to start automating", not "No data").
  Include an `action` only when there is a genuine next step.
- **Skeleton**: shape-match it to the content it stands in for — a
  heading-sized skeleton for a heading — so nothing shifts when real content
  lands. Use it for page-level placeholders; use `Loading` for active async
  operations. Never leave a skeleton up indefinitely: it says "loading", not
  "empty" or "failed".
- **Loading**: the only spinner in the system. No icon is ever a spinner — not
  a circle-notch glyph, not anything aliased to `Loader`, and never
  `animate-spin` on an icon. It ships its own rotation, so it needs no
  animation utility. `variant="spokes"` ticks in 8 steps; `variant="orbit"`
  sweeps. Use `className="size-4 shrink-0"` in dense buttons.
- **Table**: rows are `rounded-md` and flush inside their panel — put the
  padding on the panel's inner sections, not on the bordered element itself.
  Numeric columns use tabular figures.
- **Tabs**: `TabsList type="underline"` for primary section navigation;
  `TabsListCompact`/`TabsTriggerCompact` for filter and status tabs. A tab's
  count goes in a `Badge` inside the trigger. `animate="none"` only when the
  sliding indicator genuinely fights the layout.
- **Disclosure**: the config-entity pattern — `variant="outline"`, a trigger
  row carrying the entity name, detail content inside. The trigger button is
  `rounded-none` so the seam stays flush; never nest a rounded child inside the
  rounded parent.
- **Switch**: for a setting that applies immediately. If the change needs a
  Save, it is a checkbox or a form field, not a switch.
- **Checkbox**: for multi-select and for opt-ins that are committed on submit.
  Always give it a real label; the label is the hit target too.
- **Hint**: the tooltip wrapper for icon-only controls. Any icon-only button
  needs one — an unlabelled icon button is not self-documenting. Never reach
  for the raw Tooltip primitives in feature code.
- **Field**: the form-layout primitive — label, control, description, and error
  in one predictable rhythm. An error message replaces the description rather
  than stacking below it; never show both at once.
- **Item**: the compositional row — leading media, body, trailing action. Rows
  are `py-2` (dense) or `py-2.5` (member rows). Keep the body `min-w-0 flex-1`
  so long titles truncate instead of pushing the action off the row.
- **List**: a plain `<ul className="space-y-2">` of rows. Reach for it when the
  collection is genuinely a list; if every row needs its own expandable detail,
  that's `Disclosure`, and if rows share columns, that's `Table`.
- **Alert**: an inline, in-flow message attached to the thing it describes —
  distinct from `InfoBanner`, which spans a whole section. It always carries
  media plus a title; a bare line of coloured text is not an alert.
- **Kbd**: real key names for real shortcuts, never invented ones. Group a
  chord with `KbdGroup` so the keys read as one shortcut rather than a list.
- **UserAvatar**: colour is derived deterministically from the identity, so the
  same person is the same colour everywhere — never override it per surface.
  Fall back to initials rather than a generic silhouette when there's no image.
- **DefinitionList**: read-only key/value metadata. Set `labelWidth` so labels
  align into a real column; use `dividers` only when rows are long enough to
  need the guide.
- **Stepper**: linear flows where the order genuinely matters and the user can
  see where they are. Don't use it for independent settings.
- **Breadcrumb**: real hierarchy only. Collapse the middle with the ellipsis
  form rather than letting a deep path wrap to two lines.
- **ButtonGroup**: adjacent actions of equal weight sharing one seam. Icon-only
  members each need a `Hint`.
- **Separator**: a seam between related groups, not decoration between every
  element. If you need one after each row, you want a bordered list instead.
- **ProgressRing**: bounded, known-percentage progress (quota, disk, usage). For
  unknown-duration work use `Loading`.
- **TextShimmer**: transient in-flight status text ("Analysing repository…").
  It is CSS keyframes rather than a per-frame JS animation on purpose — do not
  reimplement it with a motion library. Never shimmer text that isn't actually
  pending.
- **SpotlightCard**: a cursor-tracked glow for marketing and landing surfaces.
  Not for dense app UI, where the glow becomes noise.
- **KortixLogo**: `variant="icon"` in compact chrome, `"brandmark"` where the
  wordmark has room. Never recolour it per-surface; it is built to hold on both
  themes.
- **Tag**: an inert descriptor (a label, a category). If it communicates state,
  it's a `Badge`; if it's clickable, it's a `Button`.

## Anti-patterns

- **Two primary buttons side by side.** Pick one primary, demote the other to
  `outline`/`ghost`.
- **Raw palette colour in app code** — `text-emerald-600`, `bg-amber-500`, a
  literal hex. The `kortix-*` accents and semantic tokens are the whole
  vocabulary. (The `Badge` `solid` colour map is the single sanctioned
  exception.)
- **`dark:shadow-*`, or hand-rolled `shadow-[…]` when a ladder step fits.** The
  ladder is already theme-aware via `light-dark()`.
- **A shadow on an in-flow panel.** Border, not elevation. Elevation means it
  floats.
- **Nested rounding** — a `rounded-md` child inside a `rounded-md` parent. The
  inner element goes `rounded-none` and the seam stays flush.
- **Status by colour alone**, or a glyph that contradicts its tone (a checkmark
  on a destructive banner).
- **Any icon used as a spinner**, or `animate-spin` on a glyph. There is one
  spinner.
- **`placeholder` doing a `Label`'s job.**
- **Opacity on type to create hierarchy.** Hierarchy comes from surface lift and
  from `--muted-foreground`, which is a real colour with real contrast.
- **Blue as a fill or background.** Blue is a signal: links, focus, selection.
- **Firing a destructive mutation from a single click.** It goes through a
  confirm step first, always.
- **Copying a component in from another design system and keeping its spacing.**
  Suna's spacing multiplier is `0.23rem`, not the stock `0.25rem`; the pasted
  component will read loose against everything around it.

## Voice & tone

Direct and specific, never apologetic. An error names what went wrong and what
to do about it ("Sandbox ran out of disk — free space or upgrade the plan", not
"Oops! Something went wrong"). Button labels are verbs describing exactly what
happens ("Deploy agent", "Revoke key" — not "OK" or "Submit"). Empty states name
the next action. No exclamation points in UI copy: the confidence comes from the
typography and the restraint, not from enthusiasm in the words.

## Known drift in the source

Two real inconsistencies found while extracting, both left **unfixed in Suna**
and reported here rather than silently patched:

1. **The elevation ladder is gone from `globals.css`.** All eight
   `--shadow-*` tokens were deleted by PR #5386 (`98e5fd0a72`, "Migrate icon
   library to Phosphor icons", 2026-07-30) — a commit that otherwise has
   nothing to do with elevation. Consequences today: every `shadow-*` utility
   in the app silently falls back to Tailwind's stock bottom-only shadows
   (exactly what the deleted block's own comment warned about), and
   `/design-system`'s Shadows section renders swatches bound to
   `--shadow-2xs … --shadow-2xl`, which now resolve to nothing. This kit's
   `tokens/kortix-tokens.css` restores the block verbatim from the commit's
   parent; restoring it in Suna itself is a one-file change.
2. **`--background` in dark mode disagrees with its own comment.** The value is
   `oklch(0.17 0 0)`, which is `#0f0f0f`, but the inline comment reads
   `/* canvas #090909 */` and the documented ramp at `globals.css:623-643`
   lists dark canvas as `#090909` (≈ `oklch(0.14 0 0)`). Every other one of
   that ramp's 15 roles matches its token exactly, so this is the lone outlier.
   Which side is wrong is genuinely unclear — the canvas may have been
   lightened deliberately and the comment left behind — so nothing was changed
   here. Worth a decision by whoever owns the ramp.

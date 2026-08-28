# DeliveryOS — Design System

**Note on accuracy:** this document was originally written as an early UI
mockup/proposal (titled "ArcAI Platform" -- a working name that was never
the product's actual name; DeliveryOS is the decided name, see
ARCHITECTURE.md). Typography and Color Palette below (through "AI Accent
Colors") accurately match the real, shipped app
(`src-tauri/spike-ui/style.css`) -- verified directly. **Navigation, AI
Components, and Animations (further down) describe a richer mockup vision
that was never built** -- corrected in place below rather than removed, so
the gap between "designed" and "shipped" stays visible.

## Brand Alignment

This design system implements GrowthArc's brand identity for the ArcAI Platform. The visual language blends GrowthArc's **warm, editorial consultancy** aesthetic with **AI-forward visual flourishes**.

- **Warm & Editorial** — Cream backgrounds, serif headings (EB Garamond), sage/sand tones from growtharc.com
- **Enterprise Dashboard UX** — Card-based, organized layouts with kanban boards, activity feeds
- **AI-Forward Accents** — Glow effects, gradient borders, pulse animations for AI elements

### GrowthArc Values (reflected in design)
- **Curiosity** — AI suggestions and insights surfaced proactively
- **Courage** — Bold gradient accents on AI elements against warm editorial base
- **Collaborate** — Avatar-centric, team-visible dashboards
- **Care** — Accessibility-first, reduced-motion support, clear hierarchy

### Three Pillars
- **Intelligent Platforms** → Home dashboard
- **Interconnected Data** → Workflow visualizations and tool connections
- **Integrated AI** → AI glow effects, sparkle badges, streaming text

---

## Typography

| Element | Font | Size | Weight | Class |
|---------|------|------|--------|-------|
| Page title (Header) | EB Garamond | `text-xl` | `font-normal` (400) | `font-serif` |
| Card title | EB Garamond | `text-lg` | `font-normal` (400) | `font-serif` |
| Welcome banner heading | EB Garamond | `text-2xl` | `font-normal` (400) | `font-serif` |
| Body text | IBM Plex Sans | `text-sm` | `font-normal` (400) | `font-sans` (default) |
| Buttons, badges, labels | IBM Plex Sans | `text-sm` / `text-xs` | `font-medium` (500) | `font-sans` (default) |
| Code / traces | JetBrains Mono | `text-sm` | `font-normal` (400) | `font-mono` |

### When to use serif vs sans-serif
- **Serif (EB Garamond)**: All headings — page titles, card titles, section headers, banner text. Renders at normal weight (400), larger sizes. Gives the editorial/consultancy feel.
- **Sans-serif (IBM Plex Sans)**: All body text, UI controls, buttons, badges, labels, descriptions. The workhorse for readability.
- **Monospace (JetBrains Mono)**: Code blocks, execution traces, JSON display.

### Font loading
Fonts loaded via Google Fonts in `index.html`:
- EB Garamond: weights 400-800, italic
- IBM Plex Sans: weights 400, 500, 600, 700

---

## Color Palette

### Warm Surfaces (GrowthArc Brand)
The background and surface colors use warm cream tones from growtharc.com (`--color-3: #FFFCF2`).

| Token | Hex | Usage |
|-------|-----|-------|
| `surface` | `#FFFCF2` | Page background, card overlays |
| `surface-secondary` | `#FFFCF2` | Main content area background |
| `surface-tertiary` | `#F6F1E9` | Inset panels, sidebar hover states |
| `surface-inset` | `#EDE6DA` | Code blocks, deeply nested content |

### Warm Borders

| Token | Hex |
|-------|-----|
| `border` | `#E0D9CE` |
| `border-strong` | `#C9BFAF` |
| `border-subtle` | `#EDE6DA` |

### Sage Green (GrowthArc Brand Accent)
From growtharc.com `--color-4` and `--color-5`. Used for active states, positive indicators.

| Token | Hex | Usage |
|-------|-----|-------|
| `sage-50` | `#F4F9EC` | Light tint |
| `sage-100` | `#EAF4DB` | Active nav background, card accents |
| `sage-200` | `#D4E8B8` | Mid sage |
| `sage-500` | `#ACC384` | Buttons, prominent accents |
| `sage-700` | `#7A9955` | Text on sage backgrounds |

### Sand (GrowthArc Warm Accent)
From growtharc.com `--color-8` and `--color-11`.

| Token | Hex | Usage |
|-------|-----|-------|
| `sand-100` | `#F6E8CC` | Warm card backgrounds |
| `sand-200` | `#EDD9B3` | Deeper sand |
| `sand-500` | `#DBC6AB` | Section backgrounds |

### Additional Warm Tones

| Token | Hex | Source | Usage |
|-------|-----|--------|-------|
| `gold-500` | `#FBD17E` | `--color-10` | Warm accent |
| `sky-100` | `#DBE8F4` | `--color-6` | Light blue cards |

### Primary — Navy Teal
From growtharc.com `--color-7: #1E3C53`. Used sparingly for CTAs, primary buttons, and heading text.

| Token | Hex | Usage |
|-------|-----|-------|
| **`primary-700`** | **`#1E3C53`** | **Primary/chip solid-fill buttons only (bg + border, white text on top) -- fixed brand color, does NOT change in dark mode** |
| `primary-800` | `#162D3F` | Hover on primary buttons |
| `primary-900` | `#0E1E2B` | Reserved (not directly used in the shipped app) |
| `ink` | `#1E3C53` (light) | **Generic UI text color** -- equal to `primary-700` in light mode, but a DISTINCT token so dark mode can turn body/heading text light without also turning the fixed-navy buttons above light. Every heading/body/label/focus-ring/icon-fg rule in the real app uses `ink`, never `primary-700` directly. |
| `text-secondary` | `#6E6455` (light) | Muted secondary text (e.g. a drift-check caption) |
| `font-mono` | `'JetBrains Mono', ui-monospace, Consolas, monospace` | Same stack as the Typography table's monospace row, as a reusable token |

### Dark mode

Real, shipped (`src-tauri/spike-ui/style.css`) -- not part of the original
mockup this document started as. Applied via `prefers-color-scheme` by
default, overridden either direction once a person toggles the sidebar's own
theme button (`data-theme="dark"`/`"light"` on `<html>`, persisted to
`localStorage`). A genuine second palette, not an inversion -- pale accent
tints get their own darkened panel colors instead of staying bright on a
dark page, while brand-fill buttons/chips and a handful of already-vivid
standalone accents stay fixed across both themes.

**Neutral surfaces are a cool charcoal, deliberately NOT a warm brown/amber
near-black** -- an earlier version of this palette derived the dark
neutrals from the same warm hue as the light-mode cream background, which
read as muddy brown across everything (body, sidebar, cards, inputs -- the
one family of tokens touching nearly every pixel). Corrected: the neutral
family below is cool and low-chroma; only the deliberately-colorful accent
tints (`sage-100`, `sand-100/200`, `sky-100`, the status colors) carry real
hue, and only where they're actually meant to -- small tinted panels/icons,
never the page chrome itself. `ink` (text) keeps a touch of warm ivory,
which reads as intentional since it's a text color, not a background.

| Token | Light | Dark | Notes |
|-------|-------|------|-------|
| `surface` / `surface-secondary` | `#FFFCF2` | `#15181B` | Page background -- cool charcoal, not brown |
| `surface-tertiary` | `#F6F1E9` | `#0F1214` | Darker than `surface` (recessed), same direction as light mode |
| `surface-inset` | `#EDE6DA` | `#0A0C0D` | Darkest of the neutral family |
| `card` | `#FFFFFF` | `#1F2427` | Lightest of the neutral family -- elevated panels (cards, sidebar) sit visibly ABOVE the page, same relationship as white-on-cream in light mode |
| `border` / `border-strong` / `border-subtle` | `#E0D9CE` / `#C9BFAF` / `#EDE6DA` | `#343B3F` / `#454D51` / `#0A0C0D` | |
| `ink` | `#1E3C53` | `#ECE9E2` | |
| `text-secondary` | `#6E6455` | `#918F89` | |
| `sage-100` | `#EAF4DB` | `#17261A` | Real dark green, not a neutral brown |
| `sand-100` / `sand-200` | `#F6E8CC` / `#EDD9B3` | `#2C2013` / `#382A18` | Deliberately warm/amber -- this IS the "sand" accent, used only for small tinted panels (a skill/java icon bg, the push-status banner), never page chrome |
| `sky-100` | `#DBE8F4` | `#10202C` | Real dark blue |
| `icon-fg-warm` (icon text on `sand-100`) | `#8A5A2B` | `#E3BD87` | |
| `icon-fg-cool` (icon text on `sky-100`) | `#2E5E82` | `#9AC7EA` | |
| `success-100` / `success-600` | `#DCF8E6` / `#236D40` | `#163B22` / `#6EE0A0` | |
| `warning-100` / `warning-600` | `#FFF4E0` / `#9C5D00` | `#3D2907` / `#F2B24E` | |
| `danger-100` / `danger-600` | `#FFE5E0` / `#A2341F` | `#45170F` / `#FF8A66` | |
| `shadow-1` / `shadow-2` | `rgb(0 0 0/0.04)` / `rgb(0 0 0/0.08)` | `rgb(0 0 0/0.4)` / `rgb(0 0 0/0.55)` | Higher opacity in dark mode -- a light-mode shadow value is nearly invisible against a dark surface, and `card` now sits clearly lighter than `surface`, so a stronger shadow reinforces that elevation |

**Left fixed across both themes (unchanged in the dark block):**
`primary-700/800/900`, `gold-500`, `danger-500`, `accent-500/600`,
`cyan-500/600`, `mint-500`, `sage-50/200/500/700`, `sand-500`, and every
gradient -- all either brand-fill roles (paired with white text, unaffected
by page theme) or already-vivid standalone accents that read fine on a dark
surface without their own dark variant.

### AI Accent Colors (for AI-specific elements only)

| Token | Hex | Usage |
|-------|-----|-------|
| `accent-500` | `#7A00DF` | AI glow effects, sparkle icons, AI badges |
| `cyan-500` | `#0693E3` | AI gradient endpoints, secondary AI accent |
| `mint-500` | `#00D084` | Active pulse indicators |

### When to use warm tones vs AI tones
- **Warm tones (sage, sand, cream)**: Regular UI — backgrounds, nav states, card accents, metric icons
- **AI tones (purple, cyan, gradients)**: AI-specific elements only — ArcAIBot prompt, AI insights card, glow effects, sparkle badges, streaming text

---

## Navigation (real, as shipped)

**Correction:** the section below used to describe a Home/Studio/Monitor/
Library/Admin route structure with client-side routing and redirects --
none of that was ever built. DeliveryOS is a single-page desktop app with
no router; "navigation" means which `<section class="view">` is shown,
toggled directly in `app.js` (`showView`), not URL routes.

### Sidebar structure (`src-tauri/spike-ui/index.html`)

```
Browse            -> the default view: the full artifact catalog
Browse by tag     -> browse grouped by role/team/stack/component-type
UI Components     -> a dedicated live-preview grid for kind:"ui-component"
Settings
────────────────  (divider)
Scan              -> detect installable artifacts in the current project
Add New           -> the multi-step wizard for proposing a new artifact
```

A slim **context strip** above the content area (not part of the sidebar)
holds the current project folder, a "Change folder" button, and the dark-
mode toggle -- the one thing from the original top-bar design that never
moved into the sidebar.

### Sidebar visual design
- **White card background** (`bg-card` / `#FFFFFF` in light mode) with a
  warm right border
- **Active state**: `bg-sage-100` tint with `ink` (adaptive) text
- **Logo**: "DeliveryOS" in serif, no icon
- No collapsible groups, no route redirects -- every item is a single,
  always-visible sidebar button

---

## Component Inventory

### Buttons
| Variant | Style | Usage |
|---------|-------|-------|
| `.btn-primary` | Navy `primary-700` solid | Primary actions |
| `.btn-accent` | Purple `accent-500` solid | AI-specific actions only (e.g. the Scan run button) |
| `.btn` | Card-colored with warm border | Secondary/outline actions |
| `.btn-ghost` / `.btn-danger-ghost` | Text only, warm/danger hover | Inline actions |

**Correction:** a `gradient` (cyan→purple) variant was originally listed
here for an "ArcAIBot send button" -- no such button exists in the shipped
app (`style.css` itself notes this variant "has no counterpart in
DeliveryOS's UI" and doesn't define it). Class names above are also
corrected to the real ones used in `app.js`/`style.css` (`.btn-primary` etc.,
not the `default`/`accent`/`outline`/`ghost` shorthand this table used).

### AI-forward elements (real, as shipped)

**Correction:** none of the componentized elements originally listed here
(`GlowCard`, `AIBadge`, `PulseIndicator`, `AISparkle`, `StreamingText`,
`ArcAIPromptBox`) exist anywhere in `app.js`/`style.css`/`index.html` --
zero matches, confirmed by direct search. What actually ships for
"AI-forward" is much plainer, matching this doc's own "AI tones for
AI-specific elements only" rule (above) rather than a dedicated component
library:

| What's real | Where |
|---|---|
| `.hint-banner-ai` | A plain bordered banner (`accent-500` left border, `sky-100` background) for a genuinely AI-generated finding -- e.g. the Review step's "Suggest with Claude" result. Visually identical to the plain (non-AI) `.hint-banner` except the border color. |
| "Suggest with Claude ✨" / "Merge with Claude ✨" / "Want help fixing this? ✨" buttons | Plain `.btn-ghost` (one is `.btn-accent`, purple solid) buttons with a trailing sparkle emoji as the only "AI" visual cue -- Add New's metadata/anti-pattern suggestions, and Phase 10/11's build-fix/wiring-merge/design-fix flows (`renderBuildFixRow`/`renderWiringMergeRow`/`renderDesignFixRow` in `app.js`) |
| `--gradient-ai` (`cyan-500` → `accent-500`) | Defined as a token but not currently applied anywhere in `style.css` -- the one gradient actually in use (the Add New wizard's progress bar) is `--gradient-brand`, the warm navy one, not this one |

### Animations

**Correction:** none of the originally-listed animations (`pulse-glow`,
`gradient-shift`, `shimmer-border`, `breathing`, `neural-pulse`) exist in
`style.css` -- zero matches. The real app has ordinary CSS transitions
(button hover/disabled states, `.7s linear infinite` spinner rotation on
`.spinner`) but no bespoke AI-specific animation keyframes.

---

## Accessibility

- **Contrast**: All text meets WCAG AA (4.5:1 normal, 3:1 large)
- **Focus**: 2px ring in `ink` with offset (`:focus-visible` only, not `:focus` -- keyboard/programmatic focus gets the ring, a mouse click doesn't). **Correction:** originally said `primary-500`, a token that doesn't exist anywhere in `style.css`.
- **Motion**: All animations disabled via `@media (prefers-reduced-motion: reduce)`
- **Keyboard**: All interactive elements focusable and operable
- **Status**: Never rely on color alone — always pair with text or icons

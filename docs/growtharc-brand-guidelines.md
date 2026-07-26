# GrowthArc Brand Guidelines

Extracted from the ArcFlow design reference
(`plans/arcflow/arcflow-roadmap.html`) and already applied to DeliveryOS's
desktop app UI. This doc consolidates the actual design tokens in one place
— add to it as the brand gets formalized further (logo usage rules, voice/
tone, imagery style aren't captured yet below; fill those in as they're
decided).

## Color palette

### Brand (navy / sage)

| Token | Hex | Use |
|---|---|---|
| `--brand-100` | `#F4F9EC` | Lightest sage tint, subtle backgrounds |
| `--brand-300` | `#D4E8B8` | Light sage, secondary accents |
| `--brand-400` | `#ACC384` | Mid sage |
| `--brand-450` | `#7A9955` | Deeper sage |
| `--brand-500` | `#1E3C53` | **Primary brand color** — buttons, headers, nav |
| `--brand-600` | `#162D3F` | Darker navy — hover states, gradient end |
| `--brand-650` | `#0E1E2B` | Darkest navy — footers, deep backgrounds |

### Accent colors

| Token | Hex | Use |
|---|---|---|
| `--cyan-500` | `#0693E3` | Links, informational accents, "AI" gradient start |
| `--cyan-600` | `#0577B8` | Cyan hover/darker variant |
| `--accent-500` | `#7A00DF` | Purple accent — used sparingly, "AI" gradient end |
| `--mint-500` | `#00D084` | Mint accent — success/positive gradient |

### Surfaces & borders

| Token | Hex | Use |
|---|---|---|
| `--surface` | `#FFFCF2` | Page background — warm off-white, not pure white |
| `--surface-tertiary` | `#F6F1E9` | Slightly deeper background (alternating table rows, panels) |
| `--surface-inset` | `#EDE6DA` | Inset/recessed elements (code blocks, wells) |
| `--card` | `#FFFFFF` | Card backgrounds — pure white against the warm page background |
| `--border` | `#E0D9CE` | Default border |
| `--border-strong` | `#C9BFAF` | Emphasized border |
| `--border-subtle` | `#EDE6DA` | Faint divider |

### Secondary palette

| Token | Hex | Use |
|---|---|---|
| `--sand-100` | `#F6E8CC` | Warm neutral accent |
| `--gold-500` | `#FBD17E` | Gold accent (used for one phase-color in multi-phase displays) |
| `--sky-100` | `#DBE8F4` | Light blue background (info blockquotes, badges) |

### Semantic colors

| State | Background | Text |
|---|---|---|
| Success | `--success-100` `#DCF8E6` | `--success-600` `#236D40` |
| Warning | `--warning-100` `#FFF4E0` | `--warning-600` `#9C5D00` |
| Danger | `--danger-100` `#FFE5E0` | `--danger-600` `#A2341F` (also `--danger-500` `#E94E2D` for borders/icons) |

### Gradients

| Token | Value | Use |
|---|---|---|
| `--gradient-brand` | `linear-gradient(90deg, #1E3C53, #162D3F)` | Header/cover backgrounds |
| `--gradient-ai` | `linear-gradient(135deg, #0693E3, #9B51E0)` | "AI-flavored" text/accents (italic emphasis, etc.) |
| `--gradient-mint` | `linear-gradient(135deg, #00D084, #0693E3)` | Positive/success-flavored accents (logo mark, etc.) |

## Typography

| Role | Font | Notes |
|---|---|---|
| Headings (h1-h4) | **EB Garamond** | Serif, weight 400-600, gives a more editorial/premium feel than the body sans |
| Body text, UI, buttons | **IBM Plex Sans** | Weights 400/500/600/700 |
| Code, monospace, ids/versions | **JetBrains Mono** | Weights 400/500 |

Google Fonts import (already used in DeliveryOS's `spike-ui/style.css` and
the ArcFlow reference doc):
```html
<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

Base body: `font-size: 15.5px`, `line-height: 1.6`, color `--brand-500`
against `--surface` background.

## Shape & elevation

| Token | Value |
|---|---|
| `--radius-md` | `0.5rem` |
| `--radius-lg` | `1rem` |
| `--radius-xl` | `1.25rem` |
| `--radius-pill` | `31.25rem` (fully rounded — badges, chips, tags) |
| `--shadow-1` | `0 1px 3px rgb(0 0 0 / 0.04)` — subtle card elevation |
| `--shadow-2` | `0 4px 12px rgb(0 0 0 / 0.08)` — pronounced elevation (modals, hover) |

## Component patterns

- **Eyebrow pill**: small uppercase label above a heading, e.g. `● Suite Roadmap` — `rgba(255,255,255,.08)` background, 1px translucent border, `--radius-pill`, letter-spacing ~1.8px, 11px font.
- **Cover/header**: `--gradient-brand` background, white text, a subtle radial-gradient overlay (cyan + mint glows at low opacity) for texture.
- **Cards**: white (`--card`) background, `1px solid --border`, `--radius-lg`, `--shadow-1`. Left-border accent color varies by category/phase (e.g. sage/cyan/purple/mint/gold for a 5-step sequence).
- **Badges**: small pill, 10-11px bold uppercase text, colored by semantic state (success/warning/danger) or brand.
- **Tags**: similar to badges but neutral-toned, used for metadata (roles, tools, kinds).
- **Tables**: header row uses `--brand-500` background with white/translucent text; alternating body rows use `--surface-tertiary`.
- **Alerts/callouts**: left-border accent (4px, danger or info color), tinted background, used for warnings ("license trap," etc.).
- **Blockquotes**: left-border `--cyan-500`, `--sky-100` background — used for a single pulled-out quote/aside.
- **Footer**: `--brand-650` background, translucent white text, a small gradient-filled logo mark (rounded square, `--gradient-mint`).

## Where this is already applied

- `delivery-os/src-tauri/spike-ui/style.css` — the DeliveryOS desktop app UI uses this palette/typography in full.
- Source of truth for all values above: `plans/arcflow/arcflow-roadmap.html`'s `<style>` block.

## Not yet defined (fill in as decided)

- Logo usage rules (clearspace, minimum size, do/don't)
- Voice & tone guidelines
- Photography/illustration style
- Iconography style guide beyond the inline SVGs already used ad hoc
- Any variant palette for dark mode

# ArcAI Platform — Design System

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
| **`primary-700`** | **`#1E3C53`** | **Primary buttons, active text, heading color** |
| `primary-800` | `#162D3F` | Hover on primary buttons |
| `primary-900` | `#0E1E2B` | Pressed/active state |

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

## Navigation (UX Architecture v1.1)

### Sidebar Structure

```
Home                 → /home         Dashboard: metrics, health, activity
▾ Studio             → (collapsible)  The builder workspace
  ├─ Build           → /studio/build  Create & edit agents, workflows
  └─ Validate        → /studio/validate  Test & evaluate
Monitor              → /monitor       Runs, health, failure alerts
Library              → /library       Browse agents, tools, MCP servers
Admin                → /admin         Users, roles, providers
```

### Sidebar Visual Design
- **Light warm theme**: White background (`bg-white`) with warm border
- **Active state**: `bg-sage-100` (sage green tint) with navy text
- **Collapsible Studio group**: Expanded by default, chevron toggle
- **Logo**: GrowthArc icon + "ArcAI" in serif + "Studio" label

### Route Redirects
| Old Route | Redirects To |
|-----------|-------------|
| `/` | `/home` |
| `/studio` | `/home` |
| `/build` | `/studio/build` |
| `/validate` | `/studio/validate` |

---

## Component Inventory

### Buttons
| Variant | Style | Usage |
|---------|-------|-------|
| `default` | Navy `primary-700` solid | Primary actions |
| `accent` | Purple `accent-500` solid | AI-specific actions |
| `gradient` | Cyan→Purple gradient | ArcAIBot send button |
| `outline` | White with warm border | Secondary actions |
| `ghost` | Text only, warm hover | Inline actions |

### AI Components
| Component | Purpose |
|-----------|---------|
| `GlowCard` | Card with AI glow effects |
| `AIBadge` | "AI Powered" labels with sparkle |
| `PulseIndicator` | Animated live status dots |
| `AISparkle` | Decorative sparkle icon |
| `StreamingText` | Character-by-character text reveal |
| `ArcAIPromptBox` | Shared ChatGPT-style prompt with shimmer border |

### Animations
All respect `prefers-reduced-motion`.

| Animation | Usage |
|-----------|-------|
| `pulse-glow` | Active AI process cards |
| `gradient-shift` | Animated gradient borders |
| `shimmer-border` | ArcAI prompt box border sweep |
| `breathing` | AI active indicator dots |
| `neural-pulse` | Sparkle icons |

---

## Accessibility

- **Contrast**: All text meets WCAG AA (4.5:1 normal, 3:1 large)
- **Focus**: 2px ring in `primary-500` with offset
- **Motion**: All animations disabled via `@media (prefers-reduced-motion: reduce)`
- **Keyboard**: All interactive elements focusable and operable
- **Status**: Never rely on color alone — always pair with text or icons

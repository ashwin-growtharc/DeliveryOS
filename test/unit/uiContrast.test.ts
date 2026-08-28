import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import postcss from 'postcss';

// Enforces the desktop UI's text contrast as a real, failing test.
//
// The stylesheet used to express "quieter text" as an `opacity` on the full
// strength ink colour rather than as its own colour. That composited --ink
// down below the WCAG AA floor in 46 of 200 theme-by-surface checks -- worst
// of all `.tab-row .tab` at 2.75:1, which is the app's primary navigation --
// while DESIGN_SYSTEM.md asserted "All text meets WCAG AA". It did not.
//
// Nothing checked, so nothing caught it. This test is that check. It parses
// the real stylesheet, resolves the real token graph for BOTH themes, and
// composites any surviving `opacity` exactly as a browser would, so it fails
// on the colour a person actually sees rather than the colour that was typed.
//
// The shared implementation lives in scripts/ui/ so the same logic backs the
// developer-facing report (`node scripts/ui/audit-contrast.mjs`, which lists
// every rule and suggests replacement values) and this pass/fail gate.

const REPO_ROOT = path.join(__dirname, '..', '..');
const CSS_PATH = path.join(REPO_ROOT, 'src-tauri', 'spike-ui', 'style.css');

/** WCAG AA for normal-size text. This app's muted text is all small, so
 *  nothing here qualifies for the relaxed 3:1 large-text threshold. */
const AA_NORMAL = 4.5;

const SURFACES = ['--surface', '--card'];

/** Containers painting their own fixed background, whose descendants are
 *  therefore not on a page surface at all -- without these the check reports
 *  confident nonsense (white-on-navy button labels measured against a cream
 *  page come back as 1:1). */
const FIXED_BACKGROUNDS: Array<[string, string]> = [
  ['.wire-terminal-panel', '#181a20'],
  ['.wire-terminal-header', '#101216'],
  ['.wire-terminal-title', '#181a20'],
  ['.wire-terminal-status', '#181a20'],
  ['.wire-terminal', '#181a20'],
];

/** WCAG 1.4.3 exempts inactive controls: a disabled button is meant to read
 *  as unavailable. */
const EXEMPT = /:disabled|::placeholder|@keyframes/;

interface Rgb { r: number; g: number; b: number; a: number }

function parseColor(value: string): Rgb | undefined {
  const hex = value.trim().match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 6) h += 'ff';
    if (h.length !== 8) return undefined;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: parseInt(h.slice(6, 8), 16) / 255,
    };
  }
  const rgb = value.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return undefined;
  const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return undefined;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function luminance({ r, g, b }: Rgb): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastOf(fgValue: string, bgValue: string, opacity: number): number | undefined {
  const fg = parseColor(fgValue);
  const bg = parseColor(bgValue);
  if (!fg || !bg) return undefined;
  const a = fg.a * opacity;
  const composited: Rgb = {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
  const la = luminance(composited);
  const lb = luminance(bg);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

function readTokens(root: postcss.Root) {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  root.walkRules((rule) => {
    const sel = rule.selector.replace(/\s+/g, ' ').trim();
    const isBase = sel === ':root';
    const isDark = sel.includes('data-theme="dark"') || sel.includes(':not([data-theme="light"])');
    if (!isBase && !isDark) return;
    rule.walkDecls((d) => {
      if (!d.prop.startsWith('--')) return;
      if (isBase) {
        light[d.prop] = d.value.trim();
        if (dark[d.prop] === undefined) dark[d.prop] = d.value.trim();
      }
      if (isDark) dark[d.prop] = d.value.trim();
    });
  });
  return { light, dark };
}

function resolve(value: string, tokens: Record<string, string>, depth = 0): string | undefined {
  if (!value || depth > 10) return undefined;
  const m = value.trim().match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/);
  if (!m) return value.trim();
  const direct = tokens[m[1]];
  if (direct !== undefined) return resolve(direct, tokens, depth + 1);
  return m[2] ? resolve(m[2], tokens, depth + 1) : undefined;
}

interface Row {
  selector: string; line?: number; theme: string; opacity: number;
  fg: string; bg: string; ratio: number; pass: boolean;
}

function auditContrast(): Row[] {
  const root = postcss.parse(fs.readFileSync(CSS_PATH, 'utf-8'));
  const tokens = readTokens(root);
  const rows: Row[] = [];

  root.walkRules((rule) => {
    if (rule.selector.startsWith(':root') || rule.selector.includes('@')) return;
    // A @keyframes STEP is a rule whose selector is '0%' / '50%' / 'from',
    // and its `opacity` is animation state, not text colour. Skipping only
    // selectors containing '@' misses them, because the at-rule is the
    // PARENT -- which is how a skeleton pulse keyframe got reported as a
    // text rule failing contrast at 3.11:1.
    if (rule.parent && rule.parent.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return;
    const selector = rule.selector.replace(/\s+/g, ' ').trim();
    if (EXEMPT.test(selector)) return;

    let color: string | undefined;
    let opacity: number | undefined;
    let ownBackground: string | undefined;
    rule.walkDecls((d) => {
      if (d.prop === 'color') color = d.value.trim();
      if (d.prop === 'opacity') opacity = parseFloat(d.value);
      if (d.prop === 'background' || d.prop === 'background-color') {
        const first = d.value.trim().split(/\s+/)[0];
        if (!/gradient|none|transparent|inherit/i.test(first)) ownBackground = first;
      }
    });
    if (color === undefined && opacity === undefined) return;
    const op = opacity === undefined ? 1 : opacity;
    if (op === 0) return;
    const declaredColor: string = color ?? 'var(--ink)';

    for (const theme of ['light', 'dark'] as const) {
      const fg = resolve(declaredColor, tokens[theme]);
      if (!fg) continue;
      const fixed = FIXED_BACKGROUNDS.find(([anc]) => selector.startsWith(anc));
      let candidates: Array<string | undefined>;
      if (ownBackground) candidates = [resolve(ownBackground, tokens[theme])];
      else if (fixed) candidates = [fixed[1]];
      else candidates = SURFACES.map((t) => resolve(`var(${t})`, tokens[theme]));

      let worst: { ratio: number; bg: string } | undefined;
      for (const bg of candidates) {
        if (!bg) continue;
        const ratio = contrastOf(fg, bg, op);
        if (ratio === undefined) continue;
        if (!worst || ratio < worst.ratio) worst = { ratio, bg };
      }
      if (!worst) continue;
      rows.push({
        selector, line: rule.source?.start?.line, theme, opacity: op,
        fg, bg: worst.bg, ratio: worst.ratio, pass: worst.ratio >= AA_NORMAL,
      });
    }
  });
  return rows;
}

describe('desktop UI text contrast (WCAG AA)', () => {
  const rows = auditContrast();

  it('examines a meaningful number of text rules in both themes', () => {
    // Guards against the check silently passing because it stopped finding
    // anything -- a rename or a restructure that broke the parse would
    // otherwise look identical to "everything passes".
    expect(rows.length).toBeGreaterThan(120);
    expect(rows.some((r) => r.theme === 'light')).toBe(true);
    expect(rows.some((r) => r.theme === 'dark')).toBe(true);
  });

  it('has every text rule at or above 4.5:1 in both light and dark', () => {
    const failures = rows.filter((r) => !r.pass);
    const detail = failures
      .sort((a, b) => a.ratio - b.ratio)
      .map((r) => `  ${r.ratio}:1  ${r.theme}  ${r.fg} on ${r.bg}  ${r.selector}  (style.css:${r.line})`)
      .join('\n');
    expect(
      failures.length,
      failures.length === 0
        ? ''
        : `${failures.length} text rule(s) below WCAG AA.\n${detail}\n\n`
          + 'Run `node scripts/ui/audit-contrast.mjs` for the full report, or\n'
          + '`--all` to see passing rules too. Use a --text-* token rather than\n'
          + 'an opacity on --ink: opacity composites the colour down below the\n'
          + 'floor, which is exactly how 46 rules ended up failing unnoticed.',
    ).toBe(0);
  });

  it('resolves the three text tokens in both themes', () => {
    // The tokens the whole conversion depends on. If a rename drops one, the
    // var() falls back to nothing and text silently inherits -- which would
    // still "pass" the ratio check above.
    const root = postcss.parse(fs.readFileSync(CSS_PATH, 'utf-8'));
    const tokens = readTokens(root);
    for (const theme of ['light', 'dark'] as const) {
      for (const token of ['--text-primary', '--text-secondary', '--text-tertiary']) {
        const resolved = resolve(`var(${token})`, tokens[theme]);
        expect(resolved, `${token} must resolve in the ${theme} theme`).toBeTruthy();
        expect(parseColor(resolved as string), `${token} (${theme}) must be a real colour`).toBeTruthy();
      }
    }
  });
});

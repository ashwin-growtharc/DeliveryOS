// Reports the real WCAG contrast of every text rule in style.css, in both
// themes, by resolving the token graph and compositing any `opacity` the rule
// applies. Read-only: it changes nothing, it just tells the truth about what
// the stylesheet currently renders.
//
// Run: node scripts/ui/audit-contrast.mjs [--all]
//   (default prints only failures; --all prints every text rule)

import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { effectiveContrast, mostMutedPassing, AA_NORMAL } from './lib/color.mjs';

const CSS_PATH = path.join(process.cwd(), 'src-tauri', 'spike-ui', 'style.css');

/** Reads the token values for one theme out of the stylesheet's own :root
 *  blocks, so this script can never drift from the real palette. */
function readTokens(root) {
  const light = {};
  const dark = {};
  root.walkRules((rule) => {
    const sel = rule.selector.replace(/\s+/g, ' ').trim();
    const isBase = sel === ':root';
    const isDark = sel.includes('data-theme="dark"') || sel.includes(':not([data-theme="light"])');
    if (!isBase && !isDark) return;
    rule.walkDecls((d) => {
      if (!d.prop.startsWith('--')) return;
      if (isBase) { light[d.prop] = d.value.trim(); dark[d.prop] ??= d.value.trim(); }
      if (isDark) dark[d.prop] = d.value.trim();
    });
  });
  return { light, dark };
}

/** Resolves `var(--x, fallback)` chains down to a literal, or undefined. */
function resolve(value, tokens, depth = 0) {
  if (!value || depth > 10) return undefined;
  const v = value.trim();
  const m = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/);
  if (!m) return v;
  const direct = tokens[m[1]];
  if (direct !== undefined) return resolve(direct, tokens, depth + 1);
  return m[2] ? resolve(m[2], tokens, depth + 1) : undefined;
}

const css = fs.readFileSync(CSS_PATH, 'utf-8');
const root = postcss.parse(css);
const tokens = readTokens(root);

// The two real surfaces text sits on. A static analysis cannot know which
// ancestor any given rule lands on, so each rule is judged against BOTH and
// reported by its worst case -- conservative on purpose.
const SURFACES = ['--surface', '--card'];

// Containers that paint their OWN fixed background, so their descendants are
// not on --surface/--card at all. Without these, the audit reports confident
// nonsense: white-on-navy button labels get measured against the page surface
// and come back as 1:1, and the embedded terminal's light-grey chrome gets
// measured against a cream page instead of the near-black panel it sits on.
// Keyed by an ancestor selector, matched against the start of a rule's
// selector -- crude, but this app's structure is flat enough for it to hold,
// and a wrong entry shows up immediately as an implausible ratio.
const FIXED_BACKGROUNDS = [
  ['.wire-terminal-panel', '#181a20'],
  ['.wire-terminal-header', '#101216'],
  ['.wire-terminal-title', '#181a20'],
  ['.wire-terminal-status', '#181a20'],
  ['.wire-terminal', '#181a20'],
];

// WCAG 1.4.3 explicitly exempts inactive controls from the contrast minimum:
// a disabled button is *meant* to read as unavailable. Excluded so the report
// stays honest -- padding it with rules that are correct as they stand would
// make the real failures harder to see.
const EXEMPT = /:disabled|::placeholder|@keyframes/;

const rows = [];
root.walkRules((rule) => {
  if (rule.selector.startsWith(':root') || rule.selector.includes('@')) return;
  const selector = rule.selector.replace(/\s+/g, ' ').trim();
  if (EXEMPT.test(selector)) return;

  let color;
  let opacity;
  let ownBackground;
  rule.walkDecls((d) => {
    if (d.prop === 'color') color = d.value.trim();
    if (d.prop === 'opacity') opacity = parseFloat(d.value);
    // A rule that paints its own background is text ON that background, not
    // on the page surface -- this is what makes white-on-navy button labels
    // measurable at all instead of reporting a nonsensical 1:1.
    if (d.prop === 'background' || d.prop === 'background-color') {
      const first = d.value.trim().split(/\s+/)[0];
      if (!/gradient|none|transparent|inherit/i.test(first)) ownBackground = first;
    }
  });
  // A rule with only an opacity still fades inherited text, so treat a bare
  // opacity as acting on --ink, which is what body text resolves to.
  if (color === undefined && opacity === undefined) return;
  const declaredColor = color ?? 'var(--ink)';
  const op = opacity === undefined ? 1 : opacity;
  if (op === 0) return; // fully transparent: an animation keyframe, not text

  for (const theme of ['light', 'dark']) {
    const fg = resolve(declaredColor, tokens[theme]);
    if (!fg) continue;
    // Backgrounds to judge against, most specific first: the rule's own, then
    // a fixed-background ancestor, then the two page surfaces.
    const fixed = FIXED_BACKGROUNDS.find(([anc]) => selector.startsWith(anc));
    let candidates;
    if (ownBackground) candidates = [resolve(ownBackground, tokens[theme])];
    else if (fixed) candidates = [fixed[1]];
    else candidates = SURFACES.map((t) => resolve(`var(${t})`, tokens[theme]));

    let worst;
    for (const bg of candidates) {
      if (!bg) continue;
      const ratio = effectiveContrast(fg, bg, op);
      if (ratio === undefined) continue;
      if (!worst || ratio < worst.ratio) worst = { ratio, bg };
    }
    if (!worst) continue;
    rows.push({
      selector,
      line: rule.source?.start?.line,
      theme,
      opacity: op,
      fg,
      bg: worst.bg,
      ratio: worst.ratio,
      pass: worst.ratio >= AA_NORMAL,
    });
  }
});

const showAll = process.argv.includes('--all');
const failures = rows.filter((r) => !r.pass);
const shown = showAll ? rows : failures;
shown.sort((a, b) => a.ratio - b.ratio);

for (const r of shown) {
  const flag = r.pass ? 'ok  ' : 'FAIL';
  console.log(
    `${flag} ${String(r.ratio).padStart(5)}:1  ${r.theme.padEnd(5)} ` +
      `op=${String(r.opacity).padEnd(4)} ${r.fg} on ${r.bg}  ` +
      `${r.selector}  (style.css:${r.line})`,
  );
}

console.log('');
console.log(`text rules examined : ${rows.length / 2} (x2 themes = ${rows.length} checks)`);
console.log(`below WCAG AA (4.5) : ${failures.length}`);
console.log(`  light theme       : ${failures.filter((r) => r.theme === 'light').length}`);
console.log(`  dark theme        : ${failures.filter((r) => r.theme === 'dark').length}`);

// Suggest real token values: the MOST MUTED colour that still passes, so the
// visual hierarchy the opacity ramp was reaching for survives the conversion.
console.log('');
console.log('suggested text tokens (most muted value that still clears 4.5:1):');
for (const theme of ['light', 'dark']) {
  const ink = resolve('var(--ink)', tokens[theme]);
  const surface = resolve('var(--surface)', tokens[theme]);
  const card = resolve('var(--card)', tokens[theme]);
  for (const [label, bg] of [['--surface', surface], ['--card', card]]) {
    const s = mostMutedPassing(ink, bg, bg);
    console.log(`  ${theme.padEnd(5)} on ${label.padEnd(9)} (${bg}): ink=${ink}  most-muted-passing=${s?.hex} @ ${s?.ratio}:1`);
  }
}

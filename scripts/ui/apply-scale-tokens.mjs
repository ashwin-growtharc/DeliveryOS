// One-shot codemod: sweeps the remaining hardcoded values onto the scale
// tokens. Kept in the repo so the mapping is reviewable rather than buried in
// a diff — every collapse below is a deliberate decision, not a find-replace.
//
// Deliberately does NOT touch spacing (padding/gap/margin). Those change
// layout rather than just appearance, so they get their own pass with visual
// verification either side of it.
//
// Run: node scripts/ui/apply-scale-tokens.mjs [--dry]

import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const CSS_PATH = path.join(process.cwd(), 'src-tauri', 'spike-ui', 'style.css');
const DRY = process.argv.includes('--dry');

/** Font sizes: 13 distinct values -> 7 tokens.
 *
 *  The old set was 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 18, 20, 22, 23
 *  — an eight-step ramp inside a 3.5px range, with four half-pixel steps.
 *  That reads as noise, not hierarchy. Sub-11px values round UP rather than
 *  staying microscopic; 23px joins 22px since nothing distinguishes them. */
const FONT_SIZE = {
  '10px': 'var(--text-2xs)', '10.5px': 'var(--text-2xs)', '11px': 'var(--text-2xs)',
  '11.5px': 'var(--text-xs)', '12px': 'var(--text-xs)', '12.5px': 'var(--text-xs)',
  '13px': 'var(--text-sm)', '13.5px': 'var(--text-sm)',
  '14px': 'var(--text-base)',
  '18px': 'var(--text-lg)',
  '20px': 'var(--text-xl)',
  '22px': 'var(--text-2xl)', '23px': 'var(--text-2xl)',
};

/** Font stacks: five spellings of three families -> three tokens.
 *
 *  The mono stack was written three ways, and the short form silently dropped
 *  the ui-monospace/Consolas fallbacks — so the same "code" text rendered in
 *  different faces depending on which rule won. */
const FONT_FAMILY = {
  "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif": 'var(--font-sans)',
  "'EB Garamond', Georgia, serif": 'var(--font-serif)',
  "'JetBrains Mono', ui-monospace, Consolas, monospace": 'var(--font-mono)',
  "'JetBrains Mono', monospace": 'var(--font-mono)',
  'var(--font-mono, monospace)': 'var(--font-mono)',
};

/** Radii: the hardcoded values that sat alongside the tokens.
 *  `50%` stays literal — that is a circle, not a scale step. */
const RADIUS = {
  '4px': 'var(--radius-sm)',
  '8px': 'var(--radius-md)',
  '10px': 'var(--radius-md)',
  '12px': 'var(--radius-lg)',
  '14px': 'var(--radius-lg)',
};

/** Transition durations -> motion tokens. Matched per-segment so a
 *  multi-property transition keeps its property list intact. */
const DURATION = { '.1s': 'var(--motion-fast)', '0.1s': 'var(--motion-fast)', '.15s': 'var(--motion-fast)', '0.15s': 'var(--motion-fast)' };

const css = fs.readFileSync(CSS_PATH, 'utf-8');
const root = postcss.parse(css);
const counts = { 'font-size': 0, 'font-family': 0, 'border-radius': 0, transition: 0, 'z-index': 0 };
const skipped = [];

root.walkDecls((decl) => {
  // Never rewrite inside the token definitions themselves.
  if (decl.parent.type === 'rule' && decl.parent.selector.includes(':root')) return;
  const v = decl.value.trim();

  if (decl.prop === 'font-size' && FONT_SIZE[v]) {
    decl.value = FONT_SIZE[v];
    counts['font-size'] += 1;
    return;
  }

  if (decl.prop === 'font-family') {
    if (FONT_FAMILY[v]) { decl.value = FONT_FAMILY[v]; counts['font-family'] += 1; }
    else if (v !== 'inherit') skipped.push(`font-family: ${v}  (${decl.parent.selector})`);
    return;
  }

  if (decl.prop === 'border-radius') {
    if (RADIUS[v]) { decl.value = RADIUS[v]; counts['border-radius'] += 1; }
    else if (!v.startsWith('var(') && v !== '50%') skipped.push(`border-radius: ${v}  (${decl.parent.selector})`);
    return;
  }

  if (decl.prop === 'transition' && v !== 'none') {
    // `background .1s ease, opacity .1s ease` -> replace the duration+easing
    // pair with one token per segment, leaving the property names alone.
    const rewritten = v.split(',').map((seg) => {
      const m = seg.trim().match(/^([\w-]+)\s+([\d.]+m?s)\s+(ease(?:-out|-in|-in-out)?|linear)$/);
      if (!m) return seg.trim();
      const token = m[3] === 'ease-out' ? 'var(--motion-reveal)' : DURATION[m[2]] ?? 'var(--motion-fast)';
      return `${m[1]} ${token}`;
    }).join(', ');
    if (rewritten !== v) { decl.value = rewritten; counts.transition += 1; }
    return;
  }

  if (decl.prop === 'z-index') {
    const map = { '2000': 'var(--z-toast)', '1000': 'var(--z-overlay)', '10': 'var(--z-sticky)' };
    if (map[v]) { decl.value = map[v]; counts['z-index'] += 1; }
  }
});

if (!DRY) fs.writeFileSync(CSS_PATH, root.toString(), 'utf-8');

for (const [k, n] of Object.entries(counts)) console.log(`${k.padEnd(14)} rewritten: ${n}`);
if (skipped.length) {
  console.log(`\nleft alone (${skipped.length}) -- review these by hand:`);
  for (const s of skipped) console.log('  ' + s);
}
if (DRY) console.log('\n(dry run -- nothing written)');

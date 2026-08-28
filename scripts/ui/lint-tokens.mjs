// Fails when the stylesheet bypasses its own design tokens.
//
// The token layer is only worth having if something enforces it. This file
// grew to 13 hardcoded font sizes (four of them half-pixel), 44 padding
// combinations, five spellings of three font stacks and a pile of stray hex
// literals precisely because nothing ever said no. Every one of those was a
// reasonable local decision; the damage was cumulative.
//
// Run: node scripts/ui/lint-tokens.mjs [--summary]
// Exits non-zero on any violation, so it can gate a build.

import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const CSS_PATH = path.join(process.cwd(), 'src-tauri', 'spike-ui', 'style.css');
const SUMMARY_ONLY = process.argv.includes('--summary');

/** Deliberate exceptions, each with the reason it is allowed. An allow-list
 *  with justifications beats a rule nobody can satisfy — and keeps the
 *  exceptions visible instead of quietly growing. */
const ALLOWED = {
  // Values that are structural rather than part of a design scale.
  literalLengths: new Set([
    '0', '0px', '1px', '2px', '100%', '50%', 'auto', 'none', 'inherit', '100vh', '100vw',
  ]),
  // Properties where a raw length is normal: hairline borders, transforms,
  // and anything measuring a real object rather than expressing rhythm.
  exemptProps: new Set([
    'border', 'border-top', 'border-bottom', 'border-left', 'border-right',
    'border-width', 'outline', 'outline-offset', 'outline-width',
    'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
    'flex', 'flex-basis', 'top', 'right', 'bottom', 'left', 'inset',
    'transform', 'background-position', 'background-size', 'stroke-width',
    'line-height', 'letter-spacing', 'grid-template-columns', 'grid-template-rows',
    'box-shadow', 'text-shadow', 'filter', 'backdrop-filter', 'background-image',
  ]),
  // The embedded terminal paints a deliberately fixed dark chrome that does
  // not follow the app's themeable surfaces; xterm needs concrete colours.
  fixedChromeSelectors: /^\.wire-terminal/,
};

const root = postcss.parse(fs.readFileSync(CSS_PATH, 'utf-8'));
const violations = [];

function report(decl, rule, message) {
  violations.push({
    rule,
    message,
    selector: decl.parent?.selector?.replace(/\s+/g, ' ').trim() ?? '(unknown)',
    line: decl.source?.start?.line,
    text: `${decl.prop}: ${decl.value}`,
  });
}

root.walkDecls((decl) => {
  const inTokens = decl.parent.type === 'rule' && decl.parent.selector.includes(':root');
  const selector = decl.parent?.selector ?? '';
  const inFixedChrome = ALLOWED.fixedChromeSelectors.test(selector.trim());
  const value = decl.value.trim();

  // 1. Raw colour literals outside the token definitions.
  if (!inTokens && !inFixedChrome) {
    const hexes = value.match(/#[0-9a-fA-F]{3,8}\b/g);
    if (hexes) report(decl, 'no-raw-hex', `raw colour ${hexes.join(', ')} — use a palette token`);
  }

  // 2. Font sizes must come from the type scale.
  if (decl.prop === 'font-size' && !inTokens && !/^var\(--text-/.test(value)) {
    report(decl, 'no-raw-font-size', 'use --text-2xs..--text-2xl');
  }

  // 3. Font stacks must come from the three family tokens.
  if (decl.prop === 'font-family' && !inTokens && value !== 'inherit' && !/^var\(--font-/.test(value)) {
    report(decl, 'no-raw-font-stack', 'use --font-sans / --font-serif / --font-mono');
  }

  // 4. Radii must come from the radius scale (50% is a circle, not a step).
  if (decl.prop === 'border-radius' && !inTokens && !/^var\(--radius-/.test(value) && value !== '50%') {
    report(decl, 'no-raw-radius', 'use --radius-sm/md/lg/xl/pill');
  }

  // 5. Transition durations must come from the motion tokens, so
  //    prefers-reduced-motion has one place to reason about.
  if (decl.prop === 'transition' && value !== 'none' && /[\d.]+m?s/.test(value)) {
    report(decl, 'no-raw-duration', 'use --motion-fast / --motion-reveal');
  }

  // 6. Spacing must sit on the 4px grid the design kit specifies.
  if (!inTokens && /^(padding|margin|gap|row-gap|column-gap)(-top|-right|-bottom|-left)?$/.test(decl.prop)) {
    const lengths = value.split(/\s+/).filter((t) => /^-?[\d.]+px$/.test(t));
    const offGrid = lengths.filter((t) => {
      if (ALLOWED.literalLengths.has(t)) return false;
      // Negative offsets are optical corrections, not rhythm: a -1px pulls a
      // tab down onto its row's border, a -6px tucks a loading line under the
      // row above. They are measured against a real edge, so they have no
      // business on the spacing scale — and rounding one to the nearest 4px
      // would visibly break the alignment it exists to achieve.
      if (t.startsWith('-')) return false;
      const n = parseFloat(t);
      // Above the scale's 32px ceiling is page-level layout, not component
      // rhythm; the scale has nothing sensible to say about it.
      if (n > 32) return false;
      return n % 4 !== 0;
    });
    if (offGrid.length) {
      report(decl, 'off-grid-spacing', `${offGrid.join(', ')} not on the 4px grid — use --space-1..8`);
    }
  }
});

const byRule = violations.reduce((acc, v) => {
  (acc[v.rule] ??= []).push(v);
  return acc;
}, {});

for (const [ruleName, list] of Object.entries(byRule)) {
  console.log(`\n${ruleName}  (${list.length})`);
  if (SUMMARY_ONLY) continue;
  for (const v of list.slice(0, 40)) {
    console.log(`  style.css:${String(v.line).padEnd(5)} ${v.selector}`);
    console.log(`      ${v.text}   -- ${v.message}`);
  }
  if (list.length > 40) console.log(`  ... and ${list.length - 40} more`);
}

console.log('');
if (violations.length === 0) {
  console.log('token lint: clean — no design-token bypasses');
  process.exit(0);
}
console.log(`token lint: ${violations.length} violation(s)`);
process.exit(1);

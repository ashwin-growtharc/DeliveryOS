// One-shot codemod: snaps padding/margin/gap onto the spacing scale.
//
// Split out from apply-scale-tokens.mjs on purpose. Type, colour and radius
// changes are appearance-only; spacing changes LAYOUT, so it gets its own
// commit with screenshots either side rather than riding along with work that
// cannot push anything off-screen.
//
// The stylesheet had 44 distinct padding combinations and 17 distinct
// off-grid length values (10px x48, 14px x34, 6px x20, plus one-offs at 5, 7,
// 9, 11, 13, 15, 18, 19, 22). None of that was a decision anyone made — it is
// what you get when 30 screens each pick a plausible number.
//
// Mapping rule, applied uniformly so it can be reasoned about rather than
// argued case by case:
//   1-3px  -> --space-05 (2px)   the deliberate half-step, for chip padding
//   else   -> nearest multiple of 4, TIES RESOLVE DOWN
//
// Ties go down because this is a dense tool UI where the failure mode of
// growing is content clipping or wrapping, and the failure mode of shrinking
// is merely tighter. 6->4, 10->8, 14->12 and 22->20 are the four tie cases,
// and they account for most of the change.
//
// Run: node scripts/ui/apply-space-tokens.mjs [--dry]

import fs from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

const CSS_PATH = path.join(process.cwd(), 'src-tauri', 'spike-ui', 'style.css');
const DRY = process.argv.includes('--dry');

const SPACE_PROPS = /^(padding|margin|gap|row-gap|column-gap)(-top|-right|-bottom|-left)?$/;

/** px value -> token name, following the rule in this file's header. */
const TOKEN_FOR = new Map([
  [2, '--space-05'], [4, '--space-1'], [8, '--space-2'], [12, '--space-3'],
  [16, '--space-4'], [20, '--space-5'], [24, '--space-6'], [28, '--space-7'],
  [32, '--space-8'],
]);

/** Returns the snapped px value, or undefined to leave the value alone.
 *
 *  Two deliberate pass-throughs, both found by dry-running this and reading
 *  the output rather than trusting the rule:
 *
 *  - 1px is a structural hairline (aligning against a 1px border), not
 *    rhythm. Snapping it to 2px would double a deliberate optical nudge.
 *  - Anything above the scale's 32px ceiling is page-level layout, not
 *    component rhythm. An early version clamped a 60px value to 32px, which
 *    is not a snap — it is silently halving a gap someone chose. */
function snap(px) {
  if (px <= 1) return undefined;
  if (px > 32) return undefined;
  if (px <= 3) return 2;
  const lower = Math.floor(px / 4) * 4;
  const upper = lower + 4;
  // Ties resolve down; otherwise nearest.
  return px - lower <= upper - px ? lower : upper;
}

const root = postcss.parse(fs.readFileSync(CSS_PATH, 'utf-8'));
const changes = [];
let rewritten = 0;

root.walkDecls((decl) => {
  if (decl.parent.type === 'rule' && decl.parent.selector.includes(':root')) return;
  if (!SPACE_PROPS.test(decl.prop)) return;

  const before = decl.value.trim();
  // `auto`, `0`, percentages, calc() and var() pass through untouched.
  if (/calc\(|%|auto|var\(/.test(before)) return;

  const tokens = before.split(/\s+/);
  let touched = false;
  const after = tokens.map((t) => {
    const m = t.match(/^(-?)([\d.]+)px$/);
    if (!m) return t;
    const sign = m[1];
    const px = parseFloat(m[2]);
    if (px === 0) return t;
    // Negative offsets are structural nudges (a -1px border overlap), not
    // rhythm — leave them alone rather than inventing a negative scale.
    if (sign === '-') return t;
    const snapped = snap(px);
    if (snapped === undefined) return t;
    const name = TOKEN_FOR.get(snapped);
    if (!name) return t;
    if (snapped !== px) touched = true;
    return `var(${name})`;
  }).join(' ');

  if (after !== before) {
    changes.push({
      line: decl.source?.start?.line,
      selector: decl.parent.selector.replace(/\s+/g, ' ').trim(),
      from: `${decl.prop}: ${before}`,
      to: `${decl.prop}: ${after}`,
      resized: touched,
    });
    decl.value = after;
    rewritten += 1;
  }
});

if (!DRY) fs.writeFileSync(CSS_PATH, root.toString(), 'utf-8');

const resized = changes.filter((c) => c.resized);
console.log(`declarations rewritten     : ${rewritten}`);
console.log(`  of which change a value  : ${resized.length}  (the rest were already on-grid)`);
console.log('');
console.log('value changes (old -> new):');
const tally = new Map();
for (const c of resized) {
  const froms = c.from.match(/[\d.]+px/g) ?? [];
  for (const f of froms) {
    const px = parseFloat(f);
    const to = snap(px);
    if (to !== undefined && to !== px) tally.set(`${px}px -> ${to}px`, (tally.get(`${px}px -> ${to}px`) ?? 0) + 1);
  }
}
for (const [k, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(18)} x${n}`);
}
if (DRY) console.log('\n(dry run -- nothing written)');

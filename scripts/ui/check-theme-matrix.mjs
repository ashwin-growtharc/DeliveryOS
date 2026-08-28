// Verifies the theme system resolves correctly in all six combinations of
// (OS prefers-color-scheme) x (explicit data-theme choice).
//
// This exists because style.css used to declare every themed token FOUR times
// -- base :root, the prefers-color-scheme media block, [data-theme="dark"],
// and a [data-theme="light"] block that restated the base values verbatim.
// 24 tokens x 4 blocks = 72 hand-synchronised declarations, which is why a
// colour could end up right in one theme and wrong in the other.
//
// Collapsing that to two blocks hinges entirely on one detail: the media
// query must be guarded with `:not([data-theme="light"])`. Without the guard,
// "force light on a dark-preference OS" silently keeps the dark palette --
// exactly the case the deleted block existed to serve. This script is the
// proof that the guard works, in both directions, from both OS defaults.
//
// Runs against the real index.html in a real browser (the same channel-based
// launcher src/engine/preview/renderPreviewImage.ts uses), so it tests the
// actual cascade rather than a reimplementation of it.

import fs from 'node:fs';
import postcss from 'postcss';
import { chromium } from 'playwright-core';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Derived from the stylesheet itself, never hardcoded.
//
// An earlier version listed the 24 tokens by hand -- and then silently missed
// a real bug: a bad edit left --sage-50 and --icon-fg-sage out of one of the
// two dark blocks entirely, so the two disagreed and one theme path was
// wrong. The check passed, because neither token was on its list. A guard
// that only inspects what you remembered to tell it about is not a guard.
const TOKENS = (() => {
  const css = fs.readFileSync(
    path.join(process.cwd(), 'src-tauri', 'spike-ui', 'style.css'), 'utf-8',
  );
  const root = postcss.parse(css);
  const names = new Set();
  root.walkRules((rule) => {
    const sel = rule.selector.replace(/\s+/g, ' ').trim();
    // Only tokens that a theme block actually redefines can differ between
    // themes; the rest are theme-invariant by construction.
    if (!/data-theme="dark"|not\(\[data-theme="light"\]\)/.test(sel)) return;
    rule.walkDecls((d) => { if (d.prop.startsWith('--')) names.add(d.prop); });
  });
  return [...names].sort();
})();

const url = pathToFileURL(path.join(process.cwd(),'src-tauri','spike-ui','index.html')).href;
let b;
for (const channel of ['chrome','msedge']) { try { b = await chromium.launch({ channel }); break; } catch {} }

async function read(colorScheme, dataTheme) {
  const ctx = await b.newContext({ colorScheme });
  const p = await ctx.newPage();
  await p.goto(url, { waitUntil: 'load' });
  if (dataTheme) await p.evaluate(t => document.documentElement.setAttribute('data-theme', t), dataTheme);
  else await p.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  const out = await p.evaluate(toks => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(toks.map(t => [t, cs.getPropertyValue(t).trim()]));
  }, TOKENS);
  await ctx.close();
  return out;
}

const cases = [
  ['os=light attr=none ', 'light', null],
  ['os=dark  attr=none ', 'dark',  null],
  ['os=light attr=dark ', 'light', 'dark'],
  ['os=dark  attr=dark ', 'dark',  'dark'],
  ['os=light attr=light', 'light', 'light'],
  ['os=dark  attr=light', 'dark',  'light'],
];
const results = {};
for (const [label, cs, dt] of cases) results[label] = await read(cs, dt);
await b.close();

const isDark = o => o['--surface'] === '#15181B';
console.log(`checking ${TOKENS.length} theme-varying tokens (derived from style.css)`);
console.log('resolved theme per case:');
for (const [label, o] of Object.entries(results)) {
  console.log('  ' + label + ' -> ' + (isDark(o) ? 'DARK' : 'LIGHT') + '  ink=' + o['--ink']);
}
const expect = { 'os=light attr=none ':'LIGHT','os=dark  attr=none ':'DARK','os=light attr=dark ':'DARK',
  'os=dark  attr=dark ':'DARK','os=light attr=light':'LIGHT','os=dark  attr=light':'LIGHT' };
let ok = true;
for (const [label, want] of Object.entries(expect)) {
  const got = isDark(results[label]) ? 'DARK' : 'LIGHT';
  if (got !== want) { console.log('MISMATCH ' + label + ' want ' + want + ' got ' + got); ok = false; }
}
const darkRef = results['os=dark  attr=none '], darkAttr = results['os=light attr=dark '];
for (const t of TOKENS) if (darkRef[t] !== darkAttr[t]) { console.log('DARK MISMATCH ' + t + ': ' + darkRef[t] + ' vs ' + darkAttr[t]); ok = false; }
console.log(ok ? 'ALL 6 THEME CASES CORRECT, dark values identical across both paths' : 'FAILURES ABOVE');
process.exit(ok ? 0 : 1);

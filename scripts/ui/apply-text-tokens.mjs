// One-shot codemod: converts `opacity`-as-muted-text into the real text
// colour tokens. Kept in the repo rather than run ad-hoc so the mapping is
// reviewable — the decision for every single rule is in the table below, not
// buried in a diff.
//
// The mapping is by ROLE, not by the opacity number that happened to be
// there. That is the point of the exercise: the same role currently gets
// several different values (field labels at .55 in four places and .65 in
// three; counts at .5/.55/.65; body text at .7/.8/.85/.9), and collapsing
// those is what makes the app read as coordinated rather than merely legible.
//
//   secondary (7.4:1 light / 6.4:1 dark) — things you READ: labels, hints,
//                                          descriptions, summaries
//   tertiary  (5.7:1 light / 4.9:1 dark) — things you GLANCE at: counts,
//                                          meta, captions, index numbers
//
// Run: node scripts/ui/apply-text-tokens.mjs

import fs from 'node:fs';
import path from 'node:path';

const CSS_PATH = path.join(process.cwd(), 'src-tauri', 'spike-ui', 'style.css');

/** selector -> token. These rules lose their `opacity` and gain a `color`. */
const TO_TOKEN = {
  // --- read: labels, hints, descriptions ---
  '.meta-grid .k': 'secondary',
  '.install-path-label': 'secondary',
  '.field-hint': 'secondary',
  '.wizard-review-label': 'secondary',
  '.settings-row .s': 'secondary',
  '.empty-state': 'secondary',
  '.install-param-help': 'secondary',
  '.route-node-error-note': 'secondary',
  '.wizard-progress-label': 'secondary',
  '.control-row label': 'secondary',
  '.wiring-section-label': 'secondary',
  '.type-sample-label': 'secondary',
  '.template-theme-toggle-caption': 'secondary',
  '.field label': 'secondary',
  '.ui-component-row-header .description': 'secondary',
  '.wiring-action-instructions': 'secondary',
  '.kind-group-row .row-main .summary': 'secondary',
  '.res-card .summary': 'secondary',
  '.component-detail-usage-rule': 'secondary',
  '.detail-description': 'secondary',
  '.detail-tabs-loading': 'secondary',

  // --- glance: counts, meta, captions ---
  '.folder-label': 'tertiary',
  '.page-head .count': 'tertiary',
  '.res-card .kind-label': 'tertiary',
  '.tag-item-count': 'tertiary',
  '.ui-component-row-header .meta': 'tertiary',
  '.res-card .meta': 'tertiary',
  '.detail-title .kind-label': 'tertiary',
  '.progress-line .stage': 'tertiary',
  '.kind-group-header .count': 'tertiary',
  '.radius-token-chip span': 'tertiary',
  '.template-component-caption': 'tertiary',
  '.layout-rules-note': 'tertiary',
  '.ui-component-preview-loading': 'tertiary',
  '.ui-component-row-header .index': 'tertiary',

  // --- near-full-strength body text ---
  '.progress-line .msg': 'primary',
};

/** Rules whose `opacity: 1` overrides nothing — `.badge` has no base opacity,
 *  so these four were pure noise. Deleted rather than converted. */
const DELETE_OPACITY = [
  '.badge.pulled',
  '.badge.edited_locally',
  '.badge.update_available',
  '.badge.both_changed',
];

/** Interaction ramps: an inactive/hover/active trio that must convert as ONE
 *  unit or the states stop relating to each other. `.tab-row .tab` is the
 *  important one — at opacity .5 the app's primary navigation sat at 2.75:1. */
const RAMPS = [
  { sel: '.tab-row .tab', token: 'tertiary' },
  { sel: '.tab-row .tab:hover', token: 'secondary' },
  { sel: '.tab-row .tab.active', token: 'ink' },
  { sel: '.sidebar-item', token: 'secondary' },
  { sel: '.sidebar-item:hover', token: 'ink' },
  { sel: '.sidebar-item.active', token: 'ink' },
  { sel: '.tag-chip-remove', token: 'tertiary' },
  { sel: '.tag-chip-remove:hover', token: 'ink' },
];

const VAR = { primary: 'var(--text-primary)', secondary: 'var(--text-secondary)', tertiary: 'var(--text-tertiary)', ink: 'var(--ink)' };

let css = fs.readFileSync(CSS_PATH, 'utf-8');
const report = { converted: [], ramped: [], deleted: [], missed: [] };

/** Rewrites one rule block, found by its exact selector at line start. */
function editRule(selector, fn) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|\\n)(${escaped})\\s*\\{([^}]*)\\}`, 'm');
  const m = css.match(re);
  if (!m) return false;
  const body = fn(m[3]);
  if (body === null) return false;
  css = css.slice(0, m.index) + m[1] + m[2] + ' {' + body + '}' + css.slice(m.index + m[0].length);
  return true;
}

for (const [sel, role] of Object.entries(TO_TOKEN)) {
  const ok = editRule(sel, (body) => {
    if (!/opacity\s*:/.test(body)) return null;
    let out = body.replace(/\n?\s*opacity\s*:[^;]+;/g, '');
    if (/(^|[\s;{])color\s*:/.test(out)) out = out.replace(/(^|[\s;{])color\s*:[^;]+;/, `$1color: ${VAR[role]};`);
    else out = out.replace(/\n(\s*)\}?$/, `\n$1color: ${VAR[role]};\n$1`);
    if (!/color\s*:/.test(out)) out = out.replace(/;\s*$/, `;\n  color: ${VAR[role]};\n`);
    return out;
  });
  (ok ? report.converted : report.missed).push(sel);
}

for (const { sel, token } of RAMPS) {
  const ok = editRule(sel, (body) => {
    let out = body.replace(/\n?\s*opacity\s*:[^;]+;/g, '');
    if (/(^|[\s;{])color\s*:/.test(out)) out = out.replace(/(^|[\s;{])color\s*:[^;]+;/, `$1color: ${VAR[token]};`);
    else out = out.replace(/;\s*$/, `;\n  color: ${VAR[token]};\n`);
    return out;
  });
  (ok ? report.ramped : report.missed).push(sel);
}

for (const sel of DELETE_OPACITY) {
  const ok = editRule(sel, (body) => body.replace(/\n?\s*opacity\s*:[^;]+;/g, ''));
  (ok ? report.deleted : report.missed).push(sel);
}

fs.writeFileSync(CSS_PATH, css, 'utf-8');

console.log(`converted to a text token : ${report.converted.length}`);
console.log(`interaction ramps rebuilt : ${report.ramped.length}`);
console.log(`dead opacity:1 deleted    : ${report.deleted.length}`);
if (report.missed.length) {
  console.log(`\nNOT MATCHED (${report.missed.length}) -- handle by hand:`);
  for (const s of report.missed) console.log('  ' + s);
}

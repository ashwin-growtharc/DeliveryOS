/**
 * Generates each component folder's `preview-css.ts`.
 *
 * Why this exists: DeliveryOS's preview compiler runs Tailwind **v3** against a
 * component's raw source (compile.ts -> generateTailwindCss). Suna is Tailwind
 * **v4**, and every one of its semantic utilities (`bg-popover`,
 * `text-kortix-green`, `shadow-md`, `text-sm`, ...) is defined by the `@theme`
 * blocks in globals.css, which that v3 pass knows nothing about -- so the
 * classes would compile to nothing and the preview would render unstyled.
 *
 * So we run the REAL Tailwind v4 here, against the REAL extracted token file,
 * scanning each component's own real source, and inline the resulting CSS into
 * the preview. The styling a viewer sees is therefore genuinely Suna's, not an
 * approximation of it.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const KIT = process.argv[2];
const WORK = process.argv[3];
// Invoke the CLI's real ESM entry with node rather than the `.bin` shim --
// on Windows the extensionless shim is a shell script execFileSync can't spawn.
const TW = path.join(WORK, 'node_modules', '@tailwindcss', 'cli', 'dist', 'index.mjs');

const tokens = path.join(KIT, 'tokens', 'kortix-tokens.css');
const componentCss = path.join(KIT, 'tokens', 'kortix-component-css.css');
const componentsDir = path.join(KIT, 'components');

const posix = (p) => p.replace(/\\/g, '/');

/**
 * Strips cascade layers, unwrapping each `@layer name { ... }` block in place
 * and dropping bare `@layer a, b;` statements.
 *
 * This is not cosmetic. The preview sandbox injects Tailwind's preflight into
 * <head> UNLAYERED, and preflight contains `button { background-color:
 * transparent; color: inherit }`. An unlayered rule beats a layered one no
 * matter the specificity, so every `.bg-*`/`.text-*` utility sitting inside
 * `@layer utilities` lost to it -- buttons rendered as bare text with correct
 * size, padding and borders but no fill and no text colour. Observed, then
 * confirmed in the DOM: the rule was present and valid, just outranked.
 * Flattening puts these rules in the same (unlayered) tier as preflight, where
 * `.bg-foreground` (0-1-0) correctly beats `button` (0-0-1).
 */
function unlayer(css) {
  let out = '';
  for (let i = 0; i < css.length; ) {
    const at = css.indexOf('@layer', i);
    if (at === -1) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, at);
    const brace = css.indexOf('{', at);
    const semi = css.indexOf(';', at);
    // `@layer a, b, c;` -- a statement, no block. Drop it entirely.
    if (semi !== -1 && (brace === -1 || semi < brace)) {
      i = semi + 1;
      continue;
    }
    // `@layer name { ... }` -- find its matching close brace and keep only the body.
    let depth = 0;
    let end = brace;
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}' && --depth === 0) break;
    }
    out += unlayer(css.slice(brace + 1, end));
    i = end + 1;
  }
  return out;
}

// Optional argv[4]: comma-separated component names. Parallel authors pass
// their own batch so one agent's half-written folder can't fail another's run.
const only = process.argv[4] ? new Set(process.argv[4].split(',').map((s) => s.trim())) : null;

const dirs = fs
  .readdirSync(componentsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((n) => !only || only.has(n))
  .sort();

let failures = 0;
for (const name of dirs) {
  const dir = path.join(componentsDir, name);
  const sources = fs
    .readdirSync(dir)
    .filter((f) => (f.endsWith('.tsx') || f.endsWith('.ts')) && f !== 'preview-css.ts');
  if (sources.length === 0) continue;

  // Tailwind v4's CLI has NO `--content` flag (v3 did; v4 silently ignores it,
  // which quietly produced CSS containing none of the component's classes).
  // Sources are declared in CSS only. `source(none)` switches off v4's
  // automatic directory detection so these `@source` lines are the whole list
  // -- and so `preview-css.ts`, which holds the PREVIOUS run's output, is never
  // itself scanned back in.
  const entry = path.join(WORK, `_entry-${name}.css`);
  fs.writeFileSync(
    entry,
    `@import 'tailwindcss' source(none);\n` +
      `@import '${posix(tokens)}';\n` +
      `@import '${posix(componentCss)}';\n` +
      sources.map((f) => `@source '${posix(path.join(dir, f))}';\n`).join(''),
  );

  const out = path.join(WORK, `_${name}.css`);
  try {
    execFileSync(process.execPath, [TW, '-i', entry, '-o', out, '--optimize'], { stdio: 'pipe' });
  } catch (err) {
    console.error(`FAIL ${name}: ${err.stderr?.toString() ?? err.message}`);
    failures++;
    continue;
  }

  const css = unlayer(fs.readFileSync(out, 'utf-8'));
  // Backticks/`${` would break the template literal we emit; neither appears in
  // Tailwind's own output, but escape defensively rather than assume.
  const safe = css.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  fs.writeFileSync(
    path.join(dir, 'preview-css.ts'),
    `/* AUTO-GENERATED by scripts/gen-preview-css.mjs -- do not edit by hand.\n` +
      ` * Real Tailwind v4 output for ${name}'s own classes, compiled against\n` +
      ` * tokens/kortix-tokens.css. Inlined because the preview sandbox runs\n` +
      ` * Tailwind v3 and cannot resolve Suna's v4 @theme tokens. */\n` +
      `export const PREVIEW_CSS = \`${safe}\`;\n`,
  );
  console.log(`ok   ${name}  (${(css.length / 1024).toFixed(1)} KB)`);
}

if (failures > 0) {
  console.error(`\n${failures} component(s) failed to generate CSS.`);
  process.exit(1);
}
console.log(`\nGenerated CSS for ${dirs.length} component(s).`);

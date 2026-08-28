/**
 * Authoritative per-variant render check.
 *
 * `verify-preview.mjs` only proves the bundle COMPILED. It cannot catch a
 * preview that renders blank, because the preview harness calls each variant
 * function directly rather than rendering it as a component
 * (compile.ts -> selectVariant: `element = variantFn()`), so a hook at a
 * variant's top level throws "Invalid hook call", gets posted to
 * `window.parent` as an error, and — with no parent frame — is swallowed
 * silently. The page just stays empty and compile still reports success.
 *
 * So: load each compiled preview inside a real iframe, act as the parent the
 * harness expects, drive `selectVariant` for EVERY exported variant, and assert
 * each one actually put content on the page. Errors the harness posts back are
 * captured instead of lost.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const DOS = 'C:/Users/AshwinB/AppData/Roaming/npm/node_modules/deliveryos';
const { compileLocalPreview } = await import(
  pathToFileURL(DOS + '/dist/engine/preview/resolveArtifactPreview.js').href
);
const { listVariantNames } = await import(
  pathToFileURL(DOS + '/dist/engine/preview/compile.js').href
);
const { chromium } = createRequire(import.meta.url)(DOS + '/node_modules/playwright-core');

const KIT = process.argv[2];
const WORK = path.join(KIT, '..', '_rendercheck');
const only = process.argv[3] ? new Set(process.argv[3].split(',').map((s) => s.trim())) : null;
fs.mkdirSync(WORK, { recursive: true });

const componentsDir = path.join(KIT, 'components');
const names = fs
  .readdirSync(componentsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .filter((n) => !only || only.has(n))
  .sort();

// A preview counts as rendered if it produced real elements AND real painted
// geometry. Text alone is the wrong test: Skeleton, Loading, ProgressRing,
// KortixLogo and Separator are all legitimately text-free, and an early version
// of this script failed all three Skeleton variants for it despite 18-31 real
// elements on screen. Height is what actually distinguishes "drew placeholder
// blocks" from "drew nothing".
const MIN_ELEMENTS = 3;
const MIN_HEIGHT_PX = 8;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const problems = [];

for (const name of names) {
  const dir = path.join(componentsDir, name);
  let html;
  try {
    html = (await compileLocalPreview(dir)).html;
  } catch (e) {
    problems.push(`${name}: COMPILE FAILED — ${e.message.split('\n')[0]}`);
    console.log(`FAIL ${name}: compile — ${e.message.split('\n')[0]}`);
    continue;
  }
  const inner = path.join(WORK, `${name}.html`);
  fs.writeFileSync(inner, html);

  // The harness ignores postMessage unless it comes from window.parent, so the
  // preview has to be framed for selectVariant to be reachable at all.
  const wrapper = path.join(WORK, `${name}.wrap.html`);
  fs.writeFileSync(
    wrapper,
    `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0}iframe{width:1000px;height:900px;border:0}</style>
<iframe id="f" src="./${name}.html"></iframe>
<script>
  window.__msgs = [];
  window.addEventListener('message', (e) => { window.__msgs.push(e.data); });
  window.__pick = (v) => document.getElementById('f').contentWindow.postMessage({ type: 'selectVariant', variant: v }, '*');
</script>`,
  );

  const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  const consoleErrs = [];
  page.on('pageerror', (e) => consoleErrs.push(e.message));
  await page.goto(pathToFileURL(wrapper).href, { waitUntil: 'load' });
  await page.waitForTimeout(700);

  const variants = listVariantNames(path.join(dir, 'preview.tsx'));
  const results = [];
  for (const v of variants) {
    await page.evaluate((name) => window.__pick(name), v);
    await page.waitForTimeout(450);
    const probe = await page.frames()[1].evaluate(() => {
      const root = document.getElementById('root');
      return {
        text: (root?.innerText ?? '').replace(/\s+/g, ' ').trim(),
        els: root ? root.querySelectorAll('*').length : 0,
        h: root ? Math.round(root.getBoundingClientRect().height) : 0,
      };
    });
    const harnessErrs = await page.evaluate(
      () => window.__msgs.filter((m) => m && m.type === 'error').map((m) => `${m.variant ?? '?'}: ${m.message}`),
    );
    const blank = probe.els < MIN_ELEMENTS || probe.h < MIN_HEIGHT_PX;
    results.push({ v, ...probe, blank, harnessErrs });
  }

  const bad = results.filter((r) => r.blank);
  const errs = [...new Set(results.flatMap((r) => r.harnessErrs))];
  if (bad.length || errs.length) {
    for (const r of bad) problems.push(`${name}.${r.v}: BLANK (els=${r.els}, height=${r.h}px)`);
    for (const e of errs) problems.push(`${name}: harness error — ${e}`);
    console.log(`FAIL ${name}`);
    for (const r of bad) console.log(`     BLANK ${r.v} (els=${r.els}, h=${r.h}px)`);
    for (const e of errs) console.log(`     ERR   ${e}`);
  } else {
    console.log(
      `ok   ${name}  ` +
        results.map((r) => `${r.v}(${r.els}els/${r.h}px)`).join(' '),
    );
  }
  await page.close();
}

await browser.close();
console.log(
  problems.length
    ? `\n${problems.length} problem(s):\n` + problems.map((p) => '  - ' + p).join('\n')
    : `\nAll ${names.length} component(s) rendered real content for every variant.`,
);
process.exit(problems.length ? 1 : 0);

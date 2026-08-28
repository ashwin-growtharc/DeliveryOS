/** Compiles each component folder through DeliveryOS's REAL preview pipeline
 *  (the same compileLocalPreview the Detail view calls) and reports pass/fail. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DOS = 'C:/Users/AshwinB/AppData/Roaming/npm/node_modules/deliveryos/dist/engine/preview/resolveArtifactPreview.js';
const { compileLocalPreview } = await import(pathToFileURL(DOS).href);
const { listVariantNames } = await import(
  pathToFileURL('C:/Users/AshwinB/AppData/Roaming/npm/node_modules/deliveryos/dist/engine/preview/compile.js').href
);

const componentsDir = path.join(process.argv[2], 'components');
const only = process.argv[3] ? new Set(process.argv[3].split(',').map((s) => s.trim())) : null;
const dirs = fs.readdirSync(componentsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name)
  .filter((n) => !only || only.has(n)).sort();

let bad = 0;
for (const name of dirs) {
  const dir = path.join(componentsDir, name);
  try {
    const res = await compileLocalPreview(dir);
    const variants = listVariantNames(path.join(dir, 'preview.tsx'));
    const html = res.html ?? '';
    const err = /Preview unavailable/i.test(html);
    if (err) {
      const m = html.match(/Preview unavailable[^<]*/i);
      console.log(`FAIL ${name}: ${m?.[0]}`);
      bad++;
    } else {
      console.log(`ok   ${name}  variants=[${variants.join(', ')}]  html=${(html.length / 1024).toFixed(0)}KB`);
    }
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message.split('\n')[0]}`);
    bad++;
  }
}
console.log(bad ? `\n${bad} failed` : `\nAll ${dirs.length} compiled clean.`);
process.exit(bad ? 1 : 0);

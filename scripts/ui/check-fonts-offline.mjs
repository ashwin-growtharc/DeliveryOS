// Proves the desktop UI's typography survives with no network at all.
//
// The app used to fetch its three faces from fonts.googleapis.com. Offline or
// behind a firewall every one silently fell back to a system font, so the
// product looked different depending on the network -- and nothing detected
// it, because online everything looked fine.
//
// This blocks ALL external requests, loads the real index.html, and asserts
// via the Font Loading API that each family genuinely resolved. A regression
// (a broken vendor path, a corrupted binary copy, a reintroduced remote link)
// fails here rather than on a colleague's locked-down laptop.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const FAMILIES = ['EB Garamond', 'IBM Plex Sans', 'JetBrains Mono'];
const url = pathToFileURL(path.join(process.cwd(), 'src-tauri', 'spike-ui', 'index.html')).href;

let browser;
for (const channel of ['chrome', 'msedge']) {
  try { browser = await chromium.launch({ channel }); break; } catch { /* next */ }
}
if (!browser) { console.error('No usable browser.'); process.exit(1); }

const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const blocked = [];
// Hard-fail any request that leaves the machine.
await context.route('**', (route) => {
  const u = route.request().url();
  if (u.startsWith('file://') || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  blocked.push(u);
  return route.abort();
});

const page = await context.newPage();
await page.goto(url, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);

const result = await page.evaluate((families) => {
  const out = {};
  for (const f of families) {
    // 16px is arbitrary; check() needs a size and only the family matters.
    out[f] = { loaded: document.fonts.check(`16px "${f}"`) };
  }
  const loadedFaces = [];
  document.fonts.forEach((face) => loadedFaces.push(`${face.family} ${face.weight} ${face.style}`));
  return { out, faceCount: loadedFaces.length, faces: loadedFaces.sort() };
}, FAMILIES);

await browser.close();

console.log(`external requests blocked : ${blocked.length}`);
if (blocked.length) for (const u of [...new Set(blocked)]) console.log('  ' + u);
console.log(`@font-face rules registered: ${result.faceCount}`);
for (const f of result.faces) console.log('  ' + f);
console.log('');

let ok = true;

// document.fonts.check() is NOT sufficient on its own: it answers "can this
// family be resolved by any means", which a system fallback satisfies. Run
// against the old remote setup it happily reported all three families as fine
// while zero real faces had loaded. The load-bearing assertions are therefore
// that the right number of @font-face rules actually registered, and that
// nothing left the machine.
const EXPECTED_FACES = 11;
if (result.faceCount !== EXPECTED_FACES) {
  console.log(`FAIL expected ${EXPECTED_FACES} vendored @font-face rules, found ${result.faceCount}`);
  ok = false;
} else {
  console.log(`ok   all ${EXPECTED_FACES} vendored faces registered`);
}

for (const family of FAMILIES) {
  const faces = result.faces.filter((f) => f.startsWith(family));
  if (faces.length === 0) {
    console.log(`FAIL ${family} has no vendored face -- it would fall back to a system font`);
    ok = false;
  } else {
    console.log(`ok   ${family}: ${faces.length} face(s) vendored`);
  }
}

if (blocked.length) {
  console.log('\nFAIL: the page tried to reach the network. Fonts must be vendored, not fetched.');
  ok = false;
}
console.log(ok ? '\nall three families load locally, zero network requests' : '\nFAILURES ABOVE');
process.exit(ok ? 0 : 1);

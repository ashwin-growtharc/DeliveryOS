/**
 * Screenshots the real walkthrough page, both themes, plus one PNG per step so
 * individual moments can be dropped into a deck.
 */
import { createRequire } from 'module';
import { mkdirSync } from 'fs';

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Repo-relative, so this runs from anywhere and on anyone's machine.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const WORK = resolve(REPO, 'docs', 'walkthrough');


const require = createRequire(REPO + '/package.json');


const { chromium } = require('playwright-core');

const OUT = WORK;
mkdirSync(OUT, { recursive: true });

let browser;
for (const channel of ['msedge', 'chrome']) {
  try { browser = await chromium.launch({ channel }); break; } catch { /* next */ }
}
if (!browser) throw new Error('no browser (tried msedge, chrome)');

const url = `file:///${REPO}/docs/mcp-walkthrough.html`;
const shots = [];

// Light only: the per-step images are for slides, and a deck is light.
for (const theme of ['light']) {
  const page = await browser.newPage({
    viewport: { width: 1180, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme,
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);

  // No full-page capture. It came to 1.4 MB per theme at 2x, and the HTML file
  // is 18 KB, interactive, and follows the reader's own theme -- so the PNG was
  // a worse copy of a thing already in the repo. The per-step images below are
  // the ones that go in a deck.
  if (theme === 'light') {
    // One image per step, for slides.
    const count = await page.evaluate(() => document.querySelectorAll('.step').length);
    for (let i = 0; i < count; i += 1) {
      const el = page.locator('.step').nth(i);
      const p = `${OUT}/step-${i + 1}.png`;
      await el.screenshot({ path: p });
      shots.push(p);
    }
    // And the header, which carries the headline numbers.
    await page.locator('.meta').screenshot({ path: `${OUT}/summary.png` });
    shots.push(`${OUT}/summary.png`);
  }

  await page.close();
}

await browser.close();
console.log(`captured ${shots.length} images`);
for (const s of shots) console.log('  ' + s.replace(REPO + '/', ''));

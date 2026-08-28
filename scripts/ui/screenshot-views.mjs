// Captures every view of the desktop UI, in both themes, at two widths.
//
// The app has eleven views and had zero responsive breakpoints, against a
// window minWidth of 860px — so 860 is both the narrowest the shell can get
// and a width nothing had ever been looked at. Capturing both widths in both
// themes is what makes "the UI is inconsistent" checkable rather than a
// matter of opinion.
//
// Renders index.html directly in a real browser rather than through Tauri.
// window.__TAURI__ is absent there, so the JS-driven content of each view
// does not populate — this captures the shell, layout, typography and colour,
// which is exactly what the token work changes. Interaction still has to be
// checked in `npx tauri dev`.
//
// Run: node scripts/ui/screenshot-views.mjs [--out <dir>]

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const VIEWS = [
  'browse', 'tags', 'ui-components', 'starter-kits', 'backend-plugins',
  'tag-folder', 'scan', 'detail', 'component-detail', 'addnew', 'settings',
];
const WIDTHS = [1200, 860];
const THEMES = ['light', 'dark'];

const outIdx = process.argv.indexOf('--out');
const OUT_DIR = path.resolve(outIdx > -1 ? process.argv[outIdx + 1] : 'screenshots');
const PAGE_URL = pathToFileURL(path.join(process.cwd(), 'src-tauri', 'spike-ui', 'index.html')).href;

fs.mkdirSync(OUT_DIR, { recursive: true });

let browser;
for (const channel of ['chrome', 'msedge']) {
  try { browser = await chromium.launch({ channel }); break; } catch { /* try next */ }
}
if (!browser) {
  console.error('No usable browser (tried chrome, msedge). Install Chrome or Edge.');
  process.exit(1);
}

let captured = 0;
for (const theme of THEMES) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await page.goto(PAGE_URL, { waitUntil: 'load' });
    // The app's own theme mechanism, driven the way a user drives it.
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);

    for (const view of VIEWS) {
      // Show exactly one view, the same way showView() does.
      await page.evaluate((v) => {
        for (const section of document.querySelectorAll('.view')) {
          section.hidden = section.id !== `view-${v}`;
        }
        for (const btn of document.querySelectorAll('.sidebar-item')) {
          btn.classList.toggle('active', btn.dataset.view === v);
        }
        window.scrollTo(0, 0);
      }, view);
      const file = path.join(OUT_DIR, `${view}-${theme}-${width}.png`);
      await page.screenshot({ path: file, fullPage: false });
      captured += 1;
    }
    await context.close();
  }
}

await browser.close();
console.log(`captured ${captured} screenshots -> ${OUT_DIR}`);

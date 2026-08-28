import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
let b; for (const c of ['chrome','msedge']) { try { b = await chromium.launch({channel:c}); break; } catch {} }
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = [];
p.on('pageerror', e => errs.push(String(e)));
p.on('console', m => { if (m.type()==='error') errs.push('console: '+m.text()); });

await p.addInitScript(() => {
  const w = window;
  const listeners = {};
  w.__listeners = listeners;
  w.__TAURI__ = {
    core: { invoke: async () => undefined },
    dialog: { open: async () => null, confirm: async () => true },
    opener: { revealItemInDir: async () => undefined, openUrl: async () => undefined },
    event: { listen: async (n, cb) => { (listeners[n] ??= []).push(cb); return () => {}; } },
    updater: { check: async () => null },
    process: { relaunch: async () => undefined },
  };
  w.__calls = [];
  w.DeliveryOS = { call: async (command) => {
    w.__calls.push(command);
    if (command === 'catalog.list' || command === 'catalog.refresh') return w.__catalog;
    if (command === 'remote.list') return [{ name: 'test-remote', url: 'x' }];
    return null;
  } };
  w.__catalog = [];
});
await p.goto(pathToFileURL(path.join(process.cwd(),'src-tauri','spike-ui','index.html')).href, { waitUntil:'load' });
await p.evaluate(() => localStorage.setItem('deliveryos.projectDir', 'C:/fake/project'));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(1200);
const info = await p.evaluate(() => ({
  calls: window.__calls,
  cards: document.querySelectorAll('.res-card').length,
  gridHTML: (document.getElementById('card-grid')||{}).innerHTML?.slice(0,120),
  browseHidden: document.getElementById('view-browse')?.hidden,
  noFolderHidden: document.getElementById('browse-no-folder')?.hidden,
}));
console.log(JSON.stringify(info, null, 2));
console.log('errors:', errs.slice(0,4));
await b.close();

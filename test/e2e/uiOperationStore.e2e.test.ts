import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { chromium, Browser, Page } from 'playwright-core';

// The first real test of the desktop frontend.
//
// `src-tauri/spike-ui/app.js` has never had automated coverage — ESLint does
// not even scan it. This exists because of a bug that no amount of reading
// would reliably catch and that a user hit immediately: "if I go back while
// pulling, things are broken".
//
// Four separate failures were behind that one sentence, all caused by the
// progress panel treating the DOM as the source of truth while
// `resetProgressPanel()` ran on every view switch:
//
//   1. The `sidecar-progress` listener was torn down, so a still-running
//      pull's remaining events were dropped.
//   2. Nothing anywhere showed that an operation was still running.
//   3. Returning to the artifact showed an empty panel — the log had only
//      ever existed in the DOM that was just cleared.
//   4. The operation's completion wrote "Done" into whatever panel happened
//      to be on screen, so a background pull could stamp an unrelated
//      artifact.
//
// The app talks to Rust through `window.__TAURI__` and `window.DeliveryOS`,
// so the harness below installs a fake of both BEFORE app.js runs. That means
// the REAL app.js executes — real init, real event wiring, real render
// functions — driven against a scripted engine. `emitProgress` reaches into
// the same listener app.js registered, so progress arrives exactly as it does
// in production.

const UI_DIR = path.join(__dirname, '..', '..', 'src-tauri', 'spike-ui');
const PAGE_URL = pathToFileURL(path.join(UI_DIR, 'index.html')).href;

/** Two artifacts, so "a background operation stamps the artifact you
 *  navigated to" is actually reproducible. */
const CATALOG = [
  {
    manifest: {
      id: 'alpha-plugin', kind: 'backend-plugin', version: '1.0.0', owner: 'team-x',
      description: 'First test artifact', source_repo: 'https://example.invalid/r',
      install_target: 'alpha', review_required: false,
      tags: { roles: [], teams: [], stacks: [], componentTypes: [] },
      install_params: [], wiring_actions: [],
    },
    remoteName: 'test-remote', localStatus: 'not_pulled', installTarget: null,
  },
  {
    manifest: {
      id: 'beta-plugin', kind: 'backend-plugin', version: '1.0.0', owner: 'team-x',
      description: 'Second test artifact', source_repo: 'https://example.invalid/r',
      install_target: 'beta', review_required: false,
      tags: { roles: [], teams: [], stacks: [], componentTypes: [] },
      install_params: [], wiring_actions: [],
    },
    remoteName: 'test-remote', localStatus: 'not_pulled', installTarget: null,
  },
];

let browser: Browser;
let page: Page;

async function bootApp(): Promise<void> {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.addInitScript((catalog) => {
    const w = window as unknown as Record<string, unknown>;

    // Listeners app.js registers, keyed by event name, so the test can emit.
    const listeners: Record<string, Array<(e: unknown) => void>> = {};
    (w as { __listeners: unknown }).__listeners = listeners;

    // A promise the test resolves, so a "pull" can be held open mid-flight —
    // which is the whole point: the bug only exists while something is
    // genuinely still running.
    (w as { __pending: unknown }).__pending = {};

    // Stub at the REAL seam: `invoke('sidecar_call', ...)`. Stubbing
    // `window.DeliveryOS.call` does not work -- sidecar.js runs after this
    // init script and overwrites it with its own implementation, which then
    // calls straight through to a Tauri host that isn't there.
    const engine = async (command: string) => {
      if (command === 'catalog.list' || command === 'catalog.refresh') return catalog;
      if (command === 'remote.list') return [{ name: 'test-remote', url: 'https://example.invalid/r' }];
      if (command === 'artifact.pull' || command === 'artifact.pullAndAutoWire') {
        // Never settles on its own; the test decides when a pull finishes,
        // because the bug only exists while something is genuinely running.
        // A LIST of resolvers, not one: a bulk pull runs several sequentially,
        // and resolving only the first leaves the batch hanging forever.
        return new Promise((resolve) => {
          const pending = w as { __pending: { resolvers?: Array<() => void> } };
          (pending.__pending.resolvers ??= []).push(() =>
            resolve({ id: 'alpha-plugin', installTarget: 'alpha', wiredFiles: [] }));
        });
      }
      return null;
    };

    w.__TAURI__ = {
      core: {
        invoke: async (cmd: string, args: { command?: string }) =>
          (cmd === 'sidecar_call' ? engine(args?.command ?? '') : undefined),
      },
      dialog: { open: async () => null, confirm: async () => true },
      opener: { revealItemInDir: async () => undefined, openUrl: async () => undefined },
      event: {
        listen: async (name: string, cb: (e: unknown) => void) => {
          (listeners[name] ??= []).push(cb);
          return () => {
            listeners[name] = (listeners[name] ?? []).filter((f) => f !== cb);
          };
        },
      },
      updater: { check: async () => null },
      process: { relaunch: async () => undefined },
    };

  }, CATALOG);

  await page.goto(PAGE_URL, { waitUntil: 'load' });
  // A project folder is required before the catalog renders.
  await page.evaluate(() => localStorage.setItem('deliveryos.projectDir', 'C:/fake/project'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('.res-card').length > 0, { timeout: 15_000 });
}

/** Emits a progress event exactly as the Rust side does. */
async function emitProgress(stage: string, message: string): Promise<void> {
  await page.evaluate(
    ({ stage: s, message: m }) => {
      const w = window as unknown as { __listeners: Record<string, Array<(e: unknown) => void>> };
      for (const cb of w.__listeners['sidecar-progress'] ?? []) {
        cb({ payload: { stage: s, message: m } });
      }
    },
    { stage, message },
  );
}

/** Settles every pull the app is currently waiting on, repeatedly, since a
 *  bulk pull issues the next one only after the previous resolves. */
async function resolveAllPulls(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    const drained = await page.evaluate(() => {
      const w = window as unknown as { __pending: { resolvers?: Array<() => void> } };
      const list = w.__pending.resolvers ?? [];
      w.__pending.resolvers = [];
      for (const r of list) r();
      return list.length;
    });
    if (drained === 0 && i > 0) return;
    await page.waitForTimeout(120);
  }
}

const progressLines = () =>
  page.$$eval('#progress-log .progress-line', (els) => els.map((e) => e.textContent ?? ''));

describe('desktop UI: an operation survives navigating away', () => {
  beforeAll(async () => {
    for (const channel of ['chrome', 'msedge']) {
      try {
        browser = await chromium.launch({ channel });
        break;
      } catch { /* try the next channel */ }
    }
    if (!browser) throw new Error('No usable browser (tried chrome, msedge).');
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
  });

  // Regression for a bug in the FIRST version of the operation store, found by
  // review rather than by use. `#detail-progress` is a page-level panel
  // (index.html:940, outside every `.view`), deliberately shared by Browse's
  // card buttons, Tag Folder rows and bulk pulls. Gating its DOM writes on
  // `state.view === 'detail'` therefore killed every operation NOT started
  // from Detail: the panel appeared, then refused its own progress lines and
  // its own "Done", and sat frozen on "Working…" with an empty log forever.
  it('drives the panel for a bulk pull, which never opens Detail at all', async () => {
    await bootApp();

    await page.click('#browse-pull-all-btn');
    await page.waitForSelector('#detail-progress:not([hidden])');

    await emitProgress('fetch', 'Fetching remote...');
    await emitProgress('copy', 'Copying payload...');

    // The lines must actually land -- this is what the first version dropped.
    expect(await progressLines()).toHaveLength(2);

    await resolveAllPulls();

    // And it must reach a terminal state rather than sitting on "Working…".
    await expect
      .poll(() => page.textContent('#progress-status'), { timeout: 8_000 })
      .not.toBe('Working…');

    // With nothing running, the indicator clears. It used to strand here,
    // because a bulk pull's endProgress could not find its own record.
    await expect
      .poll(() => page.isVisible('#running-indicator'), { timeout: 8_000 })
      .toBe(false);
  }, 120_000);

  it('keeps the log, shows an indicator, and does not stamp the wrong artifact', async () => {
    await bootApp();

    // Open the first artifact and start a pull that will stay in flight.
    await page.click('.res-card:has-text("alpha-plugin")');
    await page.waitForSelector('#view-detail:not([hidden])');
    await page.click('#detail-action-btn');

    await emitProgress('fetch', 'Fetching remote...');
    await emitProgress('copy', 'Copying payload...');
    expect(await progressLines()).toHaveLength(2);

    // (3) Navigate away and back: the log must survive. It used to be wiped,
    // because it only ever lived in the DOM.
    await page.click('#back-to-browse-btn');
    await page.waitForSelector('#view-browse:not([hidden])');

    // (2) An operation still running must be visible from anywhere.
    await expect
      .poll(() => page.isVisible('#running-indicator'), { timeout: 5_000 })
      .toBe(true);

    // (1) Events emitted while away must still be recorded.
    await emitProgress('wire', 'Wiring files...');

    await page.click('.res-card:has-text("alpha-plugin")');
    await page.waitForSelector('#view-detail:not([hidden])');
    const replayed = await progressLines();
    expect(replayed).toHaveLength(3);
    expect(replayed.join(' ')).toContain('Wiring files...');

    // (4) Finish the pull while a DIFFERENT artifact is on screen. Its
    // completion must not mark that artifact's panel.
    await page.click('#back-to-browse-btn');
    await page.click('.res-card:has-text("beta-plugin")');
    await page.waitForSelector('#view-detail:not([hidden])');
    const betaPanelHiddenBefore = await page.isHidden('#detail-progress');

    await resolveAllPulls();
    await page.waitForTimeout(500);

    // beta's panel is untouched: still hidden, and never marked done.
    expect(betaPanelHiddenBefore).toBe(true);
    expect(await page.isHidden('#detail-progress')).toBe(true);

    // And with nothing running, the indicator goes away again.
    await expect
      .poll(() => page.isVisible('#running-indicator'), { timeout: 5_000 })
      .toBe(false);
  }, 120_000);
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import { chromium, Browser, Page } from 'playwright-core';

/**
 * Real-browser coverage for the desktop UI changes in the multi-user batch.
 *
 * This file exists because `src-tauri/spike-ui/app.js` is the one part of the
 * codebase no tooling reaches: ESLint's only rule-bearing config is scoped to
 * `**\/*.ts` (`--print-config` reports `rules: 0` for app.js), `tsconfig.json`
 * excludes it, and `lint:css` checks design-token bypasses rather than whether
 * rendered text says what it means. Every previous UI change in this work was
 * signed off "review by hand," and one of them shipped a defect anyway -- a
 * `\n\n` in a textContent description that collapsed to spaces.
 *
 * Drives the real index.html with a stubbed engine, the same seam
 * `uiOperationStore.e2e.test.ts` established: `invoke('sidecar_call', ...)`,
 * NOT `window.DeliveryOS.call`, because sidecar.js loads afterwards and would
 * overwrite the latter.
 */

const PAGE_URL = `file://${path
  .resolve(__dirname, '..', '..', 'src-tauri', 'spike-ui', 'index.html')
  .split(path.sep)
  .join('/')}`;

/** One artifact whose ONLY side effect is a shell command -- no install_params,
 * no wiring_actions. Before this batch that combination rendered nothing at all
 * in Detail: the lifecycle explainer had no row for it and the Configuration
 * tab was gated on `hasInstallParams || hasWiringActions`. */
const POST_INSTALL_COMMAND = 'npm install some-real-package@2.1.0';

const CATALOG = [
  {
    manifest: {
      id: 'command-only-artifact',
      kind: 'doc',
      description: 'Runs a command and nothing else',
      owner: 'team-x',
      version: '1.0.0',
      source_repo: 'https://example.invalid/repo',
      install_target: 'command-only',
      review_required: false,
      tags: { roles: [], teams: [], stacks: [], componentTypes: [] },
      install_params: [],
      wiring_actions: [],
      post_install: POST_INSTALL_COMMAND,
    },
    remoteName: 'test-remote',
    localStatus: 'not_pulled',
    installTarget: 'command-only',
  },
];

let browser: Browser;
let page: Page;

async function bootApp(catalogResult: unknown): Promise<void> {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.addInitScript((result) => {
    const w = window as unknown as Record<string, unknown>;
    // Records every RPC the app makes, so a test can assert on the ARGUMENTS --
    // which is the whole point for `force`: it is invisible in the DOM.
    const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
    (w as { __calls: unknown }).__calls = calls;

    const engine = async (command: string, args: Record<string, unknown>) => {
      calls.push({ command, args });
      if (command === 'catalog.list' || command === 'catalog.refresh') return result;
      if (command === 'remote.list') return [{ name: 'test-remote', url: 'https://example.invalid/r' }];
      if (command === 'artifact.pull') {
        return { manifest: { id: 'command-only-artifact' }, installTarget: 'command-only', missingRequiredParams: [] };
      }
      if (command === 'artifact.readInstallParamValues') return { values: {} };
      if (command === 'artifact.resolveWiringActions') return { actions: [] };
      if (command === 'artifact.readWiringMergeLog' || command === 'artifact.readBuildFixLog') return [];
      return null;
    };

    w.__TAURI__ = {
      core: {
        invoke: async (cmd: string, a: { command?: string; args?: Record<string, unknown> }) =>
          (cmd === 'sidecar_call' ? engine(a?.command ?? '', a?.args ?? {}) : undefined),
      },
      dialog: { open: async () => null, confirm: async () => true },
      opener: { revealItemInDir: async () => undefined, openUrl: async () => undefined },
      event: { listen: async () => () => undefined },
      updater: { check: async () => null },
      process: { relaunch: async () => undefined },
    };
  }, catalogResult);

  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.setItem('deliveryos.projectDir', 'C:/fake/project'));
  await page.reload({ waitUntil: 'load' });
}

describe('Detail: what a person can see before pulling', () => {
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

  it(
    'shows the post_install command verbatim, on its own line, for an artifact whose only side effect is a command',
    async () => {
      await bootApp(CATALOG);
      await page.waitForFunction(() => document.querySelectorAll('.res-card').length > 0, { timeout: 20_000 });
      await page.click('.res-card');
      await page.waitForSelector('#detail-lifecycle-explainer', { timeout: 20_000 });

      const text = await page.textContent('#detail-lifecycle-explainer');

      // The command itself, not a paraphrase. "runs a setup command" tells a
      // person nothing they can actually judge.
      expect(text).toContain(POST_INSTALL_COMMAND);

      // And on its own line. `.lifecycle-step-description` is set via
      // textContent, so without `white-space: pre-wrap` both line breaks
      // collapse and the command runs into the surrounding prose -- which is
      // exactly how a reader skims past it. Asserted through the RENDERED
      // layout rather than the string, since the string was always correct.
      const commandStartsItsOwnLine = await page.evaluate((cmd: string) => {
        const el = Array.from(document.querySelectorAll('.lifecycle-step-description'))
          .find((n) => (n.textContent ?? '').includes(cmd));
        if (!el) return null;
        const style = window.getComputedStyle(el);
        return style.whiteSpace === 'pre-wrap' || style.whiteSpace === 'pre-line';
      }, POST_INSTALL_COMMAND);
      expect(commandStartsItsOwnLine).toBe(true);
    },
    120_000,
  );

  it(
    'offers the Configuration tab for a command-only artifact, which used to be hidden entirely',
    async () => {
      await bootApp(CATALOG);
      await page.waitForFunction(() => document.querySelectorAll('.res-card').length > 0, { timeout: 20_000 });
      await page.click('.res-card');
      await page.waitForSelector('#detail-lifecycle-explainer', { timeout: 20_000 });

      // `detailTabState.configuration` was gated on
      // `hasInstallParams || hasWiringActions` before this batch, so an artifact
      // whose only side effect was a shell command got nothing.
      //
      // Asserted on the SECTION rather than a tab button: when only one tab
      // applies -- which is this artifact's case -- the app deliberately skips
      // the tab-row chrome entirely and renders that section directly. What
      // matters to a person is whether they can see it, not which chrome
      // delivered it.
      const configSectionVisible = await page.evaluate(() => {
        const section = document.getElementById('detail-configuration-section');
        return section ? !section.hidden : null;
      });
      expect(configSectionVisible).toBe(true);
    },
    120_000,
  );

  it(
    'tolerates catalog.list returning the old bare-array shape as well as the new { entries, skipped } object',
    async () => {
      // normalizeCatalogResult exists precisely so an engine-side wire change
      // does not break a client that predates it. Both shapes must render.
      await bootApp(CATALOG);
      await page.waitForFunction(() => document.querySelectorAll('.res-card').length > 0, { timeout: 20_000 });
      const fromArray = await page.evaluate(() => document.querySelectorAll('.res-card').length);
      await page.close();

      await bootApp({ entries: CATALOG, skipped: [] });
      await page.waitForFunction(() => document.querySelectorAll('.res-card').length > 0, { timeout: 20_000 });
      const fromObject = await page.evaluate(() => document.querySelectorAll('.res-card').length);

      expect(fromArray).toBe(CATALOG.length);
      expect(fromObject).toBe(CATALOG.length);
    },
    120_000,
  );

  it(
    'names WHICH artifact could not be loaded, not just how many',
    async () => {
      // `reason` alone never identifies one -- parser.ts produces "not valid
      // YAML: ..." with no path or id -- so on a 230-artifact remote the notice
      // was unactionable. The CLI prints the path for exactly this reason.
      await bootApp({
        entries: CATALOG,
        skipped: [{ remoteName: 'test-remote', path: 'artifacts/broken-one/manifest.yaml', reason: 'failed validation: version: Required' }],
      });
      await page.waitForFunction(() => document.querySelectorAll('.res-card').length > 0, { timeout: 20_000 });

      const gridText = await page.textContent('#card-grid');
      expect(gridText).toContain('could not be loaded');
      expect(gridText).toContain('artifacts/broken-one/manifest.yaml');
    },
    120_000,
  );
});

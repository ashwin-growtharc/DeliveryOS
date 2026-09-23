import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import { chromium, Browser, Page } from 'playwright-core';
import { buildDocxBuffer } from '../fixtures/officeZip';

/**
 * The Document tab, in a real browser.
 *
 * Drives the real index.html with a stubbed engine -- the seam
 * `detailDisclosure.e2e.test.ts` established -- and asserts the three things
 * a consultant would notice: the Word document's own text is visible inside
 * the app, the Open/Reveal buttons exist only once there is something on disk
 * to open, and a spreadsheet gets buttons but no frame (Excel is the renderer).
 *
 * The Word frame is a sandboxed srcdoc iframe with the vendored renderer
 * inlined, so what this proves is that the whole chain -- listPayloadFiles,
 * readPayloadBinary, base64 across postMessage, docx-preview inside an opaque
 * origin -- produces the paragraph a person wrote. That is the claim the tab
 * makes, and the one thing no unit test can make.
 */

const PAGE_URL = `file://${path
  .resolve(__dirname, '..', '..', 'src-tauri', 'spike-ui', 'index.html')
  .split(path.sep)
  .join('/')}`;

const DOCX_BASE64 = buildDocxBuffer([['Proposal ', 'template', ' for Contoso']]).toString('base64');

function artifact(id: string, files: string[], localStatus: 'pulled' | 'not_pulled', installTarget: string) {
  return {
    manifest: {
      id,
      kind: 'doc',
      description: 'A template',
      owner: 'team-x',
      version: '1.0.0',
      source_repo: 'https://example.invalid/repo',
      install_target: installTarget,
      review_required: false,
      tags: { roles: [], teams: [], stacks: [], componentTypes: [] },
      install_params: [],
      wiring_actions: [],
    },
    remoteName: 'test-remote',
    localStatus,
    installTarget,
    __files: files,
  };
}

let browser: Browser;
let page: Page;

async function bootApp(catalog: ReturnType<typeof artifact>[], rootIsFile = false): Promise<void> {
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.addInitScript(
    ({ catalog: entries, docx, rootIsFile: single }) => {
      const w = window as unknown as Record<string, unknown>;
      const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
      (w as { __calls: unknown }).__calls = calls;
      const opened: string[] = [];
      (w as { __opened: unknown }).__opened = opened;

      const engine = async (command: string, args: Record<string, unknown>) => {
        calls.push({ command, args });
        if (command === 'catalog.list' || command === 'catalog.refresh') return entries;
        if (command === 'remote.list') return [{ name: 'test-remote', url: 'https://example.invalid/r' }];
        if (command === 'artifact.listPayloadFiles') {
          const entry = entries.find((e) => e.manifest.id === args.id);
          return { files: entry ? entry.__files : [], rootIsFile: single };
        }
        if (command === 'artifact.readPayloadBinary') {
          const name = String(args.path);
          if (/\.docx$/i.test(name)) return { kind: 'bytes', name, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 1, base64: docx };
          return { kind: 'not-found' };
        }
        if (command === 'artifact.readPayloadFile') return { content: undefined };
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
        opener: {
          revealItemInDir: async () => undefined,
          openUrl: async () => undefined,
          openPath: async (p: string) => { opened.push(p); },
        },
        event: { listen: async () => () => undefined },
        updater: { check: async () => null },
        process: { relaunch: async () => undefined },
      };
    },
    { catalog, docx: DOCX_BASE64, rootIsFile },
  );

  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.setItem('deliveryos.projectDir', 'C:/fake/project'));
  await page.reload({ waitUntil: 'load' });
}

async function openFirstDetail(): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('.res-card').length > 0, { timeout: 20_000 });
  await page.click('.res-card');
  await page.waitForSelector('#detail-document-section:not([hidden])', { timeout: 20_000 });
}

describe('Detail: the Document tab', () => {
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

  it('renders the Word document\'s own text inside the app, before the artifact is pulled', async () => {
    await bootApp([artifact('proposal', ['proposal.docx'], 'not_pulled', 'templates/proposal.docx')], true);
    await openFirstDetail();

    // The paragraph a person wrote, joined back across its runs, visible in
    // the sandboxed frame. This is the whole chain working or not working.
    const frame = page.frameLocator('#detail-document-section iframe');
    await expect.poll(async () => frame.locator('body').textContent(), { timeout: 30_000 })
      .toContain('Proposal template for Contoso');

    // Nothing on disk yet, so nothing to open.
    expect(await page.locator('#detail-document-section button', { hasText: 'Open' }).count()).toBe(0);
    expect(await page.textContent('#detail-document-section')).toContain('Pull this artifact');
  }, 120_000);

  it('offers Open and Reveal once pulled, at the path the file actually landed', async () => {
    await bootApp([artifact('proposal', ['proposal.docx'], 'pulled', 'C:\\fake\\project\\templates\\proposal.docx')], true);
    await openFirstDetail();

    await page.locator('#detail-document-section button', { hasText: /^Open$/ }).click();
    const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
    // A single-file payload: install_target IS the file. Getting this wrong
    // opens Explorer on the wrong thing, silently.
    expect(opened).toEqual(['C:\\fake\\project\\templates\\proposal.docx']);
    expect(await page.locator('#detail-document-section button', { hasText: 'Reveal' }).count()).toBe(1);
  }, 120_000);

  it('gives a spreadsheet buttons and no frame -- Excel is the renderer', async () => {
    await bootApp([artifact('calc', ['scoping.xlsx'], 'pulled', 'C:\\fake\\project\\tools')], false);
    await openFirstDetail();

    expect(await page.locator('#detail-document-section iframe').count()).toBe(0);
    expect(await page.textContent('#detail-document-section')).toContain('open in their own programs');
    await page.locator('#detail-document-section button', { hasText: /^Open$/ }).click();
    const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
    // A directory payload: the file sits under install_target, with the
    // target's own separator.
    expect(opened).toEqual(['C:\\fake\\project\\tools\\scoping.xlsx']);
  }, 120_000);

  it('does not show the tab at all for an artifact with no such files', async () => {
    await bootApp([artifact('plain', ['README.md', 'notes.md'], 'not_pulled', 'plain')]);
    await page.waitForFunction(() => document.querySelectorAll('.res-card').length > 0, { timeout: 20_000 });
    await page.click('.res-card');
    await page.waitForSelector('#view-detail:not([hidden])', { timeout: 20_000 });
    // Wait for the tab's own RPC to have been answered -- not for every async
    // tab to settle, since the stubbed engine leaves some of them pending
    // forever -- then give the render a beat and assert the section never
    // appeared and no tab was offered for it.
    await page.waitForFunction(
      () => (window as unknown as { __calls: Array<{ command: string }> }).__calls.some((c) => c.command === 'artifact.listPayloadFiles'),
      { timeout: 20_000 },
    );
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (document.getElementById('detail-document-section') as HTMLElement).hidden)).toBe(true);
    expect(await page.locator('#detail-tabs-row button', { hasText: 'Document' }).count()).toBe(0);
  }, 120_000);
});

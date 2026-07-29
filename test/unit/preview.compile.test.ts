import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { compilePreviewHtml, listVariantNames } from '../../src/engine/preview/compile';

const fixtureDir = path.join(__dirname, '..', 'fixtures', 'preview-spike', 'Button');
const previewPath = path.join(fixtureDir, 'preview.tsx');

describe('listVariantNames', () => {
  it('returns exported variant names in real source declaration order', () => {
    // The fixture declares Primary, Secondary, Disabled in that order --
    // asserting the exact order, not just membership, is the point: this
    // is what catches esbuild's bundled-namespace-object reordering bug if
    // it ever creeps back in via some other code path.
    expect(listVariantNames(previewPath)).toEqual(['Primary', 'Secondary', 'Disabled']);
  });
});

/**
 * Executes a compiled preview's HTML in a real jsdom document and returns
 * the rendered <button> -- the only reliable way to prove which variant
 * actually rendered. A plain string-match against the compiled bundle
 * CANNOT tell variants apart: the bundle's JS source textually contains
 * every branch (Button.tsx's full source, all three preview variants)
 * regardless of which one actually executes at runtime. Confirmed the hard
 * way during the Phase A spike -- a `toContain('#1E3C53')` /
 * `not.toContain('not-allowed')` pair of assertions passed even when the
 * wrong variant (Disabled) was rendering, because both strings are
 * unconditionally present in Button.tsx's own source, compiled in either
 * way.
 */
async function renderCompiledButton(previewEntryPath: string): Promise<HTMLButtonElement> {
  const { html } = await compilePreviewHtml(previewEntryPath);
  const dom = new JSDOM(html, { runScripts: 'dangerously' });

  // React 19's createRoot schedules its initial render via its own internal
  // task/microtask scheduling rather than rendering purely synchronously
  // within the inline <script> -- polls for the rendered <button> instead
  // of trusting one fixed sleep duration, which would otherwise be a
  // magic-number race liable to flake on a slower/loaded runner.
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const found = dom.window.document.querySelector('button');
    if (found) {
      return found as HTMLButtonElement;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected a <button> to have rendered into #root within 2s');
}

describe('compilePreviewHtml (Phase A spike)', () => {
  it('compiles a real React component + preview.tsx into a self-contained HTML document', async () => {
    const { html } = await compilePreviewHtml(previewPath);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('id="root"');
    // The bundle must be fully self-contained -- React/ReactDOM inlined, not
    // left as an external `require`/`import` the sandboxed iframe could
    // never resolve on its own.
    expect(html).not.toMatch(/require\(["']react/);
    expect(html).not.toMatch(/from\s+["']react/);
  });

  it('renders the FIRST-declared variant (Primary) in the real DOM, not an arbitrary one', async () => {
    const button = await renderCompiledButton(previewPath);

    // Regression guard for the exact bug the Phase A spike's manual visual
    // check caught: relying on Object.keys() order on the bundled namespace
    // silently rendered "Disabled" (alphabetically first) instead of
    // "Primary" (source-order first). `disabled` is the one property that
    // conclusively distinguishes Primary from Disabled (both render the
    // same "Get started" text) -- checked against the REAL rendered
    // element, not the bundle's source text.
    expect(button.textContent).toBe('Get started');
    expect(button.disabled).toBe(false);
  });

  it('inlines the actual component output (not just React/ReactDOM boilerplate)', async () => {
    const { html } = await compilePreviewHtml(previewPath);

    // Button.tsx's own distinguishing content should be present in the
    // bundle -- proves the real component source was actually compiled in,
    // not just a blank harness.
    expect(html).toContain('Get started');
  });

  it('produces a reasonably-sized minified bundle', async () => {
    const { html } = await compilePreviewHtml(previewPath);

    // Minified React + ReactDOM's client runtime inlined should land well
    // under the unminified ~1.1MB the first spike pass produced -- a rough
    // sanity ceiling, not a tight budget; Phase A's real size/latency check
    // happens against the packaged sidecar, not this unit test.
    expect(html.length).toBeLessThan(500_000);
  });
});

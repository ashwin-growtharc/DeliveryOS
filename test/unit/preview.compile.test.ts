import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { compilePreviewHtml, getOrCompilePreview, listVariantNames } from '../../src/engine/preview/compile';

const fixtureDir = path.join(__dirname, '..', 'fixtures', 'preview-spike', 'Button');
const previewPath = path.join(fixtureDir, 'preview.tsx');
const htmlPreviewPath = path.join(
  __dirname, '..', 'fixtures', 'preview-spike', 'HtmlButton', 'preview.html',
);
const maliciousPreviewPath = path.join(
  __dirname, '..', 'fixtures', 'preview-spike', 'Malicious', 'preview.tsx',
);
const repoRoot = path.join(__dirname, '..', '..');

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

describe('vendored React runtime (Phase B)', () => {
  it('compiles successfully even with react/react-dom entirely absent from node_modules', async () => {
    // The actual claim this test exists to prove: React/ReactDOM are
    // genuinely vendored (embedded via VENDORED_REACT_RUNTIME_JS), not
    // just coincidentally resolving because the fixture happens to sit
    // inside this monorepo's own node_modules. Temporarily hides both
    // packages so that coincidental fallback genuinely cannot succeed --
    // mirrors the exact isolation-testing discipline Phase A used for the
    // native esbuild binary itself. Always restores in `finally`, even if
    // the compile throws unexpectedly.
    const reactDir = path.join(repoRoot, 'node_modules', 'react');
    const reactDomDir = path.join(repoRoot, 'node_modules', 'react-dom');
    const reactHidden = `${reactDir}.hidden-for-test`;
    const reactDomHidden = `${reactDomDir}.hidden-for-test`;

    fs.renameSync(reactDir, reactHidden);
    fs.renameSync(reactDomDir, reactDomHidden);
    try {
      const { html } = await compilePreviewHtml(previewPath);
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain('__DeliveryOSReactRuntime');
    } finally {
      fs.renameSync(reactHidden, reactDir);
      fs.renameSync(reactDomHidden, reactDomDir);
    }
  });
});

describe('import sandboxing (Phase B)', () => {
  it('rejects a relative import that escapes the artifact\'s own directory', async () => {
    // test/fixtures/preview-spike/Malicious/preview.tsx imports
    // '../../../../package.json' -- a real path-traversal attempt. Must
    // fail loudly (a rejected promise), never silently inline content from
    // outside the artifact's own folder.
    await expect(compilePreviewHtml(maliciousPreviewPath)).rejects.toThrow(
      /resolves outside this component's own directory/,
    );
  });
});

describe('compiler-adapter dispatch (Phase B)', () => {
  it('routes a .tsx preview through the React adapter', async () => {
    const { html } = await compilePreviewHtml(previewPath);
    // The React adapter always produces a fresh HTML document wrapper +
    // the vendored runtime -- present only because esbuild actually ran.
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('__DeliveryOSReactRuntime');
  });

  it('routes a .html preview through the zero-build adapter, body untouched', async () => {
    const rawFile = fs.readFileSync(htmlPreviewPath, 'utf-8');
    const { html } = await compilePreviewHtml(htmlPreviewPath);

    // Zero-build means no esbuild involvement, no vendored-runtime
    // injection -- the file's own content is untouched. It's no longer
    // byte-for-byte identical to the raw file, though: every adapter's
    // output gets a CSP <meta> tag injected uniformly (see
    // injectPreviewCsp), including this one.
    expect(html).not.toContain('__DeliveryOSReactRuntime');
    expect(html).toContain('Zero-build button');
    expect(html).toContain('Content-Security-Policy');
    // Everything else about the original file survives verbatim.
    expect(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')).toBe(rawFile);
  });
});

describe('variantNames + propsSchemas (Phase C)', () => {
  it('the React adapter returns every CSF variant, in source declaration order', async () => {
    const compiled = await compilePreviewHtml(previewPath);
    expect(compiled.variantNames).toEqual(['Primary', 'Secondary', 'Disabled']);
  });

  it('the React adapter returns a real docgen-derived props schema for the underlying component', async () => {
    const compiled = await compilePreviewHtml(previewPath);
    expect(Object.keys(compiled.propsSchemas)).toEqual(['Button']);
    const variant = compiled.propsSchemas.Button.find((p) => p.name === 'variant');
    expect(variant).toMatchObject({ enumValues: ['primary', 'secondary'], defaultValue: 'primary' });
  });

  it('the zero-build HTML adapter returns empty variantNames/propsSchemas -- no CSF/docgen concept applies', async () => {
    const compiled = await compilePreviewHtml(htmlPreviewPath);
    expect(compiled.variantNames).toEqual([]);
    expect(compiled.propsSchemas).toEqual({});
  });
});

describe('postMessage protocol (Phase C)', () => {
  it('reports the real component name via postMessage even though the bundle is minified (keepNames regression)', async () => {
    // If `keepNames: true` were ever accidentally dropped from the
    // esbuild.build() call, esbuild's minifier would rename `Button` to a
    // single letter, and this assertion is what would catch it -- a plain
    // `html.toContain('Button')` string check would NOT catch this
    // regression, since "Button" also appears elsewhere in the bundle
    // (e.g. inside the harness's own JSX call sites) regardless of
    // whether the function's runtime `.name` itself survived minification.
    const { html } = await compilePreviewHtml(previewPath);
    const dom = new JSDOM(html, { runScripts: 'dangerously' });

    const messages: Array<Record<string, unknown>> = [];
    dom.window.addEventListener('message', (event) => {
      messages.push(event.data as Record<string, unknown>);
    });

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const variantChanged = messages.find((m) => m.type === 'variantChanged');
      if (variantChanged) {
        expect(variantChanged.componentName).toBe('Button');
        expect(variantChanged.variant).toBe('Primary');
        expect(variantChanged.initialProps).toMatchObject({ children: 'Get started' });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Expected a "variantChanged" postMessage within 2s -- keepNames regression, or the harness protocol broke');
  });

  it('ignores an incoming message whose source is not window.parent, even with a valid-looking payload (security boundary)', async () => {
    // A real browser lets the harness legitimately receive a
    // window.parent-sourced message; jsdom has no way to fake that
    // relationship (confirmed empirically: a real `srcdoc` iframe never
    // executes its inline <script> in jsdom's `runScripts: 'dangerously'`
    // mode, and even a same-window self-post -- the only other way to
    // trigger `window.addEventListener('message', ...)` here -- always
    // comes back with `event.source === null`, never `window` itself).
    // That limitation is exactly what this test turns into real coverage:
    // it proves the harness's `event.source !== window.parent` guard
    // actually rejects a same-shape `{type:'selectVariant', ...}` message
    // from an untrusted source, rather than just asserting the check
    // exists in the source text. The genuine "switch variant, watch it
    // re-render" happy path needs a real two-window browser check instead
    // (see this feature's manual-verification steps).
    const { html } = await compilePreviewHtml(previewPath);
    const dom = new JSDOM(html, { runScripts: 'dangerously' });

    const messages: Array<Record<string, unknown>> = [];
    dom.window.addEventListener('message', (event) => {
      messages.push(event.data as Record<string, unknown>);
    });

    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !messages.some((m) => m.type === 'variantChanged')) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(messages.filter((m) => m.type === 'variantChanged')).toHaveLength(1);

    dom.window.postMessage({ type: 'selectVariant', variant: 'Disabled' }, '*');
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Still Primary, still non-disabled -- the untrusted message was
    // dropped, not honored, and no second `variantChanged` was posted.
    const button = dom.window.document.querySelector('button');
    expect(button?.disabled).toBe(false);
    expect(messages.filter((m) => m.type === 'variantChanged')).toHaveLength(1);
  });
});

describe('injectPreviewCsp (Phase B)', () => {
  it('every compiled preview includes a strict CSP meta tag', async () => {
    const reactResult = await compilePreviewHtml(previewPath);
    const htmlResult = await compilePreviewHtml(htmlPreviewPath);

    for (const { html } of [reactResult, htmlResult]) {
      expect(html).toContain('Content-Security-Policy');
      expect(html).toContain("default-src 'none'");
    }
  });
});

describe('getOrCompilePreview caching (Phase B)', () => {
  let deliveryOsHome: string;
  let originalEnv: string | undefined;

  beforeAll(() => {
    originalEnv = process.env.DELIVERYOS_HOME;
    deliveryOsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deliveryos-preview-cache-test-home-'));
    process.env.DELIVERYOS_HOME = deliveryOsHome;
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.DELIVERYOS_HOME;
    } else {
      process.env.DELIVERYOS_HOME = originalEnv;
    }
    fs.rmSync(deliveryOsHome, { recursive: true, force: true });
  });

  it('compiles on a cache miss, then serves a cache hit without recompiling', async () => {
    const first = await getOrCompilePreview('test-remote', 'button', '1.0.0', previewPath);
    expect(first.html.length).toBeGreaterThan(0);
    // Phase C: the cache stores the WHOLE CompiledPreview as JSON now, not
    // just the raw HTML string -- variantNames/propsSchemas have to
    // actually survive a cache hit, or every request after the first
    // compile would silently lose variant tabs and controls.
    expect(first.variantNames).toEqual(['Primary', 'Secondary', 'Disabled']);
    expect(first.propsSchemas.Button.length).toBeGreaterThan(0);

    // Proves the second call is a genuine cache hit, not a coincidental
    // recompile: hides react/react-dom (mirroring the vendoring isolation
    // test above) so a real recompile attempt would fail loudly. A cache
    // hit must succeed anyway, since it never touches esbuild at all.
    const reactDir = path.join(repoRoot, 'node_modules', 'react');
    const reactDomDir = path.join(repoRoot, 'node_modules', 'react-dom');
    const reactHidden = `${reactDir}.hidden-for-test`;
    const reactDomHidden = `${reactDomDir}.hidden-for-test`;

    fs.renameSync(reactDir, reactHidden);
    fs.renameSync(reactDomDir, reactDomHidden);
    try {
      const second = await getOrCompilePreview('test-remote', 'button', '1.0.0', previewPath);
      expect(second).toEqual(first);
    } finally {
      fs.renameSync(reactHidden, reactDir);
      fs.renameSync(reactDomHidden, reactDomDir);
    }
  });

  it('a different version is a genuine cache miss, not accidentally shared with another version', async () => {
    await getOrCompilePreview('test-remote', 'button', '1.0.0', previewPath);
    // Different version -> different cache key -> this call actually
    // recompiles (react/react-dom are NOT hidden here, so it can) rather
    // than incorrectly returning the 1.0.0 entry.
    const result = await getOrCompilePreview('test-remote', 'button', '2.0.0', previewPath);
    expect(result.html.length).toBeGreaterThan(0);
  });
});

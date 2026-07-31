import type { Browser } from 'playwright-core';
import { chromium } from 'playwright-core';
import { compilePreviewHtml } from './compile';

/**
 * Real, system-installed Chromium-family browsers to try, in order --
 * `playwright-core` (deliberately not the full `playwright` package, which
 * downloads its own bundled Chromium at install time; see this module's
 * own doc comment below) launches via a `channel`, which locates an
 * already-installed browser rather than managing one itself.
 *
 * `'msedge'` is tried FIRST, not `'chrome'`: this project is Windows-only
 * today (see scripts/build-sidecar.mjs's own doc comment), and Edge ships
 * with Windows itself -- guaranteed present on any machine this runs on,
 * unlike Chrome, which requires a separate install. Confirmed by hand on
 * the actual dev machine this was built against: `channel: 'chrome'`
 * failed outright (no Chrome install found at any of Chrome's own standard
 * paths), while `channel: 'msedge'` launched immediately. `'chrome'` stays
 * as a fallback for a machine that happens to have Chrome but not Edge
 * (unusual on Windows, but not impossible), and for whenever this project
 * eventually targets Mac/Linux, where Edge is far less likely to be
 * preinstalled.
 */
const HEADLESS_BROWSER_CHANNELS = ['msedge', 'chrome'] as const;

async function launchAvailableBrowser(): Promise<Browser> {
  let lastError: unknown;
  for (const channel of HEADLESS_BROWSER_CHANNELS) {
    try {
      return await chromium.launch({ channel });
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(
    `Could not render a preview image -- no usable browser found (tried channel(s): ${HEADLESS_BROWSER_CHANNELS.join(', ')}). ` +
      `Install Google Chrome or Microsoft Edge to enable preview.png generation. ` +
      `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/**
 * Renders a component's preview (the SAME compiled HTML the live sandboxed
 * iframe uses -- `compilePreviewHtml`, unchanged) to a real PNG screenshot
 * of just the rendered component, for embedding in a PR body/diff (Phase
 * E; docs/ui-components-feature-design.md and PLAN.md's own "Phase E"
 * section). GitHub sanitizes PR bodies/diffs and strips `<iframe>`/
 * `<script>` entirely -- a live, interactive preview can never be
 * embedded there no matter how it's built, so a static image is the only
 * option; see this feature's own design discussion for why that's a hard
 * platform constraint, not a choice made for convenience.
 *
 * Deliberately used for BOTH the GUI (Add New Review / Detail Edit) and
 * CLI push paths, not just CLI -- PLAN.md's own brainstormed note says
 * "GUI path reuses the Tauri webview already rendering Review's live
 * preview," but no such capture mechanism exists in this Tauri app today,
 * and building one would mean new, fragile, Windows-only WebView2-specific
 * Rust code for a benefit (avoiding one extra headless render) that isn't
 * worth that cost. A single Playwright-based path, used everywhere
 * `pushArtifact` needs a `preview.png`, is simpler and guarantees the GUI
 * and CLI produce byte-for-byte the same image for the same source.
 *
 * Renders the FIRST/default CSF variant only (whatever `compilePreviewHtml`
 * itself renders by default) -- matches what a Review-step live preview
 * shows by default too, so the PR image is a faithful "this is what Review
 * showed" snapshot, not a separately-chosen variant.
 *
 * `playwright-core` (not the full `playwright` package) never downloads
 * its own browser binary at `npm install` time -- consistent with this
 * project's established discipline of not bundling heavy runtimes it
 * doesn't have to (see the native esbuild binary / vendored React runtime,
 * both chosen for the same "use what's already there, don't ship a second
 * copy" reason).
 *
 * Screenshots `#root`'s own rendered CHILD, not `#root` itself -- `#root`
 * is a flex container with no explicit width, so it fills its own parent
 * (the default 800px+ viewport) exactly the same "block element defaults
 * to filling its container" issue `injectContentHeightReporter`'s width
 * measurement (`compile.ts`) already had to solve for the live preview;
 * confirmed by hand that screenshotting `#root` itself produces a
 * near-viewport-width image with the real component tiny and centered
 * inside it, while screenshotting the child produces a tight, correctly-
 * cropped image of just the component.
 */
export async function renderPreviewImage(previewEntryPath: string): Promise<Buffer> {
  const { html } = await compilePreviewHtml(previewEntryPath);
  const browser = await launchAvailableBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction(
      () => {
        const root = document.getElementById('root');
        return root !== null && root.children.length > 0;
      },
      { timeout: 10_000 },
    );
    // A brief settle delay for any mount-in transition (a fade/slide-in
    // animation library like framer-motion) to finish before capturing --
    // cheap insurance against a screenshot mid-transition, matching this
    // codebase's existing "don't measure/capture too early" discipline
    // (see injectContentHeightReporter's own (0,0) pre-mount bug fix).
    await page.waitForTimeout(250);

    const childHandle = await page.evaluateHandle(() => {
      const root = document.getElementById('root');
      return root ? root.children[0] : null;
    });
    const element = childHandle.asElement();
    if (!element) {
      throw new Error(`Rendered preview at ${previewEntryPath} has no element to screenshot`);
    }
    return await element.screenshot();
  } finally {
    await browser.close();
  }
}

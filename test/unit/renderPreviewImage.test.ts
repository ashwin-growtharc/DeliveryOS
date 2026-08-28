import { beforeAll, describe, expect, it } from 'vitest';
import * as path from 'path';
import { renderPreviewImage } from '../../src/engine/preview/renderPreviewImage';

const previewPath = path.join(__dirname, '..', 'fixtures', 'preview-spike', 'Button', 'preview.tsx');

describe('renderPreviewImage (Phase E)', () => {
  // Rendered ONCE for the whole file, in a beforeAll with its own generous
  // timeout, rather than once per test at the suite-wide 30s default.
  //
  // This was one of the suite's two long-standing intermittent failures. Each
  // test used to do its own full render -- an esbuild compile plus a real
  // headless browser launch -- and under the parallel load of the full run
  // that reliably blew the 30s cap on a cold browser start, while passing
  // comfortably when the file was run on its own. Nothing about the code
  // under test was flaky; the budget was simply too tight for what the test
  // actually does, twice over.
  //
  // Both assertions below examine different fields of the SAME PNG, so there
  // is no coverage lost in sharing one render -- and it halves the work.
  let buf: Buffer;

  beforeAll(async () => {
    buf = await renderPreviewImage(previewPath);
  }, 180_000);

  it("renders a real PNG screenshot of the compiled preview's default variant", () => {
    // PNG magic bytes -- a real image, not an empty/placeholder buffer.
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(buf.length).toBeGreaterThan(200);
  });

  it('crops to the rendered component itself, not the full viewport', () => {
    // Button.tsx's "Get started" button is nowhere near 1200px wide (the
    // viewport renderPreviewImage renders at) -- reading the PNG's own
    // IHDR width field (bytes 16-19, big-endian) directly proves the
    // screenshot was cropped to #root's actual child, not #root itself
    // (which, as a width-less flex container, would otherwise fill the
    // full viewport width -- confirmed by hand as a real bug during
    // development of this function).
    const width = buf.readUInt32BE(16);
    expect(width).toBeGreaterThan(20);
    expect(width).toBeLessThan(400);
  });
});

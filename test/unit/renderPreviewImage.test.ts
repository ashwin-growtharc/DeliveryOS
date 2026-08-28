import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { renderPreviewImage } from '../../src/engine/preview/renderPreviewImage';

const previewPath = path.join(__dirname, '..', 'fixtures', 'preview-spike', 'Button', 'preview.tsx');

describe('renderPreviewImage (Phase E)', () => {
  it('renders a real PNG screenshot of the compiled preview\'s default variant', async () => {
    const buf = await renderPreviewImage(previewPath);

    // PNG magic bytes -- a real image, not an empty/placeholder buffer.
    expect(buf.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(buf.length).toBeGreaterThan(200);
  });

  it('crops to the rendered component itself, not the full viewport', async () => {
    // Button.tsx's "Get started" button is nowhere near 1200px wide (the
    // viewport renderPreviewImage renders at) -- reading the PNG's own
    // IHDR width field (bytes 16-19, big-endian) directly proves the
    // screenshot was cropped to #root's actual child, not #root itself
    // (which, as a width-less flex container, would otherwise fill the
    // full viewport width -- confirmed by hand as a real bug during
    // development of this function).
    const buf = await renderPreviewImage(previewPath);
    const width = buf.readUInt32BE(16);
    expect(width).toBeGreaterThan(20);
    expect(width).toBeLessThan(400);
  });
});

// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { formatBytes, sizeLimitMessage, isAnimated, importBgImageFromFile } from '../../../src/lib/modules/theme/bgImageStore';

function webpFile(animated: boolean): File {
  const head = new Uint8Array(32);
  // "RIFF"
  head.set([0x52, 0x49, 0x46, 0x46], 0);
  // "WEBP"
  head.set([0x57, 0x45, 0x42, 0x50], 8);
  // "VP8X" extended chunk
  head.set([0x56, 0x50, 0x38, 0x58], 12);
  head[20] = animated ? 0x02 : 0x00; // animation flag bit
  return new File([head], 'bg.webp', { type: 'image/webp' });
}

describe('formatBytes', () => {
  it('formats B / KB / MB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('sizeLimitMessage', () => {
  it('allows files within the cap', () => {
    expect(sizeLimitMessage(5 * 1024 * 1024, false)).toBeNull();
    expect(sizeLimitMessage(5 * 1024 * 1024, true)).toBeNull();
  });
  it('rejects static images over 30MB', () => {
    expect(sizeLimitMessage(31 * 1024 * 1024, false)).toMatch(/30 MB/);
  });
  it('rejects animated images over 10MB (stricter cap)', () => {
    expect(sizeLimitMessage(11 * 1024 * 1024, true)).toMatch(/10 MB/);
    // Same size is fine for a static image.
    expect(sizeLimitMessage(11 * 1024 * 1024, false)).toBeNull();
  });
});

describe('isAnimated', () => {
  it('treats gif / apng as animated by mime type', async () => {
    expect(await isAnimated(new File([new Uint8Array(4)], 'a.gif', { type: 'image/gif' }))).toBe(true);
    expect(await isAnimated(new File([new Uint8Array(4)], 'a.png', { type: 'image/apng' }))).toBe(true);
  });
  it('treats png/jpeg as static', async () => {
    expect(await isAnimated(new File([new Uint8Array(4)], 'a.png', { type: 'image/png' }))).toBe(false);
  });
  it('detects the WebP animation flag', async () => {
    expect(await isAnimated(webpFile(true))).toBe(true);
    expect(await isAnimated(webpFile(false))).toBe(false);
  });
});

describe('importBgImageFromFile', () => {
  it('rejects non-image files before touching storage', async () => {
    const f = new File(['hello'], 'note.txt', { type: 'text/plain' });
    await expect(importBgImageFromFile(f)).rejects.toThrow(/isn't an image/);
  });
});

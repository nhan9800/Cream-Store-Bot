import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { bookingPhotoBytes, importBookingProfilePhoto } from '../src/services/bookingProfilePhoto.js';

const url = 'https://cdn.discordapp.com/attachments/1573607352555405365/1573607355235434537/host.png?ex=signed';
const fixture = { url, size: 500, contentType: 'image/png' };

describe('Cenar Booking host photo import', () => {
  it('accepts a bounded Discord upload and removes source metadata', async () => {
    const image = await sharp({ create: { width: 50, height: 90, channels: 3, background: '#f48a40' } })
      .withMetadata({ orientation: 6 }).png().toBuffer();
    const fetchFile = vi.fn(async () => new Response(image));
    const photo = await importBookingProfilePhoto(fixture, { fetchFile });
    expect(fetchFile).toHaveBeenCalledWith(new URL(url), { redirect: 'error', signal: expect.any(AbortSignal) });
    expect(photo.length).toBeLessThanOrEqual(bookingPhotoBytes);
    const metadata = await sharp(photo).metadata();
    expect(metadata).toMatchObject({ width: 192, height: 192, format: 'webp' });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
  });

  it.each([
    { url: url.replace('cdn.discordapp.com', 'cdn.discordapp.com.invalid') },
    { url: url.replace('https://', 'http://') },
    { url: url.replace('cdn.discordapp.com', 'account@cdn.discordapp.com') },
    { url: url.replace('cdn.discordapp.com', 'cdn.discordapp.com:444') },
    { url: url.replace('/attachments/', '/private/') },
    { size: 3 * 1024 * 1024 + 1 },
    { contentType: 'image/svg+xml' },
  ])('rejects invalid attachment metadata before fetching %j', async overrides => {
    const fetchFile = vi.fn();
    await expect(importBookingProfilePhoto({ ...fixture, ...overrides }, { fetchFile })).rejects.toThrow(/qua Discord/);
    expect(fetchFile).not.toHaveBeenCalled();
  });

  it('rejects disguised non-raster files and oversized streams', async () => {
    const fakeSvg = vi.fn(async () => new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
    await expect(importBookingProfilePhoto(fixture, { fetchFile: fakeSvg })).rejects.toThrow(/không phải ảnh/);
    const overSize = vi.fn(async () => new Response(Buffer.alloc(3 * 1024 * 1024 + 1)));
    await expect(importBookingProfilePhoto(fixture, { fetchFile: overSize })).rejects.toThrow(/quá 3 MB/);
  });
});

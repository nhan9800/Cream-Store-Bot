import { spawnSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import ffmpegPath from 'ffmpeg-static';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MUSIC_ATTACHMENT_MAX_BYTES,
  MUSIC_ATTACHMENT_STARTUP_TIMEOUT_MS,
  createMusicAttachmentPcmStream,
  normalizeMusicAttachment,
} from '../src/services/musicAttachmentStream.js';

const scopeId = '1282637033340403754';
const attachmentId = '1250000000000000001';
const signedQuery = 'ex=79999999&is=78888888&hm=private-signature';

function makeAttachment({ format = 'mp3', size = 3, pathPrefix = 'ephemeral-attachments' } = {}) {
  const name = `Cenar thử nhạc.${format}`;
  return {
    id: attachmentId,
    name,
    size,
    contentType: format === 'mp3' ? 'audio/mpeg' : 'audio/ogg',
    url: `https://cdn.discordapp.com/${pathPrefix}/${scopeId}/${attachmentId}/${encodeURIComponent(name)}?${signedQuery}`,
  };
}

function fakeDecoder() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdin.resume();
  child.stdout = new PassThrough();
  child.kill = vi.fn();
  return child;
}

afterEach(() => vi.useRealTimers());

describe('Discord music attachment validation', () => {
  it.each(['attachments', 'ephemeral-attachments'])('accepts %s from the Discord CDN', (pathPrefix) => {
    const attachment = makeAttachment({ format: 'ogg', pathPrefix });
    expect(normalizeMusicAttachment(attachment)).toEqual({
      id: attachment.id,
      name: attachment.name,
      size: attachment.size,
      url: attachment.url,
      format: 'ogg',
    });
  });

  it('rejects oversized files, unsupported extensions and a mismatched attachment ID', () => {
    expect(() => normalizeMusicAttachment(makeAttachment({ size: MUSIC_ATTACHMENT_MAX_BYTES + 1 }))).toThrow(/8 MB/);
    expect(() => normalizeMusicAttachment({ ...makeAttachment(), id: scopeId })).toThrow(/tải tệp trực tiếp/);
    expect(() => normalizeMusicAttachment({ ...makeAttachment(), name: 'x.wav' })).toThrow(/MP3 hoặc OGG/);
  });

  it('rejects insecure, alternate, malformed and redirected CDN destinations', () => {
    const file = makeAttachment();
    for (const url of [
      file.url.replace('https:', 'http:'),
      file.url.replace('cdn.discordapp.com', 'cdn.discordapp.com.invalid'),
      file.url.replace('cdn.discordapp.com', 'cdn.discordapp.com:443'),
      file.url.replace('cdn.discordapp.com', 'user@cdn.discordapp.com'),
      file.url.replace('cdn.discordapp.com', 'media.discordapp.net'),
      file.url.replace('/ephemeral-attachments/', '/emojis/'),
      file.url.replace('/Cenar', '/%2fCenar'),
      `${file.url}#fragment`,
    ]) {
      expect(() => normalizeMusicAttachment({ ...file, url })).toThrow();
    }
  });
});

describe('Discord music attachment streaming', () => {
  it.each([
    ['mp3', 'libmp3lame', 'audio/x-mpeg'],
    ['ogg', 'libopus', 'application/ogg'],
  ])('decodes a generated %s into audible stereo PCM through the real pipe', async (format, encoder, cdnMime) => {
    const sample = spawnSync(ffmpegPath, [
      '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.25',
      '-c:a', encoder, '-f', format, 'pipe:1',
    ], { windowsHide: true });
    expect(sample.status).toBe(0);
    const payload = sample.stdout;
    const attachment = makeAttachment({ format, size: payload.length });
    const fetchAttachment = vi.fn(async () => new Response(payload, {
      headers: { 'content-type': cdnMime, 'content-length': String(payload.length) },
    }));
    const stream = createMusicAttachmentPcmStream({ ...attachment, contentType: '' }, { fetchAttachment });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const pcm = Buffer.concat(chunks);
    expect(pcm.length).toBeGreaterThanOrEqual(48_000);
    expect(pcm.length % 4).toBe(0);
    expect(pcm.some((byte) => byte !== 0)).toBe(true);
    expect(fetchAttachment).toHaveBeenCalledWith(attachment.url, expect.objectContaining({
      redirect: 'error',
      credentials: 'omit',
    }));
  });

  it('caps received bytes even when there is no Content-Length', async () => {
    const child = fakeDecoder();
    const source = createMusicAttachmentPcmStream(makeAttachment(), {
      fetchAttachment: vi.fn(async () => new Response(Uint8Array.of(1, 2, 3, 4))),
      spawnFfmpeg: vi.fn(() => child),
    });
    const closed = new Promise((resolve) => source.once('close', resolve));
    const [error] = await once(source, 'error');
    expect(error.message).toMatch(/vượt dung lượng/);
    expect(error.message).not.toContain(signedQuery);
    await closed;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('rejects non-audio responses, changed sizes and expired links before decoding', async () => {
    const spawnFfmpeg = vi.fn();
    for (const response of [
      new Response(null, { status: 403 }),
      new Response(Uint8Array.of(1, 2, 3), { headers: { 'content-length': '4' } }),
      new Response('<em>expired</em>', { headers: { 'content-type': 'text/html' } }),
    ]) {
      const output = createMusicAttachmentPcmStream(makeAttachment(), {
        fetchAttachment: vi.fn(async () => response),
        spawnFfmpeg,
      });
      const [error] = await once(output, 'error');
      expect(error.message).toContain('Tệp Discord');
      expect(error.message).not.toContain(signedQuery);
    }
    expect(spawnFfmpeg).not.toHaveBeenCalled();
  });

  it('aborts a pending download when the player destroys the source', async () => {
    const fetchAttachment = vi.fn(() => new Promise(() => {}));
    const spawnFfmpeg = vi.fn();
    const output = createMusicAttachmentPcmStream(makeAttachment(), { fetchAttachment, spawnFfmpeg });
    const [{ signal }] = fetchAttachment.mock.calls.map(([, options]) => options);
    const closed = new Promise((resolve) => output.once('close', resolve));
    output.destroy();
    await closed;
    expect(signal.aborted).toBe(true);
    expect(spawnFfmpeg).not.toHaveBeenCalled();
  });

  it('times out without bytes and releases the decoder slot', async () => {
    vi.useFakeTimers();
    const fetchAttachment = vi.fn(() => new Promise(() => {}));
    const opts = { fetchAttachment };
    const one = createMusicAttachmentPcmStream(makeAttachment(), opts);
    const two = createMusicAttachmentPcmStream(makeAttachment(), opts);
    expect(() => createMusicAttachmentPcmStream(makeAttachment(), opts)).toThrow(/các phòng khác/);
    const waiting = [once(one, 'error'), once(two, 'error')];
    await vi.advanceTimersByTimeAsync(MUSIC_ATTACHMENT_STARTUP_TIMEOUT_MS);
    for (const [error] of await Promise.all(waiting)) expect(error.message).toMatch(/15 giây/);
    const next = createMusicAttachmentPcmStream(makeAttachment(), opts);
    const closed = new Promise((resolve) => next.once('close', resolve));
    next.destroy();
    await closed;
  });
});

import { spawnSync } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import ffmpegPath from 'ffmpeg-static';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MUSIC_COMMONS_STARTUP_TIMEOUT_MS,
  createMusicCommonsPcmStream,
} from '../src/services/musicCommonsStream.js';
import { MUSIC_COMMONS_USER_AGENT } from '../src/services/musicCommonsCatalog.js';

function makeCommonsSource(size = 3, format = 'ogg') {
  return {
    url: `https://upload.wikimedia.org/wikipedia/commons/7/7b/FurElise.${format}`,
    format,
    size,
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

describe('Wikimedia Commons music streaming', () => {
  it.each([
    ['mp3', 'libmp3lame', 'audio/x-mpeg'],
    ['ogg', 'libvorbis', 'application/ogg'],
  ])('decodes a generated %s into audible stereo PCM through the real pipe', async (format, encoder, cdnMime) => {
    const sample = spawnSync(ffmpegPath, [
      '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.25',
      '-c:a', encoder, '-f', format, 'pipe:1',
    ], { windowsHide: true });
    expect(sample.status).toBe(0);
    const payload = sample.stdout;
    const recording = makeCommonsSource(payload.length, format);
    const fetchCommons = vi.fn(async () => new Response(payload, {
      headers: { 'content-type': cdnMime, 'content-length': String(payload.length) },
    }));
    const stream = createMusicCommonsPcmStream(recording, { fetchCommons });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const pcm = Buffer.concat(chunks);
    // MP3 and Vorbis can report different encoder delay/padding.
    expect(pcm.length).toBeGreaterThan(40_000);
    expect(pcm.length).toBeLessThan(60_000);
    expect(pcm.length % 4).toBe(0);
    expect(pcm.some((byte) => byte !== 0)).toBe(true);
    expect(fetchCommons).toHaveBeenCalledWith(recording.url, expect.objectContaining({
      redirect: 'error',
      credentials: 'omit',
      headers: { 'Accept-Encoding': 'identity', 'User-Agent': MUSIC_COMMONS_USER_AGENT },
    }));
  });

  it('caps received bytes even when there is no Content-Length', async () => {
    const child = fakeDecoder();
    const source = createMusicCommonsPcmStream(makeCommonsSource(), {
      fetchCommons: vi.fn(async () => new Response(Uint8Array.of(1, 2, 3, 4))),
      spawnFfmpeg: vi.fn(() => child),
    });
    const closed = new Promise((resolve) => source.once('close', resolve));
    const [error] = await once(source, 'error');
    expect(error.message).toMatch(/vượt dung lượng/);
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
      const output = createMusicCommonsPcmStream(makeCommonsSource(), {
        fetchCommons: vi.fn(async () => response),
        spawnFfmpeg,
      });
      const [error] = await once(output, 'error');
      expect(error.message).toContain('Wikimedia Commons');
    }
    expect(spawnFfmpeg).not.toHaveBeenCalled();
  });

  it('aborts a pending download when the player destroys the source', async () => {
    const fetchCommons = vi.fn(() => new Promise(() => {}));
    const spawnFfmpeg = vi.fn();
    const output = createMusicCommonsPcmStream(makeCommonsSource(), { fetchCommons, spawnFfmpeg });
    const [[, { signal }]] = fetchCommons.mock.calls;
    const closed = new Promise((resolve) => output.once('close', resolve));
    output.destroy();
    await closed;
    expect(signal.aborted).toBe(true);
    expect(spawnFfmpeg).not.toHaveBeenCalled();
  });

  it('times out without bytes and releases the decoder slot', async () => {
    vi.useFakeTimers();
    const opts = { fetchCommons: vi.fn(() => new Promise(() => {})) };
    const one = createMusicCommonsPcmStream(makeCommonsSource(), opts);
    const two = createMusicCommonsPcmStream(makeCommonsSource(), opts);
    expect(() => createMusicCommonsPcmStream(makeCommonsSource(), opts)).toThrow(/các phòng khác/);
    const waiting = [once(one, 'error'), once(two, 'error')];
    await vi.advanceTimersByTimeAsync(MUSIC_COMMONS_STARTUP_TIMEOUT_MS);
    for (const [error] of await Promise.all(waiting)) expect(error.message).toMatch(/15 giây/);
    const next = createMusicCommonsPcmStream(makeCommonsSource(), opts);
    const closed = new Promise((resolve) => next.once('close', resolve));
    next.destroy();
    await closed;
  });
  it('rejects redirects and denies foreign sources before making a request', async () => {
    const fetchCommons = vi.fn(async () => Response.redirect('https://invalid.test/file.ogg', 302));
    const spawnFfmpeg = vi.fn();
    const options = { fetchCommons, spawnFfmpeg };
    const source = makeCommonsSource();
    expect(() => createMusicCommonsPcmStream({ ...source, url: 'https://invalid.test/file.ogg' }, options)).toThrow();
    expect(fetchCommons).not.toHaveBeenCalled();
    const output = createMusicCommonsPcmStream(source, options);
    const [error] = await once(output, 'error');
    expect(error.message).toContain('Wikimedia Commons');
    expect(error.message).not.toContain('invalid.test');
    expect(spawnFfmpeg).not.toHaveBeenCalled();
  });
});

import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Playlist, Track } from 'discord-player';
import { YOUTUBE_MIX_LIMIT, loadYoutubeMix, normalizeYoutubeMixUrl, runYoutubeMixMetadata } from '../src/services/youtubeMixSource.js';

const firstId = 'dQw4w9WgXcQ';
const secondId = '9bZkp7q19f0';
const mixId = `RD${firstId}`;
const mixUrl = `https://www.youtube.com/watch?v=${firstId}&list=${mixId}&start_radio=1`;
const extractorId = 'com.dfxphoenix.youtubedlp-extractor';
const extractor = { identifier: extractorId };
const makePlayer = () => ({ extractors: { get: vi.fn(() => extractor) } });
const makeEntry = (id, extra = {}) => ({
  _type: 'url', id, title: `Music ${id}`, duration: 183,
  url: `https://www.youtube.com/watch?v=${id}`, ie_key: 'Youtube', uploader: 'Cenar Artist',
  ...extra,
});
const metadata = (entries = [makeEntry(firstId), makeEntry(secondId)], extra = {}) => ({
  _type: 'playlist', id: mixId, title: 'Mix — Cenar Chill', entries, ...extra,
});
function harness(payload = metadata(), options = {}) {
  const player = makePlayer();
  const requestedBy = { id: 'listener', username: 'Cenar Listener' };
  const resolveBinary = vi.fn(async () => '/verified/yt-dlp');
  const runFile = vi.fn(async () => ({ stdout: JSON.stringify(payload), stderr: '' }));
  const load = (overrides = {}) => loadYoutubeMix(player, mixUrl, requestedBy, {
    resolveBinary, runFile, env: {}, ...options, ...overrides,
  });
  return { player, requestedBy, resolveBinary, runFile, load };
}

describe('YouTube Mix URL normalization', () => {
  it.each([
    `https://www.youtube.com/watch?v=${firstId}&list=${mixId}&index=4&t=20&si=share`,
    `https://music.youtube.com/watch?v=${firstId}&list=${mixId}`,
    `https://youtu.be/${firstId}?list=${mixId}&si=share`,
    `https://www.youtube.com/playlist?list=${mixId}`,
  ])('retains the Mix identifier and seed from %s', (input) => {
    expect(normalizeYoutubeMixUrl(input)).toBe(mixUrl);
  });

  it.each(['RD', 'RDMM', 'RDAMVM'])('derives a seed from a bare %s video Mix', (prefix) => {
    const id = `${prefix}${firstId}`;
    expect(normalizeYoutubeMixUrl(`https://music.youtube.com/playlist?list=${id}`))
      .toBe(`https://www.youtube.com/watch?v=${firstId}&list=${id}&start_radio=1`);
  });

  it('permits an opaque Mix list to be resolved by YouTube without inventing a seed', () => {
    const opaqueId = 'RDCLAK5uy_kOpaqueMixIdentifier';
    expect(normalizeYoutubeMixUrl(`https://youtube.com/playlist?list=${opaqueId}`))
      .toBe(`https://www.youtube.com/playlist?list=${opaqueId}`);
  });

  it.each([
    `https://youtube.com/watch?v=&list=${mixId}`,
    `https://youtube.com/watch?v=bad-seed&list=${mixId}`,
    `https://youtu.be/bad-seed?list=${mixId}`,
  ])('rejects an explicitly invalid seed rather than replacing it from the list (%s)', (input) => {
    expect(() => normalizeYoutubeMixUrl(input)).toThrow();
  });

  it.each([
    `https://youtube.com/watch?v=${firstId}`,
    'https://youtube.com/playlist?list=PLsaved_playlist',
  ])('refuses a non-Mix input to the dedicated loader (%s)', (input) => {
    expect(() => normalizeYoutubeMixUrl(input)).toThrow();
  });

  it.each([
    `https://youtube.com.evil.invalid/watch?v=${firstId}&list=${mixId}`,
    `https://youtube.com/channel/${firstId}?list=${mixId}`,
    `file:///watch?v=${firstId}&list=${mixId}`,
  ])('rejects offsite or unsupported Mix URLs (%s)', (input) => {
    expect(() => normalizeYoutubeMixUrl(input)).toThrow();
  });

  it('discards URL user information instead of forwarding it to the source process', () => {
    const canonical = normalizeYoutubeMixUrl(`https://user:password@youtube.com/watch?v=${firstId}&list=${mixId}`);
    expect(canonical).toBe(mixUrl);
    expect(canonical).not.toContain('password');
    expect(canonical).not.toContain('@');
  });
});

describe('Bounded YouTube Mix metadata extraction', () => {
  it('builds ordered native tracks and a linked native playlist for the registered extractor', async () => {
    const h = harness();
    const result = await h.load();
    expect(result.playlist).toBeInstanceOf(Playlist);
    expect(result.playlist).toMatchObject({ id: mixId, title: 'Mix — Cenar Chill', url: mixUrl, mix: true, limit: 50 });
    expect(result.tracks.map((track) => track.url)).toEqual([
      `https://www.youtube.com/watch?v=${firstId}`,
      `https://www.youtube.com/watch?v=${secondId}`,
    ]);
    expect(result.playlist.tracks).toBe(result.tracks);
    for (const track of result.tracks) {
      expect(track).toBeInstanceOf(Track);
      expect(track.player).toBe(h.player);
      expect(track.playlist).toBe(result.playlist);
      expect(track.requestedBy).toBe(h.requestedBy);
      expect(track.extractor).toBe(extractor);
      expect(track.source).toBe('youtube');
      expect(track.durationMS).toBe(183_000);
    }
    expect(h.player.extractors.get).toHaveBeenCalledWith(extractorId);
  });

  it('uses a verified binary, finite flat metadata and bounded subprocess output without browser cookies', async () => {
    const h = harness();
    await h.load();
    expect(YOUTUBE_MIX_LIMIT).toBe(50);
    expect(h.resolveBinary).toHaveBeenCalledTimes(1);
    const [binary, args, options] = h.runFile.mock.calls[0];
    expect(binary).toBe('/verified/yt-dlp');
    expect(args).toEqual(expect.arrayContaining(['--ignore-config', '--flat-playlist', '--skip-download', mixUrl]));
    expect(args).not.toContain('--cookies-from-browser');
    expect(args).not.toContain('--no-playlist');
    expect(args.join(' ')).toMatch(/--playlist-(?:end 50|items 1:50)/);
    expect(options).toMatchObject({ shell: false, windowsHide: true, timeout: 20_000 });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.maxBuffer).toBeGreaterThan(0);
    expect(options.maxBuffer).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it('passes only explicitly configured cookie file and proxy as separate subprocess arguments', async () => {
    const cookies = 'C:/Music config/cookies.txt';
    const proxy = 'http://test-user:test-secret@proxy.invalid:8080';
    const h = harness(metadata(), { env: { YOUTUBE_COOKIES_FILE: cookies, YOUTUBE_PROXY_URL: proxy } });
    await h.load();
    const args = h.runFile.mock.calls[0][1];
    expect(args[args.indexOf('--cookies') + 1]).toBe(cookies);
    expect(args[args.indexOf('--proxy') + 1]).toBe(proxy);
    expect(args).not.toContain('--cookies-from-browser');
  });

  it('deduplicates video IDs and filters unavailable or unsupported entries without changing the usable order', async () => {
    const entries = [
      null, makeEntry(firstId), makeEntry(firstId, { title: 'Duplicate' }),
      makeEntry('invalid-id'),
      makeEntry('A2345678901', { title: '[Deleted video]' }),
      makeEntry('B2345678901', { title: '[Private video]' }),
      makeEntry('C2345678901', { availability: 'private' }),
      makeEntry('D2345678901', { url: 'https://soundcloud.com/artist/music', ie_key: 'Soundcloud' }),
      makeEntry(secondId, { url: `https://youtu.be/${secondId}?si=share` }),
    ];
    const result = await harness(metadata(entries)).load();
    expect(result.tracks.map((track) => track.url)).toEqual([
      `https://www.youtube.com/watch?v=${firstId}`,
      `https://www.youtube.com/watch?v=${secondId}`,
    ]);
  });

  it('never constructs more than the finite 50-track snapshot even if a runner returns excess metadata', async () => {
    const entries = Array.from({ length: 75 }, (_, index) => makeEntry(`v${String(index).padStart(10, '0')}`));
    const result = await harness(metadata(entries)).load();
    expect(result.tracks).toHaveLength(50);
    expect(result.tracks[0].url).toBe('https://www.youtube.com/watch?v=v0000000000');
    expect(result.tracks[49].url).toBe('https://www.youtube.com/watch?v=v0000000049');
  });

  it('creates fresh tracks for subsequent requests instead of leaking requester or playlist mutations', async () => {
    const h = harness();
    const first = await h.load();
    first.tracks[0].setMetadata({ firstRequest: true });
    first.tracks[0].requestedBy = { id: 'modified' };
    const next = await h.load();
    expect(next.playlist).not.toBe(first.playlist);
    expect(next.tracks[0]).not.toBe(first.tracks[0]);
    expect(next.tracks[0].id).not.toBe(first.tracks[0].id);
    expect(next.tracks[0].requestedBy).toBe(h.requestedBy);
    expect(next.tracks[0].metadata).not.toMatchObject({ firstRequest: true });
    expect(next.tracks[0].playlist).toBe(next.playlist);
  });

  it('keeps extractor internals and private metadata out of native track state and playlist output', async () => {
    const secret = 'metadata-only-sensitive-value';
    const payload = metadata([makeEntry(firstId, {
      cookies: secret, http_headers: { Cookie: secret }, formats: [{ url: `https://cdn.invalid/${secret}` }],
    })], { cookies: secret, proxy: secret });
    const result = await harness(payload).load();
    const output = JSON.stringify({
      playlist: result.playlist.toJSON(),
      raw: result.tracks.map((track) => track.raw),
      metadata: result.tracks.map((track) => track.metadata),
    });
    expect(output).not.toContain(secret);
  });

  it.each([
    { _type: 'video', id: firstId, title: 'One video', entries: [makeEntry(firstId)] },
    metadata([]), metadata([null, makeEntry('invalid')]), metadata(undefined, { id: `RD${secondId}` }),
  ])('rejects non-playlist or zero usable metadata (%j)', async (payload) => {
    await expect(harness(payload).load()).rejects.toThrow();
  });

  it('accepts an actual playlist snapshot with one accessible entry without inventing more tracks', async () => {
    const result = await harness(metadata([makeEntry(firstId)])).load();
    expect(result.tracks).toHaveLength(1);
    expect(result.playlist.tracks).toHaveLength(1);
  });

  it('fails before launching a subprocess if its registered stream extractor is unavailable', async () => {
    const h = harness();
    h.player.extractors.get.mockReturnValue(null);
    await expect(h.load()).rejects.toThrow();
    expect(h.runFile).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON without including sensitive stdout in its error', async () => {
    const h = harness();
    const secret = 'private-cookie-and-proxy-value';
    h.runFile.mockResolvedValue({ stdout: `{ malformed ${secret}`, stderr: secret });
    const error = await h.load().catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(secret);
    expect(error.cause).toBeUndefined();
  });

  it('redacts subprocess message, stderr, stdout and proxy credentials on extraction failure', async () => {
    const h = harness();
    const secret = 'user-password-secret';
    h.runFile.mockRejectedValue(Object.assign(new Error(`Command failed --proxy http://${secret}@proxy.invalid`), {
      stdout: `stdout ${secret}`, stderr: `stderr ${secret}`, code: 1,
    }));
    const error = await h.load().catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(secret);
    expect(error.cause).toBeUndefined();
    expect(error.stdout).toBeUndefined();
    expect(error.stderr).toBeUndefined();
  });

  it('redacts verified-runtime preparation failures before launching metadata extraction', async () => {
    const h = harness();
    const secret = 'runtime-sensitive-path-value';
    h.resolveBinary.mockRejectedValue(new Error(`Download or runtime path ${secret}`));
    const error = await h.load().catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(secret);
    expect(h.runFile).not.toHaveBeenCalled();
  });

  it('rejects late metadata after the cancellation signal even if a runner ignores the abort', async () => {
    const h = harness();
    let signal;
    h.runFile.mockImplementation((_binary, _args, options) => {
      signal = options.signal;
      return new Promise((resolve) => {
        setTimeout(() => resolve({ stdout: JSON.stringify(metadata()), stderr: '' }), 50);
      });
    });
    await expect(h.load({ timeoutMs: 25 })).rejects.toThrow();
    expect(signal.aborted).toBe(true);
    expect(h.runFile).toHaveBeenCalledTimes(1);
  });

});

describe('Default Mix metadata subprocess lifecycle', () => {
  const isAlive = (pid) => {
    try { process.kill(pid, 0); return true; } catch (error) {
      if (error.code === 'ESRCH') return false;
      throw error;
    }
  };
  const waitUntil = async (predicate, timeoutMs = 3_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Metadata subprocess did not reach the expected state');
  };

  it('returns successful Unicode stdout from the default process runner', async () => {
    const expected = JSON.stringify({ title: 'Mix — Nhạc nhẹ', entries: [] });
    const result = await runYoutubeMixMetadata(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(expected)})`]);
    expect(result.stdout).toBe(expected);
  });

  it('rejects an oversized stdout stream rather than accumulating unbounded metadata', async () => {
    await expect(runYoutubeMixMetadata(process.execPath, ['-e', 'process.stdout.write("x".repeat(4096))'], {
      maxBuffer: 128, timeout: 1_000,
    })).rejects.toThrow('MIX_OUTPUT_LIMIT');
  });

  it('rejects a nonzero exit without forwarding stderr or subprocess details', async () => {
    const secret = 'private-subprocess-message';
    const error = await runYoutubeMixMetadata(process.execPath, ['-e', `process.stderr.write(${JSON.stringify(secret)});process.exit(1)`])
      .catch((error) => error);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain('MIX_PROCESS_ERROR');
    expect(String(error)).not.toContain(secret);
    expect(error.stderr).toBeUndefined();
  });

  it('refuses an already cancelled request before spawning', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runYoutubeMixMetadata('not-a-real-binary', [], { signal: controller.signal }))
      .rejects.toThrow('MIX_TIMEOUT');
  });

  it('terminates the real worker tree and lets a POSIX parent reap its worker and clean up', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'cenar-mix-process-test-'));
    const pidFile = path.join(directory, 'pids.json');
    const cleanupFile = path.join(directory, 'cleanup.txt');
    const controller = new AbortController();
    let pids = [];
    let processResult;
    const script = `
      const { spawn } = require('node:child_process');
      const { writeFileSync } = require('node:fs');
      const worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
      let stopping = false;
      let workerReaped = false;
      const heartbeat = setInterval(() => {}, 1000);
      const finishCleanup = () => {
        writeFileSync(${JSON.stringify(cleanupFile)}, 'worker-reaped');
        clearInterval(heartbeat);
        process.exit(0);
      };
      worker.on('close', () => {
        workerReaped = true;
        if (stopping) finishCleanup();
      });
      process.on('SIGTERM', () => {
        stopping = true;
        if (workerReaped) finishCleanup();
        else worker.kill('SIGTERM');
      });
      writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify([process.pid, worker.pid]));
    `;
    try {
      processResult = runYoutubeMixMetadata(process.execPath, ['-e', script], {
        signal: controller.signal, timeout: 5_000,
      }).catch((error) => error);
      await waitUntil(async () => {
        try { pids = JSON.parse(await readFile(pidFile, 'utf8')); return pids.length === 2; }
        catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      });
      expect(pids.every(isAlive)).toBe(true);
      controller.abort();
      expect(await processResult).toMatchObject({ message: 'MIX_TIMEOUT' });
      await waitUntil(() => pids.every((pid) => !isAlive(pid)));
      expect(pids.every((pid) => !isAlive(pid))).toBe(true);
      if (process.platform !== 'win32') {
        expect(await readFile(cleanupFile, 'utf8')).toBe('worker-reaped');
      }
    } finally {
      controller.abort();
      await processResult;
      for (const pid of pids) {
        if (isAlive(pid)) process.kill(pid, 'SIGKILL');
      }
      await rm(pidFile, { force: true });
      await rm(cleanupFile, { force: true });
      await rmdir(directory);
    }
  }, 10_000);
});

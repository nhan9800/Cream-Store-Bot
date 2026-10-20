import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = {
  spawn: vi.fn(),
  runtime: vi.fn(),
  fallback: vi.fn(),
};

import {
  buildFfmpegDirectArgs,
  buildYtDlpDirectArgs,
  createResilientYoutubePcmStream,
  YOUTUBE_DIRECT_STARTUP_TIMEOUT_MS,
} from '../src/services/youtubeDirectPcmStream.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const children = [];
const outputs = [];
const fallbackStreams = [];

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  // Deliberately do not emit close: a killed/stuck process must not gate cleanup.
  child.kill = vi.fn();
  return child;
}
function createOutput(options) {
  const output = createResilientYoutubePcmStream('https://www.youtube.com/watch?v=example', {
    spawnProcess: mocks.spawn,
    resolveRuntime: mocks.runtime,
    createFallback: mocks.fallback,
    ...options,
  });
  outputs.push(output);
  return output;
}
function resolveUrl(child) {
  child.stdout.end('https://googlevideo.invalid/audio\n');
  child.emit('close', 0);
}
async function startFfmpeg(options) {
  const output = createOutput(options);
  await flush();
  resolveUrl(children[0]);
  await flush();
  return { output, child: children[1] };
}
async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  children.length = 0;
  outputs.length = 0;
  fallbackStreams.length = 0;
  mocks.runtime.mockReset().mockResolvedValue('mock-yt-dlp');
  mocks.spawn.mockReset().mockImplementation(() => {
    const child = fakeChild();
    children.push(child);
    return child;
  });
  mocks.fallback.mockReset().mockImplementation(() => {
    const stream = new PassThrough();
    fallbackStreams.push(stream);
    return stream;
  });
});

afterEach(async () => {
  for (const output of outputs) output.destroy();
  await flush();
  for (const child of children) {
    child.stdout.destroy();
    child.stderr.destroy();
  }
  vi.useRealTimers();
});

describe('direct YouTube PCM fallback', () => {
  it('resolves a fresh audio-only URL with bounded YouTube options', () => {
    const args = buildYtDlpDirectArgs('https://www.youtube.com/watch?v=abc', {
      proxyUri: 'http://proxy.invalid:8080',
      cookiesFile: '/protected/cookies.txt',
    });
    expect(args).toEqual(expect.arrayContaining([
      '--no-playlist', '--js-runtimes', 'node', '--force-ipv4',
      '-f', 'bestaudio[acodec!=none]/bestaudio/best', '-g',
      '--proxy', 'http://proxy.invalid:8080', '--cookies', '/protected/cookies.txt',
    ]));
    expect(args).not.toContain('--yes-playlist');
  });

  it('can pin a public YouTube player client for a retry without dropping auth options', () => {
    const args = buildYtDlpDirectArgs('https://www.youtube.com/watch?v=abc', {
      playerClient: 'android,web',
      proxyUri: 'http://proxy.invalid:8080',
      cookiesFile: '/protected/cookies.txt',
    });
    expect(args).toEqual(expect.arrayContaining([
      '--extractor-args', 'youtube:player_client=android,web',
      '--proxy', 'http://proxy.invalid:8080', '--cookies', '/protected/cookies.txt',
    ]));
  });

  it('asks FFmpeg to reconnect YouTube HTTP audio and emit aligned PCM', () => {
    const args = buildFfmpegDirectArgs('https://googlevideo.invalid/audio');
    expect(args).toEqual(expect.arrayContaining([
      '-reconnect', '1', '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5', '-ar', '48000', '-ac', '2', '-f', 's16le', 'pipe:1',
    ]));
    // Finite songs must finish instead of reopening their audio at EOF.
    expect(args).not.toContain('-reconnect_at_eof');
  });

  it('retains the first PCM bytes until Player attaches and drains all bytes under backpressure', async () => {
    const { output, child } = await startFfmpeg();
    // Eight MiB exceeds the exposed buffer; generate non-repeating PCM bytes
    // so dropped/duplicated first and final chunks cannot pass by length alone.
    const pcm = Buffer.alloc(8 * 1024 * 1024);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (i * 31 + (i >>> 8)) % 256;
    child.stdout.end(pcm);
    child.emit('close', 0);
    await flush();
    expect(output.readableFlowing).not.toBe(true);
    expect(output.destroyed).toBe(false);
    // Compare bytes natively; deep assertion inspection of 8 MiB is costly.
    const received = await readAll(output);
    expect(received.length).toBe(pcm.length);
    expect(received.equals(pcm)).toBe(true);
    expect(mocks.fallback).not.toHaveBeenCalled();
  });

  it('counts an FFmpeg error followed by a late close only once and preserves the retry child', async () => {
    const { output, child: first } = await startFfmpeg();
    first.emit('error', new Error('temporary failure'));
    await flush();
    resolveUrl(children[2]);
    await flush();
    const retry = children[3];
    first.emit('close', 1);
    await flush();
    expect(children).toHaveLength(4);
    expect(retry.kill).not.toHaveBeenCalled();
    retry.stdout.end(Buffer.from([1, 2, 3, 4]));
    retry.emit('close', 0);
    expect(await readAll(output)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(mocks.fallback).not.toHaveBeenCalled();
  });

  it('ignores a late resolver close after its error without clearing the next active process', async () => {
    const output = createOutput();
    await flush();
    const first = children[0];
    first.emit('error', new Error('resolver failed'));
    await flush();
    resolveUrl(children[1]);
    await flush();
    const player = children[2];
    first.emit('close', 1);
    await flush();
    expect(children).toHaveLength(3);
    expect(player.kill).not.toHaveBeenCalled();
    player.stdout.end(Buffer.from([8, 7, 6, 5]));
    player.emit('close', 0);
    expect(await readAll(output)).toEqual(Buffer.from([8, 7, 6, 5]));
  });

  it('kills an active resolver when playback is cancelled without waiting for process close', async () => {
    const output = createOutput();
    await flush();
    output.destroy();
    await flush();
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL');
    children[0].emit('close', 1);
    await vi.advanceTimersByTimeAsync(YOUTUBE_DIRECT_STARTUP_TIMEOUT_MS);
    expect(children).toHaveLength(1);
    expect(mocks.fallback).not.toHaveBeenCalled();
  });

  it('does not spawn a process after cancellation while the runtime is still resolving', async () => {
    let ready;
    mocks.runtime.mockImplementation(() => new Promise((resolve) => { ready = resolve; }));
    const output = createOutput();
    output.destroy();
    await flush();
    ready('mock-yt-dlp');
    await flush();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('kills an active FFmpeg process immediately when the consumer stops', async () => {
    const { output, child } = await startFfmpeg();
    output.destroy();
    await flush();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('error', new Error('late teardown'));
    child.emit('close', 1);
    await flush();
    expect(children).toHaveLength(2);
  });

  it('bounds runtime resolution, retries and a silent extractor by the same total deadline', async () => {
    const output = createOutput();
    const error = new Promise((resolve) => output.once('error', resolve));
    await flush();
    // Two resolvers time out at 15s each; extractor gets only the remaining 15s.
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(mocks.fallback).toHaveBeenCalledTimes(1);
    expect(fallbackStreams[0].destroyed).toBe(false);
    await vi.advanceTimersByTimeAsync(YOUTUBE_DIRECT_STARTUP_TIMEOUT_MS - 30_000);
    expect((await error).message).toContain('45 giây');
    expect(fallbackStreams[0].destroyed).toBe(true);
    expect(children.every((child) => child.kill.mock.calls.length > 0)).toBe(true);
  });

  it('ends a stuck FFmpeg startup even if kill never produces a close event', async () => {
    const { output, child } = await startFfmpeg({ fallback: false });
    const error = new Promise((resolve) => output.once('error', resolve));
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await error).message).toContain('FFmpeg');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(output.destroyed).toBe(true);
  });

  it('treats successful but empty FFmpeg EOF as startup failure and reaches one working fallback', async () => {
    const { output, child } = await startFfmpeg();
    child.stdout.end();
    child.emit('close', 0);
    await flush();
    resolveUrl(children[2]);
    await flush();
    children[3].stdout.end();
    children[3].emit('close', 0);
    await flush();
    expect(mocks.fallback).toHaveBeenCalledTimes(1);
    const result = readAll(output);
    fallbackStreams[0].end(Buffer.from([2, 4, 6, 8]));
    expect(await result).toEqual(Buffer.from([2, 4, 6, 8]));
  });

  it('clears the startup budget after PCM begins without replaying failed audio', async () => {
    const { output, child } = await startFfmpeg();
    const error = new Promise((resolve) => output.once('error', resolve));
    child.stdout.write(Buffer.from([1, 3, 5, 7]));
    await flush();
    await vi.advanceTimersByTimeAsync(YOUTUBE_DIRECT_STARTUP_TIMEOUT_MS * 2);
    expect(output.destroyed).toBe(false);
    child.stderr.write('failed https://googlevideo.invalid/audio?token=private\nAuthorization: private');
    child.emit('close', 1);
    const failure = await error;
    expect(failure.message).not.toContain('googlevideo.invalid');
    expect(failure.message).not.toContain('private');
    expect(children).toHaveLength(2);
    expect(mocks.fallback).not.toHaveBeenCalled();
  });
});

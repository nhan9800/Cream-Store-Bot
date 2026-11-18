import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createYoutubePipedPcmStream } from '../src/services/youtubePipedPcmStream.js';

const videoUrl = 'https://www.youtube.com/watch?v=abcdefghijk';
const fixtures = [];
const flush = () => new Promise(resolve => setImmediate(resolve));

function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

function setup(options = {}) {
  const youtube = fakeChild();
  const decoder = fakeChild();
  const spawnProcess = vi.fn().mockReturnValueOnce(youtube).mockReturnValueOnce(decoder);
  const resolveRuntime = vi.fn().mockResolvedValue('verified-yt-dlp');
  const cleanup = vi.fn(async () => {});
  const prepareCookies = vi.fn(async () => ({ path: '/private/runtime/session.txt', cleanup }));
  const stream = createYoutubePipedPcmStream(videoUrl, {
    cookiesFile: '/private/yt-session.txt', spawnProcess, resolveRuntime, prepareCookies, ...options,
  });
  fixtures.push({ stream, youtube, decoder });
  return { stream, youtube, decoder, spawnProcess, prepareCookies, cleanup };
}

async function readAll(stream) {
  const parts = [];
  for await (const chunk of stream) parts.push(chunk);
  return Buffer.concat(parts);
}

afterEach(async () => {
  for (const { stream, youtube, decoder } of fixtures.splice(0)) {
    stream.destroy();
    for (const child of [youtube, decoder]) {
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    }
  }
  await flush();
  vi.useRealTimers();
});

describe('authenticated YouTube PCM pipe', () => {
  it('reports duration from fragmented stderr and keeps media on stdout', async () => {
    const onDuration = vi.fn();
    const { stream, youtube, decoder, spawnProcess, prepareCookies, cleanup } = setup({ onDuration });
    await flush();
    const [, ytArgs] = spawnProcess.mock.calls[0];
    const [, ffmpegArgs] = spawnProcess.mock.calls[1];
    expect(ytArgs).toEqual(expect.arrayContaining([
      '--ignore-config', '--no-playlist', '--print', 'before_dl:CENAR_YT_INFO:%(.{duration,is_live})j',
      '--no-simulate', '--cookies', '/private/runtime/session.txt', '-o', '-', '--', videoUrl,
    ]));
    expect(prepareCookies).toHaveBeenCalledExactlyOnceWith('/private/yt-session.txt');
    expect(ytArgs).not.toContain('/private/yt-session.txt');
    expect(ytArgs).not.toContain('infinite');
    expect(ffmpegArgs.join(' ')).toContain('-protocol_whitelist pipe -i pipe:0');

    const input = Buffer.from([0x00, 0xff, 0x01]);
    const piped = readAll(decoder.stdin);
    youtube.stderr.write('CENAR_YT_INFO:"18"\nCENAR_YT_INFO:0\nCENAR_YT_');
    youtube.stderr.write('INFO:{"duration":197.125,"is_live":false}\r\nCENAR_YT_INFO:{"duration":198}\n');
    youtube.stdout.end(input);
    youtube.emit('close', 0);
    decoder.stdout.end(Buffer.from('unaltered PCM'));
    decoder.emit('close', 0);

    expect(await piped).toEqual(input);
    expect(await readAll(stream)).toEqual(Buffer.from('unaltered PCM'));
    expect(onDuration).toHaveBeenCalledExactlyOnceWith(197.125);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(youtube.kill).not.toHaveBeenCalled();
    expect(decoder.kill).not.toHaveBeenCalled();
  });

  it('keeps the final PCM queued when clean child exits arrive before it is read', async () => {
    const { stream, youtube, decoder } = setup();
    await flush();
    const pcm = Buffer.alloc(900 * 1024, 0xca);
    youtube.stdout.end();
    youtube.emit('close', 0);
    decoder.stdout.end(pcm);
    decoder.emit('close', 0);
    expect(await readAll(stream)).toEqual(pcm);
  });

  it('ends a clean pipeline with no frames as a startup failure', async () => {
    const { stream, youtube, decoder } = setup();
    const error = once(stream, 'error');
    await flush();
    youtube.stdout.end();
    youtube.emit('close', 0);
    decoder.stdout.end();
    decoder.emit('close', 0);
    expect((await error)[0].message).toMatch(/chưa có âm thanh/);
  });

  it('lets delayed metadata update the duration before the first decoder frame is released', async () => {
    const onDuration = vi.fn();
    const { stream, youtube, decoder } = setup({ onDuration });
    await flush();
    decoder.stdout.write(Buffer.from('audio frame'));
    expect(stream.readableLength).toBe(0);
    youtube.stderr.write('CENAR_YT_INFO:{"duration":61,"is_live":false}\n');
    await flush();
    expect(stream.readableLength).toBeGreaterThan(0);
    expect(onDuration).toHaveBeenCalledExactlyOnceWith(61);
  });

  it('routes known live videos to the existing playback path', async () => {
    const onDuration = vi.fn();
    const { stream, youtube } = setup({ onDuration });
    const error = once(stream, 'error');
    await flush();
    youtube.stderr.write('CENAR_YT_INFO:{"duration":null,"is_live":true}\n');
    expect((await error)[0].message).toMatch(/trực tiếp/);
    expect(onDuration).not.toHaveBeenCalled();
  });

  it.each([
    ['Sign in to confirm you’re not a bot', /confirm.*not a bot/i],
    ['HTTP Error 429: Too Many Requests', /429/],
  ])('keeps provider classification when FFmpeg fails before yt-dlp: %s', async (providerText, expected) => {
    const { stream, youtube, decoder } = setup();
    const error = once(stream, 'error');
    await flush();
    decoder.emit('close', 1);
    youtube.stderr.write(`${providerText} https://media.invalid/?secret=opaque /private/yt-session.txt\n`);
    youtube.emit('close', 1);
    const message = (await error)[0].message;
    expect(message).toMatch(expected);
    expect(message).not.toMatch(/media\.invalid|opaque|yt-session/);
  });

  it('cancels both subprocesses when the voice stream is destroyed', async () => {
    const { stream, youtube, decoder, cleanup } = setup();
    await flush();
    const closed = once(stream, 'close');
    stream.destroy();
    await closed;
    expect(youtube.kill).toHaveBeenCalledWith('SIGKILL');
    expect(decoder.kill).toHaveBeenCalledWith('SIGKILL');
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('releases a session copy that finishes after stream cancellation without spawning', async () => {
    const cleanup = vi.fn(async () => {});
    let complete;
    const copying = new Promise(resolve => { complete = resolve; });
    const { stream, spawnProcess } = setup({ prepareCookies: () => copying });
    await flush();
    stream.destroy();
    complete({ path: '/private/runtime/session.txt', cleanup });
    await flush();
    expect(spawnProcess).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('does not spawn once cancelled during runtime resolution', async () => {
    let complete;
    const runtime = new Promise(resolve => { complete = resolve; });
    const { stream, spawnProcess } = setup({ resolveRuntime: () => runtime });
    stream.destroy();
    complete('verified-yt-dlp');
    await flush();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('uses one startup deadline and clears it on the first PCM bytes', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hung = setup({ startupTimeoutMs: 150 });
    const failure = once(hung.stream, 'error');
    await flush();
    await vi.advanceTimersByTimeAsync(150);
    expect((await failure)[0].message).toMatch(/thời gian khởi động/);
    expect(hung.youtube.kill).toHaveBeenCalled();
    expect(hung.decoder.kill).toHaveBeenCalled();

    const active = setup({ startupTimeoutMs: 150 });
    await flush();
    active.decoder.stdout.write(Buffer.from('first frames'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(active.stream.destroyed).toBe(false);
  });
});

import { PassThrough, Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMusicStreamPreloader } from '../src/services/musicStreamPreloader.js';

const firstTrack = { id: 'first', url: 'https://www.youtube.com/watch?v=first' };
const nextTrack = { id: 'next', url: 'https://www.youtube.com/watch?v=next' };
const flush = () => new Promise(resolve => setImmediate(resolve));
const streams = [];

function source(options) {
  const stream = new PassThrough({ highWaterMark: 4096, ...options });
  streams.push(stream);
  return stream;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
});
afterEach(async () => {
  for (const stream of streams.splice(0)) stream.destroy();
  await flush();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('next-track PCM preparation', () => {
  it('prepares only the exact next source once, pauses it and preserves every buffered byte for playback', async () => {
    const pcm = Buffer.alloc(24 * 1024);
    for (let i = 0; i < pcm.length; i++) pcm[i] = (i * 31 + (i >>> 8)) % 256;
    const stream = source();
    const createSource = vi.fn(() => stream);
    const preloader = createMusicStreamPreloader(createSource);
    const queue = {};
    preloader.prepare(queue, firstTrack);
    preloader.prepare(queue, { ...firstTrack });
    // Feed more than the readable watermark before there is any consumer.
    // A correct preloader keeps producer backpressure rather than draining it.
    expect(stream.write(pcm)).toBe(false);
    await flush();
    expect(createSource).toHaveBeenCalledExactlyOnceWith(firstTrack.url);
    expect(stream.readableFlowing).not.toBe(true);
    expect(stream.readableLength).toBe(pcm.length);
    expect(stream.listenerCount('data')).toBe(0);
    const prepared = preloader.take(queue, firstTrack);
    expect(await prepared.ready).toBe(true);
    expect(prepared.stream).toBe(stream);
    expect(preloader.take(queue, firstTrack)).toBeNull();
    expect(prepared.stream.read(pcm.length).equals(pcm)).toBe(true);
    prepared.cancel();
  });

  it('limits background production using the real stream watermarks rather than consuming the entire song', async () => {
    let produced = 0;
    const totalChunks = 1024;
    const stream = new Readable({
      highWaterMark: 4096,
      read() {
        while (produced < totalChunks) {
          produced += 1;
          if (!this.push(Buffer.alloc(1024, produced % 255))) return;
        }
        this.push(null);
      },
    });
    streams.push(stream);
    const preloader = createMusicStreamPreloader(() => stream);
    const queue = {};
    preloader.prepare(queue, firstTrack);
    await flush();
    await flush();
    expect(produced).toBeLessThan(totalChunks);
    expect(stream.readableLength).toBeLessThanOrEqual(4096);
    const prepared = preloader.take(queue, firstTrack);
    expect(await prepared.ready).toBe(true);
    prepared.cancel();
    await flush();
    expect(stream.destroyed).toBe(true);
  });

  it('replaces obsolete sources without cancelling sources in other queues', async () => {
    const createSource = vi.fn(() => source());
    const preloader = createMusicStreamPreloader(createSource);
    const queueA = {};
    const queueB = {};
    preloader.prepare(queueA, firstTrack);
    preloader.prepare(queueB, firstTrack);
    preloader.prepare(queueA, nextTrack);
    const [old, other, next] = createSource.mock.results.map(result => result.value);
    expect(old.destroyed).toBe(true);
    expect(other.destroyed).toBe(false);
    expect(next.destroyed).toBe(false);
    preloader.cancel(queueA);
    expect(next.destroyed).toBe(true);
    expect(other.destroyed).toBe(false);
    preloader.cancel(queueB);
    expect(other.destroyed).toBe(true);
  });

  it('transfers an in-flight source to playback and leaves cancellation of it to its new owner', async () => {
    const createSource = vi.fn(() => source());
    const preloader = createMusicStreamPreloader(createSource, { ttlMs: 1000 });
    const queue = {};
    preloader.prepare(queue, firstTrack);
    const prepared = preloader.take(queue, firstTrack);
    let ready = false;
    prepared.ready.then(() => { ready = true; });
    preloader.cancel(queue);
    preloader.prepare(queue, nextTrack);
    await vi.advanceTimersByTimeAsync(1001);
    expect(ready).toBe(false);
    expect(prepared.stream.destroyed).toBe(false);
    expect(createSource.mock.results[1].value.destroyed).toBe(true);
    prepared.stream.write(Buffer.from([1, 2, 3, 4]));
    expect(await prepared.ready).toBe(true);
    prepared.cancel();
    expect(prepared.stream.destroyed).toBe(true);
  });

  it('hands an in-flight source to a real pipeline and drains its final bytes without premature close', async () => {
    const stream = source();
    const preloader = createMusicStreamPreloader(() => stream);
    const queue = {};
    preloader.prepare(queue, firstTrack);
    const prepared = preloader.take(queue, firstTrack);
    const received = [];
    const destination = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, done) {
        received.push(Buffer.from(chunk));
        // Exercise a slow downstream consumer during source end/close.
        setImmediate(done);
      },
    });
    const completed = pipeline(prepared.stream, destination);
    const prefix = Buffer.alloc(12 * 1024);
    for (let i = 0; i < prefix.length; i++) prefix[i] = (i * 23 + (i >>> 6)) % 256;
    const tail = Buffer.from([3, 5, 7, 11, 13, 17, 19]);
    stream.write(prefix);
    stream.end(tail);
    expect(await prepared.ready).toBe(true);
    await expect(completed).resolves.toBeUndefined();
    const expected = Buffer.concat([prefix, tail]);
    expect(Buffer.concat(received).equals(expected)).toBe(true);
    expect(destination.writableFinished).toBe(true);
    expect(stream.readableEnded).toBe(true);
    expect(stream.listenerCount('readable')).toBe(0);
  });

  it('expires unused PCM and rejects sources whose clock expiry passed before the timer ran', async () => {
    const createSource = vi.fn(() => source());
    const preloader = createMusicStreamPreloader(createSource, { ttlMs: 1000 });
    const queue = {};
    preloader.prepare(queue, firstTrack);
    await vi.advanceTimersByTimeAsync(1000);
    expect(createSource.mock.results[0].value.destroyed).toBe(true);
    expect(preloader.take(queue, firstTrack)).toBeNull();
    preloader.prepare(queue, firstTrack);
    vi.setSystemTime(Date.now() + 1001);
    expect(preloader.take(queue, firstTrack)).toBeNull();
    expect(createSource.mock.results[1].value.destroyed).toBe(true);
  });

  it('handles startup failures without retries or unhandled errors and allows normal playback fallback', async () => {
    const createSource = vi.fn(() => source());
    const preloader = createMusicStreamPreloader(createSource);
    const queue = {};
    preloader.prepare(queue, firstTrack);
    const failed = createSource.mock.results[0].value;
    failed.destroy(new Error('YouTube source failed'));
    await flush();
    preloader.prepare(queue, firstTrack);
    expect(createSource).toHaveBeenCalledTimes(1);
    expect(preloader.take(queue, firstTrack)).toBeNull();
    // The retained handler also covers an unexpected late process error.
    expect(() => failed.emit('error', new Error('late process error'))).not.toThrow();
  });

  it('resolves an in-flight failure or explicit playback cancellation as not ready', async () => {
    const createSource = vi.fn(() => source());
    const preloader = createMusicStreamPreloader(createSource);
    const queue = {};
    preloader.prepare(queue, firstTrack);
    const failed = preloader.take(queue, firstTrack);
    failed.stream.destroy(new Error('start failed'));
    expect(await failed.ready).toBe(false);
    preloader.prepare(queue, nextTrack);
    const cancelled = preloader.take(queue, nextTrack);
    cancelled.cancel();
    expect(await cancelled.ready).toBe(false);
    expect(cancelled.stream.destroyed).toBe(true);
  });

  it('does not give playback a source that failed after its first frame had been buffered', async () => {
    const stream = source();
    const preloader = createMusicStreamPreloader(() => stream);
    const queue = {};
    preloader.prepare(queue, firstTrack);
    stream.write(Buffer.from([1, 2, 3, 4]));
    await flush();
    stream.destroy(new Error('HTTP stream failed after initial PCM'));
    await flush();
    expect(preloader.take(queue, firstTrack)).toBeNull();
  });

  it('handles synchronous creation failure and empty EOF without creating repeated background work', async () => {
    const createSource = vi.fn()
      .mockImplementationOnce(() => { throw new Error('missing runtime'); })
      .mockImplementation(() => {
        const stream = Readable.from([]);
        streams.push(stream);
        return stream;
      });
    const preloader = createMusicStreamPreloader(createSource);
    const queue = {};
    expect(() => preloader.prepare(queue, firstTrack)).not.toThrow();
    preloader.prepare(queue, firstTrack);
    expect(createSource).toHaveBeenCalledTimes(1);
    expect(preloader.take(queue, firstTrack)).toBeNull();
    preloader.prepare(queue, nextTrack);
    const empty = preloader.take(queue, nextTrack);
    expect(await empty.ready).toBe(false);
    expect(empty.stream.destroyed).toBe(true);
  });

  it('cancels stale preparation for a mismatched selection or an empty queue', () => {
    const createSource = vi.fn(() => source());
    const preloader = createMusicStreamPreloader(createSource);
    const queue = {};
    preloader.prepare(queue, firstTrack);
    expect(preloader.take(queue, nextTrack)).toBeNull();
    expect(createSource.mock.results[0].value.destroyed).toBe(true);
    preloader.prepare(queue, firstTrack);
    preloader.prepare(queue, null);
    expect(createSource.mock.results[1].value.destroyed).toBe(true);
    expect(preloader.take(queue, firstTrack)).toBeNull();
  });
});

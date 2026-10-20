import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMusicSourcePreloader } from '../src/services/musicSourcePreloader.js';

const firstTrack = { id: 'first', url: 'https://www.youtube.com/watch?v=first' };
const nextTrack = { id: 'next', url: 'https://www.youtube.com/watch?v=next' };
const sourceUrl = 'https://googlevideo.invalid/audio';
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('next-track source preparation', () => {
  it('coalesces repeated preparation while resolving and consumes the result only once', async () => {
    const pending = deferred();
    const resolveSource = vi.fn(() => pending.promise);
    const preloader = createMusicSourcePreloader(resolveSource);
    const queue = {};
    preloader.prepare(queue, firstTrack);
    await flush();
    preloader.prepare(queue, { ...firstTrack });
    await flush();
    expect(resolveSource).toHaveBeenCalledTimes(1);
    pending.resolve(sourceUrl);
    const prepared = preloader.take(queue, firstTrack);
    expect(await prepared.promise).toBe(sourceUrl);
    expect(preloader.take(queue, firstTrack)).toBeNull();
    prepared.cancel();
  });

  it('keeps just one next source per queue and aborts an obsolete track without affecting another queue', async () => {
    const jobs = [];
    const resolveSource = vi.fn((url, { signal }) => {
      const job = { ...deferred(), url, signal };
      jobs.push(job);
      return job.promise;
    });
    const preloader = createMusicSourcePreloader(resolveSource);
    const queueA = {};
    const queueB = {};
    preloader.prepare(queueA, firstTrack);
    preloader.prepare(queueB, firstTrack);
    await flush();
    preloader.prepare(queueA, nextTrack);
    await flush();
    expect(jobs).toHaveLength(3);
    expect(jobs[0].signal.aborted).toBe(true);
    expect(jobs[1].signal.aborted).toBe(false);
    expect(jobs[2].signal.aborted).toBe(false);
    // A late response from the cancelled job must never replace the new one.
    jobs[0].resolve('https://googlevideo.invalid/stale');
    jobs[1].resolve('https://googlevideo.invalid/other-queue');
    jobs[2].resolve('https://googlevideo.invalid/next');
    const next = preloader.take(queueA, nextTrack);
    const other = preloader.take(queueB, firstTrack);
    expect(await next.promise).toBe('https://googlevideo.invalid/next');
    expect(await other.promise).toBe('https://googlevideo.invalid/other-queue');
    next.cancel();
    other.cancel();
  });

  it('transfers cancellation ownership to playback when taking an in-flight source', async () => {
    const pending = deferred();
    let signal;
    const preloader = createMusicSourcePreloader((_url, options) => {
      signal = options.signal;
      return pending.promise;
    }, { ttlMs: 1000 });
    const queue = {};
    preloader.prepare(queue, firstTrack);
    await flush();
    const prepared = preloader.take(queue, firstTrack);
    preloader.cancel(queue);
    expect(signal.aborted).toBe(false);
    // The removed queue TTL must not cancel a source now owned by playback.
    await vi.advanceTimersByTimeAsync(1001);
    expect(signal.aborted).toBe(false);
    prepared.cancel();
    expect(signal.aborted).toBe(true);
    pending.resolve(sourceUrl);
    expect(await prepared.promise).toBeNull();
  });

  it('aborts pending preparation on queue cancellation and expires unconsumed sources', async () => {
    const signals = [];
    const resolveSource = vi.fn((_url, { signal }) => {
      signals.push(signal);
      return sourceUrl;
    });
    const preloader = createMusicSourcePreloader(resolveSource, { ttlMs: 1000 });
    const queue = {};
    preloader.prepare(queue, firstTrack);
    await flush();
    preloader.cancel(queue);
    expect(signals[0].aborted).toBe(true);
    expect(preloader.take(queue, firstTrack)).toBeNull();
    preloader.prepare(queue, firstTrack);
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(signals[1].aborted).toBe(true);
    expect(preloader.take(queue, firstTrack)).toBeNull();
  });

  it('rejects signed URLs inside the expiry safety window, including time spent awaiting a resolver', async () => {
    const pending = deferred();
    const preloader = createMusicSourcePreloader(() => pending.promise);
    const queue = {};
    preloader.prepare(queue, firstTrack);
    await flush();
    const prepared = preloader.take(queue, firstTrack);
    const expirySeconds = Math.floor(Date.now() / 1000) + 31;
    await vi.advanceTimersByTimeAsync(2000);
    pending.resolve(`${sourceUrl}?expire=${expirySeconds}`);
    expect(await prepared.promise).toBeNull();
    prepared.cancel();
  });

  it('rechecks signed URL freshness at consumption rather than returning an aged cached link', async () => {
    const expirySeconds = Math.floor(Date.now() / 1000) + 60;
    const preloader = createMusicSourcePreloader(() => `${sourceUrl}?expire=${expirySeconds}`);
    const queue = {};
    preloader.prepare(queue, firstTrack);
    await flush();
    await vi.advanceTimersByTimeAsync(30_001);
    expect(preloader.take(queue, firstTrack)).toBeNull();
  });

  it('settles prefetch rejection as a cache miss without an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const preloader = createMusicSourcePreloader(() => Promise.reject(new Error('temporary source failure')));
      const queue = {};
      preloader.prepare(queue, firstTrack);
      await flush();
      await flush();
      const prepared = preloader.take(queue, firstTrack);
      expect(await prepared.promise).toBeNull();
      expect(unhandled).not.toHaveBeenCalled();
      prepared.cancel();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('discards mismatched tracks and an empty next queue instead of reusing their source', async () => {
    const signals = [];
    const preloader = createMusicSourcePreloader((_url, { signal }) => {
      signals.push(signal);
      return sourceUrl;
    });
    const queue = {};
    preloader.prepare(queue, firstTrack);
    await flush();
    expect(preloader.take(queue, nextTrack)).toBeNull();
    expect(signals[0].aborted).toBe(true);
    preloader.prepare(queue, firstTrack);
    await flush();
    preloader.prepare(queue, null);
    expect(signals[1].aborted).toBe(true);
    expect(preloader.take(queue, firstTrack)).toBeNull();
  });
});

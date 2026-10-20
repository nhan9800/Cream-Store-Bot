// Prepare only the next source URL. No audio download, FFmpeg process or disk
// cache is kept while the current song plays.
export function createMusicSourcePreloader(resolveSource, { ttlMs = 300_000, now = Date.now } = {}) {
  const entries = new WeakMap();
  const keyFor = (track) => `${track?.id || ''}:${track?.url || ''}`;
  const cancel = (queue) => {
    const entry = entries.get(queue);
    if (!entry) return;
    entries.delete(queue);
    clearTimeout(entry.timer);
    entry.cancel();
  };
  const prepare = (queue, track) => {
    if (!track?.url) { cancel(queue); return; }
    const key = keyFor(track);
    const previous = entries.get(queue);
    if (previous?.key === key && previous.expiresAt > now()) return;
    cancel(queue);
    const controller = new AbortController();
    const entry = {
      key, expiresAt: now() + ttlMs, timer: null,
      cancel: () => controller.abort(),
      promise: null,
    };
    entries.set(queue, entry);
    // Prefetch errors are not playback failures and never skip a queued song.
    entry.promise = Promise.resolve().then(() => {
      if (controller.signal.aborted) return null;
      return resolveSource(track.url, { signal: controller.signal });
    }).then((url) => {
      if (!url || controller.signal.aborted) return null;
      // YouTube signed links can expire sooner than the local cache budget.
      const expiry = Number(new URL(url).searchParams.get('expire')) * 1000;
      if (expiry > 0) entry.expiresAt = Math.min(entry.expiresAt, expiry - 30_000);
      return entry.expiresAt > now() ? url : null;
    }).catch(() => null);
    entry.timer = setTimeout(() => {
      if (entries.get(queue) === entry) cancel(queue);
    }, ttlMs);
    entry.timer.unref?.();
  };
  const take = (queue, track) => {
    const entry = entries.get(queue);
    if (!entry) return null;
    if (entry.key !== keyFor(track) || entry.expiresAt <= now()) { cancel(queue); return null; }
    entries.delete(queue);
    clearTimeout(entry.timer);
    // Ownership moves to the active source, including cancellation of an
    // in-flight resolver when the user stops during a fast consecutive skip.
    return {
      cancel: entry.cancel,
      promise: entry.promise.then(url => entry.expiresAt > now() ? url : null),
    };
  };
  return { prepare, take, cancel };
}

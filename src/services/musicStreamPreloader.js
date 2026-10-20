// Keep one next PCM source paused and backpressured. The source owns its
// startup deadline and bounded buffers; preparation never consumes a byte.
export function createMusicStreamPreloader(createSource, { ttlMs = 300_000, now = Date.now } = {}) {
  const entries = new WeakMap();
  const keyFor = track => `${track?.id || ''}:${track?.url || ''}`;

  const cancel = queue => {
    const entry = entries.get(queue);
    if (!entry) return;
    entries.delete(queue);
    entry.cancel();
  };

  const prepare = (queue, track) => {
    if (!track?.url) { cancel(queue); return; }
    const key = keyFor(track);
    const previous = entries.get(queue);
    // Failed preparation is also deduplicated. Queue events must not start
    // retry loops or repeatedly request the same unavailable video.
    if (previous?.key === key && previous.expiresAt > now()) return;
    cancel(queue);

    let settled = false;
    let resolveReady;
    const entry = {
      key,
      expiresAt: now() + ttlMs,
      stream: null,
      failed: false,
      timer: null,
      ready: new Promise(resolve => { resolveReady = resolve; }),
      cancel: null,
    };
    const settle = value => {
      if (settled) return;
      settled = true;
      entry.stream?.removeListener('readable', onReadable);
      resolveReady(value);
    };
    const fail = () => {
      entry.failed = true;
      settle(false);
      if (entry.stream && !entry.stream.destroyed) entry.stream.destroy();
    };
    const onReadable = () => {
      if (!entry.stream.destroyed && entry.stream.readableLength > 0) settle(true);
      // An empty paused Readable needs a zero-byte read to emit its terminal
      // `end`. This neither consumes PCM nor switches the source to flowing.
      else if (!entry.stream.destroyed) entry.stream.read(0);
    };
    entry.cancel = () => {
      clearTimeout(entry.timer);
      fail();
    };
    entries.set(queue, entry);
    entry.timer = setTimeout(() => {
      if (entries.get(queue) === entry) cancel(queue);
    }, ttlMs);
    entry.timer.unref?.();

    try {
      entry.stream = createSource(track.url);
      // Keep the error listener for this stream's lifetime, including after
      // ownership transfer/close. A late child-process failure must remain
      // handled; the listener and entry are collected with the stream.
      entry.stream.on('error', fail);
      entry.stream.once('close', fail);
      entry.stream.once('end', fail);
      entry.stream.on('readable', onReadable);
      if (entry.stream.destroyed || entry.stream.readableEnded) fail();
      else onReadable();
    } catch {
      fail();
    }
  };

  const take = (queue, track) => {
    const entry = entries.get(queue);
    if (!entry) return null;
    if (entry.key !== keyFor(track) || entry.expiresAt <= now() || entry.failed
      || entry.stream?.destroyed || entry.stream?.readableEnded) {
      cancel(queue);
      return null;
    }
    entries.delete(queue);
    clearTimeout(entry.timer);
    // The queue can now prepare another source. Its timer and cancellation
    // cannot affect the source whose ownership moved into playback.
    return { stream: entry.stream, ready: entry.ready, cancel: entry.cancel };
  };

  return { prepare, take, cancel };
}

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuildQueueEvent } from 'discord-player';

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  createSource: vi.fn(),
  historyWrite: vi.fn(),
}));
vi.mock('../src/database/db.js', () => ({
  db: { prepare: () => ({ run: mocks.historyWrite }) },
}));
vi.mock('../src/services/youtubeDirectPcmStream.js', () => ({
  prepareYoutubeAudioUrl: mocks.prepare,
  createResilientYoutubePcmStream: mocks.createSource,
  YOUTUBE_DIRECT_STARTUP_TIMEOUT_MS: 45_000,
}));

import { MUSIC_FRAME_BYTES } from '../src/services/musicAudioPipeline.js';
import { musicQueueOptions, wirePlayerEvents } from '../src/services/musicPlayerService.js';

const sources = [];
const queues = [];
const flush = () => new Promise(resolve => setImmediate(resolve));
const track = id => ({
  id, title: id, url: `https://www.youtube.com/watch?v=${id}`, durationMS: 180_000,
});
let queueId = 0;

function harness() {
  const pending = [track('next'), track('later')];
  const events = new EventEmitter();
  const queue = {
    guild: { id: `preload-${++queueId}`, name: 'Test' },
    currentTrack: track('playing'),
    isShuffling: false,
    tracks: { at: index => pending[index], toArray: () => [...pending] },
    dispatcher: {
      voiceConnection: {
        state: { status: 'ready', networking: { state: { dave: null } } },
      },
    },
  };
  wirePlayerEvents({ events });
  queues.push({ queue, events });
  return { queue, pending, events };
}
function createStream(queue, selected) {
  const options = musicQueueOptions({ defaultVolume: 80, maxQueueSize: 50 }, null, 'Test');
  return options.onBeforeCreateStream(selected, null, queue);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.stubEnv('MUSIC_YOUTUBE_STREAM_MODE', 'direct');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  sources.length = 0;
  queues.length = 0;
  mocks.historyWrite.mockReset();
  mocks.prepare.mockReset().mockResolvedValue('https://googlevideo.invalid/prepared');
  mocks.createSource.mockReset().mockImplementation(() => {
    const source = new PassThrough();
    sources.push(source);
    return source;
  });
});
afterEach(async () => {
  for (const { queue, events } of queues) {
    queue.dispatcher.voiceConnection.state.status = 'destroyed';
    events.emit(GuildQueueEvent.QueueDelete, queue);
  }
  for (const source of sources) source.destroy();
  await flush();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('music next-track preparation integration', () => {
  it('primes the exact next track once when playback starts and ignores additions behind it', async () => {
    const { queue, pending, events } = harness();
    events.emit(GuildQueueEvent.PlayerStart, queue, queue.currentTrack);
    await flush();
    pending.push(track('last'));
    events.emit(GuildQueueEvent.AudioTracksAdd, queue, [pending.at(-1)]);
    events.emit(GuildQueueEvent.PlayerStart, queue, queue.currentTrack);
    await flush();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.prepare.mock.calls[0][0]).toBe(pending[0].url);
    expect(mocks.prepare.mock.calls[0][1].signal.aborted).toBe(false);
    // URL preparation never starts an audio decoder or downloads PCM itself.
    expect(mocks.createSource).not.toHaveBeenCalled();
  });

  it('replaces preparation when queue edits change the next track and cancels it when no track remains', async () => {
    const { queue, pending, events } = harness();
    events.emit(GuildQueueEvent.PlayerStart, queue, queue.currentTrack);
    await flush();
    const oldSignal = mocks.prepare.mock.calls[0][1].signal;
    pending.shift();
    events.emit(GuildQueueEvent.AudioTrackRemove, queue);
    await flush();
    expect(oldSignal.aborted).toBe(true);
    expect(mocks.prepare.mock.calls[1][0]).toBe(pending[0].url);
    const secondSignal = mocks.prepare.mock.calls[1][1].signal;
    pending.unshift(track('inserted'));
    events.emit(GuildQueueEvent.AudioTrackAdd, queue, pending[0]);
    await flush();
    expect(secondSignal.aborted).toBe(true);
    expect(mocks.prepare.mock.calls[2][0]).toBe(pending[0].url);
    const lastSignal = mocks.prepare.mock.calls[2][1].signal;
    pending.length = 0;
    events.emit(GuildQueueEvent.AudioTrackRemove, queue);
    await flush();
    expect(lastSignal.aborted).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledTimes(3);
  });

  it('does not guess a track for dynamic shuffle and cancels an existing guess when shuffle becomes active', async () => {
    const { queue, events } = harness();
    queue.isShuffling = true;
    events.emit(GuildQueueEvent.PlayerStart, queue, queue.currentTrack);
    await flush();
    expect(mocks.prepare).not.toHaveBeenCalled();
    queue.isShuffling = false;
    events.emit(GuildQueueEvent.AudioTrackAdd, queue);
    await flush();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    const signal = mocks.prepare.mock.calls[0][1].signal;
    queue.isShuffling = true;
    events.emit(GuildQueueEvent.AudioTrackAdd, queue);
    await flush();
    expect(signal.aborted).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });

  it('consumes the prepared source once through the actual stream hook and preserves its first PCM frame', async () => {
    const { queue, pending, events } = harness();
    events.emit(GuildQueueEvent.PlayerStart, queue, queue.currentTrack);
    await flush();
    const next = pending.shift();
    queue.currentTrack = next;
    const opening = createStream(queue, next);
    const preparedSource = mocks.createSource.mock.calls[0][1].preparedSource;
    expect(await preparedSource.promise).toBe('https://googlevideo.invalid/prepared');
    expect(mocks.createSource.mock.calls[0][0]).toBe(next.url);
    const pcm = Buffer.alloc(MUSIC_FRAME_BYTES, 21);
    sources[0].write(pcm);
    const resource = await opening;
    expect(resource.$fmt).toBe('raw');
    expect(resource.stream.read(MUSIC_FRAME_BYTES).equals(pcm)).toBe(true);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    resource.stream.destroy();

    const retry = createStream(queue, next);
    expect(mocks.createSource.mock.calls[1][1].preparedSource).toBeNull();
    sources[1].write(pcm);
    const freshResource = await retry;
    freshResource.stream.destroy();
  });

  it('resolves audio while DAVE negotiates but does not hand PCM to playback before encryption is ready', async () => {
    const { queue, pending } = harness();
    const dave = { lastTransitionId: undefined, reinitializing: false };
    queue.dispatcher.voiceConnection.state.networking.state.dave = dave;
    let returned = false;
    const opening = createStream(queue, pending[0]).then(value => { returned = true; return value; });
    // Source starts immediately while the encryption session is still pending.
    expect(mocks.createSource).toHaveBeenCalledTimes(1);
    sources[0].write(Buffer.alloc(MUSIC_FRAME_BYTES, 17));
    await flush();
    await vi.advanceTimersByTimeAsync(250);
    expect(returned).toBe(false);
    expect(sources[0].destroyed).toBe(false);
    dave.lastTransitionId = 0;
    await vi.advanceTimersByTimeAsync(50);
    const resource = await opening;
    expect(returned).toBe(true);
    expect(resource.stream.readableLength).toBe(MUSIC_FRAME_BYTES);
    resource.stream.destroy();
  });

  it.each([false, true])('cancels a pending source on QueueDelete (first PCM already received: %s)', async (hasPcm) => {
    const { queue, pending, events } = harness();
    const dave = { lastTransitionId: undefined, reinitializing: false };
    queue.dispatcher.voiceConnection.state.networking.state.dave = dave;
    const opening = createStream(queue, pending[0]);
    const result = opening.then(value => ({ value }), error => ({ error }));
    if (hasPcm) sources[0].write(Buffer.alloc(MUSIC_FRAME_BYTES, 3));
    await flush();
    events.emit(GuildQueueEvent.QueueDelete, queue);
    await flush();
    expect(sources[0].destroyed).toBe(true);
    // A late DAVE commit must not resurrect a cancelled, already-buffered track.
    dave.lastTransitionId = 0;
    await vi.advanceTimersByTimeAsync(50);
    expect((await result).error).toBeInstanceOf(Error);
    expect(mocks.createSource).toHaveBeenCalledTimes(1);
  });
});

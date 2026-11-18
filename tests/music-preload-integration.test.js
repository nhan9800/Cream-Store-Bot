import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuildQueueEvent, Track } from 'discord-player';

const mocks = vi.hoisted(() => ({
  createSource: vi.fn(),
  getPcmDetails: vi.fn(),
  historyWrite: vi.fn(),
}));
vi.mock('../src/database/db.js', () => ({
  db: { prepare: () => ({ run: mocks.historyWrite }) },
}));
vi.mock('../src/services/youtubeDirectPcmStream.js', () => ({
  createResilientYoutubePcmStream: mocks.createSource,
  getYoutubePcmDetails: mocks.getPcmDetails,
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
  mocks.getPcmDetails.mockReset().mockReturnValue({ durationSeconds: null, route: 'direct' });
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
    expect(mocks.createSource).toHaveBeenCalledTimes(1);
    expect(mocks.createSource.mock.calls[0]).toEqual([pending[0].url, { bufferedBytes: 256 * 1024 }]);
    expect(sources[0].destroyed).toBe(false);
    expect(sources[0].readableFlowing).not.toBe(true);
  });

  it('replaces preparation when queue edits change the next track and cancels it when no track remains', async () => {
    const { queue, pending, events } = harness();
    events.emit(GuildQueueEvent.PlayerStart, queue, queue.currentTrack);
    await flush();
    const oldSource = sources[0];
    pending.shift();
    events.emit(GuildQueueEvent.AudioTrackRemove, queue);
    await flush();
    expect(oldSource.destroyed).toBe(true);
    expect(mocks.createSource.mock.calls[1][0]).toBe(pending[0].url);
    const secondSource = sources[1];
    pending.unshift(track('inserted'));
    events.emit(GuildQueueEvent.AudioTrackAdd, queue, pending[0]);
    await flush();
    expect(secondSource.destroyed).toBe(true);
    expect(mocks.createSource.mock.calls[2][0]).toBe(pending[0].url);
    const lastSource = sources[2];
    pending.length = 0;
    events.emit(GuildQueueEvent.AudioTrackRemove, queue);
    await flush();
    expect(lastSource.destroyed).toBe(true);
    expect(mocks.createSource).toHaveBeenCalledTimes(3);
  });

  it('does not guess a track for dynamic shuffle and cancels an existing guess when shuffle becomes active', async () => {
    const { queue, events } = harness();
    queue.isShuffling = true;
    events.emit(GuildQueueEvent.PlayerStart, queue, queue.currentTrack);
    await flush();
    expect(mocks.createSource).not.toHaveBeenCalled();
    queue.isShuffling = false;
    events.emit(GuildQueueEvent.AudioTrackAdd, queue);
    await flush();
    expect(mocks.createSource).toHaveBeenCalledTimes(1);
    const source = sources[0];
    queue.isShuffling = true;
    events.emit(GuildQueueEvent.AudioTrackAdd, queue);
    await flush();
    expect(source.destroyed).toBe(true);
    expect(mocks.createSource).toHaveBeenCalledTimes(1);
  });

  it('consumes the prepared source once through the actual stream hook and preserves its first PCM frame', async () => {
    const { queue, pending, events } = harness();
    events.emit(GuildQueueEvent.PlayerStart, queue, queue.currentTrack);
    await flush();
    const pcm = Buffer.alloc(MUSIC_FRAME_BYTES, 21);
    sources[0].write(pcm);
    await flush();
    const next = pending.shift();
    queue.currentTrack = next;
    const opening = createStream(queue, next);
    expect(mocks.createSource.mock.calls[0][0]).toBe(next.url);
    const resource = await opening;
    expect(resource.$fmt).toBe('raw');
    expect(resource.stream.read(MUSIC_FRAME_BYTES).equals(pcm)).toBe(true);
    expect(mocks.createSource).toHaveBeenCalledTimes(1);
    resource.stream.destroy();

    const retry = createStream(queue, next);
    expect(mocks.createSource.mock.calls[1]).toEqual([next.url]);
    sources[1].write(pcm);
    const freshResource = await retry;
    freshResource.stream.destroy();
  });

  it('takes the prepared source duration into Discord Player and history before recording playback', async () => {
    const { queue, pending, events } = harness();
    const next = new Track({ nodes: { cache: [] } }, { ...pending[0], duration: '0:00', source: 'youtube' });
    pending[0] = next;
    events.emit(GuildQueueEvent.PlayerStart, queue, queue.currentTrack);
    await flush();
    mocks.getPcmDetails.mockReturnValue({ durationSeconds: 3723, route: 'authenticated-pipe' });
    sources[0].write(Buffer.alloc(MUSIC_FRAME_BYTES, 40));
    queue.currentTrack = pending.shift();

    const resource = await createStream(queue, next);

    expect(mocks.getPcmDetails).toHaveBeenCalledOnce();
    expect(mocks.getPcmDetails).toHaveBeenCalledWith(sources[0]);
    expect(next.duration).toBe('1:02:03');
    expect(next.durationMS).toBe(3_723_000);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('route=authenticated-pipe;'));
    events.emit(GuildQueueEvent.PlayerStart, queue, next);
    expect(mocks.historyWrite.mock.calls.at(-1)[6]).toBe(3_723_000);
    resource.stream.destroy();
  });

  it.each([[null, false], [Infinity, false], [120, true]])(
    'does not replace a known duration with invalid data or a live source (%s, live=%s)',
    async (seconds, live) => {
      const { queue, pending } = harness();
      const next = { ...pending[0], duration: '3:00', live };
      mocks.getPcmDetails.mockReturnValue({ durationSeconds: seconds, route: 'direct' });
      const opening = createStream(queue, next);
      sources[0].write(Buffer.alloc(MUSIC_FRAME_BYTES, 45));
      const resource = await opening;

      expect(next.duration).toBe('3:00');
      resource.stream.destroy();
    },
  );

  it('falls back to a fresh source if background preparation failed, without dropping the track', async () => {
    const { queue, pending, events } = harness();
    events.emit(GuildQueueEvent.PlayerStart, queue, queue.currentTrack);
    sources[0].destroy(new Error('YouTube rejected background attempt'));
    await flush();
    const next = pending.shift();
    queue.currentTrack = next;
    const opening = createStream(queue, next);
    expect(mocks.createSource.mock.calls[1]).toEqual([next.url]);
    sources[1].write(Buffer.alloc(MUSIC_FRAME_BYTES, 23));
    const resource = await opening;
    expect(resource.stream.read(MUSIC_FRAME_BYTES)[0]).toBe(23);
    resource.stream.destroy();
  });

  it('resolves audio while DAVE negotiates but does not hand PCM to playback before encryption is ready', async () => {
    const { queue, pending } = harness();
    const dave = { protocolVersion: 1, lastTransitionId: undefined, reinitializing: false, session: { ready: false } };
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
    expect(returned).toBe(false);
    dave.session.ready = true;
    await vi.advanceTimersByTimeAsync(50);
    const resource = await opening;
    expect(returned).toBe(true);
    expect(resource.stream.readableLength).toBe(MUSIC_FRAME_BYTES);
    resource.stream.destroy();
  });

  it.each([false, true])('cancels a pending source on QueueDelete (first PCM already received: %s)', async (hasPcm) => {
    const { queue, pending, events } = harness();
    events.emit(GuildQueueEvent.PlayerStart, queue, queue.currentTrack);
    const dave = { protocolVersion: 1, lastTransitionId: undefined, reinitializing: false, session: { ready: false } };
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
    dave.session.ready = true;
    await vi.advanceTimersByTimeAsync(50);
    expect((await result).error).toBeInstanceOf(Error);
    expect(mocks.createSource).toHaveBeenCalledTimes(1);
  });
});

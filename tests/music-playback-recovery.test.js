import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuildQueueEvent, GuildQueuePlayerNode } from 'discord-player';
import {
  clearMusicRecovery, getMusicRecovery, ignoreMusicPlaybackFinish, noteMusicPlaybackFailure,
  noteMusicPlaybackFinish, noteMusicPlaybackStart, restoreMusicQueue,
} from '../src/services/musicPlaybackRecovery.js';

vi.mock('../src/database/db.js', () => ({ db: { prepare: () => ({ run: vi.fn() }) } }));
import { waitForMusicPcmReadable, wirePlayerEvents } from '../src/services/musicPlayerService.js';

const track = (id) => ({ id, title: id, url: `https://youtube.com/watch?v=${id}`, durationMS: 180_000 });
function harness(tracks = ['one', 'two', 'three', 'four'].map(track)) {
  let pending = [...tracks];
  const events = new EventEmitter();
  const queue = {
    guild: { id: 'breaker', name: 'Test' }, options: { leaveOnEnd: true }, repeatMode: 2,
    channel: { id: 'voice' }, player: { scanDeps: () => '' },
    tracks: {
      toArray: () => [...pending], clear: () => { pending = []; },
      dispatch: () => pending.shift(), add: (items) => pending.push(...items),
    },
    setRepeatMode(mode) { this.repeatMode = mode; },
    dispatcher: { voiceConnection: {}, emit: vi.fn() },
    emit: (...args) => events.emit(...args),
    onBeforeCreateStream: vi.fn(async () => { throw new Error('source temporarily unavailable'); }),
  };
  // This is the installed discord-player node, including its actual private
  // #throw -> PlayerSkip -> PlayerError -> dispatch-next control flow.
  queue.node = new GuildQueuePlayerNode(queue);
  wirePlayerEvents({ events });
  return { queue, events };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('music playback circuit breaker', () => {
  it('halts the real library skip chain after two failures and retains the entire accepted playlist', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { queue } = harness();
    await queue.node.play(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.onBeforeCreateStream).toHaveBeenCalledTimes(2);
    expect(queue.tracks.toArray()).toEqual([]);
    expect(getMusicRecovery(queue)).toMatchObject({ blocked: true, consecutiveFailures: 2 });
    expect(getMusicRecovery(queue).tracks.map((item) => item.id)).toEqual(['one', 'two', 'three', 'four']);
    expect(queue.repeatMode).toBe(0);
    expect(queue.options.leaveOnEnd).toBe(false);
    expect(queue.dispatcher.emit).toHaveBeenCalledWith('finish', null);

    expect(restoreMusicQueue(queue)).toBe(true);
    expect(restoreMusicQueue(queue)).toBe(false);
    expect(queue.tracks.toArray().map((item) => item.id)).toEqual(['one', 'two', 'three', 'four']);
    expect(queue.repeatMode).toBe(2);
    expect(queue.options.leaveOnEnd).toBe(true);
    await queue.node.play(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(queue.onBeforeCreateStream).toHaveBeenCalledTimes(4);
    expect(getMusicRecovery(queue).tracks).toHaveLength(4);
  });

  it('holds immediately for a shared Discord/DAVE connection failure', () => {
    const { queue } = harness([track('next')]);
    noteMusicPlaybackFailure(queue, track('failed'), new Error('Discord DAVE/MLS chưa sẵn sàng'));
    expect(getMusicRecovery(queue)).toMatchObject({ blocked: true, consecutiveFailures: 1 });
    expect(getMusicRecovery(queue).message).toMatch(/quyền Kết nối\/Nói/);
  });

  it('does not count PlayerStart or a long pause as healthy playback', () => {
    const { queue } = harness([]);
    const first = track('one'); const second = track('two');
    noteMusicPlaybackFailure(queue, first, 'source failed');
    noteMusicPlaybackStart(queue, second);
    queue.dispatcher.audioResource = { metadata: second, playbackDuration: 100 };
    noteMusicPlaybackFinish(queue, second);
    expect(getMusicRecovery(queue).blocked).toBe(true);
    expect(getMusicRecovery(queue).tracks.map((item) => item.id)).toEqual(['one', 'two']);
  });

  it('resets the streak only after sustained audio and excludes deliberate skips', () => {
    const { queue } = harness([]);
    noteMusicPlaybackFailure(queue, track('first'), 'failed');
    const healthy = track('healthy');
    noteMusicPlaybackStart(queue, healthy);
    queue.dispatcher.audioResource = { metadata: healthy, playbackDuration: 8_000 };
    noteMusicPlaybackFinish(queue, healthy);
    expect(getMusicRecovery(queue).consecutiveFailures).toBe(0);
    const manual = track('manual');
    noteMusicPlaybackStart(queue, manual);
    queue.dispatcher.audioResource = { metadata: manual, playbackDuration: 100 };
    ignoreMusicPlaybackFinish(queue);
    noteMusicPlaybackFinish(queue, manual);
    expect(getMusicRecovery(queue).consecutiveFailures).toBe(0);
    noteMusicPlaybackFailure(queue, track('later'), 'failed');
    expect(getMusicRecovery(queue).blocked).toBe(false);
  });

  it.each(['skip', 'stop'])('ignores premature-close teardown from a deliberate %s', (action) => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { queue, events } = harness([track('next')]);
    const playing = track('manual');
    queue.currentTrack = playing;
    queue.dispatcher.audioResource = { metadata: playing, playbackDuration: 100 };
    queue.setTransitioning = vi.fn();
    queue.history = { clear: vi.fn() };
    queue.dispatcher.destroy = vi.fn();
    queue.dispatcher.end = () => {
      events.emit(GuildQueueEvent.Error, queue, Object.assign(new Error('Premature close'), {
        code: 'ERR_STREAM_PREMATURE_CLOSE', resource: queue.dispatcher.audioResource,
      }));
      events.emit(GuildQueueEvent.PlayerFinish, queue, playing);
    };
    noteMusicPlaybackFailure(queue, track('earlier-failure'), 'source temporarily failed');
    events.emit(GuildQueueEvent.PlayerStart, queue, playing);
    // Mirror the intentional-cancellation marker in controlMusic, then run
    // the real discord-player control method and its teardown event order.
    if (action === 'skip') {
      ignoreMusicPlaybackFinish(queue);
      queue.node.skip();
    } else {
      clearMusicRecovery(queue);
      queue.node.stop(true);
    }
    expect(getMusicRecovery(queue).blocked).toBe(false);
    expect(getMusicRecovery(queue).consecutiveFailures).toBe(action === 'skip' ? 1 : 0);
  });

  it('still counts an unexpected premature close of an active track', () => {
    const { queue } = harness([track('next')]);
    const playing = track('active');
    noteMusicPlaybackFailure(queue, track('earlier-failure'), 'source temporarily failed');
    noteMusicPlaybackStart(queue, playing);
    queue.dispatcher.audioResource = { metadata: playing, playbackDuration: 100 };
    noteMusicPlaybackFailure(queue, playing, Object.assign(new Error('Premature close'), {
      code: 'ERR_STREAM_PREMATURE_CLOSE',
    }));
    expect(getMusicRecovery(queue)).toMatchObject({ blocked: true, consecutiveFailures: 2 });
  });
});

describe('music first PCM guard', () => {
  it('rejects an already closed or empty-closing source immediately', async () => {
    const destroyed = new PassThrough();
    destroyed.destroy();
    await expect(waitForMusicPcmReadable(destroyed)).rejects.toThrow(/đã đóng/);
    const source = new PassThrough();
    const waiting = waitForMusicPcmReadable(source);
    const rejected = expect(waiting).rejects.toThrow(/âm thanh đầu tiên/);
    source.destroy();
    await rejected;
    expect(source.listenerCount('readable')).toBe(0);
    expect(source.listenerCount('close')).toBe(0);
  });

  it('ignores an empty readable signal and waits for actual bytes', async () => {
    const source = new PassThrough();
    const waiting = waitForMusicPcmReadable(source);
    let ready = false;
    waiting.then(() => { ready = true; });
    source.emit('readable');
    await Promise.resolve();
    expect(ready).toBe(false);
    source.write(Buffer.alloc(3840));
    await waiting;
    expect(source.listenerCount('readable')).toBe(0);
    source.destroy();
  });
});

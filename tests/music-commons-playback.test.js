import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuildQueueEvent, GuildQueuePlayerNode } from 'discord-player';

const mocks = vi.hoisted(() => ({
  commonsSource: vi.fn(),
  youtubeSource: vi.fn(),
  historyWrite: vi.fn(),
}));

vi.mock('../src/database/db.js', () => ({
  db: { prepare: (sql) => ({ run: (...args) => mocks.historyWrite(sql, ...args) }) },
}));
vi.mock('../src/services/musicCommonsStream.js', async (importOriginal) => ({
  ...await importOriginal(),
  createMusicCommonsPcmStream: mocks.commonsSource,
}));
vi.mock('../src/services/youtubeDirectPcmStream.js', () => ({
  createResilientYoutubePcmStream: mocks.youtubeSource,
  YOUTUBE_DIRECT_STARTUP_TIMEOUT_MS: 45_000,
}));

import { MUSIC_FRAME_BYTES } from '../src/services/musicAudioPipeline.js';
import { buildMusicAddedMessage, enqueueMusicCommons, musicQueueOptions, wirePlayerEvents } from '../src/services/musicPlayerService.js';
import { getMusicRecovery, noteMusicPlaybackFailure } from '../src/services/musicPlaybackRecovery.js';

const requester = { id: '345678901234567890', username: 'Listener' };
const textChannelId = '234567890123456781';
const frame = Buffer.alloc(MUSIC_FRAME_BYTES, 12);
const commonsRecording = {
  url: 'https://upload.wikimedia.org/wikipedia/commons/8/8f/Fur_Elise.ogg',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:Fur_Elise.ogg',
  title: 'Für Elise', artist: 'Sebion7125', format: 'ogg', size: 2_892_038,
  license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/',
};
const streams = [];
let guildId = 123456789012345680n;

function youtubeTrack(id) {
  return { id, title: id, url: `https://www.youtube.com/watch?v=${id}`, durationMS: 180_000 };
}

function makeStream() {
  const stream = new PassThrough();
  streams.push(stream);
  return stream;
}

function makeQueue({ currentTrack = null, maxQueueSize = 10, existing = true, pending = [] } = {}) {
  const guild = { id: String(guildId++), name: 'Wikimedia Commons tests' };
  const voiceChannel = { id: '111111111111111111', name: 'Audio', members: [{ user: { bot: false } }] };
  const settings = { defaultVolume: 80, maxQueueSize };
  const player = {
    events: new EventEmitter(),
    options: { skipFFmpeg: true },
    scanDeps: () => '',
    search: vi.fn(),
    extractors: { context: { provide: vi.fn() } },
    nodes: {
      get: vi.fn(() => existing ? queue : null),
      create: vi.fn((_guild, options) => {
        existing = true;
        queue.options = options;
        queue.onBeforeCreateStream = options.onBeforeCreateStream;
        return queue;
      }),
    },
  };
  const options = musicQueueOptions(settings, textChannelId, 'Discord');
  const queue = {
    guild,
    player,
    options,
    onBeforeCreateStream: options.onBeforeCreateStream,
    channel: existing ? voiceChannel : null,
    currentTrack,
    filters: { _lastFiltersCache: {}, ffmpeg: { args: [] } },
    get size() { return pending.length; },
    tracks: {
      at: (index) => pending[index],
      dispatch: () => pending.shift(),
      toArray: () => [...pending],
      clear: () => pending.splice(0),
    },
    tasksQueue: { acquire: () => ({ getTask: async () => {} }), release: vi.fn() },
    connect: vi.fn(async (channel) => { queue.channel = channel; }),
    addTrack: vi.fn((tracks) => {
      pending.push(...tracks);
      player.events.emit(GuildQueueEvent.AudioTracksAdd, queue);
    }),
    setMaxSize: vi.fn(),
    setRepeatMode: vi.fn(),
    setTransitioning: vi.fn(),
    emit: (...args) => player.events.emit(...args),
    dispatcher: {
      voiceConnection: { state: { status: 'ready', networking: { state: {
        dave: { protocolVersion: 1, lastTransitionId: 0, reinitializing: false, session: { ready: true } },
      } } } },
      isPlaying: () => Boolean(queue.currentTrack),
      isBuffering: () => false,
      isPaused: () => false,
      createStream: vi.fn(async (stream, config) => ({ stream, metadata: config.data })),
      playStream: vi.fn(async (resource) => {
        queue.currentTrack = resource.metadata;
        queue.dispatcher.audioResource = resource;
        player.events.emit(GuildQueueEvent.PlayerStart, queue, resource.metadata);
      }),
      emit: vi.fn(),
    },
  };
  queue.node = new GuildQueuePlayerNode(queue);
  wirePlayerEvents(player);
  const add = (source = commonsRecording) => enqueueMusicCommons({
    player, guild, voiceChannel, source, requestedBy: requester, textChannelId,
    getSettings: () => settings, stabilizationMs: 0,
  });

  return { guild, voiceChannel, player, queue, pending, add };
}

beforeEach(() => {
  mocks.youtubeSource.mockReset();
  mocks.historyWrite.mockClear();
  mocks.commonsSource.mockReset().mockImplementation(() => {
    const stream = makeStream();
    stream.write(frame);
    return stream;
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  for (const stream of streams.splice(0)) stream.destroy();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Cenar Music Wikimedia queue', () => {
  it('queues a licensed recording and exposes the public page and credits', async () => {
    const currentTrack = youtubeTrack('current');
    const h = makeQueue({ currentTrack });
    const result = await h.add();
    expect(h.queue.currentTrack).toBe(currentTrack);
    expect(h.pending.map((item) => item.id)).toEqual([result.track.id]);
    expect(result.track).toMatchObject({ source: 'commons', author: 'Sebion7125', url: commonsRecording.pageUrl });
    expect(buildMusicAddedMessage(result)).toContain(commonsRecording.licenseUrl);
    expect(buildMusicAddedMessage(result)).toContain(commonsRecording.pageUrl);
    expect(mocks.youtubeSource).not.toHaveBeenCalled();
    expect(mocks.commonsSource).not.toHaveBeenCalled();
  });

  it.each(['direct', 'extractor'])('starts with DAVE in %s mode and saves elapsed history against the public page', async (mode) => {
    vi.stubEnv('MUSIC_YOUTUBE_STREAM_MODE', mode);
    const h = makeQueue({ existing: false });
    const result = await h.add();
    expect(h.queue.connect).toHaveBeenCalledWith(h.voiceChannel, expect.objectContaining({ daveEncryption: true }));
    expect(h.queue.dispatcher.audioResource.stream.read(MUSIC_FRAME_BYTES)).toEqual(frame);
    expect(mocks.commonsSource).toHaveBeenCalledWith(expect.objectContaining({ url: commonsRecording.url }));
    expect(mocks.youtubeSource).not.toHaveBeenCalled();
    expect(h.player.extractors.context.provide).not.toHaveBeenCalled();
    h.queue.dispatcher.audioResource.playbackDuration = 176_580;
    h.player.events.emit(GuildQueueEvent.PlayerFinish, h.queue, h.queue.currentTrack);
    expect(mocks.historyWrite).toHaveBeenCalledWith(expect.stringContaining('AND track_id = ?'),
      'COMPLETED', null, 176_580, h.guild.id, result.track.id);
    expect(JSON.stringify([result, mocks.historyWrite.mock.calls])).not.toContain(commonsRecording.url);
  });

  it('skips a failed recording without parking the next song under a YouTube error', async () => {
    const h = makeQueue({ currentTrack: youtubeTrack('current') });
    await h.add();
    const next = await h.add();
    h.queue.currentTrack = null;
    mocks.commonsSource.mockImplementationOnce(() => {
      const stream = makeStream();
      queueMicrotask(() => stream.destroy(new Error('Wikimedia Commons: HTTP 429')));
      return stream;
    });
    const playerStarted = once(h.player.events, GuildQueueEvent.PlayerStart);
    await h.queue.node.play(null);
    const [, playing] = await playerStarted;
    expect(playing.id).toBe(next.track.id);
    expect(getMusicRecovery(h.queue).blocked).toBe(false);
  });

  it.each([
    ['different track', { id: 'different-track' }, 12_020],
    ['infinite counter', undefined, Infinity],
    ['missing counter', undefined, undefined],
  ])('does not store the counter from %s', async (_label, metadata, playbackDuration) => {
    const h = makeQueue({ existing: false });
    await h.add();
    const track = h.queue.currentTrack;
    Object.assign(h.queue.dispatcher.audioResource, { metadata: metadata ?? track, playbackDuration });

    h.player.events.emit(GuildQueueEvent.PlayerFinish, h.queue, track);

    expect(mocks.historyWrite).toHaveBeenCalledWith(expect.stringContaining('AND track_id = ?'),
      'COMPLETED', null, null, h.guild.id, track.id);
  });

  it('preserves queue capacity and holds created by an existing source failure', async () => {
    const old = youtubeTrack('old');
    const h = makeQueue({ currentTrack: youtubeTrack('current'), maxQueueSize: 1, pending: [old] });
    await expect(h.add()).rejects.toThrow(/hàng đợi chỉ còn 0 chỗ/);
    expect(h.pending).toEqual([old]);
    expect(h.queue.addTrack).not.toHaveBeenCalled();

    noteMusicPlaybackFailure(h.queue, h.queue.currentTrack, new Error('Discord DAVE chưa sẵn sàng.'));
    const held = getMusicRecovery(h.queue);
    expect(held.tracks.map((track) => track.id)).toEqual(['current', 'old']);
    await expect(h.add()).rejects.toThrow(/Hàng đợi đã được giữ lại/);
    expect(getMusicRecovery(h.queue)).toEqual(held);
    expect(mocks.commonsSource).not.toHaveBeenCalled();
  });
});

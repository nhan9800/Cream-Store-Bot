import { EventEmitter, once } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuildQueueEvent, GuildQueuePlayerNode } from 'discord-player';

const mocks = vi.hoisted(() => ({
  attachmentSource: vi.fn(),
  youtubeSource: vi.fn(),
  historyWrite: vi.fn(),
}));

vi.mock('../src/database/db.js', () => ({
  db: { prepare: (sql) => ({ run: (...args) => mocks.historyWrite(sql, ...args) }) },
}));
vi.mock('../src/services/musicAttachmentStream.js', async (importOriginal) => ({
  ...await importOriginal(),
  createMusicAttachmentPcmStream: mocks.attachmentSource,
}));
vi.mock('../src/services/youtubeDirectPcmStream.js', () => ({
  createResilientYoutubePcmStream: mocks.youtubeSource,
  YOUTUBE_DIRECT_STARTUP_TIMEOUT_MS: 45_000,
}));

import { MUSIC_FRAME_BYTES } from '../src/services/musicAudioPipeline.js';
import { enqueueMusicAttachment, musicQueueOptions, wirePlayerEvents } from '../src/services/musicPlayerService.js';
import { getMusicRecovery, noteMusicPlaybackFailure } from '../src/services/musicPlaybackRecovery.js';

const requester = { id: '345678901234567890', username: 'Listener' };
const textChannelId = '234567890123456781';
const marker = 'private-fixture-signature';
const frame = Buffer.alloc(MUSIC_FRAME_BYTES, 12);
const streams = [];
let guildId = 123456789012345680n;

function file(name = 'sample.mp3', id = '234567890123456780') {
  return { id, name, size: 100, url: `https://cdn.discordapp.com/attachments/${textChannelId}/${id}/${name}?hm=${marker}` };
}

function youtubeTrack(id) {
  return { id, title: id, url: `https://www.youtube.com/watch?v=${id}`, durationMS: 180_000 };
}

function makeStream() {
  const stream = new PassThrough();
  streams.push(stream);
  return stream;
}

function makeQueue({ currentTrack = null, maxQueueSize = 10, existing = true, pending = [] } = {}) {
  const guild = { id: String(guildId++), name: 'Attachment tests' };
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
  const add = (attachment) => enqueueMusicAttachment({
    player, guild, voiceChannel, attachment, requestedBy: requester, textChannelId,
    getSettings: () => settings, stabilizationMs: 0,
  });

  return { guild, voiceChannel, player, queue, pending, add };
}

beforeEach(() => {
  mocks.youtubeSource.mockReset();
  mocks.historyWrite.mockClear();
  mocks.attachmentSource.mockReset().mockImplementation(() => {
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

describe('Cenar Music Discord attachment queue', () => {
  it.each(['direct', 'extractor'])('starts file PCM with DAVE and no YouTube fallback in %s mode', async (mode) => {
    vi.stubEnv('MUSIC_YOUTUBE_STREAM_MODE', mode);
    const h = makeQueue({ existing: false });
    const attachment = file();

    const result = await h.add(attachment);

    expect(h.queue.connect).toHaveBeenCalledWith(h.voiceChannel, expect.objectContaining({ daveEncryption: true }));
    expect(h.queue.dispatcher.audioResource.stream.read(MUSIC_FRAME_BYTES)).toEqual(frame);
    expect(mocks.attachmentSource).toHaveBeenCalledOnce();
    expect(mocks.attachmentSource).toHaveBeenCalledWith(expect.objectContaining({ url: attachment.url }));
    expect(h.player.search).not.toHaveBeenCalled();
    expect(h.player.extractors.context.provide).not.toHaveBeenCalled();
    expect(mocks.youtubeSource).not.toHaveBeenCalled();
    expect(result).toMatchObject({ track: {
      title: attachment.name,
      source: 'discord-file',
      url: `https://discord.com/channels/${h.guild.id}/${textChannelId}`,
    }, addedCount: 1, playlist: null });

    const playing = h.queue.currentTrack;
    h.player.events.emit(GuildQueueEvent.PlayerFinish, h.queue, playing);
    expect(mocks.historyWrite).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO music_play_history'),
      h.guild.id, playing.id, result.track.url, attachment.name, 'Discord · MP3', null, 0, requester.id);
    expect(mocks.historyWrite).toHaveBeenCalledWith(expect.stringContaining('AND track_id = ?'),
      'COMPLETED', null, h.guild.id, playing.id);
    expect(JSON.stringify([result, playing.raw, playing.metadata, mocks.historyWrite.mock.calls])).not.toContain(marker);
  });

  it('appends a file behind an active track without preloading either source', async () => {
    vi.stubEnv('MUSIC_YOUTUBE_STREAM_MODE', 'direct');
    const currentTrack = youtubeTrack('current');
    const h = makeQueue({ currentTrack });

    const result = await h.add(file('sample.ogg'));

    expect(h.queue.currentTrack).toBe(currentTrack);
    expect(h.pending.map((track) => track.id)).toEqual([result.track.id]);
    expect(h.queue.dispatcher.playStream).not.toHaveBeenCalled();
    expect(mocks.attachmentSource).not.toHaveBeenCalled();
    expect(mocks.youtubeSource).not.toHaveBeenCalled();
  });

  it('preserves queue capacity and holds created by an existing source failure', async () => {
    const old = youtubeTrack('old');
    const h = makeQueue({ currentTrack: youtubeTrack('current'), maxQueueSize: 1, pending: [old] });
    await expect(h.add(file())).rejects.toThrow(/hàng đợi chỉ còn 0 chỗ/);
    expect(h.pending).toEqual([old]);
    expect(h.queue.addTrack).not.toHaveBeenCalled();

    noteMusicPlaybackFailure(h.queue, h.queue.currentTrack, new Error('Discord DAVE chưa sẵn sàng.'));
    const held = getMusicRecovery(h.queue);
    expect(held.tracks.map((track) => track.id)).toEqual(['current', 'old']);
    await expect(h.add(file())).rejects.toThrow(/Hàng đợi đã được giữ lại/);
    expect(getMusicRecovery(h.queue)).toEqual(held);
    expect(mocks.attachmentSource).not.toHaveBeenCalled();
  });

  it('skips an invalid file and plays the next queued file without holding the queue', async () => {
    const h = makeQueue({ currentTrack: youtubeTrack('current') });
    await h.add(file('invalid.ogg'));
    const next = await h.add(file('next.mp3', '234567890123456789'));
    h.queue.currentTrack = null;
    mocks.attachmentSource.mockImplementationOnce(() => {
      const stream = makeStream();
      queueMicrotask(() => stream.destroy(new Error('Không thể giải mã tệp MP3 hoặc OGG.')));
      return stream;
    });
    const playerStarted = once(h.player.events, GuildQueueEvent.PlayerStart);

    await h.queue.node.play(null);
    const [, playing] = await playerStarted;

    expect(playing.id).toBe(next.track.id);
    expect(getMusicRecovery(h.queue)).toMatchObject({ blocked: false, consecutiveFailures: 0 });
    expect(mocks.attachmentSource).toHaveBeenCalledTimes(2);
    expect(h.player.extractors.context.provide).not.toHaveBeenCalled();
    expect(mocks.youtubeSource).not.toHaveBeenCalled();
  });
});

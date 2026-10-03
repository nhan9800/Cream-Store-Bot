import { describe, expect, it, vi } from 'vitest';
import { QueryType } from 'discord-player';
import { buildMusicAddedMessage, enqueueYoutubeSource, normalizeYoutubeUrl } from '../src/services/musicPlayerService.js';

vi.mock('../src/database/db.js', () => ({ db: {} }));

const playlistUrl = 'https://www.youtube.com/playlist?list=PLcenar_test';
const makeTrack = (id, requestedBy = null) => ({
  id, title: `Track ${id}`, author: 'YouTube', url: `https://www.youtube.com/watch?v=${id}`,
  requestedBy, duration: '3:00', durationMS: 180_000,
  metadata: { original: true },
  setMetadata(value) { this.metadata = value; },
});
const makeResult = (tracks, playlist = true) => ({
  tracks,
  playlist: playlist ? { id: 'PLcenar_test', title: 'Cenar Chill', url: playlistUrl, tracks } : null,
});

let guildNumber = 0;
function harness({ current = null, queued = [], paused = false, buffering = false, maxQueueSize = 10, existing = true, onPlay = null, search = null } = {}) {
  const guild = { id: `playlist-test-${++guildNumber}` };
  const voiceChannel = { id: 'voice', name: 'Music', guildId: guild.id };
  const pending = [...queued];
  let queueOptions = null;
  const queue = {
    guild, currentTrack: current, channel: existing ? voiceChannel : null,
    get size() { return pending.length; },
    tracks: { toArray: () => [...pending] },
    setMaxSize: vi.fn(),
    tasksQueue: { acquire: vi.fn(() => ({ getTask: async () => {} })), release: vi.fn() },
    connect: vi.fn(async (channel) => { queue.channel = channel; }),
    addTrack: vi.fn((tracks) => pending.push(...tracks)),
    node: {
      isPlaying: () => Boolean(queue.currentTrack && !paused && !buffering),
      isPaused: () => paused,
      isBuffering: () => buffering,
      play: vi.fn(async () => {
        if (onPlay) return onPlay({ queue, pending, options: queueOptions });
        queue.currentTrack = pending.shift();
      }),
    },
  };
  let hasQueue = existing;
  const player = {
    search: search || vi.fn(async () => makeResult([makeTrack('one'), makeTrack('two'), makeTrack('three')])),
    nodes: {
      get: vi.fn(() => hasQueue ? queue : null),
      create: vi.fn((_guild, options) => { queueOptions = options; hasQueue = true; return queue; }),
    },
  };
  const play = (overrides = {}) => enqueueYoutubeSource({
    player, guild, voiceChannel, url: playlistUrl,
    getSettings: () => ({ defaultVolume: 80, maxQueueSize }),
    stabilizationMs: 0,
    ...overrides,
  });
  return { player, queue, pending, guild, voiceChannel, play };
}

describe('YouTube playlist URL semantics', () => {
  it.each([
    'https://www.youtube.com/watch?v=abc&list=PLcenar_test&index=3&t=10',
    'https://youtu.be/abc?list=PLcenar_test&si=share',
    'https://music.youtube.com/playlist?list=PLcenar_test',
  ])('loads the complete saved playlist from %s', (url) => {
    expect(normalizeYoutubeUrl(url)).toBe(playlistUrl);
  });

  it('rejects malformed, absent and dynamic Radio/Mix playlist identifiers', () => {
    expect(() => normalizeYoutubeUrl('https://youtube.com/playlist')).toThrow(/thiếu mã list/);
    expect(() => normalizeYoutubeUrl('https://youtube.com/playlist?list=')).toThrow(/không hợp lệ/);
    expect(() => normalizeYoutubeUrl('https://youtube.com/watch?v=abc&list=RDabc')).toThrow(/Mix\/Radio/);
  });
});

describe('Cenar Music complete playlist batches', () => {
  it('starts the first track and queues all remaining tracks in playlist order', async () => {
    const h = harness({ existing: false });
    const result = await h.play({ url: 'https://youtube.com/watch?v=one&list=PLcenar_test' });
    expect(h.player.search).toHaveBeenCalledWith(playlistUrl, expect.objectContaining({
      searchEngine: QueryType.YOUTUBE_PLAYLIST, ignoreCache: true,
    }));
    expect(h.queue.currentTrack.id).toBe('one');
    expect(h.pending.map((track) => track.id)).toEqual(['two', 'three']);
    expect(h.queue.addTrack).toHaveBeenCalledTimes(1);
    expect(h.queue.connect).toHaveBeenCalledWith(h.voiceChannel, { daveEncryption: true, timeout: 20_000 });
    expect(result).toMatchObject({ track: { id: 'one' }, addedCount: 3, playlist: { title: 'Cenar Chill', trackCount: 3, addedCount: 3, url: playlistUrl } });
    expect(h.queue.tasksQueue.release).toHaveBeenCalledTimes(1);
  });

  it.each([{ paused: false }, { paused: true }, { buffering: true }])('appends a second playlist without restarting an active queue (%j)', async (status) => {
    const current = makeTrack('current');
    const h = harness({ current, queued: [makeTrack('old')], ...status });
    await h.play();
    expect(h.queue.currentTrack).toBe(current);
    expect(h.pending.map((track) => track.id)).toEqual(['old', 'one', 'two', 'three']);
    expect(h.queue.node.play).not.toHaveBeenCalled();
    expect(h.queue.connect).not.toHaveBeenCalled();
  });

  it('sets requester metadata on every track before playback', async () => {
    const requestedBy = { id: 'customer', username: 'Listener' };
    const tracks = [makeTrack('a', requestedBy), makeTrack('b', requestedBy)];
    const h = harness({ existing: false, search: vi.fn(async () => makeResult(tracks)), onPlay: ({ queue, pending }) => {
      expect(pending.every((track) => track.metadata.requestedById === 'customer')).toBe(true);
      queue.currentTrack = pending.shift();
    } });
    await h.play({ requestedBy, textChannelId: 'text' });
    for (const track of tracks) expect(track.metadata).toEqual({ original: true, requestedById: 'customer', requestedByLabel: 'Listener', textChannelId: 'text' });
  });

  it('rejects a whole playlist over remaining capacity without partial insertion', async () => {
    const old = makeTrack('old');
    const h = harness({ current: makeTrack('current'), queued: [old], maxQueueSize: 3 });
    await expect(h.play()).rejects.toThrow(/chỉ còn 2 chỗ/);
    expect(h.pending).toEqual([old]);
    expect(h.queue.addTrack).not.toHaveBeenCalled();
    expect(h.queue.connect).not.toHaveBeenCalled();
  });

  it('accepts 200 tracks but rejects the 201st instead of truncating a large playlist', async () => {
    const tracks = Array.from({ length: 201 }, (_, index) => makeTrack(`track${index}`));
    const h = harness({ current: makeTrack('current'), maxQueueSize: 200, search: vi.fn(async () => makeResult(tracks)) });
    await expect(h.play()).rejects.toThrow(/201 bài/);
    expect(h.queue.addTrack).not.toHaveBeenCalled();
    h.player.search.mockResolvedValueOnce(makeResult(tracks.slice(0, 200)));
    expect((await h.play()).addedCount).toBe(200);
    expect(h.pending).toHaveLength(200);
  });

  it('serializes simultaneous batches and never exceeds capacity', async () => {
    const h = harness({ current: makeTrack('current'), maxQueueSize: 4 });
    const outcomes = await Promise.allSettled([h.play(), h.play()]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(h.pending.map((track) => track.id)).toEqual(['one', 'two', 'three']);
    expect(h.queue.addTrack).toHaveBeenCalledTimes(1);
  });

  it('rejects another voice room without redirecting or adding tracks', async () => {
    const h = harness({ current: makeTrack('current') });
    await expect(h.play({ voiceChannel: { id: 'elsewhere', name: 'Other' } })).rejects.toThrow(/cùng phòng thoại/);
    expect(h.queue.addTrack).not.toHaveBeenCalled();
    expect(h.queue.node.play).not.toHaveBeenCalled();
  });

  it('refreshes the capacity on an existing queue after settings change', async () => {
    const h = harness({ current: makeTrack('current'), maxQueueSize: 6 });
    await h.play();
    expect(h.queue.setMaxSize).toHaveBeenCalledWith(6);
  });

  it.each([null, makeResult([]), makeResult([makeTrack('one')], false)])('rejects private/empty/unsupported playlist results before queue creation (%j)', async (result) => {
    const h = harness({ existing: false, search: vi.fn(async () => result) });
    await expect(h.play()).rejects.toThrow(/Công khai\/Không công khai/);
    expect(h.player.nodes.create).not.toHaveBeenCalled();
    expect(h.queue.connect).not.toHaveBeenCalled();
  });

  it('reports extraction errors without modifying the active queue', async () => {
    const h = harness({ current: makeTrack('current'), search: vi.fn(async () => { throw new Error('Playlist unavailable'); }) });
    await expect(h.play()).rejects.toThrow(/unavailable/);
    expect(h.queue.addTrack).not.toHaveBeenCalled();
  });

  it('abandons timed-out reads and never enqueues a late result', async () => {
    let resolve;
    const h = harness({ existing: false, search: vi.fn(() => new Promise((done) => { resolve = done; })) });
    await expect(h.play({ sourceTimeoutMs: 5 })).rejects.toThrow(/Chưa thêm bài nào/);
    resolve(makeResult([makeTrack('late')]));
    await new Promise((done) => setTimeout(done, 10));
    expect(h.player.nodes.create).not.toHaveBeenCalled();
    expect(h.queue.addTrack).not.toHaveBeenCalled();
  });

  it('accepts a later batch track when the first video was skipped at startup', async () => {
    const h = harness({ existing: false, onPlay: ({ queue, pending }) => { pending.shift(); queue.currentTrack = pending.shift(); } });
    expect((await h.play()).addedCount).toBe(3);
    expect(h.queue.currentTrack.id).toBe('two');
  });

  it('accepts the last batch track still extracting and prevents a second starter', async () => {
    let finish;
    const h = harness({ existing: false, onPlay: async ({ queue, pending, options }) => {
      while (pending.length > 1) pending.shift();
      const last = pending.shift();
      await options.onBeforeCreateStream(last, 'youtubeVideo', queue);
      await new Promise((resolve) => { finish = resolve; });
      queue.currentTrack = last;
    } });
    expect((await h.play()).addedCount).toBe(3);
    expect(h.queue.currentTrack).toBeNull();
    await h.play();
    expect(h.queue.node.play).toHaveBeenCalledTimes(1);
    expect(h.pending.map((track) => track.id)).toEqual(['one', 'two', 'three']);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('keeps single video compatibility and rejects an ended empty single stream', async () => {
    const h = harness({ existing: false, search: vi.fn(async () => makeResult([makeTrack('single'), makeTrack('extra')], false)) });
    const result = await h.play({ url: 'https://youtu.be/single' });
    expect(result).toMatchObject({ track: { id: 'single' }, addedCount: 1, playlist: null });
    expect(h.player.search).toHaveBeenCalledWith('https://youtu.be/single', expect.objectContaining({ searchEngine: QueryType.YOUTUBE_VIDEO }));
    expect(h.pending).toHaveLength(0);
    const failed = harness({ existing: false, search: vi.fn(async () => makeResult([makeTrack('ended')], false)), onPlay: ({ pending }) => { pending.shift(); } });
    await expect(failed.play({ url: 'https://youtu.be/ended' })).rejects.toThrow(/kết thúc trước khi phát/);
  });

  it('shows the complete count and escaped playlist name in the Discord confirmation', () => {
    expect(buildMusicAddedMessage({ addedCount: 3, playlist: { title: 'Chill *night*' } })).toContain('**3 bài**');
    expect(buildMusicAddedMessage({ addedCount: 3, playlist: { title: 'Chill *night*' } })).toContain('Chill \\*night\\*');
  });
});

import fs from 'node:fs';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { GuildQueueEvent, Player, QueryType, QueueRepeatMode, StreamType, createAudioPlayer } from 'discord-player';
import ffmpegPath from 'ffmpeg-static';
import { ensureYtDlpRuntime } from '../utils/ytDlpRuntime.js';
import { config } from '../config.js';
import { db } from '../database/db.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { accentFor } from '../utils/uiKit.js';
import { configureCleanMusicDispatcher, createFrameAlignedMusicPcm, createMusicOpusStream } from './musicAudioPipeline.js';
import { loadYoutubeMix, normalizeYoutubeMixUrl } from './youtubeMixSource.js';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);
const VOLUME_STEPS = ['20', '40', '60', '80', '100'];
const DAVE_HANDSHAKE_TIMEOUT_MS = 8_000;
const VOLUME_RAMP_DURATION_MS = 360;
const VOLUME_RAMP_STEP_MS = 20;
const MUSIC_SOURCE_TIMEOUT_MS = 20_000;
// Load one more than the highest supported queue capacity, so a large
// playlist is rejected explicitly instead of being silently truncated.
const PLAYLIST_SEARCH_LIMIT = 201;
const panelMessages = new Map();
const refreshTimers = new Map();
const volumeRamps = new Map();
const queueMutations = new Map();
const extractingTracks = new WeakMap();
const audioProfiles = new WeakMap();

let musicPlayer = null;
let initializePromise = null;
let runtimeError = null;
let initializedAt = null;
let daveProtocolVersion = null;
let ytDlpAvailable = false;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

export function buildSmoothVolumeRamp(startValue, targetValue, {
  durationMs = VOLUME_RAMP_DURATION_MS,
  stepMs = VOLUME_RAMP_STEP_MS,
} = {}) {
  const start = clamp(startValue, 0, 100);
  const target = clamp(targetValue, 0, 100);
  const steps = Math.max(1, Math.ceil(clamp(durationMs, 0, 10_000) / Math.max(1, clamp(stepMs, 1, 1_000))));
  return Array.from({ length: steps }, (_, index) => {
    const progress = (index + 1) / steps;
    // Ease both ends of the gain transition so adjacent PCM chunks never
    // receive one large amplitude jump (the click/static heard on adjustment).
    const eased = (1 - Math.cos(Math.PI * progress)) / 2;
    return start + ((target - start) * eased);
  });
}

export async function setSmoothMusicVolume(queue, targetValue, {
  durationMs = VOLUME_RAMP_DURATION_MS,
  stepMs = VOLUME_RAMP_STEP_MS,
} = {}) {
  if (!queue?.node || typeof queue.node.setVolume !== 'function') {
    throw new Error('Player chưa sẵn sàng để chỉnh âm lượng.');
  }
  const guildId = String(queue.guild?.id || queue.id || 'unknown');
  const target = clamp(targetValue, 0, 100);
  const active = volumeRamps.get(guildId);
  if (active?.queue === queue) {
    // Coalesce rapid dashboard/Discord input into the currently running ramp.
    // Every caller waits for the newest target instead of creating competing
    // timers that make the gain audibly pump up and down.
    active.target = target;
    return active.promise;
  }

  const rampState = { queue, target, promise: null };
  rampState.promise = (async () => {
    for (;;) {
      const segmentTarget = rampState.target;
      const start = clamp(queue.node.volume, 0, 100);
      const ramp = buildSmoothVolumeRamp(start, segmentTarget, { durationMs, stepMs });
      for (const nextVolume of ramp) {
        if (rampState.target !== segmentTarget) break;
        if (queue.node.setVolume(nextVolume) === false) {
          throw new Error('Luồng âm thanh đã dừng; chưa thay đổi âm lượng. Hãy phát nhạc rồi thử lại.');
        }
        await new Promise((resolve) => setTimeout(resolve, stepMs));
      }
      if (rampState.target !== segmentTarget) continue;

      if (queue.node.setVolume(segmentTarget) === false) {
        throw new Error('Luồng âm thanh đã dừng; chưa thay đổi âm lượng. Hãy phát nhạc rồi thử lại.');
      }
      // Leave one event-loop window for a newer UI request before declaring
      // the ramp stable and removing its coalescing state.
      await new Promise((resolve) => setTimeout(resolve, stepMs));
      if (rampState.target === segmentTarget) return segmentTarget;
    }
  })().finally(() => {
    if (volumeRamps.get(guildId) === rampState) volumeRamps.delete(guildId);
  });
  volumeRamps.set(guildId, rampState);
  return rampState.promise;
}

function plain(value, fallback = '') {
  return String(value || fallback)
    .replace(/[\\`*_{}\[\]()<>#+\-.!|~]/g, '\\$&')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function resolveDaveState(queue) {
  const voiceConnection = queue?.dispatcher?.voiceConnection;
  const voiceState = voiceConnection?.state;
  const networkingState = voiceState?.networking?.state;
  return {
    voiceStatus: voiceState?.status || null,
    dave: networkingState?.dave || null,
  };
}

export function isDaveVoiceReady(queue) {
  const { voiceStatus, dave } = resolveDaveState(queue);
  if (voiceStatus !== 'ready') return false;
  // Stage channels and voice servers that negotiate protocol v0 can be ready
  // without a DAVE session. When DAVE exists, wait for the initial MLS
  // commit/welcome to set lastTransitionId (0 is a valid transition id).
  if (!dave) return true;
  return Number.isInteger(dave.lastTransitionId) && !dave.reinitializing;
}

export async function waitForDaveVoiceReady(queue, {
  timeoutMs = DAVE_HANDSHAKE_TIMEOUT_MS,
  pollMs = 50,
} = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const { voiceStatus } = resolveDaveState(queue);
    if (voiceStatus === 'destroyed' || voiceStatus === 'disconnected') {
      throw new Error('Kết nối phòng thoại đã đóng trước khi phiên mã hoá DAVE sẵn sàng.');
    }
    if (isDaveVoiceReady(queue)) return Date.now() - startedAt;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error('Discord DAVE/MLS chưa sẵn sàng sau 8 giây; đã chặn phát sớm để tránh mất bài.');
}

function readSettings(guildId) {
  db.prepare(`
    INSERT INTO music_guild_settings (guild_id)
    VALUES (?)
    ON CONFLICT(guild_id) DO NOTHING
  `).run(String(guildId));
  const row = db.prepare('SELECT * FROM music_guild_settings WHERE guild_id = ?').get(String(guildId));
  return {
    guildId: row.guild_id,
    defaultVolume: clamp(row.default_volume, 0, 100),
    defaultVoiceChannelId: row.default_voice_channel_id || null,
    djRoleId: row.dj_role_id || null,
    allowMemberControl: Boolean(row.allow_member_control),
    maxQueueSize: clamp(row.max_queue_size, 1, 200),
    updatedAt: row.updated_at,
  };
}

export function updateMusicSettings(guildId, changes = {}) {
  const current = readSettings(guildId);
  const next = {
    defaultVolume: changes.defaultVolume == null
      ? current.defaultVolume
      : clamp(changes.defaultVolume, 0, 100),
    defaultVoiceChannelId: changes.defaultVoiceChannelId === undefined
      ? current.defaultVoiceChannelId
      : (String(changes.defaultVoiceChannelId || '').trim() || null),
    djRoleId: changes.djRoleId === undefined
      ? current.djRoleId
      : (String(changes.djRoleId || '').trim() || null),
    allowMemberControl: changes.allowMemberControl == null
      ? current.allowMemberControl
      : Boolean(changes.allowMemberControl),
    maxQueueSize: changes.maxQueueSize == null
      ? current.maxQueueSize
      : clamp(changes.maxQueueSize, 1, 200),
  };
  db.prepare(`
    UPDATE music_guild_settings
    SET default_volume = ?, default_voice_channel_id = ?, dj_role_id = ?,
        allow_member_control = ?, max_queue_size = ?, updated_at = CURRENT_TIMESTAMP
    WHERE guild_id = ?
  `).run(
    next.defaultVolume,
    next.defaultVoiceChannelId,
    next.djRoleId,
    next.allowMemberControl ? 1 : 0,
    next.maxQueueSize,
    String(guildId),
  );
  return readSettings(guildId);
}

export function normalizeYoutubeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 500) throw new Error('Vui lòng nhập link YouTube hợp lệ.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Bot chỉ nhận link YouTube đầy đủ, không nhận từ khóa hoặc URL khác.');
  }
  if (url.protocol !== 'https:' || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error('Nguồn phát chỉ cho phép HTTPS từ YouTube hoặc youtu.be.');
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  const listId = url.searchParams.get('list');
  if (listId != null) {
    if (!/^[a-zA-Z0-9_-]{2,150}$/.test(listId)) {
      throw new Error('Mã playlist YouTube không hợp lệ. Hãy sao chép lại link chia sẻ playlist.');
    }
    if (listId.startsWith('RD')) {
      return normalizeYoutubeMixUrl(url.toString());
    }
    // A watch link with list= means the whole playlist, including when
    // shared from YouTube Music or youtu.be. Discard index/start/time fields.
    return `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`;
  }
  if (url.pathname.replace(/\/$/, '') === '/playlist') {
    throw new Error('Link playlist thiếu mã list. Hãy sao chép lại link chia sẻ playlist.');
  }
  return url.toString();
}

async function withQueueMutation(guildId, task) {
  const key = String(guildId);
  const previous = queueMutations.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(task);
  queueMutations.set(key, operation);
  try {
    return await operation;
  } finally {
    if (queueMutations.get(key) === operation) queueMutations.delete(key);
  }
}

async function loadYoutubeSource(player, url, requestedBy, timeoutMs) {
  const listId = new URL(url).searchParams.get('list');
  const isPlaylist = listId != null;
  if (listId?.startsWith('RD')) return loadYoutubeMix(player, url, requestedBy, { timeoutMs });
  let timeout;
  try {
    // Extractor timeouts apply to each fallback separately. Bound the whole
    // metadata read, before any voice connection or queue mutation. A late
    // result from an abandoned read can never enqueue tracks.
    const result = await Promise.race([
      player.search(url, {
        requestedBy: requestedBy || undefined,
        searchEngine: isPlaylist ? QueryType.YOUTUBE_PLAYLIST : QueryType.YOUTUBE_VIDEO,
        // Discord Player's query cache holds mutable Track instances. The
        // extractor still caches raw metadata and creates fresh tracks.
        ignoreCache: true,
      }),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('YouTube tải quá lâu. Chưa thêm bài nào; hãy thử lại sau.')), timeoutMs);
      }),
    ]);
    const tracks = isPlaylist ? result?.tracks : result?.tracks?.slice(0, 1);
    if (!tracks?.length || (isPlaylist && !result.playlist)) {
      throw new Error(isPlaylist
        ? 'Không đọc được playlist hoặc playlist không có bài phát được. Hãy dùng playlist Công khai/Không công khai, không phải Riêng tư.'
        : 'Không đọc được video YouTube này. Video có thể riêng tư, bị xoá hoặc không khả dụng.');
    }
    // Reject an extractor response outside the declared source boundary.
    for (const track of tracks) normalizeYoutubeUrl(track.url);
    return { tracks, playlist: isPlaylist ? result.playlist : null };
  } catch (error) {
    throw new Error(String(error?.message || 'Không thể tải nhạc từ YouTube.'));
  } finally {
    clearTimeout(timeout);
  }
}

function serializeTrack(track, index = 0) {
  if (!track) return null;
  const metadata = track.metadata && typeof track.metadata === 'object' ? track.metadata : {};
  return {
    index,
    id: String(track.id || ''),
    title: String(track.title || 'Không rõ tiêu đề'),
    author: String(track.author || 'YouTube'),
    url: String(track.url || ''),
    thumbnail: String(track.thumbnail || ''),
    duration: String(track.duration || formatDuration(track.durationMS)),
    durationMs: Number(track.durationMS || 0),
    requestedBy: track.requestedBy?.username || metadata.requestedByLabel || 'Dashboard',
    requestedById: track.requestedBy?.id || metadata.requestedById || null,
  };
}

function recentHistory(guildId) {
  return db.prepare(`
    SELECT id, track_url AS url, title, author, thumbnail,
           duration_ms AS durationMs, requested_by AS requestedBy,
           started_at AS startedAt, finished_at AS finishedAt, status
    FROM music_play_history
    WHERE guild_id = ?
    ORDER BY id DESC
    LIMIT 12
  `).all(String(guildId));
}

export function getMusicRuntimeStatus() {
  return {
    ready: Boolean(musicPlayer && !runtimeError),
    initializedAt,
    engine: 'Discord Player 7 · yt-dlp · FFmpeg',
    audioProfile: '48 kHz stereo · Opus music · bitrate theo phòng thoại',
    ffmpegAvailable: Boolean(ffmpegPath && fs.existsSync(ffmpegPath)),
    ytDlpAvailable,
    daveAvailable: Number.isInteger(daveProtocolVersion),
    daveProtocolVersion,
    error: runtimeError ? String(runtimeError.message || runtimeError) : null,
  };
}

export function getMusicState(guildId) {
  const queue = musicPlayer?.nodes.get(String(guildId));
  const timestamp = queue?.node.getTimestamp() || null;
  const channel = queue?.channel || null;
  const members = channel?.members
    ? [...channel.members.values()].filter((member) => !member.user.bot)
    : [];
  return {
    runtime: getMusicRuntimeStatus(),
    audio: queue ? audioProfiles.get(queue) || null : null,
    settings: readSettings(guildId),
    connected: Boolean(queue?.connection && channel),
    playing: Boolean(queue?.currentTrack && queue.node.isPlaying()),
    paused: Boolean(queue?.node.isPaused()),
    buffering: Boolean(queue && (queue.node.isBuffering() || extractingTracks.has(queue))),
    volume: Number(queue?.node.volume ?? readSettings(guildId).defaultVolume),
    repeatMode: Number(queue?.repeatMode ?? QueueRepeatMode.OFF),
    shuffle: Boolean(queue?.isShuffling),
    ping: Number(queue?.ping || 0),
    voiceChannel: channel ? { id: channel.id, name: channel.name } : null,
    listeners: members.map((member) => ({ id: member.id, name: member.displayName })),
    current: serializeTrack(queue?.currentTrack),
    progress: {
      currentMs: Number(timestamp?.current?.value || 0),
      totalMs: Number(timestamp?.total?.value || queue?.currentTrack?.durationMS || 0),
      percent: clamp(timestamp?.progress || 0, 0, 100),
      currentLabel: timestamp?.current?.label || '0:00',
      totalLabel: timestamp?.total?.label || queue?.currentTrack?.duration || '0:00',
    },
    queue: queue?.tracks.toArray().map((track, index) => serializeTrack(track, index + 1)) || [],
    history: recentHistory(guildId),
  };
}

export function listMusicVoiceChannels(guild) {
  if (!guild) return [];
  return guild.channels.cache
    .filter((channel) => [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type))
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type === ChannelType.GuildStageVoice ? 'STAGE' : 'VOICE',
      members: channel.members?.filter((member) => !member.user.bot).size || 0,
      bitrate: Number(channel.bitrate || 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

function saveTrackStart(queue, track) {
  const item = serializeTrack(track);
  db.prepare(`
    INSERT INTO music_play_history (
      guild_id, track_id, track_url, title, author, thumbnail,
      duration_ms, requested_by, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PLAYING')
  `).run(
    queue.guild.id,
    item.id || null,
    item.url,
    item.title,
    item.author,
    item.thumbnail || null,
    item.durationMs,
    item.requestedById || item.requestedBy,
  );
}

function closeTrackHistory(queue, track, status, error = null) {
  db.prepare(`
    UPDATE music_play_history
    SET status = ?, finished_at = CURRENT_TIMESTAMP, error_message = ?
    WHERE id = (
      SELECT id FROM music_play_history
      WHERE guild_id = ? AND track_url = ? AND status = 'PLAYING'
      ORDER BY id DESC LIMIT 1
    )
  `).run(status, error ? String(error).slice(0, 1000) : null, queue.guild.id, String(track?.url || ''));
}

function schedulePanelRefresh(guildId) {
  const id = String(guildId);
  if (refreshTimers.has(id)) clearTimeout(refreshTimers.get(id));
  refreshTimers.set(id, setTimeout(async () => {
    refreshTimers.delete(id);
    const message = panelMessages.get(id);
    if (!message?.editable) return;
    await message.edit(buildMusicPanelPayload(id)).catch(() => panelMessages.delete(id));
  }, 350));
}

export function wirePlayerEvents(player) {
  player.events.on(GuildQueueEvent.WillPlayTrack, (_queue, _track, streamConfig, resolve) => {
    try {
      configureCleanMusicDispatcher(streamConfig.dispatcherConfig);
    } finally {
      resolve();
    }
  });
  player.events.on(GuildQueueEvent.PlayerStart, (queue, track) => {
    if (extractingTracks.get(queue)?.id === track?.id) extractingTracks.delete(queue);
    saveTrackStart(queue, track);
    // Bitrate is configured on a fresh native encoder before playback;
    // never mutate an already-ended PlayerStart resource.
    schedulePanelRefresh(queue.guild.id);
  });
  player.events.on(GuildQueueEvent.PlayerFinish, (queue, track) => {
    closeTrackHistory(queue, track, 'COMPLETED');
    schedulePanelRefresh(queue.guild.id);
  });
  player.events.on(GuildQueueEvent.PlayerSkip, (queue, track, reason, description) => {
    if (extractingTracks.get(queue)?.id === track?.id) extractingTracks.delete(queue);
    closeTrackHistory(queue, track, 'SKIPPED');
    console.warn(
      `[MUSIC] Track skipped in ${queue.guild.name}: ${track?.title || track?.url || 'unknown'} · ${reason || 'unknown'}`,
      description || '',
    );
    schedulePanelRefresh(queue.guild.id);
  });
  player.events.on(GuildQueueEvent.PlayerError, (queue, error, track) => {
    if (extractingTracks.get(queue)?.id === track?.id) extractingTracks.delete(queue);
    closeTrackHistory(queue, track, 'ERROR', error?.message);
    console.error(`[MUSIC] Playback error in ${queue.guild.name}:`, error);
    schedulePanelRefresh(queue.guild.id);
  });
  for (const event of [
    GuildQueueEvent.AudioTrackAdd,
    GuildQueueEvent.AudioTracksAdd,
    GuildQueueEvent.AudioTrackRemove,
    GuildQueueEvent.EmptyQueue,
    GuildQueueEvent.PlayerPause,
    GuildQueueEvent.PlayerResume,
    GuildQueueEvent.VolumeChange,
    GuildQueueEvent.Disconnect,
  ]) {
    player.events.on(event, (queue) => {
      if (event === GuildQueueEvent.Disconnect || event === GuildQueueEvent.EmptyQueue) extractingTracks.delete(queue);
      schedulePanelRefresh(queue.guild.id);
    });
  }
  player.events.on(GuildQueueEvent.Error, (queue, error) => {
    // Native AudioPlayer errors use this event, followed by PlayerFinish.
    // Preserve ERROR history instead of turning a failed stream into COMPLETED.
    if (error?.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      const failedTrack = error?.resource?.metadata || queue.currentTrack;
      if (failedTrack?.url) closeTrackHistory(queue, failedTrack, 'ERROR', error?.message);
    }
    console.error(`[MUSIC] Queue error in ${queue.guild.name}:`, error);
    schedulePanelRefresh(queue.guild.id);
  });
}

export async function initializeMusicPlayer(client) {
  if (musicPlayer) return musicPlayer;
  if (initializePromise) return initializePromise;
  initializePromise = (async () => {
    try {
      if (!ffmpegPath || !fs.existsSync(ffmpegPath)) {
        throw new Error('Không tìm thấy FFmpeg runtime.');
      }
      const daveyModule = await import('@snazzah/davey');
      const davey = daveyModule.default || daveyModule;
      if (!Number.isInteger(davey.DAVE_PROTOCOL_VERSION) || typeof davey.DAVESession !== 'function') {
        throw new Error('Discord DAVE runtime không hợp lệ.');
      }
      daveProtocolVersion = davey.DAVE_PROTOCOL_VERSION;
      const binaryPath = await ensureYtDlpRuntime();
      const { YouTubeDlpExtractor, setFFmpegPath: setExtractorFFmpegPath, setYtDlpPath } =
        await import('discord-player-youtubedlp');
      setYtDlpPath(binaryPath);
      ytDlpAvailable = true;
      setExtractorFFmpegPath(ffmpegPath);
      const instance = new Player(client, {
        ffmpegPath,
        connectionTimeout: 20_000,
        probeTimeout: 8_000,
        // YouTubeDlpExtractor already returns raw 48 kHz PCM. Passing that
        // stream through Discord Player's FFmpeg pipeline a second time can
        // yield an empty resource, making the bot join and immediately leave.
        skipFFmpeg: true,
      });
      const cookiesFile = String(process.env.YOUTUBE_COOKIES_FILE || '').trim();
      const proxyUri = String(process.env.YOUTUBE_PROXY_URL || '').trim();
      await instance.extractors.register(YouTubeDlpExtractor, {
        agent: {
          forceIPv4: true,
          autoCookiesFromBrowser: false,
          ...(cookiesFile ? { cookiesFile } : {}),
          ...(proxyUri ? { proxyUri } : {}),
        },
        searchLimit: 1,
        playlistSearchLimit: PLAYLIST_SEARCH_LIMIT,
        relatedLimit: 0,
        searchTimeoutMs: 8_000,
        videoTimeoutMs: 10_000,
        playlistTimeoutMs: 30_000,
        ytdlpTimeoutMs: 30_000,
        infoCacheTtlMs: 120_000,
        debug: process.env.MUSIC_DEBUG === 'true',
      });
      wirePlayerEvents(instance);
      musicPlayer = instance;
      runtimeError = null;
      initializedAt = new Date().toISOString();
      console.log(`[MUSIC] Cenar Music ready · yt-dlp=verified · DAVE=v${daveProtocolVersion} · FFmpeg=${ffmpegPath}`);
      return instance;
    } catch (error) {
      runtimeError = error;
      console.error('[MUSIC] Music engine disabled; commerce bot remains online:', error);
      throw error;
    } finally {
      initializePromise = null;
    }
  })();
  return initializePromise;
}

export function musicQueueOptions(settings, textChannelId, requestedByLabel) {
  return {
      volume: settings.defaultVolume,
      connectionTimeout: 20_000,
      // Keep DSP enabled for real volume control; disable unused effects.
      // WillPlayTrack also supplies explicit disabled optional presets.
      disableEqualizer: true,
      disableFilterer: false,
      disableVolume: false,
      disableBiquad: true,
      disableResampler: true,
      disableCompressor: true,
      disableReverb: true,
      disableSeeker: true,
      maxSize: settings.maxQueueSize,
      maxHistorySize: 50,
      selfDeaf: true,
      leaveOnEmpty: true,
      leaveOnEmptyCooldown: 180_000,
      leaveOnEnd: true,
      leaveOnEndCooldown: 180_000,
      leaveOnStop: true,
      leaveOnStopCooldown: 5_000,
      metadata: { textChannelId, requestedByLabel },
      onBeforeCreateStream: async (track, _queryType, queue) => {
        extractingTracks.set(queue, track);
        return null;
      },
      // discord-player 7.2.0 may start consuming the audio resource before
      // Discord has processed the initial DAVE MLS commit. The stream then
      // reaches Idle at 0s and disappears from the dashboard. Holding the
      // extracted stream here keeps yt-dlp back-pressured until encryption is
      // genuinely ready, without consuming or recreating the audio stream.
      onStreamExtracted: async (stream, track, queue) => {
        const pcm = stream?.stream || stream;
        try {
          const waitedMs = await waitForDaveVoiceReady(queue);
          console.log(`[MUSIC] DAVE ready in ${waitedMs}ms; starting ${track?.title || track?.url || 'track'}`);
          // Align before volume DSP as well: odd PCM chunk boundaries must
          // not corrupt 16-bit samples. Bound initial audio, not paused audio.
          const aligned = createFrameAlignedMusicPcm(pcm);
          return stream?.stream ? { ...stream, stream: aligned } : aligned;
        } catch (error) {
          pcm?.destroy();
          throw error;
        }
      },
      onAfterCreateStream: async (pcm, queue) => {
        const opus = createMusicOpusStream(pcm, queue.channel);
        audioProfiles.set(queue, opus.audioProfile);
        return { stream: opus, type: StreamType.Opus };
      },
  };
}

function hasActiveMusic(queue) {
  return Boolean(queue && (extractingTracks.has(queue) || (queue.currentTrack && (
    queue.node.isPlaying() || queue.node.isPaused() || queue.node.isBuffering()
  ))));
}

// Search independently so a slow playlist does not block unrelated metadata
// reads; serialize capacity checks and the complete batch insertion per guild.
export async function enqueueYoutubeSource({
  player, guild, voiceChannel, url, requestedBy = null,
  requestedByLabel = 'Dashboard', textChannelId = null,
  getSettings = () => readSettings(guild.id),
  sourceTimeoutMs = MUSIC_SOURCE_TIMEOUT_MS, stabilizationMs = 1_200,
}) {
  const normalizedUrl = normalizeYoutubeUrl(url);
  const { tracks, playlist } = await loadYoutubeSource(player, normalizedUrl, requestedBy, sourceTimeoutMs);
  return withQueueMutation(guild.id, async () => {
    const settings = getSettings();
    const existing = player.nodes.get(guild.id);
    if (existing?.channel && existing.channel.id !== voiceChannel.id) {
      throw new Error(`Bot đang ở #${existing.channel.name}. Hãy vào cùng phòng thoại hoặc cho bot rời phòng trước.`);
    }
    const pendingCount = Number(existing?.size || 0);
    if (pendingCount + tracks.length > settings.maxQueueSize) {
      throw new Error(`Cần thêm ${tracks.length} bài nhưng hàng đợi chỉ còn ${Math.max(0, settings.maxQueueSize - pendingCount)} chỗ (giới hạn ${settings.maxQueueSize}). Chưa thêm bài nào; hãy dùng playlist nhỏ hơn hoặc bớt bài trong hàng đợi.`);
    }
    const queue = existing || player.nodes.create(guild, musicQueueOptions(settings, textChannelId, requestedByLabel));
    // nodes.create reuses a guild's queue without applying new node options.
    queue.setMaxSize(settings.maxQueueSize);
    const entry = queue.tasksQueue.acquire();
    await entry.getTask();
    try {
      if (!queue.channel) await queue.connect(voiceChannel, {
        daveEncryption: true, timeout: 20_000,
        // Tolerate a brief 500ms shared-host/network hiccup before skipping.
        audioPlayer: createAudioPlayer({ behaviors: { maxMissedFrames: 25 } }),
      });
      // A task acquired elsewhere may have added tracks during our wait.
      if (queue.size + tracks.length > settings.maxQueueSize) {
        throw new Error(`Hàng đợi không còn đủ chỗ cho ${tracks.length} bài (giới hạn ${settings.maxQueueSize}). Chưa thêm bài nào.`);
      }
      for (const track of tracks) {
        track.setMetadata({
          ...(track.metadata && typeof track.metadata === 'object' ? track.metadata : {}),
          textChannelId,
          requestedById: requestedBy?.id || null,
          requestedByLabel: requestedBy?.username || requestedByLabel,
        });
      }
      const wasAlreadyPlaying = hasActiveMusic(queue);
      // GuildQueue validates array capacity before mutation and preserves its
      // order. Never feed the first track alone or slice a large playlist.
      queue.addTrack(tracks);
      if (!wasAlreadyPlaying) {
        let playbackError = null;
        const startup = queue.node.play(null).catch((error) => {
          if (extractingTracks.get(queue)?.id === tracks[0].id) extractingTracks.delete(queue);
          playbackError = error;
          if (playlist) console.error('[MUSIC] Playlist startup failed:', error);
          else throw error;
        });
        // Metadata/connection and accepted batch insertion remain bounded for
        // the dashboard. Playlist stream extraction continues independently;
        // its start/error events update the panel and playback history.
        if (!playlist) await startup;
        await new Promise((resolve) => setTimeout(resolve, stabilizationMs));
        if (playbackError) throw playbackError;
        const selected = new Set(tracks.map((track) => track.id));
        const activeSelected = selected.has(queue.currentTrack?.id) && hasActiveMusic(queue);
        const pendingSelected = queue.tracks.toArray().some((track) => selected.has(track.id))
          || selected.has(extractingTracks.get(queue)?.id);
        // If a playlist's first unavailable video was skipped, its next item
        // can still be extracting. The batch is accepted while it remains in
        // the queue; an error here would encourage adding the batch twice.
        if (!activeSelected && !(playlist && pendingSelected)) {
          throw new Error('Nguồn âm thanh YouTube kết thúc trước khi phát. Vui lòng thử lại hoặc kiểm tra giới hạn YouTube trên hosting.');
        }
      }
      return {
        track: serializeTrack(tracks[0]),
        addedCount: tracks.length,
        playlist: playlist ? {
          id: String(playlist.id || new URL(normalizedUrl).searchParams.get('list') || ''),
          title: String(playlist.title || 'YouTube Playlist'),
          url: normalizedUrl,
          trackCount: tracks.length,
          addedCount: tracks.length,
          ...(playlist.mix ? { mix: true, limit: playlist.limit } : {}),
        } : null,
      };
    } finally {
      queue.tasksQueue.release();
    }
  });
}

export async function playYoutube({ guild, voiceChannel, url, requestedBy = null, requestedByLabel = 'Dashboard', textChannelId = null }) {
  if (!guild || !voiceChannel || voiceChannel.guildId !== guild.id || !voiceChannel.isVoiceBased()) {
    throw new Error('Phòng thoại không hợp lệ hoặc không thuộc máy chủ này.');
  }
  normalizeYoutubeUrl(url);
  const permissions = voiceChannel.permissionsFor(guild.members.me);
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
    throw new Error(`Bot thiếu quyền Xem kênh, Kết nối hoặc Nói trong #${voiceChannel.name}.`);
  }
  const player = await initializeMusicPlayer(guild.client);
  const result = await enqueueYoutubeSource({ player, guild, voiceChannel, url, requestedBy, requestedByLabel, textChannelId });
  schedulePanelRefresh(guild.id);
  return { ...result, state: getMusicState(guild.id) };
}

export function buildMusicAddedMessage(result) {
  if (result.playlist?.mix) {
    return `Đã thêm **${result.addedCount} bài** từ Mix/Radio **${plain(result.playlist.title)}** vào hàng đợi theo thứ tự. Mỗi lượt lấy tối đa **${result.playlist.limit} bài** tại thời điểm thêm. Bài đang phát được giữ nguyên.`;
  }
  return result.playlist
    ? `Đã thêm **${result.addedCount} bài** từ playlist **${plain(result.playlist.title)}** vào hàng đợi theo thứ tự. Bài đang phát được giữ nguyên.`
    : `Đã thêm **${plain(result.track.title)}** vào Cenar Music.`;
}

export async function controlMusic(guildId, action, value = null) {
  const queue = musicPlayer?.nodes.get(String(guildId));
  if (!queue) throw new Error('Hiện chưa có phiên phát nhạc trong máy chủ.');
  switch (String(action || '').toLowerCase()) {
    case 'toggle':
      queue.node.setPaused(!queue.node.isPaused());
      break;
    case 'pause':
      queue.node.pause();
      break;
    case 'resume':
      queue.node.resume();
      break;
    case 'skip':
      if (!queue.node.skip()) throw new Error('Không có bài kế tiếp để chuyển.');
      break;
    case 'stop':
      extractingTracks.delete(queue);
      queue.node.stop(true);
      break;
    case 'disconnect':
      extractingTracks.delete(queue);
      queue.delete();
      break;
    case 'shuffle':
      queue.toggleShuffle(true);
      break;
    case 'loop': {
      const next = queue.repeatMode === QueueRepeatMode.OFF
        ? QueueRepeatMode.TRACK
        : queue.repeatMode === QueueRepeatMode.TRACK
          ? QueueRepeatMode.QUEUE
          : QueueRepeatMode.OFF;
      queue.setRepeatMode(next);
      break;
    }
    case 'volume':
      await setSmoothMusicVolume(queue, value);
      break;
    case 'remove': {
      const index = Number(value) - 1;
      const track = queue.tracks.at(index);
      if (!track) throw new Error('Bài hát không còn trong hàng đợi.');
      queue.removeTrack(track);
      break;
    }
    default:
      throw new Error('Thao tác điều khiển không hợp lệ.');
  }
  schedulePanelRefresh(guildId);
  return getMusicState(guildId);
}

function setButtonEmoji(button, emoji) {
  if (emoji) button.setEmoji(emoji);
  return button;
}

export function buildMusicPanelPayload(guildId, { notice = null } = {}) {
  const E = createEmojiResolver(guildId);
  const state = getMusicState(guildId);
  const current = state.current;
  const repeatLabel = state.repeatMode === QueueRepeatMode.TRACK
    ? 'Lặp bài'
    : state.repeatMode === QueueRepeatMode.QUEUE
      ? 'Lặp hàng đợi'
      : 'Tắt lặp';
  const queueLines = state.queue.slice(0, 8).map((track) => (
    `**${track.index}.** [${plain(track.title)}](${track.url}) · ${track.duration} · *${plain(track.requestedBy)}*`
  ));
  if (!queueLines.length) queueLines.push('_Hàng đợi đang trống — hãy thêm video, playlist hoặc Mix/Radio YouTube._');

  const container = new ContainerBuilder().setAccentColor(accentFor(current ? 'success' : 'primary'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('music_wave')} CENAR MUSIC · CONTROL DECK`,
    `> ${E('cenar_verified')} YouTube Engine · 48 kHz Stereo · bitrate tự động theo phòng thoại`,
    notice ? `> ${notice}` : '',
    '',
    current
      ? `## ${E('music_now')} [${plain(current.title)}](${current.url})`
      : `## ${E('music_now')} Chưa có bài hát đang phát`,
    current ? `**Kênh:** ${plain(current.author)} · **Yêu cầu:** ${plain(current.requestedBy)}` : '',
    current
      ? `\`${state.progress.currentLabel}\` ${queueProgress(state.progress.percent)} \`${state.progress.totalLabel}\``
      : `Kết nối vào phòng thoại, nhấn **Thêm bài / playlist / Mix** rồi dán link YouTube.`,
    '',
    `**Trạng thái:** ${state.paused ? 'Tạm dừng' : state.playing ? 'Đang phát' : state.buffering ? 'Đang tải âm thanh' : 'Sẵn sàng'} · **Âm lượng:** ${state.volume}% · **${repeatLabel}** · **Shuffle:** ${state.shuffle ? 'Bật' : 'Tắt'}`,
    `**Phòng thoại:** ${state.voiceChannel ? `🔊 ${plain(state.voiceChannel.name)}` : 'Chưa kết nối'} · **Người nghe:** ${state.listeners.length} · **Ping:** ${state.ping}ms`,
    '',
    `### ${E('music_queue')} HÀNG ĐỢI · ${state.queue.length} BÀI`,
    ...queueLines,
    state.queue.length > 8 ? `-# Và ${state.queue.length - 8} bài khác trên Dashboard.` : '',
    '',
    `-# Video / playlist / Mix / Radio YouTube · Mix tối đa 50 bài mỗi lượt · tự rời phòng sau 3 phút không có người nghe`,
  ].filter(Boolean).join('\n').slice(0, 4000)));

  const add = setButtonEmoji(
    new ButtonBuilder().setCustomId('music:add').setLabel('Thêm bài / playlist / Mix').setStyle(ButtonStyle.Success),
    E.component('music_add'),
  );
  const toggle = setButtonEmoji(
    new ButtonBuilder().setCustomId('music:toggle').setLabel(state.paused ? 'Tiếp tục' : 'Tạm dừng').setStyle(ButtonStyle.Primary).setDisabled(!current),
    E.component(state.paused ? 'music_play' : 'music_pause'),
  );
  const skip = setButtonEmoji(
    new ButtonBuilder().setCustomId('music:skip').setLabel('Chuyển bài').setStyle(ButtonStyle.Secondary).setDisabled(!current),
    E.component('music_skip'),
  );
  const loop = setButtonEmoji(
    new ButtonBuilder().setCustomId('music:loop').setLabel(repeatLabel).setStyle(state.repeatMode ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!current),
    E.component('music_loop'),
  );
  const stop = setButtonEmoji(
    new ButtonBuilder().setCustomId('music:stop').setLabel('Dừng').setStyle(ButtonStyle.Danger).setDisabled(!current),
    E.component('music_stop'),
  );
  container.addActionRowComponents(new ActionRowBuilder().addComponents(add, toggle, skip, loop, stop));

  const volume = new StringSelectMenuBuilder()
    .setCustomId('music:volume')
    .setPlaceholder(`Âm lượng hiện tại · ${state.volume}%`)
    .setDisabled(!state.connected)
    .addOptions(VOLUME_STEPS.map((step) => ({
      label: `${step}%`,
      value: step,
      description: step === '80' ? 'Mức cân bằng được đề xuất' : `Đặt âm lượng ở mức ${step}%`,
      emoji: E.component('music_volume') || undefined,
      default: Number(step) === state.volume,
    })));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(volume));

  const shuffle = setButtonEmoji(
    new ButtonBuilder().setCustomId('music:shuffle').setLabel(state.shuffle ? 'Shuffle: Bật' : 'Shuffle: Tắt').setStyle(state.shuffle ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!current),
    E.component('music_shuffle'),
  );
  const refresh = setButtonEmoji(
    new ButtonBuilder().setCustomId('music:refresh').setLabel('Làm mới').setStyle(ButtonStyle.Secondary),
    E.component('music_refresh'),
  );
  const dashboard = setButtonEmoji(
    new ButtonBuilder().setLabel('Dashboard').setStyle(ButtonStyle.Link).setURL(new URL('/admin/music', config.storeWebsiteUrl || 'https://cenarstore.xyz').toString()),
    E.component('icon_web'),
  );
  const disconnect = setButtonEmoji(
    new ButtonBuilder().setCustomId('music:disconnect').setLabel('Rời phòng').setStyle(ButtonStyle.Danger).setDisabled(!state.connected),
    E.component('music_disconnect'),
  );
  container.addActionRowComponents(new ActionRowBuilder().addComponents(shuffle, refresh, dashboard, disconnect));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function queueProgress(percent) {
  const filled = clamp(Math.round(Number(percent || 0) / 10), 0, 10);
  return `${'▬'.repeat(filled)}🔘${'▬'.repeat(10 - filled)}`;
}

function memberCanControl(interaction) {
  const queue = musicPlayer?.nodes.get(interaction.guildId);
  const member = interaction.member;
  if (member?.permissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const settings = readSettings(interaction.guildId);
  if (settings.djRoleId && member?.roles?.cache?.has(settings.djRoleId)) return true;
  if (!settings.allowMemberControl) return false;
  return Boolean(member?.voice?.channelId && (!queue?.channel || member.voice.channelId === queue.channel.id));
}

function memberVoiceChannel(interaction) {
  return interaction.member?.voice?.channel || null;
}

export async function registerMusicPanelMessage(guildId, message) {
  if (message) panelMessages.set(String(guildId), message);
  return message;
}

export async function handleMusicInteraction(interaction) {
  if (!interaction.customId?.startsWith('music:')) return false;
  if (!interaction.guild) return true;

  if (interaction.customId === 'music:add') {
    const voiceChannel = memberVoiceChannel(interaction);
    if (!voiceChannel) {
      await interaction.reply({ content: 'Bạn cần vào một phòng thoại trước khi thêm nhạc.', ephemeral: true });
      return true;
    }
    const modal = new ModalBuilder().setCustomId('music:add:modal').setTitle('Thêm bài, playlist hoặc Mix');
    const input = new TextInputBuilder()
      .setCustomId('youtube_url')
      .setLabel('Link video, playlist hoặc Mix/Radio YouTube')
      .setPlaceholder('https://www.youtube.com/playlist?list=...')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(500);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.customId === 'music:add:modal' && interaction.isModalSubmit()) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const voiceChannel = memberVoiceChannel(interaction);
      if (!voiceChannel) throw new Error('Bạn cần ở trong phòng thoại để thêm nhạc.');
      const result = await playYoutube({
        guild: interaction.guild,
        voiceChannel,
        url: interaction.fields.getTextInputValue('youtube_url'),
        requestedBy: interaction.user,
        textChannelId: interaction.channelId,
      });
      await interaction.editReply(buildMusicAddedMessage(result));
    } catch (error) {
      await interaction.editReply(`Không thể thêm bài: ${error.message}`);
    }
    return true;
  }

  if (!memberCanControl(interaction)) {
    await interaction.reply({ content: 'Bạn cần ở cùng phòng thoại với bot hoặc có quyền Quản lý máy chủ/DJ.', ephemeral: true });
    return true;
  }

  await interaction.deferUpdate();
  try {
    if (interaction.customId === 'music:volume' && interaction.isStringSelectMenu()) {
      await controlMusic(interaction.guildId, 'volume', interaction.values[0]);
    } else {
      const action = interaction.customId.split(':')[1];
      if (action !== 'refresh') await controlMusic(interaction.guildId, action);
    }
    await interaction.message.edit(buildMusicPanelPayload(interaction.guildId));
    await registerMusicPanelMessage(interaction.guildId, interaction.message);
  } catch (error) {
    await interaction.followUp({ content: `Không thể điều khiển nhạc: ${error.message}`, ephemeral: true });
  }
  return true;
}

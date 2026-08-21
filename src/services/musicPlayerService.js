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
import { GuildQueueEvent, Player, QueueRepeatMode } from 'discord-player';
import {
  YouTubeDlpExtractor,
  setFFmpegPath as setExtractorFFmpegPath,
} from 'discord-player-youtubedlp';
import ffmpegPath from 'ffmpeg-static';
import { config } from '../config.js';
import { db } from '../database/db.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { accentFor } from '../utils/uiKit.js';

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
const panelMessages = new Map();
const refreshTimers = new Map();

let musicPlayer = null;
let initializePromise = null;
let runtimeError = null;
let initializedAt = null;
let daveProtocolVersion = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
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
  return url.toString();
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
    audioProfile: '48 kHz stereo · bitrate tự động theo phòng thoại',
    ffmpegAvailable: Boolean(ffmpegPath && fs.existsSync(ffmpegPath)),
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
    settings: readSettings(guildId),
    connected: Boolean(queue?.connection && channel),
    playing: Boolean(queue?.currentTrack && queue.node.isPlaying()),
    paused: Boolean(queue?.node.isPaused()),
    buffering: Boolean(queue?.node.isBuffering()),
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

function wirePlayerEvents(player) {
  player.events.on(GuildQueueEvent.PlayerStart, (queue, track) => {
    saveTrackStart(queue, track);
    // Do not mutate bitrate at runtime. With @discord-player/opus the
    // PlayerStart event can fire while the native encoder is still null; that
    // mutation tears down an otherwise valid audio resource. Discord Player's
    // default Opus settings already match the voice channel bitrate.
    schedulePanelRefresh(queue.guild.id);
  });
  player.events.on(GuildQueueEvent.PlayerFinish, (queue, track) => {
    closeTrackHistory(queue, track, 'COMPLETED');
    schedulePanelRefresh(queue.guild.id);
  });
  player.events.on(GuildQueueEvent.PlayerSkip, (queue, track) => {
    closeTrackHistory(queue, track, 'SKIPPED');
    schedulePanelRefresh(queue.guild.id);
  });
  player.events.on(GuildQueueEvent.PlayerError, (queue, error, track) => {
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
    player.events.on(event, (queue) => schedulePanelRefresh(queue.guild.id));
  }
  player.events.on(GuildQueueEvent.Error, (queue, error) => {
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
      setExtractorFFmpegPath(ffmpegPath);
      const instance = new Player(client, {
        ffmpegPath,
        connectionTimeout: 20_000,
        probeTimeout: 8_000,
        skipFFmpeg: false,
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
        playlistSearchLimit: 100,
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
      console.log(`[MUSIC] Cenar Music ready · DAVE=v${daveProtocolVersion} · FFmpeg=${ffmpegPath}`);
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

export async function playYoutube({ guild, voiceChannel, url, requestedBy = null, requestedByLabel = 'Dashboard', textChannelId = null }) {
  if (!guild || !voiceChannel || voiceChannel.guildId !== guild.id || !voiceChannel.isVoiceBased()) {
    throw new Error('Phòng thoại không hợp lệ hoặc không thuộc máy chủ này.');
  }
  const normalizedUrl = normalizeYoutubeUrl(url);
  const botMember = guild.members.me;
  const permissions = voiceChannel.permissionsFor(botMember);
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
    throw new Error(`Bot thiếu quyền Xem kênh, Kết nối hoặc Nói trong #${voiceChannel.name}.`);
  }
  const player = await initializeMusicPlayer(guild.client);
  const settings = readSettings(guild.id);
  const activeQueue = player.nodes.get(guild.id);
  if (activeQueue && activeQueue.size >= settings.maxQueueSize) {
    throw new Error(`Hàng đợi đã đạt giới hạn ${settings.maxQueueSize} bài.`);
  }
  const result = await player.play(voiceChannel, normalizedUrl, {
    requestedBy: requestedBy || undefined,
    nodeOptions: {
      volume: settings.defaultVolume,
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
    },
  });
  result.track.setMetadata({
    textChannelId,
    requestedById: requestedBy?.id || null,
    requestedByLabel: requestedBy?.username || requestedByLabel,
  });
  schedulePanelRefresh(guild.id);
  return { track: serializeTrack(result.track), state: getMusicState(guild.id) };
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
      queue.node.stop(true);
      break;
    case 'disconnect':
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
      queue.node.setVolume(clamp(value, 0, 100));
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

export function buildMusicPanelPayload(guildId) {
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
  if (!queueLines.length) queueLines.push('_Hàng đợi đang trống — hãy thêm một link YouTube._');

  const container = new ContainerBuilder().setAccentColor(accentFor(current ? 'success' : 'primary'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('music_wave')} CENAR MUSIC · CONTROL DECK`,
    `> ${E('cenar_verified')} YouTube Engine · 48 kHz Stereo · bitrate tự động theo phòng thoại`,
    '',
    current
      ? `## ${E('music_now')} [${plain(current.title)}](${current.url})`
      : `## ${E('music_now')} Chưa có bài hát đang phát`,
    current ? `**Kênh:** ${plain(current.author)} · **Yêu cầu:** ${plain(current.requestedBy)}` : '',
    current
      ? `\`${state.progress.currentLabel}\` ${queueProgress(state.progress.percent)} \`${state.progress.totalLabel}\``
      : `Kết nối vào phòng thoại, nhấn **Thêm bài** rồi dán link YouTube.`,
    '',
    `**Trạng thái:** ${state.paused ? 'Tạm dừng' : state.playing ? 'Đang phát' : 'Sẵn sàng'} · **Âm lượng:** ${state.volume}% · **${repeatLabel}** · **Shuffle:** ${state.shuffle ? 'Bật' : 'Tắt'}`,
    `**Phòng thoại:** ${state.voiceChannel ? `🔊 ${plain(state.voiceChannel.name)}` : 'Chưa kết nối'} · **Người nghe:** ${state.listeners.length} · **Ping:** ${state.ping}ms`,
    '',
    `### ${E('music_queue')} HÀNG ĐỢI · ${state.queue.length} BÀI`,
    ...queueLines,
    state.queue.length > 8 ? `-# Và ${state.queue.length - 8} bài khác trên Dashboard.` : '',
    '',
    `-# Cenar Music chỉ nhận link YouTube · tự rời phòng sau 3 phút không có người nghe`,
  ].filter(Boolean).join('\n').slice(0, 4000)));

  const add = setButtonEmoji(
    new ButtonBuilder().setCustomId('music:add').setLabel('Thêm bài').setStyle(ButtonStyle.Success),
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
    const modal = new ModalBuilder().setCustomId('music:add:modal').setTitle('Thêm nhạc vào Cenar Music');
    const input = new TextInputBuilder()
      .setCustomId('youtube_url')
      .setLabel('Link video hoặc playlist YouTube')
      .setPlaceholder('https://www.youtube.com/watch?v=...')
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
      await interaction.editReply(`Đã thêm **${plain(result.track.title)}** vào Cenar Music.`);
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

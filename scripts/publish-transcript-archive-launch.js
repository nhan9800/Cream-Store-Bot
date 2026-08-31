import 'dotenv/config';
import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
} from 'discord.js';
import {
  TRANSCRIPT_ARCHIVE_LAUNCH,
  buildTranscriptArchiveLaunchMessage,
  isTranscriptArchiveLaunchAnnouncement,
} from '../src/campaigns/transcriptArchiveLaunch2026.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

try {
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(process.env.BOT_TOKEN);
  await ready;

  const guild = client.guilds.cache.get(TRANSCRIPT_ARCHIVE_LAUNCH.guildId)
    || await client.guilds.fetch(TRANSCRIPT_ARCHIVE_LAUNCH.guildId);
  await guild.channels.fetch();
  await guild.emojis.fetch().catch(() => null);
  global.discordClient = client;

  const channel = await guild.channels.fetch(
    TRANSCRIPT_ARCHIVE_LAUNCH.announcementChannelId,
  );
  if (!channel?.isTextBased() || channel.isThread?.()) {
    throw new Error('Kênh thông báo không hợp lệ hoặc không thể gửi tin nhắn.');
  }

  const botMember = guild.members.me || await guild.members.fetchMe();
  const permissions = channel.permissionsFor(botMember);
  if (!permissions?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
  ])) {
    throw new Error('Bot thiếu quyền xem kênh, đọc lịch sử hoặc gửi thông báo.');
  }

  const payload = buildTranscriptArchiveLaunchMessage({ guildId: guild.id });
  const serialized = JSON.stringify(payload);
  if (
    serialized.includes('@everyone')
    || serialized.includes('@here')
    || payload.allowedMentions.parse.length
    || payload.allowedMentions.roles.length
    || payload.allowedMentions.users.length
  ) {
    throw new Error('Payload không đạt chính sách zero-mention; đã hủy đăng.');
  }

  const recentMessages = await channel.messages.fetch({ limit: 100 });
  const existing = recentMessages.find((message) => (
    isTranscriptArchiveLaunchAnnouncement(message, client.user.id)
  ));
  const message = existing
    ? await existing.edit(payload)
    : await channel.send(payload);

  console.log(JSON.stringify({
    action: existing ? 'updated' : 'created',
    messageId: message.id,
    channelId: channel.id,
    mentions: 'disabled',
    url: `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`,
  }, null, 2));
} finally {
  client.destroy();
}

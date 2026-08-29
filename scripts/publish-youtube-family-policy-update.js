import 'dotenv/config';
import fs from 'node:fs';
import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
} from 'discord.js';
import { initDatabase } from '../src/database/db.js';
import {
  YOUTUBE_FAMILY_POLICY_UPDATE,
  buildYoutubeFamilyPolicyMessage,
  isYoutubeFamilyPolicyAnnouncement,
} from '../src/campaigns/youtubeFamilyPolicyUpdate2026.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

const screenshotPath = process.env.YOUTUBE_POLICY_SCREENSHOT || process.argv[2];
if (!screenshotPath || !fs.existsSync(screenshotPath)) {
  throw new Error('Thiếu ảnh chính sách. Truyền đường dẫn qua YOUTUBE_POLICY_SCREENSHOT hoặc đối số đầu tiên.');
}

initDatabase();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

try {
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(process.env.BOT_TOKEN);
  await ready;

  const guild = client.guilds.cache.get(YOUTUBE_FAMILY_POLICY_UPDATE.guildId)
    || await client.guilds.fetch(YOUTUBE_FAMILY_POLICY_UPDATE.guildId);
  await guild.channels.fetch();
  await guild.emojis.fetch().catch(() => null);
  global.discordClient = client;

  const channel = await guild.channels.fetch(
    YOUTUBE_FAMILY_POLICY_UPDATE.announcementChannelId,
  );
  if (!channel?.isTextBased() || channel.isThread?.()) {
    throw new Error('Kênh thông báo không hợp lệ hoặc không thể gửi tin nhắn.');
  }

  const botMember = guild.members.me || await guild.members.fetchMe();
  const permissions = channel.permissionsFor(botMember);
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AttachFiles,
  ];
  if (!permissions?.has(required)) {
    throw new Error('Bot thiếu quyền xem kênh, gửi tin nhắn hoặc đính kèm tệp.');
  }

  const payload = buildYoutubeFamilyPolicyMessage({ guildId: guild.id });
  const file = {
    attachment: screenshotPath,
    name: YOUTUBE_FAMILY_POLICY_UPDATE.screenshotAttachmentName,
  };
  const recentMessages = await channel.messages.fetch({ limit: 100 });
  const existing = recentMessages.find((message) => (
    isYoutubeFamilyPolicyAnnouncement(message, client.user.id)
  ));

  const message = existing
    ? await existing.edit({ ...payload, attachments: [], files: [file] })
    : await channel.send({ ...payload, files: [file] });

  console.log(JSON.stringify({
    action: existing ? 'updated' : 'created',
    messageId: message.id,
    channelId: channel.id,
    url: `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`,
  }, null, 2));
} finally {
  client.destroy();
}

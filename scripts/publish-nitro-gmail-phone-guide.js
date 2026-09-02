import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
} from 'discord.js';
import { initDatabase } from '../src/database/db.js';
import { autoSyncGuildEmojis } from '../src/services/emojiService.js';
import {
  NITRO_GMAIL_PHONE_GUIDE,
  buildNitroGmailPhoneGuideMessage,
  isNitroGmailPhoneGuideMessage,
} from '../src/campaigns/nitroGmailPhoneGuide2026.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultScreenshotPath = path.resolve(
  scriptDir,
  '../assets/guides/nitro-gmail-device-phone-verification.png',
);
const screenshotPath = path.resolve(
  process.env.NITRO_GMAIL_PHONE_SCREENSHOT || process.argv[2] || defaultScreenshotPath,
);

if (!fs.existsSync(screenshotPath)) {
  throw new Error(`Không tìm thấy ảnh hướng dẫn tại: ${screenshotPath}`);
}

initDatabase();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

try {
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(process.env.BOT_TOKEN);
  await ready;

  const guild = client.guilds.cache.get(NITRO_GMAIL_PHONE_GUIDE.guildId)
    || await client.guilds.fetch(NITRO_GMAIL_PHONE_GUIDE.guildId);
  await guild.channels.fetch();
  await guild.emojis.fetch().catch(() => null);
  global.discordClient = client;

  const { updatedSlots } = autoSyncGuildEmojis(guild);
  if (updatedSlots.length) {
    console.log(`[EMOJI] Đã map slot: ${updatedSlots.join(', ')}`);
  }

  const channel = await guild.channels.fetch(NITRO_GMAIL_PHONE_GUIDE.nitroGuideChannelId);
  if (!channel?.isTextBased() || channel.isThread?.()) {
    throw new Error('Kênh hướng dẫn Nitro không hợp lệ hoặc không thể gửi tin nhắn.');
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

  const payload = buildNitroGmailPhoneGuideMessage({
    guildId: guild.id,
    attachmentName: NITRO_GMAIL_PHONE_GUIDE.screenshotAttachmentName,
  });
  const recentMessages = await channel.messages.fetch({ limit: 100 });
  const existing = recentMessages.find((message) => (
    isNitroGmailPhoneGuideMessage(message, client.user.id)
  ));
  const file = {
    attachment: screenshotPath,
    name: NITRO_GMAIL_PHONE_GUIDE.screenshotAttachmentName,
  };

  const message = existing
    ? await existing.edit({ ...payload, attachments: [], files: [file] })
    : await channel.send({ ...payload, files: [file] });

  console.log(JSON.stringify({
    action: existing ? 'updated' : 'created',
    messageId: message.id,
    channelId: channel.id,
    channelName: channel.name,
    attachmentName: NITRO_GMAIL_PHONE_GUIDE.screenshotAttachmentName,
    url: `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`,
  }, null, 2));
} finally {
  client.destroy();
}

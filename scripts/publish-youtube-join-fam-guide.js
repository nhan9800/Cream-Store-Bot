import 'dotenv/config';
import fs from 'node:fs';
import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
} from 'discord.js';
import { initDatabase } from '../src/database/db.js';
import { autoSyncGuildEmojis } from '../src/services/emojiService.js';
import {
  YOUTUBE_JOIN_FAM_GUIDE,
  buildYoutubeJoinFamGuideMessage,
  isYoutubeJoinFamGuideAnnouncement,
} from '../src/campaigns/youtubeJoinFamGuide2026.js';
import { syncYoutubeGuideEmojis } from './sync-youtube-guide-emojis.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

// Ảnh minh họa địa chỉ (hình 2) là TÙY CHỌN: có thì gắn vào MediaGallery,
// không có thì tin nhắn vẫn đầy đủ nội dung 3 bước.
const screenshotPath = process.env.YOUTUBE_JOIN_FAM_SCREENSHOT || process.argv[2] || null;
if (screenshotPath && !fs.existsSync(screenshotPath)) {
  throw new Error(`Không tìm thấy ảnh minh họa tại: ${screenshotPath}`);
}

initDatabase();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

try {
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(process.env.BOT_TOKEN);
  await ready;

  const guild = client.guilds.cache.get(YOUTUBE_JOIN_FAM_GUIDE.guildId)
    || await client.guilds.fetch(YOUTUBE_JOIN_FAM_GUIDE.guildId);
  await guild.channels.fetch();
  await guild.emojis.fetch().catch(() => null);
  global.discordClient = client;

  // 1) Tải emoji mới vào server · 2) map tên emoji cenar_yt_* vào slot guide_*
  //    trong database · 3) refresh cache để resolver nhìn thấy ngay.
  const synced = await syncYoutubeGuideEmojis(guild);
  for (const item of synced) {
    console.log(`[EMOJI] ${item.status.padEnd(7)} ${item.name} ${item.emoji}`);
  }
  await guild.emojis.fetch();
  const { updatedSlots } = autoSyncGuildEmojis(guild);
  if (updatedSlots.length) {
    console.log(`[EMOJI] Đã map slot: ${updatedSlots.join(', ')}`);
  }

  const channel = await guild.channels.fetch(
    YOUTUBE_JOIN_FAM_GUIDE.announcementChannelId,
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

  const payload = buildYoutubeJoinFamGuideMessage({
    guildId: guild.id,
    attachmentName: screenshotPath ? YOUTUBE_JOIN_FAM_GUIDE.screenshotAttachmentName : null,
  });

  const recentMessages = await channel.messages.fetch({ limit: 100 });
  const existing = recentMessages.find((message) => (
    isYoutubeJoinFamGuideAnnouncement(message, client.user.id)
  ));

  let message;
  if (existing) {
    message = screenshotPath
      ? await existing.edit({
        ...payload,
        attachments: [],
        files: [{ attachment: screenshotPath, name: YOUTUBE_JOIN_FAM_GUIDE.screenshotAttachmentName }],
      })
      : await existing.edit({ ...payload, attachments: [], files: [] });
  } else {
    message = await channel.send({
      ...payload,
      files: screenshotPath
        ? [{ attachment: screenshotPath, name: YOUTUBE_JOIN_FAM_GUIDE.screenshotAttachmentName }]
        : [],
    });
  }

  console.log(JSON.stringify({
    action: existing ? 'updated' : 'created',
    messageId: message.id,
    channelId: channel.id,
    screenshot: Boolean(screenshotPath),
    url: `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`,
  }, null, 2));
} finally {
  client.destroy();
}

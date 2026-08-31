import 'dotenv/config';
import {
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
} from 'discord.js';
import { initDatabase } from '../src/database/db.js';
import { autoSyncGuildEmojis } from '../src/services/emojiService.js';
import {
  YOUTUBE_STABILITY_TRANSITION,
  buildYoutubeStabilityTransitionMessage,
  isYoutubeStabilityTransitionAnnouncement,
} from '../src/campaigns/youtubeStabilityTransition2026.js';
import { syncYoutubeGuideEmojis } from './sync-youtube-guide-emojis.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

initDatabase();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

try {
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(process.env.BOT_TOKEN);
  await ready;

  const guild = client.guilds.cache.get(YOUTUBE_STABILITY_TRANSITION.guildId)
    || await client.guilds.fetch(YOUTUBE_STABILITY_TRANSITION.guildId);
  await guild.channels.fetch();
  const syncedEmojis = await syncYoutubeGuideEmojis(guild);
  await guild.emojis.fetch();
  global.discordClient = client;
  const { updatedSlots } = autoSyncGuildEmojis(guild);

  const channel = await guild.channels.fetch(
    YOUTUBE_STABILITY_TRANSITION.announcementChannelId,
  );
  if (!channel?.isTextBased() || channel.isThread?.()) {
    throw new Error('Kênh thông báo không hợp lệ hoặc không thể gửi tin nhắn.');
  }

  const botMember = guild.members.me || await guild.members.fetchMe();
  const permissions = channel.permissionsFor(botMember);
  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.MentionEveryone,
  ];
  if (!permissions?.has(required)) {
    throw new Error('Bot thiếu quyền xem kênh, gửi tin nhắn hoặc tag everyone.');
  }

  const payload = buildYoutubeStabilityTransitionMessage({ guildId: guild.id });
  const recentMessages = await channel.messages.fetch({ limit: 100 });
  const existing = recentMessages.find((message) => (
    isYoutubeStabilityTransitionAnnouncement(message, client.user.id)
  ));
  const message = existing
    ? await existing.edit(payload)
    : await channel.send(payload);

  console.log(JSON.stringify({
    action: existing ? 'updated' : 'created',
    messageId: message.id,
    channelId: channel.id,
    url: `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`,
    emojis: syncedEmojis,
    updatedEmojiSlots: updatedSlots,
  }, null, 2));
} finally {
  client.destroy();
}

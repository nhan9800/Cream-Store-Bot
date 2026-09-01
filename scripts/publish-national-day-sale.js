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
  NATIONAL_DAY_SALE,
  buildNationalDaySaleMessages,
  nationalDaySalePart,
  syncNationalDaySaleEmojis,
} from '../src/campaigns/nationalDaySale2026.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

initDatabase();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

try {
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(process.env.BOT_TOKEN);
  await ready;

  const guild = client.guilds.cache.get(NATIONAL_DAY_SALE.guildId)
    || await client.guilds.fetch(NATIONAL_DAY_SALE.guildId);
  await guild.channels.fetch();
  const campaignEmojis = await syncNationalDaySaleEmojis(guild);
  await guild.emojis.fetch();
  global.discordClient = client;
  const { updatedSlots } = autoSyncGuildEmojis(guild);

  const channel = await guild.channels.fetch(NATIONAL_DAY_SALE.promotionChannelId);
  if (!channel?.isTextBased() || channel.isThread?.()) {
    throw new Error('Kênh khuyến mãi không hợp lệ hoặc không thể gửi tin nhắn.');
  }
  const member = guild.members.me || await guild.members.fetchMe();
  if (!channel.permissionsFor(member)?.has([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.MentionEveryone,
  ])) {
    throw new Error('Bot thiếu quyền xem, gửi tin nhắn hoặc tag everyone tại kênh khuyến mãi.');
  }

  const payloads = buildNationalDaySaleMessages({
    guildId: guild.id,
    customEmojis: campaignEmojis,
  });
  const recent = await channel.messages.fetch({ limit: 100 });
  const results = [];

  for (let index = 0; index < payloads.length; index += 1) {
    const part = index + 1;
    const existing = recent.find((message) => (
      nationalDaySalePart(message, client.user.id) === part
    ));
    const message = existing
      ? await existing.edit(payloads[index])
      : await channel.send(payloads[index]);
    results.push({
      part,
      action: existing ? 'updated' : 'created',
      messageId: message.id,
      url: `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`,
      mentionEveryone: message.mentions.everyone,
      mentionedUsers: message.mentions.users.size,
      mentionedRoles: message.mentions.roles.size,
    });
  }

  // Chỉ dọn đúng các phần của chiến dịch này do chính bot đăng ở kênh cũ,
  // và chỉ sau khi cả ba phần đã xuất hiện thành công tại kênh khuyến mãi.
  const legacyChannel = await guild.channels.fetch(NATIONAL_DAY_SALE.legacyAnnouncementChannelId);
  const deletedLegacyMessages = [];
  if (legacyChannel?.isTextBased() && !legacyChannel.isThread?.()) {
    const legacyRecent = await legacyChannel.messages.fetch({ limit: 100 });
    const legacyCampaignMessages = legacyRecent.filter((message) => (
      nationalDaySalePart(message, client.user.id) !== null
    ));
    for (const message of legacyCampaignMessages.values()) {
      await message.delete();
      deletedLegacyMessages.push(message.id);
    }
  }

  console.log(JSON.stringify({
    guild: guild.name,
    channelId: channel.id,
    emojis: campaignEmojis,
    updatedEmojiSlots: updatedSlots,
    messages: results,
    deletedLegacyMessages,
  }, null, 2));
} finally {
  client.destroy();
}

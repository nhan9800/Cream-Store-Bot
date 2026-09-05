import { db, nowIso } from '../database/db.js';

export const PROMOTION_BOARD = Object.freeze({
  guildId: '1282637033340403754',
  channelId: '1515008584549797979',
  status: 'INACTIVE',
});

async function fetchAllMessages(channel, limit = 5000) {
  const messages = [];
  let before;
  while (messages.length < limit) {
    const page = await channel.messages.fetch({
      limit: Math.min(100, limit - messages.length),
      ...(before ? { before } : {}),
    });
    if (!page.size) break;
    const values = [...page.values()];
    messages.push(...values);
    before = values.at(-1)?.id;
    if (page.size < 100) break;
  }
  return messages;
}

export function isPromotionBoardMessage(message, botUserId) {
  return Boolean(botUserId) && String(message?.author?.id || '') === String(botUserId);
}

function endConfiguredSale(guildId) {
  const timestamp = nowIso();
  return db.transaction(() => {
    const restored = db.prepare(`
      UPDATE product_catalog
      SET price = original_price,
          original_price = 0,
          updated_at = ?
      WHERE guild_id = ? AND original_price > 0
    `).run(timestamp, guildId);
    const settings = db.prepare(`
      UPDATE guild_settings
      SET sale_percent = 0,
          sale_message_id = NULL,
          updated_at = ?
      WHERE guild_id = ?
    `).run(timestamp, guildId);
    return { restoredProducts: restored.changes, updatedSettings: settings.changes };
  })();
}

export async function clearPromotionChannel(client) {
  const campaign = PROMOTION_BOARD;
  const guild = client.guilds.cache.get(campaign.guildId)
    || await client.guilds.fetch(campaign.guildId).catch(() => null);
  if (!guild) throw new Error(`Không tìm thấy guild ${campaign.guildId}`);

  const channel = guild.channels.cache.get(campaign.channelId)
    || await guild.channels.fetch(campaign.channelId).catch(() => null);
  if (!channel?.isTextBased?.() || !channel.messages || channel.isThread?.()
    || !/khuyến-mãi|khuyen-mai/i.test(channel.name)) {
    throw new Error(`Kênh khuyến mãi ${campaign.channelId} không khả dụng hoặc không đúng tên`);
  }

  const messages = await fetchAllMessages(channel);
  const botMessages = messages.filter((message) => isPromotionBoardMessage(message, client.user.id));
  let deleted = 0;
  let failed = 0;
  for (const message of botMessages) {
    if (await message.delete().then(() => true).catch(() => false)) deleted += 1;
    else failed += 1;
  }
  const sale = endConfiguredSale(guild.id);
  return {
    status: failed ? 'partially_cleared' : 'cleared',
    channelId: channel.id,
    scanned: messages.length,
    deleted,
    failed,
    preservedNonBotMessages: messages.length - botMessages.length,
    ...sale,
  };
}

// Giữ tên export cũ để các script vận hành cũ không vô tình đăng lại sale.
// Khi không có chiến dịch đang hoạt động, mọi lời gọi đều chỉ dọn kênh.
export const publishPromotionBoard = clearPromotionChannel;

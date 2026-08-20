import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import {
  PROMOTION_BOARD,
  buildPromotionBoardPayload,
  isPromotionBoardMessage,
} from '../src/campaigns/promotionBoard2026.js';
import { initDatabase } from '../src/database/db.js';
import { publishPriceBoard } from '../src/services/autoSetupPriceBoardService.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

initDatabase();

async function fetchAllMessages(channel, limit = 500) {
  const collected = [];
  let before;
  while (collected.length < limit) {
    const page = await channel.messages.fetch({
      limit: Math.min(100, limit - collected.length),
      ...(before ? { before } : {}),
    });
    if (!page.size) break;
    collected.push(...page.values());
    before = page.last().id;
    if (page.size < 100) break;
  }
  return collected;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

try {
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(process.env.BOT_TOKEN);
  await ready;
  const guild = client.guilds.cache.get(PROMOTION_BOARD.guildId)
    || await client.guilds.fetch(PROMOTION_BOARD.guildId);
  await guild.emojis.fetch().catch(() => null);
  global.discordClient = client;

  const channel = await guild.channels.fetch(PROMOTION_BOARD.channelId);
  if (!channel?.isTextBased() || channel.isThread?.() || !/khuyến-mãi|khuyen-mai/i.test(channel.name)) {
    throw new Error('Kênh khuyến mãi không hợp lệ; đã dừng để tránh xoá nhầm dữ liệu.');
  }

  const oldMessages = await fetchAllMessages(channel);
  const existing = oldMessages.find((message) => (
    isPromotionBoardMessage(message, client.user.id)
  ));
  const payload = buildPromotionBoardPayload();
  const message = existing
    ? await existing.edit(payload)
    : await channel.send(payload);

  await message.pin().catch((error) => {
    console.warn(`[PROMOTION] Không thể ghim tin ${message.id}: ${error.message}`);
  });

  let deleted = 0;
  for (const oldMessage of oldMessages) {
    if (oldMessage.author.id !== client.user.id || oldMessage.id === message.id) continue;
    if (await oldMessage.delete().then(() => true).catch(() => false)) deleted += 1;
  }

  const priceBoard = await publishPriceBoard(guild, { force: true });

  console.log(JSON.stringify({
    action: existing ? 'updated' : 'created',
    channelId: channel.id,
    messageId: message.id,
    messageUrl: `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`,
    deletedOldBotMessages: deleted,
    preservedNonBotMessages: oldMessages.filter((item) => item.author.id !== client.user.id).length,
    priceBoard,
  }, null, 2));
} finally {
  client.destroy();
}

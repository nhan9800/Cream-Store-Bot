import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { initDatabase } from '../src/database/db.js';
import { getActiveProducts } from '../src/services/productCatalogService.js';
import {
  AI_CREATIVE_PRICING_UPDATE,
  buildAiCreativePricingAnnouncement,
  isAiCreativePricingAnnouncement,
} from '../src/campaigns/aiCreativePricingUpdate2026.js';
import {
  buildAnnouncementMessageV2,
  publishAnnouncement,
} from '../src/services/announcementService.js';
import { publishPriceBoard } from '../src/services/autoSetupPriceBoardService.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

initDatabase();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

try {
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(process.env.BOT_TOKEN);
  await ready;
  const guild = client.guilds.cache.get(AI_CREATIVE_PRICING_UPDATE.guildId)
    || await client.guilds.fetch(AI_CREATIVE_PRICING_UPDATE.guildId);
  await guild.channels.fetch();
  await guild.emojis.fetch().catch(() => null);
  global.discordClient = client;

  const channel = await guild.channels.fetch(AI_CREATIVE_PRICING_UPDATE.announcementChannelId);
  if (!channel?.isTextBased() || channel.isThread?.()) {
    throw new Error('Kênh thông báo không hợp lệ hoặc không thể gửi tin nhắn.');
  }

  const products = getActiveProducts(guild.id);
  const content = buildAiCreativePricingAnnouncement(guild.id, products);
  const recentMessages = await channel.messages.fetch({ limit: 100 });
  const existing = recentMessages.find((message) => (
    isAiCreativePricingAnnouncement(message, client.user.id)
  ));

  let message;
  let priceBoard;
  if (existing) {
    message = await existing.edit(buildAnnouncementMessageV2({
      guildId: guild.id,
      content,
      tagEveryone: true,
    }));
    priceBoard = await publishPriceBoard(guild, {
      force: true,
      keepMessageIds: [message.id],
    });
  } else {
    const result = await publishAnnouncement({
      guild,
      channelId: channel.id,
      content,
      tagEveryone: true,
    });
    message = result.message;
    priceBoard = result.priceBoard;
  }

  console.log(JSON.stringify({
    action: existing ? 'updated' : 'created',
    announcementMessageId: message.id,
    announcementUrl: `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`,
    priceBoard,
  }, null, 2));
} finally {
  client.destroy();
}

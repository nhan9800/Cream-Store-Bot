import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { initDatabase } from '../src/database/db.js';
import { getActiveProducts } from '../src/services/productCatalogService.js';
import { autoSyncGuildEmojis } from '../src/services/emojiService.js';
import { publishPriceBoard } from '../src/services/autoSetupPriceBoardService.js';
import { publishCtvPricePanel } from '../src/services/ctvPriceService.js';
import { buildAnnouncementMessageV2 } from '../src/services/announcementService.js';
import {
  buildAiCreativePricingAnnouncement,
  isAiCreativePricingAnnouncement,
} from '../src/campaigns/aiCreativePricingUpdate2026.js';
import {
  NATIONAL_DAY_SALE,
  buildNationalDaySaleMessages,
  nationalDaySalePart,
  syncNationalDaySaleEmojis,
} from '../src/campaigns/nationalDaySale2026.js';
import { publishPromotionBoard } from '../src/campaigns/promotionBoard2026.js';
import {
  GEMINI_PRICING_UPDATE,
  buildGeminiPricingUpdateMessage,
  isGeminiPricingUpdateMessage,
} from '../src/campaigns/geminiPricingUpdate2026.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

initDatabase();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

try {
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(process.env.BOT_TOKEN);
  await ready;

  const guild = client.guilds.cache.get(GEMINI_PRICING_UPDATE.guildId)
    || await client.guilds.fetch(GEMINI_PRICING_UPDATE.guildId);
  await guild.channels.fetch();
  await guild.emojis.fetch().catch(() => null);
  global.discordClient = client;
  autoSyncGuildEmojis(guild);

  const products = getActiveProducts(guild.id);
  const gemini = products.filter((product) => /gemini/i.test(product.name));
  const expectedPrices = new Map([
    ['gemini-pro-google-one-5tb-12-months-full-warranty', 250_000],
    ['gemini-pro-google-one-5tb-18-months-full-warranty', 280_000],
  ]);
  if (gemini.length !== 2 || gemini.some((product) => (
    expectedPrices.get(product.product_key) !== Number(product.price)
  ))) {
    throw new Error(`Catalog Gemini chưa đúng 2 gói giá mới: ${JSON.stringify(gemini.map((product) => ({
      key: product.product_key,
      price: product.price,
      active: product.is_active,
    })))}`);
  }

  // Đồng bộ bảng giá chính trước khi phát thông báo để mọi link khách mở đều
  // hiển thị đúng hai gói mới ngay lập tức.
  const priceBoard = await publishPriceBoard(guild, { force: true });

  // Cập nhật bảng khuyến mãi ghim cũ mà không đụng tới các bài sale 2/9.
  const promotionBoard = await publishPromotionBoard(client);
  const ctvPriceBoard = await publishCtvPricePanel(guild);

  // Sửa phần Gemini của bài sale 2/9 đang hoạt động, giữ nguyên hai phần còn lại.
  const saleEmojis = await syncNationalDaySaleEmojis(guild);
  const salePayload = buildNationalDaySaleMessages({
    guildId: guild.id,
    customEmojis: saleEmojis,
  })[1];
  const promotionChannel = await guild.channels.fetch(NATIONAL_DAY_SALE.promotionChannelId);
  const promotionMessages = await promotionChannel.messages.fetch({ limit: 100 });
  const salePartTwo = promotionMessages.find((message) => (
    nationalDaySalePart(message, client.user.id) === 2
  ));
  if (!salePartTwo) throw new Error('Không tìm thấy phần 2 của bảng sale 2/9 để cập nhật Gemini.');
  await salePartTwo.edit(salePayload);

  // Loại gói phương thức cũ khỏi thông báo danh mục AI đã đăng trước đây.
  const announcementChannel = await guild.channels.fetch(
    GEMINI_PRICING_UPDATE.announcementChannelId,
  );
  const recentAnnouncements = await announcementChannel.messages.fetch({ limit: 100 });
  const aiCatalogMessage = recentAnnouncements.find((message) => (
    isAiCreativePricingAnnouncement(message, client.user.id)
  ));
  if (aiCatalogMessage) {
    await aiCatalogMessage.edit(buildAnnouncementMessageV2({
      guildId: guild.id,
      content: buildAiCreativePricingAnnouncement(guild.id, products),
      tagEveryone: true,
    }));
  }

  // Đăng sau cùng: khách nhận thông báo khi website/catalog/bảng giá đã nhất quán.
  const current = recentAnnouncements.find((message) => (
    isGeminiPricingUpdateMessage(message, client.user.id)
  ));
  const announcementPayload = buildGeminiPricingUpdateMessage({ guildId: guild.id });
  const message = current
    ? await current.edit(announcementPayload)
    : await announcementChannel.send(announcementPayload);

  console.log(JSON.stringify({
    action: current ? 'updated' : 'created',
    announcementMessageId: message.id,
    announcementUrl: `https://discord.com/channels/${guild.id}/${announcementChannel.id}/${message.id}`,
    mentionedEveryone: message.mentions.everyone,
    activeGemini: gemini.map((product) => ({
      key: product.product_key,
      price: product.price,
      warranty: product.warranty_policy,
    })),
    priceBoard,
    promotionBoard,
    ctvPriceBoard: ctvPriceBoard.id,
    nationalDaySalePartTwo: salePartTwo.id,
    aiCatalogMessage: aiCatalogMessage?.id || null,
  }, null, 2));
} finally {
  client.destroy();
}

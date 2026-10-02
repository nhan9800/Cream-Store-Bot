import { getActiveProducts } from './productCatalogService.js';
import { getGuildConfig } from './guildConfigService.js';
import { config } from '../config.js';
import { getPriceBoardProducts, PRICE_BOARD_VERSION, priceBoardInternals } from './autoSetupPriceBoardService.js';
import {
  DAILY_COLOR_SALE, DAILY_COLOR_SALE_EMOJIS, dailyColorSalePart,
  dailyFlashSaleDateFromMessage, dailySaleDateKey,
} from '../campaigns/dailyColorSale2026.js';

function publicText(message) {
  const json = message.toJSON();
  const parts = [json.content || ''];
  function visit(component) {
    if (typeof component.content === 'string') parts.push(component.content);
    for (const child of component.components || []) visit(child);
  }
  for (const component of json.components || []) visit(component);
  for (const embed of json.embeds || []) {
    parts.push(embed.title || '', embed.description || '', embed.footer?.text || '');
    for (const field of embed.fields || []) parts.push(field.name || '', field.value || '');
  }
  return parts.filter(Boolean).join('\n');
}

async function inspectBoard(channel, botId, select) {
  if (!channel?.isTextBased?.()) return { available: false, messages: [] };
  const selected = [];
  let before;
  // Only return public bot-authored catalog/campaign content, never ticket data.
  for (let scanned = 0; scanned < 500;) {
    const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!messages.size) break;
    for (const message of messages.values()) {
      if (message.author?.id === botId && select(message)) {
        selected.push({ id: message.id, url: message.url, text: publicText(message) });
      }
    }
    scanned += messages.size;
    before = [...messages.values()].at(-1)?.id;
    if (messages.size < 100) break;
  }
  return { available: true, messages: selected };
}

export async function getCatalogPublicationStatus(client, { date = new Date() } = {}) {
  if (!client?.isReady?.()) throw new Error('DISCORD_NOT_READY');
  const guild = await client.guilds.fetch(config.guildId);
  const priceChannel = await priceBoardInternals.findPriceChannel(guild, getGuildConfig(guild.id));
  const priceBoard = await inspectBoard(priceChannel, client.user.id,
    (message) => JSON.stringify(message.toJSON()).includes(PRICE_BOARD_VERSION));
  const data = {
    version: PRICE_BOARD_VERSION,
    catalog: getPriceBoardProducts(getActiveProducts(guild.id))
      .filter((product) => /chat\s*gpt|claude/i.test(product.name || ''))
      .map((product) => ({
        key: product.product_key, name: product.name, price: product.price,
        warranty: product.warranty_policy, activation: product.activation_method,
      })),
    priceBoard,
  };
  if (guild.id === DAILY_COLOR_SALE.guildId) {
    const channel = await guild.channels.fetch(DAILY_COLOR_SALE.promotionChannelId);
    const today = dailySaleDateKey(date);
    const promotion = await inspectBoard(channel, client.user.id, (message) => (
      dailyColorSalePart(message, client.user.id)
      || dailyFlashSaleDateFromMessage(message, client.user.id) === today
    ));
    await guild.emojis.fetch();
    data.promotion = {
      ...promotion, date: today, revision: DAILY_COLOR_SALE.revision,
      emojis: DAILY_COLOR_SALE_EMOJIS.map(({ name }) => ({
        name, available: Boolean(guild.emojis.cache.find((emoji) => emoji.name === name)),
      })),
    };
  }
  return data;
}

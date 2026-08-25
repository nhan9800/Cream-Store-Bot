import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { getActiveProducts } from './productCatalogService.js';
import { getCtvSettings, setCtvPriceMessages } from './ctvService.js';
import { resolveProductEmoji } from './emojiService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { formatCurrency } from '../utils/formatters.js';
import { accentFor } from '../utils/uiKit.js';
import { isInternationalGuild, STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { formatInternationalPrice, translateProductName } from '../utils/internationalCatalog.js';

const CUSTOM_EMOJI_RE = /^<a?:[a-zA-Z0-9_]+:\d+>$/;
export const CTV_OFFICIAL_PRICE_CHANNEL_ID = '1535669791660974141';
export const CTV_OFFICIAL_PANEL_MARKER = 'CENAR-CTV-PRICE-BOARD-V2';

export const CTV_OFFICIAL_PRICE_CATALOG = Object.freeze({
  nitro: Object.freeze([
    { label: 'Nitro Boost Login 1 Tháng', price: 85_000 },
    { label: 'Nitro Boost Login 2 Tháng', price: 95_000 },
    { label: 'Nitro Boost Login 4 Tháng', price: 185_000 },
    { label: 'Nitro Boost Login 6 Tháng', price: 365_000 },
    { label: 'Nitro Boost Login 8 Tháng', price: 460_000 },
    { label: 'Nitro Boost Login 12 Tháng · Gia hạn 2 tháng/lần (Auto)', price: 580_000 },
    { label: 'Nitro Boost Login 12 Tháng · Nâng cấp một lần', price: 795_000 },
    { label: 'Nitro Trial 3 Tháng · Ưu đãi lần đầu', price: 45_000 },
  ]),
  boost: Object.freeze([
    { label: 'Boost Server 1 Tháng', price: 90_000 },
    { label: 'Boost Server 3 Tháng', price: 240_000 },
  ]),
  gemini: Object.freeze([
    { label: 'Gemini Pro + 5 TB Google One 12 Tháng', price: 80_000 },
    { label: 'Gemini Pro + 5 TB Google One 18 Tháng', price: 100_000 },
  ]),
  spotify: Object.freeze([
    { label: 'Spotify Premium Add Family 3 Tháng', price: 80_000 },
    { label: 'Spotify Premium Add Family 6 Tháng', price: 160_000 },
    { label: 'Spotify Premium Add Family 12 Tháng', price: 260_000 },
  ]),
});

function customProductEmoji(guildId, value, E) {
  const resolved = resolveProductEmoji(guildId, value);
  if (CUSTOM_EMOJI_RE.test(resolved)) return resolved;
  return E('cenar_price');
}

function splitLines(lines, maxLength = 3600) {
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function officialPriceLines(items, emoji, E) {
  return items.map((item) => `${emoji} **${item.label}**\n> ${E('cenar_wallet')} Giá CTV: **${formatCurrency(item.price)}**`).join('\n');
}

function buildOfficialCtvPricePanel(guildId) {
  const E = createEmojiResolver(guildId);
  const header = new ContainerBuilder().setAccentColor(accentFor('primary'));
  header.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('ctv_crystal')} CENAR CTV · BẢNG GIÁ NỘI BỘ`,
    `${E('cenar_verified')} Bảng giá chính thức dành riêng cho CTV đã được duyệt tại **Cenar Store**.`,
    `-# ${CTV_OFFICIAL_PANEL_MARKER} · Cập nhật ngày 25/08/2026`,
  ].join('\n')));

  const nitro = new ContainerBuilder().setAccentColor(accentFor('primary'));
  nitro.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${E('brand_nitro')} Nitro Boost Login`));
  nitro.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  nitro.addTextDisplayComponents(new TextDisplayBuilder().setContent(officialPriceLines(
    CTV_OFFICIAL_PRICE_CATALOG.nitro,
    E('brand_nitro'),
    E,
  )));
  nitro.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  nitro.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('status_warn')} **Điều kiện Nitro Trial 3 Tháng:**`,
    `${E('cenar_verified')} Tài khoản được tạo trên **1 tháng** và **chưa từng sử dụng Nitro**;`,
    `${E('cenar_verified')} Hoặc tài khoản đã từng dùng Nitro nhưng **không sử dụng lại trong ít nhất 12 tháng liên tục**.`,
  ].join('\n')));

  const services = new ContainerBuilder().setAccentColor(accentFor('success'));
  services.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('brand_boost')} Boost Server`,
    officialPriceLines(CTV_OFFICIAL_PRICE_CATALOG.boost, E('brand_boost'), E),
    '',
    `## ${E('brand_gemini')} Gemini Pro + 5 TB Google One`,
    officialPriceLines(CTV_OFFICIAL_PRICE_CATALOG.gemini, E('brand_gemini'), E),
  ].join('\n')));

  const spotify = new ContainerBuilder().setAccentColor(accentFor('warning'));
  spotify.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${E('brand_spotify')} Spotify Premium · Add Family`));
  spotify.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  spotify.addTextDisplayComponents(new TextDisplayBuilder().setContent(officialPriceLines(
    CTV_OFFICIAL_PRICE_CATALOG.spotify,
    E('brand_spotify'),
    E,
  )));
  spotify.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  spotify.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('cenar_support')} Giá trên chỉ áp dụng cho tài khoản đã được duyệt role **CTV**.`,
    `${E('cenar_cooldown')} Nguồn hàng và thời gian bàn giao được xác nhận tại thời điểm tạo đơn.`,
    `${E('cenar_price')} Hãy dùng nút bên dưới để mở ticket và gửi đúng gói cần nhập.`,
  ].join('\n')));

  const orderButton = new ButtonBuilder()
    .setCustomId('ticket:create:ORDER')
    .setLabel('Tạo đơn CTV')
    .setStyle(ButtonStyle.Success);
  const orderEmoji = E.component('ticket_open') || E.component('cenar_ctv');
  if (orderEmoji) orderButton.setEmoji(orderEmoji);

  return {
    components: [
      header,
      nitro,
      services,
      spotify,
      new ActionRowBuilder().addComponents(orderButton),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function messageComponentText(message) {
  const rawComponents = (message?.components || []).map((component) => (
    typeof component?.toJSON === 'function' ? component.toJSON() : component
  ));
  return `${message?.content || ''}\n${JSON.stringify(rawComponents)}`;
}

export function isCtvPricePanelMessage(message, botUserId = null) {
  if (!message) return false;
  if (botUserId && String(message.author?.id || '') !== String(botUserId)) return false;
  const text = messageComponentText(message);
  return text.includes(CTV_OFFICIAL_PANEL_MARKER)
    || text.includes('CENAR CTV | Bảng giá nội bộ')
    || text.includes('CENAR CTV · BẢNG GIÁ NỘI BỘ');
}

export function buildCtvPricePages(guildId) {
  if (String(guildId) === STORE_ONE_GUILD_ID) {
    return [buildOfficialCtvPricePanel(guildId)];
  }
  const E = createEmojiResolver(guildId);
  const international = isInternationalGuild(guildId);
  const products = getActiveProducts(guildId);
  const lines = products.length
    ? products.map((product) => {
        const retail = Number(product.price || 0);
        const ctvPrice = product.ctv_price === null ? retail : Number(product.ctv_price || 0);
        const saving = Math.max(0, retail - ctvPrice);
        const discount = retail > 0 && saving > 0 ? Math.round((saving / retail) * 100) : 0;
        const duration = Number(product.duration_months || 1);
        const suffix = discount > 0 ? ` · -${discount}%` : '';
        return `${customProductEmoji(guildId, product.emoji, E)} **${international ? translateProductName(product.name) : product.name}** · **${international ? formatInternationalPrice(ctvPrice) : formatCurrency(ctvPrice)}** · ${duration}${international ? ' mo' : 'T'}${suffix}`;
      })
    : [`${E('cenar_cooldown')} ${international ? 'Pricing is being updated. Please check again shortly.' : 'Bảng giá đang được cập nhật. Vui lòng quay lại sau.'}`];
  const chunks = splitLines(lines, 2750);

  return chunks.map((chunk, index) => {
    const container = new ContainerBuilder().setAccentColor(accentFor('primary'));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      international ? `# ${E('cenar_ctv')} CENAR AFFILIATE | PRIVATE PRICING` : `# ${E('cenar_ctv')} CENAR CTV | Bảng giá nội bộ`,
      international ? `${E('cenar_verified')} Page **${index + 1}/${chunks.length}** · ${products.length} active products` : `${E('cenar_verified')} Trang **${index + 1}/${chunks.length}** · ${products.length} sản phẩm đang hoạt động`,
      international ? `-# Live data synchronized with the Cenar Global catalog.` : `-# Dữ liệu đồng bộ trực tiếp với catalog bán hàng của Cenar Store.`,
    ].join('\n')));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      international ? `${E('cenar_support')} Affiliate pricing is applied automatically to approved accounts.` : `${E('cenar_support')} Giá CTV được tự động áp dụng khi tài khoản có role CTV.`,
      international ? `${E('cenar_wallet')} Prices follow inventory conditions and synchronize after each Admin update.` : `${E('cenar_wallet')} Giá thay đổi theo nguồn hàng và được đồng bộ sau mỗi lần Admin chỉnh sửa.`,
    ].join('\n')));

    const buyButton = new ButtonBuilder()
      .setCustomId('ticket:create:ORDER')
      .setLabel(international ? 'Create Affiliate Order' : 'Tạo đơn CTV')
      .setStyle(ButtonStyle.Success);
    const buttonEmoji = E.component('cenar_ctv');
    if (buttonEmoji) buyButton.setEmoji(buttonEmoji);
    return {
      components: [container, new ActionRowBuilder().addComponents(buyButton)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    };
  });
}

export function buildCtvPricePanel(guildId) {
  return buildCtvPricePages(guildId)[0];
}

export async function publishCtvPricePanel(guild, { forceNew = false } = {}) {
  const settings = getCtvSettings(guild.id);
  const configuredChannelId = String(guild.id) === STORE_ONE_GUILD_ID
    ? CTV_OFFICIAL_PRICE_CHANNEL_ID
    : settings.price_channel_id;
  const channel = configuredChannelId
    ? await guild.channels.fetch(configuredChannelId).catch(() => null)
    : null;
  if (!channel?.isTextBased()) throw new Error('Kênh bảng giá CTV chưa được cấu hình.');

  const payloads = buildCtvPricePages(guild.id);
  let savedIds = [];
  if (!forceNew && settings.price_message_ids) {
    try {
      const parsed = JSON.parse(settings.price_message_ids);
      if (Array.isArray(parsed)) savedIds = parsed.map(String);
    } catch {}
  }
  if (!savedIds.length && settings.price_message_id) savedIds = [settings.price_message_id];

  if (String(guild.id) === STORE_ONE_GUILD_ID) {
    const savedMessages = await Promise.all(savedIds.map((id) => channel.messages.fetch(id).catch(() => null)));
    const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    const botUserId = guild.client?.user?.id || guild.members?.me?.id || null;
    const panelMessages = new Map();
    for (const message of savedMessages) {
      if (isCtvPricePanelMessage(message, botUserId)) panelMessages.set(message.id, message);
    }
    for (const message of recent?.values?.() || []) {
      if (isCtvPricePanelMessage(message, botUserId)) panelMessages.set(message.id, message);
    }

    const officialExisting = forceNew ? null : [...panelMessages.values()]
      .find((message) => messageComponentText(message).includes(CTV_OFFICIAL_PANEL_MARKER));
    const primaryMessage = officialExisting
      ? await officialExisting.edit(payloads[0])
      : await channel.send(payloads[0]);

    for (const duplicate of panelMessages.values()) {
      if (duplicate.id === primaryMessage.id) continue;
      await duplicate.delete('Remove obsolete or duplicated CTV price board').catch(() => null);
    }
    setCtvPriceMessages(guild.id, [primaryMessage.id]);
    return primaryMessage;
  }

  const existingMessages = [];
  for (const id of savedIds) {
    existingMessages.push(await channel.messages.fetch(id).catch(() => null));
  }
  const messages = [];
  for (let index = 0; index < payloads.length; index += 1) {
    const existing = forceNew ? null : existingMessages[index];
    messages.push(existing ? await existing.edit(payloads[index]) : await channel.send(payloads[index]));
  }
  for (const extra of existingMessages.slice(payloads.length).filter(Boolean)) {
    await extra.delete('Remove obsolete CTV price page').catch(() => null);
  }
  setCtvPriceMessages(guild.id, messages.map((message) => message.id));
  return messages[0];
}

export function normalizeCatalogEmoji(guild, raw, E) {
  const value = String(raw || '').trim();
  if (!value) return E('cenar_price');
  const custom = value.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
  if (custom) {
    const emoji = guild.emojis.cache.get(custom[3]);
    if (!emoji) throw new Error('Emoji custom này không thuộc máy chủ hiện tại.');
    return emoji.toString();
  }
  const byName = guild.emojis.cache.find((emoji) => emoji.name.toLowerCase() === value.replace(/^:|:$/g, '').toLowerCase());
  if (byName) return byName.toString();
  const bySlot = E(value);
  if (CUSTOM_EMOJI_RE.test(bySlot)) return bySlot;
  throw new Error('Chỉ chấp nhận emoji custom của máy chủ, tên emoji custom hoặc slot emoji hợp lệ.');
}

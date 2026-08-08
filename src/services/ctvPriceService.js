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

const CUSTOM_EMOJI_RE = /^<a?:[a-zA-Z0-9_]+:\d+>$/;

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

export function buildCtvPricePages(guildId) {
  const E = createEmojiResolver(guildId);
  const products = getActiveProducts(guildId);
  const lines = products.length
    ? products.map((product) => {
        const retail = Number(product.price || 0);
        const ctvPrice = product.ctv_price === null ? retail : Number(product.ctv_price || 0);
        const saving = Math.max(0, retail - ctvPrice);
        const discount = retail > 0 && saving > 0 ? Math.round((saving / retail) * 100) : 0;
        const duration = Number(product.duration_months || 1);
        const suffix = discount > 0 ? ` · -${discount}%` : '';
        return `${customProductEmoji(guildId, product.emoji, E)} **${product.name}** · **${formatCurrency(ctvPrice)}** · ${duration}T${suffix}`;
      })
    : [`${E('cenar_cooldown')} Bảng giá đang được cập nhật. Vui lòng quay lại sau.`];
  const chunks = splitLines(lines, 2750);

  return chunks.map((chunk, index) => {
    const container = new ContainerBuilder().setAccentColor(accentFor('primary'));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `# ${E('cenar_ctv')} CENAR CTV | Bảng giá nội bộ`,
      `${E('cenar_verified')} Trang **${index + 1}/${chunks.length}** · ${products.length} sản phẩm đang hoạt động`,
      `-# Dữ liệu đồng bộ trực tiếp với catalog bán hàng của Cenar Store.`,
    ].join('\n')));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `${E('cenar_support')} Giá CTV được tự động áp dụng khi tài khoản có role CTV.`,
      `${E('cenar_wallet')} Giá thay đổi theo nguồn hàng và được đồng bộ sau mỗi lần Admin chỉnh sửa.`,
    ].join('\n')));

    const buyButton = new ButtonBuilder()
      .setCustomId('ticket:create:ORDER')
      .setLabel('Tạo đơn CTV')
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
  const channel = settings.price_channel_id
    ? await guild.channels.fetch(settings.price_channel_id).catch(() => null)
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

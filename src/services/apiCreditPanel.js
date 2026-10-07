import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, StringSelectMenuBuilder,
} from 'discord.js';
import { API_CREDIT_DURATION, API_CREDIT_BANNER, getApiCreditProducts } from '../config/apiCreditCatalog.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';

export function buildApiCreditSelector(products) {
  const packs = getApiCreditProducts(products);
  if (!packs.length) return null;
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId('product:claude:credit_select')
    .setPlaceholder('Chọn mức credit để mua')
    .setMinValues(1).setMaxValues(1)
    .addOptions(packs.map((product) => ({
      label: `$${product.quota_value} credit · ${Number(product.price).toLocaleString('vi-VN')}đ`,
      value: String(product.id), description: 'Không giới hạn ngày · Dùng đến hết credit',
    }))));
}

export function buildApiCreditPanel(guildId, products, hasBanner = true) {
  const packs = getApiCreditProducts(products);
  const selector = buildApiCreditSelector(packs);
  if (!selector) return null;
  const E = createEmojiResolver(guildId);
  const container = new ContainerBuilder().setAccentColor(0x76E0B6);
  if (hasBanner) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(`attachment://${API_CREDIT_BANNER}`).setDescription('Cenar Store · API Codex/Claude credit'),
  ));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('brand_claude')} API AI CREDIT`,
    '**Codex / Claude · Chọn credit, dùng theo nhu cầu**',
    '',
    ...packs.map((product) => `**$${product.quota_value} credit**  →  **${Number(product.price).toLocaleString('vi-VN')}đ**`),
    '',
    `> ${E('icon_duration')} ${API_CREDIT_DURATION}.`,
    '-# Token/API riêng · Giao và hướng dẫn trong ticket · Bảo hành đến hết credit',
  ].join('\n')));
  const actions = new ActionRowBuilder().addComponents(
    withButtonEmoji(new ButtonBuilder().setCustomId('product:claude:pricing').setLabel('Bảng giá').setStyle(ButtonStyle.Secondary), E.component('payment_money')),
    withButtonEmoji(new ButtonBuilder().setCustomId('product:claude:models').setLabel('Hướng dẫn & Models').setStyle(ButtonStyle.Secondary), E.component('icon_key')),
    withButtonEmoji(new ButtonBuilder().setCustomId('product:claude:policy').setLabel('Điều khoản').setStyle(ButtonStyle.Secondary), E.component('warranty_shield')),
  );
  return { components: [container, selector, actions], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

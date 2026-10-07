import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder, MessageFlags, StringSelectMenuBuilder,
} from 'discord.js';
import { API_CREDIT_DURATION, API_CREDIT_BANNER, getApiCreditProducts } from '../config/apiCreditCatalog.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';

export function buildApiCreditSelector(products, guildId) {
  const packs = getApiCreditProducts(products);
  if (!packs.length) return null;
  const E = createEmojiResolver(guildId);
  const emoji = E.component('brand_claude') || E.component('icon_brain');
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId('product:claude:credit_select')
    .setPlaceholder('Chọn mức credit để mua')
    .setMinValues(1).setMaxValues(1)
    .addOptions(packs.map((product) => ({
      label: `$${product.quota_value} credit · ${Number(product.price).toLocaleString('vi-VN')}đ`,
      value: String(product.id), description: 'Không giới hạn ngày · Dùng đến hết credit',
      ...(emoji ? { emoji } : {}),
    }))));
}

function buildPriceText(guildId, packs) {
  const E = createEmojiResolver(guildId);
  return [
    `## ${E('brand_claude') || E('icon_brain')} API CODEX / CLAUDE`,
    `> ${E('icon_duration')} **Không giới hạn ngày** · Dùng đến hết credit.`,
    '',
    ...packs.map((product) => `${E('icon_price')} **$${product.quota_value} credit** · \`${Number(product.price).toLocaleString('vi-VN')}đ\``),
    '',
    `${E('icon_key')} Token/API riêng · Giao và hướng dẫn trong **ticket**.`,
    `-# ${E('warranty_shield')} Bảo hành đến hết credit · Chọn gói ở menu bên dưới.`,
  ].join('\n');
}

export function buildApiCreditPricingReply(guildId, products) {
  const packs = getApiCreditProducts(products);
  const selector = buildApiCreditSelector(packs, guildId);
  const E = createEmojiResolver(guildId);
  const container = new ContainerBuilder().setAccentColor(0x76E0B6)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(selector
      ? buildPriceText(guildId, packs)
      : `## ${E('brand_claude') || E('icon_brain')} API CODEX / CLAUDE\n${E('status_warn')} Gói đang được cập nhật. Vui lòng liên hệ hỗ trợ.`));
  return { components: [container, ...(selector ? [selector] : [])], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

export function buildApiCreditDetails(guildId, page) {
  const E = createEmojiResolver(guildId);
  const lines = page === 'models' ? [
    `## ${E('icon_book')} HƯỚNG DẪN API`,
    `> ${E('brand_claude') || E('icon_brain')} **Codex / Claude** · Kết nối bằng token/API riêng.`,
    '',
    `${E('icon_ticket')} Sau thanh toán, nhận **token, địa chỉ kết nối và hướng dẫn** trong ticket.`,
    `${E('icon_brain')} Shop xác nhận **model khả dụng** trước khi giao; model và mức tiêu hao theo hệ thống nhà cung cấp.`,
    `${E('icon_key')} Giữ token riêng tư, không đăng vào kênh công khai.`,
    `-# ${E('icon_duration')} ${API_CREDIT_DURATION}.`,
  ] : [
    `## ${E('warranty_shield')} ĐIỀU KHOẢN API`,
    `> ${E('icon_duration')} **Không giới hạn ngày** · Không có phí gia hạn theo ngày.`,
    '',
    `${E('icon_price')} **Credit là hạn mức API**, không phải tiền mặt hay số token cố định. Mức tiêu hao theo model và nhà cung cấp.`,
    `${E('icon_key')} Giao token/API và hướng dẫn riêng trong **ticket**; không cần mật khẩu tài khoản cá nhân.`,
    `${E('warranty_shield')} **Bảo hành và hỗ trợ đến hết credit** đã mua.`,
    `${E('status_warn')} Model có thể thay đổi; **không hoàn tiền sau khi đã kích hoạt và sử dụng token**.`,
  ];
  const container = new ContainerBuilder().setAccentColor(0x76E0B6)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  if (page === 'models') container.addActionRowComponents(new ActionRowBuilder().addComponents(
    withButtonEmoji(new ButtonBuilder().setURL('https://cenarstore.xyz/huong-dan-api').setLabel('Hướng dẫn kết nối').setStyle(ButtonStyle.Link), E.component('icon_book')),
    withButtonEmoji(new ButtonBuilder().setURL('https://cenarstore.xyz/check-token').setLabel('Kiểm tra token/model').setStyle(ButtonStyle.Link), E.component('icon_search')),
  ));
  return { components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

export function buildApiCreditPanel(guildId, products, hasBanner = true) {
  const packs = getApiCreditProducts(products);
  const selector = buildApiCreditSelector(packs, guildId);
  if (!selector) return null;
  const E = createEmojiResolver(guildId);
  const container = new ContainerBuilder().setAccentColor(0x76E0B6);
  if (hasBanner) container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(`attachment://${API_CREDIT_BANNER}`).setDescription('Cenar Store · API Codex/Claude credit'),
  ));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(buildPriceText(guildId, packs)));
  const actions = new ActionRowBuilder().addComponents(
    withButtonEmoji(new ButtonBuilder().setCustomId('product:claude:pricing').setLabel('Bảng giá').setStyle(ButtonStyle.Secondary), E.component('payment_money')),
    withButtonEmoji(new ButtonBuilder().setCustomId('product:claude:models').setLabel('Hướng dẫn & Models').setStyle(ButtonStyle.Secondary), E.component('icon_key')),
    withButtonEmoji(new ButtonBuilder().setCustomId('product:claude:policy').setLabel('Điều khoản').setStyle(ButtonStyle.Secondary), E.component('warranty_shield')),
  );
  return { components: [container, selector, actions], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

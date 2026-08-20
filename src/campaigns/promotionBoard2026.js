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
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { normalizeV2Text } from '../utils/uiKit.js';

export const PROMOTION_BOARD = Object.freeze({
  guildId: '1282637033340403754',
  channelId: '1515008584549797979',
  priceChannelId: '1514606995842273280',
  audienceRoleIds: Object.freeze([
    '1282638730812854345', // Cenar Member
    '1282637103045279820', // Cenar Patron
  ]),
  marker: 'CENAR-PROMOTION-BOARD-V1',
  flags: MessageFlags.IsComponentsV2,
  prices: Object.freeze({
    nitroLogin: Object.freeze([
      Object.freeze({ duration: '1 Tháng', price: 90_000 }),
      Object.freeze({ duration: '2 Tháng', price: 100_000 }),
      Object.freeze({ duration: '12 Tháng', price: 800_000 }),
      Object.freeze({ duration: 'Trial 4 Tháng', price: 65_000 }),
    ]),
    serverBoost: Object.freeze([
      Object.freeze({ duration: '1 Tháng', price: 110_000 }),
      Object.freeze({ duration: '3 Tháng', price: 250_000 }),
    ]),
    netflix: Object.freeze({ duration: '1 Tháng', price: 35_000 }),
    decor: Object.freeze([
      Object.freeze({ originalPrice: 66_000, salePrice: 24_000 }),
      Object.freeze({ originalPrice: 79_000, salePrice: 34_000 }),
    ]),
  }),
});

const divider = () => new SeparatorBuilder()
  .setDivider(true)
  .setSpacing(SeparatorSpacingSize.Small);

function money(value) {
  return `${Number(value).toLocaleString('vi-VN')}đ`;
}

function priceLines(items, icon) {
  return items.map((item) => (
    `${icon} **${item.duration}:** \`${money(item.price)}\``
  ));
}

export function buildPromotionBoardPayload() {
  const campaign = PROMOTION_BOARD;
  const E = createEmojiResolver(campaign.guildId);
  const mentions = ['@everyone', ...campaign.audienceRoleIds.map((id) => `<@&${id}>`)].join(' ');

  const container = new ContainerBuilder()
    .setAccentColor(0xEC4899)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      mentions,
      `# ${E('icon_fire')} CENAR DEAL ZONE · BẢNG KHUYẾN MÃI`,
      `> ${E('icon_sparkle')} Danh sách ưu đãi đang áp dụng dành riêng cho cộng đồng Cenar. Chọn đúng gói và mở ticket để staff xác nhận trước khi thanh toán.`,
    ].join('\n'))))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('brand_nitro')} NITRO BOOST LOGIN`,
      ...priceLines(campaign.prices.nitroLogin, E('cenar_price')),
      '',
      `> ${E('status_info')} Gói **Trial 4 Tháng** áp dụng theo điều kiện tài khoản; staff sẽ kiểm tra trước khi nhận đơn.`,
    ].join('\n'))))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('brand_boost')} BOOST SERVER`,
      ...priceLines(campaign.prices.serverBoost, E('cenar_price')),
      '',
      `> ${E('status_check')} Vui lòng gửi link hoặc ID server trong ticket để staff kiểm tra và xác nhận gói phù hợp.`,
    ].join('\n'))))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('brand_netflix')} NETFLIX PREMIUM`,
      `${E('cenar_price')} **${campaign.prices.netflix.duration}:** \`${money(campaign.prices.netflix.price)}\``,
      `${E('status_check')} **Chất lượng:** Full HD / 4K`,
      `${E('warranty_shield')} **Bảo hành:** 20 ngày`,
      `${E('status_warn')} **Lưu ý:** Không gia hạn trên tài khoản cũ; hết hạn cần đổi tài khoản mới.`,
    ].join('\n'))))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('icon_sparkle')} DECOR / NPL / FRAMES LOGIN`,
      `> ${E('status_loading')} **Xử lý siêu tốc · Done nhanh sau khi xác nhận**`,
      ...campaign.prices.decor.map((item) => (
        `${E('icon_price')} ~~${money(item.originalPrice)}~~ → **${money(item.salePrice)}**`
      )),
    ].join('\n'))))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(normalizeV2Text([
      `## ${E('icon_gift')} HUY HIỆU QUÀ TẶNG HUYỀN THOẠI DISCORD`,
      `> ${E('icon_gem')} Cenar có nhận hỗ trợ lấy **Huy hiệu Quà Tặng Huyền Thoại** với mức giá ưu đãi. Khách có nhu cầu vui lòng mở ticket để được kiểm tra điều kiện và báo giá.`,
      '',
      `${E('status_warn')} **Lưu ý chung:** Giá khuyến mãi được áp dụng sau khi staff xác nhận trong ticket và có thể kết thúc khi nguồn hàng thay đổi.`,
      `${E('icon_search')} Bảng giá sản phẩm tiêu chuẩn: <#${campaign.priceChannelId}>`,
      `-# ${campaign.marker}`,
    ].join('\n'))));

  const orderButton = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId('ticket:create:ORDER')
      .setLabel('Mở Ticket Nhận Ưu Đãi')
      .setStyle(ButtonStyle.Success),
    E.component('icon_cart'),
    E.component('ticket_open'),
  );
  const priceButton = withButtonEmoji(
    new ButtonBuilder()
      .setLabel('Xem Bảng Giá Tiêu Chuẩn')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${campaign.guildId}/${campaign.priceChannelId}`),
    E.component('icon_price'),
  );

  return {
    components: [container, new ActionRowBuilder().addComponents(orderButton, priceButton)],
    flags: campaign.flags,
    allowedMentions: {
      parse: ['everyone'],
      roles: [...campaign.audienceRoleIds],
      users: [],
      repliedUser: false,
    },
  };
}

function containsMarker(component) {
  if (typeof component?.content === 'string' && component.content.includes(PROMOTION_BOARD.marker)) return true;
  return Array.isArray(component?.components) && component.components.some(containsMarker);
}

export function isPromotionBoardMessage(message, botUserId) {
  return message?.author?.id === botUserId
    && Array.isArray(message.components)
    && message.components.some(containsMarker);
}

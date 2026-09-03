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

export const GEMINI_PRICING_UPDATE = Object.freeze({
  guildId: '1282637033340403754',
  announcementChannelId: '1514598369597587546',
  promotionChannelId: '1515008584549797979',
  priceChannelId: '1514606995842273280',
  supportChannelId: '1514607020098191393',
  storeUrl: 'https://cenarstore.xyz/products',
  effectiveDate: '03/09/2026',
  marker: 'CENAR-GEMINI-PRICING-UPDATE-2026-09-03',
  products: Object.freeze([
    Object.freeze({ duration: 12, price: 250_000, warranty: 'Full 12 tháng' }),
    Object.freeze({ duration: 18, price: 280_000, warranty: 'Full 18 tháng' }),
  ]),
});

function money(value) {
  return `${Number(value).toLocaleString('vi-VN')}đ`;
}

function divider() {
  return new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);
}

export function buildGeminiPricingUpdateMessage({
  guildId = GEMINI_PRICING_UPDATE.guildId,
  tagEveryone = true,
} = {}) {
  const campaign = GEMINI_PRICING_UPDATE;
  const E = createEmojiResolver(guildId);

  const header = new ContainerBuilder()
    .setAccentColor(0x4285f4)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      tagEveryone ? '@everyone' : null,
      `# ${E('brand_gemini')} CẬP NHẬT GIÁ GEMINI PRO + 5 TB GOOGLE ONE`,
      `> ${E('status_warn')} Google đã điều chỉnh cơ chế và chính sách kỹ thuật, khiến **phương thức triển khai cũ không còn khả dụng**. Cenar Store dừng nhận đơn theo bảng giá cũ và chuyển sang nguồn triển khai mới để duy trì chất lượng phục vụ.`,
      '',
      `${E('icon_calendar')} **Thời điểm áp dụng:** từ ngày **${campaign.effectiveDate}** đối với các đơn mới.`,
    ].filter(Boolean).join('\n')));

  const pricing = new ContainerBuilder()
    .setAccentColor(0x34a853)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `## ${E('icon_price')} BẢNG GIÁ MỚI · FULL BẢO HÀNH`,
      `### ${E('brand_gemini')} Gemini Pro · 12 tháng`,
      `> ${E('payment_money')} **Giá:** \`${money(campaign.products[0].price)}\``,
      `> ${E('warranty_shield')} **Bảo hành:** Full trong toàn bộ **12 tháng**`,
      '',
      `### ${E('brand_gemini')} Gemini Pro · 18 tháng`,
      `> ${E('payment_money')} **Giá:** \`${money(campaign.products[1].price)}\``,
      `> ${E('warranty_shield')} **Bảo hành:** Full trong toàn bộ **18 tháng**`,
    ].join('\n')))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${E('status_cross')} Các gói Gemini giá cũ, bao gồm lựa chọn bảo hành giới hạn theo phương thức cũ, đã **ngừng mở bán** và không còn xuất hiện trong hệ thống đặt hàng.`,
    ));

  const policy = new ContainerBuilder()
    .setAccentColor(0xfbbc04)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `## ${E('verify_shield')} QUYỀN LỢI & LƯU Ý`,
      `${E('status_check')} Đơn đã được shop xác nhận trước thông báo vẫn giữ **giá và chính sách bảo hành ghi trên đơn**.`,
      `${E('status_check')} Đơn mới áp dụng đúng hai mức giá nêu trên; staff sẽ kiểm tra nguồn hàng trước khi nhận thanh toán.`,
      `${E('recovery_backup')} Giá sản phẩm đã được đồng bộ với **website, hệ thống đặt hàng và kênh bảng giá Discord**.`,
      `${E('cenar_support')} Nếu đang giữ ảnh bảng giá cũ, vui lòng đối chiếu lại tại <#${campaign.priceChannelId}> hoặc mở ticket tại <#${campaign.supportChannelId}>.`,
      `-# Cenar Store · Minh bạch giá và bảo hành · ${campaign.marker}`,
    ].join('\n')));

  const storeButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Xem Giá Trên Website')
      .setURL(campaign.storeUrl),
    E.component('brand_gemini'),
    E.component('icon_store'),
  );
  const priceButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Mở Kênh Bảng Giá')
      .setURL(`https://discord.com/channels/${guildId}/${campaign.priceChannelId}`),
    E.component('icon_price'),
  );
  const supportButton = withButtonEmoji(
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel('Mở Ticket Tư Vấn')
      .setURL(`https://discord.com/channels/${guildId}/${campaign.supportChannelId}`),
    E.component('cenar_support'),
    E.component('ticket_open'),
  );

  return {
    components: [
      header,
      pricing,
      policy,
      new ActionRowBuilder().addComponents(storeButton, priceButton, supportButton),
    ],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: {
      parse: tagEveryone ? ['everyone'] : [],
      roles: [],
      users: [],
      repliedUser: false,
    },
  };
}

export function isGeminiPricingUpdateMessage(message, botId) {
  return message?.author?.id === botId
    && JSON.stringify(message.toJSON?.() || message).includes(GEMINI_PRICING_UPDATE.marker);
}

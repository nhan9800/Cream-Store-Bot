import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, MessageFlags,
  SectionBuilder, TextDisplayBuilder, ThumbnailBuilder,
} from 'discord.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';

export const LOCKET_PANEL_IMAGE = 'locket-gold-banner.webp';
const priceText = (product) => `${Number(product.base_price ?? product.price ?? 0).toLocaleString('vi-VN')}đ`;

export function buildLocketProductPanel(guildId, product, hasImage = true) {
  const E = createEmojiResolver(guildId);
  const container = new ContainerBuilder().setAccentColor(0xE8BE69);
  const heading = new TextDisplayBuilder().setContent([
    `## ${E('brand_locket') || E('icon_heart')} LOCKET GOLD`,
    `${E('payment_money')} **\`${priceText(product)}\`** · **12 tháng**`,
    `> ${E('icon_sparkle')} Nâng cấp chính chủ bằng **Username**.`,
  ].join('\n'));
  if (hasImage) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(heading)
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${LOCKET_PANEL_IMAGE}`).setDescription('Locket Gold · Cenar Store')));
  else container.addTextDisplayComponents(heading);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('icon_key')} Không cần mật khẩu hoặc OTP.`,
    `${E('icon_star')} Icon tùy chỉnh · Không quảng cáo · Hỗ trợ streak theo chính sách Locket.`,
    `${E('panel_order')} **Mua ngay** → Username → Xác nhận giá → Thanh toán trong ticket.`,
    `-# ${E('warranty_shield')} Bảo hành 12 tháng · Kiểm tra đúng Username trước khi xác nhận.`,
  ].join('\n')));
  const actions = new ActionRowBuilder().addComponents(
    withButtonEmoji(new ButtonBuilder().setCustomId('product:locket:buy').setLabel('Mua ngay').setStyle(ButtonStyle.Success), E.component('panel_order')),
    withButtonEmoji(new ButtonBuilder().setCustomId('product:locket:features').setLabel('Đặc quyền').setStyle(ButtonStyle.Secondary), E.component('icon_crown')),
    withButtonEmoji(new ButtonBuilder().setCustomId('product:locket:policy').setLabel('Điều khoản').setStyle(ButtonStyle.Secondary), E.component('warranty_shield')),
  );
  return { components: [container, actions], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export function buildLocketDetails(guildId, page, product) {
  const E = createEmojiResolver(guildId);
  const lines = page === 'features' ? [
    `## ${E('icon_crown')} ĐẶC QUYỀN LOCKET GOLD`,
    `> ${E('brand_locket') || E('icon_heart')} **12 tháng** · \`${priceText(product)}\` · Nâng cấp bằng Username.`,
    '',
    `${E('icon_star')} **Icon ứng dụng** · Cá nhân hóa biểu tượng theo sở thích.`,
    `${E('icon_fire')} **Streak Shield** · Hỗ trợ bảo vệ/khôi phục streak theo chính sách Locket.`,
    `${E('status_check')} **Không quảng cáo** · Trải nghiệm gọn gàng.`,
    `${E('icon_heart')} **Reaction & chủ đề** · Thêm cách thể hiện và tùy chỉnh màu sắc.`,
    `-# ${E('icon_key')} Chỉ cần Username chính xác · Không cần mật khẩu hoặc OTP.`,
  ] : [
    `## ${E('warranty_shield')} ĐIỀU KHOẢN LOCKET GOLD`,
    `> ${E('icon_duration')} **12 tháng từ ngày kích hoạt** · Bảo hành đầy đủ thời hạn.`,
    '',
    `${E('icon_id')} **Kiểm tra kỹ Username** trước khi xác nhận nâng cấp.`,
    `${E('icon_key')} Kích hoạt bằng Username; **không thu mật khẩu hoặc OTP**.`,
    `${E('cenar_staff')} Hỗ trợ trong ticket suốt thời gian sử dụng.`,
    `${E('status_warn')} **Không hoàn tiền** sau khi đã kích hoạt thành công.`,
  ];
  return {
    components: [new ContainerBuilder().setAccentColor(0xE8BE69)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')))],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] },
  };
}

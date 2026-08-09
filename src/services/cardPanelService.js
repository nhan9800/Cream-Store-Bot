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

function cardButton({ customId, label, style, emojis }) {
  return withButtonEmoji(
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(style),
    ...emojis,
  );
}

/**
 * Một nguồn duy nhất cho panel thẻ cào tự động và lệnh /setup-card-panel.
 * Nếu guild thiếu emoji, nút vẫn hợp lệ và được gửi không kèm icon.
 */
export function buildCardPanelPayload(guildId, { accentColor = 0x5865F2 } = {}) {
  const E = createEmojiResolver(guildId);
  const container = new ContainerBuilder().setAccentColor(accentColor);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `## ${E('payment_payos')} CENAR CARD CENTER`,
      '> Gạch thẻ và mua thẻ tự động, theo dõi trạng thái rõ ràng từ lúc gửi tới khi cộng ví.',
      '',
      `### ${E('icon_wallet')} Gạch thẻ lấy số dư`,
      `${E('status_loading')} Chọn nhà mạng, nhập đúng mệnh giá, serial và mã thẻ.`,
      `${E('card_success') || E('payment_success')} Card2K xác nhận thành công rồi hệ thống mới cộng ví.`,
      `${E('status_warn')} Thẻ sai mệnh giá được tính theo giá trị thực tế nhà cung cấp trả về.`,
      '',
      `### ${E('card_success')} Mua mã thẻ mới`,
      `${E('cenar_verified')} Thanh toán trực tiếp từ ví Cenar, mã thẻ chỉ hiển thị riêng cho bạn.`,
      `${E('customer_patron')} Giao dịch hợp lệ tự động đồng bộ quyền Cenar Patron với website.`,
    ].join('\n')),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${E('cenar_support')} Không gửi mã thẻ cho người khác · Mỗi thẻ chỉ gửi một lần`),
  );

  const row = new ActionRowBuilder().addComponents(
    cardButton({
      customId: 'cardswap:btn_charge',
      label: 'Đổi Thẻ Cào',
      style: ButtonStyle.Success,
      emojis: [E.component('icon_wallet'), E.component('card_success')],
    }),
    cardButton({
      customId: 'cardswap:btn_buy',
      label: 'Mua Thẻ Cào',
      style: ButtonStyle.Primary,
      emojis: [E.component('card_success'), E.component('panel_order'), E.component('icon_cart')],
    }),
    cardButton({
      customId: 'cardswap:btn_fees',
      label: 'Xem Bảng Phí',
      style: ButtonStyle.Secondary,
      emojis: [E.component('payment_money'), E.component('icon_doc')],
    }),
    cardButton({
      customId: 'cardswap:btn_balance',
      label: 'Kiểm Tra Số Dư',
      style: ButtonStyle.Secondary,
      emojis: [E.component('icon_wallet'), E.component('payment_money')],
    }),
  );

  return { components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

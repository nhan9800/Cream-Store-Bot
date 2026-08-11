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
import { isInternationalGuild } from '../utils/locale.js';

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
  const international = isInternationalGuild(guildId);
  const container = new ContainerBuilder().setAccentColor(accentColor);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `## ${E('payment_payos')} ${international ? 'CENAR GLOBAL • GIFT CARD CENTER' : 'CENAR CARD CENTER'}`,
      international ? '> Exchange supported gift cards or purchase a new code through a private, traceable workflow.' : '> Gạch thẻ và mua thẻ tự động, theo dõi trạng thái rõ ràng từ lúc gửi tới khi cộng ví.',
      '',
      `### ${E('icon_wallet')} ${international ? 'EXCHANGE A GIFT CARD' : 'Gạch thẻ lấy số dư'}`,
      international ? `${E('status_loading')} Select the provider and enter the exact value, serial number and card code.` : `${E('status_loading')} Chọn nhà mạng, nhập đúng mệnh giá, serial và mã thẻ.`,
      international ? `${E('card_success') || E('payment_success')} Wallet credit is added only after the provider confirms the card.` : `${E('card_success') || E('payment_success')} Card2K xác nhận thành công rồi hệ thống mới cộng ví.`,
      international ? `${E('status_warn')} A card submitted with the wrong value is credited using the provider's verified amount.` : `${E('status_warn')} Thẻ sai mệnh giá được tính theo giá trị thực tế nhà cung cấp trả về.`,
      '',
      `### ${E('card_success')} ${international ? 'BUY A NEW CODE' : 'Mua mã thẻ mới'}`,
      international ? `${E('cenar_verified')} Pay from your Cenar wallet; the delivered code is visible only to you.` : `${E('cenar_verified')} Thanh toán trực tiếp từ ví Cenar, mã thẻ chỉ hiển thị riêng cho bạn.`,
      international ? `${E('customer_patron')} Valid activity automatically synchronizes your customer role with the website.` : `${E('customer_patron')} Giao dịch hợp lệ tự động đồng bộ quyền Cenar Patron với website.`,
    ].join('\n')),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(international
      ? `-# ${E('cenar_support')} Never share a card code publicly · Submit each card only once`
      : `-# ${E('cenar_support')} Không gửi mã thẻ cho người khác · Mỗi thẻ chỉ gửi một lần`),
  );

  const row = new ActionRowBuilder().addComponents(
    cardButton({
      customId: 'cardswap:btn_charge',
      label: international ? 'Exchange Card' : 'Đổi Thẻ Cào',
      style: ButtonStyle.Success,
      emojis: [E.component('icon_wallet'), E.component('card_success')],
    }),
    cardButton({
      customId: 'cardswap:btn_buy',
      label: international ? 'Buy Gift Card' : 'Mua Thẻ Cào',
      style: ButtonStyle.Primary,
      emojis: [E.component('card_success'), E.component('panel_order'), E.component('icon_cart')],
    }),
    cardButton({
      customId: 'cardswap:btn_fees',
      label: international ? 'View Fees' : 'Xem Bảng Phí',
      style: ButtonStyle.Secondary,
      emojis: [E.component('payment_money'), E.component('icon_doc')],
    }),
    cardButton({
      customId: 'cardswap:btn_balance',
      label: international ? 'Wallet Balance' : 'Kiểm Tra Số Dư',
      style: ButtonStyle.Secondary,
      emojis: [E.component('icon_wallet'), E.component('payment_money')],
    }),
  );

  return { components: [container, row], flags: MessageFlags.IsComponentsV2 };
}

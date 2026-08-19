import { createEmojiResolver } from '../utils/emojiHelper.js';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { buildOrderLogContent } from '../utils/formatters.js';
import {
  getOrderByCodeRaw,
  updateOrderFieldsRaw,
  insertStaffLogRaw,
} from '../services/v11DbHelpers.js';
import { getGuildConfig } from '../services/guildConfigService.js';

export const data = new SlashCommandBuilder()
  .setName('sua-don')
  .setDescription('Sửa thông tin đơn hàng, gồm thời hạn theo tháng hoặc ngày.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((o) => o.setName('ma_don').setDescription('Mã đơn hàng').setRequired(true))
  .addStringOption((o) => o.setName('san_pham').setDescription('Tên sản phẩm mới').setRequired(false))
  .addIntegerOption((o) => o.setName('so_luong').setDescription('Số lượng mới').setRequired(false).setMinValue(1))
  .addIntegerOption((o) => o.setName('so_thang').setDescription('Số tháng mới').setRequired(false).setMinValue(1).setMaxValue(36))
  .addIntegerOption((o) => o.setName('so_ngay').setDescription('Số ngày mới, ví dụ 7').setRequired(false).setMinValue(1).setMaxValue(3650))
  .addIntegerOption((o) => o.setName('gia_tien').setDescription('Giá mới').setRequired(false).setMinValue(0));

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  await interaction.deferReply({ flags: 64 });

  try {
    const orderCode = interaction.options.getString('ma_don', true).trim().toUpperCase();
    const before = getOrderByCodeRaw(orderCode);
    if (!before) {
      await interaction.editReply(`${E('status_warn')} Không tìm thấy mã đơn.`);
      return;
    }

    const payload = {};
    const productName = interaction.options.getString('san_pham');
    const quantity = interaction.options.getInteger('so_luong');
    const months = interaction.options.getInteger('so_thang');
    const days = interaction.options.getInteger('so_ngay');
    const amount = interaction.options.getInteger('gia_tien');

    if (months !== null && days !== null) {
      await interaction.editReply(`${E('status_warn')} Chỉ chọn **số tháng** hoặc **số ngày**, không nhập cả hai.`);
      return;
    }

    if (amount !== null && Number(amount) !== Number(before.total_amount ?? 0) && before.payment_status !== 'PAID' && (before.payment_link_id || before.payment_checkout_url || before.payment_qr_code)) {
      await interaction.editReply(`${E('status_warn')} Đơn này đã tạo link/QR PayOS. Hãy giữ nguyên giá hoặc tạo lại flow thanh toán mới để tránh lệch số tiền.`);
      return;
    }

    if (productName !== null) payload.product_name = productName;
    if (quantity !== null) payload.quantity = quantity;
    if (months !== null) {
      payload.duration_months = months;
      payload.duration_days = null;
    }
    if (days !== null) {
      payload.duration_months = 0;
      payload.duration_days = days;
    }
    if (amount !== null) payload.total_amount = amount;

    if (Object.keys(payload).length === 0) {
      await interaction.editReply(`${E('status_warn')} Bạn chưa nhập trường nào để sửa.`);
      return;
    }

    const after = updateOrderFieldsRaw(orderCode, payload);

    try {
      const guildConfig = getGuildConfig(interaction.guildId);
      const channelId = after.order_log_channel_id || guildConfig?.order_log_channel_id;
      if (channelId && after.order_log_message_id) {
        const ch = await interaction.guild.channels.fetch(channelId).catch(() => null);
        if (ch?.isTextBased?.()) {
          const msg = await ch.messages.fetch(after.order_log_message_id).catch(() => null);
          if (msg) {
            await msg.edit({ content: buildOrderLogContent(after) }).catch(() => null);
          }
        }
      }
    } catch {}

    insertStaffLogRaw({
      guildId: interaction.guildId,
      actorId: interaction.user.id,
      action: 'ORDER_EDITED',
      orderCode,
      targetCustomerId: after.customer_id,
      beforeJson: JSON.stringify({
        product_name: before.product_name,
        quantity: before.quantity,
        total_amount: before.total_amount,
        duration_months: before.duration_months,
        duration_days: before.duration_days,
        expiry_at: before.expiry_at,
      }),
      afterJson: JSON.stringify({
        product_name: after.product_name,
        quantity: after.quantity,
        total_amount: after.total_amount,
        duration_months: after.duration_months,
        duration_days: after.duration_days,
        expiry_at: after.expiry_at,
      }),
    });

    const expiryText = after.expiry_at ? `\n🗓️ Hạn mới: <t:${Math.floor(new Date(after.expiry_at).getTime() / 1000)}:F>` : '';
    await interaction.editReply(`${E('status_check')} Đã cập nhật đơn \`${after.order_code}\`.${expiryText}`);
  } catch (error) {
    console.error('[ORDER/EDIT] Lỗi:', error);
    await interaction.editReply(`${E('status_cross')} Không thể sửa đơn: ${error.message ?? 'Lỗi không xác định'}`);
  }
}

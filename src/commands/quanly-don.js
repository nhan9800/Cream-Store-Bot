import { createEmojiResolver } from '../utils/emojiHelper.js';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { getOrderByCode, cancelOrder, markOrderPaid, markOrderCompleted, ensureOrderExpiry } from '../services/orderService.js';
import { sendOrderCancelledFlow, updateOrderLogMessage, sendCompletedFlow } from '../services/notificationService.js';
import { emitStaffLog } from '../services/staffLogService.js';
import { assertStaffCapability } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('quanly-don')
  .setDescription('Công cụ quản lý đơn nâng cao (Hủy đơn, Đã thanh toán, Hoàn thành) ở mọi nơi.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((option) => option.setName('ma_don').setDescription('Mã đơn hàng, ví dụ CN_123456').setRequired(true))
  .addStringOption((option) =>
    option.setName('hanh_dong')
      .setDescription('Hành động muốn thực hiện')
      .setRequired(true)
      .addChoices(
        { name: 'Đánh dấu Đã Thanh Toán', value: 'PAID' },
        { name: 'Đánh dấu Hoàn Thành', value: 'COMPLETED' },
        { name: 'Hủy Đơn / Xóa Đơn', value: 'CANCELLED' }
      )
  );

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  await interaction.deferReply({ ephemeral: true });
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!assertStaffCapability(member, guildConfig, 'MANAGE')) {
    await interaction.editReply(`${E('status_warn')} Chỉ staff/manager mới được dùng lệnh này.`);
    return;
  }

  const orderCode = interaction.options.getString('ma_don', true).trim().toUpperCase();
  const action = interaction.options.getString('hanh_dong', true);
  const currentOrder = getOrderByCode(orderCode);

  if (!currentOrder) {
    await interaction.editReply(`${E('status_warn')} Không tìm thấy mã đơn này.`);
    return;
  }

  try {
    if (action === 'CANCELLED') {
      if (currentOrder.status === 'CANCELLED') {
        await interaction.editReply(`${E('status_info')} Đơn này đã bị hủy từ trước.`);
        return;
      }
      const order = cancelOrder(orderCode, 'Hủy thủ công qua lệnh quản lý');
      await updateOrderLogMessage(interaction.guild, order);
      await emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: order.customer_id, action: 'ORDER_EDITED', detail: 'Hủy đơn', relatedOrderCode: order.order_code });

      const cancellationNotice = await sendOrderCancelledFlow({
        guild: interaction.guild,
        order,
        reason: `Hủy thủ công bởi staff ${interaction.user.tag}`,
      });

      await interaction.editReply(`${E('status_check')} Đã hủy đơn \`${orderCode}\` thành công! ${cancellationNotice.dmSent ? 'Đã gửi DM giao diện mới cho khách.' : 'Khách đang tắt DM nên không thể gửi riêng.'}`);
      return;
    }

    if (action === 'PAID') {
      if (currentOrder.payment_status === 'PAID' || currentOrder.payment_status === 'FREE') {
        await interaction.editReply(`${E('status_info')} Đơn này đã được thanh toán hoặc miễn phí.`);
        return;
      }
      const order = markOrderPaid(orderCode, { amountPaid: currentOrder.total_amount, transactionId: 'MANUAL', transactionContent: 'Xác nhận thủ công' });
      await updateOrderLogMessage(interaction.guild, order);
      await emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: order.customer_id, action: 'ORDER_EDITED', detail: 'Xác nhận thanh toán thủ công', relatedOrderCode: order.order_code });
      
      // Thông báo cho khách hàng
      try {
        const customer = await interaction.client.users.fetch(order.customer_id);
        await customer.send(`${E('icon_money_wings')} **Cenar Store** - Đơn hàng \`${orderCode}\` của bạn đã được xác nhận thanh toán thủ công! Đơn đang chờ xử lý.`).catch(() => null);
      } catch (e) {}
      
      await interaction.editReply(`${E('status_check')} Đã cập nhật trạng thái **Đã thanh toán** cho đơn \`${orderCode}\`!`);
      return;
    }

    if (action === 'COMPLETED') {
      if (currentOrder.status === 'COMPLETED') {
        await interaction.editReply(`${E('status_info')} Đơn này đã hoàn thành rồi.`);
        return;
      }
      // Khác với /hoanthanh, lệnh này là Override admin, cho phép hoàn thành ngay cả khi chưa thanh toán xong (nếu staff muốn vậy)
      let order = markOrderCompleted(orderCode, interaction.user.id, 24);
      order = ensureOrderExpiry(order.order_code, new Date(order.completed_at ?? Date.now())) ?? order;
      await updateOrderLogMessage(interaction.guild, order);
      const result = await sendCompletedFlow({ guild: interaction.guild, order, actorId: interaction.user.id, supportId: interaction.user.id });
      await emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: order.customer_id, action: 'ORDER_COMPLETE_MANUAL', detail: 'Ép hoàn thành qua quản lý', relatedOrderCode: order.order_code });
      await interaction.editReply(`${E('status_check')} Đã ép **Hoàn thành** đơn \`${orderCode}\`! ${result.dmSent ? 'Đã gửi DM cho khách.' : 'Không thể gửi DM cho khách.'}`);
      return;
    }
  } catch (error) {
    console.error('[QUANLY_DON] Lỗi:', error);
    await interaction.editReply(`${E('status_cross')} Có lỗi xảy ra: ${error.message}`);
  }
}

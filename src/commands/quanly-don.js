import { createEmojiResolver } from '../utils/emojiHelper.js';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { getOrderByCode, cancelOrder, markOrderPaid, markOrderCompleted, ensureOrderExpiry, restoreCancelledPayOSOrder, OrderPaymentError, updatePaidOrderRefund } from '../services/orderService.js';
import { sendOrderCancelledFlow, updateOrderLogMessage, sendCompletedFlow } from '../services/notificationService.js';
import { emitStaffLog } from '../services/staffLogService.js';
import { assertStaffCapability } from '../utils/permissions.js';
import { ORDER_CANCEL_BLOCKED } from '../services/orderStateMachine.js';
import { PaidOrderRefundError } from '../services/paidOrderRefundService.js';
import { formatCurrency } from '../utils/formatters.js';

const refundActions = {
  REFUND_PENDING: { message: 'đang **Chờ hoàn tiền**. Các bước giao hàng và hoàn thành đã tạm dừng.', event: 'ORDER_REFUND_REQUESTED' },
  REFUNDED: { message: 'đã ghi nhận **Hoàn tiền** theo số tiền quản lý xác nhận.', event: 'ORDER_REFUND_RECORDED' },
  WITHDRAW_REFUND: { message: 'đã trở về trạng thái trước yêu cầu hoàn tiền.', event: 'ORDER_REFUND_WITHDRAWN' },
};

export const data = new SlashCommandBuilder()
  .setName('quanly-don')
  .setDescription('Quản lý thanh toán, giao hàng, hủy đơn và ghi nhận hoàn tiền.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((option) => option.setName('ma_don').setDescription('Mã đơn hàng, ví dụ CN_123456').setRequired(true))
  .addStringOption((option) =>
    option.setName('hanh_dong')
      .setDescription('Hành động muốn thực hiện')
      .setRequired(true)
      .addChoices(
        { name: 'Đánh dấu Đã Thanh Toán', value: 'PAID' },
        { name: 'Đánh dấu Hoàn Thành', value: 'COMPLETED' },
        { name: 'Hủy đơn chưa nhận tiền', value: 'CANCELLED' },
        { name: 'Ghi nhận yêu cầu hoàn tiền', value: 'REFUND_PENDING' },
        { name: 'Xác nhận đã hoàn tiền bên ngoài bot', value: 'REFUNDED' },
        { name: 'Rút yêu cầu hoàn tiền', value: 'WITHDRAW_REFUND' },
      )
  )
  .addIntegerOption(option => option.setName('so_tien_hoan').setDescription('Số VND thực tế đã hoàn. Chỉ dùng khi xác nhận đã hoàn.').setMinValue(1))
  .addStringOption(option => option.setName('ly_do').setDescription('Ghi chú nội bộ về yêu cầu hoàn tiền').setMaxLength(240));

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

  if (!currentOrder || currentOrder.guild_id !== interaction.guildId) {
    await interaction.editReply(`${E('status_warn')} Không tìm thấy mã đơn trong máy chủ này.`);
    return;
  }

  try {
    if (Object.hasOwn(refundActions, action)) {
      const amount = interaction.options.getInteger('so_tien_hoan');
      const reason = interaction.options.getString('ly_do')?.trim();
      const { updated, changed } = updatePaidOrderRefund({
        orderCode, guildId: interaction.guildId, actorId: interaction.user.id, action, amount, reason,
      });
      if (!changed) {
        const message = updated.status === 'REFUNDED' ? 'đã ghi nhận hoàn tiền' : 'đang chờ hoàn tiền';
        await interaction.editReply(`${E('status_info')} Đơn \`${orderCode}\` ${message} từ trước.`);
        return;
      }
      const { message, event } = refundActions[action];
      const amountText = action === 'REFUNDED' ? ` Số tiền đã ghi nhận **${formatCurrency(amount)}**.` : '';
      const close = action !== 'WITHDRAW_REFUND' ? '\n> Nếu ticket vẫn mở, dùng `/close` và xác nhận để lưu transcript rồi đóng.' : '';
      await interaction.editReply(`${E('status_check')} Đơn \`${orderCode}\` ${message}${amountText}${close}`);
      await Promise.allSettled([
        updateOrderLogMessage(interaction.guild, updated),
        emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id,
          targetId: updated.customer_id, action: event, detail: `${event}${amountText}`, relatedOrderCode: orderCode }),
      ]);
      return;
    }

    if (action === 'CANCELLED') {
      if (currentOrder.status === 'REFUNDED') {
        await interaction.editReply(`${E('status_info')} Đơn này đã ghi nhận hoàn tiền.`);
        return;
      }
      if (currentOrder.payment_status === 'PAID') {
        await interaction.editReply(`${E('status_warn')} Đơn đã nhận tiền. Trong \`/quanly-don\`, chọn **Ghi nhận yêu cầu hoàn tiền**. Để đóng ticket, quản lý dùng \`/close\`.`);
        return;
      }
      if (currentOrder.status === 'CANCELLED') {
        await interaction.editReply(`${E('status_info')} Đơn này đã bị hủy từ trước.`);
        return;
      }
      const order = cancelOrder(orderCode, 'Hủy thủ công qua lệnh quản lý', {
        actorId: interaction.user.id, expectedOrder: currentOrder,
      });
      if (!order) {
        await interaction.editReply(`${E('status_warn')} ${ORDER_CANCEL_BLOCKED}`);
        return;
      }
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
      if (currentOrder.status === 'CANCELLED') {
        const order = restoreCancelledPayOSOrder({ orderCode, guildId: interaction.guildId, actorId: interaction.user.id });
        await interaction.editReply(`${E('status_check')} Đơn \`${orderCode}\` đã được đưa về **Đang xử lý**. Bot giữ nguyên giao dịch PayOS đã xác nhận.`);
        await Promise.allSettled([
          updateOrderLogMessage(interaction.guild, order),
          emitStaffLog(interaction.client, {
            guildId: interaction.guildId,
            actorId: interaction.user.id,
            targetId: order.customer_id,
            action: 'ORDER_PAYMENT_RESTORED',
            detail: 'Đưa đơn đã hủy về xử lý bằng giao dịch PayOS gốc',
            relatedOrderCode: order.order_code,
          }),
        ]);
        return;
      }
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
      let order = currentOrder.status === 'CANCELLED' && currentOrder.payment_status === 'PAID'
        ? restoreCancelledPayOSOrder({ orderCode, guildId: interaction.guildId, actorId: interaction.user.id, complete: true })
        : markOrderCompleted(orderCode, interaction.user.id, 24);
      order = ensureOrderExpiry(order.order_code, new Date(order.completed_at ?? Date.now())) ?? order;
      await updateOrderLogMessage(interaction.guild, order);
      const result = await sendCompletedFlow({ guild: interaction.guild, order, actorId: interaction.user.id, supportId: interaction.user.id });
      await emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: order.customer_id, action: 'ORDER_COMPLETE_MANUAL', detail: 'Ép hoàn thành qua quản lý', relatedOrderCode: order.order_code });
      await interaction.editReply(`${E('status_check')} Đã ép **Hoàn thành** đơn \`${orderCode}\`! ${result.dmSent ? 'Đã gửi DM cho khách.' : 'Không thể gửi DM cho khách.'}`);
      return;
    }
  } catch (error) {
    if (error instanceof OrderPaymentError || error instanceof PaidOrderRefundError) {
      await interaction.editReply(`${E('status_warn')} ${error.message}`);
      return;
    }
    console.error('[QUANLY_DON] Lỗi:', error);
    await interaction.editReply(`${E('status_cross')} Có lỗi xảy ra: ${error.message}`);
  }
}

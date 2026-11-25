import { createEmojiResolver } from '../utils/emojiHelper.js';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import {
  getOrderByCode, cancelOrderForManager, markOrderPaid, markOrderCompleted, ensureOrderExpiry, reopenOrderForManager,
  OrderPaymentError, updatePaidOrderRefund,
} from '../services/orderService.js';
import { sendOrderCancelledFlow, updateOrderLogMessage, sendCompletedFlow } from '../services/notificationService.js';
import { emitStaffLog } from '../services/staffLogService.js';
import { assertStaffCapability } from '../utils/permissions.js';
import { PaidOrderRefundError } from '../services/paidOrderRefundService.js';
import { formatCurrency } from '../utils/formatters.js';

const refundActions = {
  REFUND_PENDING: { message: 'đang **Chờ hoàn tiền**. Các bước giao hàng và hoàn thành đã tạm dừng.', event: 'ORDER_REFUND_REQUESTED' },
  REFUNDED: { message: 'đã ghi nhận **Hoàn tiền** theo số tiền quản lý xác nhận.', event: 'ORDER_REFUND_RECORDED' },
  WITHDRAW_REFUND: { message: 'đã trở về trạng thái trước yêu cầu hoàn tiền.', event: 'ORDER_REFUND_WITHDRAWN' },
};

const STOPPED_STATUSES = new Set(['CANCELLED', 'FAILED', 'REFUNDED', 'REFUND_PENDING']);

function managerReply(E, lines, warnings = []) {
  return [...lines.filter(Boolean), ...warnings.map(warning => `${E('status_warn')} ${warning}`)].join('\n');
}

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
        { name: 'Hủy đơn', value: 'CANCELLED' },
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
      const { updated: order, changed, warnings, keptPayment } = cancelOrderForManager({
        orderCode, guildId: interaction.guildId, actorId: interaction.user.id, reason: 'Hủy thủ công qua lệnh quản lý',
      });
      if (!changed) {
        await interaction.editReply(`${E('status_info')} Đơn này đã bị hủy từ trước.`);
        return;
      }
      const [, , notice] = await Promise.allSettled([
        updateOrderLogMessage(interaction.guild, order),
        emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: order.customer_id,
          action: 'ORDER_EDITED', detail: keptPayment ? 'Hủy đơn đã nhận tiền, giữ dữ liệu thanh toán' : 'Hủy đơn', relatedOrderCode: order.order_code }),
        sendOrderCancelledFlow({ guild: interaction.guild, order, reason: `Hủy thủ công bởi staff ${interaction.user.tag}` }),
      ]);
      const dmSent = notice.status === 'fulfilled' && notice.value?.dmSent;
      await interaction.editReply(managerReply(E, [
        `${E('status_check')} Đã hủy đơn \`${orderCode}\`. ${dmSent ? 'Đã gửi DM cho khách.' : 'Không gửi được DM cho khách.'}`,
        keptPayment && '> Đơn đã nhận tiền nên bot giữ nguyên dữ liệu thanh toán. Nếu cần trả tiền cho khách, chọn **Ghi nhận yêu cầu hoàn tiền**.',
      ], warnings));
      return;
    }

    if (action === 'PAID') {
      if (STOPPED_STATUSES.has(currentOrder.status)) {
        const { updated: order, warnings, manualPayment } = reopenOrderForManager({
          orderCode, guildId: interaction.guildId, actorId: interaction.user.id, markPaid: true,
        });
        await interaction.editReply(managerReply(E, [
          `${E('status_check')} Đơn \`${orderCode}\` đã được đưa về **Đang xử lý**. ${manualPayment
            ? 'Đã ghi nhận thanh toán thủ công theo tổng đơn.' : 'Bot giữ nguyên dữ liệu thanh toán đã có.'}`,
        ], warnings));
        await Promise.allSettled([
          updateOrderLogMessage(interaction.guild, order),
          emitStaffLog(interaction.client, {
            guildId: interaction.guildId, actorId: interaction.user.id, targetId: order.customer_id,
            action: 'ORDER_PAYMENT_RESTORED', detail: manualPayment ? 'Mở lại đơn và xác nhận thanh toán thủ công' : 'Mở lại đơn với dữ liệu thanh toán đã có',
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
      await interaction.editReply(`${E('status_check')} Đã cập nhật trạng thái **Đã thanh toán** cho đơn \`${orderCode}\`!`);
      await Promise.allSettled([
        updateOrderLogMessage(interaction.guild, order),
        emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: order.customer_id, action: 'ORDER_EDITED', detail: 'Xác nhận thanh toán thủ công', relatedOrderCode: order.order_code }),
        interaction.client.users.fetch(order.customer_id)
          .then(customer => customer.send(`${E('icon_money_wings')} **Cenar Store** - Đơn hàng \`${orderCode}\` của bạn đã được xác nhận thanh toán thủ công! Đơn đang chờ xử lý.`)),
      ]);
      return;
    }

    if (action === 'COMPLETED') {
      if (currentOrder.status === 'COMPLETED') {
        await interaction.editReply(`${E('status_info')} Đơn này đã hoàn thành rồi.`);
        return;
      }
      // Override admin: hoàn thành được mọi đơn, kể cả đơn đã hủy/hoàn tiền hoặc chưa thanh toán xong.
      let order;
      let warnings = [];
      if (STOPPED_STATUSES.has(currentOrder.status)) {
        ({ updated: order, warnings } = reopenOrderForManager({
          orderCode, guildId: interaction.guildId, actorId: interaction.user.id, complete: true,
        }));
      } else {
        order = markOrderCompleted(orderCode, interaction.user.id, 24);
      }
      order = ensureOrderExpiry(order.order_code, new Date(order.completed_at ?? Date.now())) ?? order;
      const [, flow] = await Promise.allSettled([
        updateOrderLogMessage(interaction.guild, order),
        sendCompletedFlow({ guild: interaction.guild, order, actorId: interaction.user.id, supportId: interaction.user.id }),
        emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: order.customer_id, action: 'ORDER_COMPLETE_MANUAL', detail: 'Ép hoàn thành qua quản lý', relatedOrderCode: order.order_code }),
      ]);
      const dmSent = flow.status === 'fulfilled' && flow.value?.dmSent;
      await interaction.editReply(managerReply(E, [
        `${E('status_check')} Đã ép **Hoàn thành** đơn \`${orderCode}\`! ${dmSent ? 'Đã gửi DM cho khách.' : 'Không thể gửi DM cho khách.'}`,
      ], warnings));
      return;
    }
  } catch (error) {
    if (error instanceof OrderPaymentError || error instanceof PaidOrderRefundError
      || ['ORDER_NOT_COMPLETABLE', 'ORDER_COMPLETION_CONFLICT'].includes(error?.code)) {
      await interaction.editReply(`${E('status_warn')} ${error.message}`);
      return;
    }
    console.error('[QUANLY_DON] Lỗi:', error);
    await interaction.editReply(`${E('status_cross')} Có lỗi xảy ra: ${error.message}`);
  }
}

import { createEmojiResolver } from '../utils/emojiHelper.js';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { getOrderByCode, markOrderCompleted, ensureOrderExpiry, getLatestOrderByTicketChannel } from '../services/orderService.js';
import { sendCompletedFlow, updateOrderLogMessage } from '../services/notificationService.js';
import { emitStaffLog } from '../services/staffLogService.js';
import { buildDoneConfirmationText } from '../utils/embeds.js';
import { assertStaffCapability } from '../utils/permissions.js';
import { getCenarHub } from '../services/cenarHub.js';

export const data = new SlashCommandBuilder()
  .setName('hoanthanh')
  .setDescription('Chuyển trạng thái đơn sang đã hoàn thành, sửa log, nhắc feedback và gửi DM riêng.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((option) => option.setName('ma_don').setDescription('Mã đơn hàng, ví dụ CN_123456').setRequired(true));

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  await interaction.deferReply({ ephemeral: true });
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!assertStaffCapability(member, guildConfig, 'MANAGE')) {
    await interaction.editReply({ content: `${E('status_warn')} Chỉ manager mới được dùng lệnh này.`, ephemeral: true });
    return;
  }

  const orderCode = interaction.options.getString('ma_don', true).trim().toUpperCase();
  const currentOrder = getOrderByCode(orderCode);
  if (!currentOrder) {
    // Gợi ý mã đơn mới nhất gắn với ticket hiện tại (nếu staff đứng trong ticket)
    const latest = getLatestOrderByTicketChannel(interaction.channelId);
    const hint = latest
      ? ` Đơn mới nhất trong ticket này là \`${latest.order_code}\` (${getOrderStatusHint(latest)}). Có thể bạn muốn dùng mã đó.`
      : ' Hãy kiểm tra lại mã đơn (xem ở kênh log đơn hoặc thông báo trong ticket).';
    await interaction.editReply({ content: `${E('status_warn')} Không tìm thấy mã đơn \`${orderCode}\` trong hệ thống.${hint}`, ephemeral: true });
    return;
  }

  if (currentOrder.total_amount > 0 && currentOrder.payment_status !== 'PAID') {
    await interaction.editReply({ content: `${E('status_warn')} Đơn này chưa thanh toán xong.`, ephemeral: true });
    return;
  }

  if (currentOrder.status === 'COMPLETED') {
    await interaction.editReply({ content: `${E('status_info')} Đơn \`${currentOrder.order_code}\` đã hoàn thành trước đó rồi.`, ephemeral: true });
    return;
  }

  if (currentOrder.status === 'CANCELLED' && currentOrder.payment_status === 'PAID') {
    await interaction.editReply({
      content: `${E('status_warn')} Đơn đã nhận tiền nhưng từng bị hủy. Manager dùng \`/quanly-don\` để đối soát và chọn đưa về xử lý hoặc hoàn thành.`,
    });
    return;
  }

  let order = markOrderCompleted(orderCode, interaction.user.id, config.feedbackTimeoutHours);
  order = ensureOrderExpiry(order.order_code, new Date(order.completed_at ?? Date.now())) ?? order;
  await updateOrderLogMessage(interaction.guild, order);
  
  const hub = getCenarHub();
  if (hub) hub.completeOrder(orderCode).catch(e => console.error('[HUB] Lỗi completeOrder:', e.message));
  
  const result = await sendCompletedFlow({ guild: interaction.guild, order, actorId: interaction.user.id, supportId: interaction.user.id });
  await emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: order.customer_id, action: 'ORDER_COMPLETE_MANUAL', detail: 'Lệnh /hoanthanh', relatedOrderCode: order.order_code });
  await interaction.editReply({ content: buildDoneConfirmationText(order, result.dmSent), ephemeral: true });
}

const STATUS_HINT_LABEL = {
  PENDING_PAYMENT: 'chờ thanh toán',
  PROCESSING: 'đang xử lý',
  COMPLETED: 'đã hoàn thành',
  CANCELLED: 'đã hủy',
  WARRANTY_OPEN: 'đang bảo hành',
};

function getOrderStatusHint(order) {
  return STATUS_HINT_LABEL[order.status] || order.status || 'không rõ trạng thái';
}

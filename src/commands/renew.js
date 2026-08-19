import { createEmojiResolver } from '../utils/emojiHelper.js';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { buildOrderLogContent, formatOrderDuration } from '../utils/formatters.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import {
  createRenewalOrderRaw,
  getOrderByCodeRaw,
  getTicketByChannelIdRaw,
  insertStaffLogRaw,
} from '../services/v11DbHelpers.js';
import { saveOrderLogMessage } from '../services/orderService.js';

export const data = new SlashCommandBuilder()
  .setName('renew')
  .setDescription('Tạo đơn gia hạn dựa trên đơn cũ.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((o) => o.setName('ma_don_cu').setDescription('Mã đơn cũ').setRequired(true))
  .addIntegerOption((o) => o.setName('so_thang').setDescription('Số tháng gia hạn').setRequired(false).setMinValue(1).setMaxValue(36))
  .addIntegerOption((o) => o.setName('so_ngay').setDescription('Số ngày gia hạn, ví dụ 7').setRequired(false).setMinValue(1).setMaxValue(3650))
  .addIntegerOption((o) => o.setName('gia_tien').setDescription('Giá gia hạn').setRequired(false).setMinValue(0));

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  await interaction.deferReply({ flags: 64 });

  const oldOrderCode = interaction.options.getString('ma_don_cu', true).trim().toUpperCase();
  const oldOrder = getOrderByCodeRaw(oldOrderCode);

  if (!oldOrder) {
    await interaction.editReply(`${E('status_warn')} Không tìm thấy mã đơn cũ.`);
    return;
  }

  const ticket = getTicketByChannelIdRaw(interaction.channelId);
  if (!ticket) {
    await interaction.editReply(`${E('status_warn')} Hãy chạy lệnh này trong ticket gia hạn hoặc ticket hiện tại của khách.`);
    return;
  }

  const selectedMonths = interaction.options.getInteger('so_thang');
  const selectedDays = interaction.options.getInteger('so_ngay');
  if (selectedMonths !== null && selectedDays !== null) {
    await interaction.editReply(`${E('status_warn')} Chỉ chọn **số tháng** hoặc **số ngày**, không nhập cả hai.`);
    return;
  }
  const days = selectedDays ?? (selectedMonths === null ? oldOrder.duration_days : null);
  const months = days
    ? 0
    : (selectedMonths ?? (Number(oldOrder.duration_months) > 0 ? oldOrder.duration_months : 1));
  const price = interaction.options.getInteger('gia_tien') ?? oldOrder.total_amount ?? 0;
  const guildConfig = getGuildConfig(interaction.guildId);

  const newOrder = createRenewalOrderRaw({
    guildId: interaction.guildId,
    ticketId: ticket.id,
    ticketChannelId: interaction.channelId,
    customerId: oldOrder.customer_id,
    productName: oldOrder.product_name,
    quantity: oldOrder.quantity ?? 1,
    note: `Gia hạn từ đơn ${oldOrder.order_code}`,
    totalAmount: price,
    durationMonths: months,
    durationDays: days,
    orderLogChannelId: guildConfig?.order_log_channel_id ?? null,
    createdById: interaction.user.id,
  });

  try {
    const orderLogChannel = guildConfig?.order_log_channel_id
      ? await interaction.guild.channels.fetch(guildConfig.order_log_channel_id).catch(() => null)
      : null;

    if (orderLogChannel?.isTextBased?.()) {
      const logMessage = await orderLogChannel.send({ content: buildOrderLogContent(newOrder) }).catch(() => null);
      if (logMessage?.id) {
        saveOrderLogMessage(newOrder.order_code, logMessage.id);
      }
    }
  } catch {}

  insertStaffLogRaw({
    guildId: interaction.guildId,
    actorId: interaction.user.id,
    action: 'ORDER_RENEW_CREATED',
    orderCode: newOrder.order_code,
    targetCustomerId: newOrder.customer_id,
    beforeJson: JSON.stringify({ source_order_code: oldOrder.order_code }),
    afterJson: JSON.stringify({ duration_months: newOrder.duration_months, duration_days: newOrder.duration_days, total_amount: newOrder.total_amount }),
  });

  await interaction.editReply(
    `${E('status_check')} Đã tạo đơn gia hạn mới \`${newOrder.order_code}\` từ đơn cũ \`${oldOrder.order_code}\` với thời hạn **${formatOrderDuration(newOrder)}**.`,
  );
}

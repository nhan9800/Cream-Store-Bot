import { createEmojiResolver } from '../utils/emojiHelper.js';
import { SlashCommandBuilder } from 'discord.js';
import { findLatestPendingFeedbackOrder, getOrderByCode } from '../services/orderService.js';
import { publishFeedback } from '../services/feedbackService.js';
import { emitStaffLog } from '../services/staffLogService.js';

export const data = new SlashCommandBuilder()
  .setName('feedback')
  .setDescription('Gửi feedback đơn hàng vào kênh feedback của shop.')
  .setDMPermission(false)
  .addIntegerOption((option) =>
    option
      .setName('so_sao')
      .setDescription('Số sao đánh giá')
      .setRequired(true)
      .addChoices(
        { name: '1 sao', value: 1 },
        { name: '2 sao', value: 2 },
        { name: '3 sao', value: 3 },
        { name: '4 sao', value: 4 },
        { name: '5 sao', value: 5 },
      ),
  )
  .addStringOption((option) =>
    option.setName('y_kien').setDescription('Ý kiến của bạn').setRequired(false).setMaxLength(700),
  )
  .addStringOption((option) =>
    option.setName('ma_don').setDescription('Bỏ trống để bot tự lấy đơn hoàn thành gần nhất').setRequired(false),
  );

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  const stars = interaction.options.getInteger('so_sao', true);
  const content = interaction.options.getString('y_kien') ?? 'Không có ý kiến';
  const inputOrderCode = interaction.options.getString('ma_don');

  let order = inputOrderCode
    ? getOrderByCode(inputOrderCode.trim().toUpperCase())
    : findLatestPendingFeedbackOrder(interaction.guildId, interaction.user.id);

  if (!order) {
    await interaction.reply({
      content: `${E('status_warn')} Bot không tìm thấy đơn hoàn thành nào để liên kết feedback. Hãy nhập thêm \`ma_don\` nếu cần.`,
      ephemeral: true,
    });
    return;
  }

  // publishFeedback sẽ chặn nếu người thao tác không phải chủ đơn và
  // cũng không phải admin/manager (quyền kiểm tra tập trung ở service).
  try {
    const result = await publishFeedback({
      guild: interaction.guild,
      userId: order.customer_id,
      orderCode: order.order_code,
      stars,
      content,
      actorId: interaction.user.id,
    });

    order = result.order;

    if (result.onBehalf) {
      await emitStaffLog(interaction.client, {
        guildId: interaction.guildId,
        actorId: interaction.user.id,
        targetId: order.customer_id,
        action: 'FEEDBACK_ON_BEHALF',
        detail: `Admin dùng /feedback ghi nhận ${stars}/5 sao thay cho khách`,
        relatedOrderCode: order.order_code,
        relatedTicketCode: result.ticket?.ticket_code || null,
      });
    }

    await interaction.reply({
      content: result.onBehalf
        ? `${E('status_check')} Đã ghi nhận feedback ${stars}★ thay cho khách <@${order.customer_id}> và đăng vào ${result.feedbackChannel} cho đơn ${order.order_code}.`
        : `${E('status_check')} Cảm ơn bạn đã feedback. Bot đã đăng feedback vào ${result.feedbackChannel} cho đơn ${order.order_code}.`,
      ephemeral: true,
    });
  } catch (error) {
    await interaction.reply({
      content: `${E('status_warn')} ${error.message}`,
      ephemeral: true,
    });
  }
}

import { getGuildConfig } from './guildConfigService.js';
import { getOrderByCode, submitFeedback } from './orderService.js';
import { syncCustomerStats } from './customerService.js';
import { buildFeedbackV2 } from '../utils/embeds.js';
import { isManager } from '../utils/permissions.js';
import { config } from '../config.js';
import { scheduleOrderTicketAutoClose } from './ticketService.js';

export function scheduleFeedbackTicketAutoClose(order) {
  return scheduleOrderTicketAutoClose(order, config.autoCloseCompletedTicketMinutes);
}

/** Rebuild the Discord card after an admin edits the published feedback. */
export async function syncPublishedFeedbackMessage({ client, feedback }) {
  const channelId = String(feedback?.feedback_channel_id || '').trim();
  const messageId = String(feedback?.feedback_message_id || '').trim();
  if (!client || !channelId || !messageId) return { synced: false, reason: 'missing_message_reference' };

  const guildId = String(feedback?.guild_id || '').trim();
  const guild = (guildId && client.guilds?.cache?.get(guildId))
    || (guildId ? await client.guilds?.fetch(guildId).catch(() => null) : null);
  if (!guild) return { synced: false, reason: 'guild_unavailable' };

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return { synced: false, reason: 'channel_unavailable' };
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return { synced: false, reason: 'message_unavailable' };

  const storedOrder = getOrderByCode(feedback.order_code) || {};
  const order = {
    ...storedOrder,
    order_code: feedback.order_code || storedOrder.order_code,
    guild_id: feedback.guild_id || storedOrder.guild_id,
    customer_id: feedback.customer_id || storedOrder.customer_id,
    product_name: feedback.product_name || storedOrder.product_name,
    quantity: storedOrder.quantity || 1,
  };
  const member = await guild.members.fetch(feedback.customer_id).catch(() => null);
  const { container, flags } = buildFeedbackV2({
    member: member || { id: feedback.customer_id },
    order,
    stars: feedback.stars,
    content: feedback.content,
  });
  await message.edit({ components: [container], flags });
  console.info(`[FEEDBACK-SYNC] Updated Discord message ${messageId} for order ${order.order_code}`);
  return { synced: true, channelId, messageId };
}

export async function publishFeedback({ guild, userId, orderCode, stars, content, actorId = null }) {
  const guildConfig = getGuildConfig(guild.id);
  if (!guildConfig) {
    throw new Error('Server chưa setup hệ thống.');
  }

  const order = getOrderByCode(orderCode);
  if (!order) {
    throw new Error('Không tìm thấy đơn hàng.');
  }

  // Người thao tác có thể là chủ đơn (tự feedback) hoặc admin/manager ghi hộ.
  // Khi là admin ghi hộ: userId vẫn là KHÁCH HÀNG để giữ nguyên attribution
  // (thẻ công khai, DB, thống kê, gỡ role non_legit); actorId là người bấm.
  const onBehalf = Boolean(actorId) && actorId !== userId;

  if (order.customer_id !== userId) {
    throw new Error('Bạn không phải chủ đơn hàng này.');
  }

  if (onBehalf) {
    const actorMember = await guild.members.fetch(actorId).catch(() => null);
    if (!isManager(actorMember, guildConfig)) {
      throw new Error('Bạn không có quyền đánh giá hộ khách hàng.');
    }
  }


  if (order.guild_id && order.guild_id !== guild.id) {
    throw new Error('Đơn hàng này không thuộc server hiện tại.');
  }

  if (order.status !== 'COMPLETED') {
    throw new Error('Chỉ có thể feedback cho đơn đã hoàn thành.');
  }

  if (order.feedback_submitted_at) {
    throw new Error('Đơn này đã feedback rồi.');
  }

  const feedbackChannel = await guild.channels.fetch(guildConfig.feedback_channel_id).catch(() => null);
  if (!feedbackChannel?.isTextBased()) {
    throw new Error('Kênh feedback đang không khả dụng.');
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    throw new Error('Không lấy được thông tin thành viên.');
  }

  const { container, flags } = buildFeedbackV2({ member, order, stars, content });
  const feedbackMessage = await feedbackChannel.send({
    components: [container],
    flags,
  });

  const updatedOrder = submitFeedback({
    orderCode: order.order_code,
    customerId: userId,
    stars,
    content,
    feedbackChannelId: feedbackChannel.id,
    feedbackMessageId: feedbackMessage.id,
  });
  const ticket = scheduleFeedbackTicketAutoClose(updatedOrder);

  syncCustomerStats(updatedOrder.guild_id, updatedOrder.customer_id);

  if (guildConfig.non_legit_role_id && member.roles.cache.has(guildConfig.non_legit_role_id)) {
    await member.roles.remove(guildConfig.non_legit_role_id, `Đã feedback đơn ${updatedOrder.order_code}`).catch(() => null);
  }

  const ticketChannel = await guild.channels.fetch(updatedOrder.ticket_channel_id).catch(() => null);
  if (ticketChannel?.isTextBased()) {
    const ticketMessage = onBehalf
      ? `<@${actorId}> (admin) đã ghi nhận feedback cho đơn ${updatedOrder.order_code} thay cho khách <@${userId}>.`
      : `<@${userId}> đã gửi feedback cho đơn ${updatedOrder.order_code}. Cảm ơn bạn nhé!`;
    await ticketChannel.send(ticketMessage).catch(() => null);
  }

  return {
    order: updatedOrder,
    feedbackChannel,
    ticket,
    onBehalf,
    actorId: onBehalf ? actorId : userId,
  };
}

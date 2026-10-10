import { getGuildConfig } from './guildConfigService.js';
import { getOrderByCode, submitFeedback } from './orderService.js';
import { syncCustomerStats } from './customerService.js';
import { buildFeedbackV2 } from '../utils/embeds.js';
import { isManager } from '../utils/permissions.js';
import { config } from '../config.js';
import { getFeedbackAutoCloseState, scheduleOrderTicketAutoClose } from './ticketService.js';
import { db } from '../database/db.js';
import { normalizeMessagePresentation } from '../utils/discordEmojiBoundary.js';

export function scheduleFeedbackTicketAutoClose(order) {
  const ticket = scheduleOrderTicketAutoClose(order, config.autoCloseCompletedTicketMinutes);
  const state = ticket
    ? getFeedbackAutoCloseState(ticket)
    : { eligible: false, reason: 'ticket_not_found', blockingOrders: [] };
  return {
    ticket,
    state,
    scheduled: Boolean(ticket?.auto_close_at && state.eligible && Number(ticket.keep_open_requested) !== 1),
  };
}

/** Rebuild the Discord card after an admin edits the published feedback. */
export async function syncPublishedFeedbackMessage({ client, feedback, guild: providedGuild = null }) {
  const channelId = String(feedback?.feedback_channel_id || '').trim();
  const messageId = String(feedback?.feedback_message_id || '').trim();
  if (!client || !channelId || !messageId) return { synced: false, reason: 'missing_message_reference' };

  const guildId = String(feedback?.guild_id || '').trim();
  const guild = providedGuild || (guildId && client.guilds?.cache?.get(guildId))
    || (guildId ? await client.guilds?.fetch(guildId).catch(() => null) : null);
  if (!guild) return { synced: false, reason: 'guild_unavailable' };
  if (guild.id !== guildId) return { synced: false, reason: 'guild_mismatch' };

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return { synced: false, reason: 'channel_unavailable' };
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return { synced: false, reason: 'message_unavailable' };
  if (!client.user?.id || message.author?.id !== client.user.id) {
    return { synced: false, reason: 'message_owner_mismatch' };
  }

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
  await message.edit({ content: null, embeds: [], components: [container], flags, allowedMentions: { parse: [] } });
  console.info(`[FEEDBACK-SYNC] Updated Discord message ${messageId} for order ${order.order_code}`);
  return { synced: true, channelId, messageId };
}

/** Only change the purchased item label; the customer's opinion and rating stay intact. */
export async function syncOrderFeedbackMessages({ guild, order }) {
  if (!guild || order?.guild_id !== guild.id) return { synced: false, status: 'guild_mismatch' };
  order = getOrderByCode(order.order_code) || order;
  if (order.guild_id !== guild.id) return { synced: false, status: 'guild_mismatch' };
  db.prepare('UPDATE feedbacks SET product_name=?, updated_at=CURRENT_TIMESTAMP WHERE guild_id=? AND order_code=? AND product_name IS NOT ?')
    .run(order.product_name, guild.id, order.order_code, order.product_name);
  const feedbacks = db.prepare('SELECT * FROM feedbacks WHERE guild_id=? AND order_code=?')
    .all(guild.id, order.order_code);
  if (!feedbacks.length) return { synced: true, status: 'not_submitted', count: 0 };
  let synced = 0;
  for (const feedback of feedbacks) {
    try {
      const result = await syncPublishedFeedbackMessage({ client: guild.client, guild, feedback });
      if (result.synced) synced += 1;
    } catch (error) {
      console.warn(`[FEEDBACK-SYNC] ${order.order_code}: ${error.code || 'SYNC_FAILED'}`);
    }
  }
  return { synced: synced === feedbacks.length, status: synced === feedbacks.length ? 'updated' : 'error', count: synced };
}

export async function inspectOrderFeedbackMessages({ guild, order }) {
  if (!guild || order?.guild_id !== guild.id) return { count: 0, verified: 0 };
  const feedbacks = db.prepare('SELECT * FROM feedbacks WHERE guild_id=? AND order_code=?').all(guild.id, order.order_code);
  let verified = 0;
  const texts = (components) => {
    const result = [];
    const visit = (node) => {
      node = node?.toJSON?.() || node;
      if (node?.type === 10) result.push(node.content);
      for (const child of node?.components || []) visit(child);
    };
    for (const component of components || []) visit(component);
    return result;
  };
  for (const feedback of feedbacks) {
    try {
      const channel = await guild.channels.fetch(feedback.feedback_channel_id);
      const message = await channel?.messages?.fetch(feedback.feedback_message_id);
      if (!message || message.author?.id !== guild.client.user?.id) continue;
      const { container } = buildFeedbackV2({ member: { id: feedback.customer_id },
        order: { ...order, product_name: feedback.product_name || order.product_name },
        stars: feedback.stars, content: feedback.content });
      const expected = normalizeMessagePresentation({ components: [container] }, guild.id);
      if (JSON.stringify(texts(message.components)) === JSON.stringify(texts(expected.components))) verified += 1;
    } catch { /* Report failed reads as unverified; never recreate a public review. */ }
  }
  return { count: feedbacks.length, verified };
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
  const autoClose = scheduleFeedbackTicketAutoClose(updatedOrder);
  const ticket = autoClose.ticket;

  syncCustomerStats(updatedOrder.guild_id, updatedOrder.customer_id);

  if (guildConfig.non_legit_role_id && member.roles.cache.has(guildConfig.non_legit_role_id)) {
    await member.roles.remove(guildConfig.non_legit_role_id, `Đã feedback đơn ${updatedOrder.order_code}`).catch(() => null);
  }

  const ticketChannel = await guild.channels.fetch(updatedOrder.ticket_channel_id).catch(() => null);
  if (ticketChannel?.isTextBased()) {
    const ticketMessage = onBehalf
      ? `<@${actorId}> (admin) đã ghi nhận feedback cho đơn ${updatedOrder.order_code} thay cho khách <@${userId}>.`
      : `<@${userId}> đã gửi feedback cho đơn ${updatedOrder.order_code}. Cảm ơn bạn nhé!`;
    const closureMessage = autoClose.scheduled
      ? ` Ticket sẽ tự đóng sau ${config.autoCloseCompletedTicketMinutes} phút nếu không chọn giữ mở.`
      : (autoClose.state.blockingOrders?.length
        ? ` Ticket vẫn mở vì còn ${autoClose.state.blockingOrders.length} đơn khác đang xử lý hoặc chưa hoàn tất feedback.`
        : ' Ticket tiếp tục mở theo trạng thái hỗ trợ hiện tại.');
    await ticketChannel.send(`${ticketMessage}${closureMessage}`).catch(() => null);
  }

  return {
    order: updatedOrder,
    feedbackChannel,
    ticket,
    autoClose,
    onBehalf,
    actorId: onBehalf ? actorId : userId,
  };
}

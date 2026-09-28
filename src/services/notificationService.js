import { MessageFlags } from 'discord.js';
import { config, getTranscriptViewerUrl } from '../config.js';
import { getGuildConfig } from './guildConfigService.js';
import { applyCustomerRoles } from './roleService.js';
import {
  buildCompletionDmEmbed,
  buildFeedbackLinkComponents,
  buildOrderCompletedV2,
  buildPaymentSuccessDmEmbed,
  buildPaymentSuccessEmbed,
  buildQuickFeedbackComponents,
  buildTranscriptCustomerV2,
  buildTranscriptSummaryV2,
  buildWarrantyActionComponents,
  buildPublicOrderLogEmbed,
  buildPublicOrderLogV2,
  buildOrderLogV2Update,
  buildOrderCancelledCustomerV2,
} from '../utils/embeds.js';
import { formatCurrency, buildOrderLogContent } from '../utils/formatters.js';
import { recordTranscriptDiscordMirror } from './transcriptService.js';
import { syncCtvOrderLog } from './ctvOrderLogService.js';
import { saveCompletionMessageReference } from './orderService.js';

const COMPLETION_MESSAGE_SCAN_LIMIT = 500;

function buildCompletedTicketPayload(guildId, order, staffId, supportId) {
  const guildConfig = getGuildConfig(guildId);
  const { container, flags } = buildOrderCompletedV2(order, staffId, supportId);
  return {
    components: [
      container,
      ...buildQuickFeedbackComponents(order.order_code),
      ...buildWarrantyActionComponents(order.order_code),
      ...buildFeedbackLinkComponents(guildId, guildConfig?.feedback_channel_id),
    ],
    flags,
    allowedMentions: { users: [order.customer_id] },
  };
}

function isCompletionMessageForOrder(message, orderCode, botUserId = null) {
  if (!message) return false;
  if (botUserId && message.author?.id && message.author.id !== botUserId) return false;
  const components = (message.components || []).map((component) => component?.toJSON?.() || component);
  const serialized = JSON.stringify(components);
  return serialized.includes(`feedback:quick:${orderCode}:`)
    || serialized.includes(`ticket:warranty:${orderCode}`);
}

async function findCompletionMessage(channel, orderCode, botUserId) {
  if (!channel?.isTextBased?.() || !channel.messages?.fetch) return null;
  let before;
  let scanned = 0;
  while (scanned < COMPLETION_MESSAGE_SCAN_LIMIT) {
    const page = await channel.messages.fetch({
      limit: Math.min(100, COMPLETION_MESSAGE_SCAN_LIMIT - scanned),
      ...(before ? { before } : {}),
    }).catch(() => null);
    if (!page?.size) return null;
    const messages = [...page.values()];
    const match = messages.find((message) => isCompletionMessageForOrder(message, orderCode, botUserId));
    if (match) return match;
    scanned += messages.length;
    before = messages.at(-1)?.id;
    if (messages.length < 100 || !before) return null;
  }
  return null;
}

async function resolveCompletionMessage(guild, order) {
  const channelIds = [...new Set([
    order.completion_channel_id,
    order.ticket_channel_id,
  ].filter(Boolean).map(String))];
  const botUserId = guild.client?.user?.id || null;
  for (const channelId of channelIds) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) continue;
    if (order.completion_message_id && channelId === String(order.completion_channel_id || order.ticket_channel_id)) {
      const stored = await channel.messages.fetch(order.completion_message_id).catch(() => null);
      if (isCompletionMessageForOrder(stored, order.order_code, botUserId)) {
        return { channel, message: stored, source: 'stored' };
      }
    }
    const discovered = await findCompletionMessage(channel, order.order_code, botUserId);
    if (discovered) return { channel, message: discovered, source: 'discovered' };
    if (channelId === String(order.ticket_channel_id)) return { channel, message: null, source: 'missing' };
  }
  return { channel: null, message: null, source: 'channel_missing' };
}

function completionActors(order, staffId = null, supportId = null) {
  const resolvedStaffId = staffId
    || order.completion_staff_id
    || order.delivered_by_id
    || order.completed_by_id
    || order.created_by_id;
  const resolvedSupportId = supportId
    || order.completion_support_id
    || order.delivered_by_id
    || order.completed_by_id
    || resolvedStaffId;
  return { staffId: resolvedStaffId, supportId: resolvedSupportId };
}

async function syncCompletedTicketMessage({ guild, order, staffId = null, supportId = null, createIfMissing = false }) {
  const actors = completionActors(order, staffId, supportId);
  if (!actors.staffId) return { synced: false, status: 'missing_staff' };
  const resolved = await resolveCompletionMessage(guild, order);
  const payload = buildCompletedTicketPayload(guild.id, order, actors.staffId, actors.supportId);
  let message = resolved.message;
  let status = resolved.source;

  if (message) {
    await message.edit(payload);
    status = resolved.source === 'stored' ? 'updated' : 'discovered_and_updated';
  } else if (createIfMissing && resolved.channel) {
    message = await resolved.channel.send(payload);
    status = 'created';
  } else {
    return { synced: false, status: resolved.source };
  }

  saveCompletionMessageReference(order.order_code, {
    channelId: resolved.channel.id,
    messageId: message.id,
    staffId: actors.staffId,
    supportId: actors.supportId,
  });
  return {
    synced: true,
    status,
    channelId: resolved.channel.id,
    messageId: message.id,
  };
}

export async function refreshCompletedTicketMessage({ guild, order }) {
  if (!order?.completed_at && !['COMPLETED', 'WARRANTY_OPEN'].includes(String(order?.status || ''))) {
    return { synced: false, status: 'not_completed' };
  }
  try {
    return await syncCompletedTicketMessage({ guild, order, createIfMissing: false });
  } catch (error) {
    console.error(`[ORDER-COMPLETION-SYNC] Không thể cập nhật ${order?.order_code}:`, error);
    return { synced: false, status: 'error', error: error.message };
  }
}

export async function updateOrderLogMessage(guild, order) {
  await syncCtvOrderLog(order, guild?.client).catch((error) => {
    console.error(`[CTV-ORDER-LOG] Không thể đồng bộ ${order?.order_code}: ${error.message}`);
  });
  const orderLogChannel = await guild.channels.fetch(order.order_log_channel_id).catch(() => null);
  if (!orderLogChannel?.isTextBased() || !order.order_log_message_id) return;

  const logMessage = await orderLogChannel.messages.fetch(order.order_log_message_id).catch(() => null);
  if (!logMessage) return;

  if (logMessage.flags.has(MessageFlags.IsComponentsV2)) {
    await logMessage.edit(buildOrderLogV2Update(order)).catch(() => null);
  } else {
    await logMessage.edit({ content: buildOrderLogContent(order) }).catch(() => null);
  }
}

export async function sendPaymentConfirmedFlow({ guild, order, amount, transactionContent = null }) {
  const ticketChannel = await guild.channels.fetch(order.ticket_channel_id).catch(() => null);

  if (ticketChannel?.isTextBased()) {
    await ticketChannel.send(
      buildPaymentSuccessEmbed(
        order,
        formatCurrency(amount ?? order.amount_paid ?? order.total_amount),
        transactionContent,
      )
    ).catch(() => null);
  }

  const customer = await guild.client.users.fetch(order.customer_id).catch(() => null);
  if (!customer) return { dmSent: false };

  const dmMessage = await customer.send({
    embeds: [buildPaymentSuccessDmEmbed(order)],
  }).catch(() => null);

  return {
    dmSent: Boolean(dmMessage),
    dmChannelId: dmMessage?.channelId ?? null,
    dmMessageId: dmMessage?.id ?? null,
  };
}

export async function sendCompletedTicketFlow({ guild, order, actorId, supportId }) {
  try {
    const result = await syncCompletedTicketMessage({
      guild,
      order,
      staffId: actorId,
      supportId,
      createIfMissing: true,
    });
    return { posted: result.synced, ...result };
  } catch (err) {
    console.error('[sendCompletedTicketFlow] Error sending completion V2 flow:', err);
    return { posted: false, synced: false, status: 'error', error: err.message };
  }
}

export async function sendCompletedFlow({ guild, order, actorId, supportId }) {
  await sendCompletedTicketFlow({ guild, order, actorId, supportId });

  const customer = await guild.client.users.fetch(order.customer_id).catch(() => null);
  const dmMessage = customer ? await customer.send({ embeds: [buildCompletionDmEmbed(order)] }).catch(() => null) : null;
  await applyCustomerRoles(guild, order.customer_id);

  // Bắn log công khai nếu được cấu hình
  const guildConfig = getGuildConfig(guild.id);
  if (guildConfig?.public_order_log_channel_id) {
    const publicLogChannel = await guild.channels.fetch(guildConfig.public_order_log_channel_id).catch(() => null);
    if (publicLogChannel?.isTextBased()) {
      await publicLogChannel.send(buildPublicOrderLogV2(order)).catch(() => null);
    }
  }

  return {
    dmSent: Boolean(dmMessage),
    dmChannelId: dmMessage?.channelId ?? null,
    dmMessageId: dmMessage?.id ?? null,
  };
}

export async function deliverTranscript({ guild, ticket, transcriptResult, closedById }) {
  const guildConfig = getGuildConfig(guild.id);

  const transcriptUrl = getTranscriptViewerUrl(transcriptResult.accessToken);
  if (!transcriptResult.savedToDisk || !transcriptResult.archiveId || !transcriptUrl) {
    const reason = !transcriptResult.savedToDisk
      ? 'Không thể lưu transcript nén lên ổ đĩa.'
      : !transcriptResult.archiveId
        ? 'Không thể đăng ký transcript trong cơ sở dữ liệu.'
        : 'Thiếu TRANSCRIPT_VIEWER_BASE_URL hoặc STORE_WEBSITE_URL.';
    console.error(`[TRANSCRIPT] Không thể gửi liên kết cho ticket ${ticket.ticket_code}: ${reason}`);
    return { delivered: false, reason };
  }

  let mirrored = false;
  if (guildConfig?.transcript_channel_id) {
    const transcriptChannel = await guild.channels.fetch(guildConfig.transcript_channel_id).catch(() => null);
    if (transcriptChannel?.isTextBased()) {
      const summary = buildTranscriptSummaryV2({
        ticket,
        closedById,
        messageCount: transcriptResult.messageCount,
        transcriptUrl,
        guildId: guild.id,
        compressedBytes: transcriptResult.compressedBytes,
      });
      let archiveMessage = await transcriptChannel.send({
        ...summary,
        files: [{ attachment: transcriptResult.savedArchivePath, name: transcriptResult.archiveFileName }],
      }).catch((error) => {
        console.warn(`[TRANSCRIPT] Không thể đính kèm archive ${transcriptResult.archiveCode}:`, error.message);
        return null;
      });
      // A server upload limit must not prevent the customer from receiving the
      // viewer link. Keep the local archive and post the summary without a file.
      if (!archiveMessage) archiveMessage = await transcriptChannel.send(summary).catch(() => null);
      const attachment = archiveMessage?.attachments?.first?.() || null;
      if (archiveMessage && attachment) {
        mirrored = recordTranscriptDiscordMirror({
          archiveId: transcriptResult.archiveId,
          closedById,
          channelId: transcriptChannel.id,
          messageId: archiveMessage.id,
          attachmentId: attachment.id,
          attachmentUrl: attachment.url,
        });
      }
    }
  }

  if (!config.sendTranscriptToCustomer) return { delivered: true, customerSent: false, transcriptUrl };

  const customer = await guild.client.users.fetch(ticket.customer_id).catch(() => null);
  if (!customer) return { delivered: true, customerSent: false, transcriptUrl };

  const customerMessage = await customer.send(buildTranscriptCustomerV2({
    ticket,
    messageCount: transcriptResult.messageCount,
    transcriptUrl,
    guildId: guild.id,
  })).catch(() => null);

  return { delivered: true, customerSent: Boolean(customerMessage), mirrored, transcriptUrl };
}

export async function sendOrderCancelledFlow({ guild, order, reason = null }) {
  if (!guild || !order?.customer_id) return { dmSent: false };
  const customer = await guild.client.users.fetch(order.customer_id).catch(() => null);
  if (!customer) return { dmSent: false };
  const dmMessage = await customer.send(
    buildOrderCancelledCustomerV2(order, reason || order.payment_cancel_reason),
  ).catch(() => null);
  return {
    dmSent: Boolean(dmMessage),
    dmChannelId: dmMessage?.channelId ?? null,
    dmMessageId: dmMessage?.id ?? null,
  };
}

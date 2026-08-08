import { MessageFlags } from 'discord.js';
import { config, getTranscriptUrl } from '../config.js';
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
} from '../utils/embeds.js';
import { formatCurrency, buildOrderLogContent } from '../utils/formatters.js';

export async function updateOrderLogMessage(guild, order) {
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
  const guildConfig = getGuildConfig(guild.id);
  const ticketChannel = await guild.channels.fetch(order.ticket_channel_id).catch((err) => {
    console.error(`[sendCompletedTicketFlow] Fetch ticket channel ${order.ticket_channel_id} failed:`, err.message);
    return null;
  });

  if (!ticketChannel?.isTextBased()) {
    console.warn(`[sendCompletedTicketFlow] Ticket channel ${order.ticket_channel_id} not found or not text-based.`);
    return { posted: false };
  }

  try {
    const { container, flags } = buildOrderCompletedV2(order, actorId, supportId);
    const quickFb = buildQuickFeedbackComponents(order.order_code);
    const warranty = buildWarrantyActionComponents(order.order_code);
    const links = buildFeedbackLinkComponents(guild.id, guildConfig?.feedback_channel_id);

    await ticketChannel.send({
      components: [
        container,
        ...quickFb,
        ...warranty,
        ...links,
      ],
      flags,
      allowedMentions: { users: [order.customer_id] },
    });
  } catch (err) {
    console.error('[sendCompletedTicketFlow] Error sending completion V2 flow:', err);
  }

  return { posted: true };
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

  const transcriptUrl = getTranscriptUrl(`/transcripts/${transcriptResult.htmlFileName}`);
  if (!transcriptResult.savedToDisk || !transcriptUrl) {
    const reason = !transcriptResult.savedToDisk
      ? 'Không thể lưu transcript lên ổ đĩa.'
      : 'Thiếu TRANSCRIPT_BASE_URL hoặc PUBLIC_BASE_URL.';
    console.error(`[TRANSCRIPT] Không thể gửi liên kết cho ticket ${ticket.ticket_code}: ${reason}`);
    return { delivered: false, reason };
  }

  if (guildConfig?.transcript_channel_id) {
    const transcriptChannel = await guild.channels.fetch(guildConfig.transcript_channel_id).catch(() => null);
    if (transcriptChannel?.isTextBased()) {
      await transcriptChannel.send(buildTranscriptSummaryV2({
        ticket,
        closedById,
        messageCount: transcriptResult.messageCount,
        transcriptUrl,
        guildId: guild.id,
      })).catch(() => null);
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

  return { delivered: true, customerSent: Boolean(customerMessage), transcriptUrl };
}

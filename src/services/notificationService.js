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
import { getOrderByCode, saveCompletionMessageReference, saveCompletionUpdateDmReference } from './orderService.js';
import { getTicketById, getTicketByChannelId } from './ticketService.js';
import { normalizeMessagePresentation } from '../utils/discordEmojiBoundary.js';

const COMPLETION_MESSAGE_SCAN_LIMIT = 500;
const completionLocks = new Map();

async function withCompletionLock(orderCode, action) {
  const previous = completionLocks.get(orderCode) || Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  completionLocks.set(orderCode, current);
  try { return await current; }
  finally { if (completionLocks.get(orderCode) === current) completionLocks.delete(orderCode); }
}

async function fetchOrMissing(fetcher, missingCode) {
  try { return await fetcher(); }
  catch (error) {
    if (Number(error.code) === missingCode) return null;
    throw error; // Missing Access, permission failures and timeouts are not deletion.
  }
}

function buildCompletedTicketPayload(guildId, order, staffId, supportId) {
  const guildConfig = getGuildConfig(guildId);
  const { container, flags } = buildOrderCompletedV2(order, staffId, supportId);
  return {
    components: [
      container,
      ...(order.feedback_submitted_at ? [] : buildQuickFeedbackComponents(order.order_code)),
      ...buildWarrantyActionComponents(order.order_code),
      ...buildFeedbackLinkComponents(guildId, guildConfig?.feedback_channel_id),
    ],
    flags,
    allowedMentions: { parse: [] },
  };
}

function isCompletionMessageForOrder(message, orderCode, botUserId = null) {
  if (!message) return false;
  if (!botUserId || message.author?.id !== botUserId) return false;
  const components = (message.components || []).map((component) => component?.toJSON?.() || component);
  const nodes = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    for (const child of node.components || []) visit(child);
  };
  components.forEach(visit);
  if (nodes.some((node) => node.custom_id === `ticket:warranty:${orderCode}`
    || [1, 2, 3, 4, 5].some((stars) => node.custom_id === `feedback:quick:${orderCode}:${stars}`))) return true;
  // Legacy embeds and cards whose feedback buttons were removed still have a
  // completion heading and an exact order code. Never match a public review.
  const text = [message.content, ...nodes.map((node) => node.content),
    ...(message.embeds || []).map((embed) => JSON.stringify(embed?.toJSON?.() || embed))].join('\n');
  const escaped = String(orderCode).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return /ĐƠN HÀNG (?:ĐÃ )?HOÀN THÀNH|ORDER COMPLETED|Đơn Hàng Đã Hoàn Thành/i.test(text)
    && new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`).test(text);
}

async function findCompletionMessage(channel, orderCode, botUserId) {
  if (!channel?.isTextBased?.() || !channel.messages?.fetch) return { message: null, exhausted: false };
  let before;
  let scanned = 0;
  while (scanned < COMPLETION_MESSAGE_SCAN_LIMIT) {
    const page = await channel.messages.fetch({
      limit: Math.min(100, COMPLETION_MESSAGE_SCAN_LIMIT - scanned),
      ...(before ? { before } : {}),
    });
    if (!page?.size) return { message: null, exhausted: true };
    const messages = [...page.values()];
    const match = messages.find((message) => isCompletionMessageForOrder(message, orderCode, botUserId));
    if (match) return { message: match, exhausted: false };
    scanned += messages.length;
    before = messages.at(-1)?.id;
    if (messages.length < 100 || !before) return { message: null, exhausted: true };
  }
  return { message: null, exhausted: false };
}

async function resolveCompletionMessage(guild, order) {
  const ticket = (order.ticket_id && getTicketById(order.ticket_id)) || getTicketByChannelId(order.ticket_channel_id);
  if (ticket && (ticket.guild_id !== guild.id || ticket.customer_id !== order.customer_id)) {
    throw new Error('Ticket không khớp chủ đơn hoặc server.');
  }
  if (ticket?.status === 'CLOSED') return { channel: null, message: null, source: 'ticket_closed' };
  if (!ticket || ticket.channel_id !== order.ticket_channel_id) {
    return { channel: null, message: null, source: 'ticket_unlinked' };
  }
  const channelIds = [...new Set([
    order.completion_channel_id,
    order.ticket_channel_id,
  ].filter(Boolean).map(String))];
  const botUserId = guild.client?.user?.id || null;
  for (const channelId of channelIds) {
    const channel = await fetchOrMissing(() => guild.channels.fetch(channelId), 10003);
    if (!channel?.isTextBased?.()) continue;
    if (channel.guildId && channel.guildId !== guild.id) throw new Error('Kênh không thuộc server của đơn.');
    if (order.completion_message_id && channelId === String(order.completion_channel_id || order.ticket_channel_id)) {
      const stored = await fetchOrMissing(() => channel.messages.fetch(order.completion_message_id), 10008);
      if (isCompletionMessageForOrder(stored, order.order_code, botUserId)) {
        return { channel, message: stored, source: 'stored' };
      }
    }
    const discovered = await findCompletionMessage(channel, order.order_code, botUserId);
    if (discovered.message) return { channel, message: discovered.message, source: 'discovered' };
    if (channelId === String(order.ticket_channel_id)) return {
      channel, message: null, source: discovered.exhausted ? 'missing' : 'search_limit',
    };
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
  if (!guild || order?.guild_id !== guild.id) throw new Error('Đơn không thuộc server hiện tại.');
  const actors = completionActors(order, staffId, supportId);
  if (!actors.staffId) return { synced: false, status: 'missing_staff' };
  const resolved = await resolveCompletionMessage(guild, order);
  const payload = buildCompletedTicketPayload(guild.id, order, actors.staffId, actors.supportId);
  let message = resolved.message;
  let status = resolved.source;

  if (message) {
    try {
      await message.edit({ ...payload, content: null, embeds: [] });
    } catch (error) {
      if (Number(error.code) !== 10008 || !createIfMissing) throw error;
      message = await resolved.channel.send(payload);
      status = 'created';
    }
    if (status !== 'created') {
      status = resolved.source === 'stored' ? 'updated' : 'discovered_and_updated';
    }
  } else if (createIfMissing && resolved.channel && resolved.source === 'missing') {
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

async function syncCompletionUpdateDm(guild, order) {
  if (!/^\d{15,22}$/.test(String(order.customer_id || ''))) return { synced: false, status: 'unlinked_customer' };
  const customer = await guild.client.users.fetch(order.customer_id);
  const channel = await customer.createDM();
  if (order.completion_update_dm_channel_id && order.completion_update_dm_channel_id !== channel.id) {
    throw new Error('DM đã lưu không khớp khách hàng của đơn.');
  }
  const payload = {
    embeds: [buildCompletionDmEmbed(order).setTitle('Thông Tin Đơn Hàng Đã Cập Nhật')],
    allowedMentions: { parse: [] },
  };
  let message = order.completion_update_dm_message_id
    ? await fetchOrMissing(() => channel.messages.fetch(order.completion_update_dm_message_id), 10008)
    : null;
  if (message) {
    const text = JSON.stringify((message.embeds || []).map((embed) => embed?.toJSON?.() || embed));
    if (message.author?.id !== guild.client.user.id || !text.includes(`\`${order.order_code}\``)) {
      throw new Error('Thẻ DM đã lưu không khớp đơn hàng.');
    }
    await message.edit(payload);
  } else {
    message = await channel.send(payload);
  }
  saveCompletionUpdateDmReference(order.order_code, { channelId: channel.id, messageId: message.id });
  return { synced: true, status: 'dm_updated', channelId: channel.id, messageId: message.id };
}

export async function refreshCompletedTicketMessage({ guild, order }) {
  if (!['COMPLETED', 'WARRANTY_OPEN'].includes(String(order?.status || ''))) {
    return { synced: false, status: 'not_completed' };
  }
  return withCompletionLock(order.order_code, async () => {
    try {
      order = getOrderByCode(order.order_code) || order;
      if (order.guild_id !== guild?.id) throw new Error('Đơn không thuộc server hiện tại.');
      if (!['COMPLETED', 'WARRANTY_OPEN'].includes(order.status)) return { synced: false, status: 'not_completed' };
      const result = await syncCompletedTicketMessage({ guild, order, createIfMissing: true });
      if (['ticket_closed', 'channel_missing', 'search_limit', 'ticket_unlinked', 'missing_staff'].includes(result.status)) {
        const dm = await syncCompletionUpdateDm(guild, order);
        return { ...dm, ticketStatus: result.status };
      }
      if (result.synced && order.completion_update_dm_message_id) {
        try {
          const dm = await syncCompletionUpdateDm(guild, order);
          return { ...result, dm_synced: dm.synced, dm_status: dm.status };
        } catch (error) {
          return { ...result, dm_synced: false, dm_status: 'error', dm_code: String(error.code || 'SYNC_FAILED') };
        }
      }
      return result;
    } catch (error) {
      console.error(`[ORDER-COMPLETION-SYNC] ${order?.order_code}: ${error.code || 'SYNC_FAILED'}`);
      return { synced: false, status: 'error', code: String(error.code || 'SYNC_FAILED') };
    }
  });
}

/** Read-only, secret-free evidence for one order's Discord presentation. */
export async function inspectOrderPresentation({ guild, order }) {
  if (!guild || order?.guild_id !== guild.id) throw new Error('Đơn không thuộc server hiện tại.');
  const ticket = (order.ticket_id && getTicketById(order.ticket_id)) || getTicketByChannelId(order.ticket_channel_id);
  const result = {
    order_code: order.order_code,
    status: order.status,
    feedback_submitted: Boolean(order.feedback_submitted_at),
    ticket_status: ticket?.status || null,
    completion_reference_present: Boolean(order.completion_message_id),
    ticket_channel_status: 'missing',
    completion_message_status: 'missing',
    update_dm_status: 'not_created',
    dm_matches_current_order: false,
    dm_field_matches: [],
  };
  try {
    const channel = await fetchOrMissing(() => guild.channels.fetch(order.completion_channel_id || order.ticket_channel_id), 10003);
    if (channel?.isTextBased?.()) {
      result.ticket_channel_status = 'available';
      if (order.completion_message_id) {
        const message = await fetchOrMissing(() => channel.messages.fetch(order.completion_message_id), 10008);
        result.completion_message_status = message ? 'available' : 'missing';
      }
    }
  } catch (error) { result.ticket_channel_status = `error:${error.code || 'READ_FAILED'}`; }
  if (order.completion_update_dm_message_id && /^\d{15,22}$/.test(String(order.customer_id))) {
    try {
      const channel = await fetchOrMissing(() => guild.client.channels.fetch(order.completion_update_dm_channel_id), 10003);
      if (!channel?.isDMBased?.() || channel.recipientId !== order.customer_id) throw new Error('DM mismatch');
      const message = await fetchOrMissing(() => channel.messages.fetch(order.completion_update_dm_message_id), 10008);
      result.update_dm_status = message ? 'available' : 'missing';
      const expected = normalizeMessagePresentation({
        embeds: [buildCompletionDmEmbed(order).setTitle('Thông Tin Đơn Hàng Đã Cập Nhật')],
      }, guild.id).embeds[0];
      const actual = message?.embeds?.[0]?.toJSON?.() || message?.embeds?.[0];
      const canonicalFields = (fields = []) => fields.map((field) => ({
        name: field.name, value: field.value, inline: Boolean(field.inline),
      }));
      result.dm_field_matches = (expected.fields || []).map((field, index) => ({
        index, matches: actual?.fields?.[index]?.name === field.name && actual.fields[index].value === field.value,
      }));
      result.dm_matches_current_order = message?.author?.id === guild.client.user.id
        && JSON.stringify(canonicalFields(actual?.fields)) === JSON.stringify(canonicalFields(expected.fields));
    } catch (error) { result.update_dm_status = `error:${error.code || 'READ_FAILED'}`; }
  }
  return result;
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
  return withCompletionLock(order.order_code, async () => {
    try {
      order = getOrderByCode(order.order_code) || order;
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
  });
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

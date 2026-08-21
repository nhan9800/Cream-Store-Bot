import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { getCtvSettings, resolveCustomerCtvStatus } from './ctvService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { formatCurrency, formatOrderDuration } from '../utils/formatters.js';
import { accentFor } from '../utils/uiKit.js';
import { db } from '../database/db.js';

const PAYMENT_LABELS = Object.freeze({
  PAID: 'ĐÃ THANH TOÁN',
  FREE: 'MIỄN PHÍ',
  UNPAID: 'CHƯA THANH TOÁN',
  CANCELLED: 'ĐÃ HỦY THANH TOÁN',
  REFUNDED: 'ĐÃ HOÀN TIỀN',
});

const ORDER_STATUS_LABELS = Object.freeze({
  PENDING_PAYMENT: 'CHỜ THANH TOÁN',
  PAYMENT_PROCESSING: 'ĐANG XÁC NHẬN THANH TOÁN',
  PAID: 'ĐÃ THANH TOÁN',
  PROCESSING: 'ĐANG XỬ LÝ',
  WAITING_STAFF: 'CHỜ NHÂN VIÊN',
  DELIVERING: 'ĐANG BÀN GIAO',
  COMPLETED: 'HOÀN THÀNH',
  WARRANTY: 'ĐANG BẢO HÀNH',
  WARRANTY_OPEN: 'ĐANG BẢO HÀNH',
  REFUNDED: 'ĐÃ HOÀN TIỀN',
  CANCELLED: 'ĐÃ HỦY',
  FAILED: 'XỬ LÝ THẤT BẠI',
});

const ctvLogSyncLocks = new Map();

export function getCtvOrderDisplayState(order) {
  const paymentCode = String(order?.payment_status || 'UNPAID').toUpperCase();
  const orderCode = String(order?.status || 'PENDING_PAYMENT').toUpperCase();
  return {
    paymentCode,
    paymentLabel: PAYMENT_LABELS[paymentCode] || paymentCode,
    orderCode,
    orderLabel: ORDER_STATUS_LABELS[orderCode] || orderCode,
    paid: paymentCode === 'PAID' || paymentCode === 'FREE',
  };
}

function ctvLogTitle(state) {
  if (state.orderCode === 'COMPLETED') return 'Đơn CTV · Hoàn thành';
  if (state.orderCode === 'CANCELLED') return 'Đơn CTV · Đã hủy';
  if (state.paid) return 'Đơn CTV · Đã thanh toán';
  return 'Đơn hàng CTV mới';
}

export function buildCtvOrderLogPayload(order, currentDate = new Date()) {
  const E = createEmojiResolver(order.guild_id);
  const state = getCtvOrderDisplayState(order);
  const container = new ContainerBuilder().setAccentColor(accentFor(
    state.orderCode === 'CANCELLED' || state.orderCode === 'FAILED'
      ? 'danger'
      : state.paid
        ? 'success'
        : 'warning',
  ));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${E('cenar_ctv')} ${ctvLogTitle(state)}`,
  ));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('cenar_verified')} **Mã đơn:** \`${order.order_code}\``,
    `${E('cenar_partner_ok')} **CTV:** <@${order.customer_id}>`,
    `${E('cenar_price')} **Sản phẩm:** ${order.product_name}`,
    `${E('cenar_cooldown')} **Thời hạn:** ${formatOrderDuration(order)}`,
    `${E('cenar_wallet')} **Tổng tiền:** ${formatCurrency(order.total_amount)}`,
    `${E(state.paid ? 'status_check' : 'status_warn')} **Thanh toán:** ${state.paymentLabel} \`${state.paymentCode}\``,
    `${E(state.orderCode === 'CANCELLED' ? 'status_cross' : 'status_info')} **Xử lý:** ${state.orderLabel} \`${state.orderCode}\``,
    order.ticket_channel_id ? `${E('cenar_support')} **Ticket:** <#${order.ticket_channel_id}>` : null,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# Log nội bộ CTV · Đồng bộ gần nhất ${currentDate.toLocaleString('vi-VN')}`,
  ));

  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

function readComponentText(components = []) {
  return components.flatMap((component) => {
    const raw = typeof component?.toJSON === 'function' ? component.toJSON() : component;
    return [
      ...(typeof raw?.content === 'string' ? [raw.content] : []),
      ...(Array.isArray(raw?.components) ? readComponentText(raw.components) : []),
    ];
  });
}

export function ctvOrderLogNeedsSync(message, order) {
  const state = getCtvOrderDisplayState(order);
  const text = [message?.content || '', ...readComponentText(message?.components)].join('\n');
  return !text.includes(`**Thanh toán:** ${state.paymentLabel} \`${state.paymentCode}\``)
    || !text.includes(`**Xử lý:** ${state.orderLabel} \`${state.orderCode}\``);
}

function saveCtvLogReference(orderCode, channelId, messageId) {
  db.prepare(`
    UPDATE orders
    SET ctv_order_log_channel_id = ?, ctv_order_log_message_id = ?
    WHERE order_code = ?
  `).run(String(channelId), String(messageId), String(orderCode));
}

async function syncCtvOrderLogInternal(order, client) {
  if (!order?.order_code || !client) return null;
  const latestOrder = db.prepare('SELECT * FROM orders WHERE order_code = ?').get(order.order_code) || order;
  if (!latestOrder.guild_id || !latestOrder.customer_id) return null;

  const guild = client.guilds.cache.get(latestOrder.guild_id)
    || await client.guilds.fetch(latestOrder.guild_id).catch(() => null);
  if (!guild) return null;
  if (!await resolveCustomerCtvStatus(latestOrder.guild_id, latestOrder.customer_id, client)) return null;
  const settings = getCtvSettings(latestOrder.guild_id);
  const savedChannelId = latestOrder.ctv_order_log_channel_id;
  let channel = savedChannelId
    ? await guild.channels.fetch(savedChannelId).catch(() => null)
    : null;
  if (!channel?.isTextBased() && settings.order_log_channel_id) {
    channel = await guild.channels.fetch(settings.order_log_channel_id).catch(() => null);
  }
  if (!channel?.isTextBased()) return null;

  let message = latestOrder.ctv_order_log_message_id
    ? await channel.messages.fetch(latestOrder.ctv_order_log_message_id).catch(() => null)
    : null;
  if (message) {
    if (ctvOrderLogNeedsSync(message, latestOrder)) {
      message = await message.edit(buildCtvOrderLogPayload(latestOrder));
    }
    return message;
  }

  message = await channel.send(buildCtvOrderLogPayload(latestOrder));
  saveCtvLogReference(latestOrder.order_code, channel.id, message.id);
  return message;
}

export function syncCtvOrderLog(order, client = global.discordClient) {
  const key = String(order?.order_code || 'unknown');
  const previous = ctvLogSyncLocks.get(key) || Promise.resolve();
  const queued = previous
    .catch(() => null)
    .then(() => syncCtvOrderLogInternal(order, client));
  ctvLogSyncLocks.set(key, queued);
  return queued.finally(() => {
    if (ctvLogSyncLocks.get(key) === queued) ctvLogSyncLocks.delete(key);
  });
}

export const sendCtvOrderLog = syncCtvOrderLog;

export async function reconcileRecentCtvOrderLogs(client, guildId, { limit = 100 } = {}) {
  let guild = client?.guilds?.cache?.get(guildId) || null;
  if (!guild && client?.guilds?.fetch) {
    guild = await client.guilds.fetch(guildId).catch(() => null);
  }
  const settings = getCtvSettings(guildId);
  const channel = guild && settings.order_log_channel_id
    ? await guild.channels.fetch(settings.order_log_channel_id).catch(() => null)
    : null;
  if (!channel?.isTextBased()) {
    return {
      scanned: 0,
      linked: 0,
      updated: 0,
      missingOrders: 0,
      eligibleOrders: 0,
      backfilled: 0,
      failed: 0,
    };
  }

  const messages = await channel.messages.fetch({
    limit: Math.min(100, Math.max(1, Number(limit) || 100)),
  });
  const result = {
    scanned: 0,
    linked: 0,
    updated: 0,
    missingOrders: 0,
    eligibleOrders: 0,
    backfilled: 0,
    failed: 0,
  };
  for (const message of messages.values()) {
    if (message.author?.id !== client.user?.id) continue;
    const text = [message.content || '', ...readComponentText(message.components)].join('\n');
    const orderCode = text.match(/\bCN_\d{6}\b/i)?.[0]?.toUpperCase();
    if (!orderCode) continue;
    result.scanned += 1;
    const order = db.prepare('SELECT * FROM orders WHERE order_code = ?').get(orderCode);
    if (!order) {
      result.missingOrders += 1;
      continue;
    }
    if (order.ctv_order_log_channel_id !== channel.id || order.ctv_order_log_message_id !== message.id) {
      saveCtvLogReference(orderCode, channel.id, message.id);
      result.linked += 1;
    }
    if (ctvOrderLogNeedsSync(message, order)) {
      await message.edit(buildCtvOrderLogPayload(order));
      result.updated += 1;
    }
  }

  // Sau khi liên kết các tin nhắn cũ, quét thêm đơn gần đây để khôi phục những
  // đơn của thành viên có role CTV nhưng trước đó thiếu cờ is_ctv trong DB.
  const recentOrders = db.prepare(`
    SELECT *
    FROM orders
    WHERE guild_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(String(guildId), Math.min(100, Math.max(1, Number(limit) || 100)));
  for (const order of recentOrders) {
    try {
      if (!await resolveCustomerCtvStatus(guildId, order.customer_id, client)) continue;
      result.eligibleOrders += 1;
      const hadReference = Boolean(order.ctv_order_log_channel_id && order.ctv_order_log_message_id);
      const syncedMessage = await syncCtvOrderLog(order, client);
      if (syncedMessage && !hadReference) result.backfilled += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`[CTV-ORDER-LOG] Không thể backfill ${order.order_code}:`, error);
    }
  }
  return result;
}

export function buildCtvPriorityNotice(guildId, customerId, order, roleIds = []) {
  const E = createEmojiResolver(guildId);
  const roles = roleIds.filter(Boolean);
  const roleMentions = roles.map((roleId) => `<@&${roleId}>`).join(' ');
  const container = new ContainerBuilder().setAccentColor(accentFor('warning'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${E('cenar_ctv')} Đơn CTV ưu tiên`,
    roleMentions,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('cenar_verified')} **CTV:** <@${customerId}>`,
    `${E('cenar_partner_ok')} **Mã đơn:** \`${order.order_code}\``,
    `${E('cenar_price')} **Sản phẩm:** ${order.product_name}`,
    `${E('cenar_cooldown')} Vui lòng ưu tiên kiểm tra, xử lý và bàn giao.`,
  ].join('\n')));
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], roles, users: [customerId] },
  };
}

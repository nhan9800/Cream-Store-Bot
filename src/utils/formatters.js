import { createEmojiResolver } from './emojiHelper.js';

export function getOrderStatusLabel(status, guildId = null) {
  const E = createEmojiResolver(guildId);
  const map = {
    PENDING_PAYMENT: `${E('order_pending')} CHỜ THANH TOÁN`,
    PROCESSING: `${E('order_processing')} ĐANG XỬ LÝ`,
    COMPLETED: `${E('order_complete')} ĐÃ HOÀN THÀNH`,
    DELIVERED: `${E('order_product')} ĐÃ GIAO HÀNG`,
    CANCELLED: `${E('order_cancel')} ĐÃ HỦY`,
    WARRANTY_OPEN: `${E('panel_warranty')} ĐANG BẢO HÀNH`,
  };
  return map[status] ?? String(status ?? 'Không xác định');
}

export function getPaymentStatusLabel(status) {
  const map = {
    UNPAID: 'Chưa thanh toán',
    PAID: 'Đã thanh toán',
    FREE: 'Không thu tiền',
    CANCELLED: 'Đã hủy',
  };
  return map[status] ?? String(status ?? 'Không xác định');
}

export function formatOrderProduct(quantity, productName) {
  const qty = Number(quantity ?? 1);
  const safeQty = Number.isFinite(qty) && qty > 0 ? qty : 1;
  const safeName = String(productName ?? '').trim();
  return `x${safeQty} ${safeName}`.replace(/\s+/g, ' ').trim();
}

export function resolveOrderDuration(order = {}, fallbackMonths = 1) {
  const rawDays = Number.parseInt(String(order.duration_days ?? ''), 10);
  if (Number.isFinite(rawDays) && rawDays > 0) {
    return { unit: 'day', value: rawDays };
  }

  const rawMonths = Number.parseInt(String(order.duration_months ?? fallbackMonths), 10);
  return {
    unit: 'month',
    value: Number.isFinite(rawMonths) && rawMonths > 0 ? rawMonths : Math.max(1, Number(fallbackMonths) || 1),
  };
}

export function formatOrderDuration(order = {}, fallbackMonths = 1) {
  const duration = resolveOrderDuration(order, fallbackMonths);
  return duration.unit === 'day'
    ? `${duration.value} ngày`
    : `${duration.value} tháng`;
}

export function addOrderDuration(baseDate, order = {}, fallbackMonths = 1) {
  const next = new Date(baseDate);
  if (Number.isNaN(next.getTime())) return null;

  const duration = resolveOrderDuration(order, fallbackMonths);
  if (duration.unit === 'day') {
    next.setUTCDate(next.getUTCDate() + duration.value);
  } else {
    next.setUTCMonth(next.getUTCMonth() + duration.value);
  }
  return next;
}

export function formatCurrency(value) {
  const amount = Number(value ?? 0);
  return `${new Intl.NumberFormat('vi-VN').format(amount)} VND`;
}

export function resolveTicketLabel(order) {
  if (!order?.ticket_channel_id) return 'Không có quyền truy cập';
  return `<#${order.ticket_channel_id}>`;
}

export function buildOrderLogContent(order, guildId = null) {
  const orderCode = `> \`${order.order_code}\``;
  const customer = `<@${order.customer_id}>`;
  const product = `**${formatOrderProduct(order.quantity, order.product_name)}**`;
  // Không bọc trong backtick vì getOrderStatusLabel trả về custom emoji
  const status = getOrderStatusLabel(order.status, guildId || order.guild_id || null);
  const ticket = resolveTicketLabel(order);
  const duration = formatOrderDuration(order);
  return `${orderCode} ${customer} ${product} · **${duration}** ${status} | ${ticket}`;
}

export function toStars(stars, guildId = null) {
  const E = createEmojiResolver(guildId);
  const star = E('icon_star');
  const n = Math.max(1, Math.min(5, Number(stars) || 1));
  return star ? star.repeat(n) : String(n);
}

export function numericEmoji(stars, guildId = null) {
  const E = createEmojiResolver(guildId);
  const n = Math.max(1, Math.min(5, Number(stars) || 1));
  const star = E('icon_star');
  return star ? `${star} ${n}` : String(n);
}

export function sanitizeChannelName(input) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
}

export function normalizeQueueGroup(productName) {
  return String(productName ?? '')
    .replace(/<a?:[a-zA-Z0-9_]+:\d+>/g, ' ')
    .replace(/:[a-zA-Z0-9_]+:/g, ' ')
    .replace(/\b\d{15,22}\b/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseMoneyInput(rawAmount) {
  if (rawAmount === null || rawAmount === undefined) return null;
  const cleaned = String(rawAmount).trim().toLowerCase();
  if (!cleaned) return null;

  let multiplier = 1;
  let normalized = cleaned;

  if (normalized.endsWith('k')) {
    multiplier = 1000;
    normalized = normalized.slice(0, -1);
  }

  const digits = normalized.replace(/[^\d]/g, '');
  if (!digits) return null;

  const value = Number.parseInt(digits, 10) * multiplier;
  return Number.isFinite(value) ? value : null;
}

export function buildTicketChannelName(ticketCode, prefix = 'ticket') {
  const shortId = String(ticketCode ?? '')
    .replace(/^TKT_/, '')
    .toLowerCase();
  return sanitizeChannelName(`${prefix}-${shortId}`);
}

export function buildWarrantyChannelName(orderCode) {
  const shortId = String(orderCode ?? '')
    .replace(/^(CN|CR)_/, '')
    .toLowerCase();
  return `bao-hanh-${shortId}`;
}

import { db } from '../database/db.js';

const SUPPORTED_SERVICES = new Set(['SPOTIFY', 'YOUTUBE']);

export class OrderLinkError extends Error {
  constructor(message, code = 'ORDER_LINK_INVALID') {
    super(message);
    this.name = 'OrderLinkError';
    this.code = code;
  }
}

function clean(value, maxLength = 160) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function searchable(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

export function normalizeLinkedOrderCode(value) {
  return clean(value, 80)?.toUpperCase() || null;
}

export function detectLinkedOrderService(productName, serviceType = '') {
  const haystack = searchable(`${productName || ''} ${serviceType || ''}`);
  if (haystack.includes('spotify')) return 'SPOTIFY';
  if (haystack.includes('youtube') || haystack.includes('you tube')) return 'YOUTUBE';
  return 'OTHER';
}

function detectYoutubePlan(productName) {
  const haystack = searchable(productName);
  return haystack.includes('doi family')
    || haystack.includes('family moi thang')
    || haystack.includes('monthly family switch')
    ? 'ROTATING_FAMILY'
    : 'STABLE_FAMILY';
}

function discordIdFrom(row) {
  const direct = clean(row.customer_discord, 30) || clean(row.web_discord_id, 30);
  if (direct) return direct;
  const customerId = clean(row.customer_id, 80);
  return /^\d{15,22}$/.test(customerId || '') ? customerId : null;
}

function orderLinkRow(orderCode) {
  return db.prepare(`
    SELECT
      o.id,
      o.order_code,
      o.guild_id,
      o.customer_id,
      o.customer_name AS order_customer_name,
      o.customer_discord,
      o.customer_gmail,
      o.product_name,
      o.service_type,
      o.quantity,
      o.total_amount,
      o.amount_paid,
      o.duration_months,
      o.duration_days,
      o.status,
      o.payment_status,
      o.created_at,
      o.paid_at,
      o.completed_at,
      o.expiry_at,
      u.display_name AS web_display_name,
      u.discord_username AS web_discord_username,
      u.discord_id AS web_discord_id,
      u.email AS web_email,
      u.google_email AS web_google_email,
      (SELECT COUNT(*) FROM spotify_family_members sm WHERE UPPER(sm.related_order_code) = UPPER(o.order_code)) AS spotify_link_count,
      (SELECT COUNT(*) FROM youtube_memberships ym WHERE UPPER(ym.related_order_code) = UPPER(o.order_code)) AS youtube_link_count
    FROM orders o
    LEFT JOIN web_users u ON u.discord_id = o.customer_id OR u.id = o.customer_id
    WHERE UPPER(TRIM(o.order_code)) = ?
    ORDER BY CASE WHEN u.discord_id = o.customer_id THEN 0 ELSE 1 END
    LIMIT 1
  `).get(orderCode) || null;
}

function serializeOrderLink(row) {
  const productName = clean(row.product_name, 300) || 'Sản phẩm chưa đặt tên';
  const serviceFamily = detectLinkedOrderService(productName, row.service_type);
  const durationMonths = Math.max(0, Number(row.duration_months || 0));
  const durationDays = row.duration_days == null ? null : Math.max(0, Number(row.duration_days || 0));
  return {
    orderId: Number(row.id),
    orderCode: normalizeLinkedOrderCode(row.order_code),
    guildId: String(row.guild_id || ''),
    productName,
    serviceType: clean(row.service_type, 80),
    serviceFamily,
    suggestedYoutubePlan: serviceFamily === 'YOUTUBE' ? detectYoutubePlan(productName) : null,
    customerId: clean(row.customer_id, 80),
    customerName: clean(row.order_customer_name, 160)
      || clean(row.web_discord_username, 160)
      || clean(row.web_display_name, 160)
      || (discordIdFrom(row) ? `Discord ${discordIdFrom(row)}` : null),
    discordId: discordIdFrom(row),
    customerEmail: clean(row.customer_gmail, 240)
      || clean(row.web_google_email, 240)
      || clean(row.web_email, 240),
    quantity: Math.max(1, Number(row.quantity || 1)),
    durationMonths,
    durationDays,
    totalAmount: Math.max(0, Number(row.total_amount || 0)),
    amountPaid: Math.max(0, Number(row.amount_paid || 0)),
    orderStatus: clean(row.status, 60),
    paymentStatus: clean(row.payment_status, 60),
    createdAt: row.created_at || null,
    startedAt: row.paid_at || row.completed_at || row.created_at || null,
    completedAt: row.completed_at || null,
    expiresAt: row.expiry_at || null,
    existingLinks: {
      spotify: Math.max(0, Number(row.spotify_link_count || 0)),
      youtube: Math.max(0, Number(row.youtube_link_count || 0)),
    },
  };
}

export function resolveOrderLink(orderCode, { expectedService = null, guildId = null } = {}) {
  const normalizedCode = normalizeLinkedOrderCode(orderCode);
  if (!normalizedCode) throw new OrderLinkError('Hãy nhập mã đơn cần liên kết.', 'ORDER_CODE_REQUIRED');

  const row = orderLinkRow(normalizedCode);
  if (!row) throw new OrderLinkError(`Không tìm thấy mã đơn ${normalizedCode} trong dữ liệu bot.`, 'ORDER_NOT_FOUND');

  const order = serializeOrderLink(row);
  if (guildId && ![String(guildId), 'WEB'].includes(order.guildId)) {
    throw new OrderLinkError('Mã đơn không thuộc cửa hàng Discord hiện tại.', 'ORDER_WRONG_STORE');
  }

  const normalizedExpected = expectedService ? String(expectedService).toUpperCase() : null;
  if (normalizedExpected && !SUPPORTED_SERVICES.has(normalizedExpected)) {
    throw new OrderLinkError('Loại liên kết mã đơn không được hỗ trợ.', 'ORDER_SERVICE_INVALID');
  }
  if (normalizedExpected && order.serviceFamily !== normalizedExpected) {
    const expectedLabel = normalizedExpected === 'SPOTIFY' ? 'Spotify' : 'YouTube';
    throw new OrderLinkError(
      `Mã ${normalizedCode} là đơn “${order.productName}”, không phải đơn ${expectedLabel}.`,
      'ORDER_SERVICE_MISMATCH',
    );
  }
  return order;
}

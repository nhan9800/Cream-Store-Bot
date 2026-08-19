import { db, nowIso } from '../database/db.js';
import { syncCustomerStats } from './customerService.js';
import { addOrderDuration } from '../utils/formatters.js';

export function getOrderByCodeRaw(orderCode) {
  return db.prepare('SELECT * FROM orders WHERE order_code = ?').get(orderCode) ?? null;
}

export function getTicketByChannelIdRaw(channelId) {
  return db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId) ?? null;
}

export function updateOrderFieldsRaw(orderCode, payload) {
  const order = getOrderByCodeRaw(orderCode);
  if (!order) throw new Error('Không tìm thấy đơn hàng.');

  const nextProduct = payload.product_name ?? order.product_name;
  const nextQuantity = payload.quantity ?? order.quantity;
  const nextAmount = payload.total_amount ?? order.total_amount;
  const nextMonths = payload.duration_months ?? order.duration_months ?? 1;
  const nextDays = payload.duration_days !== undefined ? payload.duration_days : order.duration_days;

  let nextExpiry = order.expiry_at;
  const baseTime = order.delivered_at ?? order.completed_at ?? null;

  if (payload.expiry_at !== undefined) {
    nextExpiry = payload.expiry_at;
  } else if ((payload.duration_months !== undefined || payload.duration_days !== undefined) && baseTime) {
    const dt = addOrderDuration(baseTime, { duration_months: nextMonths, duration_days: nextDays });
    nextExpiry = dt?.toISOString() ?? nextExpiry;
  }

  db.prepare(`
    UPDATE orders
    SET product_name = ?,
        quantity = ?,
        total_amount = ?,
        duration_months = ?,
        duration_days = ?,
        expiry_at = ?,
        updated_at = ?
    WHERE order_code = ?
  `).run(
    nextProduct,
    nextQuantity,
    nextAmount,
    nextMonths,
    nextDays,
    nextExpiry,
    nowIso(),
    orderCode,
  );

  syncCustomerStats(order.guild_id, order.customer_id);
  return getOrderByCodeRaw(orderCode);
}

export function assignOrderClaimRaw(orderCode, staffId) {
  db.prepare(`
    UPDATE orders
    SET claim_staff_id = ?,
        claim_at = ?,
        claimed_by_id = ?,
        claimed_at = ?,
        updated_at = ?
    WHERE order_code = ?
  `).run(staffId, nowIso(), staffId, nowIso(), nowIso(), orderCode);

  return getOrderByCodeRaw(orderCode);
}

export function releaseOrderClaimRaw(orderCode) {
  db.prepare(`
    UPDATE orders
    SET claim_staff_id = NULL,
        claim_at = NULL,
        claimed_by_id = NULL,
        claimed_at = NULL,
        updated_at = ?
    WHERE order_code = ?
  `).run(nowIso(), orderCode);

  return getOrderByCodeRaw(orderCode);
}

export function insertStaffLogRaw({ guildId, actorId, action, orderCode = null, targetCustomerId = null, beforeJson = null, afterJson = null, detail = null, relatedTicketCode = null }) {
  const safeDetail = [
    detail,
    beforeJson || afterJson ? `before=${beforeJson ?? 'null'} | after=${afterJson ?? 'null'}` : null,
  ].filter(Boolean).join(' | ') || null;

  try {
    db.prepare(`
      INSERT INTO staff_logs (
        guild_id, actor_id, target_id, action, detail, related_order_code, related_ticket_code, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(guildId, actorId, targetCustomerId, action, safeDetail, orderCode, relatedTicketCode, nowIso());
  } catch {}
}

export function getDashboardSnapshotRaw() {
  const totalOrders = db.prepare('SELECT COUNT(*) AS c FROM orders').get()?.c ?? 0;
  const processing = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status IN ('PENDING_PAYMENT','PROCESSING')").get()?.c ?? 0;
  const completed = db.prepare("SELECT COUNT(*) AS c FROM orders WHERE status = 'COMPLETED'").get()?.c ?? 0;
  // Doanh thu: chỉ tính đơn PAID + KHÔNG bị hủy
  const revenue = db.prepare("SELECT COALESCE(SUM(amount_paid), 0) AS s FROM orders WHERE payment_status = 'PAID' AND status != 'CANCELLED'").get()?.s ?? 0;
  const expiringSoon = db.prepare(`
    SELECT COUNT(*) AS c
    FROM orders
    WHERE expiry_at IS NOT NULL
      AND datetime(expiry_at) <= datetime('now', '+2 days')
      AND datetime(expiry_at) > datetime('now')
  `).get()?.c ?? 0;

  const topCustomers = db.prepare(`
    SELECT customer_id,
           COUNT(*) AS total_orders,
           COALESCE(SUM(CASE WHEN status != 'CANCELLED' THEN amount_paid ELSE 0 END), 0) AS total_spent
    FROM orders
    WHERE payment_status = 'PAID' AND status != 'CANCELLED'
    GROUP BY customer_id
    ORDER BY total_spent DESC, total_orders DESC
    LIMIT 10
  `).all();

  const staffKpi = db.prepare(`
    SELECT actor_id,
           SUM(CASE WHEN action IN ('ORDER_COMPLETED','ORDER_COMPLETE_MANUAL','ORDER_COMPLETE_AUTO') THEN 1 ELSE 0 END) AS completed_count,
           SUM(CASE WHEN action IN ('ORDER_DELIVERED','DELIVERY_SENT') THEN 1 ELSE 0 END) AS delivered_count,
           COUNT(*) AS total_actions
    FROM staff_logs
    GROUP BY actor_id
    ORDER BY delivered_count DESC, completed_count DESC, total_actions DESC
    LIMIT 10
  `).all();

  return {
    totalOrders,
    processing,
    completed,
    revenue,
    expiringSoon,
    topCustomers,
    staffKpi,
    generatedAt: nowIso(),
  };
}

export function getOrdersExpiringInWindowRaw(minHours, maxHours) {
  return db.prepare(`
    SELECT *
    FROM orders
    WHERE expiry_at IS NOT NULL
      AND datetime(expiry_at) <= datetime('now', ?)
      AND datetime(expiry_at) > datetime('now', ?)
  `).all(`+${maxHours} hours`, `+${minHours} hours`);
}

export function getExpiredSubscriptionOrdersRaw() {
  const subKeywords = ['youtube', 'netflix', 'spotify', 'canva', 'capcut', 'office', 'zoom', 'chatgpt', 'vpn', 'prime', 'hbo'];
  const likeClauses = subKeywords.map(kw => `LOWER(product_name) LIKE '%${kw}%'`).join(' OR ');

  return db.prepare(`
    SELECT *
    FROM orders
    WHERE expiry_at IS NOT NULL
      AND datetime(expiry_at) <= datetime('now')
      AND status NOT IN ('CANCELED', 'REFUNDED')
      AND (claim_notes IS NULL OR claim_notes != 'KICKED')
      AND expiry_notice_expired_sent_at IS NULL
      AND (${likeClauses})
  `).all();
}

export function markOrderKickedRaw(orderCode) {
  db.prepare(`
    UPDATE orders
    SET claim_notes = 'KICKED', updated_at = ?
    WHERE order_code = ?
  `).run(nowIso(), orderCode);
}

export function markExpiryNoticeRaw(orderCode, fieldName) {
  const allowed = new Set(['expiry_notice_3d_sent_at', 'expiry_notice_2d_sent_at', 'expiry_notice_1d_sent_at', 'expiry_notice_expired_sent_at']);
  if (!allowed.has(fieldName)) throw new Error('Field reminder không hợp lệ.');

  db.prepare(`
    UPDATE orders
    SET ${fieldName} = ?, updated_at = ?
    WHERE order_code = ?
  `).run(nowIso(), nowIso(), orderCode);
}

export function getRevenueStatsRaw(startDateIso, endDateIso) {
  const params = [];
  let sql = `
    SELECT COUNT(*) AS total_orders, 
           COALESCE(SUM(CASE WHEN payment_status = 'PAID' THEN total_amount ELSE 0 END), 0) AS total_revenue,
           SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_orders,
           SUM(CASE WHEN payment_status = 'UNPAID' THEN 1 ELSE 0 END) AS unpaid_orders
    FROM orders
    WHERE 1=1
  `;
             
  if (startDateIso) {
    sql += ` AND datetime(created_at) >= datetime(?)`;
    params.push(startDateIso);
  }
  if (endDateIso) {
    sql += ` AND datetime(created_at) <= datetime(?)`;
    params.push(endDateIso);
  }
  
  return db.prepare(sql).get(...params);
}

export function getExpiringOrdersRaw(days) {
  return db.prepare(`
    SELECT *
    FROM orders
    WHERE expiry_at IS NOT NULL
      AND status != 'CANCELLED'
      AND datetime(expiry_at) <= datetime('now', ?)
      AND datetime(expiry_at) > datetime('now', '-1 day')
    ORDER BY expiry_at ASC
  `).all(`+${days} days`);
}

export function createRenewalOrderRaw({
  guildId,
  ticketId,
  ticketChannelId,
  customerId,
  productName,
  quantity,
  note,
  totalAmount,
  durationMonths,
  durationDays = null,
  orderLogChannelId,
  createdById,
}) {
  const timestamp = nowIso();
  const safeAmount = Math.max(0, Number(totalAmount ?? 0));
  const paymentStatus = safeAmount > 0 ? 'UNPAID' : 'FREE';
  const status = safeAmount > 0 ? 'PENDING_PAYMENT' : 'PROCESSING';

  const result = db.prepare(`
    INSERT INTO orders (
      order_code,
      guild_id,
      ticket_id,
      ticket_channel_id,
      customer_id,
      product_name,
      quantity,
      note,
      status,
      payment_status,
      total_amount,
      amount_paid,
      order_log_channel_id,
      duration_months,
      duration_days,
      created_by_id,
      created_at,
      updated_at
    ) VALUES (
      NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    guildId,
    ticketId ?? null,
    ticketChannelId ?? null,
    customerId,
    productName,
    quantity ?? 1,
    note ?? null,
    status,
    paymentStatus,
    safeAmount,
    safeAmount > 0 ? 0 : safeAmount,
    orderLogChannelId ?? null,
    durationDays ? 0 : (durationMonths ?? 1),
    durationDays ?? null,
    createdById,
    timestamp,
    timestamp,
  );

  const id = Number(result.lastInsertRowid);
  const orderCode = `CN_${String(100000 + id).slice(-6)}`;
  const payosOrderCode = Number(String(orderCode).replace(/^CN_/, ''));
  const paymentCode = safeAmount > 0 ? orderCode : null;

  db.prepare(`
    UPDATE orders
    SET order_code = ?,
        payment_code = ?,
        payos_order_code = ?,
        updated_at = ?
    WHERE id = ?
  `).run(orderCode, paymentCode, payosOrderCode, nowIso(), id);

  syncCustomerStats(guildId, customerId);
  return getOrderByCodeRaw(orderCode);
}

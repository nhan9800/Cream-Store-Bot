import { db } from '../database/db.js';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function whereGuild(guildId) {
  return guildId ? 'AND guild_id = @guildId' : '';
}

/**
 * Tổng hợp các dịch vụ tự động đã dùng ngoài bảng orders.
 * - OTP được tính là hoạt động sau khi nhà cung cấp cấp số thành công.
 * - Gạch thẻ chỉ tính sau callback thành công.
 * - Mua thẻ chỉ tính khi nhà cung cấp đã trả thẻ.
 */
export function getCustomerActivitySummary(guildId, customerId) {
  const params = { guildId: guildId || null, customerId: String(customerId) };
  const guildFilter = whereGuild(guildId);

  const otp = db.prepare(`
    SELECT
      COUNT(*) AS activity_count,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN price ELSE 0 END), 0) AS spent
    FROM viotp_orders
    WHERE customer_id = @customerId
      AND status IN ('PENDING', 'COMPLETED', 'EXPIRED')
      ${guildFilter}
  `).get(params);

  const cardTopup = db.prepare(`
    SELECT COUNT(*) AS activity_count
    FROM card_charging_orders
    WHERE customer_id = @customerId AND status = 'COMPLETED'
      ${guildFilter}
  `).get(params);

  const cardBuy = db.prepare(`
    SELECT
      COUNT(*) AS activity_count,
      COALESCE(SUM(total_price), 0) AS spent
    FROM card_buy_orders
    WHERE customer_id = @customerId AND status = 'COMPLETED'
      ${guildFilter}
  `).get(params);

  const breakdown = {
    otp: number(otp?.activity_count),
    cardTopup: number(cardTopup?.activity_count),
    cardBuy: number(cardBuy?.activity_count),
  };

  return {
    activityCount: breakdown.otp + breakdown.cardTopup + breakdown.cardBuy,
    serviceSpent: number(otp?.spent) + number(cardBuy?.spent),
    breakdown,
  };
}

export function getCustomerRecentActivities(customerId, limit = 10) {
  const safeLimit = Math.min(30, Math.max(1, Number.parseInt(limit, 10) || 10));
  return db.prepare(`
    SELECT activity_type, label, amount, status, reference_code, created_at
    FROM (
      SELECT
        'OTP' AS activity_type,
        service_name AS label,
        price AS amount,
        status,
        request_id AS reference_code,
        created_at
      FROM viotp_orders
      WHERE customer_id = @customerId AND status != 'FAILED'

      UNION ALL

      SELECT
        'CARD_TOPUP' AS activity_type,
        telco || ' ' || declared_value AS label,
        COALESCE(credited_amount, amount, 0) AS amount,
        status,
        request_id AS reference_code,
        created_at
      FROM card_charging_orders
      WHERE customer_id = @customerId AND status = 'COMPLETED'

      UNION ALL

      SELECT
        'CARD_BUY' AS activity_type,
        service_code || ' ' || value || ' x' || qty AS label,
        total_price AS amount,
        status,
        request_id AS reference_code,
        created_at
      FROM card_buy_orders
      WHERE customer_id = @customerId AND status = 'COMPLETED'
    )
    ORDER BY created_at DESC
    LIMIT @limit
  `).all({ customerId: String(customerId), limit: safeLimit });
}

export function listActivityCustomers() {
  return db.prepare(`
    SELECT DISTINCT guild_id, customer_id
    FROM (
      SELECT guild_id, customer_id
      FROM viotp_orders
      WHERE status IN ('PENDING', 'COMPLETED', 'EXPIRED')
      UNION
      SELECT guild_id, customer_id
      FROM card_charging_orders
      WHERE status = 'COMPLETED'
      UNION
      SELECT guild_id, customer_id
      FROM card_buy_orders
      WHERE status = 'COMPLETED'
    )
    WHERE guild_id IS NOT NULL AND customer_id IS NOT NULL
  `).all();
}

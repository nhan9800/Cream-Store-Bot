import { db, nowIso } from '../database/db.js';

function ensureCustomerStmt() {
  return db.prepare(`
    INSERT INTO customer_profiles (guild_id, customer_id, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, customer_id) DO UPDATE SET
      last_seen_at = excluded.last_seen_at
  `);
}

function getProfileStmt() {
  return db.prepare('SELECT * FROM customer_profiles WHERE guild_id = ? AND customer_id = ?');
}

function updateProfileStmt() {
  return db.prepare(`
    INSERT INTO customer_profiles (
      guild_id,
      customer_id,
      first_seen_at,
      last_seen_at,
      total_orders,
      total_open_orders,
      total_completed_orders,
      total_paid_orders,
      total_spent,
      total_paid_amount,
      last_order_code,
      last_order_at,
      last_completed_at
    ) VALUES (
      @guild_id,
      @customer_id,
      @first_seen_at,
      @last_seen_at,
      @total_orders,
      @total_open_orders,
      @total_completed_orders,
      @total_paid_orders,
      @total_spent,
      @total_paid_amount,
      @last_order_code,
      @last_order_at,
      @last_completed_at
    )
    ON CONFLICT(guild_id, customer_id) DO UPDATE SET
      first_seen_at = excluded.first_seen_at,
      last_seen_at = excluded.last_seen_at,
      total_orders = excluded.total_orders,
      total_open_orders = excluded.total_open_orders,
      total_completed_orders = excluded.total_completed_orders,
      total_paid_orders = excluded.total_paid_orders,
      total_spent = excluded.total_spent,
      total_paid_amount = excluded.total_paid_amount,
      last_order_code = excluded.last_order_code,
      last_order_at = excluded.last_order_at,
      last_completed_at = excluded.last_completed_at
  `);
}

function statsStmt() {
  return db.prepare(`
    SELECT
      COUNT(*) AS total_orders,
      SUM(CASE WHEN status IN ('PENDING_PAYMENT', 'PROCESSING', 'WARRANTY_OPEN') THEN 1 ELSE 0 END) AS total_open_orders,
      SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS total_completed_orders,
      SUM(CASE WHEN payment_status = 'PAID' AND status NOT IN ('CANCELLED', 'REFUNDED') THEN 1 ELSE 0 END) AS total_paid_orders,
      COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED', 'REFUNDED') THEN total_amount ELSE 0 END), 0) AS total_spent,
      COALESCE(SUM(CASE WHEN payment_status = 'PAID' AND status NOT IN ('CANCELLED', 'REFUNDED') THEN amount_paid ELSE 0 END), 0) AS total_paid_amount,
      MIN(created_at) AS first_seen_at,
      MAX(updated_at) AS last_seen_at,
      MAX(CASE WHEN status = 'COMPLETED' THEN completed_at END) AS last_completed_at
    FROM orders
    WHERE guild_id = ? AND customer_id = ?
  `);
}

function lastOrderStmt() {
  return db.prepare(`
    SELECT order_code, created_at
    FROM orders
    WHERE guild_id = ? AND customer_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 1
  `);
}

function recentOrdersStmt() {
  return db.prepare(`
    SELECT *
    FROM orders
    WHERE guild_id = ? AND customer_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `);
}

export function ensureCustomerProfile(guildId, customerId) {
  const timestamp = nowIso();
  ensureCustomerStmt().run(guildId, customerId, timestamp, timestamp);
}

export function syncCustomerStats(guildId, customerId) {
  ensureCustomerProfile(guildId, customerId);

  const stats = statsStmt().get(guildId, customerId);
  const lastOrder = lastOrderStmt().get(guildId, customerId);

  updateProfileStmt().run({
    guild_id: guildId,
    customer_id: customerId,
    first_seen_at: stats?.first_seen_at ?? nowIso(),
    last_seen_at: stats?.last_seen_at ?? nowIso(),
    total_orders: stats?.total_orders ?? 0,
    total_open_orders: stats?.total_open_orders ?? 0,
    total_completed_orders: stats?.total_completed_orders ?? 0,
    total_paid_orders: stats?.total_paid_orders ?? 0,
    total_spent: stats?.total_spent ?? 0,
    total_paid_amount: stats?.total_paid_amount ?? 0,
    last_order_code: lastOrder?.order_code ?? null,
    last_order_at: lastOrder?.created_at ?? null,
    last_completed_at: stats?.last_completed_at ?? null,
  });

  return getCustomerProfile(guildId, customerId);
}

export function getCustomerProfile(guildId, customerId) {
  return getProfileStmt().get(guildId, customerId) ?? null;
}

export function getCustomerRecentOrders(guildId, customerId, limit = 5) {
  return recentOrdersStmt().all(guildId, customerId, limit);
}

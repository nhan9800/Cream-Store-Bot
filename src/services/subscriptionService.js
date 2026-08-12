import { db, nowIso } from '../database/db.js';
import { encrypt } from '../utils/crypto.js';

// ═══════════════════════════════════════════════
//  Prepared statement factories
// ═══════════════════════════════════════════════

function insertStmt() {
  return db.prepare(`
    INSERT INTO subscription_accounts (
      guild_id, service_type, renewal_mode,
      gmail_email, gmail_password,
      customer_id, customer_discord_name, related_order_code,
      purchase_date, total_duration_months, renewal_cycle_months,
      next_renewal_at, expiry_at, times_renewed,
      spotify_family_name, spotify_slots_used,
      status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
}

function getByIdStmt() {
  return db.prepare('SELECT * FROM subscription_accounts WHERE id = ?');
}

function getByOrderCodeStmt() {
  return db.prepare(`
    SELECT * FROM subscription_accounts
    WHERE related_order_code = ?
    ORDER BY id DESC
    LIMIT 1
  `);
}

function updateFromDeliveryStmt() {
  return db.prepare(`
    UPDATE subscription_accounts
    SET guild_id = ?,
        service_type = ?,
        renewal_mode = ?,
        gmail_email = ?,
        gmail_password = ?,
        customer_id = ?,
        customer_discord_name = ?,
        purchase_date = ?,
        total_duration_months = ?,
        renewal_cycle_months = ?,
        next_renewal_at = ?,
        expiry_at = ?,
        spotify_family_name = ?,
        spotify_slots_used = ?,
        status = ?,
        renewal_remind_sent_at = NULL,
        customer_response = NULL,
        admin_reminder_stage = NULL,
        admin_reminder_sent_at = NULL,
        admin_reminder_message_id = NULL,
        admin_reminder_channel_id = NULL,
        admin_claimed_by_id = NULL,
        admin_claimed_at = NULL,
        admin_snoozed_until = NULL,
        admin_last_action_at = NULL,
        note = ?,
        updated_at = ?
    WHERE id = ?
  `);
}

function getAllActiveStmt() {
  return db.prepare(`
    SELECT * FROM subscription_accounts
    WHERE guild_id = ? AND status = 'ACTIVE'
    ORDER BY service_type ASC, next_renewal_at ASC
  `);
}

function getActiveByTypeStmt() {
  return db.prepare(`
    SELECT * FROM subscription_accounts
    WHERE guild_id = ? AND status = 'ACTIVE' AND service_type = ?
    ORDER BY next_renewal_at ASC
  `);
}

function getDueForRenewalStmt() {
  return db.prepare(`
    SELECT * FROM subscription_accounts
    WHERE guild_id = ? AND status = 'ACTIVE'
      AND renewal_mode = 'auto_cycle'
      AND next_renewal_at IS NOT NULL
      AND datetime(next_renewal_at) <= datetime('now', ?)
      AND datetime(next_renewal_at) > datetime('now', '-1 day')
      AND renewal_remind_sent_at IS NULL
    ORDER BY next_renewal_at ASC
  `);
}

function getExpiringOneTimeStmt() {
  return db.prepare(`
    SELECT * FROM subscription_accounts
    WHERE guild_id = ? AND status = 'ACTIVE'
      AND renewal_mode IN ('one_time', 'full_paid')
      AND datetime(expiry_at) <= datetime('now', ?)
      AND datetime(expiry_at) > datetime('now', '-1 day')
      AND renewal_remind_sent_at IS NULL
    ORDER BY expiry_at ASC
  `);
}

function getAllDueGlobalStmt() {
  return db.prepare(`
    SELECT * FROM subscription_accounts
    WHERE status = 'ACTIVE'
      AND renewal_mode = 'auto_cycle'
      AND next_renewal_at IS NOT NULL
      AND datetime(next_renewal_at) <= datetime('now', ?)
      AND renewal_remind_sent_at IS NULL
    ORDER BY next_renewal_at ASC
    LIMIT ?
  `);
}

function getAllExpiringGlobalStmt() {
  return db.prepare(`
    SELECT * FROM subscription_accounts
    WHERE status = 'ACTIVE'
      AND renewal_mode IN ('one_time', 'full_paid')
      AND datetime(expiry_at) <= datetime('now', ?)
      AND renewal_remind_sent_at IS NULL
    ORDER BY expiry_at ASC
    LIMIT ?
  `);
}

function getYoutubeAutoCycleGlobalStmt() {
  return db.prepare(`
    SELECT * FROM subscription_accounts
    WHERE status = 'ACTIVE'
      AND service_type = 'youtube'
      AND renewal_mode = 'auto_cycle'
      AND next_renewal_at IS NOT NULL
      AND datetime(next_renewal_at) <= datetime('now', ?)
      AND renewal_remind_sent_at IS NULL
    ORDER BY next_renewal_at ASC
    LIMIT ?
  `);
}

function markRenewedStmt() {
  return db.prepare(`
    UPDATE subscription_accounts
    SET times_renewed = times_renewed + 1,
        next_renewal_at = ?,
        renewal_remind_sent_at = NULL,
        customer_response = NULL,
        admin_reminder_stage = NULL,
        admin_reminder_sent_at = NULL,
        admin_reminder_message_id = NULL,
        admin_reminder_channel_id = NULL,
        admin_claimed_by_id = NULL,
        admin_claimed_at = NULL,
        admin_snoozed_until = NULL,
        admin_last_action_at = ?,
        updated_at = ?
    WHERE id = ?
  `);
}

function markExpiredStmt() {
  return db.prepare(`
    UPDATE subscription_accounts
    SET status = 'EXPIRED',
        admin_reminder_stage = NULL,
        admin_reminder_sent_at = NULL,
        admin_reminder_message_id = NULL,
        admin_reminder_channel_id = NULL,
        admin_claimed_by_id = NULL,
        admin_claimed_at = NULL,
        admin_snoozed_until = NULL,
        admin_last_action_at = ?,
        updated_at = ?
    WHERE id = ?
  `);
}

function markOneTimeRenewedStmt() {
  return db.prepare(`
    UPDATE subscription_accounts
    SET times_renewed = times_renewed + 1,
        expiry_at = ?,
        renewal_remind_sent_at = NULL,
        customer_response = NULL,
        admin_reminder_stage = NULL,
        admin_reminder_sent_at = NULL,
        admin_reminder_message_id = NULL,
        admin_reminder_channel_id = NULL,
        admin_claimed_by_id = NULL,
        admin_claimed_at = NULL,
        admin_snoozed_until = NULL,
        admin_last_action_at = ?,
        status = 'ACTIVE',
        updated_at = ?
    WHERE id = ?
  `);
}

function markRemindSentStmt() {
  return db.prepare(`
    UPDATE subscription_accounts
    SET renewal_remind_sent_at = ?, updated_at = ?
    WHERE id = ?
  `);
}

function markCustomerResponseStmt() {
  return db.prepare(`
    UPDATE subscription_accounts
    SET customer_response = ?, status = CASE WHEN ? = 'NO' THEN 'EXPIRED' ELSE status END, updated_at = ?
    WHERE id = ?
  `);
}

function deleteStmt() {
  return db.prepare('DELETE FROM subscription_accounts WHERE id = ?');
}

function countByGuildStmt() {
  return db.prepare(`
    SELECT service_type, COUNT(*) AS total
    FROM subscription_accounts
    WHERE guild_id = ? AND status = 'ACTIVE'
    GROUP BY service_type
  `);
}

function resetRemindStmt() {
  return db.prepare(`
    UPDATE subscription_accounts
    SET renewal_remind_sent_at = NULL, updated_at = ?
    WHERE id = ?
  `);
}

function updateFieldsStmt() {
  return db.prepare(`
    UPDATE subscription_accounts
    SET gmail_email = ?,
        gmail_password = ?,
        customer_id = ?,
        customer_discord_name = ?,
        total_duration_months = ?,
        renewal_cycle_months = ?,
        spotify_family_name = ?,
        spotify_slots_used = ?,
        note = ?,
        updated_at = ?
    WHERE id = ?
  `);
}

// ═══════════════════════════════════════════════
//  Helper: tính ngày
// ═══════════════════════════════════════════════

function addMonths(baseDate, months) {
  const d = new Date(baseDate);
  d.setMonth(d.getMonth() + Math.max(0, Number(months || 0)));
  return d.toISOString();
}

function computeNextRenewal(purchaseDate, cycleMonths, timesRenewed = 0) {
  if (!cycleMonths || cycleMonths <= 0) return null;
  const nextCycle = timesRenewed + 1;
  return addMonths(purchaseDate, cycleMonths * nextCycle);
}

function computeExpiry(purchaseDate, totalMonths) {
  return addMonths(purchaseDate, totalMonths);
}

// ═══════════════════════════════════════════════
//  Public API
// ═══════════════════════════════════════════════

/**
 * Thêm subscription mới
 */
export function addSubscription({
  guildId,
  serviceType,
  renewalMode,
  gmailEmail,
  gmailPassword,
  customerId = null,
  customerDiscordName = null,
  relatedOrderCode = null,
  purchaseDate,
  totalDurationMonths,
  renewalCycleMonths = 0,
  spotifyFamilyName = null,
  spotifySlotsUsed = 0,
  note = null,
}) {
  const ts = nowIso();
  const expiryAt = computeExpiry(purchaseDate, totalDurationMonths);
  let nextRenewalAt = null;

  if (renewalMode === 'auto_cycle' && renewalCycleMonths > 0) {
    nextRenewalAt = computeNextRenewal(purchaseDate, renewalCycleMonths, 0);
  }

  const result = insertStmt().run(
    guildId,
    serviceType,
    renewalMode,
    gmailEmail,
    gmailPassword != null ? encrypt(gmailPassword) : null,
    customerId,
    customerDiscordName,
    relatedOrderCode,
    purchaseDate,
    totalDurationMonths,
    renewalCycleMonths,
    nextRenewalAt,
    expiryAt,
    0, // times_renewed
    spotifyFamilyName,
    spotifySlotsUsed,
    'ACTIVE',
    note,
    ts,
    ts,
  );

  return getByIdStmt().get(Number(result.lastInsertRowid));
}

/**
 * Lấy subscription theo ID
 */
export function getSubscriptionById(id) {
  return getByIdStmt().get(id) ?? null;
}

export function getSubscriptionByOrderCode(orderCode) {
  if (!orderCode) return null;
  return getByOrderCodeStmt().get(orderCode) ?? null;
}

/**
 * Create or refresh the renewal record generated by /giaohang.
 * related_order_code is the idempotency key so retrying delivery cannot add duplicates.
 */
export function upsertSubscriptionFromDelivery(data) {
  const existing = getSubscriptionByOrderCode(data.relatedOrderCode);
  if (!existing) return addSubscription(data);

  const purchaseDate = existing.purchase_date || data.purchaseDate;
  const totalDurationMonths = Math.max(1, Number(data.totalDurationMonths || 1));
  const renewalCycleMonths = Math.max(0, Number(data.renewalCycleMonths || 0));
  const expiryAt = computeExpiry(purchaseDate, totalDurationMonths);
  let nextRenewalAt = null;
  if (data.renewalMode === 'auto_cycle' && renewalCycleMonths > 0) {
    nextRenewalAt = computeNextRenewal(purchaseDate, renewalCycleMonths, existing.times_renewed || 0);
    if (new Date(nextRenewalAt) > new Date(expiryAt)) nextRenewalAt = null;
  }
  const status = new Date(expiryAt) <= new Date() ? 'EXPIRED' : 'ACTIVE';
  const ts = nowIso();

  updateFromDeliveryStmt().run(
    data.guildId,
    data.serviceType,
    data.renewalMode,
    data.gmailEmail,
    encrypt(data.gmailPassword),
    data.customerId ?? null,
    data.customerDiscordName ?? null,
    purchaseDate,
    totalDurationMonths,
    renewalCycleMonths,
    nextRenewalAt,
    expiryAt,
    data.spotifyFamilyName ?? null,
    Number(data.spotifySlotsUsed || 0),
    status,
    data.note ?? null,
    ts,
    existing.id,
  );

  return getSubscriptionById(existing.id);
}

/**
 * Lấy tất cả subscriptions active
 */
export function getAllActiveSubscriptions(guildId, serviceType = null) {
  if (serviceType) {
    return getActiveByTypeStmt().all(guildId, serviceType);
  }
  return getAllActiveStmt().all(guildId);
}

/**
 * Lấy subscriptions cần gia hạn (auto_cycle) trong khoảng N giờ tới
 */
export function getDueForRenewal(guildId, withinHours = 72) {
  return getDueForRenewalStmt().all(guildId, `+${withinHours} hours`);
}

/**
 * Lấy gói lẻ/full_paid sắp hết hạn
 */
export function getExpiringOneTime(guildId, withinHours = 72) {
  return getExpiringOneTimeStmt().all(guildId, `+${withinHours} hours`);
}

/**
 * Lấy tất cả (global) cần gia hạn — cho scheduler
 */
export function getAllDueForRenewalGlobal(withinHours = 72, limit = 50) {
  return getAllDueGlobalStmt().all(`+${withinHours} hours`, limit);
}

/**
 * Lấy tất cả (global) gói lẻ sắp hết hạn — cho scheduler
 */
export function getAllExpiringOneTimeGlobal(withinHours = 72, limit = 50) {
  return getAllExpiringGlobalStmt().all(`+${withinHours} hours`, limit);
}

/**
 * Lấy YouTube auto_cycle cần nhắc cả khách + shop — cho scheduler
 */
export function getYoutubeAutoCycleDueGlobal(withinHours = 72, limit = 50) {
  return getYoutubeAutoCycleGlobalStmt().all(`+${withinHours} hours`, limit);
}

/**
 * Đánh dấu đã gia hạn → tính next_renewal_at mới
 */
export function markRenewed(id) {
  const sub = getSubscriptionById(id);
  if (!sub) return null;

  const ts = nowIso();
  if (sub.renewal_mode !== 'auto_cycle' || !Number(sub.renewal_cycle_months)) {
    const currentExpiry = new Date(sub.expiry_at);
    const base = Number.isFinite(currentExpiry.getTime()) && currentExpiry > new Date()
      ? currentExpiry
      : new Date();
    const newExpiry = addMonths(base, Math.max(1, Number(sub.total_duration_months || 1)));
    markOneTimeRenewedStmt().run(newExpiry, ts, ts, id);
    return getSubscriptionById(id);
  }

  const newTimesRenewed = (sub.times_renewed || 0) + 1;
  let newNextRenewal = computeNextRenewal(sub.purchase_date, sub.renewal_cycle_months, newTimesRenewed);

  // Nếu next_renewal vượt quá expiry_at → đánh dấu hết hạn
  if (newNextRenewal && new Date(newNextRenewal) > new Date(sub.expiry_at)) {
    newNextRenewal = null;
    markExpiredStmt().run(ts, ts, id);
    return getSubscriptionById(id);
  }

  markRenewedStmt().run(newNextRenewal, ts, ts, id);
  return getSubscriptionById(id);
}

/**
 * Store 1 admin queue. Notification stage selection stays in the presentation
 * service so this query remains reusable by commands and tests.
 */
export function getAdminRenewalCandidates(guildId, withinDays = 7, limit = 100) {
  const safeDays = Math.min(30, Math.max(1, Number.parseInt(String(withinDays), 10) || 7));
  const safeLimit = Math.min(250, Math.max(1, Number.parseInt(String(limit), 10) || 100));
  return db.prepare(`
    SELECT *
    FROM subscription_accounts
    WHERE (guild_id = ? OR guild_id = 'WEB')
      AND status = 'ACTIVE'
      AND (
        (renewal_mode = 'auto_cycle' AND next_renewal_at IS NOT NULL
          AND datetime(next_renewal_at) <= datetime('now', ?))
        OR
        (renewal_mode IN ('one_time', 'full_paid')
          AND datetime(expiry_at) <= datetime('now', ?))
      )
      AND (admin_snoozed_until IS NULL OR datetime(admin_snoozed_until) <= datetime('now'))
    ORDER BY datetime(CASE
      WHEN renewal_mode = 'auto_cycle' AND next_renewal_at IS NOT NULL THEN next_renewal_at
      ELSE expiry_at
    END) ASC
    LIMIT ?
  `).all(guildId, `+${safeDays} days`, `+${safeDays} days`, safeLimit);
}

export function markAdminReminderSent(id, { stage, messageId = null, channelId = null } = {}) {
  const ts = nowIso();
  db.prepare(`
    UPDATE subscription_accounts
    SET admin_reminder_stage = ?,
        admin_reminder_sent_at = ?,
        admin_reminder_message_id = ?,
        admin_reminder_channel_id = ?,
        admin_last_action_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(stage, ts, messageId, channelId, ts, ts, id);
  return getSubscriptionById(id);
}

export function claimAdminRenewal(id, adminId) {
  const sub = getSubscriptionById(id);
  if (!sub || sub.status !== 'ACTIVE') return null;
  const ts = nowIso();
  db.prepare(`
    UPDATE subscription_accounts
    SET admin_claimed_by_id = ?, admin_claimed_at = ?, admin_last_action_at = ?, updated_at = ?
    WHERE id = ?
  `).run(String(adminId), ts, ts, ts, id);
  return getSubscriptionById(id);
}

export function snoozeAdminRenewal(id, hours = 24) {
  const sub = getSubscriptionById(id);
  if (!sub || sub.status !== 'ACTIVE') return null;
  const safeHours = Math.min(168, Math.max(1, Number.parseInt(String(hours), 10) || 24));
  const snoozedUntil = new Date(Date.now() + safeHours * 60 * 60 * 1000).toISOString();
  const ts = nowIso();
  db.prepare(`
    UPDATE subscription_accounts
    SET admin_snoozed_until = ?,
        admin_reminder_stage = NULL,
        admin_reminder_sent_at = NULL,
        admin_reminder_message_id = NULL,
        admin_reminder_channel_id = NULL,
        admin_last_action_at = ?,
        updated_at = ?
    WHERE id = ?
  `).run(snoozedUntil, ts, ts, id);
  return getSubscriptionById(id);
}

/**
 * Đánh dấu đã gửi nhắc
 */
export function markRemindSent(id) {
  const ts = nowIso();
  markRemindSentStmt().run(ts, ts, id);
  return getSubscriptionById(id);
}

/**
 * Ghi nhận khách trả lời YES/NO
 */
export function markCustomerResponse(id, response) {
  const ts = nowIso();
  markCustomerResponseStmt().run(response, response, ts, id);
  return getSubscriptionById(id);
}

/**
 * Đánh dấu hết hạn
 */
export function markExpired(id) {
  const ts = nowIso();
  markExpiredStmt().run(ts, ts, id);
  return getSubscriptionById(id);
}

/**
 * Xóa subscription
 */
export function deleteSubscription(id) {
  return deleteStmt().run(id);
}

/**
 * Reset cờ nhắc
 */
export function resetRemindFlag(id) {
  resetRemindStmt().run(nowIso(), id);
  return getSubscriptionById(id);
}

/**
 * Cập nhật thông tin
 */
export function updateSubscription(id, data) {
  const sub = getSubscriptionById(id);
  if (!sub) return null;

  updateFieldsStmt().run(
    data.gmailEmail ?? sub.gmail_email,
    encrypt(data.gmailPassword ?? sub.gmail_password),
    data.customerId ?? sub.customer_id,
    data.customerDiscordName ?? sub.customer_discord_name,
    data.totalDurationMonths ?? sub.total_duration_months,
    data.renewalCycleMonths ?? sub.renewal_cycle_months,
    data.spotifyFamilyName ?? sub.spotify_family_name,
    data.spotifySlotsUsed ?? sub.spotify_slots_used,
    data.note ?? sub.note,
    nowIso(),
    id,
  );

  return getSubscriptionById(id);
}

/**
 * Đếm subscriptions theo guild
 */
export function getSubscriptionCounts(guildId) {
  return countByGuildStmt().all(guildId);
}

/**
 * Check gói Nitro lẻ
 */
export function isRetailNitro(sub) {
  return sub.service_type === 'nitro' && sub.renewal_mode === 'one_time';
}

/**
 * Tính số lần gia hạn cần thiết
 */
export function getTotalRenewalsNeeded(sub) {
  if (sub.renewal_mode !== 'auto_cycle' || !sub.renewal_cycle_months) return 0;
  return Math.max(0, Math.floor(sub.total_duration_months / sub.renewal_cycle_months) - 1);
}

/**
 * Lấy danh sách cần gia hạn trong N ngày (cho command check)
 */
export function getSubscriptionsDueInDays(guildId, days = 7) {
  return db.prepare(`
    SELECT * FROM subscription_accounts
    WHERE guild_id = ? AND status = 'ACTIVE'
      AND (
        (renewal_mode = 'auto_cycle' AND next_renewal_at IS NOT NULL AND datetime(next_renewal_at) <= datetime('now', ?))
        OR
        (renewal_mode IN ('one_time', 'full_paid') AND datetime(expiry_at) <= datetime('now', ?))
      )
    ORDER BY
      CASE WHEN renewal_mode = 'auto_cycle' THEN next_renewal_at ELSE expiry_at END ASC
  `).all(guildId, `+${days} days`, `+${days} days`);
}

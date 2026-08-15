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
      AND COALESCE(progress_status, 'VERIFIED') = 'VERIFIED'
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
      AND COALESCE(progress_status, 'VERIFIED') = 'VERIFIED'
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
      AND COALESCE(progress_status, 'VERIFIED') = 'VERIFIED'
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
      AND COALESCE(progress_status, 'VERIFIED') = 'VERIFIED'
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
      AND COALESCE(progress_status, 'VERIFIED') = 'VERIFIED'
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

export function addSubscriptionMonths(baseDate, months) {
  const source = new Date(baseDate);
  if (!Number.isFinite(source.getTime())) throw new Error('Ngày bắt đầu không hợp lệ.');
  const amount = Math.max(0, Number.parseInt(String(months || 0), 10) || 0);
  const day = source.getUTCDate();
  const target = new Date(source.getTime());
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + amount);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString();
}

function computeNextRenewal(purchaseDate, cycleMonths, timesRenewed = 0) {
  if (!cycleMonths || cycleMonths <= 0) return null;
  const nextCycle = timesRenewed + 1;
  return addSubscriptionMonths(purchaseDate, cycleMonths * nextCycle);
}

function computeExpiry(purchaseDate, totalMonths) {
  return addSubscriptionMonths(purchaseDate, totalMonths);
}

export function getSubscriptionProgress(sub) {
  const totalMonths = Math.max(1, Number.parseInt(String(sub?.total_duration_months || 1), 10) || 1);
  const isAutoCycle = sub?.renewal_mode === 'auto_cycle';
  const cycleMonths = isAutoCycle
    ? Math.max(1, Number.parseInt(String(sub?.renewal_cycle_months || 1), 10) || 1)
    : totalMonths;
  const fulfilledMonths = isAutoCycle
    ? Math.min(totalMonths, cycleMonths * (Math.max(0, Number(sub?.times_renewed || 0)) + 1))
    : totalMonths;
  const remainingMonths = Math.max(0, totalMonths - fulfilledMonths);
  const nextAction = remainingMonths > 0 ? 'RENEW' : 'DISCONNECT';
  return {
    totalMonths,
    cycleMonths,
    fulfilledMonths,
    remainingMonths,
    nextAction,
    nextActionAt: nextAction === 'RENEW' ? sub?.next_renewal_at : sub?.expiry_at,
    nextCycleNumber: nextAction === 'RENEW' ? Math.min(totalMonths, fulfilledMonths + cycleMonths) : null,
    needsReview: sub?.progress_status === 'NEEDS_REVIEW',
  };
}

export function recordSubscriptionEvent(subscriptionId, eventType, {
  actorId = null,
  source = 'SYSTEM',
  note = null,
  scheduledFor = null,
  fulfilledMonths = null,
  totalMonths = null,
} = {}) {
  const sub = getSubscriptionById(subscriptionId);
  if (!sub) return null;
  const progress = getSubscriptionProgress(sub);
  const result = db.prepare(`
    INSERT INTO subscription_events (
      subscription_id, guild_id, event_type, fulfilled_months, total_months,
      scheduled_for, actor_id, source, note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sub.id,
    sub.guild_id,
    eventType,
    fulfilledMonths ?? progress.fulfilledMonths,
    totalMonths ?? progress.totalMonths,
    scheduledFor ?? progress.nextActionAt ?? null,
    actorId ? String(actorId) : null,
    source,
    note,
    nowIso(),
  );
  return db.prepare('SELECT * FROM subscription_events WHERE id = ?').get(Number(result.lastInsertRowid));
}

export function getSubscriptionHistory(id, limit = 30) {
  const safeLimit = Math.min(100, Math.max(1, Number.parseInt(String(limit), 10) || 30));
  return db.prepare(`
    SELECT * FROM subscription_events
    WHERE subscription_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(Number(id), safeLimit);
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
  source = 'MANUAL',
  actorId = null,
  progressStatus = 'VERIFIED',
  progressReviewNote = null,
}) {
  const ts = nowIso();
  const safeTotalDurationMonths = Math.max(1, Number.parseInt(String(totalDurationMonths || 1), 10) || 1);
  const safeRenewalMode = renewalMode === 'full_paid'
    ? 'full_paid'
    : safeTotalDurationMonths > 1 ? 'auto_cycle' : 'one_time';
  const safeRenewalCycleMonths = safeRenewalMode === 'auto_cycle' ? 1 : 0;
  const expiryAt = computeExpiry(purchaseDate, safeTotalDurationMonths);
  let nextRenewalAt = null;

  if (safeRenewalMode === 'auto_cycle') {
    nextRenewalAt = computeNextRenewal(purchaseDate, safeRenewalCycleMonths, 0);
  }

  const result = insertStmt().run(
    guildId,
    serviceType,
    safeRenewalMode,
    gmailEmail,
    gmailPassword != null ? encrypt(gmailPassword) : null,
    customerId,
    customerDiscordName,
    relatedOrderCode,
    purchaseDate,
    safeTotalDurationMonths,
    safeRenewalCycleMonths,
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

  const created = getByIdStmt().get(Number(result.lastInsertRowid));
  db.prepare(`
    UPDATE subscription_accounts
    SET progress_status = ?, progress_review_note = ?
    WHERE id = ?
  `).run(progressStatus, progressReviewNote, created.id);
  const saved = getByIdStmt().get(created.id);
  recordSubscriptionEvent(saved.id, source === 'DELIVERY' ? 'ACTIVATED' : 'CREATED', {
    actorId,
    source,
    note: note || null,
  });
  return saved;
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
  if (!existing) return addSubscription({ ...data, source: data.source || 'DELIVERY' });

  const purchaseDate = existing.purchase_date || data.purchaseDate;
  const totalDurationMonths = Math.max(1, Number(data.totalDurationMonths || 1));
  const renewalMode = data.renewalMode === 'full_paid'
    ? 'full_paid'
    : totalDurationMonths > 1 ? 'auto_cycle' : 'one_time';
  const renewalCycleMonths = renewalMode === 'auto_cycle' ? 1 : 0;
  const expiryAt = computeExpiry(purchaseDate, totalDurationMonths);
  let nextRenewalAt = null;
  if (renewalMode === 'auto_cycle') {
    nextRenewalAt = computeNextRenewal(purchaseDate, renewalCycleMonths, existing.times_renewed || 0);
    if (new Date(nextRenewalAt) >= new Date(expiryAt)) nextRenewalAt = null;
  }
  const status = new Date(expiryAt) <= new Date() ? 'EXPIRED' : 'ACTIVE';
  const ts = nowIso();

  updateFromDeliveryStmt().run(
    data.guildId,
    data.serviceType,
    renewalMode,
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
  db.prepare(`
    UPDATE subscription_accounts
    SET progress_status = ?, progress_review_note = ?
    WHERE id = ?
  `).run(data.progressStatus || 'VERIFIED', data.progressReviewNote || null, existing.id);
  recordSubscriptionEvent(existing.id, 'DELIVERY_UPDATED', {
    source: data.source || 'DELIVERY',
    note: 'Đồng bộ lại thông tin từ đơn giao hàng.',
  });
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
export function markRenewed(id, { actorId = null, source = 'ADMIN', note = null } = {}) {
  const sub = getSubscriptionById(id);
  if (!sub) return null;

  const ts = nowIso();
  if (sub.renewal_mode !== 'auto_cycle' || !Number(sub.renewal_cycle_months)) {
    const currentExpiry = new Date(sub.expiry_at);
    const base = Number.isFinite(currentExpiry.getTime()) && currentExpiry > new Date()
      ? currentExpiry
      : new Date();
    const newExpiry = addSubscriptionMonths(base, Math.max(1, Number(sub.total_duration_months || 1)));
    markOneTimeRenewedStmt().run(newExpiry, ts, ts, id);
    const updated = getSubscriptionById(id);
    recordSubscriptionEvent(id, 'PACKAGE_EXTENDED', { actorId, source, note, scheduledFor: newExpiry });
    return updated;
  }

  const before = getSubscriptionProgress(sub);
  if (before.remainingMonths <= 0) {
    return { ...sub, lifecycleAction: 'DISCONNECT', alreadyFulfilled: true };
  }

  const newTimesRenewed = (sub.times_renewed || 0) + 1;
  const fulfilledAfter = Math.min(before.totalMonths, before.cycleMonths * (newTimesRenewed + 1));
  const newNextRenewal = fulfilledAfter < before.totalMonths
    ? computeNextRenewal(sub.purchase_date, sub.renewal_cycle_months, newTimesRenewed)
    : null;

  markRenewedStmt().run(newNextRenewal, ts, ts, id);
  const updated = getSubscriptionById(id);
  recordSubscriptionEvent(id, 'RENEWED', {
    actorId,
    source,
    note,
    fulfilledMonths: fulfilledAfter,
    totalMonths: before.totalMonths,
    scheduledFor: newNextRenewal || updated.expiry_at,
  });
  return updated;
}

export function markDisconnected(id, { actorId = null, source = 'ADMIN', note = null } = {}) {
  const sub = getSubscriptionById(id);
  if (!sub) return null;
  const ts = nowIso();
  markExpiredStmt().run(ts, ts, id);
  const updated = getSubscriptionById(id);
  recordSubscriptionEvent(id, 'DISCONNECTED', { actorId, source, note, scheduledFor: ts });
  return updated;
}

export function setSubscriptionFulfilledMonths(id, fulfilledMonths, {
  actorId = null,
  source = 'ADMIN_PROGRESS',
  note = null,
} = {}) {
  const sub = getSubscriptionById(id);
  if (!sub) return null;
  const total = Math.max(1, Number(sub.total_duration_months || 1));
  const fulfilled = Number.parseInt(String(fulfilledMonths), 10);
  if (!Number.isInteger(fulfilled) || fulfilled < 1 || fulfilled > total) {
    throw new Error(`Số tháng đã cấp phải nằm trong khoảng 1-${total}.`);
  }
  const autoCycle = total > 1 && sub.renewal_mode !== 'full_paid';
  const renewalMode = autoCycle ? 'auto_cycle' : sub.renewal_mode;
  const timesRenewed = autoCycle ? fulfilled - 1 : 0;
  const nextRenewalAt = autoCycle && fulfilled < total
    ? addSubscriptionMonths(sub.purchase_date, fulfilled)
    : null;
  const ts = nowIso();
  db.prepare(`
    UPDATE subscription_accounts
    SET renewal_mode = ?, renewal_cycle_months = ?, times_renewed = ?,
        next_renewal_at = ?, progress_status = 'VERIFIED', progress_review_note = NULL,
        renewal_remind_sent_at = NULL, admin_reminder_stage = NULL,
        admin_reminder_sent_at = NULL, admin_reminder_message_id = NULL,
        admin_reminder_channel_id = NULL, admin_claimed_by_id = NULL,
        admin_claimed_at = NULL, admin_snoozed_until = NULL,
        admin_last_action_at = ?, updated_at = ?
    WHERE id = ?
  `).run(renewalMode, autoCycle ? 1 : 0, timesRenewed, nextRenewalAt, ts, ts, id);
  const updated = getSubscriptionById(id);
  recordSubscriptionEvent(id, 'PROGRESS_ADJUSTED', {
    actorId,
    source,
    note: note || `Admin xác nhận đã cấp ${fulfilled}/${total} tháng.`,
    fulfilledMonths: fulfilled,
    totalMonths: total,
    scheduledFor: nextRenewalAt || updated.expiry_at,
  });
  return updated;
}

export function findSubscriptions(guildId, query, limit = 20) {
  const keyword = String(query || '').trim();
  if (!keyword) return [];
  const like = `%${keyword}%`;
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
  return db.prepare(`
    SELECT * FROM subscription_accounts
    WHERE (guild_id = ? OR guild_id = 'WEB')
      AND (gmail_email LIKE ? OR related_order_code LIKE ? OR customer_id LIKE ? OR customer_discord_name LIKE ?)
    ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END, datetime(updated_at) DESC, id DESC
    LIMIT ?
  `).all(guildId, like, like, like, like, safeLimit);
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
      AND COALESCE(progress_status, 'VERIFIED') = 'VERIFIED'
      AND (
        (renewal_mode = 'auto_cycle' AND (
          (next_renewal_at IS NOT NULL AND datetime(next_renewal_at) <= datetime('now', ?))
          OR (next_renewal_at IS NULL AND datetime(expiry_at) <= datetime('now', ?))
        ))
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
  `).all(guildId, `+${safeDays} days`, `+${safeDays} days`, `+${safeDays} days`, safeLimit);
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
 * Chuẩn hóa dữ liệu cũ sang chu kỳ cấp dịch vụ mỗi tháng.
 * Gói từng dùng chu kỳ 2+ tháng được quy đổi mà không làm mất tiến độ;
 * gói mua lẻ nhiều tháng được đưa vào hàng chờ Admin xác minh vì không thể đoán an toàn.
 */
export function migrateSubscriptionMonthlyCycles({ guildId = null } = {}) {
  const rows = guildId
    ? db.prepare('SELECT * FROM subscription_accounts WHERE guild_id = ? ORDER BY id ASC').all(guildId)
    : db.prepare('SELECT * FROM subscription_accounts ORDER BY id ASC').all();
  let normalized = 0;
  let needsReview = 0;
  let historyCreated = 0;
  const migrate = db.transaction(() => {
    for (const sub of rows) {
      if (sub.renewal_mode === 'auto_cycle' && Number(sub.renewal_cycle_months || 0) !== 1) {
        const total = Math.max(1, Number(sub.total_duration_months || 1));
        const oldCycle = Math.max(1, Number(sub.renewal_cycle_months || 1));
        const fulfilled = Math.min(total, oldCycle * (Math.max(0, Number(sub.times_renewed || 0)) + 1));
        const nextRenewal = fulfilled < total ? addSubscriptionMonths(sub.purchase_date, fulfilled) : null;
        db.prepare(`
          UPDATE subscription_accounts
          SET renewal_cycle_months = 1, times_renewed = ?, next_renewal_at = ?,
              progress_status = 'VERIFIED', progress_review_note = NULL, updated_at = ?
          WHERE id = ?
        `).run(fulfilled - 1, nextRenewal, nowIso(), sub.id);
        normalized += 1;
      } else if (sub.renewal_mode === 'one_time' && Number(sub.total_duration_months || 1) > 1) {
        db.prepare(`
          UPDATE subscription_accounts
          SET progress_status = 'NEEDS_REVIEW',
              progress_review_note = 'Cần Admin xác nhận số tháng thực tế đã cấp trước khi bật nhắc tự động.',
              updated_at = ?
          WHERE id = ? AND COALESCE(progress_status, 'VERIFIED') <> 'NEEDS_REVIEW'
        `).run(nowIso(), sub.id);
        if (db.prepare('SELECT changes() AS changed').get().changed) needsReview += 1;
      }

      const hasHistory = db.prepare('SELECT 1 FROM subscription_events WHERE subscription_id = ? LIMIT 1').get(sub.id);
      if (!hasHistory) {
        recordSubscriptionEvent(sub.id, 'MIGRATED', {
          source: 'MONTHLY_CYCLE_MIGRATION',
          note: 'Tạo mốc lịch sử ban đầu từ dữ liệu subscription hiện có.',
        });
        historyCreated += 1;
      }
    }
  });
  migrate.immediate();
  return { scanned: rows.length, normalized, needsReview, historyCreated };
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
      AND COALESCE(progress_status, 'VERIFIED') = 'VERIFIED'
      AND (
        (renewal_mode = 'auto_cycle' AND (
          (next_renewal_at IS NOT NULL AND datetime(next_renewal_at) <= datetime('now', ?))
          OR (next_renewal_at IS NULL AND datetime(expiry_at) <= datetime('now', ?))
        ))
        OR
        (renewal_mode IN ('one_time', 'full_paid') AND datetime(expiry_at) <= datetime('now', ?))
      )
    ORDER BY
      CASE WHEN renewal_mode = 'auto_cycle' THEN next_renewal_at ELSE expiry_at END ASC
  `).all(guildId, `+${days} days`, `+${days} days`, `+${days} days`);
}

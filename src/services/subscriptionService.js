import { db, nowIso } from '../database/db.js';
import { encrypt } from '../utils/crypto.js';

export class SubscriptionRenewalConflictError extends Error {
  constructor(message = 'Kỳ gia hạn này đã được xử lý. Vui lòng tải lại dữ liệu.') {
    super(message);
    this.name = 'SubscriptionRenewalConflictError';
    this.code = 'SUBSCRIPTION_RENEWAL_CONFLICT';
  }
}

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

function updateMetadataFromDeliveryStmt() {
  return db.prepare(`
    UPDATE subscription_accounts
    SET guild_id = ?,
        service_type = ?,
        gmail_email = ?,
        gmail_password = ?,
        customer_id = ?,
        customer_discord_name = ?,
        spotify_family_name = ?,
        spotify_slots_used = ?,
        note = COALESCE(?, note),
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
        progress_status = ?,
        progress_review_note = ?,
        renewal_remind_sent_at = NULL,
        customer_response = NULL,
        admin_reminder_stage = NULL,
        admin_reminder_sent_at = NULL,
        admin_reminder_for_at = NULL,
        admin_reminder_message_id = NULL,
        admin_reminder_channel_id = NULL,
        admin_last_completed_for_at = ?,
        admin_claimed_by_id = NULL,
        admin_claimed_at = NULL,
        admin_snoozed_until = NULL,
        admin_last_action_at = ?,
        updated_at = ?
    WHERE id = ?
      AND times_renewed = ?
      AND status = 'ACTIVE'
      AND COALESCE(next_renewal_at, '') = ?
  `);
}

function markExpiredStmt() {
  return db.prepare(`
    UPDATE subscription_accounts
    SET status = 'EXPIRED',
        admin_reminder_stage = NULL,
        admin_reminder_sent_at = NULL,
        admin_reminder_for_at = NULL,
        admin_reminder_message_id = NULL,
        admin_reminder_channel_id = NULL,
        admin_last_completed_for_at = ?,
        admin_claimed_by_id = NULL,
        admin_claimed_at = NULL,
        admin_snoozed_until = NULL,
        admin_last_action_at = ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'ACTIVE'
      AND times_renewed = ?
      AND COALESCE(expiry_at, '') = ?
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
        admin_reminder_for_at = NULL,
        admin_reminder_message_id = NULL,
        admin_reminder_channel_id = NULL,
        admin_last_completed_for_at = ?,
        admin_claimed_by_id = NULL,
        admin_claimed_at = NULL,
        admin_snoozed_until = NULL,
        admin_last_action_at = ?,
        status = 'ACTIVE',
        updated_at = ?
    WHERE id = ?
      AND status = 'ACTIVE'
      AND times_renewed = ?
      AND COALESCE(expiry_at, '') = ?
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

export function getDefaultRenewalCycleMonths(serviceType, totalDurationMonths, renewalMode = 'auto_cycle') {
  if (renewalMode !== 'auto_cycle') return 0;
  const total = Math.max(1, Number.parseInt(String(totalDurationMonths || 1), 10) || 1);
  return String(serviceType || '').toLowerCase() === 'nitro' ? Math.min(2, total) : 1;
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
  const totalCycles = isAutoCycle ? Math.ceil(totalMonths / cycleMonths) : 1;
  const completedCycles = isAutoCycle
    ? Math.min(totalCycles, Math.max(0, Number(sub?.times_renewed || 0)) + 1)
    : 1;
  const nextCycleNumber = nextAction === 'RENEW' ? Math.min(totalCycles, completedCycles + 1) : null;
  return {
    totalMonths,
    cycleMonths,
    fulfilledMonths,
    remainingMonths,
    totalCycles,
    completedCycles,
    nextAction,
    nextActionAt: nextAction === 'RENEW' ? sub?.next_renewal_at : sub?.expiry_at,
    nextCycleNumber,
    nextCycleStartMonth: nextAction === 'RENEW' ? fulfilledMonths + 1 : null,
    nextCycleEndMonth: nextAction === 'RENEW' ? Math.min(totalMonths, fulfilledMonths + cycleMonths) : null,
    needsReview: sub?.progress_status === 'NEEDS_REVIEW',
  };
}

export function isSubscriptionRenewalDue(sub, withinDays = 7, now = new Date()) {
  if (!sub || sub.status !== 'ACTIVE') return false;
  if (String(sub.progress_status || 'VERIFIED') !== 'VERIFIED') return false;
  const progress = getSubscriptionProgress(sub);
  if (progress.nextAction !== 'RENEW') return false;
  const dueAt = new Date(progress.nextActionAt || 0);
  const current = new Date(now);
  if (!Number.isFinite(dueAt.getTime()) || !Number.isFinite(current.getTime())) return false;
  const safeDays = Math.min(30, Math.max(0, Number(withinDays) || 0));
  return dueAt.getTime() <= current.getTime() + safeDays * 24 * 60 * 60 * 1000;
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
  const safeRenewalCycleMonths = getDefaultRenewalCycleMonths(
    serviceType,
    safeTotalDurationMonths,
    safeRenewalMode,
  );
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

  // /giaohang có thể được gửi lại để sửa Gmail, mật khẩu hoặc profile. Khi hồ
  // sơ đã tồn tại, tuyệt đối không dựng lại vòng đời từ đơn gốc: thao tác đó
  // từng đưa next_renewal_at về mốc cũ và xóa cờ chống nhắc trùng, khiến bot
  // báo sai kỳ rồi spam lại sau mỗi lần giao hàng lại.
  const ts = nowIso();

  updateMetadataFromDeliveryStmt().run(
    data.guildId,
    data.serviceType,
    data.gmailEmail,
    encrypt(data.gmailPassword),
    data.customerId ?? null,
    data.customerDiscordName ?? null,
    data.spotifyFamilyName ?? null,
    Number(data.spotifySlotsUsed || 0),
    data.note ?? null,
    ts,
    existing.id,
  );
  recordSubscriptionEvent(existing.id, 'DELIVERY_UPDATED', {
    source: data.source || 'DELIVERY',
    note: 'Cập nhật thông tin đăng nhập từ lần giao lại; giữ nguyên tiến độ và lịch gia hạn hiện có.',
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
export function markRenewed(id, {
  actorId = null,
  source = 'ADMIN',
  note = null,
  expectedTimesRenewed = null,
  expectedActionAt = null,
  reminderWindowDays = 7,
  now = new Date(),
} = {}) {
  const sub = getSubscriptionById(id);
  if (!sub) return null;

  const currentRevision = Number(sub.times_renewed || 0);
  if (expectedTimesRenewed !== null && expectedTimesRenewed !== undefined) {
    const expectedRevision = Number(expectedTimesRenewed);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== currentRevision) {
      throw new SubscriptionRenewalConflictError();
    }
  }

  const currentProgress = getSubscriptionProgress(sub);
  const currentActionAt = currentProgress.nextActionAt;
  if (expectedActionAt !== null && expectedActionAt !== undefined) {
    if (!dateTimesMatch(expectedActionAt, currentActionAt)) {
      throw new SubscriptionRenewalConflictError('Ngày của kỳ gia hạn đã thay đổi. Vui lòng dùng panel mới nhất.');
    }
  }

  const actionDate = new Date(now);
  if (!Number.isFinite(actionDate.getTime())) throw new Error('Thời điểm gia hạn không hợp lệ.');
  const ts = actionDate.toISOString();
  if (sub.renewal_mode !== 'auto_cycle' || !Number(sub.renewal_cycle_months)) {
    const currentExpiry = new Date(sub.expiry_at);
    const base = Number.isFinite(currentExpiry.getTime()) && currentExpiry > actionDate
      ? currentExpiry
      : actionDate;
    const newExpiry = addSubscriptionMonths(base, Math.max(1, Number(sub.total_duration_months || 1)));
    const result = markOneTimeRenewedStmt().run(
      newExpiry,
      currentActionAt,
      ts,
      ts,
      id,
      currentRevision,
      String(sub.expiry_at || ''),
    );
    if (result.changes !== 1) throw new SubscriptionRenewalConflictError();
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

  // Nếu dữ liệu lịch sử bị chậm nhiều kỳ, cộng đúng một tháng có thể khiến kỳ
  // mới vẫn nằm ngay trong cửa sổ nhắc. Không được bắn tiếp một panel ngay sau
  // khi Admin vừa xác nhận; khóa nhắc tự động để Admin đối soát tiến độ một lần.
  const safeReminderDays = Math.min(30, Math.max(0, Number(reminderWindowDays) || 0));
  const reviewCutoff = actionDate.getTime() + safeReminderDays * 24 * 60 * 60 * 1000;
  const newNextMs = newNextRenewal ? new Date(newNextRenewal).getTime() : Number.POSITIVE_INFINITY;
  const needsReview = Number.isFinite(newNextMs) && newNextMs <= reviewCutoff;
  const progressStatus = needsReview ? 'NEEDS_REVIEW' : 'VERIFIED';
  const reviewNote = needsReview
    ? 'Lịch kỳ tiếp theo vẫn nằm trong cửa sổ nhắc ngay sau khi xác nhận. Hệ thống đã tạm khóa thông báo để tránh spam; Admin cần đối soát số tháng đã cấp.'
    : null;

  const result = markRenewedStmt().run(
    newNextRenewal,
    progressStatus,
    reviewNote,
    currentActionAt,
    ts,
    ts,
    id,
    currentRevision,
    String(sub.next_renewal_at || ''),
  );
  if (result.changes !== 1) throw new SubscriptionRenewalConflictError();
  const updated = getSubscriptionById(id);
  recordSubscriptionEvent(id, 'RENEWED', {
    actorId,
    source,
    note: note || reviewNote,
    fulfilledMonths: fulfilledAfter,
    totalMonths: before.totalMonths,
    scheduledFor: newNextRenewal || updated.expiry_at,
  });
  return updated;
}

export function markDisconnected(id, {
  actorId = null,
  source = 'ADMIN',
  note = null,
  expectedTimesRenewed = null,
  expectedActionAt = null,
} = {}) {
  const sub = getSubscriptionById(id);
  if (!sub) return null;
  const currentRevision = Number(sub.times_renewed || 0);
  if (expectedTimesRenewed !== null && Number(expectedTimesRenewed) !== currentRevision) {
    throw new SubscriptionRenewalConflictError();
  }
  if (expectedActionAt !== null && !dateTimesMatch(expectedActionAt, sub.expiry_at)) {
    throw new SubscriptionRenewalConflictError('Ngày kết thúc gói đã thay đổi. Vui lòng dùng panel mới nhất.');
  }
  const ts = nowIso();
  const result = markExpiredStmt().run(sub.expiry_at, ts, ts, id, currentRevision, String(sub.expiry_at || ''));
  if (result.changes !== 1) throw new SubscriptionRenewalConflictError();
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
  const renewalCycleMonths = getDefaultRenewalCycleMonths(sub.service_type, total, renewalMode);
  if (autoCycle && fulfilled < total && fulfilled % renewalCycleMonths !== 0) {
    throw new Error(`Tiến độ ${fulfilled}/${total} tháng không khớp chu kỳ ${renewalCycleMonths} tháng/lần của ${sub.service_type}.`);
  }
  const completedCycles = autoCycle ? Math.ceil(fulfilled / renewalCycleMonths) : 1;
  const timesRenewed = autoCycle ? Math.max(0, completedCycles - 1) : 0;
  const nextRenewalAt = autoCycle && fulfilled < total
    ? addSubscriptionMonths(sub.purchase_date, fulfilled)
    : null;
  const ts = nowIso();
  db.prepare(`
    UPDATE subscription_accounts
    SET renewal_mode = ?, renewal_cycle_months = ?, times_renewed = ?,
        next_renewal_at = ?, progress_status = 'VERIFIED', progress_review_note = NULL,
        renewal_remind_sent_at = NULL, admin_reminder_stage = NULL,
        admin_reminder_sent_at = NULL, admin_reminder_for_at = NULL,
        admin_reminder_message_id = NULL, admin_reminder_channel_id = NULL,
        admin_last_completed_for_at = NULL, admin_claimed_by_id = NULL,
        admin_claimed_at = NULL, admin_snoozed_until = NULL,
        admin_last_action_at = ?, updated_at = ?
    WHERE id = ?
  `).run(renewalMode, renewalCycleMonths, timesRenewed, nextRenewalAt, ts, ts, id);
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

/**
 * Áp dụng một lần bản sửa tiến độ đã được chủ shop xác nhận. Marker trong
 * system_settings ngăn một deploy/restart sau này ghi đè các lần gia hạn hợp
 * lệ mới hơn.
 */
export function applySubscriptionProgressRepairOnce({
  migrationId,
  orderCode,
  fulfilledMonths,
  note = null,
} = {}) {
  const safeMigrationId = String(migrationId || '').trim();
  const safeOrderCode = String(orderCode || '').trim();
  if (!safeMigrationId || !safeOrderCode) {
    throw new Error('Bản sửa tiến độ cần migrationId và orderCode.');
  }

  const markerKey = `subscription_progress_repair:${safeMigrationId}`;
  const existingMarker = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(markerKey);
  if (existingMarker) {
    let saved = {};
    try {
      saved = JSON.parse(existingMarker.value || '{}');
    } catch {}
    return {
      ...saved,
      skipped: true,
      reason: 'already_applied',
      orderCode: safeOrderCode,
    };
  }

  const existing = getSubscriptionByOrderCode(safeOrderCode);
  if (!existing) {
    return { skipped: true, reason: 'subscription_not_found', orderCode: safeOrderCode };
  }

  const requestedMonths = Number.parseInt(String(fulfilledMonths), 10);
  const totalMonths = Math.max(1, Number(existing.total_duration_months || 1));
  if (!Number.isInteger(requestedMonths) || requestedMonths < 1 || requestedMonths > totalMonths) {
    throw new Error(`Tiến độ cần khôi phục phải nằm trong khoảng 1-${totalMonths}.`);
  }

  const previousProgress = getSubscriptionProgress(existing);
  const expectedNextRenewalAt = requestedMonths < totalMonths
    ? addSubscriptionMonths(existing.purchase_date, requestedMonths)
    : null;
  const alreadyCorrect = previousProgress.fulfilledMonths === requestedMonths
    && existing.progress_status === 'VERIFIED'
    && Number(existing.renewal_cycle_months || 0) === getDefaultRenewalCycleMonths(
      existing.service_type,
      totalMonths,
      existing.renewal_mode,
    )
    && (
      (expectedNextRenewalAt === null && existing.next_renewal_at === null)
      || dateTimesMatch(existing.next_renewal_at, expectedNextRenewalAt)
    );
  const staleReminder = {
    channelId: existing.admin_reminder_channel_id || null,
    messageId: existing.admin_reminder_message_id || null,
  };

  const updated = alreadyCorrect
    ? existing
    : setSubscriptionFulfilledMonths(existing.id, requestedMonths, {
        source: 'OWNER_CONFIRMED_REPAIR',
        note: note || `Khôi phục tiến độ đã được xác nhận về ${requestedMonths}/${totalMonths} tháng.`,
      });

  const appliedAt = nowIso();
  db.prepare(`
    INSERT INTO system_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(markerKey, JSON.stringify({
    orderCode: safeOrderCode,
    subscriptionId: existing.id,
    fulfilledMonths: requestedMonths,
    staleReminder,
    cleanupPending: true,
    appliedAt,
  }), appliedAt);

  return {
    skipped: false,
    changed: !alreadyCorrect,
    orderCode: safeOrderCode,
    subscriptionId: existing.id,
    previousFulfilledMonths: previousProgress.fulfilledMonths,
    fulfilledMonths: requestedMonths,
    nextRenewalAt: updated.next_renewal_at,
    staleReminder,
    cleanupPending: true,
  };
}

export function markSubscriptionProgressRepairCleanupComplete(migrationId, deletedMessageIds = []) {
  const safeMigrationId = String(migrationId || '').trim();
  if (!safeMigrationId) return false;
  const markerKey = `subscription_progress_repair:${safeMigrationId}`;
  const marker = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(markerKey);
  if (!marker) return false;
  let saved = {};
  try {
    saved = JSON.parse(marker.value || '{}');
  } catch {}
  const updatedAt = nowIso();
  db.prepare('UPDATE system_settings SET value = ?, updated_at = ? WHERE key = ?').run(JSON.stringify({
    ...saved,
    cleanupPending: false,
    cleanedAt: updatedAt,
    deletedReminderMessageIds: [...new Set((deletedMessageIds || []).map(String))],
  }), updatedAt, markerKey);
  return true;
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
      AND (
        admin_last_completed_for_at IS NULL
        OR datetime(admin_last_completed_for_at) <> datetime(CASE
          WHEN renewal_mode = 'auto_cycle' AND next_renewal_at IS NOT NULL THEN next_renewal_at
          ELSE expiry_at
        END)
      )
    ORDER BY datetime(CASE
      WHEN renewal_mode = 'auto_cycle' AND next_renewal_at IS NOT NULL THEN next_renewal_at
      ELSE expiry_at
    END) ASC
    LIMIT ?
  `).all(guildId, `+${safeDays} days`, `+${safeDays} days`, `+${safeDays} days`, safeLimit);
}

/**
 * Giữ chỗ một lượt gửi reminder bằng optimistic concurrency. Hai scheduler
 * hoặc hai lần quét chạy đồng thời chỉ có một tiến trình được quyền gửi.
 */
export function reserveAdminReminderDispatch(id, {
  stage,
  channelId = null,
  expectedStage = null,
  expectedSentAt = null,
  expectedTimesRenewed = null,
  expectedActionAt = null,
  sentAt = nowIso(),
} = {}) {
  const expectedRevision = Number(expectedTimesRenewed);
  if (!Number.isInteger(expectedRevision) || !expectedActionAt) return null;
  const result = db.prepare(`
    UPDATE subscription_accounts
    SET admin_reminder_stage = ?,
        admin_reminder_sent_at = ?,
        admin_reminder_for_at = ?,
        admin_reminder_channel_id = ?,
        admin_last_action_at = ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'ACTIVE'
      AND COALESCE(progress_status, 'VERIFIED') = 'VERIFIED'
      AND times_renewed = ?
      AND COALESCE(CASE
        WHEN renewal_mode = 'auto_cycle' AND next_renewal_at IS NOT NULL THEN next_renewal_at
        ELSE expiry_at
      END, '') = ?
      AND COALESCE(admin_reminder_stage, '') = ?
      AND COALESCE(admin_reminder_sent_at, '') = ?
      AND (admin_snoozed_until IS NULL OR datetime(admin_snoozed_until) <= datetime(?))
  `).run(
    stage,
    sentAt,
    expectedActionAt,
    channelId,
    sentAt,
    sentAt,
    id,
    expectedRevision,
    String(expectedActionAt),
    String(expectedStage || ''),
    String(expectedSentAt || ''),
    sentAt,
  );
  if (result.changes !== 1) return null;
  return { subscription: getSubscriptionById(id), sentAt };
}

export function markAdminReminderSent(id, {
  stage,
  messageId = null,
  channelId = null,
  reservedAt = null,
  reminderForAt = null,
} = {}) {
  const ts = nowIso();
  const result = reservedAt
    ? db.prepare(`
        UPDATE subscription_accounts
        SET admin_reminder_message_id = ?,
            admin_reminder_channel_id = ?,
            updated_at = ?
        WHERE id = ?
          AND admin_reminder_stage = ?
          AND admin_reminder_sent_at = ?
          AND COALESCE(admin_reminder_for_at, '') = ?
      `).run(messageId, channelId, ts, id, stage, reservedAt, String(reminderForAt || ''))
    : db.prepare(`
        UPDATE subscription_accounts
        SET admin_reminder_stage = ?,
            admin_reminder_sent_at = ?,
            admin_reminder_for_at = ?,
            admin_reminder_message_id = ?,
            admin_reminder_channel_id = ?,
            admin_last_action_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(stage, ts, reminderForAt, messageId, channelId, ts, ts, id);
  return result.changes === 1 ? getSubscriptionById(id) : null;
}

export function resetOrphanedAdminReminderDispatch(id, expectedMessageId = null) {
  const ts = nowIso();
  const result = db.prepare(`
    UPDATE subscription_accounts
    SET admin_reminder_stage = NULL,
        admin_reminder_sent_at = NULL,
        admin_reminder_for_at = NULL,
        admin_reminder_message_id = NULL,
        admin_reminder_channel_id = NULL,
        admin_last_action_at = ?,
        updated_at = ?
    WHERE id = ?
      AND status = 'ACTIVE'
      AND COALESCE(admin_reminder_message_id, '') = ?
  `).run(ts, ts, id, String(expectedMessageId || ''));
  return result.changes === 1 ? getSubscriptionById(id) : null;
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
        admin_reminder_for_at = NULL,
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
  const sub = getSubscriptionById(id);
  if (!sub) return null;
  const ts = nowIso();
  markExpiredStmt().run(
    sub.expiry_at,
    ts,
    ts,
    id,
    Number(sub.times_renewed || 0),
    String(sub.expiry_at || ''),
  );
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
 * Chuẩn hóa chu kỳ theo từng dịch vụ. Nitro cấp 2 tháng/kỳ; Spotify,
 * YouTube và Netflix dùng chu kỳ 1 tháng. Khi đổi cấu trúc, giữ nguyên số
 * tháng đã cấp nếu có thể xác định chắc chắn, còn dữ liệu lệch kỳ sẽ bị khóa
 * để Admin đối soát thay vì tiếp tục gửi reminder sai.
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
      if (sub.renewal_mode === 'auto_cycle') {
        const total = Math.max(1, Number(sub.total_duration_months || 1));
        const oldCycle = Math.max(1, Number(sub.renewal_cycle_months || 1));
        const targetCycle = getDefaultRenewalCycleMonths(sub.service_type, total, sub.renewal_mode);
        if (oldCycle !== targetCycle) {
          const fulfilled = Math.min(total, oldCycle * (Math.max(0, Number(sub.times_renewed || 0)) + 1));
          const isFreshNitroRecord = String(sub.service_type || '').toLowerCase() === 'nitro'
            && oldCycle === 1
            && targetCycle === 2
            && Number(sub.times_renewed || 0) === 0;
          // Các bản ghi Nitro chu kỳ tháng đã từng được bấm gia hạn không còn
          // đáng tin vì lỗi panel cũ có thể đã tăng revision nhiều lần. Chỉ
          // hồ sơ chưa gia hạn lần nào mới có thể tự nâng an toàn; phần còn lại
          // phải dừng reminder để Admin đối soát.
          const isUntrustedMonthlyNitro = String(sub.service_type || '').toLowerCase() === 'nitro'
            && oldCycle === 1
            && targetCycle === 2
            && Number(sub.times_renewed || 0) > 0;
          const aligned = (fulfilled >= total || fulfilled % targetCycle === 0 || isFreshNitroRecord)
            && !isUntrustedMonthlyNitro;
          const completedCycles = Math.max(1, Math.ceil(fulfilled / targetCycle));
          const normalizedFulfilled = Math.min(total, completedCycles * targetCycle);
          const nextRenewal = normalizedFulfilled < total
            ? addSubscriptionMonths(sub.purchase_date, normalizedFulfilled)
            : null;
          const ts = nowIso();
          db.prepare(`
            UPDATE subscription_accounts
            SET renewal_cycle_months = ?, times_renewed = ?, next_renewal_at = ?,
                progress_status = ?, progress_review_note = ?,
                renewal_remind_sent_at = NULL, admin_reminder_stage = NULL,
                admin_reminder_sent_at = NULL, admin_reminder_for_at = NULL,
                admin_reminder_message_id = NULL, admin_reminder_channel_id = NULL,
                admin_last_completed_for_at = NULL, admin_claimed_by_id = NULL,
                admin_claimed_at = NULL, admin_snoozed_until = NULL,
                admin_last_action_at = ?, updated_at = ?
            WHERE id = ?
          `).run(
            targetCycle,
            completedCycles - 1,
            nextRenewal,
            aligned ? 'VERIFIED' : 'NEEDS_REVIEW',
            aligned
              ? null
              : isUntrustedMonthlyNitro
                ? `Nitro cũ đã ghi nhận ${sub.times_renewed} lần bấm gia hạn khi hệ thống dùng sai chu kỳ 1 tháng; cần Admin đối soát trước khi nhắc tiếp.`
                : `Tiến độ cũ ${fulfilled}/${total} tháng không khớp chu kỳ ${targetCycle} tháng/lần; cần Admin đối soát.`,
            ts,
            ts,
            sub.id,
          );
          recordSubscriptionEvent(sub.id, 'CYCLE_NORMALIZED', {
            source: 'SERVICE_CYCLE_MIGRATION',
            note: aligned
              ? `Chuẩn hóa ${sub.service_type} từ ${oldCycle} tháng/kỳ sang ${targetCycle} tháng/kỳ; giữ ${normalizedFulfilled}/${total} tháng đã cấp.`
              : isUntrustedMonthlyNitro
                ? `Khóa nhắc tự động vì lịch sử Nitro chu kỳ tháng đã có ${sub.times_renewed} lần bấm gia hạn và có thể chứa thao tác lặp.`
                : `Khóa nhắc tự động vì tiến độ cũ ${fulfilled}/${total} tháng không khớp chu kỳ ${targetCycle} tháng/kỳ.`,
            fulfilledMonths: normalizedFulfilled,
            totalMonths: total,
            scheduledFor: nextRenewal || sub.expiry_at,
          });
          normalized += 1;
          if (!aligned) needsReview += 1;
        }
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

function dateTimesMatch(left, right, toleranceMs = 1000) {
  const leftMs = new Date(left || 0).getTime();
  const rightMs = new Date(right || 0).getTime();
  return Number.isFinite(leftMs)
    && Number.isFinite(rightMs)
    && Math.abs(leftMs - rightMs) <= toleranceMs;
}

/**
 * Sửa đúng lỗi lịch sử của modal Netflix: purchase_date từng được gán bằng
 * orders.created_at dù khách chỉ bắt đầu dùng khi orders.delivered_at.
 *
 * Migration cố ý rất hẹp: chỉ đụng subscription Netflix liên kết đơn hàng,
 * chưa từng gia hạn/chưa có phản hồi và purchase_date khớp chính xác ngày tạo
 * đơn. Vì vậy các lần gia hạn hợp lệ hoặc mốc được Admin chỉnh tay được giữ lại.
 */
export function repairNetflixDeliveryStartDates({ now = new Date() } = {}) {
  const current = new Date(now);
  if (!Number.isFinite(current.getTime())) throw new Error('Mốc kiểm tra Netflix không hợp lệ.');

  const rows = db.prepare(`
    SELECT
      subscription_accounts.*,
      orders.created_at AS order_created_at,
      orders.paid_at AS order_paid_at,
      orders.completed_at AS order_completed_at,
      orders.delivered_at AS order_delivered_at
    FROM subscription_accounts
    INNER JOIN orders
      ON orders.order_code = subscription_accounts.related_order_code
    WHERE LOWER(subscription_accounts.service_type) = 'netflix'
      AND subscription_accounts.related_order_code IS NOT NULL
      AND orders.delivered_at IS NOT NULL
      AND COALESCE(subscription_accounts.times_renewed, 0) = 0
      AND subscription_accounts.customer_response IS NULL
    ORDER BY subscription_accounts.id ASC
  `).all();

  const update = db.prepare(`
    UPDATE subscription_accounts
    SET purchase_date = ?,
        next_renewal_at = ?,
        expiry_at = ?,
        status = ?,
        renewal_remind_sent_at = NULL,
        admin_reminder_stage = NULL,
        admin_reminder_sent_at = NULL,
        admin_reminder_for_at = NULL,
        admin_reminder_message_id = NULL,
        admin_reminder_channel_id = NULL,
        admin_last_completed_for_at = NULL,
        admin_claimed_by_id = NULL,
        admin_claimed_at = NULL,
        admin_snoozed_until = NULL,
        admin_last_action_at = NULL,
        updated_at = ?
    WHERE id = ?
  `);
  const repaired = [];

  const repair = db.transaction(() => {
    for (const sub of rows) {
      const canonicalStart = sub.order_delivered_at
        || sub.order_completed_at
        || sub.order_paid_at
        || sub.order_created_at;
      if (!dateTimesMatch(sub.purchase_date, sub.order_created_at)) continue;
      if (dateTimesMatch(sub.purchase_date, canonicalStart)) continue;

      const totalMonths = Math.max(1, Number.parseInt(String(sub.total_duration_months || 1), 10) || 1);
      const expiryAt = computeExpiry(canonicalStart, totalMonths);
      let nextRenewalAt = null;
      if (sub.renewal_mode === 'auto_cycle') {
        const cycleMonths = Math.max(1, Number.parseInt(String(sub.renewal_cycle_months || 1), 10) || 1);
        nextRenewalAt = computeNextRenewal(canonicalStart, cycleMonths, Number(sub.times_renewed || 0));
        if (new Date(nextRenewalAt) >= new Date(expiryAt)) nextRenewalAt = null;
      }

      const status = ['ACTIVE', 'EXPIRED'].includes(sub.status)
        ? (new Date(expiryAt) <= current ? 'EXPIRED' : 'ACTIVE')
        : sub.status;
      const updatedAt = nowIso();
      update.run(canonicalStart, nextRenewalAt, expiryAt, status, updatedAt, sub.id);
      recordSubscriptionEvent(sub.id, 'START_DATE_REPAIRED', {
        source: 'NETFLIX_DELIVERY_DATE_REPAIR',
        scheduledFor: nextRenewalAt || expiryAt,
        note: `Sửa ngày bắt đầu từ ngày tạo đơn (${sub.purchase_date}) sang ngày giao hàng (${canonicalStart}); hạn cũ ${sub.expiry_at}, hạn mới ${expiryAt}.`,
      });
      repaired.push({
        subscriptionId: sub.id,
        orderCode: sub.related_order_code,
        previousStartAt: sub.purchase_date,
        startAt: canonicalStart,
        previousExpiryAt: sub.expiry_at,
        expiryAt,
      });
    }
  });
  repair.immediate();

  return { scanned: rows.length, repaired };
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

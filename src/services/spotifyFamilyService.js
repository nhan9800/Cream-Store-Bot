import { db, nowIso } from '../database/db.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import {
  addCalendarMonths,
  calculateFamilyProgress,
  calculateMemberUsage,
  maskPaymentCard,
  resolveFamilyReminderStage,
  shouldSendFamilyReminder,
} from './spotifyFamilyUtils.js';

const FAMILY_STATUSES = new Set(['ACTIVE', 'PAUSED', 'EXPIRED']);
const MEMBER_STATUSES = new Set(['ACTIVE', 'LEFT', 'EXPIRED']);

function clean(value, maxLength = 500) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function money(value) {
  const parsed = Number.parseInt(String(value ?? 0).replace(/\D/g, ''), 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function isoDate(value, label) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} không hợp lệ.`);
  return parsed.toISOString();
}

function familyRow(id) {
  return db.prepare('SELECT * FROM spotify_families WHERE id = ?').get(Number(id)) || null;
}

function memberRow(id) {
  return db.prepare('SELECT * FROM spotify_family_members WHERE id = ?').get(Number(id)) || null;
}

function familyMemberCount(id) {
  return Number(db.prepare(`
    SELECT COUNT(*) AS total
    FROM spotify_family_members
    WHERE family_id = ? AND status = 'ACTIVE'
  `).get(Number(id))?.total || 0);
}

function serializeMember(row, now = new Date()) {
  return {
    id: row.id,
    familyId: row.family_id,
    spotifyUsername: row.spotify_username,
    spotifyEmail: decrypt(row.spotify_email) || '',
    customerName: row.customer_name,
    discordId: row.discord_id,
    relatedOrderCode: row.related_order_code,
    joinedAt: row.joined_at,
    purchasedMonths: row.purchased_months,
    memberExpiryAt: row.member_expiry_at,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...calculateMemberUsage(row, now),
  };
}

function serializeFamily(row, activeMemberCount = null, { includeSecrets = true, now = new Date() } = {}) {
  const members = activeMemberCount == null ? familyMemberCount(row.id) : Number(activeMemberCount || 0);
  const cardNumber = decrypt(row.payment_card_number) || '';
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    loginEmail: decrypt(row.login_email) || '',
    loginPassword: includeSecrets ? (decrypt(row.login_password) || '') : '',
    paymentCardLabel: row.payment_card_label,
    paymentCardNumber: includeSecrets ? cardNumber : '',
    paymentCardMasked: maskPaymentCard(cardNumber),
    renewalCost: Number(row.renewal_cost || 0),
    totalSlots: Number(row.total_slots || 6),
    cycleStartedAt: row.cycle_started_at,
    nextRenewalAt: row.next_renewal_at,
    reminderDaysBefore: Number(row.reminder_days_before || 7),
    timesRenewed: Number(row.times_renewed || 0),
    status: row.status,
    note: row.note,
    reminderStage: row.reminder_stage,
    reminderSentAt: row.reminder_sent_at,
    snoozedUntil: row.snoozed_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...calculateFamilyProgress(row, members, now),
  };
}

export function listSpotifyFamilies({ guildId = null, status = null, query = null, includeSecrets = true } = {}) {
  let sql = `
    SELECT f.*,
           SUM(CASE WHEN m.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_member_count
    FROM spotify_families f
    LEFT JOIN spotify_family_members m ON m.family_id = f.id
    WHERE 1 = 1
  `;
  const params = [];
  if (guildId) {
    sql += ' AND f.guild_id = ?';
    params.push(String(guildId));
  }
  if (status && FAMILY_STATUSES.has(String(status).toUpperCase())) {
    sql += ' AND f.status = ?';
    params.push(String(status).toUpperCase());
  }
  sql += ' GROUP BY f.id ORDER BY CASE f.status WHEN \'ACTIVE\' THEN 0 WHEN \'PAUSED\' THEN 1 ELSE 2 END, datetime(f.next_renewal_at) ASC, f.id DESC';
  let families = db.prepare(sql).all(...params)
    .map((row) => serializeFamily(row, row.active_member_count, { includeSecrets }));

  const keyword = clean(query, 120)?.toLocaleLowerCase('vi-VN');
  if (keyword) {
    families = families.filter((family) => [
      family.name,
      family.loginEmail,
      family.paymentCardLabel,
      family.note,
    ].some((value) => String(value || '').toLocaleLowerCase('vi-VN').includes(keyword)));
  }
  return families;
}

export function getSpotifyFamily(id, { includeSecrets = true } = {}) {
  const row = familyRow(id);
  if (!row) return null;
  const members = db.prepare(`
    SELECT * FROM spotify_family_members
    WHERE family_id = ?
    ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, datetime(joined_at) ASC, id ASC
  `).all(row.id).map((member) => serializeMember(member));
  return { ...serializeFamily(row, members.filter((member) => member.status === 'ACTIVE').length, { includeSecrets }), members };
}

export function getSpotifyFamilyStats(guildId = null) {
  const families = listSpotifyFamilies({ guildId, includeSecrets: false });
  const active = families.filter((family) => family.status === 'ACTIVE');
  return {
    totalFamilies: families.length,
    activeFamilies: active.length,
    pausedFamilies: families.filter((family) => family.status === 'PAUSED').length,
    dueIn7Days: active.filter((family) => family.dueState !== 'HEALTHY').length,
    overdueFamilies: active.filter((family) => family.dueState === 'OVERDUE').length,
    activeMembers: active.reduce((sum, family) => sum + family.slotsUsed, 0),
    totalSlots: active.reduce((sum, family) => sum + family.totalSlots, 0),
    monthlyRenewalCost: active.reduce((sum, family) => sum + family.renewalCost, 0),
  };
}

export function createSpotifyFamily(data) {
  const name = clean(data.name, 100);
  const loginEmail = clean(data.loginEmail, 200);
  const loginPassword = clean(data.loginPassword, 300);
  if (!name || !loginEmail || !loginPassword) throw new Error('Thiếu tên Family, email hoặc mật khẩu.');

  const cycleStartedAt = isoDate(data.cycleStartedAt || nowIso(), 'Ngày bắt đầu chu kỳ');
  const nextRenewalAt = isoDate(data.nextRenewalAt || addCalendarMonths(cycleStartedAt, 1), 'Ngày gia hạn');
  if (new Date(nextRenewalAt) <= new Date(cycleStartedAt)) throw new Error('Ngày gia hạn phải sau ngày bắt đầu chu kỳ.');
  const status = FAMILY_STATUSES.has(String(data.status || '').toUpperCase()) ? String(data.status).toUpperCase() : 'ACTIVE';
  const ts = nowIso();
  const result = db.prepare(`
    INSERT INTO spotify_families (
      guild_id, name, login_email, login_password,
      payment_card_label, payment_card_number, renewal_cost, total_slots,
      cycle_started_at, next_renewal_at, reminder_days_before,
      status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(data.guildId || 'WEB'),
    name,
    encrypt(loginEmail),
    encrypt(loginPassword),
    clean(data.paymentCardLabel, 100),
    data.paymentCardNumber ? encrypt(clean(data.paymentCardNumber, 80)) : null,
    money(data.renewalCost),
    integer(data.totalSlots, 6, 1, 50),
    cycleStartedAt,
    nextRenewalAt,
    integer(data.reminderDaysBefore, 7, 1, 30),
    status,
    clean(data.note, 1000),
    ts,
    ts,
  );
  return getSpotifyFamily(Number(result.lastInsertRowid));
}

export function updateSpotifyFamily(id, data) {
  const existing = familyRow(id);
  if (!existing) return null;
  const name = clean(data.name ?? existing.name, 100);
  const loginEmail = clean(data.loginEmail ?? decrypt(existing.login_email), 200);
  const loginPassword = clean(data.loginPassword ?? decrypt(existing.login_password), 300);
  if (!name || !loginEmail || !loginPassword) throw new Error('Thiếu tên Family, email hoặc mật khẩu.');
  const cycleStartedAt = isoDate(data.cycleStartedAt ?? existing.cycle_started_at, 'Ngày bắt đầu chu kỳ');
  const nextRenewalAt = isoDate(data.nextRenewalAt ?? existing.next_renewal_at, 'Ngày gia hạn');
  if (new Date(nextRenewalAt) <= new Date(cycleStartedAt)) throw new Error('Ngày gia hạn phải sau ngày bắt đầu chu kỳ.');
  const requestedStatus = String(data.status ?? existing.status).toUpperCase();
  const status = FAMILY_STATUSES.has(requestedStatus) ? requestedStatus : existing.status;
  const cardNumber = data.paymentCardNumber === undefined
    ? existing.payment_card_number
    : data.paymentCardNumber ? encrypt(clean(data.paymentCardNumber, 80)) : null;

  db.prepare(`
    UPDATE spotify_families
    SET name = ?, login_email = ?, login_password = ?,
        payment_card_label = ?, payment_card_number = ?, renewal_cost = ?, total_slots = ?,
        cycle_started_at = ?, next_renewal_at = ?, reminder_days_before = ?,
        status = ?, note = ?,
        reminder_stage = CASE WHEN next_renewal_at <> ? THEN NULL ELSE reminder_stage END,
        reminder_sent_at = CASE WHEN next_renewal_at <> ? THEN NULL ELSE reminder_sent_at END,
        reminder_for_renewal_at = CASE WHEN next_renewal_at <> ? THEN NULL ELSE reminder_for_renewal_at END,
        snoozed_until = CASE WHEN next_renewal_at <> ? THEN NULL ELSE snoozed_until END,
        updated_at = ?
    WHERE id = ?
  `).run(
    name,
    encrypt(loginEmail),
    encrypt(loginPassword),
    clean(data.paymentCardLabel ?? existing.payment_card_label, 100),
    cardNumber,
    money(data.renewalCost ?? existing.renewal_cost),
    integer(data.totalSlots ?? existing.total_slots, 6, 1, 50),
    cycleStartedAt,
    nextRenewalAt,
    integer(data.reminderDaysBefore ?? existing.reminder_days_before, 7, 1, 30),
    status,
    clean(data.note ?? existing.note, 1000),
    nextRenewalAt,
    nextRenewalAt,
    nextRenewalAt,
    nextRenewalAt,
    nowIso(),
    existing.id,
  );
  return getSpotifyFamily(existing.id);
}

export function deleteSpotifyFamily(id) {
  return db.prepare('DELETE FROM spotify_families WHERE id = ?').run(Number(id)).changes > 0;
}

export function markSpotifyFamilyRenewed(id) {
  const existing = familyRow(id);
  if (!existing) return null;
  const newCycleStart = existing.next_renewal_at;
  const newNextRenewal = addCalendarMonths(existing.next_renewal_at, 1);
  db.prepare(`
    UPDATE spotify_families
    SET cycle_started_at = ?, next_renewal_at = ?, times_renewed = times_renewed + 1,
        status = 'ACTIVE', reminder_stage = NULL, reminder_sent_at = NULL,
        reminder_for_renewal_at = NULL, reminder_message_id = NULL,
        reminder_channel_id = NULL, snoozed_until = NULL, updated_at = ?
    WHERE id = ?
  `).run(newCycleStart, newNextRenewal, nowIso(), existing.id);
  return getSpotifyFamily(existing.id);
}

export function snoozeSpotifyFamilyReminder(id, hours = 24) {
  const existing = familyRow(id);
  if (!existing) return null;
  const until = new Date(Date.now() + integer(hours, 24, 1, 168) * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE spotify_families SET snoozed_until = ?, updated_at = ? WHERE id = ?')
    .run(until, nowIso(), existing.id);
  return getSpotifyFamily(existing.id);
}

export function createSpotifyFamilyMember(familyId, data) {
  const family = familyRow(familyId);
  if (!family) throw new Error('Không tìm thấy Spotify Family.');
  const username = clean(data.spotifyUsername, 120);
  if (!username) throw new Error('Thiếu username/profile Spotify.');
  const joinedAt = isoDate(data.joinedAt || nowIso(), 'Ngày tham gia');
  const purchasedMonths = integer(data.purchasedMonths, 1, 1, 120);
  const expiryAt = isoDate(data.memberExpiryAt || addCalendarMonths(joinedAt, purchasedMonths), 'Hạn thành viên');
  const requestedStatus = String(data.status || 'ACTIVE').toUpperCase();
  const status = MEMBER_STATUSES.has(requestedStatus) ? requestedStatus : 'ACTIVE';
  if (status === 'ACTIVE' && familyMemberCount(family.id) >= Number(family.total_slots || 6)) {
    throw new Error('Family đã đủ slot, không thể thêm thành viên mới.');
  }
  const ts = nowIso();
  const result = db.prepare(`
    INSERT INTO spotify_family_members (
      family_id, spotify_username, spotify_email, customer_name, discord_id,
      related_order_code, joined_at, purchased_months, member_expiry_at,
      status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    family.id,
    username,
    data.spotifyEmail ? encrypt(clean(data.spotifyEmail, 200)) : null,
    clean(data.customerName, 160),
    clean(data.discordId, 30),
    clean(data.relatedOrderCode, 80),
    joinedAt,
    purchasedMonths,
    expiryAt,
    status,
    clean(data.note, 1000),
    ts,
    ts,
  );
  return serializeMember(memberRow(Number(result.lastInsertRowid)));
}

export function updateSpotifyFamilyMember(familyId, memberId, data) {
  const existing = memberRow(memberId);
  if (!existing || existing.family_id !== Number(familyId)) return null;
  const joinedAt = isoDate(data.joinedAt ?? existing.joined_at, 'Ngày tham gia');
  const purchasedMonths = integer(data.purchasedMonths ?? existing.purchased_months, 1, 1, 120);
  const memberExpiryAt = data.memberExpiryAt !== undefined
    ? isoDate(data.memberExpiryAt, 'Hạn thành viên')
    : (data.joinedAt !== undefined || data.purchasedMonths !== undefined)
      ? addCalendarMonths(joinedAt, purchasedMonths)
      : existing.member_expiry_at;
  const requestedStatus = String(data.status ?? existing.status).toUpperCase();
  const status = MEMBER_STATUSES.has(requestedStatus) ? requestedStatus : existing.status;
  if (existing.status !== 'ACTIVE' && status === 'ACTIVE') {
    const family = familyRow(familyId);
    if (family && familyMemberCount(family.id) >= Number(family.total_slots || 6)) {
      throw new Error('Family đã đủ slot, không thể kích hoạt thêm thành viên.');
    }
  }
  const email = data.spotifyEmail === undefined
    ? existing.spotify_email
    : data.spotifyEmail ? encrypt(clean(data.spotifyEmail, 200)) : null;
  const username = clean(data.spotifyUsername ?? existing.spotify_username, 120);
  if (!username) throw new Error('Thiếu username/profile Spotify.');

  db.prepare(`
    UPDATE spotify_family_members
    SET spotify_username = ?, spotify_email = ?, customer_name = ?, discord_id = ?,
        related_order_code = ?, joined_at = ?, purchased_months = ?, member_expiry_at = ?,
        status = ?, note = ?, updated_at = ?
    WHERE id = ? AND family_id = ?
  `).run(
    username,
    email,
    clean(data.customerName ?? existing.customer_name, 160),
    clean(data.discordId ?? existing.discord_id, 30),
    clean(data.relatedOrderCode ?? existing.related_order_code, 80),
    joinedAt,
    purchasedMonths,
    memberExpiryAt,
    status,
    clean(data.note ?? existing.note, 1000),
    nowIso(),
    existing.id,
    existing.family_id,
  );
  return serializeMember(memberRow(existing.id));
}

export function deleteSpotifyFamilyMember(familyId, memberId) {
  return db.prepare('DELETE FROM spotify_family_members WHERE id = ? AND family_id = ?')
    .run(Number(memberId), Number(familyId)).changes > 0;
}

export function getSpotifyFamiliesDueForReminder(guildId, limit = 50, now = new Date()) {
  const rows = db.prepare(`
    SELECT * FROM spotify_families
    WHERE guild_id = ? AND status = 'ACTIVE'
      AND datetime(next_renewal_at) <= datetime(?, '+' || reminder_days_before || ' days')
    ORDER BY datetime(next_renewal_at) ASC
    LIMIT ?
  `).all(String(guildId), now.toISOString(), integer(limit, 50, 1, 200));
  return rows.filter((row) => {
    const stage = resolveFamilyReminderStage(row, now);
    return shouldSendFamilyReminder(row, stage, now);
  });
}

export function markSpotifyFamilyReminderSent(id, { stage, messageId = null, channelId = null } = {}) {
  const existing = familyRow(id);
  if (!existing) return null;
  db.prepare(`
    UPDATE spotify_families
    SET reminder_stage = ?, reminder_sent_at = ?, reminder_for_renewal_at = next_renewal_at,
        reminder_message_id = ?, reminder_channel_id = ?, updated_at = ?
    WHERE id = ?
  `).run(stage, nowIso(), messageId, channelId, nowIso(), existing.id);
  return getSpotifyFamily(existing.id, { includeSecrets: false });
}

export { maskPaymentCard, resolveFamilyReminderStage };

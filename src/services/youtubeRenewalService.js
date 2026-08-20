import { db, nowIso } from '../database/db.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { normalizeLinkedOrderCode, resolveOrderLink } from './orderLinkService.js';
import {
  addYoutubeCalendarMonths,
  calculateYoutubeMembership,
  maskYoutubeGmail,
  maskYoutubePaymentAccount,
  resolveYoutubeReminderStage,
  shouldSendYoutubeReminder,
} from './youtubeRenewalUtils.js';

const SOURCE_STATUSES = new Set(['ACTIVE', 'PAUSED']);
const MEMBERSHIP_STATUSES = new Set(['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']);
const PLAN_TYPES = new Set(['STABLE_FAMILY', 'ROTATING_FAMILY']);

function clean(value, maxLength = 500) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
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

function isoDate(value, label, { nullable = false } = {}) {
  if (nullable && !value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} không hợp lệ.`);
  return parsed.toISOString();
}

function sourceRow(id) {
  return db.prepare('SELECT * FROM youtube_sources WHERE id = ?').get(Number(id)) || null;
}

function membershipRow(id) {
  return db.prepare(`
    SELECT m.*,
           s.name AS source_name,
           s.contact AS source_contact,
           s.payment_method AS source_payment_method,
           s.payment_account AS source_payment_account,
           s.status AS source_status
    FROM youtube_memberships m
    JOIN youtube_sources s ON s.id = m.source_id
    WHERE m.id = ?
  `).get(Number(id)) || null;
}

function serializeSource(row, { includeSecrets = true } = {}) {
  const paymentAccount = decrypt(row.payment_account) || '';
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    contact: row.contact,
    paymentMethod: row.payment_method,
    paymentAccount: includeSecrets ? paymentAccount : '',
    paymentAccountMasked: maskYoutubePaymentAccount(paymentAccount),
    defaultCycleCost: Number(row.default_cycle_cost || 0),
    status: row.status,
    note: row.note,
    activeMemberships: Number(row.active_memberships || 0),
    totalMemberships: Number(row.total_memberships || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeEvent(row) {
  return {
    id: row.id,
    membershipId: row.membership_id,
    sourceId: row.source_id,
    eventType: row.event_type,
    cycleNumber: row.cycle_number,
    cyclesAdded: Number(row.cycles_added || 0),
    monthsAdded: Number(row.months_added || 0),
    amountPaid: Number(row.amount_paid || 0),
    paidAt: row.paid_at,
    paymentReference: row.payment_reference,
    familyLabel: row.family_label,
    previousNextPaymentAt: row.previous_next_payment_at,
    nextPaymentAt: row.next_payment_at,
    actorId: row.actor_id,
    note: row.note,
    createdAt: row.created_at,
  };
}

function serializeMembership(row, { includeSecrets = true, now = new Date() } = {}) {
  const gmail = decrypt(row.customer_gmail) || '';
  const paymentAccount = decrypt(row.source_payment_account) || '';
  return {
    id: row.id,
    guildId: row.guild_id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    sourceContact: row.source_contact,
    sourcePaymentMethod: row.source_payment_method,
    sourcePaymentAccount: includeSecrets ? paymentAccount : '',
    sourcePaymentAccountMasked: maskYoutubePaymentAccount(paymentAccount),
    sourceStatus: row.source_status,
    customerGmail: includeSecrets ? gmail : '',
    customerGmailMasked: maskYoutubeGmail(gmail),
    customerName: row.customer_name,
    customerDiscordId: row.customer_discord_id,
    relatedOrderCode: row.related_order_code,
    planType: row.plan_type,
    currentFamilyLabel: row.current_family_label,
    totalMonths: Number(row.total_months || 1),
    cycleMonths: Number(row.cycle_months || 1),
    paidCycles: Number(row.paid_cycles || 0),
    salePrice: Number(row.sale_price || 0),
    sourceCostPerCycle: Number(row.source_cost_per_cycle || 0),
    startedAt: row.started_at,
    nextSourcePaymentAt: row.next_source_payment_at,
    customerExpiryAt: row.customer_expiry_at,
    reminderDaysBefore: Number(row.reminder_days_before || 7),
    reminderStage: row.reminder_stage,
    reminderSentAt: row.reminder_sent_at,
    reminderForPaymentAt: row.reminder_for_payment_at,
    snoozedUntil: row.snoozed_until,
    status: row.status,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...calculateYoutubeMembership(row, now),
  };
}

export function listYoutubeSources({ guildId = null, includeSecrets = true } = {}) {
  let sql = `
    SELECT s.*,
           SUM(CASE WHEN m.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_memberships,
           COUNT(m.id) AS total_memberships
    FROM youtube_sources s
    LEFT JOIN youtube_memberships m ON m.source_id = s.id
    WHERE 1 = 1
  `;
  const params = [];
  if (guildId) {
    sql += ' AND s.guild_id = ?';
    params.push(String(guildId));
  }
  sql += " GROUP BY s.id ORDER BY CASE s.status WHEN 'ACTIVE' THEN 0 ELSE 1 END, s.name COLLATE NOCASE ASC";
  return db.prepare(sql).all(...params).map((row) => serializeSource(row, { includeSecrets }));
}

export function getYoutubeSource(id, { includeSecrets = true } = {}) {
  const row = db.prepare(`
    SELECT s.*,
           SUM(CASE WHEN m.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_memberships,
           COUNT(m.id) AS total_memberships
    FROM youtube_sources s
    LEFT JOIN youtube_memberships m ON m.source_id = s.id
    WHERE s.id = ? GROUP BY s.id
  `).get(Number(id));
  return row ? serializeSource(row, { includeSecrets }) : null;
}

export function createYoutubeSource(data) {
  const name = clean(data.name, 120);
  if (!name) throw new Error('Thiếu tên nguồn YouTube.');
  const status = SOURCE_STATUSES.has(String(data.status || '').toUpperCase())
    ? String(data.status).toUpperCase()
    : 'ACTIVE';
  const ts = nowIso();
  const result = db.prepare(`
    INSERT INTO youtube_sources (
      guild_id, name, contact, payment_method, payment_account,
      default_cycle_cost, status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(data.guildId || 'WEB'),
    name,
    clean(data.contact, 300),
    clean(data.paymentMethod, 120),
    data.paymentAccount ? encrypt(clean(data.paymentAccount, 200)) : null,
    money(data.defaultCycleCost),
    status,
    clean(data.note, 1200),
    ts,
    ts,
  );
  return getYoutubeSource(Number(result.lastInsertRowid));
}

export function updateYoutubeSource(id, data) {
  const existing = sourceRow(id);
  if (!existing) return null;
  const name = clean(data.name ?? existing.name, 120);
  if (!name) throw new Error('Thiếu tên nguồn YouTube.');
  const requestedStatus = String(data.status ?? existing.status).toUpperCase();
  const status = SOURCE_STATUSES.has(requestedStatus) ? requestedStatus : existing.status;
  const paymentAccount = data.paymentAccount === undefined
    ? existing.payment_account
    : data.paymentAccount ? encrypt(clean(data.paymentAccount, 200)) : null;
  db.prepare(`
    UPDATE youtube_sources
    SET name = ?, contact = ?, payment_method = ?, payment_account = ?,
        default_cycle_cost = ?, status = ?, note = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name,
    clean(data.contact ?? existing.contact, 300),
    clean(data.paymentMethod ?? existing.payment_method, 120),
    paymentAccount,
    money(data.defaultCycleCost ?? existing.default_cycle_cost),
    status,
    clean(data.note ?? existing.note, 1200),
    nowIso(),
    existing.id,
  );
  return getYoutubeSource(existing.id);
}

export function deleteYoutubeSource(id) {
  const existing = sourceRow(id);
  if (!existing) return false;
  const linked = Number(db.prepare('SELECT COUNT(*) AS total FROM youtube_memberships WHERE source_id = ?').get(existing.id)?.total || 0);
  if (linked > 0) throw new Error('Nguồn đang có hồ sơ YouTube. Hãy chuyển nguồn cho các hồ sơ trước khi xóa.');
  return db.prepare('DELETE FROM youtube_sources WHERE id = ?').run(existing.id).changes > 0;
}

export function listYoutubeMemberships({ guildId = null, sourceId = null, status = null, query = null, includeSecrets = true } = {}) {
  let sql = `
    SELECT m.*,
           s.name AS source_name,
           s.contact AS source_contact,
           s.payment_method AS source_payment_method,
           s.payment_account AS source_payment_account,
           s.status AS source_status
    FROM youtube_memberships m
    JOIN youtube_sources s ON s.id = m.source_id
    WHERE 1 = 1
  `;
  const params = [];
  if (guildId) {
    sql += ' AND m.guild_id = ?';
    params.push(String(guildId));
  }
  if (sourceId) {
    sql += ' AND m.source_id = ?';
    params.push(Number(sourceId));
  }
  const normalizedStatus = String(status || '').toUpperCase();
  if (MEMBERSHIP_STATUSES.has(normalizedStatus)) {
    sql += ' AND m.status = ?';
    params.push(normalizedStatus);
  }
  sql += ` ORDER BY
    CASE m.status WHEN 'ACTIVE' THEN 0 WHEN 'PAUSED' THEN 1 WHEN 'COMPLETED' THEN 2 ELSE 3 END,
    CASE WHEN m.next_source_payment_at IS NULL THEN 1 ELSE 0 END,
    datetime(m.next_source_payment_at) ASC, m.id DESC`;
  let memberships = db.prepare(sql).all(...params)
    .map((row) => serializeMembership(row, { includeSecrets }));
  const keyword = clean(query, 160)?.toLocaleLowerCase('vi-VN');
  if (keyword) {
    memberships = memberships.filter((membership) => [
      membership.customerGmail,
      membership.customerGmailMasked,
      membership.customerName,
      membership.relatedOrderCode,
      membership.sourceName,
      membership.currentFamilyLabel,
      membership.note,
    ].some((value) => String(value || '').toLocaleLowerCase('vi-VN').includes(keyword)));
  }
  return memberships;
}

export function getYoutubeRenewalHistory(membershipId) {
  return db.prepare(`
    SELECT * FROM youtube_renewal_events
    WHERE membership_id = ?
    ORDER BY datetime(COALESCE(paid_at, created_at)) DESC, id DESC
  `).all(Number(membershipId)).map(serializeEvent);
}

export function getYoutubeMembership(id, { includeSecrets = true, includeHistory = true } = {}) {
  const row = membershipRow(id);
  if (!row) return null;
  const membership = serializeMembership(row, { includeSecrets });
  return includeHistory ? { ...membership, history: getYoutubeRenewalHistory(row.id) } : membership;
}

export function getYoutubeRenewalStats(guildId = null) {
  const memberships = listYoutubeMemberships({ guildId, includeSecrets: false });
  const active = memberships.filter((membership) => membership.status === 'ACTIVE');
  const withObligation = active.filter((membership) => membership.remainingCycles > 0);
  return {
    totalMemberships: memberships.length,
    activeMemberships: active.length,
    pausedMemberships: memberships.filter((membership) => membership.status === 'PAUSED').length,
    completedMemberships: memberships.filter((membership) => membership.status === 'COMPLETED').length,
    fullyPaidMemberships: active.filter((membership) => membership.remainingCycles === 0).length,
    dueIn7Days: withObligation.filter((membership) => ['DUE_SOON', 'URGENT', 'OVERDUE'].includes(membership.dueState)).length,
    overdueMemberships: withObligation.filter((membership) => membership.dueState === 'OVERDUE').length,
    nextCycleCost: withObligation.reduce((sum, membership) => sum + membership.sourceCostPerCycle, 0),
    remainingLiability: withObligation.reduce((sum, membership) => sum + membership.remainingSourceCost, 0),
    totalExpectedMargin: memberships.reduce((sum, membership) => sum + membership.expectedMargin, 0),
  };
}

function assertSourceForGuild(sourceId, guildId = null) {
  const source = sourceRow(sourceId);
  if (!source) throw new Error('Không tìm thấy nguồn YouTube.');
  if (guildId && ![String(guildId), 'WEB'].includes(String(source.guild_id))) {
    throw new Error('Nguồn YouTube không thuộc cửa hàng này.');
  }
  return source;
}

export function createYoutubeMembership(data) {
  const source = assertSourceForGuild(data.sourceId, data.guildId);
  const relatedOrderCode = normalizeLinkedOrderCode(data.relatedOrderCode);
  const linkedOrder = relatedOrderCode
    ? resolveOrderLink(relatedOrderCode, { expectedService: 'YOUTUBE', guildId: data.guildId || source.guild_id })
    : null;
  const gmail = clean(data.customerGmail, 240) || linkedOrder?.customerEmail;
  if (!gmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmail)) throw new Error('Gmail khách hàng không hợp lệ.');
  const totalMonths = integer(data.totalMonths ?? linkedOrder?.durationMonths, 1, 1, 120);
  const cycleMonths = integer(data.cycleMonths, 1, 1, 12);
  const totalCycles = Math.ceil(totalMonths / cycleMonths);
  const paidCycles = integer(data.paidCycles, 1, 0, totalCycles);
  const startedAt = isoDate(data.startedAt || linkedOrder?.startedAt || nowIso(), 'Ngày bắt đầu');
  const customerExpiryAt = isoDate(
    data.customerExpiryAt || linkedOrder?.expiresAt || addYoutubeCalendarMonths(startedAt, totalMonths),
    'Ngày hết hạn khách hàng',
  );
  if (new Date(customerExpiryAt) <= new Date(startedAt)) throw new Error('Ngày hết hạn phải sau ngày bắt đầu.');
  const nextSourcePaymentAt = paidCycles >= totalCycles
    ? null
    : isoDate(
      data.nextSourcePaymentAt || addYoutubeCalendarMonths(startedAt, paidCycles * cycleMonths),
      'Kỳ thanh toán nguồn',
    );
  const requestedPlan = String(data.planType || '').toUpperCase();
  const planType = PLAN_TYPES.has(requestedPlan)
    ? requestedPlan
    : linkedOrder?.suggestedYoutubePlan || 'STABLE_FAMILY';
  const requestedStatus = String(data.status || '').toUpperCase();
  const status = MEMBERSHIP_STATUSES.has(requestedStatus) ? requestedStatus : 'ACTIVE';
  const sourceCost = money(data.sourceCostPerCycle ?? source.default_cycle_cost);
  const ts = nowIso();
  const createTransaction = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO youtube_memberships (
        guild_id, source_id, customer_gmail, customer_name, customer_discord_id,
        related_order_code, plan_type, current_family_label, total_months,
        cycle_months, paid_cycles, sale_price, source_cost_per_cycle,
        started_at, next_source_payment_at, customer_expiry_at,
        reminder_days_before, status, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(data.guildId || source.guild_id || 'WEB'),
      source.id,
      encrypt(gmail),
      clean(data.customerName, 160) || linkedOrder?.customerName,
      clean(data.customerDiscordId, 30) || linkedOrder?.discordId,
      relatedOrderCode,
      planType,
      clean(data.currentFamilyLabel, 160),
      totalMonths,
      cycleMonths,
      paidCycles,
      money(data.salePrice ?? linkedOrder?.totalAmount),
      sourceCost,
      startedAt,
      nextSourcePaymentAt,
      customerExpiryAt,
      integer(data.reminderDaysBefore, 7, 1, 30),
      status,
      clean(data.note, 1600),
      ts,
      ts,
    );
    const membershipId = Number(result.lastInsertRowid);
    if (paidCycles > 0) {
      db.prepare(`
        INSERT INTO youtube_renewal_events (
          membership_id, source_id, event_type, cycle_number, cycles_added,
          months_added, amount_paid, paid_at, family_label, next_payment_at,
          actor_id, note, created_at
        ) VALUES (?, ?, 'INITIAL_IMPORT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        membershipId,
        source.id,
        paidCycles,
        paidCycles,
        Math.min(totalMonths, paidCycles * cycleMonths),
        sourceCost * paidCycles,
        startedAt,
        clean(data.currentFamilyLabel, 160),
        nextSourcePaymentAt,
        clean(data.actorId, 80) || 'WEB_IMPORT',
        'Mốc ban đầu khi đưa khách vào YouTube Renewal Center.',
        ts,
      );
    }
    return membershipId;
  });
  return getYoutubeMembership(createTransaction());
}

export function updateYoutubeMembership(id, data) {
  const existing = membershipRow(id);
  if (!existing) return null;
  const source = assertSourceForGuild(data.sourceId ?? existing.source_id, existing.guild_id);
  const relatedOrderCode = normalizeLinkedOrderCode(
    data.relatedOrderCode !== undefined ? data.relatedOrderCode : existing.related_order_code,
  );
  const linkedOrder = relatedOrderCode
    ? resolveOrderLink(relatedOrderCode, { expectedService: 'YOUTUBE', guildId: existing.guild_id })
    : null;
  const gmail = clean(data.customerGmail ?? decrypt(existing.customer_gmail), 240) || linkedOrder?.customerEmail;
  if (!gmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmail)) throw new Error('Gmail khách hàng không hợp lệ.');
  const totalMonths = integer(data.totalMonths ?? existing.total_months, existing.total_months, 1, 120);
  const cycleMonths = integer(data.cycleMonths ?? existing.cycle_months, existing.cycle_months, 1, 12);
  const totalCycles = Math.ceil(totalMonths / cycleMonths);
  const paidCycles = integer(data.paidCycles ?? existing.paid_cycles, existing.paid_cycles, 0, totalCycles);
  const startedAt = isoDate(data.startedAt ?? existing.started_at, 'Ngày bắt đầu');
  const customerExpiryAt = isoDate(
    data.customerExpiryAt ?? existing.customer_expiry_at ?? addYoutubeCalendarMonths(startedAt, totalMonths),
    'Ngày hết hạn khách hàng',
  );
  if (new Date(customerExpiryAt) <= new Date(startedAt)) throw new Error('Ngày hết hạn phải sau ngày bắt đầu.');
  const scheduleChanged = paidCycles !== Number(existing.paid_cycles)
    || totalMonths !== Number(existing.total_months)
    || cycleMonths !== Number(existing.cycle_months);
  const nextSourcePaymentAt = paidCycles >= totalCycles
    ? null
    : data.nextSourcePaymentAt !== undefined
      ? isoDate(data.nextSourcePaymentAt, 'Kỳ thanh toán nguồn', { nullable: true })
      : scheduleChanged
        ? addYoutubeCalendarMonths(startedAt, paidCycles * cycleMonths)
        : existing.next_source_payment_at;
  const requestedPlan = String(data.planType ?? existing.plan_type).toUpperCase();
  const planType = PLAN_TYPES.has(requestedPlan) ? requestedPlan : existing.plan_type;
  const requestedStatus = String(data.status ?? existing.status).toUpperCase();
  const status = MEMBERSHIP_STATUSES.has(requestedStatus) ? requestedStatus : existing.status;
  const ts = nowIso();
  const updateTransaction = db.transaction(() => {
    db.prepare(`
      UPDATE youtube_memberships
      SET source_id = ?, customer_gmail = ?, customer_name = ?, customer_discord_id = ?,
          related_order_code = ?, plan_type = ?, current_family_label = ?,
          total_months = ?, cycle_months = ?, paid_cycles = ?, sale_price = ?,
          source_cost_per_cycle = ?, started_at = ?, next_source_payment_at = ?,
          customer_expiry_at = ?, reminder_days_before = ?, status = ?, note = ?,
          reminder_stage = NULL, reminder_sent_at = NULL, reminder_for_payment_at = NULL,
          reminder_message_id = NULL, reminder_channel_id = NULL, snoozed_until = NULL,
          updated_at = ?
      WHERE id = ?
    `).run(
      source.id,
      encrypt(gmail),
      clean(data.customerName ?? existing.customer_name, 160) || linkedOrder?.customerName,
      clean(data.customerDiscordId ?? existing.customer_discord_id, 30) || linkedOrder?.discordId,
      relatedOrderCode,
      planType,
      clean(data.currentFamilyLabel ?? existing.current_family_label, 160),
      totalMonths,
      cycleMonths,
      paidCycles,
      money(data.salePrice ?? existing.sale_price),
      money(data.sourceCostPerCycle ?? existing.source_cost_per_cycle),
      startedAt,
      nextSourcePaymentAt,
      customerExpiryAt,
      integer(data.reminderDaysBefore ?? existing.reminder_days_before, 7, 1, 30),
      status,
      clean(data.note ?? existing.note, 1600),
      ts,
      existing.id,
    );
    if (paidCycles !== Number(existing.paid_cycles)) {
      const delta = paidCycles - Number(existing.paid_cycles);
      db.prepare(`
        INSERT INTO youtube_renewal_events (
          membership_id, source_id, event_type, cycle_number, cycles_added,
          months_added, amount_paid, paid_at, family_label,
          previous_next_payment_at, next_payment_at, actor_id, note, created_at
        ) VALUES (?, ?, 'ADJUSTMENT', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        existing.id,
        source.id,
        paidCycles,
        delta,
        delta * cycleMonths,
        ts,
        clean(data.currentFamilyLabel ?? existing.current_family_label, 160),
        existing.next_source_payment_at,
        nextSourcePaymentAt,
        clean(data.actorId, 80) || 'WEB_ADJUSTMENT',
        clean(data.adjustmentNote, 500) || `Điều chỉnh số kỳ đã thanh toán từ ${existing.paid_cycles} thành ${paidCycles}.`,
        ts,
      );
    }
  });
  updateTransaction();
  return getYoutubeMembership(existing.id);
}

export function deleteYoutubeMembership(id) {
  return db.prepare('DELETE FROM youtube_memberships WHERE id = ?').run(Number(id)).changes > 0;
}

export function markYoutubeCyclePaid(id, data = {}) {
  const existing = membershipRow(id);
  if (!existing) return null;
  const progress = calculateYoutubeMembership(existing);
  if (progress.remainingCycles <= 0) throw new Error('Hồ sơ này đã thanh toán đủ toàn bộ số tháng đã bán.');
  if (!['ACTIVE', 'PAUSED'].includes(existing.status)) throw new Error('Hồ sơ đã kết thúc, không thể ghi thêm kỳ thanh toán.');
  const cycles = integer(data.cycles, 1, 1, progress.remainingCycles);
  const newPaidCycles = progress.paidCycles + cycles;
  const nextPaymentAt = newPaidCycles >= progress.totalCycles
    ? null
    : addYoutubeCalendarMonths(
      existing.next_source_payment_at || addYoutubeCalendarMonths(existing.started_at, progress.paidCycles * progress.cycleMonths),
      cycles * progress.cycleMonths,
    );
  const paidAt = isoDate(data.paidAt || nowIso(), 'Thời gian thanh toán');
  const amountPaid = data.amountPaid === undefined
    ? progress.sourceCostPerCycle * cycles
    : money(data.amountPaid);
  const familyLabel = clean(data.familyLabel ?? existing.current_family_label, 160);
  const ts = nowIso();
  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE youtube_memberships
      SET paid_cycles = ?, next_source_payment_at = ?, current_family_label = ?,
          status = 'ACTIVE', reminder_stage = NULL, reminder_sent_at = NULL,
          reminder_for_payment_at = NULL, reminder_message_id = NULL,
          reminder_channel_id = NULL, snoozed_until = NULL, updated_at = ?
      WHERE id = ?
    `).run(newPaidCycles, nextPaymentAt, familyLabel, ts, existing.id);
    db.prepare(`
      INSERT INTO youtube_renewal_events (
        membership_id, source_id, event_type, cycle_number, cycles_added,
        months_added, amount_paid, paid_at, payment_reference, family_label,
        previous_next_payment_at, next_payment_at, actor_id, note, created_at
      ) VALUES (?, ?, 'PAYMENT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      existing.id,
      existing.source_id,
      newPaidCycles,
      cycles,
      Math.min(progress.remainingMonths, cycles * progress.cycleMonths),
      amountPaid,
      paidAt,
      clean(data.paymentReference, 180),
      familyLabel,
      existing.next_source_payment_at,
      nextPaymentAt,
      clean(data.actorId, 80) || 'SYSTEM',
      clean(data.note, 1000),
      ts,
    );
  });
  transaction();
  return getYoutubeMembership(existing.id);
}

export function snoozeYoutubeReminder(id, hours = 24) {
  const existing = membershipRow(id);
  if (!existing) return null;
  const until = new Date(Date.now() + integer(hours, 24, 1, 168) * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE youtube_memberships SET snoozed_until = ?, updated_at = ? WHERE id = ?')
    .run(until, nowIso(), existing.id);
  return getYoutubeMembership(existing.id);
}

export function getYoutubeMembershipsDueForReminder(guildId, limit = 100, now = new Date()) {
  const candidates = listYoutubeMemberships({ guildId, status: 'ACTIVE', includeSecrets: false })
    .filter((membership) => membership.remainingCycles > 0)
    .filter((membership) => membership.nextSourcePaymentAt)
    .filter((membership) => new Date(membership.nextSourcePaymentAt) <= new Date(now.getTime() + membership.reminderDaysBefore * 24 * 60 * 60 * 1000))
    .slice(0, integer(limit, 100, 1, 300));
  return candidates.filter((membership) => {
    const stage = resolveYoutubeReminderStage(membership, now);
    return shouldSendYoutubeReminder(membership, stage, now);
  });
}

export function markYoutubeReminderSent(id, { stage, messageId = null, channelId = null } = {}) {
  const existing = membershipRow(id);
  if (!existing) return null;
  db.prepare(`
    UPDATE youtube_memberships
    SET reminder_stage = ?, reminder_sent_at = ?, reminder_for_payment_at = next_source_payment_at,
        reminder_message_id = ?, reminder_channel_id = ?, updated_at = ?
    WHERE id = ?
  `).run(stage, nowIso(), messageId, channelId, nowIso(), existing.id);
  return getYoutubeMembership(existing.id, { includeSecrets: false, includeHistory: false });
}

export { resolveYoutubeReminderStage };

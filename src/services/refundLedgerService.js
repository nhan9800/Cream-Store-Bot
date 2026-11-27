// Refund ledger: one auditable row per completed (externally paid) refund.
// The ledger is the revenue source of truth for refunds: net revenue =
// money received on orders (by order date) − money refunded (by refund date).
// Rows are never deleted; reopening a refunded order voids its row.

export const MAX_REFUND_FEE_PERCENT = 50;
const DAY_MS = 86_400_000;

// Owner policy (2026-11-28): managers set the fee per order with a reason;
// defaults sit at 40–50% for customer-side reasons. Each reason carries the
// customer-facing explanation shown on the refund breakdown.
export const REFUND_REASONS = Object.freeze({
  CHANGE_OF_MIND: Object.freeze({
    label: 'Khách đổi ý sau khi đã giao/kích hoạt',
    defaultFeePercent: 50,
    explanation: 'Gói đã được kích hoạt riêng trên tài khoản của bạn nên shop không thể thu hồi để bán lại. '
      + 'Phí xử lý bù phần chi phí nguồn shop đã trả cho nhà cung cấp và không được hoàn lại.',
  }),
  SOURCE_COST_SPENT: Object.freeze({
    label: 'Shop đã mua nguồn, nhà cung cấp không hoàn',
    defaultFeePercent: 40,
    explanation: 'Shop đã thanh toán nguồn/kích hoạt cho đơn của bạn và nhà cung cấp không hoàn lại khoản này. '
      + 'Phí xử lý chỉ bù phần chi phí đó; phần thời gian chưa dùng được hoàn lại cho bạn.',
  }),
  PROVIDER_CHANGE: Object.freeze({
    label: 'Nhà cung cấp đổi chính sách/ngừng dịch vụ',
    defaultFeePercent: 30,
    explanation: 'Nhà cung cấp thay đổi chính sách nên dịch vụ không thể tiếp tục ổn định. '
      + 'Shop chia sẻ một phần chi phí nguồn đã chi và hoàn lại toàn bộ thời gian bạn chưa sử dụng.',
  }),
  SHOP_FAULT: Object.freeze({
    label: 'Lỗi từ shop (giao sai/không giao được)',
    defaultFeePercent: 0,
    explanation: 'Lỗi thuộc về shop nên shop không thu phí xử lý; chỉ trừ thời gian bạn đã thực sự sử dụng (nếu có).',
  }),
  OTHER: Object.freeze({
    label: 'Lý do khác (ghi chú bắt buộc)',
    defaultFeePercent: 40,
    explanation: 'Phí xử lý bù chi phí nguồn và thao tác hoàn tiền thủ công của shop.',
  }),
});

export const REFUND_REASON_CODES = Object.freeze(Object.keys(REFUND_REASONS));

export class RefundLedgerError extends Error {}

const instant = (value) => (value ? Date.parse(String(value).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(value)) ? '' : 'Z')) : NaN);
const isoOrNull = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const toInt = (value) => (Number.isSafeInteger(Number(value)) ? Number(value) : null);

export function ensureRefundLedger(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS order_refunds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    customer_id TEXT,
    product_name TEXT,
    paid_amount INTEGER NOT NULL,
    usage_deduction INTEGER NOT NULL DEFAULT 0,
    used_days REAL,
    total_days REAL,
    fee_percent REAL,
    fee_amount INTEGER NOT NULL DEFAULT 0,
    other_deduction INTEGER NOT NULL DEFAULT 0,
    refund_amount INTEGER NOT NULL,
    retained_amount INTEGER NOT NULL,
    reason_code TEXT NOT NULL,
    reason_note TEXT,
    transfer_reference TEXT,
    source TEXT NOT NULL,
    quote_json TEXT,
    ordered_at TEXT,
    refunded_at TEXT NOT NULL,
    actor_id TEXT,
    needs_review INTEGER NOT NULL DEFAULT 0,
    voided_at TEXT,
    voided_by TEXT,
    void_reason TEXT,
    created_at TEXT NOT NULL
  )`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_order_refunds_active
    ON order_refunds(order_code) WHERE voided_at IS NULL`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_order_refunds_refunded_at ON order_refunds(refunded_at)');
}

export function normalizeReason(reasonCode) {
  const code = String(reasonCode || 'OTHER').trim().toUpperCase();
  if (!REFUND_REASONS[code]) throw new RefundLedgerError('Lý do hoàn tiền không hợp lệ.');
  return code;
}

export function normalizeFeePercent(feePercent, reasonCode) {
  const value = feePercent == null ? REFUND_REASONS[reasonCode].defaultFeePercent : Number(feePercent);
  if (!Number.isFinite(value) || value < 0 || value > MAX_REFUND_FEE_PERCENT) {
    throw new RefundLedgerError(`Phí hoàn tiền phải từ 0% đến ${MAX_REFUND_FEE_PERCENT}%.`);
  }
  return Math.round(value * 100) / 100;
}

/**
 * Service window of an order: start at delivery/completion, end at expiry or
 * start + plan duration, cut off when the customer asked for the refund.
 */
export function serviceWindow(order, cutoffAt) {
  const start = instant(order.completed_at) || instant(order.delivered_at);
  if (!Number.isFinite(start)) return { start: null, end: null, cutoff: null, usedMs: 0, totalMs: 0 };
  let end = instant(order.expiry_at);
  if (!Number.isFinite(end) || end <= start) {
    const days = toInt(order.duration_days) || (toInt(order.duration_months) || 1) * 30;
    end = start + days * DAY_MS;
  }
  const cutoffMs = Number.isFinite(instant(cutoffAt)) ? instant(cutoffAt) : Date.now();
  const cutoff = Math.min(Math.max(cutoffMs, start), end);
  return { start, end, cutoff, usedMs: cutoff - start, totalMs: end - start };
}

/**
 * Standard refund quote. Integer VND; deductions round down so the customer is
 * never charged more than the formula. refund = paid − used time − fee − other.
 */
export function quoteStandardRefund(order, { reasonCode, feePercent, otherDeduction = 0, cutoffAt } = {}) {
  const paid = Number(order.amount_paid);
  if (order.payment_status !== 'PAID' || !Number.isSafeInteger(paid) || paid < 1) {
    throw new RefundLedgerError('Đơn chưa có số tiền đã nhận để tính hoàn.');
  }
  const reason = normalizeReason(reasonCode);
  const fee = normalizeFeePercent(feePercent, reason);
  const other = Number(otherDeduction || 0);
  if (!Number.isSafeInteger(other) || other < 0 || other > paid) throw new RefundLedgerError('Khấu trừ khác không hợp lệ.');
  const window = serviceWindow(order, cutoffAt);
  const usageDeduction = window.totalMs > 0 ? Number(BigInt(paid) * BigInt(Math.round(window.usedMs)) / BigInt(Math.round(window.totalMs))) : 0;
  // Deductions never exceed what was paid: fee and other are capped by what is left.
  const feeAmount = Math.min(Math.floor((paid * Math.round(fee * 100)) / 10000), paid - usageDeduction);
  const otherApplied = Math.min(other, paid - usageDeduction - feeAmount);
  const refund = paid - usageDeduction - feeAmount - otherApplied;
  return {
    version: 1,
    paid,
    reasonCode: reason,
    feePercent: fee,
    feeAmount,
    usageDeduction,
    otherDeduction: otherApplied,
    usedDays: window.totalMs ? Math.round((window.usedMs / DAY_MS) * 10) / 10 : 0,
    totalDays: window.totalMs ? Math.round((window.totalMs / DAY_MS) * 10) / 10 : 0,
    start: isoOrNull(window.start),
    end: isoOrNull(window.end),
    cutoff: isoOrNull(window.cutoff),
    refund,
    retained: paid - refund,
  };
}

function refundRequestedAt(db, order) {
  const row = db.prepare(`SELECT created_at FROM order_status_history
    WHERE order_code = ? AND new_status = 'REFUND_PENDING' ORDER BY id DESC LIMIT 1`).get(order.order_code);
  return row?.created_at || (order.status === 'REFUND_PENDING' ? order.status_changed_at : null);
}

export function previewOrderRefund(db, order, options = {}) {
  return quoteStandardRefund(order, { ...options, cutoffAt: options.cutoffAt ?? refundRequestedAt(db, order) });
}

/**
 * Write the ledger row for a refund that has just been recorded as paid out.
 * Must run inside the same transaction that moves the order to REFUNDED.
 * `caseQuote` is the accepted Gemini refund-desk quote when one exists.
 */
export function insertRefundLedgerRow(db, { order, amount, actorId, refundedAt, reasonCode, feePercent,
  transferReference, note, caseQuote = null }) {
  ensureRefundLedger(db);
  const paid = Number(order.amount_paid);
  let reason = normalizeReason(reasonCode ?? (caseQuote ? 'PROVIDER_CHANGE' : 'OTHER'));
  let breakdown;
  let source = 'MANUAL';
  if (caseQuote) {
    source = 'GEMINI_CASE';
    const feeAmount = Number(caseQuote.fee || 0);
    const usage = Number(caseQuote.usageDeduction || 0);
    breakdown = {
      usageDeduction: usage,
      feePercent: caseQuote.feeBps != null ? Number(caseQuote.feeBps) / 100 : null,
      feeAmount,
      usedDays: caseQuote.usedMs != null ? Math.round((caseQuote.usedMs / DAY_MS) * 10) / 10 : null,
      totalDays: caseQuote.totalMs != null ? Math.round((caseQuote.totalMs / DAY_MS) * 10) / 10 : null,
      otherDeduction: paid - usage - feeAmount - amount,
      quote: caseQuote,
    };
  } else {
    const explicitFee = feePercent != null || reasonCode != null;
    const quote = previewOrderRefund(db, order, { reasonCode: reason, feePercent: explicitFee ? feePercent : 0 });
    breakdown = {
      usageDeduction: quote.usageDeduction,
      feePercent: explicitFee ? quote.feePercent : null,
      feeAmount: quote.feeAmount,
      usedDays: quote.usedDays,
      totalDays: quote.totalDays,
      // Difference between the formula and the amount actually paid out:
      // positive = extra deduction, negative = shop paid back more (goodwill).
      otherDeduction: paid - quote.usageDeduction - quote.feeAmount - amount,
      quote,
    };
  }
  if (reason === 'OTHER' && !note && !caseQuote && reasonCode != null) {
    throw new RefundLedgerError('Lý do “khác” cần ghi chú để tra lại sau này.');
  }
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO order_refunds (order_code, guild_id, customer_id, product_name, paid_amount,
      usage_deduction, used_days, total_days, fee_percent, fee_amount, other_deduction, refund_amount,
      retained_amount, reason_code, reason_note, transfer_reference, source, quote_json, ordered_at,
      refunded_at, actor_id, needs_review, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`).run(
    order.order_code, order.guild_id, order.customer_id ?? null, order.product_name ?? null, paid,
    breakdown.usageDeduction, breakdown.usedDays, breakdown.totalDays, breakdown.feePercent,
    breakdown.feeAmount, breakdown.otherDeduction, amount, paid - amount, reason, note || null,
    transferReference || null, source, JSON.stringify(breakdown.quote), order.created_at ?? null,
    refundedAt || now, actorId ?? null, now,
  );
  return getActiveRefund(db, order.order_code);
}

export function voidRefundLedgerRow(db, { orderCode, actorId, reason }) {
  ensureRefundLedger(db);
  const now = new Date().toISOString();
  return db.prepare(`UPDATE order_refunds SET voided_at = ?, voided_by = ?, void_reason = ?
    WHERE order_code = ? AND voided_at IS NULL`).run(now, actorId ?? null, reason ?? null, orderCode).changes;
}

export function getActiveRefund(db, orderCode) {
  ensureRefundLedger(db);
  return db.prepare('SELECT * FROM order_refunds WHERE order_code = ? AND voided_at IS NULL').get(orderCode) ?? null;
}

export function getRefundHistory(db, orderCode) {
  ensureRefundLedger(db);
  return db.prepare('SELECT * FROM order_refunds WHERE order_code = ? ORDER BY id ASC').all(orderCode);
}

/**
 * Bring refunds recorded before the ledger existed (or by other paths) into
 * the ledger. Uses the amount stored on the REFUNDED status change; when no
 * amount was stored the full payment is assumed and the row is flagged for
 * review, so revenue is never overstated.
 */
export function backfillRefundLedger(db) {
  ensureRefundLedger(db);
  const hasHistory = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='order_status_history'").get();
  const missing = db.prepare(`SELECT o.* FROM orders o
    WHERE o.status = 'REFUNDED'
      AND NOT EXISTS (SELECT 1 FROM order_refunds r WHERE r.order_code = o.order_code AND r.voided_at IS NULL)`).all();
  let inserted = 0;
  const insert = db.prepare(`INSERT INTO order_refunds (order_code, guild_id, customer_id, product_name, paid_amount,
      usage_deduction, fee_amount, other_deduction, refund_amount, retained_amount, reason_code, reason_note,
      source, ordered_at, refunded_at, actor_id, needs_review, created_at)
    VALUES (?,?,?,?,?,0,0,?,?,?,'OTHER',?,'BACKFILL',?,?,?,?,?)`);
  for (const order of missing) {
    const event = hasHistory ? db.prepare(`SELECT * FROM order_status_history
      WHERE order_code = ? AND new_status = 'REFUNDED' ORDER BY id DESC LIMIT 1`).get(order.order_code) : null;
    let amount = null;
    try { amount = toInt(JSON.parse(event?.metadata || 'null')?.amount); } catch { amount = null; }
    const paid = Math.max(0, toInt(order.amount_paid) ?? 0);
    const known = amount != null && amount >= 0 && amount <= paid;
    const refund = known ? amount : paid;
    const note = known
      ? `Bổ sung từ lịch sử trạng thái${event?.reason ? ` · ${event.reason}` : ''}`
      : 'Thiếu số tiền hoàn trong lịch sử; tạm tính hoàn toàn bộ, cần đối soát.';
    insert.run(order.order_code, order.guild_id, order.customer_id ?? null, order.product_name ?? null, paid,
      paid - refund, refund, paid - refund, note, order.created_at ?? null,
      event?.created_at || order.status_changed_at || order.updated_at || new Date().toISOString(),
      event?.actor ?? null, known ? 0 : 1, new Date().toISOString());
    inserted += 1;
  }
  return inserted;
}

function rangeClause(column, { from, to } = {}, params) {
  let sql = '';
  if (from) { sql += ` AND datetime(${column}) >= datetime(?)`; params.push(from); }
  if (to) { sql += ` AND datetime(${column}) <= datetime(?)`; params.push(to); }
  return sql;
}

export function getRefundSummary(db, { guildId, from, to } = {}) {
  ensureRefundLedger(db);
  const params = [];
  let where = 'WHERE voided_at IS NULL';
  if (guildId) { where += ' AND guild_id = ?'; params.push(guildId); }
  where += rangeClause('refunded_at', { from, to }, params);
  const totals = db.prepare(`SELECT COUNT(*) AS count,
      COALESCE(SUM(paid_amount),0) AS paid, COALESCE(SUM(refund_amount),0) AS refunded,
      COALESCE(SUM(retained_amount),0) AS retained, COALESCE(SUM(usage_deduction),0) AS usage,
      COALESCE(SUM(fee_amount),0) AS fees, COALESCE(SUM(other_deduction),0) AS other,
      COALESCE(SUM(needs_review),0) AS needsReview
    FROM order_refunds ${where}`).get(...params);
  const byReason = db.prepare(`SELECT reason_code AS reasonCode, COUNT(*) AS count,
      COALESCE(SUM(refund_amount),0) AS refunded, COALESCE(SUM(retained_amount),0) AS retained
    FROM order_refunds ${where} GROUP BY reason_code ORDER BY refunded DESC`).all(...params);
  const byProduct = db.prepare(`SELECT product_name AS productName, COUNT(*) AS count,
      COALESCE(SUM(refund_amount),0) AS refunded, COALESCE(SUM(retained_amount),0) AS retained
    FROM order_refunds ${where} GROUP BY product_name ORDER BY refunded DESC LIMIT 10`).all(...params);
  return { ...totals, byReason, byProduct };
}

/** Gross = received on paid, non-cancelled orders (order date); net = gross − refunds (refund date). */
export function getRevenueSummary(db, { guildId, from, to } = {}) {
  ensureRefundLedger(db);
  const params = [];
  let where = "WHERE payment_status = 'PAID' AND status != 'CANCELLED'";
  if (guildId) { where += ' AND guild_id = ?'; params.push(guildId); }
  where += rangeClause('created_at', { from, to }, params);
  const gross = db.prepare(`SELECT COALESCE(SUM(amount_paid),0) AS gross, COUNT(*) AS paidOrders FROM orders ${where}`).get(...params);
  const refunds = getRefundSummary(db, { guildId, from, to });
  return {
    gross: gross.gross,
    paidOrders: gross.paidOrders,
    refunded: refunds.refunded,
    refundCount: refunds.count,
    retainedFromRefunds: refunds.retained,
    net: gross.gross - refunds.refunded,
  };
}

/** Daily net revenue for the last `days` days (gross by order day, refunds by refund day). */
export function getDailyNetRevenue(db, { days = 30, guildId } = {}) {
  ensureRefundLedger(db);
  const guild = guildId ? ' AND guild_id = ?' : '';
  const args = guildId ? [guildId] : [];
  const gross = db.prepare(`SELECT date(created_at) AS day, COALESCE(SUM(amount_paid),0) AS total FROM orders
    WHERE payment_status = 'PAID' AND status != 'CANCELLED' AND created_at >= datetime('now', ?)${guild}
    GROUP BY date(created_at)`).all(`-${days} days`, ...args);
  const refunds = db.prepare(`SELECT date(refunded_at) AS day, COALESCE(SUM(refund_amount),0) AS total FROM order_refunds
    WHERE voided_at IS NULL AND refunded_at >= datetime('now', ?)${guild}
    GROUP BY date(refunded_at)`).all(`-${days} days`, ...args);
  const map = new Map();
  for (const row of gross) map.set(row.day, { day: row.day, gross: row.total, refunded: 0 });
  for (const row of refunds) {
    const entry = map.get(row.day) ?? { day: row.day, gross: 0, refunded: 0 };
    entry.refunded = row.total;
    map.set(row.day, entry);
  }
  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day))
    .map((entry) => ({ ...entry, total: entry.gross - entry.refunded }));
}

export function listRefunds(db, { guildId, from, to, reasonCode, search, needsReview, includeVoided = false,
  limit = 50, offset = 0 } = {}) {
  ensureRefundLedger(db);
  const params = [];
  let where = includeVoided ? 'WHERE 1=1' : 'WHERE voided_at IS NULL';
  if (guildId) { where += ' AND guild_id = ?'; params.push(guildId); }
  where += rangeClause('refunded_at', { from, to }, params);
  if (reasonCode) { where += ' AND reason_code = ?'; params.push(normalizeReason(reasonCode)); }
  if (needsReview) where += ' AND needs_review = 1';
  if (search) {
    where += ' AND (order_code LIKE ? OR customer_id LIKE ? OR product_name LIKE ? OR transfer_reference LIKE ? OR reason_note LIKE ?)';
    const like = `%${String(search).trim().slice(0, 80)}%`;
    params.push(like, like, like, like, like);
  }
  const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM order_refunds ${where}`).get(...params).c;
  const rows = db.prepare(`SELECT * FROM order_refunds ${where} ORDER BY refunded_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, safeLimit, safeOffset);
  return { total, rows };
}

const vnd = (value) => `${Number(value || 0).toLocaleString('vi-VN')}đ`;

/** Customer-facing breakdown lines (Vietnamese). */
export function describeRefundBreakdown(quote) {
  const reason = REFUND_REASONS[quote.reasonCode] ?? REFUND_REASONS.OTHER;
  const lines = [`Số tiền đã thanh toán: **${vnd(quote.paid)}**`];
  if (quote.usageDeduction > 0) {
    lines.push(`Trừ thời gian đã sử dụng (${quote.usedDays}/${quote.totalDays} ngày): −${vnd(quote.usageDeduction)}`);
  }
  if (quote.feeAmount > 0) lines.push(`Phí xử lý hoàn tiền ${quote.feePercent}%: −${vnd(quote.feeAmount)}`);
  if (quote.otherDeduction > 0) lines.push(`Khấu trừ khác: −${vnd(quote.otherDeduction)}`);
  lines.push(`Số tiền hoàn: **${vnd(quote.refund)}**`);
  return { lines, reasonLabel: reason.label, explanation: reason.explanation };
}

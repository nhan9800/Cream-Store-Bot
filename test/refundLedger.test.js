import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backfillRefundLedger, describeRefundBreakdown, getActiveRefund, getDailyNetRevenue, getRefundHistory,
  getRefundSummary, getRevenueSummary, listRefunds, previewOrderRefund, quoteStandardRefund, REFUND_REASONS,
  voidRefundLedgerRow,
} from '../src/services/refundLedgerService.js';
import { recordPaidOrderRefund } from '../src/services/paidOrderRefundService.js';
import { refundPeriod } from '../src/commands/hoantien.js';

const DAY = 86_400_000;
const base = {
  order_code: 'CN_100001', guild_id: 'shop', customer_id: 'buyer', product_name: 'YouTube Premium 12 Tháng',
  status: 'COMPLETED', payment_status: 'PAID', amount_paid: 300000, total_amount: 300000,
  completed_at: '2026-01-01T00:00:00.000Z', expiry_at: '2026-01-31T00:00:00.000Z', duration_months: 1,
  created_at: '2026-01-01T00:00:00.000Z', status_changed_at: '2026-01-01T00:00:00.000Z',
};

describe('standard refund quote', () => {
  it('deducts used days and the fee, rounding deductions down', () => {
    const quote = quoteStandardRefund(base, { reasonCode: 'CHANGE_OF_MIND', cutoffAt: '2026-01-11T00:00:00.000Z' });
    expect(quote).toMatchObject({ paid: 300000, usageDeduction: 100000, feePercent: 50, feeAmount: 150000,
      refund: 50000, retained: 250000, usedDays: 10, totalDays: 30 });
  });

  it('uses each reason default and lets the manager override within 0–50%', () => {
    const cutoffAt = base.completed_at;
    expect(quoteStandardRefund(base, { reasonCode: 'SOURCE_COST_SPENT', cutoffAt }).feeAmount).toBe(120000);
    expect(quoteStandardRefund(base, { reasonCode: 'PROVIDER_CHANGE', cutoffAt }).feeAmount).toBe(90000);
    expect(quoteStandardRefund(base, { reasonCode: 'SHOP_FAULT', cutoffAt }).refund).toBe(300000);
    expect(quoteStandardRefund(base, { reasonCode: 'OTHER', feePercent: 45, cutoffAt }).feeAmount).toBe(135000);
    expect(() => quoteStandardRefund(base, { reasonCode: 'OTHER', feePercent: 51 })).toThrow(/0% đến 50%/);
    expect(() => quoteStandardRefund(base, { reasonCode: 'NOPE' })).toThrow(/không hợp lệ/);
  });

  it('charges no used time before delivery and falls back to plan length without expiry', () => {
    expect(quoteStandardRefund({ ...base, completed_at: null }, { reasonCode: 'SHOP_FAULT' }).usageDeduction).toBe(0);
    const quote = quoteStandardRefund({ ...base, expiry_at: null, duration_months: 2 },
      { reasonCode: 'SHOP_FAULT', cutoffAt: '2026-01-16T00:00:00.000Z' });
    expect(quote).toMatchObject({ totalDays: 60, usedDays: 15, usageDeduction: 75000 });
  });

  it('rejects unpaid orders and never refunds below zero', () => {
    expect(() => quoteStandardRefund({ ...base, payment_status: 'UNPAID' }, {})).toThrow();
    const late = quoteStandardRefund(base, { reasonCode: 'CHANGE_OF_MIND', cutoffAt: '2026-03-01T00:00:00.000Z' });
    expect(late).toMatchObject({ usageDeduction: 300000, refund: 0 });
  });

  it('explains the breakdown to the customer', () => {
    const quote = quoteStandardRefund(base, { reasonCode: 'SOURCE_COST_SPENT', cutoffAt: '2026-01-11T00:00:00.000Z' });
    const text = describeRefundBreakdown(quote);
    expect(text.lines.join('\n')).toContain('Trừ thời gian đã sử dụng (10/30 ngày)');
    expect(text.lines.join('\n')).toContain('Phí xử lý hoàn tiền 40%');
    expect(text.explanation).toBe(REFUND_REASONS.SOURCE_COST_SPENT.explanation);
  });
});

describe('refund ledger and revenue', () => {
  let db;
  const insertOrder = (order) => db.prepare(`INSERT INTO orders (${Object.keys(order).join(',')})
    VALUES (${Object.keys(order).map(() => '?').join(',')})`).run(...Object.values(order));
  const request = (code = base.order_code) => recordPaidOrderRefund(db, { orderCode: code, guildId: 'shop',
    actorId: 'manager', action: 'REFUND_PENDING' });

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE orders(order_code TEXT PRIMARY KEY, guild_id TEXT, customer_id TEXT, product_name TEXT,
      status TEXT, payment_status TEXT, amount_paid INTEGER, total_amount INTEGER, completed_at TEXT, delivered_at TEXT,
      expiry_at TEXT, duration_months INTEGER, duration_days INTEGER, created_at TEXT, status_changed_at TEXT,
      updated_at TEXT, fulfillment_mode TEXT);
      CREATE TABLE order_fulfillments(order_code TEXT, status TEXT, lease_until TEXT);`);
    insertOrder(base);
  });
  afterEach(() => db.close());

  it('records a refund with its breakdown in the same transaction as REFUNDED', () => {
    db.prepare('UPDATE orders SET completed_at=?, expiry_at=?').run(new Date(Date.now() + 60000).toISOString(),
      new Date(Date.now() + 30 * DAY).toISOString());
    request();
    recordPaidOrderRefund(db, { orderCode: base.order_code, guildId: 'shop', actorId: 'manager', action: 'REFUNDED',
      amount: 60000, reasonCode: 'SOURCE_COST_SPENT', transferReference: 'FT26001', reason: 'Khách đổi gói' });
    const row = getActiveRefund(db, base.order_code);
    expect(row).toMatchObject({ paid_amount: 300000, refund_amount: 60000, retained_amount: 240000, fee_percent: 40,
      fee_amount: 120000, reason_code: 'SOURCE_COST_SPENT', transfer_reference: 'FT26001', reason_note: 'Khách đổi gói',
      source: 'MANUAL', actor_id: 'manager', needs_review: 0 });
    expect(row.usage_deduction + row.fee_amount + row.other_deduction + row.refund_amount).toBe(300000);
    const meta = JSON.parse(db.prepare("SELECT metadata FROM order_status_history WHERE new_status='REFUNDED'").get().metadata);
    expect(meta).toMatchObject({ amount: 60000, reasonCode: 'SOURCE_COST_SPENT', transferReference: 'FT26001' });
  });

  it('keeps the legacy /quanly-don path working without a reason', () => {
    request();
    recordPaidOrderRefund(db, { orderCode: base.order_code, guildId: 'shop', actorId: 'm', action: 'REFUNDED', amount: 300000 });
    expect(getActiveRefund(db, base.order_code)).toMatchObject({ reason_code: 'OTHER', fee_percent: null,
      fee_amount: 0, refund_amount: 300000, retained_amount: 0 });
  });

  it('requires a note for an explicit "other" reason and rolls the status back on error', () => {
    request();
    expect(() => recordPaidOrderRefund(db, { orderCode: base.order_code, guildId: 'shop', actorId: 'm',
      action: 'REFUNDED', amount: 1000, reasonCode: 'OTHER' })).toThrow(/ghi chú/);
    expect(db.prepare('SELECT status FROM orders').get().status).toBe('REFUND_PENDING');
    expect(getActiveRefund(db, base.order_code)).toBeNull();
  });

  it('subtracts refunds from net revenue by refund date and keeps retained money', () => {
    insertOrder({ ...base, order_code: 'CN_100002', amount_paid: 200000, total_amount: 200000 });
    insertOrder({ ...base, order_code: 'CN_100003', status: 'CANCELLED', amount_paid: 50000 });
    request();
    recordPaidOrderRefund(db, { orderCode: base.order_code, guildId: 'shop', actorId: 'm', action: 'REFUNDED',
      amount: 100000, reasonCode: 'CHANGE_OF_MIND' });
    expect(getRevenueSummary(db)).toMatchObject({ gross: 500000, refunded: 100000, net: 400000,
      refundCount: 1, retainedFromRefunds: 200000 });
    // January has the sale; the refund happened now, so January keeps its gross.
    expect(getRevenueSummary(db, { from: '2026-01-01', to: '2026-01-31T23:59:59Z' })).toMatchObject({ gross: 500000, refunded: 0 });
    expect(getRefundSummary(db, { guildId: 'shop' })).toMatchObject({ count: 1, refunded: 100000, retained: 200000 });
    expect(getDailyNetRevenue(db, { days: 3 }).at(-1)).toMatchObject({ refunded: 100000, total: -100000 });
  });

  it('voids the ledger row when an order is reopened and allows a new refund later', () => {
    request();
    recordPaidOrderRefund(db, { orderCode: base.order_code, guildId: 'shop', actorId: 'm', action: 'REFUNDED', amount: 1000 });
    expect(voidRefundLedgerRow(db, { orderCode: base.order_code, actorId: 'm', reason: 'Mở lại' })).toBe(1);
    expect(getActiveRefund(db, base.order_code)).toBeNull();
    expect(getRevenueSummary(db).refunded).toBe(0);
    db.prepare("UPDATE orders SET status='PROCESSING'").run();
    request();
    recordPaidOrderRefund(db, { orderCode: base.order_code, guildId: 'shop', actorId: 'm', action: 'REFUNDED', amount: 2000 });
    expect(getRefundHistory(db, base.order_code).map((row) => [row.refund_amount, Boolean(row.voided_at)]))
      .toEqual([[1000, true], [2000, false]]);
  });

  it('backfills old refunds from status history and flags unknown amounts', () => {
    insertOrder({ ...base, order_code: 'CN_200001', status: 'REFUNDED' });
    insertOrder({ ...base, order_code: 'CN_200002', status: 'REFUNDED', amount_paid: 80000 });
    request();
    db.prepare(`INSERT INTO order_status_history (order_code, old_status, new_status, actor, reason, metadata)
      VALUES ('CN_200001','REFUND_PENDING','REFUNDED','boss','Đã hoàn', '{"amount":120000}')`).run();
    expect(backfillRefundLedger(db)).toBe(2);
    expect(backfillRefundLedger(db)).toBe(0);
    expect(getActiveRefund(db, 'CN_200001')).toMatchObject({ refund_amount: 120000, retained_amount: 180000,
      source: 'BACKFILL', needs_review: 0, actor_id: 'boss' });
    expect(getActiveRefund(db, 'CN_200002')).toMatchObject({ refund_amount: 80000, needs_review: 1 });
    expect(listRefunds(db, { needsReview: true }).rows.map((row) => row.order_code)).toEqual(['CN_200002']);
  });

  it('searches the ledger by order, product or transfer reference', () => {
    request();
    recordPaidOrderRefund(db, { orderCode: base.order_code, guildId: 'shop', actorId: 'm', action: 'REFUNDED',
      amount: 5000, transferReference: 'FT-ABC' });
    expect(listRefunds(db, { search: 'FT-ABC' }).total).toBe(1);
    expect(listRefunds(db, { search: 'YouTube' }).total).toBe(1);
    expect(listRefunds(db, { search: 'Netflix' }).total).toBe(0);
    expect(listRefunds(db, { reasonCode: 'OTHER' }).total).toBe(1);
  });

  it('previews from the refund request time', () => {
    db.prepare("UPDATE orders SET completed_at=?, expiry_at=?").run(
      new Date(Date.now() - 10 * DAY).toISOString(), new Date(Date.now() + 20 * DAY).toISOString());
    request();
    const quote = previewOrderRefund(db, db.prepare('SELECT * FROM orders').get(), { reasonCode: 'SHOP_FAULT' });
    expect(quote.usedDays).toBe(10);
    expect(quote.totalDays).toBe(30);
  });
});

describe('/hoantien periods (Vietnam time)', () => {
  it('starts today and this month at local midnight', () => {
    const now = new Date('2026-11-27T20:00:00.000Z'); // 03:00 on 28/11 in Vietnam
    expect(refundPeriod('today', now).from).toBe('2026-11-27T17:00:00.000Z');
    expect(refundPeriod('month', now).from).toBe('2026-10-31T17:00:00.000Z');
    expect(refundPeriod('last_month', now)).toMatchObject({ from: '2026-09-30T17:00:00.000Z', to: '2026-10-31T16:59:59.999Z' });
    expect(refundPeriod('all', now)).toMatchObject({ from: null, to: null });
  });
});

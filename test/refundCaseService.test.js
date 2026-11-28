import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/utils/emojiHelper.js', () => ({
  createEmojiResolver: () => { const slots = new Map(); return (slot) => { if (!slots.has(slot)) slots.set(slot, String(100000000000000000n + BigInt(slots.size))); return `<:t_${slot}:${slots.get(slot)}>`; }; },
  withButtonEmoji: (button) => button,
}));
import {
  confirmRefundDraft, normalizeHolderName, openStandardRefundCase, readRefundDraft, resolveRefundBank, saveRefundDraft,
} from '../src/services/refundCaseService.js';
import { getRefundCase } from '../src/services/geminiRefundService.js';
import { recordPaidOrderRefund } from '../src/services/paidOrderRefundService.js';
import { getActiveRefund } from '../src/services/refundLedgerService.js';
import { buildRefundOffer, buildRefundOfferReplaced, buildRefundPreview, buildRefundPayoutData } from '../src/services/refundPresentation.js';
import { buildVerifiedRefundVietQR, crc16, parseVietQR } from '../src/utils/refundVietQR.js';

const DAY = 86_400_000;
let db;
const order = () => ({
  order_code: 'CN_654321', guild_id: 'shop', customer_id: 'buyer', product_name: 'Netflix Premium 1 Tháng',
  status: 'COMPLETED', payment_status: 'PAID', amount_paid: 300000, total_amount: 300000,
  completed_at: new Date(Date.now() - 10 * DAY).toISOString(), expiry_at: new Date(Date.now() + 20 * DAY).toISOString(),
  duration_months: 1, created_at: new Date(Date.now() - 10 * DAY).toISOString(), status_changed_at: new Date(Date.now() - 10 * DAY).toISOString(),
});

beforeEach(() => {
  process.env.ENCRYPTION_KEY = 'test-refund-case-key-not-production';
  db = new Database(':memory:');
  db.exec(`CREATE TABLE orders(order_code TEXT PRIMARY KEY, guild_id TEXT, customer_id TEXT, product_name TEXT, status TEXT,
    payment_status TEXT, amount_paid INTEGER, total_amount INTEGER, completed_at TEXT, delivered_at TEXT, expiry_at TEXT,
    duration_months INTEGER, duration_days INTEGER, created_at TEXT, status_changed_at TEXT, updated_at TEXT, fulfillment_mode TEXT);
    CREATE TABLE order_fulfillments(order_code TEXT, status TEXT, lease_until TEXT);`);
  const o = order();
  db.prepare(`INSERT INTO orders (${Object.keys(o).join(',')}) VALUES (${Object.keys(o).map(() => '?').join(',')})`).run(...Object.values(o));
});
afterEach(() => db.close());

const open = (extra = {}) => openStandardRefundCase(db, { orderCode: 'CN_654321', guildId: 'shop', actorId: 'manager',
  reasonCode: 'SOURCE_COST_SPENT', ...extra });
const draft = (row, extra = {}) => saveRefundDraft(db, { id: row.id, customerId: 'buyer', revision: row.quote_revision,
  bankInput: 'Vietcombank', account: '0071 0001 23456', name: 'Nguyễn Văn Á', ...extra });

describe('standard refund case', () => {
  it('opens a case for any paid order, moving it to refund pending with the standard quote', () => {
    const row = open();
    expect(row.active).toBe(true);
    expect(row.quote).toMatchObject({ kind: 'STANDARD', reasonCode: 'SOURCE_COST_SPENT', paid: 300000, feeBps: 4000, fee: 120000 });
    expect(row.quote.usageDeduction).toBeGreaterThan(99000);
    expect(row.quote.refund).toBe(300000 - row.quote.usageDeduction - 120000);
    expect(db.prepare('SELECT status FROM orders').get().status).toBe('REFUND_PENDING');
  });

  it('re-quotes before acceptance and refuses after the customer accepted', () => {
    const first = open();
    const second = open({ feePercent: 20 });
    expect(second.id).toBe(first.id);
    expect(second.quote_revision).toBe(2);
    expect(second.quote.feeBps).toBe(2000);
    const preview = draft(second);
    confirmRefundDraft(db, { id: second.id, customerId: 'buyer', revision: preview.revision });
    expect(() => open({ feePercent: 10 })).toThrow(/đã xác nhận/);
  });

  it('keeps the draft encrypted and unaccepted until the customer confirms the preview', () => {
    const row = open();
    const preview = draft(row);
    expect(preview.draft).toMatchObject({ bankBin: '970436', bankName: 'Vietcombank', account: '007100012345 6'.replace(' ', ''), name: 'NGUYEN VAN A' });
    const stored = getRefundCase(db, row.id);
    expect(stored.stage).toBe('AWAITING_DETAILS');
    expect(stored.accepted_at).toBeNull();
    expect(stored.draft_bank_encrypted).not.toContain('0071000123456');
    expect(readRefundDraft(stored).account).toBe('0071000123456');
    const confirmed = confirmRefundDraft(db, { id: row.id, customerId: 'buyer', revision: row.quote_revision });
    expect(confirmed).toMatchObject({ stage: 'READY_TO_PAY', accepted_quote_revision: row.quote_revision });
    expect(confirmed.draft_bank_encrypted).toBeNull();
  });

  it('rejects other customers, stale revisions, card numbers and unknown banks', () => {
    const row = open();
    expect(() => draft(row, { bankInput: 'Ngân hàng ma' })).toThrow(/Chưa nhận ra ngân hàng/);
    expect(() => draft(row, { account: '4111111111111111' })).toThrow(/số thẻ/);
    expect(() => draft(row, { name: '123' })).toThrow(/Tên chủ tài khoản/);
    expect(() => saveRefundDraft(db, { id: row.id, customerId: 'intruder', revision: 1, bankInput: 'VCB', account: '0071000123456', name: 'A B' })).toThrow();
    draft(row);
    open({ feePercent: 25 });
    expect(() => confirmRefundDraft(db, { id: row.id, customerId: 'buyer', revision: 1 })).toThrow();
  });

  it('expires the preview after 30 minutes', () => {
    const row = open();
    draft(row);
    db.prepare('UPDATE order_refund_cases SET draft_at=?').run(new Date(Date.now() - 31 * 60_000).toISOString());
    expect(() => confirmRefundDraft(db, { id: row.id, customerId: 'buyer', revision: row.quote_revision })).toThrow(/30 phút/);
  });

  it('records the ledger from the accepted case quote with its reason', () => {
    const row = open();
    draft(row);
    const ready = confirmRefundDraft(db, { id: row.id, customerId: 'buyer', revision: row.quote_revision });
    expect(() => recordPaidOrderRefund(db, { orderCode: 'CN_654321', guildId: 'shop', actorId: 'm', action: 'REFUNDED', amount: ready.quote.refund + 1 })).toThrow();
    recordPaidOrderRefund(db, { orderCode: 'CN_654321', guildId: 'shop', actorId: 'm', action: 'REFUNDED', amount: ready.quote.refund, transferReference: 'FT1' });
    expect(getActiveRefund(db, 'CN_654321')).toMatchObject({ source: 'REFUND_CASE', reason_code: 'SOURCE_COST_SPENT', fee_percent: 40,
      fee_amount: 120000, other_deduction: 0, refund_amount: ready.quote.refund, transfer_reference: 'FT1' });
  });

  it('builds the preview and payout from the exact same verified QR payload', async () => {
    const row = open();
    const preview = draft(row);
    const card = await buildRefundPreview(preview);
    const raw = JSON.stringify(card.components.map((c) => c.toJSON()));
    expect(raw).toContain('Vietcombank'); expect(raw).toContain('0071 0001 2345 6'); expect(raw).toContain('NGUYEN VAN A');
    expect(raw).toContain(`refund:confirm:${row.id}:${row.quote_revision}`);
    expect(card.files[0].attachment.subarray(1, 4).toString()).toBe('PNG');
    const ready = confirmRefundDraft(db, { id: row.id, customerId: 'buyer', revision: row.quote_revision });
    const payout = await buildRefundPayoutData(ready);
    expect(payout).toMatchObject({ bankBin: '970436', account: '0071000123456', name: 'NGUYEN VAN A', amount: ready.quote.refund });
    expect(payout.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('re-offer after the customer accepted (2026-11-28)', () => {
  const accept = () => {
    const row = open();
    draft(row);
    return confirmRefundDraft(db, { id: row.id, customerId: 'buyer', revision: row.quote_revision });
  };

  it('requires a customer-facing reason and the not-yet-paid confirmation', () => {
    accept();
    expect(() => open({ feePercent: 45, reoffer: { note: 'Điều chỉnh phí nguồn', notPaid: false } })).toThrow(/CHƯA chuyển/);
    expect(() => open({ feePercent: 45, reoffer: { note: 'ok', notPaid: true } })).toThrow(/lý do điều chỉnh/);
    expect(getRefundCase(db, 'CN_654321').stage).toBe('READY_TO_PAY');
  });

  it('withdraws the accepted quote, clears the bank details and needs a fresh confirmation', () => {
    const ready = accept();
    const row = open({ feePercent: 45, otherItems: [{ label: 'Phí chuyển khoản liên ngân hàng', amount: 5000 }],
      reoffer: { note: 'Nhà cung cấp không hoàn phí kích hoạt', notPaid: true } });
    expect(row).toMatchObject({ stage: 'AWAITING_DETAILS', accepted_at: null, bank_encrypted: null, quote_revision: 2 });
    expect(row.quote.reoffer).toMatchObject({ previousRefund: ready.quote.refund, previousRevision: 1, wasAccepted: true,
      note: 'Nhà cung cấp không hoàn phí kích hoạt' });
    expect(row.quote.otherItems).toEqual([{ label: 'Phí chuyển khoản liên ngân hàng', amount: 5000 }]);
    expect(row.quote.refund).toBe(300000 - row.quote.usageDeduction - 135000 - 5000);
    expect(db.prepare('SELECT revision, state FROM order_refund_quote_history ORDER BY revision').all())
      .toEqual([{ revision: 1, state: 'WITHDRAWN' }, { revision: 2, state: 'OFFERED' }]);
    expect(() => saveRefundDraft(db, { id: row.id, customerId: 'buyer', revision: 1, bankInput: 'VCB', account: '0071000123456', name: 'A B C' })).toThrow();
    const preview = draft(row);
    const again = confirmRefundDraft(db, { id: row.id, customerId: 'buyer', revision: preview.revision });
    expect(again).toMatchObject({ stage: 'READY_TO_PAY', accepted_quote_revision: 2 });
    recordPaidOrderRefund(db, { orderCode: 'CN_654321', guildId: 'shop', actorId: 'm', action: 'REFUNDED', amount: again.quote.refund });
    expect(getActiveRefund(db, 'CN_654321')).toMatchObject({ source: 'REFUND_CASE', fee_percent: 45, other_deduction: 5000,
      refund_amount: again.quote.refund });
  });

  it('shows the customer why the quote changed and every named cost, with distinct emoji', () => {
    accept();
    const row = open({ feePercent: 45, otherDeduction: 2000, otherItems: [{ label: 'Phí chuyển khoản', amount: 5000 }, { label: 'Phí bảo hành đã dùng', amount: 10000 }],
      reoffer: { note: 'Shop tính thiếu phí bảo hành đã dùng', notPaid: true } });
    const offer = buildRefundOffer(row, { mentionCustomer: true });
    const raw = JSON.stringify(offer.components.map((c) => c.toJSON()));
    for (const text of ['Shop đã điều chỉnh bảng tính', 'Shop tính thiếu phí bảo hành đã dùng', 'đã được hủy', 'Chi phí khác',
      '- Phí chuyển khoản', '- Phí bảo hành đã dùng', '- Khấu trừ khác']) expect(raw).toContain(text);
    expect(raw).toContain(`refund:bank:${row.id}:2`);
    const ids = [...raw.matchAll(/<:[\w]+:(\d+)>/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    const old = JSON.stringify(buildRefundOfferReplaced(row, { ...row.quote.reoffer, url: 'https://discord.com/channels/1/2/3' }).components.map((c) => c.toJSON()));
    expect(old).toContain('đã được thay thế');
    expect(old).not.toContain('refund:bank');
  });

  it('rejects unnamed amounts below 1đ and more than three named costs', () => {
    expect(() => open({ otherItems: [{ label: 'Phí', amount: 0 }] })).toThrow(/lớn hơn 0/);
    expect(() => open({ otherItems: [1, 2, 3, 4].map((n) => ({ label: `Phí ${n}`, amount: 1000 })) })).toThrow(/Tối đa 3/);
  });
});

describe('VietQR accuracy', () => {
  it('round-trips every field and rejects tampering', () => {
    const payload = buildVerifiedRefundVietQR({ bankBin: '970422', account: '00123456789', amount: 123456, orderCode: 'CN_000001' });
    expect(parseVietQR(payload)).toMatchObject({ version: '01', method: '12', guid: 'A000000727', service: 'QRIBFTTA',
      bankBin: '970422', account: '00123456789', currency: '704', amount: 123456, country: 'VN', purpose: 'HOAN CN000001' });
    expect(() => parseVietQR(payload.replace('123456', '123457'))).toThrow(/CRC/);
  });
  it('uses the CRC-16/CCITT-FALSE checksum required by EMVCo', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
  it('normalizes names and resolves common bank spellings without guessing', () => {
    expect(normalizeHolderName('  Trần   Thị Đào ')).toBe('TRAN THI DAO');
    expect(resolveRefundBank('MB Bank').bin).toBe('970422');
    expect(resolveRefundBank('techcombank').bin).toBe('970407');
    expect(resolveRefundBank('ngan hang')).toBeNull();
  });
});

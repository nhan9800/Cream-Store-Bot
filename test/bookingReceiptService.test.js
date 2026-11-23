import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBookingLedger } from '../src/services/bookingLedgerService.js';
import { bookingReceiptPreview, createBookingReceiptService } from '../src/services/bookingReceiptService.js';
import { STORE_ONE_GUILD_ID, STORE_TWO_GUILD_ID as guildId } from '../src/utils/locale.js';

const customerId = '1500000000000000001';
const managerId = '1500000000000000002';
const hostId = '1500000000000000003';
const startsAt = Date.parse('2026-11-24T08:00:00Z');
const channelFor = id => String(1500000000000000100n + BigInt(id));
const siteAccount = 'local-test-only-1234';
let db, ledger, receipt, now;

function addBooking(ticketId, { hourlyPrice = 90_000, time = startsAt } = {}) {
  db.prepare(`INSERT INTO tickets VALUES (?, ?, ?, ?, 'BOOKING', 'OPEN')`)
    .run(ticketId, guildId, customerId, channelFor(ticketId));
  ledger.createSession({ guildId, ticketId, service: 'voice', startsAt: time, durationMinutes: 60 });
  ledger.assignHost({ guildId, ticketId, hostId, actorId: managerId });
  return ledger.createInvoice({
    guildId, ticketId, actorId: managerId, hourlyPrice, hourlyWage: 0,
    createPaymentOrder: ({ amount }) => {
      const { lastInsertRowid } = db.prepare(`INSERT INTO orders (order_code, guild_id, ticket_id, ticket_channel_id,
        customer_id, total_amount, amount_paid, payment_provider, payment_status, status, payos_order_code)
        VALUES (?, ?, ?, ?, ?, ?, 0, 'PAYOS', 'UNPAID', 'PENDING_PAYMENT', ?)`)
        .run(`CN_${1000 + ticketId}`, guildId, ticketId, channelFor(ticketId), customerId, amount, 1000 + ticketId);
      return { id: Number(lastInsertRowid) };
    },
  });
}

function commitVerifiedPayment(invoice, { amount = invoice.amount, link = 'booking-test-link' } = {}) {
  const transactionId = `test-transaction-${invoice.id}`;
  db.prepare(`UPDATE orders SET payment_link_id = ?, paid_transaction_id = ?, amount_paid = ?,
    status = 'PROCESSING', payment_status = 'PAID' WHERE id = ?`).run(link, transactionId, amount, invoice.order_id);
  db.prepare(`INSERT INTO payment_events (order_code, provider, transaction_id, amount, raw_payload)
    VALUES (?, 'PAYOS', ?, ?, ?)`).run(invoice.order_code, transactionId, amount, JSON.stringify({
    orderCode: invoice.provider_order_code, paymentLinkId: link, amount, accountNumber: siteAccount,
  }));
  return ledger.syncInvoicePayment(guildId, invoice.id);
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE tickets (id INTEGER PRIMARY KEY, guild_id TEXT, customer_id TEXT, channel_id TEXT, ticket_type TEXT, status TEXT);
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_code TEXT UNIQUE, guild_id TEXT,
      ticket_id INTEGER REFERENCES tickets(id), ticket_channel_id TEXT, customer_id TEXT, total_amount INTEGER,
      amount_paid INTEGER, payment_provider TEXT, payment_status TEXT, status TEXT, payos_order_code INTEGER UNIQUE,
      payment_link_id TEXT, paid_transaction_id TEXT);
    CREATE TABLE payment_events (id INTEGER PRIMARY KEY AUTOINCREMENT, order_code TEXT, provider TEXT,
      transaction_id TEXT, amount INTEGER, raw_payload TEXT, UNIQUE(provider, transaction_id));
  `);
  now = startsAt - 600_000;
  ledger = createBookingLedger(db, { now: () => now });
  receipt = createBookingReceiptService(db, { now: () => now });
});
afterEach(() => db.close());

const get = (ticketId, options = {}) => receipt.getForTicket({ guildId, ticketId, viewerId: customerId, ...options });

describe('Cenar Booking receipt evidence', () => {
  it('projects only an authorized ticket and never follows IDs to other stores or invoices', () => {
    const first = addBooking(1);
    const second = addBooking(2, { time: startsAt + 3_600_000 });
    expect(get(1)).toMatchObject({ kind: 'BOOKING', status: 'PENDING', code: 'CN_1001', amount: 90_000,
      paidAt: null, service: 'voice', startsAt, durationMinutes: 60, paymentMethod: 'PayOS' });
    expect(get(1, { invoiceId: second.id })).toBeNull();
    expect(get(1, { invoiceId: first.id })?.code).toBe('CN_1001');
    expect(get(1, { viewerId: hostId })).toBeNull();
    expect(get(1, { viewerId: managerId, canManage: 'true' })).toBeNull();
    expect(get(1, { viewerId: managerId, canManage: true })?.code).toBe('CN_1001');
    expect(get(1, { guildId: STORE_ONE_GUILD_ID, canManage: true })).toBeNull();
    db.prepare(`UPDATE tickets SET channel_id = ? WHERE id = 1`).run(channelFor(3));
    expect(get(1, { canManage: true })).toBeNull();
  });

  it('uses the latest extension unless a specific invoice was requested', () => {
    const original = addBooking(1, { hourlyPrice: 0 });
    const extension = ledger.extendSession({ guildId, ticketId: 1, actorId: managerId, requestKey: channelFor(20),
      durationMinutes: 30, hourlyPrice: 0, hourlyWage: 0 });
    expect(get(1)).toMatchObject({ code: `BK-${extension.id}`, description: 'Gia hạn phiên Cenar Booking', status: 'FREE',
      amount: 0, startsAt: null, durationMinutes: 30 });
    expect(get(1, { invoiceId: original.id })).toMatchObject({ status: 'FREE', amount: 0, startsAt, durationMinutes: 60 });
  });

  it('reads a verified payment without including provider payload, link, reference, or private IDs', () => {
    const invoice = addBooking(1);
    expect(commitVerifiedPayment(invoice).status).toBe('PAID');
    const result = get(1);
    expect(result).toMatchObject({ status: 'PAID', amount: invoice.amount, issuedAt: now, paidAt: now });
    expect(JSON.stringify(result)).not.toMatch(/test-transaction|booking-test-link|local-test-only|150000000/);
    db.prepare(`UPDATE orders SET status = 'REFUNDED' WHERE id = ?`).run(invoice.order_id);
    expect(get(1)).toMatchObject({ status: 'NEEDS_REVIEW', paidAt: null });
  });

  it('requires evidence independently of booking and order status markers', () => {
    const invoice = addBooking(1);
    db.prepare(`UPDATE booking_invoices SET status = 'PAID', paid_at = ? WHERE id = ?`).run(now, invoice.id);
    db.prepare(`UPDATE orders SET status = 'PROCESSING', payment_status = 'PAID', amount_paid = ? WHERE id = ?`)
      .run(invoice.amount, invoice.order_id);
    expect(get(1)).toMatchObject({ status: 'NEEDS_REVIEW', paidAt: null });
  });

  it('rechecks link identity, receipt source and exact amount without mutating the invoice', () => {
    const invoice = addBooking(1);
    expect(commitVerifiedPayment(invoice).status).toBe('PAID');
    db.prepare(`UPDATE payment_events SET raw_payload = ? WHERE order_code = ?`)
      .run(JSON.stringify({ orderCode: invoice.provider_order_code, paymentLinkId: 'different-link', amount: invoice.amount }), invoice.order_code);
    expect(get(1)).toMatchObject({ status: 'NEEDS_REVIEW', paidAt: null });
    db.prepare(`UPDATE payment_events SET provider = 'MANUAL' WHERE order_code = ?`).run(invoice.order_code);
    expect(get(1)).toMatchObject({ status: 'NEEDS_REVIEW', paidAt: null });
    expect(ledger.listInvoices(guildId, 1)[0].status).toBe('PAID');
  });

  it('keeps overpayments under review and stops offering an expired unpaid invoice', () => {
    const invoice = addBooking(1);
    expect(commitVerifiedPayment(invoice, { amount: invoice.amount + 10 }).status).toBe('NEEDS_REVIEW');
    expect(get(1)).toMatchObject({ status: 'NEEDS_REVIEW', paidAt: null });
    addBooking(2, { time: startsAt + 3_600_000 });
    now = startsAt + 7_200_000;
    expect(get(2)).toMatchObject({ status: 'EXPIRED', paidAt: null });
  });

  it('offers presentation-only examples for all four kinds and rejects unknown kinds', () => {
    for (const kind of ['BOOKING', 'DEPOSIT', 'DONATION', 'REFUND']) {
      expect(bookingReceiptPreview(kind)).toMatchObject({ kind, code: expect.stringMatching(/^MAU-/u), status: 'PREVIEW',
        preview: true, issuedAt: null, paidAt: null });
      expect(bookingReceiptPreview(kind)).not.toHaveProperty('payment');
    }
    expect(bookingReceiptPreview('OTHER')).toBeNull();
  });
});

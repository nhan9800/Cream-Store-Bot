import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBookingLedger } from '../src/services/bookingLedgerService.js';
import { STORE_ONE_GUILD_ID, STORE_TWO_GUILD_ID as guildId } from '../src/utils/locale.js';

const actorId = '1139187282075721768';
const customerId = '1514604954034114560';
const hostId = '1514604950892576840';
const anotherHost = '1514621056915214446';
const MINUTE = 60_000;
const start = Date.parse('2026-11-24T07:00:00Z');

let db;
let ledger;
let clock;
let orderSequence;

function booking(ticketId, { startsAt = start, durationMinutes = 60, ticketType = 'BOOKING', store = guildId } = {}) {
  db.prepare(`INSERT INTO tickets(id, guild_id, customer_id, channel_id, ticket_type, status)
    VALUES (?, ?, ?, ?, ?, 'OPEN')`).run(ticketId, store, customerId, `15146049509925768${ticketId}`, ticketType);
  return ledger.createSession({ guildId: store, ticketId, service: 'game', startsAt, durationMinutes });
}

function assign(ticketId, id = hostId) {
  return ledger.assignHost({ guildId, ticketId, actorId, hostId: id });
}

function createPaymentOrder({ guildId, ticketId, ticketChannelId, customerId, amount }) {
  const providerCode = 650001 + orderSequence++;
  const { lastInsertRowid } = db.prepare(`INSERT INTO orders (order_code, payos_order_code, guild_id, ticket_id,
    ticket_channel_id, customer_id, total_amount, amount_paid, payment_provider, payment_status, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'PAYOS', 'UNPAID', 'PENDING_PAYMENT')`)
    .run(`CN_${providerCode}`, providerCode, guildId, ticketId, ticketChannelId, customerId, amount);
  return { id: Number(lastInsertRowid) };
}

function quote(ticketId, options = {}) {
  return ledger.createInvoice({ guildId, ticketId, actorId, hourlyPrice: 100_000, hourlyWage: 75_000,
    createPaymentOrder, ...options });
}

function extend(ticketId, options = {}) {
  return ledger.extendSession({ guildId, ticketId, actorId, durationMinutes: 30, hourlyPrice: 100_000,
    hourlyWage: 75_000, requestKey: '1514604950992576811', createPaymentOrder, ...options });
}

// Fixtures simulate what the provider verification path has already committed.
function commitReceipt(invoice, { provider = 'PAYOS', amount = invoice.amount, orderCode = invoice.provider_order_code,
  linkId = 'link_1', artifact = { orderCode, paymentLinkId: linkId, amount }, transactionId = 'receipt-42' } = {}) {
  db.prepare(`UPDATE orders SET payment_link_id = ?, paid_transaction_id = ?, amount_paid = ?, status = 'PROCESSING',
    payment_status = 'PAID' WHERE id = ?`).run(linkId, transactionId, amount, invoice.order_id);
  db.prepare(`INSERT INTO payment_events(order_code, provider, transaction_id, amount, raw_payload)
    VALUES (?, ?, ?, ?, ?)`).run(invoice.order_code, provider, transactionId, amount, JSON.stringify(artifact));
}

beforeEach(() => {
  clock = start - 60 * MINUTE;
  orderSequence = 0;
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE tickets (id INTEGER PRIMARY KEY, guild_id TEXT, customer_id TEXT, channel_id TEXT,
      ticket_type TEXT, status TEXT);
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_code TEXT UNIQUE, guild_id TEXT,
      ticket_id INTEGER REFERENCES tickets(id), ticket_channel_id TEXT, customer_id TEXT, total_amount INTEGER,
      amount_paid INTEGER, payment_provider TEXT, payment_status TEXT, status TEXT, payos_order_code INTEGER UNIQUE,
      payment_link_id TEXT, paid_transaction_id TEXT);
    CREATE TABLE payment_events (id INTEGER PRIMARY KEY AUTOINCREMENT, order_code TEXT, provider TEXT,
      transaction_id TEXT, amount INTEGER, raw_payload TEXT, UNIQUE(provider, transaction_id));
  `);
  ledger = createBookingLedger(db, { now: () => clock });
});

afterEach(() => db.close());

describe('Store2 booking sessions and billing', () => {
  it('persists the request and host assignment and never claims the same host twice for overlapping slots', () => {
    booking(1);
    booking(2, { startsAt: start + 30 * MINUTE });
    booking(3, { startsAt: start + 60 * MINUTE });
    expect(assign(1)).toMatchObject({ status: 'CONFIRMED', host_id: hostId, customer_id: customerId });
    expect(() => assign(2)).toThrow(expect.objectContaining({ code: 'HOST_UNAVAILABLE' }));
    expect(assign(2, anotherHost).host_id).toBe(anotherHost);
    expect(assign(3).status).toBe('CONFIRMED');

    const reopened = createBookingLedger(db, { now: () => clock });
    expect(reopened.getSession(guildId, 1)).toMatchObject({ starts_at: start, ends_at: start + 60 * MINUTE, host_id: hostId });
    expect(reopened.listSessions(guildId, { status: 'CONFIRMED', dueBefore: start + 30 * MINUTE, startAscending: true })
      .map(row => row.ticket_id)).toEqual([1, 2]);
  });

  it('rejects other stores, non-booking tickets, and draft tickets without authorization', () => {
    expect(() => booking(1, { store: STORE_ONE_GUILD_ID })).toThrow(expect.objectContaining({ code: 'WRONG_STORE' }));
    expect(() => booking(2, { ticketType: 'ORDER' })).toThrow(expect.objectContaining({ code: 'TICKET_CLOSED' }));
    booking(3);
    expect(() => quote(3)).toThrow(expect.objectContaining({ code: 'INVALID_BOOKING_STATUS' }));
    db.prepare("UPDATE tickets SET status = 'CLOSED' WHERE id = 3").run();
    expect(() => assign(3)).toThrow(expect.objectContaining({ code: 'TICKET_CLOSED' }));
  });

  it('freezes booked price and binds a dedicated unpaid order once in the same transaction', () => {
    booking(1, { durationMinutes: 31 });
    assign(1);
    const create = vi.fn(createPaymentOrder);
    const first = quote(1, { createPaymentOrder: create });
    expect(first).toMatchObject({ status: 'PENDING', minutes: 31, amount: 51_667, wage: 38_750, order_code: 'CN_650001' });
    expect(quote(1, { createPaymentOrder: create })).toEqual(first);
    expect(create).toHaveBeenCalledTimes(1);
    expect(() => quote(1, { hourlyPrice: 100_005 })).toThrow(expect.objectContaining({ code: 'QUOTE_CONFLICT' }));
    expect(() => assign(1, anotherHost)).toThrow(expect.objectContaining({ code: 'QUOTED_HOST' }));
    expect(() => ledger.declineSession({ guildId, ticketId: 1, actorId })).toThrow(expect.objectContaining({ code: 'INVOICE_EXISTS' }));
  });

  it('rolls back invalid order bindings and refuses payment until a provider is configured', () => {
    booking(1);
    assign(1);
    expect(() => quote(1, { createPaymentOrder: undefined })).toThrow(expect.objectContaining({ code: 'PAYMENT_NOT_CONFIGURED' }));
    expect(() => quote(1, { createPaymentOrder: info => createPaymentOrder({ ...info, amount: info.amount - 1 }) }))
      .toThrow(expect.objectContaining({ code: 'INVALID_PAYMENT_ORDER' }));
    expect(ledger.listInvoices(guildId, 1)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count).toBe(0);
    const prior = createPaymentOrder({ guildId, ticketId: 1, customerId, amount: 100_000,
      ticketChannelId: ledger.getSession(guildId, 1).ticket_channel_id });
    expect(() => quote(1, { createPaymentOrder: () => prior })).toThrow(expect.objectContaining({ code: 'INVALID_PAYMENT_ORDER' }));
    expect(ledger.listInvoices(guildId, 1)).toEqual([]);
  });

  it.each([
    ['manual approval', { provider: 'MANUAL' }],
    ['underpayment', { amount: 99_999 }],
    ['overpayment', { amount: 100_001 }],
    ['wrong order code', { orderCode: 650002 }],
    ['wrong payment link', { artifact: { orderCode: 650001, paymentLinkId: 'wrong', amount: 100_000 } }],
    ['invoice amount only', { artifact: { orderCode: 650001, id: 'link_1', invoiceAmount: 100_000, amount: 100_000 } }],
  ])('keeps a booking pending after %s', (_, receipt) => {
    booking(1);
    assign(1);
    const invoice = quote(1);
    commitReceipt(invoice, receipt);
    clock = start;
    expect(ledger.syncInvoicePayment(guildId, invoice.id).status).toBe('PENDING');
    expect(() => ledger.startSession({ guildId, ticketId: 1, actorId })).toThrow(expect.objectContaining({ code: 'INVOICE_NOT_SETTLED' }));
  });

  it('releases a paid booking only after a matching bank receipt and settles prorated earnings on completion', () => {
    booking(1);
    assign(1);
    const invoice = quote(1);
    commitReceipt(invoice, { artifact: { orderCode: invoice.provider_order_code, id: 'link_1', amountPaid: 100_000,
      invoiceAmount: 100_000 } });
    const confirmed = ledger.syncInvoicePayment(guildId, invoice.id);
    expect(confirmed).toMatchObject({ status: 'PAID', payment_event_id: 1 });
    expect(ledger.syncInvoicePayment(guildId, invoice.id)).toEqual(confirmed);
    expect(() => ledger.startSession({ guildId, ticketId: 1, actorId })).toThrow(expect.objectContaining({ code: 'OUTSIDE_BOOKING_WINDOW' }));
    clock = start;
    expect(ledger.startSession({ guildId, ticketId: 1, actorId })).toMatchObject({ status: 'ACTIVE', started_at: start });

    const extra = extend(1);
    expect(extend(1)).toEqual(extra);
    expect(ledger.getSession(guildId, 1).duration_minutes).toBe(60);
    commitReceipt(extra, { linkId: 'link_2', transactionId: 'receipt-43' });
    expect(ledger.syncInvoicePayment(guildId, extra.id).status).toBe('PAID');
    expect(ledger.syncInvoicePayment(guildId, extra.id).status).toBe('PAID');
    expect(ledger.getSession(guildId, 1).duration_minutes).toBe(90);

    clock = start + 60 * MINUTE;
    expect(() => ledger.completeSession({ guildId, ticketId: 1, actorId, onlyIfDue: true }))
      .toThrow(expect.objectContaining({ code: 'SESSION_NOT_DUE' }));
    db.prepare("UPDATE tickets SET status = 'CLOSED' WHERE id = 1").run();
    clock = start + 90 * MINUTE;
    const completed = ledger.completeSession({ guildId, ticketId: 1, actorId, onlyIfDue: true });
    expect(completed.status).toBe('COMPLETED');
    expect(ledger.completeSession({ guildId, ticketId: 1, actorId })).toEqual(completed);
    const wages = { sessions: 1, minutes: 90, revenue: 150_000, wage: 112_500 };
    expect(ledger.getPayrollReport(guildId)).toEqual({ hosts: [{ host_id: hostId, ...wages }], totals: wages });
    expect(ledger.getWages(guildId, { hostId, to: clock })).toEqual([]);
    db.prepare("UPDATE orders SET status = 'REFUNDED' WHERE id = ?").run(extra.order_id);
    expect(ledger.getPayrollReport(guildId).totals).toEqual({ sessions: 1, minutes: 60, revenue: 100_000, wage: 75_000 });
  });

  it('preserves the reserved end so a late voice poll does not overlap back-to-back sessions', () => {
    booking(1);
    booking(2, { startsAt: start + 60 * MINUTE });
    assign(1);
    assign(2);
    quote(1, { hourlyPrice: 0, hourlyWage: 0, createPaymentOrder: undefined });
    clock = start + 28_000;
    expect(ledger.startSession({ guildId, ticketId: 1, actorId }))
      .toMatchObject({ status: 'ACTIVE', started_at: clock, ends_at: start + 60 * MINUTE });
  });

  it('reserves the host through a pending extension but sends late payment for review', () => {
    booking(1);
    assign(1);
    expect(quote(1, { hourlyPrice: 0, hourlyWage: 0, createPaymentOrder: undefined }).status).toBe('FREE');
    clock = start;
    ledger.startSession({ guildId, ticketId: 1, actorId });
    const extra = extend(1);
    booking(2, { startsAt: start + 70 * MINUTE });
    expect(() => assign(2)).toThrow(expect.objectContaining({ code: 'HOST_UNAVAILABLE' }));

    clock = start + 60 * MINUTE;
    ledger.completeSession({ guildId, ticketId: 1, actorId, onlyIfDue: true });
    commitReceipt(extra);
    expect(ledger.syncInvoicePayment(guildId, extra.id)).toMatchObject({ status: 'NEEDS_REVIEW', payment_event_id: 1 });
    expect(ledger.getSession(guildId, 1).duration_minutes).toBe(60);
    expect(assign(2).status).toBe('CONFIRMED');
    expect(ledger.getPayrollReport(guildId).totals).toEqual({ sessions: 1, minutes: 60, revenue: 0, wage: 0 });
  });

  it('refuses completion for a paid invoice subsequently refunded through the canonical order', () => {
    booking(1);
    assign(1);
    const invoice = quote(1);
    commitReceipt(invoice);
    ledger.syncInvoicePayment(guildId, invoice.id);
    clock = start;
    ledger.startSession({ guildId, ticketId: 1, actorId });
    db.prepare("UPDATE orders SET status = 'REFUNDED' WHERE id = ?").run(invoice.order_id);
    clock = start + 60 * MINUTE;
    expect(() => ledger.completeSession({ guildId, ticketId: 1, actorId, onlyIfDue: true }))
      .toThrow(expect.objectContaining({ code: 'INVOICE_NOT_SETTLED' }));
    expect(ledger.getWages(guildId)).toEqual([]);
  });
});

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBookingLedger, getBookingInvoiceForOrder } from '../src/services/bookingLedgerService.js';
import { createBookingProfileService } from '../src/services/bookingProfileService.js';
import { BOOKING_AUTO_PAYMENT_HOLD_MS, createBookingSelfService } from '../src/services/bookingSelfService.js';
import { STORE_ONE_GUILD_ID, STORE_TWO_GUILD_ID as guildId } from '../src/utils/locale.js';

const actorId = '1139187282075721768';
const hostId = '1514621056915214446';
const otherHostId = '1514621056915214447';
const customerId = '1514604954034114560';
const otherCustomer = '1514604954034114561';
const requestId = '1514604950992576891';
const anotherRequest = '1514604950992576892';
const minute = 60_000;
const start = Date.parse('2026-11-24T07:00:00Z');
let db, selfService, ledger, profiles, time;

function ticket(id, customer = customerId, ticketType = 'BOOKING') {
  db.prepare(`INSERT INTO tickets(id,guild_id,customer_id,channel_id,ticket_type,status)
    VALUES (?,?,?,?,?,'OPEN')`).run(id, guildId, customer, `15146049509925768${id}`, ticketType);
}

function slot(options = {}) {
  return selfService.addSlot({ guildId, hostId, service: 'game', durationMinutes: 30, startsAt: start,
    hourlyPrice: 0, hourlyWage: 0, actorId, ...options });
}

function reserve(slotId, options = {}) {
  return selfService.reserveSlot({ guildId, slotId, ticketId: 1, customerId, requestId, ...options });
}

function orderFactory({ guildId, ticketId, ticketChannelId, customerId, amount }) {
  const code = db.prepare('SELECT COALESCE(MAX(id),0)+650001 AS value FROM orders').get().value;
  return { id: Number(db.prepare(`INSERT INTO orders
    (order_code,payos_order_code,guild_id,ticket_id,ticket_channel_id,customer_id,total_amount,amount_paid,
    payment_provider,payment_status,status)
    VALUES (?,?,?,?,?,?,?,0,'PAYOS','UNPAID','PENDING_PAYMENT')`)
    .run(`CN_${code}`, code, guildId, ticketId, ticketChannelId, customerId, amount).lastInsertRowid) };
}

function commitReceipt(invoice) {
  const paymentLinkId = `link_${invoice.id}`;
  const transactionId = `bank_${invoice.id}`;
  db.prepare(`UPDATE orders SET payment_link_id=?, paid_transaction_id=?, amount_paid=?, payment_status='PAID', status='PROCESSING'
    WHERE id=?`).run(paymentLinkId, transactionId, invoice.amount, invoice.order_id);
  db.prepare(`INSERT INTO payment_events (order_code,provider,transaction_id,amount,raw_payload) VALUES (?,'PAYOS',?,?,?)`)
    .run(invoice.order_code, transactionId, invoice.amount,
      JSON.stringify({ paymentLinkId, orderCode: invoice.provider_order_code, amount: invoice.amount }));
}

function approve(host, forum, service = 'both') {
  const { draft_revision: revision } = profiles.saveDraft(host, { name: 'Host Cenar', tagline: 'Chơi cùng bạn',
    games: 'Valorant', availability: 'Theo lịch', consent: true, service });
  profiles.approve(host, revision);
  if (forum) profiles.setHostThread(host, forum);
}

beforeEach(() => {
  time = start - 60 * minute;
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE tickets (id INTEGER PRIMARY KEY,guild_id TEXT,customer_id TEXT,channel_id TEXT,ticket_type TEXT,status TEXT);
    CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT,order_code TEXT UNIQUE,guild_id TEXT,ticket_id INTEGER REFERENCES tickets(id),
      ticket_channel_id TEXT,customer_id TEXT,total_amount INTEGER,amount_paid INTEGER,payment_provider TEXT,payment_status TEXT,
      status TEXT,payos_order_code INTEGER UNIQUE,payment_link_id TEXT,paid_transaction_id TEXT);
    CREATE TABLE payment_events (id INTEGER PRIMARY KEY AUTOINCREMENT,order_code TEXT,provider TEXT,transaction_id TEXT,amount INTEGER,
      raw_payload TEXT, UNIQUE(provider,transaction_id));`);
  ledger = createBookingLedger(db, { now: () => time });
  selfService = createBookingSelfService(db, { ledger, now: () => time });
  profiles = createBookingProfileService(db);
  approve(hostId, '1514604954034114565');
  approve(otherHostId, '1514604954034114566');
  ticket(1);
});
afterEach(() => db.close());

describe('Store2 opt-in automatic reservations', () => {
  it('requires explicit published hosts and full VND rates, and omits a host after withdrawal', () => {
    const pending = '1514604954034114563';
    approve(pending);
    expect(() => slot({ hostId: pending })).toThrow(expect.objectContaining({ code: 'BOOKING_AUTO_HOST_NOT_PUBLISHED' }));
    expect(() => slot({ guildId: STORE_ONE_GUILD_ID })).toThrow(expect.objectContaining({ code: 'WRONG_STORE' }));
    expect(() => slot({ hourlyPrice: undefined })).toThrow(expect.objectContaining({ code: 'INVALID_RATE' }));
    expect(() => slot({ hourlyPrice: 15.1 })).toThrow(expect.objectContaining({ code: 'INVALID_RATE' }));
    expect(() => slot({ hourlyPrice: 2000, hourlyWage: 3100 })).toThrow(expect.objectContaining({ code: 'INVALID_RATE' }));
    expect(() => slot({ startsAt: time })).toThrow(expect.objectContaining({ code: 'BOOKING_AUTO_INVALID_SLOT' }));
    expect(selfService.listSlots({ guildId, customerId })).toEqual([]);

    const offer = slot({ hourlyPrice: 101_001, hourlyWage: 45000 });
    expect(offer).toMatchObject({ service: 'game', hostId, hostName: 'Host Cenar', amount: 50_501 });
    expect(offer).not.toHaveProperty('hourlyWage');
    expect(() => slot()).toThrow(expect.objectContaining({ code: 'BOOKING_AUTO_SLOT_EXISTS' }));
    expect(selfService.listSlots({ guildId, customerId })).toEqual([]);
    expect(selfService.listSlots({ guildId, customerId, paymentAvailable: true })).toEqual([offer]);
    expect(() => selfService.quoteSlot({ guildId, slotId: offer.id, customerId })).toThrow(expect.objectContaining({ code: 'BOOKING_PAYMENTS_DISABLED' }));
    expect(() => reserve(offer.id, { createPaymentOrder: orderFactory })).toThrow(expect.objectContaining({ code: 'BOOKING_PAYMENTS_DISABLED' }));
    profiles.hide(hostId);
    expect(selfService.listSlots({ guildId, customerId, paymentAvailable: true })).toEqual([]);
    expect(() => reserve(offer.id, { paymentAvailable: true, createPaymentOrder: orderFactory })).toThrow(expect.objectContaining({ code: 'BOOKING_AUTO_SLOT_UNAVAILABLE' }));
    expect(ledger.getSession(guildId, 1)).toBeNull();
  });

  it('atomically books a free offer for the correct owner and replays without placing another invoice', () => {
    const offer = slot();
    const order = vi.fn(orderFactory);
    const first = reserve(offer.id, { createPaymentOrder: order });
    expect(first).toMatchObject({ slot: offer, invoice: { amount: 0, status: 'FREE' },
      session: { ticket_id: 1, customer_id: customerId, host_id: hostId, starts_at: start, status: 'CONFIRMED' },
      checkoutExpiresAt: null, replayed: false });
    expect(order).not.toHaveBeenCalled();
    const restarted = createBookingSelfService(db, { now: () => time });
    expect(restarted.reserveSlot({ guildId, slotId: offer.id, ticketId: 1, customerId, requestId }))
      .toEqual({ ...first, replayed: true });
    expect(restarted.getReservation({ guildId, ticketId: 1, customerId: otherCustomer })).toBeNull();
    ticket(2, otherCustomer);
    expect(() => reserve(offer.id, { ticketId: 2, customerId: otherCustomer })).toThrow(expect.objectContaining({ code: 'BOOKING_AUTO_REPLAY_CONFLICT' }));
    expect(() => reserve(offer.id, { ticketId: 2, customerId, requestId: anotherRequest })).toThrow(expect.objectContaining({ code: 'BOOKING_AUTO_INVALID_TICKET' }));
    expect(() => reserve(offer.id, { ticketId: 2, customerId: otherCustomer, requestId: anotherRequest })).toThrow(expect.objectContaining({ code: 'BOOKING_AUTO_SLOT_BUSY' }));
    expect(ledger.listInvoices(guildId, 1)).toHaveLength(1);
    time = start;
    expect(ledger.startSession({ guildId, ticketId: 1, actorId }).status).toBe('ACTIVE');
  });

  it('blocks both customer and host overlaps, including staff-assigned sessions, and accepts adjacent slots', () => {
    const occupied = slot();
    const matching = slot({ hostId: otherHostId, startsAt: start + minute });
    const adjacent = slot({ startsAt: start + 30 * minute });
    ticket(2, otherCustomer);
    ticket(3, customerId);
    ledger.createSession({ guildId, ticketId: 2, service: 'voice', startsAt: start, durationMinutes: 30 });
    ledger.assignHost({ guildId, ticketId: 2, hostId, actorId });
    expect(() => reserve(occupied.id)).toThrow(expect.objectContaining({ code: 'BOOKING_AUTO_SLOT_BUSY' }));
    expect(() => reserve(matching.id, { ticketId: 2, customerId: otherCustomer })).toThrow(expect.objectContaining({ code: 'BOOKING_EXISTS' }));
    expect(selfService.listSlots({ guildId, customerId: otherCustomer })).toEqual([adjacent]);
    expect(selfService.listSlots({ guildId, customerId })).toEqual([matching, adjacent]);
    reserve(adjacent.id);
    const collidesWithCustomer = slot({ hostId: otherHostId, startsAt: adjacent.startsAt });
    expect(() => reserve(collidesWithCustomer.id, { ticketId: 3, requestId: anotherRequest })).toThrow(expect.objectContaining({ code: 'BOOKING_AUTO_SLOT_BUSY' }));
    expect(ledger.getSession(guildId, 3)).toBeNull();
  });

  it('keeps a session and price snapshot after staff closes and replaces its public slot', () => {
    const offer = slot();
    const first = reserve(offer.id);
    expect(selfService.closeSlot({ guildId, slotId: offer.id, actorId })).toBe(true);
    expect(selfService.closeSlot({ guildId, slotId: offer.id, actorId })).toBe(false);
    const replacement = slot({ hourlyPrice: 50_000 });
    expect(replacement.id).not.toBe(offer.id);
    expect(selfService.getReservation({ guildId, ticketId: 1, customerId })).toEqual({ ...first, replayed: true });
    expect(() => selfService.quoteSlot({ guildId, slotId: offer.id, customerId: otherCustomer }))
      .toThrow(expect.objectContaining({ code: 'BOOKING_AUTO_SLOT_UNAVAILABLE' }));
  });

  it('rolls the entire booking back when a paid order cannot be bound to the canonical invoice', () => {
    const offer = slot({ hourlyPrice: 90_000, hourlyWage: 60_000, durationMinutes: 31 });
    const wrongOrder = input => orderFactory({ ...input, amount: input.amount + 1 });
    expect(() => reserve(offer.id, { paymentAvailable: true, createPaymentOrder: wrongOrder }))
      .toThrow(expect.objectContaining({ code: 'INVALID_PAYMENT_ORDER' }));
    expect(ledger.getSession(guildId, 1)).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count).toBe(0);
    const paid = reserve(offer.id, { paymentAvailable: true, createPaymentOrder: orderFactory });
    expect(paid.invoice).toMatchObject({ status: 'PENDING', amount: 46_500, wage: 31_000 });
    expect(paid.checkoutExpiresAt).toBe(time + BOOKING_AUTO_PAYMENT_HOLD_MS);
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(paid.invoice.order_id);
    expect(getBookingInvoiceForOrder(db, order)).toMatchObject({ checkout_expires_at: paid.checkoutExpiresAt });
    time = paid.checkoutExpiresAt - 1;
    expect(ledger.syncInvoicePayment(guildId, paid.invoice.id).status).toBe('PENDING');
    commitReceipt(paid.invoice);
    expect(ledger.syncInvoicePayment(guildId, paid.invoice.id).status).toBe('PAID');
    time = start;
    expect(ledger.startSession({ guildId, ticketId: 1, actorId }).status).toBe('ACTIVE');
  });

  it('releases expired checkout holds for auto and manual schedules while sending late verified receipts to review', () => {
    const offer = slot({ hourlyPrice: 80_000, hourlyWage: 50_000 });
    const paid = reserve(offer.id, { paymentAvailable: true, createPaymentOrder: orderFactory });
    ticket(2, otherCustomer);
    time = paid.checkoutExpiresAt;
    expect(selfService.listSlots({ guildId, customerId: otherCustomer, paymentAvailable: true })).toEqual([offer]);
    ledger.createSession({ guildId, ticketId: 2, service: 'voice', startsAt: start, durationMinutes: 30 });
    expect(ledger.assignHost({ guildId, ticketId: 2, hostId, actorId })).toMatchObject({ status: 'CONFIRMED' });
    commitReceipt(paid.invoice);
    expect(ledger.syncInvoicePayment(guildId, paid.invoice.id).status).toBe('NEEDS_REVIEW');
    time = start;
    expect(() => ledger.startSession({ guildId, ticketId: 1, actorId })).toThrow(expect.objectContaining({ code: 'INVOICE_NOT_SETTLED' }));
  });
});

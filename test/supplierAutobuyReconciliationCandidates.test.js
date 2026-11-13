import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const databasePath = vi.hoisted(() => {
  const value = `./data/test-supplier-reconciliation-candidates-${process.pid}-${Date.now()}.sqlite`;
  Object.assign(process.env, { ENV_FILE: '.env.supplier-reconciliation-candidates-test-absent', DATABASE_PATH: value,
    PAYOS_CLIENT_ID: 'fixture-client', PAYOS_API_KEY: 'fixture-api', PAYOS_CHECKSUM_KEY: 'fixture-checksum',
    PUBLIC_BASE_URL: 'https://bot.example' });
  return value;
});
import { db, initDatabase } from '../src/database/db.js';
import { createOrder, getOrderByCode } from '../src/services/orderService.js';
import { createTicket } from '../src/services/ticketService.js';
import { reconcileRecentPayOSPayments } from '../src/services/paymentService.js';

const guildId = '1282637033340403754', customerId = '1138315103821889566';
let sequence = 0;
function fixture({ mode = 'SUPPLIER', method, link = null, paid = false } = {}) {
  const ticket = createTicket({ guildId, channelId: `supplier-reconciliation-${++sequence}`, customerId,
    openedById: customerId, ticketType: 'ORDER' });
  const order = createOrder({ orderCode: `CN_${980000 + sequence}`, guildId, customerId, ticketId: ticket.id,
    ticketChannelId: ticket.channel_id, productName: '[AutoBuy] Fixture', totalAmount: 61000, quantity: 1,
    durationMonths: 1, orderLogChannelId: 'fixture-log', createdById: customerId });
  db.prepare(`UPDATE orders SET fulfillment_mode=?,payment_provider='PAYOS',payment_link_id=?,
    payment_status=?,status=?,amount_paid=? WHERE order_code=?`).run(mode, link,
    paid ? 'PAID' : 'UNPAID', paid ? 'PROCESSING' : 'PENDING_PAYMENT', paid ? order.total_amount : 0, order.order_code);
  if (method !== undefined) db.prepare('INSERT INTO supplier_autobuy_payment_methods VALUES (?,?,?)')
    .run(order.order_code, method, new Date().toISOString());
  return getOrderByCode(order.order_code);
}
function pendingLookup(order) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code: '00', data: {
    id: order.payment_link_id || 'recovered-link', orderCode: order.payos_order_code,
    status: 'PENDING', amount: order.total_amount,
  } }));
}
function expectUnchanged(order) {
  expect(getOrderByCode(order.order_code)).toEqual(order);
  expect(db.prepare('SELECT COUNT(*) AS n FROM payment_events').get().n).toBe(0);
}

beforeAll(() => initDatabase());
beforeEach(() => {
  db.exec(`DELETE FROM staff_logs; DELETE FROM payment_events; DELETE FROM orders;
    DROP TABLE IF EXISTS supplier_autobuy_payment_methods;
    CREATE TABLE supplier_autobuy_payment_methods(order_code TEXT PRIMARY KEY,method TEXT,created_at TEXT);`);
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.resolve(databasePath) + suffix, { force: true });
});

describe('supplier candidates for general PayOS reconciliation', () => {
  it.each([undefined, 'WALLET'])('skips an unlinked supplier order with no PayOS reservation (%s)', async method => {
    const order = fixture({ method });
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request'));
    expect(order.payos_order_code).toBeGreaterThan(0);
    expect(await reconcileRecentPayOSPayments({})).toEqual({ scanned: 0, synced: 0, repairedNotifications: 0, failed: [] });
    expect(fetch).not.toHaveBeenCalled();
    expectUnchanged(order);
  });

  it('retains numeric fallback for a PAYOS claim whose create-link receipt was lost', async () => {
    const order = fixture({ method: 'PAYOS' }), fetch = pendingLookup(order);
    expect(await reconcileRecentPayOSPayments({})).toMatchObject({ scanned: 1, failed: [] });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`https://api-merchant.payos.vn/v2/payment-requests/${order.payos_order_code}`,
      expect.objectContaining({ method: 'GET' }));
    expectUnchanged(order);
    expect(db.prepare('SELECT method FROM supplier_autobuy_payment_methods WHERE order_code=?').get(order.order_code).method).toBe('PAYOS');
  });

  it('retains an uncertain PAYOS reservation and original identity when lookup reports not found', async () => {
    const order = fixture({ method: 'PAYOS' });
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code: 'not-found-fixture', desc: 'Mã thanh toán không tồn tại' }));
    expect(await reconcileRecentPayOSPayments({})).toEqual({ scanned: 1, synced: 0, repairedNotifications: 0,
      failed: [{ orderCode: order.order_code, error: 'Mã thanh toán không tồn tại' }] });
    expect(fetch).toHaveBeenCalledOnce();
    expectUnchanged(order);
    expect(db.prepare('SELECT method FROM supplier_autobuy_payment_methods WHERE order_code=?').get(order.order_code).method).toBe('PAYOS');
  });

  it('retains lookup of a saved supplier link even when its old method claim is absent', async () => {
    const order = fixture({ link: 'saved-provider-link' }), fetch = pendingLookup(order);
    expect(await reconcileRecentPayOSPayments({})).toMatchObject({ scanned: 1, failed: [] });
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://api-merchant.payos.vn/v2/payment-requests/saved-provider-link',
      expect.objectContaining({ method: 'GET' }));
    expectUnchanged(order);
  });

  it.each([undefined, 'WALLET'])('preserves unlinked legacy order reconciliation regardless of supplier method data (%s)', async method => {
    const order = fixture({ mode: 'LEGACY', method }), fetch = pendingLookup(order);
    expect(await reconcileRecentPayOSPayments({})).toMatchObject({ scanned: 1, failed: [] });
    expect(fetch).toHaveBeenCalledOnce();
    expectUnchanged(order);
  });

  it('retains old supplier behavior when the authoritative method table is absent', async () => {
    const order = fixture(), fetch = pendingLookup(order);
    db.exec('DROP TABLE supplier_autobuy_payment_methods');
    expect(await reconcileRecentPayOSPayments({})).toMatchObject({ scanned: 1, failed: [] });
    expect(fetch).toHaveBeenCalledOnce();
    expectUnchanged(order);
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name='supplier_autobuy_payment_methods'").get()).toBeUndefined();
  });

  it('retains old supplier behavior when the method schema is incomplete', async () => {
    const order = fixture(), fetch = pendingLookup(order);
    db.exec('DROP TABLE supplier_autobuy_payment_methods; CREATE TABLE supplier_autobuy_payment_methods(order_code TEXT PRIMARY KEY)');
    expect(await reconcileRecentPayOSPayments({})).toMatchObject({ scanned: 1, failed: [] });
    expect(fetch).toHaveBeenCalledOnce();
    expectUnchanged(order);
  });

  it.each([null, 'UNKNOWN'])('keeps an unrecognized durable method reservation conservatively (%s)', async method => {
    const order = fixture({ method }), fetch = pendingLookup(order);
    expect(await reconcileRecentPayOSPayments({})).toMatchObject({ scanned: 1, failed: [] });
    expect(fetch).toHaveBeenCalledOnce(); expectUnchanged(order);
  });

  it('keeps paid supplier notification-repair candidates even with no method claim or link', async () => {
    const order = fixture({ paid: true }), fetch = pendingLookup(order);
    expect(await reconcileRecentPayOSPayments({})).toMatchObject({ scanned: 1, failed: [] });
    expect(fetch).toHaveBeenCalledOnce(); expectUnchanged(order);
  });

  it('filters pre-invoice supplier orders before the limit so they do not starve an actual invoice', async () => {
    const uninvoiced = [fixture(), fixture({ method: 'WALLET' })];
    const actual = fixture({ method: 'PAYOS' }), fetch = pendingLookup(actual);
    expect(await reconcileRecentPayOSPayments({}, { limit: 1 })).toMatchObject({ scanned: 1, failed: [] });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`https://api-merchant.payos.vn/v2/payment-requests/${actual.payos_order_code}`,
      expect.objectContaining({ method: 'GET' }));
    for (const order of [...uninvoiced, actual]) expectUnchanged(order);
  });
});

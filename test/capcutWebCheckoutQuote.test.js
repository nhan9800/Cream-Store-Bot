import fs from 'node:fs';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(process.env, {
  ENV_FILE: '.env.capcut-web-test-absent', DATABASE_PATH: `./data/test-capcut-web-${process.pid}-${Date.now()}.sqlite`,
  BOT_API_KEY: 'capcut-local-test-api-key', WEB_CHECKOUT_ENABLED: 'true', GUILD_ID: '1282637033340403754', PAYMENT_PROVIDER: 'VIETQR',
}));
const payosLink = vi.hoisted(() => vi.fn());
vi.mock('../src/services/paymentService.js', async original => ({ ...await original(), createOrLoadPayOSLink: payosLink }));
import { db, initDatabase } from '../src/database/db.js';
import { config } from '../src/config.js';
import { registerBotApiRoutes } from '../src/services/botApiRoutes.js';
import { getEditableCapcutProducts, updateCapcutPrice } from '../src/services/capcutPricingService.js';
import { addWalletBalance, getWalletBalance } from '../src/services/walletService.js';
import { getOrderByCode } from '../src/services/orderService.js';

const customerId = '1555555555555555555';
let server, endpoint, sequence = 0, product;
const nextId = () => `capcut_checkout_quote_${++sequence}`;
async function request({ expectedPrice, requestId = nextId(), provider = 'WALLET', quantity = 1 } = {}) {
  const response = await fetch(endpoint, { method: 'POST', headers: {
    'content-type': 'application/json', 'x-bot-api-key': process.env.BOT_API_KEY,
    'x-discord-id': customerId, 'x-user-id': 'capcut-web-user', 'x-user-role': 'member', 'x-idempotency-key': requestId,
  }, body: JSON.stringify({ items: [{ id: String(product.id), quantity, expected_price: expectedPrice }],
    paymentProvider: provider, contact: 'local fixture customer' }) });
  return { status: response.status, body: await response.json() };
}
const paymentCount = () => db.prepare("SELECT COUNT(*) AS count FROM wallet_transactions WHERE type='PAYMENT'").get().count;
const orderCount = () => db.prepare('SELECT COUNT(*) AS count FROM orders').get().count;

beforeAll(async () => {
  initDatabase();
  db.prepare("INSERT INTO web_users (id,email,discord_id,role) VALUES ('capcut-web-user','capcut-fixture@example.com',?,'member')").run(customerId);
  const app = express(); app.use(express.json()); registerBotApiRoutes(app);
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  endpoint = `http://127.0.0.1:${server.address().port}/api/bot/web-orders`;
});
beforeEach(() => {
  config.paymentProvider = 'VIETQR'; payosLink.mockReset();
  db.exec(`DELETE FROM order_delivery_items; DELETE FROM order_fulfillments; DELETE FROM payment_events;
    DELETE FROM checkout_requests; DELETE FROM wallet_transactions; DELETE FROM staff_logs; DELETE FROM orders;
    DELETE FROM tickets; DELETE FROM customer_profiles; DELETE FROM system_settings WHERE key LIKE 'capcut:price:%';`);
  initDatabase(); product = getEditableCapcutProducts()[0];
  addWalletBalance(process.env.GUILD_ID, customerId, 500000, 'TOPUP', 'local test credit', nextId());
});
afterAll(async () => {
  await new Promise(resolve => server.close(resolve)); db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${process.env.DATABASE_PATH}${suffix}`, { force: true });
});

describe('CapCut website quote confirmation and original-invoice retries', () => {
  it.each(['PAYMENT_RECONCILIATION_REQUIRED', 'PAYMENT_IDENTITY_MISMATCH', 'KNOWN_LINK_TIMEOUT', 'PAID_DURING_REQUEST', 'CANCELLED_DURING_REQUEST'])('does not replace a guarded PayOS invoice with bank QR (%s)', async reason => {
    config.paymentProvider = 'PAYOS';
    payosLink.mockImplementation(async order => {
      if (reason === 'KNOWN_LINK_TIMEOUT') db.prepare("UPDATE orders SET payment_link_id='original-link',payment_checkout_url=NULL WHERE order_code=?").run(order.order_code);
      if (reason === 'PAID_DURING_REQUEST') db.prepare("UPDATE orders SET status='PROCESSING',payment_status='PAID',amount_paid=total_amount WHERE order_code=?").run(order.order_code);
      if (reason === 'CANCELLED_DURING_REQUEST') db.prepare("UPDATE orders SET status='CANCELLED' WHERE order_code=?").run(order.order_code);
      throw Object.assign(new Error('private-provider-message'), { code: reason });
    });
    const result = await request({ expectedPrice: 100000, provider: 'PAYOS' });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ ok: false, code: reason === 'PAYMENT_IDENTITY_MISMATCH' ? reason : 'PAYMENT_RECONCILIATION_REQUIRED' });
    expect(JSON.stringify(result.body)).not.toMatch(/private-provider|img\.vietqr|payment_qr|checkout_url/);
    expect(orderCount()).toBe(1); expect(paymentCount()).toBe(0);
    const saved = db.prepare('SELECT * FROM orders').get();
    if (reason === 'KNOWN_LINK_TIMEOUT') expect(saved.payment_link_id).toBe('original-link');
    expect(saved.payment_qr_code).toBeNull();
  });
  it.each([undefined, null, '100000', -1, 100000.5, 90000])('rejects missing, malformed or stale new-order quotes without order/debit (%s)', async expectedPrice => {
    const result = await request({ expectedPrice });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ ok: false, code: 'CAPCUT_PRICE_CHANGED', current_price: 100000, product_id: product.id });
    expect(orderCount()).toBe(0); expect(paymentCount()).toBe(0);
    expect(getWalletBalance(process.env.GUILD_ID, customerId)).toBe(500000);
  });

  it('requires an explicit new confirmation at the changed price before one wallet debit', async () => {
    updateCapcutPrice(product.id, '120000', 100000, customerId);
    expect((await request({ expectedPrice: 100000 })).status).toBe(409);
    const confirmed = await request({ expectedPrice: 120000 });
    expect(confirmed.status).toBe(200); expect(confirmed.body.data.total_amount).toBe(120000);
    expect(orderCount()).toBe(1); expect(paymentCount()).toBe(1);
    expect(getWalletBalance(process.env.GUILD_ID, customerId)).toBe(380000);
  });

  it('returns the original paid snapshot after a price edit, even without a new quote; no second charge', async () => {
    const requestId = nextId();
    const first = await request({ expectedPrice: 100000, requestId });
    expect(first.status).toBe(200);
    updateCapcutPrice(product.id, '120000', 100000, customerId);
    const replay = await request({ requestId });
    expect(replay.status).toBe(200);
    expect(replay.body.data).toMatchObject({ order_code: first.body.data.order_code, total_amount: 100000, reused: true });
    expect(getOrderByCode(first.body.data.order_code)).toMatchObject({ total_amount: 100000, payment_status: 'PAID' });
    expect(orderCount()).toBe(1); expect(paymentCount()).toBe(1);
    expect(getWalletBalance(process.env.GUILD_ID, customerId)).toBe(400000);
    expect((await request({ requestId, expectedPrice: 120000, quantity: 2 })).body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(paymentCount()).toBe(1);
  });

  it('reuses a pending QR invoice at its original amount after a price edit', async () => {
    const requestId = nextId();
    const first = await request({ expectedPrice: 100000, requestId, provider: 'VIETQR' });
    updateCapcutPrice(product.id, '120000', 100000, customerId);
    const replay = await request({ requestId, provider: 'VIETQR' });
    expect(replay.status).toBe(200);
    expect(replay.body.data).toMatchObject({ order_code: first.body.data.order_code, total_amount: 100000, reused: true });
    expect(getOrderByCode(first.body.data.order_code)).toMatchObject({ total_amount: 100000, payment_status: 'UNPAID' });
    expect(orderCount()).toBe(1); expect(paymentCount()).toBe(0);
  });

  it('rechecks after async work if the catalog changes after the initial product lookup', async () => {
    const originalPrepare = db.prepare.bind(db);
    let changed = false;
    const spy = vi.spyOn(db, 'prepare').mockImplementation(sql => {
      const statement = originalPrepare(sql);
      if (!changed && sql.includes('SELECT id, name, price, duration_months, product_key')) {
        return { get: (...args) => {
          const result = statement.get(...args);
          changed = true;
          queueMicrotask(() => originalPrepare('UPDATE product_catalog SET price=130000 WHERE id=?').run(product.id));
          return result;
        } };
      }
      return statement;
    });
    try {
      const result = await request({ expectedPrice: 100000 });
      expect(result.status).toBe(409); expect(result.body.current_price).toBe(130000);
      expect(orderCount()).toBe(0); expect(paymentCount()).toBe(0);
      expect(getWalletBalance(process.env.GUILD_ID, customerId)).toBe(500000);
    } finally { spy.mockRestore(); }
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testDatabasePath = vi.hoisted(() => {
  const relativePath = `./data/test-ai-fulfillment-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.test-ai-fulfillment-not-present';
  process.env.DATABASE_PATH = relativePath;
  process.env.ENCRYPTION_KEY = 'test-ai-fulfillment-key';
  return relativePath;
});

import { db, initDatabase, nowIso, seedProductCatalog } from '../src/database/db.js';
import { encrypt, decrypt } from '../src/utils/crypto.js';
import { createOrder, getOrderByCode, recordOrderPayment } from '../src/services/orderService.js';
import { createTicket } from '../src/services/ticketService.js';
import { deliverPaidOrder } from '../src/services/autoDeliveryService.js';

let sequence = 0;
const KBH_KEY = 'chatgpt-pro-100-account-1-month-no-warranty';
const BHF_KEY = 'chatgpt-pro-100-account-1-month-full-warranty';
const OWN_KEY = 'chatgpt-pro-100-own-account-1-month-package-warranty';

function product(key) {
  return db.prepare('SELECT * FROM product_catalog WHERE product_key = ?').get(key);
}

function paidOrder(item, quantity = 1) {
  sequence += 1;
  const customerId = 'test-ai-customer';
  const ticket = createTicket({ guildId: 'WEB', channelId: `ai-fulfillment-${sequence}`, customerId, openedById: customerId, ticketType: 'ORDER' });
  const order = createOrder({
    orderCode: `CN_${925000 + sequence}`,
    guildId: 'WEB', ticketId: ticket.id, ticketChannelId: ticket.channel_id,
    customerId, productName: item.name, serviceType: item.service_type,
    quantity, totalAmount: item.price * quantity, durationMonths: 1,
    orderLogChannelId: 'test-ai-log', createdById: customerId,
  });
  recordOrderPayment({ orderCode: order.order_code, provider: 'MANUAL', transactionId: `ai-payment-${sequence}`, amount: order.total_amount, content: order.order_code, rawPayload: { amount: order.total_amount } });
  return getOrderByCode(order.order_code);
}

function stock(serviceType, label) {
  return db.prepare(`INSERT INTO account_stock (service_type, credentials, status, created_at)
    VALUES (?, ?, 'AVAILABLE', ?)`).run(serviceType.toLowerCase(), encrypt(`${label}@example.com|test-password|profile|1234`), nowIso()).lastInsertRowid;
}

function deliveryClient() {
  const send = vi.fn().mockResolvedValue({ id: `ai-delivery-message-${sequence}` });
  const client = { users: { fetch: vi.fn().mockResolvedValue({ createDM: vi.fn().mockResolvedValue({ id: 'ai-test-dm', send }) }) } };
  return { client, send };
}

function fulfillment(orderCode) {
  return db.prepare('SELECT status, last_error FROM order_fulfillments WHERE order_code = ?').get(orderCode);
}

beforeAll(() => initDatabase());
beforeEach(() => {
  db.exec(`DELETE FROM order_delivery_items; DELETE FROM order_fulfillments;
    DELETE FROM payment_events; DELETE FROM account_stock; DELETE FROM orders;`);
  seedProductCatalog(db);
});
afterAll(() => {
  db.close();
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${path.resolve(process.cwd(), testDatabasePath)}${suffix}`, { force: true });
});

describe('AI fulfillment respects the purchased SKU and activation method', () => {
  it('does not consume generic AI stock or a different warranty tier, then delivers the exact supplied SKU', async () => {
    const kbh = product(KBH_KEY);
    const order = paidOrder(kbh);
    const genericId = stock('ai', 'generic');
    const otherTierId = stock(product(BHF_KEY).name, 'bhf');
    const { client, send } = deliveryClient();

    expect(await deliverPaidOrder(client, order.order_code)).toEqual({ delivered: false });
    expect(fulfillment(order.order_code)).toEqual({ status: 'WAITING_STOCK', last_error: 'INSUFFICIENT_STOCK' });
    expect(client.users.fetch).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) AS count FROM account_stock WHERE status = 'AVAILABLE'").get().count).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS count FROM order_delivery_items').get().count).toBe(0);
    expect(getOrderByCode(order.order_code)).toMatchObject({ payment_status: 'PAID', status: 'PROCESSING', amount_paid: 1900000 });

    const correctId = stock(kbh.name, 'correct-kbh');
    db.prepare('UPDATE order_fulfillments SET retry_at = ? WHERE order_code = ?').run(nowIso(), order.order_code);
    expect((await deliverPaidOrder(client, order.order_code)).delivered).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(decrypt(getOrderByCode(order.order_code).credential_email)).toBe('correct-kbh@example.com');
    expect(db.prepare('SELECT stock_id FROM order_delivery_items WHERE order_code = ?').get(order.order_code).stock_id).toBe(correctId);
    for (const id of [genericId, otherTierId]) expect(db.prepare('SELECT status FROM account_stock WHERE id = ?').get(id).status).toBe('AVAILABLE');
  });

  it('routes own-account upgrades to staff even when exact SKU credentials are in stock', async () => {
    const own = product(OWN_KEY);
    const order = paidOrder(own);
    stock(own.name, 'must-not-send');
    stock('ai', 'generic-must-not-send');
    const { client, send } = deliveryClient();
    expect(await deliverPaidOrder(client, order.order_code)).toEqual({ delivered: false });
    expect(fulfillment(order.order_code)).toEqual({ status: 'BLOCKED', last_error: 'MANUAL_FULFILLMENT_REQUIRED' });
    expect(getOrderByCode(order.order_code)).toMatchObject({ payment_status: 'PAID', status: 'PROCESSING', delivered_at: null, completed_at: null });
    expect(send).not.toHaveBeenCalled();
    expect(client.users.fetch).not.toHaveBeenCalled();
    expect(db.prepare("SELECT COUNT(*) AS count FROM account_stock WHERE status = 'AVAILABLE'").get().count).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS count FROM order_delivery_items').get().count).toBe(0);
  });

  it('uses authoritative OWN_ACCOUNT metadata even when the product name has no legacy wording', async () => {
    const item = product(OWN_KEY);
    db.prepare("UPDATE product_catalog SET name = 'ChatGPT Custom Upgrade', activation_method = 'OWN_ACCOUNT' WHERE id = ?").run(item.id);
    const updated = db.prepare('SELECT * FROM product_catalog WHERE id = ?').get(item.id);
    const order = paidOrder(updated);
    stock(updated.name, 'must-not-send-metadata');
    const { client } = deliveryClient();
    expect(await deliverPaidOrder(client, order.order_code)).toEqual({ delivered: false });
    expect(fulfillment(order.order_code)).toEqual({ status: 'BLOCKED', last_error: 'MANUAL_FULFILLMENT_REQUIRED' });
    expect(client.users.fetch).not.toHaveBeenCalled();
  });

  it('protects legacy AI Chính Chủ orders even if their catalog metadata is absent', async () => {
    const own = product(OWN_KEY);
    const order = paidOrder(own);
    db.prepare('DELETE FROM product_catalog WHERE id = ?').run(own.id);
    stock(own.name, 'legacy-must-not-send');
    const { client } = deliveryClient();
    expect(await deliverPaidOrder(client, order.order_code)).toEqual({ delivered: false });
    expect(fulfillment(order.order_code)).toEqual({ status: 'BLOCKED', last_error: 'MANUAL_FULFILLMENT_REQUIRED' });
    expect(client.users.fetch).not.toHaveBeenCalled();
    expect(getOrderByCode(order.order_code)).toMatchObject({ payment_status: 'PAID', status: 'PROCESSING' });
  });

  it('keeps an old generic AI reservation for staff review instead of sending or recycling it', async () => {
    const order = paidOrder(product(KBH_KEY));
    const id = stock('ai', 'wrong-reserved');
    db.prepare("UPDATE account_stock SET status = 'SOLD', order_code = ? WHERE id = ?").run(order.order_code, id);
    const credentials = db.prepare('SELECT credentials FROM account_stock WHERE id = ?').get(id).credentials;
    db.prepare('INSERT INTO order_delivery_items (order_code, stock_id, credentials) VALUES (?, ?, ?)').run(order.order_code, id, credentials);
    const { client } = deliveryClient();
    expect(await deliverPaidOrder(client, order.order_code)).toEqual({ delivered: false });
    expect(fulfillment(order.order_code)).toEqual({ status: 'BLOCKED', last_error: 'DELIVERY_SKU_REVIEW_REQUIRED' });
    expect(client.users.fetch).not.toHaveBeenCalled();
    expect(db.prepare('SELECT status, order_code FROM account_stock WHERE id = ?').get(id)).toEqual({ status: 'SOLD', order_code: order.order_code });
    expect(db.prepare('SELECT stock_id, credentials FROM order_delivery_items WHERE order_code = ?').get(order.order_code)).toEqual({ stock_id: id, credentials });
    expect(getOrderByCode(order.order_code)).toMatchObject({ payment_status: 'PAID', status: 'PROCESSING' });
  });

  it('preserves the existing non-AI service-type fallback', async () => {
    const order = paidOrder({ name: 'Netflix Test 1 Tháng', service_type: 'netflix', price: 75000 });
    const id = stock('netflix', 'netflix-service');
    const { client, send } = deliveryClient();
    expect((await deliverPaidOrder(client, order.order_code)).delivered).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT stock_id FROM order_delivery_items WHERE order_code = ?').get(order.order_code).stock_id).toBe(id);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testDatabasePath = vi.hoisted(() => {
  const relativePath = `./data/test-payment-fulfillment-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.test-payment-fulfillment-not-present';
  process.env.DATABASE_PATH = relativePath;
  process.env.ENCRYPTION_KEY = 'test-payment-fulfillment-key';
  process.env.BOT_API_KEY = 'test-bot-api-key';
  process.env.WEB_CHECKOUT_ENABLED = 'true';
  process.env.GUILD_ID = '987654321098765432';
  return relativePath;
});

import { db, initDatabase, nowIso } from '../src/database/db.js';
import { encrypt } from '../src/utils/crypto.js';
import {
  cancelOrder,
  createOrder,
  getOrderByCode,
  recordOrderPayment,
} from '../src/services/orderService.js';
import { deliverPaidOrder } from '../src/services/autoDeliveryService.js';
import { createTicket } from '../src/services/ticketService.js';
import { addWalletBalance, getWalletBalance } from '../src/services/walletService.js';
import { registerBotApiRoutes } from '../src/services/botApiRoutes.js';
import express from 'express';

let sequence = 0;
const customerId = '123456789012345678';

function createPendingOrder(quantity = 1) {
  sequence += 1;
  const ticket = createTicket({
    guildId: 'WEB',
    channelId: `web-test-${sequence}`,
    customerId,
    openedById: customerId,
    ticketType: 'ORDER',
  });
  return createOrder({
    orderCode: `CN_${910000 + sequence}`,
    guildId: 'WEB',
    ticketId: ticket.id,
    ticketChannelId: ticket.channel_id,
    customerId,
    productName: 'Netflix Premium',
    quantity,
    totalAmount: 50_000 * quantity,
    durationMonths: 1,
    orderLogChannelId: 'test-order-log',
    createdById: customerId,
  });
}

function addStock(count, serviceType = 'Netflix Premium') {
  for (let index = 0; index < count; index += 1) {
    db.prepare(`INSERT INTO account_stock (service_type, credentials, status, created_at)
      VALUES (?, ?, 'AVAILABLE', ?)`).run(
      serviceType.toLowerCase(),
      encrypt(`user${index}@example.com|password${index}|profile${index}|${1000 + index}`),
      nowIso(),
    );
  }
}

function confirmPayment(order, transactionId) {
  return recordOrderPayment({
    orderCode: order.order_code,
    provider: 'PAYOS',
    transactionId,
    amount: order.total_amount,
    content: order.order_code,
    rawPayload: { code: '00' },
  });
}

describe('payment and fulfillment reliability', () => {
  beforeAll(() => initDatabase());

  beforeEach(() => {
    db.exec(`DELETE FROM order_delivery_items;
      DELETE FROM order_fulfillments;
      DELETE FROM payment_events;
      DELETE FROM account_stock;
      DELETE FROM checkout_requests;
      DELETE FROM wallet_transactions;
      DELETE FROM orders;
      DELETE FROM customer_profiles;
      DELETE FROM product_catalog;`);
  });

  afterAll(() => {
    db.close();
    const absolutePath = path.resolve(process.cwd(), testDatabasePath);
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${absolutePath}${suffix}`, { force: true });
  });

  it('keeps the order processing after a DM failure, then delivers every purchased account on retry', async () => {
    const order = createPendingOrder(2);
    addStock(2);
    confirmPayment(order, 'payment-delivery-retry');

    const failingClient = {
      users: { fetch: vi.fn().mockRejectedValue(new Error('DM unavailable')) },
    };
    await expect(deliverPaidOrder(failingClient, order.order_code)).resolves.toEqual({ delivered: false });
    expect(getOrderByCode(order.order_code).status).toBe('PROCESSING');
    expect(db.prepare('SELECT COUNT(*) AS total FROM order_delivery_items WHERE order_code = ?').get(order.order_code).total).toBe(2);

    db.prepare('UPDATE order_fulfillments SET retry_at = ? WHERE order_code = ?').run(nowIso(), order.order_code);
    let messageId = 0;
    const send = vi.fn().mockImplementation(async () => ({ id: `message-${++messageId}` }));
    const workingClient = {
      users: { fetch: vi.fn().mockResolvedValue({ createDM: vi.fn().mockResolvedValue({ id: 'dm-channel', send }) }) },
    };
    const result = await deliverPaidOrder(workingClient, order.order_code);

    expect(result.delivered).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(getOrderByCode(order.order_code).status).toBe('COMPLETED');
    expect(db.prepare(`SELECT COUNT(*) AS total FROM order_delivery_items
      WHERE order_code = ? AND dm_message_id IS NOT NULL`).get(order.order_code).total).toBe(2);
  });

  it('waits without consuming partial stock, then completes after enough stock is added', async () => {
    const order = createPendingOrder(2);
    addStock(1);
    confirmPayment(order, 'payment-waits-for-stock');
    const send = vi.fn().mockResolvedValueOnce({ id: 'stock-message-1' }).mockResolvedValueOnce({ id: 'stock-message-2' });
    const client = {
      users: { fetch: vi.fn().mockResolvedValue({ createDM: vi.fn().mockResolvedValue({ id: 'dm-stock', send }) }) },
    };

    await expect(deliverPaidOrder(client, order.order_code)).resolves.toEqual({ delivered: false });
    expect(db.prepare('SELECT status, last_error FROM order_fulfillments WHERE order_code = ?')
      .get(order.order_code)).toMatchObject({ status: 'WAITING_STOCK', last_error: 'INSUFFICIENT_STOCK' });
    expect(db.prepare("SELECT COUNT(*) AS total FROM account_stock WHERE status = 'AVAILABLE'").get().total).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS total FROM order_delivery_items WHERE order_code = ?')
      .get(order.order_code).total).toBe(0);

    addStock(1);
    db.prepare('UPDATE order_fulfillments SET retry_at = ? WHERE order_code = ?').run(nowIso(), order.order_code);
    const result = await deliverPaidOrder(client, order.order_code);

    expect(result.delivered).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(getOrderByCode(order.order_code).status).toBe('COMPLETED');
  });

  it('does not queue or consume stock for a payment received after cancellation', () => {
    const order = createPendingOrder(1);
    addStock(1);
    cancelOrder(order.order_code, 'expired');
    confirmPayment(getOrderByCode(order.order_code), 'late-payment');

    expect(getOrderByCode(order.order_code)).toMatchObject({ status: 'CANCELLED', payment_status: 'PAID' });
    expect(db.prepare('SELECT * FROM order_fulfillments WHERE order_code = ?').get(order.order_code)).toBeUndefined();
    expect(db.prepare("SELECT status FROM account_stock LIMIT 1").get().status).toBe('AVAILABLE');
  });

  it('rolls the payment event back when the order update fails so a replay can recover', () => {
    const order = createPendingOrder(1);
    db.exec(`CREATE TRIGGER fail_test_payment BEFORE UPDATE OF payment_status ON orders
      WHEN NEW.order_code = '${order.order_code}' BEGIN SELECT RAISE(ABORT, 'test failure'); END;`);

    expect(() => confirmPayment(order, 'recoverable-payment')).toThrow('test failure');
    expect(db.prepare("SELECT * FROM payment_events WHERE transaction_id = 'recoverable-payment'").get()).toBeUndefined();
    expect(getOrderByCode(order.order_code).payment_status).toBe('UNPAID');

    db.exec('DROP TRIGGER fail_test_payment');
    expect(confirmPayment(order, 'recoverable-payment').updated.payment_status).toBe('PAID');
    expect(db.prepare("SELECT COUNT(*) AS total FROM payment_events WHERE transaction_id = 'recoverable-payment'").get().total).toBe(1);
  });

  it('returns the original wallet order when the same web checkout request is retried', async () => {
    const product = db.prepare(`INSERT INTO product_catalog
      (guild_id, name, price, duration_months, service_type, is_active)
      VALUES (?, ?, ?, 1, 'netflix', 1)`).run(process.env.GUILD_ID, 'Netflix Web', 75_000);
    addWalletBalance(process.env.GUILD_ID, customerId, 75_000, 'TOPUP', 'test credit', 'TOPUP_IDEMPOTENCY');
    addStock(1, 'netflix');

    const app = express();
    app.use(express.json());
    registerBotApiRoutes(app);
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const endpoint = `http://127.0.0.1:${server.address().port}/api/bot/web-orders`;
    const request = () => fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-bot-api-key': process.env.BOT_API_KEY,
        'x-discord-id': customerId,
        'x-user-id': 'web-user-1',
        'x-user-role': 'member',
        'x-idempotency-key': 'checkout_retry_1234567890',
      },
      body: JSON.stringify({
        items: [{ id: String(product.lastInsertRowid), quantity: 1 }],
        paymentProvider: 'WALLET',
        contact: 'test customer',
      }),
    }).then((response) => response.json());

    try {
      const first = await request();
      const second = await request();
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(second.data.reused).toBe(true);
      expect(second.data.order_code).toBe(first.data.order_code);
      expect(getWalletBalance(process.env.GUILD_ID, customerId)).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS total FROM orders').get().total).toBe(1);
      expect(db.prepare("SELECT COUNT(*) AS total FROM wallet_transactions WHERE type = 'PAYMENT'").get().total).toBe(1);
      expect(db.prepare('SELECT COUNT(*) AS total FROM order_fulfillments').get().total).toBe(1);

      const send = vi.fn().mockResolvedValue({ id: 'journey-delivery-message' });
      const delivered = await deliverPaidOrder({
        users: { fetch: vi.fn().mockResolvedValue({ createDM: vi.fn().mockResolvedValue({ id: 'journey-dm', send }) }) },
      }, first.data.order_code);
      expect(delivered.delivered).toBe(true);
      expect(send).toHaveBeenCalledOnce();
      expect(getOrderByCode(first.data.order_code).status).toBe('COMPLETED');

      db.prepare(`INSERT INTO web_users (id, email, display_name, role)
        VALUES ('revoked-staff', 'revoked@example.com', 'Revoked', 'member')`).run();
      const denied = await fetch(`${endpoint.replace('/web-orders', '')}/orders/${first.data.order_code}/chat`, {
        headers: {
          'x-bot-api-key': process.env.BOT_API_KEY,
          'x-user-id': 'revoked-staff',
          'x-user-role': 'admin',
          'x-discord-id': '111111111111111111',
        },
      });
      expect(denied.status).toBe(403);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

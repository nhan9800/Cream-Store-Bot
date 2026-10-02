import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const databasePath = vi.hoisted(() => {
  const value = `./data/test-underpayment-${process.pid}-${Date.now()}.sqlite`;
  Object.assign(process.env, { ENV_FILE: '.env.underpayment-not-present', DATABASE_PATH: value,
    ENCRYPTION_KEY: 'test-underpayment-key', BOT_API_KEY: 'test-audit-key',
    PAYOS_CLIENT_ID: 'test-client', PAYOS_API_KEY: 'test-api', PAYOS_CHECKSUM_KEY: 'test-checksum',
    GUILD_ID: '987654321098765432', PUBLIC_BASE_URL: 'https://bot.example.com' });
  return value;
});

import { db, initDatabase } from '../src/database/db.js';
import { createTicket } from '../src/services/ticketService.js';
import { createOrder, getOrderByCode, markOrderPaid, recordOrderPayment } from '../src/services/orderService.js';
import { finalizePaidOrder, getPayOSReceivedAmount, syncPaymentStatusFromPayOS } from '../src/services/paymentService.js';
import { auditOrderPayment } from '../src/services/paymentIncidentAuditService.js';
import { registerBotApiRoutes } from '../src/services/botApiRoutes.js';

let sequence = 0;
function pendingOrder() {
  const code = `CN_${940000 + ++sequence}`;
  const ticket = createTicket({ guildId: process.env.GUILD_ID, channelId: `web-${code}`,
    customerId: '123456789012345678', openedById: '123456789012345678', ticketType: 'ORDER' });
  return createOrder({ orderCode: code, guildId: ticket.guild_id, ticketId: ticket.id,
    ticketChannelId: ticket.channel_id, customerId: ticket.customer_id, productName: 'Locket Gold',
    quantity: 1, totalAmount: 150_000, durationMonths: 12, orderLogChannelId: 'unavailable',
    createdById: ticket.customer_id });
}

function mockPayOS(order, overrides = {}) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200,
    json: async () => ({ code: '00', data: { id: 'payos-test-link', orderCode: order.payos_order_code,
      status: 'PAID', amount: 150_000, ...overrides } }) });
}

function assertUntouched(order, client) {
  expect(getOrderByCode(order.order_code)).toMatchObject({ payment_status: 'UNPAID',
    amount_paid: 0, status: 'PENDING_PAYMENT', paid_at: null });
  for (const table of ['payment_events', 'order_fulfillments', 'order_delivery_items', 'customer_role_sync_jobs']) {
    expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count).toBe(0);
  }
  if (client) {
    expect(client.guilds.fetch).not.toHaveBeenCalled();
    expect(client.users.fetch).not.toHaveBeenCalled();
  }
}

describe('real receipt required before confirming an order', () => {
  beforeAll(() => initDatabase());
  beforeEach(() => {
    vi.restoreAllMocks();
    db.exec(`DELETE FROM order_delivery_items; DELETE FROM order_fulfillments;
      DELETE FROM payment_events; DELETE FROM staff_logs; DELETE FROM orders;
      DELETE FROM customer_role_sync_jobs; DELETE FROM customer_profiles; DELETE FROM product_catalog;`);
  });
  afterAll(() => {
    vi.restoreAllMocks();
    db.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${path.resolve(databasePath)}${suffix}`, { force: true });
  });

  it('never rounds a 90k receipt up to a 150k purchase', () => {
    const order = pendingOrder();
    expect(() => markOrderPaid(order.order_code, { amountPaid: 90_000, transactionId: 'short-receipt' }))
      .toThrow(expect.objectContaining({ code: 'INSUFFICIENT_PAYMENT' }));
    assertUntouched(order);
  });

  it.each([undefined, null, NaN, Infinity, -1, 0, true, '', 'garbage', 150_000.5])(
    'rejects an invalid actual amount %s before recording any payment', (amount) => {
      const order = pendingOrder();
      expect(() => recordOrderPayment({ orderCode: order.order_code, provider: 'PAYOS',
        transactionId: 'invalid', amount })).toThrow(expect.objectContaining({ code: 'INVALID_PAYMENT_AMOUNT' }));
      assertUntouched(order);
    });

  it('blocks finalization before role grants, stock delivery and Discord confirmations', async () => {
    const order = pendingOrder();
    const client = { guilds: { fetch: vi.fn() }, users: { fetch: vi.fn() } };
    await expect(finalizePaidOrder(client, order, { amount: 90_000 }, 'underpaid', 'bank'))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_PAYMENT' });
    assertUntouched(order, client);
  });

  it('reads the committed total when a price changed after the caller loaded the order', async () => {
    const order = pendingOrder();
    db.prepare('UPDATE orders SET total_amount = 200000 WHERE order_code = ?').run(order.order_code);
    await expect(finalizePaidOrder({}, order, { amount: 150_000 }, 'stale-price', 'bank'))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_PAYMENT' });
    assertUntouched(order);
  });

  it('preserves the actual received amount, including overpayments', () => {
    const order = pendingOrder();
    const result = recordOrderPayment({ orderCode: order.order_code, provider: 'PAYOS',
      transactionId: 'overpaid', amount: 160_000, rawPayload: { amount: 160_000 } });
    expect(result.updated).toMatchObject({ payment_status: 'PAID', amount_paid: 160_000 });
    expect(db.prepare('SELECT amount FROM payment_events WHERE order_code = ?').get(order.order_code).amount).toBe(160_000);
  });

  it('does not re-deliver a legacy paid order on replay of its short receipt', async () => {
    const order = pendingOrder();
    db.prepare("UPDATE orders SET payment_status = 'PAID', amount_paid = 150000 WHERE order_code = ?").run(order.order_code);
    db.prepare(`INSERT INTO payment_events (order_code, provider, transaction_id, amount, raw_payload, created_at)
      VALUES (?, 'PAYOS', 'legacy-short', 90000, '{"amount":90000}', CURRENT_TIMESTAMP)`).run(order.order_code);
    await expect(finalizePaidOrder({}, getOrderByCode(order.order_code), { amount: 90_000 }, 'legacy-short', 'bank'))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_PAYMENT' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM order_fulfillments').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM payment_events').get().count).toBe(1);
  });

  it.each([
    { amountPaid: 90_000, transactions: [{ amount: 90_000, reference: 'short' }] },
    {},
    { transactions: [{ amount: 90_000, reference: 'same' }, { amount: 90_000, reference: 'same' }] },
  ])('never uses invoice amount as proof of a full receipt: %j', async (info) => {
    const order = pendingOrder();
    mockPayOS(order, info);
    const client = { guilds: { fetch: vi.fn() }, users: { fetch: vi.fn() } };
    await expect(syncPaymentStatusFromPayOS({ client, orderCode: order.order_code }))
      .rejects.toMatchObject({ name: 'OrderPaymentError' });
    assertUntouched(order, client);
  });

  it('rejects a paid response for another invoice', async () => {
    const order = pendingOrder();
    mockPayOS(order, { orderCode: order.payos_order_code + 1, amountPaid: 150_000 });
    await expect(syncPaymentStatusFromPayOS({ client: {}, orderCode: order.order_code }))
      .rejects.toMatchObject({ code: 'PAYMENT_IDENTITY_MISMATCH' });
    assertUntouched(order);
  });

  it('confirms a matching invoice using amountPaid and ignores a different invoice value', async () => {
    const order = pendingOrder();
    mockPayOS(order, { amount: 90_000, amountPaid: 150_000 });
    const client = { guilds: { fetch: vi.fn().mockResolvedValue(null) }, users: { fetch: vi.fn() } };
    await expect(syncPaymentStatusFromPayOS({ client, orderCode: order.order_code })).resolves.toMatchObject({ synced: true });
    expect(getOrderByCode(order.order_code)).toMatchObject({ payment_status: 'PAID', amount_paid: 150_000 });
  });

  it('uses distinct transaction receipts only when amountPaid is absent', () => {
    expect(getPayOSReceivedAmount({ amount: 150_000 })).toBeNull();
    expect(getPayOSReceivedAmount({ amountPaid: 0, transactions: [{ amount: 150_000, reference: 'a' }] })).toBe(0);
    expect(getPayOSReceivedAmount({ transactions: [{ amount: 90_000, reference: 'a' },
      { amount: 60_000, reference: 'b' }, { amount: 60_000, reference: 'b' }] })).toBe(150_000);
    expect(getPayOSReceivedAmount({ transactions: [{ amount: -1, reference: 'a' }] })).toBeNull();
  });

  it('audits legacy short receipts without changing data or exposing private fields', async () => {
    const order = pendingOrder();
    db.prepare("UPDATE orders SET payment_status = 'PAID', amount_paid = 150000 WHERE order_code = ?").run(order.order_code);
    db.prepare(`INSERT INTO payment_events (order_code, provider, transaction_id, amount, raw_payload, created_at)
      VALUES (?, 'PAYOS', 'private-bank-reference', 90000, ?, CURRENT_TIMESTAMP)`).run(order.order_code,
      JSON.stringify({ amount: 90_000, accountNumber: 'private-bank-account' }));
    mockPayOS(order, { amount: 90_000, amountPaid: 90_000, amountRemaining: 0 });
    const before = getOrderByCode(order.order_code);
    const result = await auditOrderPayment(order.order_code);
    expect(result).toMatchObject({ order: { totalAmount: 150_000, recordedPaidAmount: 150_000 },
      payos: { invoiceAmount: 90_000, receivedAmount: 90_000 }, findings: {
        confirmedWithoutFullRecordedReceipt: true, providerShowsShortfall: true,
        recentPayosOrdersWithShortReceiptEvidence: 1 } });
    expect(getOrderByCode(order.order_code)).toEqual(before);
    const serialized = JSON.stringify(result);
    for (const privateValue of [order.customer_id, 'private-bank-account', 'private-bank-reference', 'raw_payload']) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('requires the bot API key for incident diagnostics', async () => {
    const order = pendingOrder();
    const app = express();
    registerBotApiRoutes(app);
    const server = await new Promise((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    try {
      const url = `http://127.0.0.1:${server.address().port}/api/bot/payment-audit/${order.order_code}`;
      expect((await fetch(url)).status).toBe(401);
      const localFetch = globalThis.fetch;
      mockPayOS(order, { amountPaid: 150_000 });
      const response = await localFetch(url, { headers: { 'x-bot-api-key': process.env.BOT_API_KEY } });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toMatchObject({ ok: true, data: { order: { totalAmount: 150_000 } } });
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});

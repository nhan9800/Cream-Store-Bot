import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testDatabasePath = vi.hoisted(() => {
  process.env.ENV_FILE = '.env.test-api-credit-not-present';
  process.env.DATABASE_PATH = `./data/test-api-credit-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENCRYPTION_KEY = 'test-api-credit-key';
  return process.env.DATABASE_PATH;
});
vi.mock('../src/events/productHandlers.js', () => ({ handleProductSelect: vi.fn() }));
import { db, initDatabase, seedProductCatalog } from '../src/database/db.js';
import { getActiveProducts } from '../src/services/productCatalogService.js';
import { API_CREDIT_DURATION, API_CREDIT_PRODUCTS } from '../src/config/apiCreditCatalog.js';
import { handlePremiumProductInteraction } from '../src/services/premiumProductSetupService.js';
import { handleProductSelect } from '../src/events/productHandlers.js';
import { createTicket } from '../src/services/ticketService.js';
import { createOrder, ensureOrderExpiry, recordOrderPayment } from '../src/services/orderService.js';
import { deliverPaidOrder } from '../src/services/autoDeliveryService.js';
import { formatOrderDuration } from '../src/utils/formatters.js';
import { getDurText } from '../src/utils/productFormatting.js';
import { rankCatalogProducts } from '../src/services/aiCommerceUnderstandingService.js';

beforeAll(() => initDatabase());
afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.resolve(testDatabasePath + suffix), { force: true });
});

describe('API credit commerce', () => {
  const packs = () => db.prepare("SELECT * FROM product_catalog WHERE product_key LIKE 'api-codex-claude-credit-%' ORDER BY quota_value").all();

  it('retires all old API offers across restarts without deleting order-linked rows', () => {
    const insert = db.prepare("INSERT INTO product_catalog (guild_id, name, price, duration_months, service_type, product_key, quota_value, quota_unit, activation_method) VALUES ('WEB', ?, ?, ?, 'AI', ?, ?, 'USD_CREDIT', 'TOKEN')");
    const legacy = insert.run('Claude API 100M', 85000, 1, 'claude-api-100m', null);
    for (const pack of API_CREDIT_PRODUCTS) insert.run(pack.name, pack.price, 0, pack.product_key, pack.quota_value);
    seedProductCatalog(db);
    seedProductCatalog(db);
    expect(packs().map((p) => [p.quota_value, p.price, p.is_active]))
      .toEqual([[10,70000,0],[30,90000,0],[50,110000,0],[100,155000,0],[200,250000,0],[500,530000,0]]);
    expect(db.prepare('SELECT is_active, price FROM product_catalog WHERE id = ?').get(legacy.lastInsertRowid)).toEqual({ is_active: 0, price: 85000 });
    expect(getActiveProducts('WEB').some((p) => /Claude.*API|API.*Claude/i.test(p.name))).toBe(false);
  });

  it('keeps zero calendar duration for previously purchased API credit', () => {
    const product = packs()[3];
    const ticket = createTicket({ guildId: 'WEB', channelId: 'api-credit-test', customerId: 'api-test', openedById: 'api-test', ticketType: 'ORDER' });
    const order = createOrder({ guildId: 'WEB', ticketId: ticket.id, ticketChannelId: ticket.channel_id, customerId: 'api-test', productName: product.name, serviceType: 'AI', quantity: 2, totalAmount: product.price * 2, durationMonths: product.duration_months, orderLogChannelId: 'api-credit-log', createdById: 'api-test', orderCode: 'CN_919999' });
    const result = ensureOrderExpiry(order.order_code, new Date('2026-10-07T12:00:00Z'));
    expect(result).toMatchObject({ total_amount: 310000, quantity: 2, duration_months: 0, duration_days: null, expiry_at: null });
    expect(formatOrderDuration(result)).toBe(API_CREDIT_DURATION);
    expect(getDurText(product)).toBe(API_CREDIT_DURATION);
  });
  it('holds paid API tokens for staff delivery instead of delivering account credentials', async () => {
    recordOrderPayment({ orderCode: 'CN_919999', provider: 'MANUAL', transactionId: 'api-credit-test-payment', amount: 310000, content: 'CN_919999', rawPayload: { amount: 310000 } });
    const send = vi.fn();
    const result = await deliverPaidOrder({ users: { fetch: send } }, 'CN_919999');
    expect(result.delivered).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(db.prepare('SELECT status, last_error FROM order_fulfillments WHERE order_code = ?').get('CN_919999'))
      .toEqual({ status: 'BLOCKED', last_error: 'MANUAL_FULFILLMENT_REQUIRED' });
  });
  it.each(['credit_select', 'modal_buy', 'pricing', 'models', 'policy'])('blocks stale API interaction %s without opening checkout', async (action) => {
    const reply = vi.fn();
    const before = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count;
    await handlePremiumProductInteraction({ customId: 'product:claude:' + action, guildId: 'WEB', values: [String(packs()[0].id)], reply });
    expect(reply.mock.calls[0][0]).toMatchObject({ flags: 64, content: expect.stringContaining('ngừng bán') });
    expect(handleProductSelect).not.toHaveBeenCalled();
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count).toBe(before);
  });
  it.each(['product:locket:features', 'product:locket:policy'])('routes %s to private Markdown details without creating an order', async (customId) => {
    const reply = vi.fn();
    const before = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count;
    await handlePremiumProductInteraction({ customId, guildId: 'WEB', reply });
    const payload = reply.mock.calls[0][0];
    expect(payload.components[0].toJSON().components[0].content).toMatch(/^## /);
    expect(payload.flags).toBe(32768 | 64);
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count).toBe(before);
  });
  it('keeps retired API products out of AI recommendations', () => {
    expect(rankCatalogProducts(getActiveProducts('WEB'), { content: 'mua Claude API $500 credit' }).products).toEqual([]);
  });
});

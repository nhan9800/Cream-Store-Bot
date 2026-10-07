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
import { getActiveProducts, generateProductKnowledgeText } from '../src/services/productCatalogService.js';
import { API_CREDIT_DURATION, getApiCreditProducts } from '../src/config/apiCreditCatalog.js';
import { buildApiCreditPanel } from '../src/services/apiCreditPanel.js';
import { handlePremiumProductInteraction } from '../src/services/premiumProductSetupService.js';
import { handleProductSelect } from '../src/events/productHandlers.js';
import { createTicket } from '../src/services/ticketService.js';
import { createOrder, ensureOrderExpiry, recordOrderPayment } from '../src/services/orderService.js';
import { deliverPaidOrder } from '../src/services/autoDeliveryService.js';
import { formatOrderDuration } from '../src/utils/formatters.js';
import { getDurText } from '../src/utils/productFormatting.js';
import { buildAiOrderConfirmationPayload } from '../src/services/aiSupportAutomationService.js';
import { rankCatalogProducts } from '../src/services/aiCommerceUnderstandingService.js';

beforeAll(() => initDatabase());
afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.resolve(testDatabasePath + suffix), { force: true });
});

describe('API credit commerce', () => {
  const packs = () => getApiCreditProducts(getActiveProducts('WEB'));
  it('seeds six exact owner prices and removes the old daily offer without deleting history', () => {
    const legacy = db.prepare("INSERT INTO product_catalog (guild_id,name,price,duration_months,service_type,product_key) VALUES ('WEB','Claude API 100M',85000,1,'AI','claude-api-100m')").run();
    seedProductCatalog(db);
    seedProductCatalog(db);
    expect(packs().map((p) => [p.quota_value, p.price])).toEqual([[10,70000],[30,90000],[50,110000],[100,155000],[200,250000],[500,530000]]);
    expect(packs().every((p) => p.duration_months === 0 && p.base_duration_days === null && p.additional_day_price === null)).toBe(true);
    expect(db.prepare('SELECT is_active, price FROM product_catalog WHERE id = ?').get(legacy.lastInsertRowid)).toEqual({ is_active: 0, price: 85000 });
    expect(getActiveProducts('WEB').some((p) => p.name === 'Claude API 100M')).toBe(false);
  });
  it('persists zero calendar duration and never generates a completion expiry', () => {
    const product = packs()[3];
    const ticket = createTicket({ guildId: 'WEB', channelId: 'api-credit-test', customerId: 'api-test', openedById: 'api-test', ticketType: 'ORDER' });
    const order = createOrder({ guildId: 'WEB', ticketId: ticket.id, ticketChannelId: ticket.channel_id, customerId: 'api-test', productName: product.name, serviceType: 'AI', quantity: 2, totalAmount: product.price * 2, durationMonths: product.duration_months, orderLogChannelId: 'api-credit-log', createdById: 'api-test', orderCode: 'CN_919999' });
    const result = ensureOrderExpiry(order.order_code, new Date('2026-10-07T12:00:00Z'));
    expect(result).toMatchObject({ total_amount: 310000, quantity: 2, duration_months: 0, duration_days: null, expiry_at: null });
    expect(formatOrderDuration(result)).toBe(API_CREDIT_DURATION);
    expect(getDurText(product)).toBe(API_CREDIT_DURATION);
    const line = generateProductKnowledgeText('WEB').split('\n').find((line) => line.includes(product.name));
    expect(line).toContain(API_CREDIT_DURATION);
    expect(line).not.toContain('/ 1 tháng');
    const aiQuote = JSON.stringify(buildAiOrderConfirmationPayload({ guildId: 'WEB', ticket, product, quantity: 2 }));
    expect(aiQuote).toContain(API_CREDIT_DURATION);
    expect(aiQuote).toContain('310.000đ');
    expect(aiQuote).not.toContain('1 tháng');
  });
  it('publishes one compact panel with real product IDs, current prices and no ping', () => {
    const payload = buildApiCreditPanel('WEB', packs());
    const json = payload.components.map((c) => c.toJSON());
    const selector = json[1].components[0];
    expect(selector.options).toHaveLength(6);
    expect(selector.options.map((o) => o.value)).toEqual(packs().map((p) => String(p.id)));
    const serialized = JSON.stringify(json);
    expect(serialized).toContain('530.000đ');
    expect(serialized).toContain('api-credit-banner-20261007.webp');
    expect(serialized).not.toMatch(/100M|85.000|ngày đầu|CLAUDE 5/);
    expect(payload.allowedMentions).toEqual({ parse: [] });
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
  it('rejects forged or inactive packs and routes a valid selection to normal catalog checkout', async () => {
    const reply = vi.fn();
    await handlePremiumProductInteraction({ customId: 'product:claude:credit_select', guildId: 'WEB', values: ['999999'], reply });
    expect(reply).toHaveBeenCalledOnce();
    expect(handleProductSelect).not.toHaveBeenCalled();
    const interaction = { customId: 'product:claude:credit_select', guildId: 'WEB', values: [String(packs()[0].id)], reply };
    await handlePremiumProductInteraction(interaction);
    expect(handleProductSelect).toHaveBeenCalledWith(interaction);
  });
  it('redirects a submitted legacy 85k modal to current pack selection without charging', async () => {
    const reply = vi.fn();
    const before = db.prepare('SELECT COUNT(*) AS count FROM orders').get().count;
    await handlePremiumProductInteraction({ customId: 'product:claude:modal_buy', guildId: 'WEB', reply });
    expect(reply.mock.calls[0][0].content).toContain('70.000đ');
    expect(reply.mock.calls[0][0].components[0].toJSON().components[0].options).toHaveLength(6);
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count).toBe(before);
  });
  it('recognizes the requested dollar credit tier without mixing Claude subscriptions or quantities', () => {
    const result = rankCatalogProducts(getActiveProducts('WEB'), { content: 'Lên đơn 2 gói Claude API $500 credit cho mình' });
    expect(result.confidentProduct?.product_key).toBe('api-codex-claude-credit-500');
    expect(result.quantity).toBe(2);
    expect(result.products).toHaveLength(1);
    expect(rankCatalogProducts(getActiveProducts('WEB'), { content: 'mua API Codex $60 credit' }).products).toHaveLength(0);
    const contextual = rankCatalogProducts(getActiveProducts('WEB'), { content: 'Ok lấy gói này', contextMessages: ['Claude API $200 credit'] });
    expect(contextual.confidentProduct?.product_key).toBe('api-codex-claude-credit-200');
  });
});

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupplierAutobuyOrderService } from '../src/services/supplierAutobuyOrderService.js';
import { createDopermindClient, DopermindError } from '../src/services/dopermindClient.js';
import { CdkVietnamError } from '../src/services/cdkVietnamClient.js';
import { STORE_ONE_GUILD_ID } from '../src/utils/locale.js';

const CUSTOMER = '111111111111111111';
const OTHER = '222222222222222222';
const CHANNEL = '333333333333333333';
const LOG = '444444444444444444';
const MESSAGE = '555555555555555555';
const PRODUCT = 'desc_test-product';
const open = [];
function wireProvider(provider) {
  return { ...provider, createOrder: async request => {
    if (request.beforeSubmit && request.beforeSubmit() !== true) throw new DopermindError('SUBMISSION_BLOCKED', { outcome: 'NOT_SUBMITTED' });
    return provider.createOrder(request);
  } };
}
function setup(options = {}) {
  const database = options.database || new Database(':memory:');
  if (!options.database) {
    open.push(database);
    database.pragma('foreign_keys=ON');
    database.exec(`CREATE TABLE tickets(id INTEGER PRIMARY KEY,guild_id TEXT,customer_id TEXT,channel_id TEXT,status TEXT);
      CREATE TABLE orders(order_code TEXT PRIMARY KEY,guild_id TEXT,customer_id TEXT,product_name TEXT,product_id INTEGER,
        ticket_id INTEGER,ticket_channel_id TEXT,order_log_channel_id TEXT,quantity INTEGER,total_amount INTEGER,amount_paid INTEGER,
        payment_status TEXT,status TEXT,fulfillment_mode TEXT,created_at TEXT,delivered_at TEXT);
      CREATE TABLE wallet_transactions(guild_id TEXT,customer_id TEXT,related_code TEXT,type TEXT,amount INTEGER);`);
    database.prepare('INSERT INTO tickets VALUES(1,?,?,?,?)').run(STORE_ONE_GUILD_ID, CUSTOMER, CHANNEL, 'OPEN');
  }
  let time = options.time || Date.parse('2026-11-10T16:00:00Z');
  let sequence = 0;
  let enabled = true;
  let blocked = false;
  let cost = 42000;
  const quote = (key, quantity) => ({ productKey: key, productName: 'Subscription 1 tháng', quantity,
    unitPriceVnd: cost + 30000, totalPriceVnd: (cost + 30000) * quantity, unitCostVnd: cost, maxUnitCostVnd: cost,
    durationMonths: 1, pricingVersion: 'test-v1', termsFingerprint: createHash('sha256').update(`${key}:${quantity}:${cost}:v1`).digest('hex'),
    createdAt: new Date(time).toISOString(), checkedAt: new Date(time).toISOString(), expiresAt: new Date(time + 60000).toISOString(),
    termText: '1 tháng', warrantyText: 'Bảo hành full tháng', accountForm: 'Tài khoản cấp sẵn', category: 'AI' });
  const getQuote = vi.fn(async (key, quantity) => quote(key, quantity));
  const createOrder = vi.fn(input => {
    const code = `CN_${100000 + ++sequence + database.prepare('SELECT COUNT(*) AS n FROM orders').get().n}`;
    database.prepare(`INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, input.guildId, input.customerId,
      input.productName, 99, input.ticketId, input.ticketChannelId, input.orderLogChannelId, input.quantity, input.totalAmount,
      0, 'UNPAID', 'PENDING_PAYMENT', 'LEGACY', new Date(time).toISOString(), null);
    return database.prepare('SELECT * FROM orders WHERE order_code=?').get(code);
  });
  const markOrderCompleted = vi.fn(code => {
    database.prepare("UPDATE orders SET status='COMPLETED',delivered_at=? WHERE order_code=?").run(new Date(time).toISOString(), code);
    return database.prepare('SELECT * FROM orders WHERE order_code=?').get(code);
  });
  const provider = { getStock: vi.fn(async () => [{ productKey: PRODUCT, name: 'Subscription 1 tháng', priceVnd: cost, stock: 20, unlimited: false }]),
    getBalance: vi.fn(async () => ({ currency: 'VND', balanceVnd: 1000000 })),
    createOrder: vi.fn(async request => ({ requestId: request.requestId, productKey: request.productKey, quantity: request.quantity,
      orderCode: 'API_TEST_1', unitPriceVnd: cost, totalAmountVnd: cost * request.quantity, createdAt: new Date(time).toISOString(),
      items: Array.from({ length: request.quantity }, (_, i) => `private-user-${i}|private-password`), idempotent: false })) };
  const sendDelivery = vi.fn(async () => ({ channelId: CHANNEL, messageId: MESSAGE }));
  const notifyCompletion = vi.fn(async () => {});
  const reconcileInvoices = vi.fn(async () => {});
  const settings = { db: database, getQuote, createOrder, markOrderCompleted, saveDelivery: vi.fn(),
    encrypt: value => `enc:v1:${Buffer.from(value).toString('base64')}`,
    decrypt: value => Buffer.from(value.slice(7), 'base64').toString('utf8'),
    providerFactory: () => wireProvider(provider), enabled: () => enabled, customerBlocked: () => blocked,
    sendDelivery, notifyCompletion, reconcileInvoices, now: () => time, ...options.settings };
  const service = createSupplierAutobuyOrderService(settings); service.init();
  const context = { guildId: STORE_ONE_GUILD_ID, customerId: CUSTOMER };
  async function create(quantity = 1) {
    const pending = await service.prepareSupplierCheckout({ ...context, productKey: PRODUCT, quantity });
    return service.confirmSupplierCheckout({ ...context, quoteId: pending.quoteId, ticketId: 1, ticketChannelId: CHANNEL, orderLogChannelId: LOG });
  }
  function pay(code) { database.prepare("UPDATE orders SET payment_status='PAID',amount_paid=total_amount,status='PROCESSING' WHERE order_code=?").run(code); }
  return { service, settings, database, getQuote, createOrder, markOrderCompleted, provider, sendDelivery, notifyCompletion, reconcileInvoices,
    context, create, pay, quote, setTime: value => { time = value; }, advance: ms => { time += ms; }, setEnabled: value => { enabled = value; },
    setBlocked: value => { blocked = value; }, setCost: value => { cost = value; },
    intent: code => database.prepare('SELECT * FROM supplier_autobuy_intents WHERE order_code=?').get(code) };
}
afterEach(() => { vi.useRealTimers(); for (const database of open.splice(0)) database.close(); });

describe('durable provider isolation', () => {
  const CDK = 'cdkvietnam:1';
  function sources(options = {}) {
    let t;
    const factory = vi.fn(provider => wireProvider(provider === 'cdkvietnam' ? cdk : t.provider));
    const cdk = { getStock: vi.fn(async () => [{ productKey: CDK, name: 'Subscription 1 tháng', priceVnd: 42000, stock: 20 }]),
      getBalance: vi.fn(async () => ({ currency: 'VND', balanceVnd: 1000000 })),
      createOrder: vi.fn(async request => ({ requestId: request.requestId, productKey: request.productKey, quantity: request.quantity,
        orderCode: 'ord_cdk_test', unitPriceVnd: 42000, totalAmountVnd: 42000 * request.quantity,
        items: Array.from({ length: request.quantity }, () => 'synthetic-cdk-delivery') })) };
    t = setup({ settings: { providerFactory: factory, ...options } });
    const createCdk = async () => {
      const q = await t.service.prepareSupplierCheckout({ ...t.context, provider: 'cdkvietnam', productKey: CDK });
      return t.service.confirmSupplierCheckout({ ...t.context, provider: 'cdkvietnam', quoteId: q.quoteId,
        ticketId: 1, ticketChannelId: CHANNEL, orderLogChannelId: LOG });
    };
    return { ...t, cdk, factory, createCdk };
  }
  it('rejects a source/key mismatch before reading a quote and rejects a dishonest quote source', async () => {
    const t = sources();
    await expect(t.service.prepareSupplierCheckout({ ...t.context, provider: 'dopermind', productKey: CDK })).rejects.toMatchObject({ code: 'PROVIDER_MISMATCH' });
    expect(t.getQuote).not.toHaveBeenCalled();
    t.getQuote.mockImplementation(async (key, quantity) => ({ ...t.quote(key, quantity), provider: 'dopermind' }));
    await expect(t.service.prepareSupplierCheckout({ ...t.context, provider: 'cdkvietnam', productKey: CDK })).rejects.toMatchObject({ code: 'PROVIDER_MISMATCH' });
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM supplier_autobuy_quotes').get().n).toBe(0);
  });
  it('binds quote confirmations to their saved source before order creation', async () => {
    const t = sources();
    const q = await t.service.prepareSupplierCheckout({ ...t.context, provider: 'cdkvietnam', productKey: CDK });
    expect(q.provider).toBe('cdkvietnam');
    expect(t.getQuote).toHaveBeenCalledWith(CDK, 1, { force: true, provider: 'cdkvietnam' });
    await expect(t.service.confirmSupplierCheckout({ ...t.context, provider: 'dopermind', quoteId: q.quoteId,
      ticketId: 1, ticketChannelId: CHANNEL, orderLogChannelId: LOG })).rejects.toMatchObject({ code: 'PROVIDER_MISMATCH' });
    expect(t.createOrder).not.toHaveBeenCalled();
    expect(() => t.service.getSupplierQuoteForCustomer({ ...t.context, quoteId: q.quoteId, provider: 'dopermind' })).toThrowError(/AutoBuy/);
  });
  it('routes preflight, wallet funds and purchases by immutable order source', async () => {
    const t = sources(); const c = await t.createCdk(), d = await t.create();
    expect(t.intent(c.order_code).provider).toBe('cdkvietnam');
    expect(t.intent(d.order_code).provider).toBe('dopermind');
    await expect(t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: c.order_code, provider: 'dopermind' })).rejects.toMatchObject({ code: 'PROVIDER_MISMATCH' });
    expect(t.factory).not.toHaveBeenCalled();
    await t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: c.order_code, provider: 'cdkvietnam' });
    expect(t.cdk.getStock).toHaveBeenCalledOnce();
    expect(t.provider.getStock).not.toHaveBeenCalled();
    t.pay(c.order_code); t.pay(d.order_code);
    t.cdk.getBalance.mockResolvedValue({ currency: 'VND', balanceVnd: 0 });
    expect(await t.service.fulfillSupplierOrder({}, c.order_code)).toMatchObject({ status: 'WAITING_SUPPLIER_FUNDS' });
    expect(await t.service.fulfillSupplierOrder({}, d.order_code)).toMatchObject({ delivered: true });
    expect(t.cdk.createOrder).not.toHaveBeenCalled(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
    expect(t.factory.mock.calls.map(([provider]) => provider)).toEqual(['cdkvietnam', 'cdkvietnam', 'dopermind']);
  });
  it('filters history and blocks cross-source delivery retrieval and acknowledgment', async () => {
    const t = sources(); const c = await t.createCdk(), d = await t.create();
    expect(t.service.listSupplierOrdersForCustomer({ ...t.context, provider: 'cdkvietnam' })).toMatchObject([{ orderCode: c.order_code, provider: 'cdkvietnam' }]);
    expect(t.service.listSupplierOrdersForCustomer({ ...t.context, provider: 'dopermind' })).toMatchObject([{ orderCode: d.order_code, provider: 'dopermind' }]);
    expect(() => t.service.getSupplierOrderForCustomer({ ...t.context, orderCode: c.order_code, provider: 'dopermind' })).toThrow();
    expect(() => t.service.getSupplierDeliveryForCustomer({ ...t.context, orderCode: c.order_code, provider: 'dopermind' })).toThrow();
    expect(() => t.service.acknowledgeSupplierDeliveryRetrieval({ ...t.context, orderCode: c.order_code, provider: 'dopermind', messageId: MESSAGE })).toThrow();
    expect(t.markOrderCompleted).not.toHaveBeenCalled();
  });
  it('does not let a paused source consume the shared worker queue for a ready source', async () => {
    let cdkEnabled = true;
    const t = sources({ enabled: provider => provider === 'dopermind' || cdkEnabled });
    const c = await t.createCdk(), d = await t.create(); t.pay(c.order_code); t.pay(d.order_code);
    cdkEnabled = false;
    await expect(t.service.prepareSupplierCheckout({ ...t.context, provider: 'cdkvietnam', productKey: CDK })).rejects.toMatchObject({ code: 'AUTOBUY_DISABLED' });
    expect(await t.service.processPendingSupplierOrders({}, 1)).toEqual({ processed: 1 });
    expect(t.intent(c.order_code).status).toBe('PENDING'); expect(t.intent(d.order_code).status).toBe('DELIVERED');
    expect(t.cdk.createOrder).not.toHaveBeenCalled();
  });
  it('migrates legacy paid CDK and Dopermind records without changing request identities or receipts', async () => {
    const t = sources(); const c = await t.createCdk(), d = await t.create(); t.pay(c.order_code); t.pay(d.order_code);
    const before = [t.intent(c.order_code), t.intent(d.order_code)];
    t.database.exec('ALTER TABLE supplier_autobuy_quotes DROP COLUMN provider; ALTER TABLE supplier_autobuy_intents DROP COLUMN provider');
    for (const row of t.database.prepare('SELECT quote_id,quote_json FROM supplier_autobuy_quotes').all()) {
      const quote = JSON.parse(row.quote_json); delete quote.provider;
      t.database.prepare('UPDATE supplier_autobuy_quotes SET quote_json=? WHERE quote_id=?').run(JSON.stringify(quote), row.quote_id);
    }
    // Simulates changing the shop default between process restarts. Routing
    // remains entirely determined by saved product identities.
    const factory = vi.fn(provider => wireProvider(provider === 'cdkvietnam' ? t.cdk : t.provider));
    const restart = createSupplierAutobuyOrderService({ ...t.settings, providerFactory: factory }); restart.init();
    for (const original of before) {
      const saved = t.intent(original.order_code);
      expect(saved).toMatchObject({ provider: original.provider, request_id: original.request_id,
        request_json: original.request_json, request_hash: original.request_hash, quote_id: original.quote_id,
        status: original.status, supplier_order_code: original.supplier_order_code });
      expect(restart.getSupplierOrderForCustomer({ ...t.context, orderCode: original.order_code }).provider).toBe(original.provider);
    }
    await restart.fulfillSupplierOrder({}, c.order_code); await restart.fulfillSupplierOrder({}, d.order_code);
    expect(factory.mock.calls.map(([provider]) => provider)).toEqual(['cdkvietnam', 'dopermind']);
    expect(t.cdk.createOrder).toHaveBeenCalledOnce(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
  });
  it('polls a CDK manual receipt on its saved client while Dopermind remains separate', async () => {
    const t = sources(); const c = await t.createCdk(); t.pay(c.order_code);
    t.database.prepare("UPDATE supplier_autobuy_intents SET status='RECONCILING',supplier_order_code='ord_saved_cdk' WHERE order_code=?").run(c.order_code);
    t.cdk.getOrder = vi.fn(async () => ({ orderCode: 'ord_saved_cdk', status: 'delivered', productId: 1, quantity: 1,
      unitPriceVnd: 42000, totalAmountVnd: 42000, items: ['synthetic-manual-delivery'] }));
    await t.service.processPendingSupplierOrders({}, 1);
    expect(t.cdk.getOrder).toHaveBeenCalledWith({ orderId: 'ord_saved_cdk' });
    expect(t.cdk.createOrder).not.toHaveBeenCalled(); expect(t.provider.createOrder).not.toHaveBeenCalled();
    expect(t.intent(c.order_code).status).toBe('DELIVERED');
  });
});

describe('durable supplier checkout and ownership', () => {
  it('reconciles old customer invoices before the enabled worker fulfills paid orders and tolerates lookup outages', async () => {
    vi.useFakeTimers();
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    t.reconcileInvoices.mockRejectedValueOnce(new Error('lookup unavailable'));
    t.service.startSupplierAutobuyWorker({});
    try {
      await vi.advanceTimersByTimeAsync(1);
      expect(t.reconcileInvoices).toHaveBeenCalledTimes(1);
      expect(t.reconcileInvoices.mock.invocationCallOrder[0]).toBeLessThan(t.provider.getStock.mock.invocationCallOrder[0]);
      expect(t.provider.createOrder).toHaveBeenCalledTimes(1);
      t.setEnabled(false); await vi.advanceTimersByTimeAsync(60000);
      expect(t.reconcileInvoices).toHaveBeenCalledTimes(1);
      expect(t.provider.createOrder).toHaveBeenCalledTimes(1);
    } finally { t.service.stopSupplierAutobuyWorker(); }
  });
  it('persists a customer-bound quote with public fields only and no purchase', async () => {
    const t = setup(); const q = await t.service.prepareSupplierCheckout({ ...t.context, productKey: PRODUCT });
    expect(q).toMatchObject({ productKey: PRODUCT, quantity: 1, unitPriceVnd: 72000 });
    expect(q.quoteId).toHaveLength(36); expect(q).not.toHaveProperty('unitCostVnd');
    expect(t.provider.createOrder).not.toHaveBeenCalled();
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM supplier_autobuy_quotes').get().n).toBe(1);
  });
  it.each([{ guildId: '1070676180103086132' }, { customerId: 'invalid' }, { quantity: 0 }, { quantity: 11 }])('rejects invalid checkout scope %j', async patch => {
    const t = setup(); await expect(t.service.prepareSupplierCheckout({ ...t.context, productKey: PRODUCT, ...patch })).rejects.toBeTruthy();
    expect(t.getQuote).not.toHaveBeenCalled();
  });
  it('rejects disabled or blocked customers before requesting prices', async () => {
    const t = setup(); t.setEnabled(false);
    await expect(t.create()).rejects.toMatchObject({ code: 'AUTOBUY_DISABLED' });
    t.setEnabled(true); t.setBlocked(true);
    await expect(t.create()).rejects.toMatchObject({ code: 'CUSTOMER_BLOCKED' });
    expect(t.getQuote).not.toHaveBeenCalled();
  });
  it('checks quote ownership and expiry before private ticket creation', async () => {
    const t = setup(); const q = await t.service.prepareSupplierCheckout({ ...t.context, productKey: PRODUCT });
    expect(() => t.service.getSupplierQuoteForCustomer({ ...t.context, customerId: OTHER, quoteId: q.quoteId })).toThrow();
    t.advance(60001); expect(() => t.service.getSupplierQuoteForCustomer({ ...t.context, quoteId: q.quoteId })).toThrow();
  });
  it('reconfirms price and creates one supplier-mode order for concurrent confirmation clicks', async () => {
    const t = setup(); const q = await t.service.prepareSupplierCheckout({ ...t.context, productKey: PRODUCT });
    const input = { ...t.context, quoteId: q.quoteId, ticketId: 1, ticketChannelId: CHANNEL, orderLogChannelId: LOG };
    const [first, second] = await Promise.all([t.service.confirmSupplierCheckout(input), t.service.confirmSupplierCheckout(input)]);
    expect(first.order_code).toBe(second.order_code); expect(t.createOrder).toHaveBeenCalledTimes(1);
    expect(first.fulfillment_mode).toBe('SUPPLIER'); expect(first.product_id).toBeNull();
    expect(t.intent(first.order_code).request_id).toMatch(/^cenar-/);
    expect(t.intent(first.order_code).max_unit_cost).toBe(42000);
    expect(t.provider.createOrder).not.toHaveBeenCalled();
    t.advance(100000); expect(t.service.getSupplierQuoteForCustomer({ ...t.context, quoteId: q.quoteId }).orderCode).toBe(first.order_code);
  });
  it('rejects changed prices and foreign ticket before creating an order', async () => {
    const t = setup(); const q = await t.service.prepareSupplierCheckout({ ...t.context, productKey: PRODUCT }); t.setCost(45000);
    const input = { ...t.context, quoteId: q.quoteId, ticketId: 1, ticketChannelId: CHANNEL, orderLogChannelId: LOG };
    await expect(t.service.confirmSupplierCheckout(input)).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    t.setCost(42000); await expect(t.service.confirmSupplierCheckout({ ...input, ticketChannelId: LOG })).rejects.toMatchObject({ code: 'TICKET_REQUIRED' });
    expect(t.createOrder).not.toHaveBeenCalled();
  });
  it('exposes customer-scoped lists/status without import costs or payloads', async () => {
    const t = setup(); const o = await t.create();
    expect(t.service.listSupplierOrdersForCustomer(t.context)).toHaveLength(1);
    expect(t.service.listSupplierOrdersForCustomer({ ...t.context, customerId: OTHER })).toEqual([]);
    const status = t.service.getSupplierOrderForCustomer({ ...t.context, orderCode: o.order_code });
    expect(status).not.toHaveProperty('max_unit_cost'); expect(status).not.toHaveProperty('request_json');
    expect(() => t.service.getSupplierOrderForCustomer({ ...t.context, customerId: OTHER, orderCode: o.order_code })).toThrow();
  });
  it('persists inert Markdown/mentions for all generic order cards while retaining the exact reviewed name privately', async () => {
    const t = setup();
    const sourceName = '**@everyone** <@&123456789012345678> [Offer](https://supplier.invalid) `secret`\n# notice';
    t.getQuote.mockImplementation(async (key, quantity) => ({ ...t.quote(key, quantity), productName: sourceName }));
    const o = await t.create();
    expect(o.product_name).toBe('\\[AutoBuy\\] \\*\\*＠everyone\\*\\* ‹＠&123456789012345678› \\[Offer\\]\\(https:\u200b//supplier.invalid\\) \\`secret\\` \\# notice');
    expect(o.product_name).not.toMatch(/@everyone|<@|\n|https:\/\//);
    expect(t.intent(o.order_code).product_name).toBe(sourceName);
    expect(t.service.getSupplierOrderForCustomer({ ...t.context, orderCode: o.order_code }).productName).toBe(sourceName);
    t.pay(o.order_code); await t.service.fulfillSupplierOrder({}, o.order_code);
    await t.service.processPendingSupplierOrders({}, 3);
    expect(t.notifyCompletion.mock.calls[0][1].product_name).toBe(o.product_name);
  });
  it('preserves an honest official-price benchmark disclosure for customer confirmation', async () => {
    const t = setup(); t.getQuote.mockImplementation(async (key, quantity) => ({ ...t.quote(key, quantity), comparisonDisclosure: 'Tham khảo gói cá nhân; loại tài khoản được shop cấp khác gói chính hãng.' }));
    expect(await t.service.prepareSupplierCheckout({ ...t.context, productKey: PRODUCT })).toHaveProperty('comparisonDisclosure', 'Tham khảo gói cá nhân; loại tài khoản được shop cấp khác gói chính hãng.');
  });
  it('allows customer invoice preparation without reading an unfunded source wallet', async () => {
    const t = setup(); const o = await t.create(); t.provider.getBalance.mockResolvedValue({ currency: 'VND', balanceVnd: 0 });
    await expect(t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: o.order_code })).resolves.toMatchObject({ paymentStatus: 'UNPAID' });
    expect(t.provider.getBalance).not.toHaveBeenCalled();
    expect(t.provider.createOrder).not.toHaveBeenCalled();
    expect(t.database.prepare('SELECT payment_status,amount_paid FROM orders WHERE order_code=?').get(o.order_code)).toEqual({ payment_status: 'UNPAID', amount_paid: 0 });
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM wallet_transactions').get().n).toBe(0);
  });
  it.each([
    { encrypt: () => { throw new Error('missing key'); } },
    { encrypt: () => 'plaintext' },
    { decrypt: () => 'not-the-encrypted-value' },
  ])('rejects broken encryption before source reads or customer-payment preparation', async settings => {
    const t = setup({ settings }); const o = await t.create(); t.getQuote.mockClear();
    await expect(t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: o.order_code })).rejects.toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' });
    expect(t.getQuote).not.toHaveBeenCalled(); expect(t.provider.getBalance).not.toHaveBeenCalled();
    expect(t.provider.getStock).not.toHaveBeenCalled(); expect(t.provider.createOrder).not.toHaveBeenCalled();
    expect(t.database.prepare('SELECT payment_status,amount_paid FROM orders WHERE order_code=?').get(o.order_code)).toEqual({ payment_status: 'UNPAID', amount_paid: 0 });
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM wallet_transactions').get().n).toBe(0);
  });
  it('does not reserve source wallet funds for other unpaid invoices or paid waiting purchases', async () => {
    const t = setup(); const a = await t.create(); const b = await t.create();
    t.database.exec('CREATE TABLE supplier_autobuy_payment_methods(order_code TEXT PRIMARY KEY,method TEXT,created_at TEXT)');
    t.database.prepare("INSERT INTO supplier_autobuy_payment_methods VALUES(?,'PAYOS','2026-11-10T16:00:00Z')").run(a.order_code);
    t.provider.getBalance.mockResolvedValue({ currency: 'VND', balanceVnd: 0 });
    await expect(t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: b.order_code })).resolves.toBeTruthy();
    t.pay(a.order_code); t.database.prepare("UPDATE supplier_autobuy_intents SET status='WAITING_SUPPLIER_FUNDS' WHERE order_code=?").run(a.order_code);
    await expect(t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: b.order_code })).resolves.toBeTruthy();
    t.database.prepare("UPDATE supplier_autobuy_intents SET status='PURCHASED',encrypted_payload='enc:v1:existing' WHERE order_code=?").run(a.order_code);
    await expect(t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: b.order_code })).resolves.toBeTruthy();
    t.database.prepare("UPDATE supplier_autobuy_intents SET encrypted_payload=NULL WHERE order_code=?").run(a.order_code);
    t.database.prepare("UPDATE orders SET status='CANCELLED',payment_status='CANCELLED' WHERE order_code=?").run(a.order_code);
    await expect(t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: b.order_code })).resolves.toBeTruthy();
    expect(t.provider.getBalance).not.toHaveBeenCalled();
  });
  it('holds the last finite item for the first selected invoice before any second customer payment', async () => {
    const t = setup(); const a = await t.create(); const b = await t.create();
    t.database.exec('CREATE TABLE supplier_autobuy_payment_methods(order_code TEXT PRIMARY KEY,method TEXT,created_at TEXT)');
    const choose = code => t.database.prepare("INSERT INTO supplier_autobuy_payment_methods VALUES(?,'PAYOS','2026-11-10T16:00:00Z')").run(code);
    t.provider.getStock.mockResolvedValue([{ productKey: PRODUCT, name: 'Subscription 1 tháng', priceVnd: 42000, stock: 1, unlimited: false }]);
    choose(a.order_code);
    await expect(t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: a.order_code })).resolves.toBeTruthy();
    choose(b.order_code); t.provider.getBalance.mockClear();
    await expect(t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: b.order_code })).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
    expect(t.provider.getBalance).not.toHaveBeenCalled(); expect(t.provider.createOrder).not.toHaveBeenCalled();
    expect(t.database.prepare('SELECT DISTINCT payment_status FROM orders').all()).toEqual([{ payment_status: 'UNPAID' }]);
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM wallet_transactions').get().n).toBe(0);
  });
  it('retains unknown purchase quantities conservatively, allows unlimited stock, and releases verified cancellations', async () => {
    const t = setup(); const a = await t.create(); const b = await t.create(); t.pay(a.order_code);
    t.database.prepare("UPDATE supplier_autobuy_intents SET status='UNKNOWN' WHERE order_code=?").run(a.order_code);
    const stock = { productKey: PRODUCT, name: 'Subscription 1 tháng', priceVnd: 42000, stock: 1, unlimited: false };
    t.provider.getStock.mockResolvedValue([stock]);
    await expect(t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: b.order_code })).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
    t.provider.getStock.mockResolvedValue([{ ...stock, stock: -1, unlimited: true }]);
    await expect(t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: b.order_code })).resolves.toBeTruthy();
    t.provider.getStock.mockResolvedValue([stock]);
    t.database.prepare("UPDATE orders SET status='CANCELLED',payment_status='CANCELLED' WHERE order_code=?").run(a.order_code);
    await expect(t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: b.order_code })).resolves.toBeTruthy();
  });
  it.each([{ name: 'Replaced product' }, { priceVnd: 43000 }, { priceVnd: NaN }])('rejects a fresh source name/cost mismatch before accepting payment: %j', async patch => {
    const t = setup(); const o = await t.create();
    t.provider.getStock.mockResolvedValue([{ productKey: PRODUCT, name: 'Subscription 1 tháng', priceVnd: 42000, stock: 1, unlimited: false, ...patch }]);
    await expect(t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: o.order_code })).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    expect(t.provider.getBalance).not.toHaveBeenCalled(); expect(t.provider.createOrder).not.toHaveBeenCalled();
  });
});

describe('immutable supplier payment agreement', () => {
  it('rejects an observed fresh source lock before invoice or wallet admission', async () => {
    const t = setup(); const o = await t.create();
    t.provider.getStock.mockResolvedValue([{ productKey: PRODUCT, name: 'Subscription 1 tháng', priceVnd: 42000,
      stock: 20, unlimited: false, locked: true }]);
    await expect(t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: o.order_code }))
      .rejects.toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
    expect(t.provider.getBalance).not.toHaveBeenCalled(); expect(t.provider.createOrder).not.toHaveBeenCalled();
    expect(t.database.prepare('SELECT payment_status,amount_paid FROM orders WHERE order_code=?').get(o.order_code))
      .toEqual({ payment_status: 'UNPAID', amount_paid: 0 });
    expect(t.database.prepare('SELECT COUNT(*) AS total FROM wallet_transactions').get().total).toBe(0);
  });
  it.each(['before', 'quote', 'stock'].flatMap(stage => ['total_amount', 'quantity'].map(field => ({ stage, field }))))
    ('rejects an edited $field $stage preflight instead of invoicing against another immutable intent', async ({ stage, field }) => {
      const t = setup(); const o = await t.create();
      const edit = () => t.database.prepare(`UPDATE orders SET ${field}=${field}+1 WHERE order_code=?`).run(o.order_code);
      t.getQuote.mockClear();
      if (stage === 'before') edit();
      if (stage === 'quote') t.getQuote.mockImplementationOnce(async (key, quantity) => { edit(); return t.quote(key, quantity); });
      if (stage === 'stock') t.provider.getStock.mockImplementationOnce(async () => {
        edit(); return [{ productKey: PRODUCT, name: 'Subscription 1 tháng', priceVnd: 42000, stock: 20, unlimited: false }];
      });
      await expect(t.service.validateSupplierOrderForPayment({ ...t.context, orderCode: o.order_code }))
        .rejects.toMatchObject({ code: 'ORDER_CHANGED' });
      if (stage === 'before') { expect(t.getQuote).not.toHaveBeenCalled(); expect(t.provider.getStock).not.toHaveBeenCalled(); }
      expect(t.provider.createOrder).not.toHaveBeenCalled();
      expect(t.intent(o.order_code)).toMatchObject({ sale_amount: o.total_amount, quantity: o.quantity, attempts: 0 });
    });
});

describe('paid-only supplier fulfillment and recovery', () => {
  it('quarantines an observed fresh source lock before source funds checks or a POST', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    t.provider.getStock.mockResolvedValue([{ productKey: PRODUCT, name: 'Subscription 1 tháng', priceVnd: 42000,
      stock: 20, unlimited: false, locked: true }]);
    expect((await t.service.fulfillSupplierOrder({}, o.order_code)).status).toBe('REVIEW');
    expect(t.intent(o.order_code)).toMatchObject({ status: 'REVIEW', last_error: 'PRODUCT_LOCKED', attempts: 0 });
    expect(t.provider.getBalance).not.toHaveBeenCalled(); expect(t.provider.createOrder).not.toHaveBeenCalled();
    expect(t.sendDelivery).not.toHaveBeenCalled();
  });
  it('keeps a paid unfunded order waiting beyond24h without buying, attempts, or cancellation', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    t.provider.getBalance.mockResolvedValue({currency:'VND',balanceVnd:0});
    const requestId=t.intent(o.order_code).request_id;
    expect((await t.service.fulfillSupplierOrder({},o.order_code)).status).toBe('WAITING_SUPPLIER_FUNDS');
    expect(t.intent(o.order_code)).toMatchObject({status:'WAITING_SUPPLIER_FUNDS',attempts:0,request_id:requestId});
    t.advance(25*3600000);await t.service.processPendingSupplierOrders({},3);
    expect(t.database.prepare('SELECT status,payment_status,amount_paid FROM orders WHERE order_code=?').get(o.order_code))
      .toEqual({status:'PROCESSING',payment_status:'PAID',amount_paid:72000});
    expect(t.intent(o.order_code)).toMatchObject({status:'WAITING_SUPPLIER_FUNDS',attempts:0,request_id:requestId});
    expect(t.provider.createOrder).not.toHaveBeenCalled();expect(t.sendDelivery).not.toHaveBeenCalled();
  });
  it('survives a waiting-state restart then automatically buys and delivers exactly once after sufficient topup', async () => {
    const t=setup();const o=await t.create();t.pay(o.order_code);
    t.provider.getBalance.mockResolvedValue({currency:'VND',balanceVnd:0});
    await t.service.fulfillSupplierOrder({},o.order_code);const requestId=t.intent(o.order_code).request_id;
    const restarted=createSupplierAutobuyOrderService(t.settings);
    t.advance(5*60000+1);await restarted.processPendingSupplierOrders({},3);
    expect(t.intent(o.order_code)).toMatchObject({status:'WAITING_SUPPLIER_FUNDS',attempts:0,request_id:requestId});
    expect(t.provider.createOrder).not.toHaveBeenCalled();
    t.provider.getBalance.mockResolvedValue({currency:'VND',balanceVnd:42000});
    t.advance(5*60000+1);await restarted.processPendingSupplierOrders({},3);
    expect(t.provider.createOrder).toHaveBeenCalledTimes(1);
    expect(t.provider.createOrder.mock.calls[0][0]).toMatchObject({requestId,productKey:PRODUCT,quantity:1});
    expect(t.intent(o.order_code)).toMatchObject({status:'DELIVERED',attempts:1,request_id:requestId});
    expect(t.sendDelivery).toHaveBeenCalledTimes(1);expect(t.markOrderCompleted).toHaveBeenCalledTimes(1);
    t.advance(5*60000+1);await restarted.processPendingSupplierOrders({},3);
    await restarted.fulfillSupplierOrder({},o.order_code);
    expect(t.provider.createOrder).toHaveBeenCalledTimes(1);expect(t.sendDelivery).toHaveBeenCalledTimes(1);
  });
  it('uses partial source funding only for affordable paid orders and resumes the remaining order later', async () => {
    const t=setup();const large=await t.create(2);const small=await t.create();t.pay(large.order_code);t.pay(small.order_code);
    let wallet=42000;
    t.provider.getBalance.mockImplementation(async()=>({currency:'VND',balanceVnd:wallet}));
    const purchase=t.provider.createOrder.getMockImplementation();
    t.provider.createOrder.mockImplementation(async request=>{
      const total=42000*request.quantity;expect(wallet).toBeGreaterThanOrEqual(total);wallet-=total;
      return purchase(request);
    });
    await t.service.processPendingSupplierOrders({},3);
    expect(t.intent(large.order_code)).toMatchObject({status:'WAITING_SUPPLIER_FUNDS',attempts:0});
    expect(t.intent(small.order_code)).toMatchObject({status:'DELIVERED',attempts:1});
    expect(t.provider.createOrder).toHaveBeenCalledTimes(1);expect(wallet).toBe(0);
    wallet=84000;t.advance(5*60000+1);await t.service.processPendingSupplierOrders({},3);
    expect(t.intent(large.order_code)).toMatchObject({status:'DELIVERED',attempts:1});
    expect(t.provider.createOrder).toHaveBeenCalledTimes(2);expect(wallet).toBe(0);
    expect(new Set(t.provider.createOrder.mock.calls.map(([request])=>request.requestId)).size).toBe(2);
  });
  it.each(['CANCELLED','REFUNDED'])('never buys a formerly waiting paid order after it becomes %s', async status=>{
    const t=setup();const o=await t.create();t.pay(o.order_code);
    t.provider.getBalance.mockResolvedValue({currency:'VND',balanceVnd:0});await t.service.fulfillSupplierOrder({},o.order_code);
    t.database.prepare('UPDATE orders SET status=?,payment_status=? WHERE order_code=?').run(status,status,o.order_code);
    t.provider.getBalance.mockResolvedValue({currency:'VND',balanceVnd:100000});t.provider.getBalance.mockClear();
    t.advance(5*60000+1);await t.service.processPendingSupplierOrders({},3);await t.service.fulfillSupplierOrder({},o.order_code);
    expect(t.provider.getBalance).not.toHaveBeenCalled();expect(t.provider.createOrder).not.toHaveBeenCalled();
    expect(t.intent(o.order_code).attempts).toBe(0);
  });
  it('makes no purchase for unpaid/underpaid/cancelled/refunded orders or another guild', async () => {
    const t = setup(); const o = await t.create();
    await t.service.fulfillSupplierOrder({}, o.order_code); expect(t.provider.createOrder).not.toHaveBeenCalled();
    t.pay(o.order_code); t.database.prepare('UPDATE orders SET amount_paid=1 WHERE order_code=?').run(o.order_code);
    await t.service.fulfillSupplierOrder({}, o.order_code); expect(t.provider.createOrder).not.toHaveBeenCalled();
    t.pay(o.order_code); t.database.prepare("UPDATE orders SET status='CANCELLED' WHERE order_code=?").run(o.order_code);
    await t.service.fulfillSupplierOrder({}, o.order_code); expect(t.provider.createOrder).not.toHaveBeenCalled();
    t.pay(o.order_code); t.database.prepare("INSERT INTO wallet_transactions VALUES(?,?,?,'REFUND',100)").run(STORE_ONE_GUILD_ID, CUSTOMER, o.order_code);
    await t.service.fulfillSupplierOrder({}, o.order_code); expect(t.provider.createOrder).not.toHaveBeenCalled();
  });
  it('atomically coalesces duplicate payments, encrypts before DM and completes once', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    const first = t.service.fulfillSupplierOrder({}, o.order_code);
    expect(t.service.fulfillSupplierOrder({}, o.order_code)).toBe(first);
    expect((await first).delivered).toBe(true);
    expect(t.provider.createOrder).toHaveBeenCalledTimes(1); expect(t.sendDelivery).toHaveBeenCalledTimes(1);
    expect(t.intent(o.order_code).encrypted_payload).toMatch(/^enc:v1:/);
    expect(JSON.stringify(t.intent(o.order_code))).not.toContain('private-password');
    expect(t.markOrderCompleted).toHaveBeenCalledTimes(1);
    await t.service.fulfillSupplierOrder({}, o.order_code);
    expect(t.provider.createOrder).toHaveBeenCalledTimes(1);
  });
  it('reuses the durable request across a timeout and process restart, never a fresh purchase ID', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    t.provider.createOrder.mockRejectedValueOnce(new DopermindError('TIMEOUT', { operation: 'createOrder', outcome: 'UNKNOWN' }));
    expect((await t.service.fulfillSupplierOrder({}, o.order_code)).status).toBe('UNKNOWN');
    const request = t.provider.createOrder.mock.calls[0][0]; t.advance(120001);
    const restarted = createSupplierAutobuyOrderService(t.settings);
    expect((await restarted.fulfillSupplierOrder({}, o.order_code)).status).toBe('WAITING_RECONCILIATION');
    await restarted.processPendingSupplierOrders({}, 3);
    expect(t.provider.createOrder).toHaveBeenCalledTimes(2);
    expect({ ...t.provider.createOrder.mock.calls[1][0], beforeSubmit: undefined }).toEqual({ ...request, beforeSubmit: undefined });
    expect(t.provider.getBalance).toHaveBeenCalledTimes(1);
    expect(t.intent(o.order_code).status).toBe('DELIVERED');
  });
  it('recovers a crash with a submitting lease using the same persisted ID only after lease expiry', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code); const original = t.intent(o.order_code).request_id;
    t.database.prepare("UPDATE supplier_autobuy_intents SET status='SUBMITTING',lease_token='dead-process',lease_until=? WHERE order_code=?")
      .run(new Date(Date.parse('2026-11-10T16:00:00Z') + 120000).toISOString(), o.order_code);
    await t.service.processPendingSupplierOrders({}, 3); expect(t.provider.createOrder).not.toHaveBeenCalled();
    t.advance(120001); await t.service.processPendingSupplierOrders({}, 3);
    expect(t.provider.createOrder.mock.calls[0][0].requestId).toBe(original);
  });
  it('retries a blocked DM from encrypted payload without purchasing again', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code); t.sendDelivery.mockRejectedValueOnce(new Error('private-DM-data'));
    expect((await t.service.fulfillSupplierOrder({}, o.order_code)).status).toBe('DELIVERY_PENDING');
    expect(t.intent(o.order_code).last_error).toBe('DELIVERY_RETRY'); t.advance(120001);
    await t.service.processPendingSupplierOrders({}, 3);
    expect(t.provider.createOrder).toHaveBeenCalledTimes(1); expect(t.sendDelivery).toHaveBeenCalledTimes(2);
    expect(t.intent(o.order_code).status).toBe('DELIVERED');
  });
  it('keeps two process instances from concurrently submitting the same paid intent', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    let release;
    t.provider.getStock.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = t.service.fulfillSupplierOrder({}, o.order_code);
    await Promise.resolve(); await Promise.resolve();
    const otherProcess = createSupplierAutobuyOrderService(t.settings);
    expect((await otherProcess.fulfillSupplierOrder({}, o.order_code)).status).toBe('BUSY');
    release([{ productKey: PRODUCT, priceVnd: 42000, stock: 2, unlimited: false }]);
    await first; expect(t.provider.createOrder).toHaveBeenCalledTimes(1);
  });
  it.each(['getStock', 'getBalance'].flatMap(stage => [
    { stage, change: 'pause', expected: 'PENDING' },
    { stage, change: 'manual-completion', expected: 'REVIEW' },
    { stage, change: 'lease-replaced', expected: 'LEASE_LOST' },
    { stage, change: 'lease-expired', expected: 'LEASE_LOST' },
  ]))('revalidates $change after awaiting $stage and before any source POST', async ({ stage, change, expected }) => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    const requestId = t.intent(o.order_code).request_id;
    let release;
    t.provider[stage].mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const work = t.service.fulfillSupplierOrder({}, o.order_code);
    for (let step = 0; !release && step < 10; step++) await Promise.resolve();
    expect(release).toBeTypeOf('function');
    if (change === 'pause') t.setEnabled(false);
    if (change === 'manual-completion') t.database.prepare("UPDATE orders SET status='COMPLETED' WHERE order_code=?").run(o.order_code);
    if (change === 'lease-replaced') t.database.prepare("UPDATE supplier_autobuy_intents SET lease_token='newer-worker' WHERE order_code=?").run(o.order_code);
    if (change === 'lease-expired') t.advance(120001);
    release(stage === 'getStock' ? [{ productKey: PRODUCT, name: 'Subscription 1 tháng', priceVnd: 42000, stock: 20, unlimited: false }]
      : { currency: 'VND', balanceVnd: 1000000 });
    expect((await work).status).toBe(expected);
    expect(t.provider.createOrder).not.toHaveBeenCalled(); expect(t.sendDelivery).not.toHaveBeenCalled();
    expect(t.intent(o.order_code)).toMatchObject({ request_id: requestId, attempts: 0 });
    if (change === 'manual-completion') expect(t.intent(o.order_code).last_error).toBe('MANUAL_COMPLETION_UNVERIFIED');
    if (change === 'lease-replaced') expect(t.intent(o.order_code).lease_token).toBe('newer-worker');
  });
  it('rejects a rewritten persisted request identity even if its new JSON/hash agree', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    t.provider.getBalance.mockImplementationOnce(async () => {
      const current = t.intent(o.order_code), requestId = current.request_id + '-changed';
      const request = JSON.stringify({ product_key: current.product_key, quantity: current.quantity, request_id: requestId });
      t.database.prepare('UPDATE supplier_autobuy_intents SET request_id=?,request_json=?,request_hash=? WHERE order_code=?')
        .run(requestId, request, createHash('sha256').update(request).digest('hex'), o.order_code);
      return { currency: 'VND', balanceVnd: 1000000 };
    });
    expect((await t.service.fulfillSupplierOrder({}, o.order_code)).status).toBe('REVIEW');
    expect(t.provider.createOrder).not.toHaveBeenCalled(); expect(t.intent(o.order_code).attempts).toBe(0);
  });
  it('requires the conditional attempt update to claim exactly one row before a source POST', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    t.database.exec(`CREATE TRIGGER suppress_attempt BEFORE UPDATE OF attempts ON supplier_autobuy_intents
      WHEN NEW.attempts > OLD.attempts BEGIN SELECT RAISE(IGNORE); END;`);
    expect((await t.service.fulfillSupplierOrder({}, o.order_code)).status).toBe('LEASE_LOST');
    expect(t.provider.createOrder).not.toHaveBeenCalled(); expect(t.intent(o.order_code).attempts).toBe(0);
  });
  it.each([
    { change: 'pause', expected: 'PENDING' }, { change: 'manual-completion', expected: 'REVIEW' },
    { change: 'lease-replaced', expected: 'LEASE_LOST' }, { change: 'lease-expired', expected: 'LEASE_LOST' },
  ])('revalidates $change at the actual Dopermind wire boundary after its 5100ms rate wait', async ({ change, expected }) => {
    vi.useFakeTimers(); const started = Date.parse('2026-11-14T05:00:00Z'); vi.setSystemTime(started);
    const t = setup({ time: started }); const o = await t.create(); t.pay(o.order_code);
    const requestId = t.intent(o.order_code).request_id;
    const fetchImpl = vi.fn(async (_url, options) => {
      const request = JSON.parse(options.body);
      return new Response(JSON.stringify({ success: true, data: { request_id: request.request_id,
        product_key: request.product_key, quantity: request.quantity, order_code: 'API_SYNTHETIC_WIRE',
        unit_price: 42000, total_amount: 42000 * request.quantity, balance_after: 100000,
        created_at: new Date(Date.now()).toISOString(), idempotent: false, items: ['synthetic-private-item'] } }),
      { headers: { 'content-type': 'application/json' } });
    });
    const transport = createDopermindClient({ apiKey: `synthetic-engine-wire-${change}`, fetchImpl, enforceRateLimits: true, timeoutMs: 10000 });
    await transport.createOrder({ productKey: PRODUCT, quantity: 1, requestId: 'warm-wire-fence', maxUnitCostVnd: 42000 });
    const engine = createSupplierAutobuyOrderService({ ...t.settings,
      providerFactory: () => ({ ...t.provider, createOrder: transport.createOrder }) });
    const work = engine.fulfillSupplierOrder({}, o.order_code);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(t.intent(o.order_code).attempts).toBe(0);
    if (change === 'pause') t.setEnabled(false);
    if (change === 'manual-completion') t.database.prepare("UPDATE orders SET status='COMPLETED' WHERE order_code=?").run(o.order_code);
    if (change === 'lease-replaced') t.database.prepare("UPDATE supplier_autobuy_intents SET lease_token='newer-wire-worker' WHERE order_code=?").run(o.order_code);
    if (change === 'lease-expired') t.advance(120001);
    await vi.advanceTimersByTimeAsync(5100);
    expect((await work).status).toBe(expected);
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(t.sendDelivery).not.toHaveBeenCalled();
    expect(t.intent(o.order_code)).toMatchObject({ request_id: requestId, attempts: 0 });
    if (change === 'lease-replaced') expect(t.intent(o.order_code).lease_token).toBe('newer-wire-worker');
  });
  it('retains UNKNOWN reconciliation and its request identity when paused before replay, then resumes safely', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    t.provider.createOrder.mockRejectedValueOnce(new DopermindError('TIMEOUT', { outcome: 'UNKNOWN' }));
    expect((await t.service.fulfillSupplierOrder({}, o.order_code)).status).toBe('UNKNOWN');
    const requestId = t.intent(o.order_code).request_id; t.advance(120001);
    t.provider.getStock.mockImplementationOnce(async () => {
      t.setEnabled(false); return [{ productKey: PRODUCT, name: 'Subscription 1 tháng', priceVnd: 42000, stock: 20, unlimited: false }];
    });
    expect((await t.service.fulfillSupplierOrder({}, o.order_code, { allowReconcile: true })).status).toBe('UNKNOWN');
    expect(t.intent(o.order_code)).toMatchObject({ status: 'UNKNOWN', request_id: requestId, attempts: 1, lease_token: null });
    expect(t.provider.createOrder).toHaveBeenCalledOnce();
    t.setEnabled(true); t.advance(120001); await t.service.processPendingSupplierOrders({}, 1);
    expect(t.intent(o.order_code)).toMatchObject({ status: 'DELIVERED', request_id: requestId, attempts: 2 });
    expect(t.provider.createOrder.mock.calls.map(([request]) => request.requestId)).toEqual([requestId, requestId]);
    expect(t.sendDelivery).toHaveBeenCalledOnce();
  });
  it('retains a valid charged receipt for review if an adapter ignored its required submission hook', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    const requestId = t.intent(o.order_code).request_id;
    const noncompliant = createSupplierAutobuyOrderService({ ...t.settings, providerFactory: () => t.provider });
    expect((await noncompliant.fulfillSupplierOrder({}, o.order_code)).status).toBe('REVIEW');
    expect(t.intent(o.order_code)).toMatchObject({ status: 'REVIEW', last_error: 'SUBMISSION_GUARD_MISSING',
      request_id: requestId, attempts: 0, charged_unit_cost: 42000, charged_total_cost: 42000, supplier_order_code: 'API_TEST_1' });
    expect(t.intent(o.order_code).encrypted_payload).toMatch(/^enc:v1:/);
    expect(JSON.stringify(t.intent(o.order_code))).not.toContain('private-password');
    expect(t.sendDelivery).not.toHaveBeenCalled();
    await noncompliant.fulfillSupplierOrder({}, o.order_code); await noncompliant.processPendingSupplierOrders({}, 3);
    expect(t.provider.createOrder).toHaveBeenCalledOnce(); expect(t.sendDelivery).not.toHaveBeenCalled();
  });
  it('does not expose, deliver, or mark complete a malformed uncertain receipt', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    t.provider.createOrder.mockResolvedValue({ requestId: t.intent(o.order_code).request_id, productKey: PRODUCT, quantity: 1, unitPriceVnd: 42000,
      totalAmountVnd: 42000, items: [] });
    expect((await t.service.fulfillSupplierOrder({}, o.order_code)).status).toBe('UNKNOWN');
    expect(t.sendDelivery).not.toHaveBeenCalled(); expect(t.markOrderCompleted).not.toHaveBeenCalled();
    expect(() => t.service.getSupplierDeliveryForCustomer({ ...t.context, orderCode: o.order_code })).toThrow();
  });
  it('holds out-of-stock before sending a purchase and never regenerates its intent', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code); const id = t.intent(o.order_code).request_id;
    t.provider.getStock.mockResolvedValue([{ productKey: PRODUCT, priceVnd: 42000, stock: 0, unlimited: false }]);
    expect((await t.service.fulfillSupplierOrder({}, o.order_code)).status).toBe('WAITING_STOCK');
    expect(t.provider.getBalance).not.toHaveBeenCalled(); expect(t.provider.createOrder).not.toHaveBeenCalled();
    expect(t.intent(o.order_code).request_id).toBe(id);
  });
  it('never purchases on a late payment retry when staff already completed the order without an engine receipt', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    t.database.prepare("UPDATE orders SET status='COMPLETED' WHERE order_code=?").run(o.order_code);
    expect((await t.service.fulfillSupplierOrder({}, o.order_code)).status).toBe('REVIEW');
    expect(t.intent(o.order_code)).toMatchObject({ status: 'REVIEW', last_error: 'MANUAL_COMPLETION_UNVERIFIED', attempts: 0 });
    expect(t.provider.getStock).not.toHaveBeenCalled(); expect(t.provider.getBalance).not.toHaveBeenCalled();
    expect(t.provider.createOrder).not.toHaveBeenCalled(); expect(t.sendDelivery).not.toHaveBeenCalled();
  });
  it('keeps canceled or newly blacklisted orders from receiving previously purchased goods', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code); t.sendDelivery.mockRejectedValue(new Error('DM blocked'));
    await t.service.fulfillSupplierOrder({}, o.order_code); t.setBlocked(true);
    expect(() => t.service.getSupplierDeliveryForCustomer({ ...t.context, orderCode: o.order_code })).toThrow();
    t.setBlocked(false); t.database.prepare("UPDATE orders SET status='REFUNDED',payment_status='REFUNDED' WHERE order_code=?").run(o.order_code);
    expect(() => t.service.getSupplierDeliveryForCustomer({ ...t.context, orderCode: o.order_code })).toThrow();
    t.advance(120001); await t.service.processPendingSupplierOrders({}, 3);
    expect(t.provider.createOrder).toHaveBeenCalledTimes(1);
  });
  it('caps repeated unknown submissions and retains the same request forever for manual reconciliation', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    t.provider.createOrder.mockRejectedValue(new DopermindError('TIMEOUT', { outcome: 'UNKNOWN' }));
    await t.service.fulfillSupplierOrder({}, o.order_code);
    for (let count = 0; count < 5; count++) { t.advance(120001); await t.service.processPendingSupplierOrders({}, 3); }
    expect(t.provider.createOrder).toHaveBeenCalledTimes(5); expect(t.intent(o.order_code).status).toBe('REVIEW');
    expect(new Set(t.provider.createOrder.mock.calls.map(([r]) => r.requestId)).size).toBe(1);
  });
  it('lets the exact paid owner retrieve after DM failure and acknowledges only after a private receipt', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code); t.sendDelivery.mockRejectedValue(new Error('DM blocked'));
    await t.service.fulfillSupplierOrder({}, o.order_code);
    expect(() => t.service.getSupplierDeliveryForCustomer({ ...t.context, customerId: OTHER, orderCode: o.order_code })).toThrow();
    const payload = t.service.getSupplierDeliveryForCustomer({ ...t.context, orderCode: o.order_code });
    expect(payload.items).toEqual(['private-user-0|private-password']); expect(payload).not.toHaveProperty('balanceAfterVnd');
    expect(() => t.service.acknowledgeSupplierDeliveryRetrieval({ ...t.context, orderCode: o.order_code })).toThrow();
    t.service.acknowledgeSupplierDeliveryRetrieval({ ...t.context, orderCode: o.order_code, messageId: MESSAGE, channelId: CHANNEL });
    expect(t.intent(o.order_code).status).toBe('DELIVERED'); expect(t.markOrderCompleted).toHaveBeenCalledTimes(1);
  });
  it.each([{ code: 'NOT_ENOUGH_STOCK', expected: 'WAITING_STOCK' }, { code: 'INSUFFICIENT_BALANCE', expected: 'WAITING_SUPPLIER_FUNDS' },
    { code: 'PRICE_CHANGED', expected: 'REVIEW' }, { code: 'API_REQUEST_CONFLICT', expected: 'REVIEW' },
    { code: 'API_ORDER_MANUALLY_FULFILLED', expected: 'REVIEW' }, { code: 'ORDER_HISTORY_PENDING', expected: 'RECONCILING' }])('handles safe provider state %s without losing identity', async ({ code, expected }) => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    t.provider.createOrder.mockRejectedValue(new DopermindError('REQUEST_REJECTED', { providerCode: code, outcome: 'UNKNOWN', status: 409 }));
    const before = t.intent(o.order_code).request_id;
    expect((await t.service.fulfillSupplierOrder({}, o.order_code)).status).toBe(expected);
    expect(t.intent(o.order_code).request_id).toBe(before); expect(t.sendDelivery).not.toHaveBeenCalled();
  });
  it('does not replay a CDK order that the provider marked for delivery review', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    t.provider.createOrder.mockRejectedValue(new CdkVietnamError('REQUEST_REJECTED', {
      operation: 'createOrder', status: 409, outcome: 'UNKNOWN', providerCode: 'DELIVERY_REVIEW',
    }));
    expect((await t.service.fulfillSupplierOrder({}, o.order_code)).status).toBe('REVIEW');
    expect(t.intent(o.order_code)).toMatchObject({ status: 'REVIEW', last_error: 'DELIVERY_REVIEW', attempts: 1 });
    t.advance(600001);
    await t.service.processPendingSupplierOrders({}, 3);
    expect(t.provider.createOrder).toHaveBeenCalledTimes(1);
  });
  it('persists a CDK provider order ID and polls it before delivery', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    const providerOrderCode = 'ord_0123456789abcdef0123456789abcdef';
    t.provider.createOrder.mockRejectedValueOnce(new CdkVietnamError('DELIVERY_PENDING', {
      operation: 'createOrder', status: 202, outcome: 'UNKNOWN', providerCode: 'DELIVERY_REVIEW', providerOrderCode,
    }));
    expect((await t.service.fulfillSupplierOrder({}, o.order_code)).status).toBe('RECONCILING');
    expect(t.intent(o.order_code)).toMatchObject({ status: 'RECONCILING', supplier_order_code: providerOrderCode, last_error: 'DELIVERY_REVIEW' });
    t.provider.getOrder = vi.fn(async () => ({ orderCode: providerOrderCode, productId: 6, productName: 'Subscription 1 tháng',
      quantity: 1, unitPriceVnd: 42000, totalAmountVnd: 42000, status: 'delivered', items: ['private-user-0|private-password'] }));
    t.advance(3 * 60000 + 1);
    await t.service.processPendingSupplierOrders({}, 3);
    expect(t.provider.createOrder).toHaveBeenCalledTimes(1);
    expect(t.provider.getOrder).toHaveBeenCalledWith({ orderId: providerOrderCode });
    expect(t.sendDelivery).toHaveBeenCalledTimes(1);
    expect(t.intent(o.order_code).status).toBe('DELIVERED');
  });
  it('blocks a higher fresh cost before purchase and stores an unexpected higher-charge receipt for review', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code); t.setCost(45000);
    expect((await t.service.fulfillSupplierOrder({}, o.order_code)).status).toBe('REVIEW'); expect(t.provider.createOrder).not.toHaveBeenCalled();
    const v = setup(); const p = await v.create(); v.pay(p.order_code);
    v.provider.createOrder.mockImplementation(async r => ({ requestId: r.requestId, productKey: r.productKey, quantity: 1, orderCode: 'API_OVER',
      unitPriceVnd: 45000, totalAmountVnd: 45000, items: ['private-overcharged-item'] }));
    expect((await v.service.fulfillSupplierOrder({}, p.order_code)).status).toBe('REVIEW');
    expect(v.intent(p.order_code).encrypted_payload).toMatch(/^enc:v1:/); expect(v.intent(p.order_code).last_error).toBe('PRICE_LIMIT_EXCEEDED');
    expect(v.sendDelivery).not.toHaveBeenCalled();
  });
  it('will not replay an unknown outcome at a now-higher current cost', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code);
    t.provider.createOrder.mockRejectedValueOnce(new DopermindError('TIMEOUT', { outcome: 'UNKNOWN' }));
    await t.service.fulfillSupplierOrder({}, o.order_code); t.advance(120001); t.setCost(45000);
    await t.service.processPendingSupplierOrders({}, 3); expect(t.provider.createOrder).toHaveBeenCalledTimes(1);
    expect(t.intent(o.order_code).status).toBe('REVIEW');
  });
  it('keeps an unsubmitted preflight failure in PENDING rather than bypassing checks as an UNKNOWN replay', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code); t.provider.getStock.mockRejectedValueOnce(new Error('private-upstream-message'));
    expect((await t.service.fulfillSupplierOrder({}, o.order_code)).status).toBe('PENDING'); expect(t.provider.createOrder).not.toHaveBeenCalled();
    expect(t.intent(o.order_code).last_error).toBe('PROVIDER_UNAVAILABLE');
  });
  it('does not purchase when encryption, provider funds, or stock are unavailable', async () => {
    const t = setup({ settings: { encrypt: () => { throw new Error('missing secret'); } } }); const o = await t.create(); t.pay(o.order_code);
    expect((await t.service.fulfillSupplierOrder({}, o.order_code)).status).toBe('REVIEW'); expect(t.provider.createOrder).not.toHaveBeenCalled();
    const u = setup(); const p = await u.create(); u.pay(p.order_code); u.provider.getBalance.mockResolvedValue({ currency: 'VND', balanceVnd: 0 });
    expect((await u.service.fulfillSupplierOrder({}, p.order_code)).status).toBe('WAITING_SUPPLIER_FUNDS'); expect(u.provider.createOrder).not.toHaveBeenCalled();
  });
  it('keeps completion notifications at most once across repeats and does not retry a failed public notice', async () => {
    const t = setup(); const o = await t.create(); t.pay(o.order_code); t.notifyCompletion.mockRejectedValue(new Error('private-completion-error'));
    await t.service.fulfillSupplierOrder({}, o.order_code); await t.service.processCompletionNotices({});
    await t.service.processCompletionNotices({}); expect(t.notifyCompletion).toHaveBeenCalledTimes(1);
    expect(t.database.prepare('SELECT status FROM supplier_autobuy_completion_notices WHERE order_code=?').get(o.order_code).status).toBe('FAILED');
    expect(t.provider.createOrder).toHaveBeenCalledTimes(1);
  });
});

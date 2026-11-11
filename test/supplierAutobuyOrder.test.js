import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupplierAutobuyOrderService } from '../src/services/supplierAutobuyOrderService.js';
import { DopermindError } from '../src/services/dopermindClient.js';
import { CdkVietnamError } from '../src/services/cdkVietnamClient.js';
import { STORE_ONE_GUILD_ID } from '../src/utils/locale.js';

const CUSTOMER = '111111111111111111';
const OTHER = '222222222222222222';
const CHANNEL = '333333333333333333';
const LOG = '444444444444444444';
const MESSAGE = '555555555555555555';
const PRODUCT = 'desc_test-product';
const open = [];
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
    providerFactory: () => provider, enabled: () => enabled, customerBlocked: () => blocked,
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

describe('paid-only supplier fulfillment and recovery', () => {
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
    expect(t.provider.createOrder.mock.calls[1][0]).toEqual(request);
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

import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { afterEach, it as test, vi, expect } from 'vitest';
const mock = { fn: vi.fn, timers: { enable: () => vi.useFakeTimers(), tick: ms => vi.advanceTimersByTime(ms), reset: () => vi.useRealTimers() } };
afterEach(() => vi.useRealTimers());
import { createSupplierAutobuyOrderService } from '../src/services/supplierAutobuyOrderService.js';
import { createSupplierDeliveryService, getSupplierAutobuyDeliveryHealth } from '../src/services/supplierAutobuyDeliveryService.js';

const GUILD = '1282637033340403754', CUSTOMER = '111111111111111111', CHANNEL = '333333333333333333';
const MESSAGE = '555555555555555555', LOG = '444444444444444444', KEY = 'desc_synthetic-delivery';
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture(databasePath = ':memory:') {
  const database = new Database(databasePath);
  database.exec(`CREATE TABLE tickets(id INTEGER PRIMARY KEY,guild_id TEXT,customer_id TEXT,channel_id TEXT,status TEXT);
    CREATE TABLE orders(order_code TEXT PRIMARY KEY,guild_id TEXT,customer_id TEXT,product_name TEXT,product_id INTEGER,
      ticket_id INTEGER,ticket_channel_id TEXT,order_log_channel_id TEXT,quantity INTEGER,total_amount INTEGER,amount_paid INTEGER,
      payment_status TEXT,status TEXT,fulfillment_mode TEXT,created_at TEXT,delivered_at TEXT);
    CREATE TABLE wallet_transactions(guild_id TEXT,customer_id TEXT,related_code TEXT,type TEXT,amount INTEGER);`);
  database.prepare("INSERT INTO tickets VALUES(1,?,?,?,'OPEN')").run(GUILD, CUSTOMER, CHANNEL);
  let time = Date.parse('2026-11-14T00:00:00Z');
  const readOrder = code => database.prepare('SELECT * FROM orders WHERE order_code=?').get(code);
  const provider = {
    getStock: mock.fn(async () => [{ productKey: KEY, name: 'Synthetic subscription', priceVnd: 42000, stock: 20 }]),
    getBalance: mock.fn(async () => ({ currency: 'VND', balanceVnd: 1000000 })),
    createOrder: mock.fn(async request => {
      assert.equal(request.beforeSubmit(), true);
      return { requestId: request.requestId, productKey: KEY, quantity: 1, orderCode: 'synthetic-source-order',
        unitPriceVnd: 42000, totalAmountVnd: 42000, items: ['synthetic-private-goods'] };
    }),
  };
  const createOrder = input => {
    database.prepare('INSERT INTO orders VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('CN_100001', GUILD, CUSTOMER,
      input.productName, null, 1, CHANNEL, LOG, 1, input.totalAmount, 0, 'UNPAID', 'PENDING_PAYMENT', 'LEGACY', new Date(time).toISOString(), null);
    return readOrder('CN_100001');
  };
  const settings = { db: database, now: () => time, enabled: () => true, getQuote: async (productKey, quantity) => ({ productKey, quantity,
    productName: 'Synthetic subscription', unitPriceVnd: 72000, totalPriceVnd: 72000, unitCostVnd: 42000, maxUnitCostVnd: 42000,
    durationMonths: 1, termsFingerprint: createHash('sha256').update('synthetic').digest('hex'),
    createdAt: new Date(time).toISOString(), expiresAt: new Date(time + 60000).toISOString(), termText: '1 month', warrantyText: 'Synthetic terms' }),
    createOrder, markOrderCompleted: code => { database.prepare("UPDATE orders SET status='COMPLETED' WHERE order_code=?").run(code); return readOrder(code); },
    encrypt: value => `enc:v1:${Buffer.from(value).toString('base64')}`, decrypt: value => Buffer.from(value.slice(7), 'base64').toString(),
    providerFactory: () => provider, notifyCompletion: async () => {}, reconcileInvoices: async () => {} };
  const service = createSupplierAutobuyOrderService(settings); service.init();
  const send = mock.fn(async () => ({ id: MESSAGE }));
  const fetchWait = deferred();
  const client = { user: { id: '666666666666666666' }, users: { fetch: mock.fn(async () => { await fetchWait.promise; return { id: CUSTOMER,
    createDM: async () => ({ id: CHANNEL, send }) }; }) } };
  async function paid() {
    const context = { guildId: GUILD, customerId: CUSTOMER };
    const quote = await service.prepareSupplierCheckout({ ...context, productKey: KEY });
    const order = await service.confirmSupplierCheckout({ ...context, quoteId: quote.quoteId, ticketId: 1, ticketChannelId: CHANNEL, orderLogChannelId: LOG });
    database.prepare("UPDATE orders SET payment_status='PAID',amount_paid=total_amount,status='PROCESSING' WHERE order_code=?").run(order.order_code);
    return order;
  }
  async function untilFetch() { for (let n = 0; n < 30 && !client.users.fetch.mock.calls.length; n++) await Promise.resolve(); assert.equal(client.users.fetch.mock.calls.length, 1); }
  return { database, service, settings, provider, client, send, fetchWait, paid, untilFetch,
    advance: ms => { time += ms; }, restart: () => createSupplierAutobuyOrderService(settings), journal: () => database.prepare('SELECT * FROM supplier_autobuy_delivery_attempts ORDER BY rowid DESC LIMIT 1').get(), intent: () => database.prepare('SELECT * FROM supplier_autobuy_intents').get() };
}

test('does not send private goods after cancellation while Discord user fetch waits', async () => {
  const t = fixture();
  try {
    const order = await t.paid(), pending = t.service.fulfillSupplierOrder(t.client, order.order_code);
    await t.untilFetch();
    t.database.prepare("UPDATE orders SET status='CANCELLED' WHERE order_code=?").run(order.order_code);
    t.fetchWait.resolve(); await pending;
    assert.equal(t.send.mock.calls.length, 0, 'Cancellation before Discord send must prevent credentials from being sent');
  } finally { t.database.close(); }
});

test('does not allow a timed-out detached Discord fetch to send goods after refund', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const t = fixture();
  try {
    const order = await t.paid(), pending = t.service.fulfillSupplierOrder(t.client, order.order_code);
    await t.untilFetch(); mock.timers.tick(15001);
    assert.equal((await pending).status, 'DELIVERY_PENDING');
    t.database.prepare("UPDATE orders SET status='REFUNDED',payment_status='REFUNDED' WHERE order_code=?").run(order.order_code);
    t.fetchWait.resolve(); for (let n = 0; n < 20; n++) await Promise.resolve();
    assert.equal(t.send.mock.calls.length, 0, 'A detached timed-out operation must not later submit private goods after refund');
  } finally { mock.timers.reset(); t.database.close(); }
});

test('keeps a late successful Discord receipt durable after the delivery deadline', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const t = fixture(), sentWait = deferred();
  try {
    const send = mock.fn(() => sentWait.promise);
    t.client.users.fetch = mock.fn(async () => ({ id: CUSTOMER, createDM: async () => ({ id: CHANNEL, send }) }));
    const order = await t.paid(), pending = t.service.fulfillSupplierOrder(t.client, order.order_code);
    for (let n = 0; n < 30 && !send.mock.calls.length; n++) await Promise.resolve();
    assert.equal(send.mock.calls.length, 1); mock.timers.tick(15001);
    assert.equal((await pending).status, 'DELIVERY_PENDING');
    sentWait.resolve({ id: MESSAGE }); for (let n = 0; n < 20; n++) await Promise.resolve();
    assert.equal(t.intent().dm_message_id, MESSAGE, 'A positively acknowledged already-sent private receipt must survive a late transport result');
  } finally { mock.timers.reset(); t.database.close(); }
});

test.each(['refund', 'owner', 'provider', 'lease'])('fences %s changes after Discord preparation without a new source purchase', async change => {
  const t = fixture();
  try {
    const order = await t.paid(), pending = t.service.fulfillSupplierOrder(t.client, order.order_code);
    await t.untilFetch();
    if (change === 'refund') t.database.prepare("INSERT INTO wallet_transactions VALUES(?,?,?,'REFUND',72000)").run(GUILD, CUSTOMER, order.order_code);
    if (change === 'owner') t.database.prepare("UPDATE orders SET customer_id='222222222222222222'").run();
    if (change === 'provider') t.database.prepare("UPDATE supplier_autobuy_intents SET provider='cdkvietnam',product_key='cdkvietnam:1'").run();
    if (change === 'lease') t.database.prepare("UPDATE supplier_autobuy_intents SET lease_token='new-worker'").run();
    t.fetchWait.resolve(); await pending;
    expect(t.send).not.toHaveBeenCalled(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
    expect(t.journal().status).toBe('RETRY'); expect(t.intent().encrypted_payload).toMatch(/^enc:v1:/);
    if (change === 'lease') expect(t.intent().lease_token).toBe('new-worker');
  } finally { t.database.close(); }
});

test('fences cancellation that commits while createDM is pending', async () => {
  const t = fixture(), dmWait = deferred(), createDM = vi.fn(async () => { await dmWait.promise; return { id: CHANNEL, send: t.send }; });
  t.client.users.fetch = vi.fn(async () => ({ id: CUSTOMER, createDM }));
  try {
    const order = await t.paid(), pending = t.service.fulfillSupplierOrder(t.client, order.order_code);
    for (let n = 0; n < 30 && !createDM.mock.calls.length; n++) await Promise.resolve();
    expect(createDM).toHaveBeenCalledOnce();
    t.database.prepare("UPDATE orders SET status='CANCELLED'").run(); dmWait.resolve(); await pending;
    expect(t.send).not.toHaveBeenCalled(); expect(t.journal().status).toBe('RETRY');
  } finally { t.database.close(); }
});

async function unknownDelivery(t) {
  vi.useFakeTimers();
  const response = deferred(), send = vi.fn(() => response.promise);
  const channel = { id: CHANNEL, type: 1, recipientId: CUSTOMER, send };
  t.client.users.fetch = vi.fn(async () => ({ id: CUSTOMER, createDM: async () => channel }));
  const order = await t.paid(), pending = t.service.fulfillSupplierOrder(t.client, order.order_code);
  for (let n = 0; n < 30 && !send.mock.calls.length; n++) await Promise.resolve();
  expect(send).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(15001);
  expect(await pending).toMatchObject({ status: 'DELIVERY_PENDING' });
  expect(t.journal().status).toBe('UNKNOWN');
  const payload = send.mock.calls[0][0];
  const receiptMessage = { id: MESSAGE, author: { id: t.client.user.id }, channelId: CHANNEL,
    content: payload.content, nonce: payload.nonce, createdTimestamp: Date.parse(t.journal().send_started_at),
    attachments: new Map([['one', { name: payload.files[0].name, size: payload.files[0].attachment.length }]]) };
  return { response, send, channel, order, payload, receiptMessage };
}

test('reconciles exact bot/customer/request/file history after restart without sending or buying again', async () => {
  const t = fixture();
  try {
    const s = await unknownDelivery(t);
    s.channel.messages = { fetch: vi.fn(async () => new Map([[MESSAGE, s.receiptMessage]])) };
    t.advance(6 * 60000); const restarted = t.restart();
    expect(await restarted.fulfillSupplierOrder(t.client, s.order.order_code)).toMatchObject({ delivered: true });
    expect(t.journal()).toMatchObject({ status: 'SENT', message_id: MESSAGE, customer_id: CUSTOMER, provider: 'dopermind' });
    expect(s.send).toHaveBeenCalledOnce(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
    expect(s.channel.messages.fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(t.journal())).not.toContain('synthetic-private-goods');
  } finally { t.database.close(); }
});

test.each(['bot', 'channel', 'content', 'filename', 'size', 'nonce', 'webhook', 'multiple attachments'])('does not adopt a history message with foreign %s', async change => {
  const t = fixture();
  try {
    const s = await unknownDelivery(t), message = s.receiptMessage;
    if (change === 'bot') message.author.id = CUSTOMER;
    if (change === 'channel') message.channelId = LOG;
    if (change === 'content') message.content = 'A different order';
    if (change === 'filename') message.attachments.get('one').name = 'different-request.txt';
    if (change === 'size') message.attachments.get('one').size++;
    if (change === 'nonce') message.nonce = 'different-request';
    if (change === 'webhook') message.webhookId = LOG;
    if (change === 'multiple attachments') message.attachments.set('two', { ...message.attachments.get('one') });
    s.channel.messages = { fetch: vi.fn(async () => new Map([[MESSAGE, message]])) };
    t.advance(6 * 60000);
    expect(await t.restart().fulfillSupplierOrder(t.client, s.order.order_code)).toMatchObject({ delivered: false });
    expect(t.journal().status).toBe('UNKNOWN'); expect(s.send).toHaveBeenCalledOnce(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
    expect(t.service.getSupplierDeliveryForCustomer({ guildId: GUILD, customerId: CUSTOMER, orderCode: s.order.order_code }).items)
      .toEqual(['synthetic-private-goods']);
  } finally { t.database.close(); }
});

test('never adopts a foreign DM channel or fetches its history', async () => {
  const t = fixture();
  try {
    const s = await unknownDelivery(t), foreign = { ...s.channel, id: LOG, messages: { fetch: vi.fn() } };
    t.client.users.fetch = vi.fn(async () => ({ id: CUSTOMER, createDM: async () => foreign }));
    t.advance(6 * 60000); await t.restart().fulfillSupplierOrder(t.client, s.order.order_code);
    expect(foreign.messages.fetch).not.toHaveBeenCalled(); expect(s.send).toHaveBeenCalledOnce(); expect(t.journal().status).toBe('UNKNOWN');
  } finally { t.database.close(); }
});

test('keeps incomplete or ambiguous history unknown without blind retries', async () => {
  const t = fixture();
  try {
    const s = await unknownDelivery(t);
    const duplicate = { ...s.receiptMessage, id: '555555555555555556' };
    s.channel.messages = { fetch: vi.fn(async () => new Map([[MESSAGE, s.receiptMessage], [duplicate.id, duplicate]])) };
    t.advance(6 * 60000); await t.restart().fulfillSupplierOrder(t.client, s.order.order_code);
    expect(t.journal().status).toBe('UNKNOWN'); expect(s.send).toHaveBeenCalledOnce();
    s.channel.messages.fetch.mockImplementation(async ({ before } = {}) => new Map(Array.from({ length: 100 }, (_, n) => {
      const id = String(BigInt(before ?? '900000000000000000') - BigInt(n + 1));
      return [id, { ...s.receiptMessage, id, content: 'Other message', createdTimestamp: Date.parse(t.journal().send_started_at) + 1000 }];
    })));
    t.advance(6 * 60000); await t.restart().fulfillSupplierOrder(t.client, s.order.order_code);
    expect(s.channel.messages.fetch).toHaveBeenCalledTimes(6); expect(t.journal().status).toBe('UNKNOWN'); expect(s.send).toHaveBeenCalledOnce();
  } finally { t.database.close(); }
});

test.each(['CANCELLED', 'REFUNDED', 'changed-owner', 'changed-provider'])('retains a late positive receipt for review after %s', async change => {
  const t = fixture();
  try {
    const s = await unknownDelivery(t);
    if (change === 'CANCELLED' || change === 'REFUNDED') t.database.prepare('UPDATE orders SET status=?,payment_status=?').run(change, change);
    if (change === 'changed-owner') t.database.prepare("UPDATE orders SET customer_id='222222222222222222'").run();
    if (change === 'changed-provider') t.database.prepare("UPDATE supplier_autobuy_intents SET provider='cdkvietnam',product_key='cdkvietnam:1'").run();
    s.response.resolve({ id: MESSAGE }); for (let n = 0; n < 30; n++) await Promise.resolve();
    expect(t.journal()).toMatchObject({ status: 'REVIEW', message_id: MESSAGE, channel_id: CHANNEL, customer_id: CUSTOMER, provider: 'dopermind' });
    expect(t.database.prepare('SELECT status FROM orders').get().status).not.toBe('COMPLETED');
    expect(t.intent().dm_message_id).toBeNull(); expect(s.send).toHaveBeenCalledOnce(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
  } finally { t.database.close(); }
});

test('records an admitted receipt across lease replacement without a duplicate DM', async () => {
  const t = fixture();
  try {
    const s = await unknownDelivery(t);
    t.database.prepare("UPDATE supplier_autobuy_intents SET lease_token='new-reconciler',status='DELIVERING'").run();
    s.response.resolve({ id: MESSAGE }); for (let n = 0; n < 30; n++) await Promise.resolve();
    expect(t.journal()).toMatchObject({ status: 'SENT', message_id: MESSAGE });
    expect(t.intent()).toMatchObject({ status: 'DELIVERED', dm_message_id: MESSAGE });
    expect(s.send).toHaveBeenCalledOnce(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
  } finally { t.database.close(); }
});

test('automatically retries a definitive blocked DM without purchasing again', async () => {
  const t = fixture(), send = vi.fn().mockRejectedValueOnce(Object.assign(new Error('Private rejection'), { status: 403, code: 50007 }))
    .mockResolvedValue({ id: MESSAGE });
  t.client.users.fetch = vi.fn(async () => ({ id: CUSTOMER, createDM: async () => ({ id: CHANNEL, send }) }));
  try {
    const order = await t.paid();
    expect(await t.service.fulfillSupplierOrder(t.client, order.order_code)).toMatchObject({ status: 'DELIVERY_PENDING' });
    expect(t.journal().status).toBe('RETRY'); t.advance(120001);
    await t.service.processPendingSupplierOrders(t.client, 3);
    expect(t.intent().status).toBe('DELIVERED'); expect(send).toHaveBeenCalledTimes(2); expect(t.provider.createOrder).toHaveBeenCalledOnce();
  } finally { t.database.close(); }
});

test('holds pre-journal ambiguous delivery state after an additive migration', async () => {
  const t = fixture(), send = vi.fn().mockRejectedValue(Object.assign(new Error('Blocked DM'), { status: 403, code: 50007 }));
  t.client.users.fetch = vi.fn(async () => ({ id: CUSTOMER, createDM: async () => ({ id: CHANNEL, send }) }));
  try {
    const order = await t.paid(); await t.service.fulfillSupplierOrder(t.client, order.order_code);
    t.database.prepare('DELETE FROM supplier_autobuy_delivery_attempts').run();
    t.advance(120001); await t.restart().fulfillSupplierOrder(t.client, order.order_code);
    expect(t.journal().status).toBe('UNKNOWN'); expect(send).toHaveBeenCalledOnce(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
    expect(t.service.getSupplierDeliveryForCustomer({ guildId: GUILD, customerId: CUSTOMER, orderCode: order.order_code }).items).toHaveLength(1);
  } finally { t.database.close(); }
});

test('allows owned private retrieval during an unknown DM and preserves its receipt when DM resolves later', async () => {
  const t = fixture();
  try {
    const s = await unknownDelivery(t), retrievalMessage = '777777777777777777';
    expect(() => t.service.getSupplierDeliveryForCustomer({ guildId: GUILD, customerId: LOG, orderCode: s.order.order_code })).toThrow();
    t.service.acknowledgeSupplierDeliveryRetrieval({ guildId: GUILD, customerId: CUSTOMER, orderCode: s.order.order_code,
      messageId: retrievalMessage, channelId: LOG });
    s.response.resolve({ id: MESSAGE }); for (let n = 0; n < 30; n++) await Promise.resolve();
    expect(t.intent()).toMatchObject({ status: 'DELIVERED', delivery_kind: 'EPHEMERAL', dm_message_id: retrievalMessage });
    expect(t.journal()).toMatchObject({ status: 'SENT', message_id: MESSAGE }); expect(s.send).toHaveBeenCalledOnce();
  } finally { t.database.close(); }
});

test('checks the elapsed deadline again after synchronous authorization before any DM submission', async () => {
  const database = new Database(':memory:');
  let time = 0;
  const helper = createSupplierDeliveryService({ db: database, now: () => time, id: () => 'synthetic-attempt' });
  const send = vi.fn(), complete = vi.fn();
  try {
    const outcome = await helper.deliver({ client: {}, order: { order_code: 'CN_123456', customer_id: CUSTOMER },
      intent: { request_id: 'synthetic-request', provider: 'dopermind', guild_id: GUILD, customer_id: CUSTOMER, product_key: KEY },
      lease: 'synthetic-lease', freshPurchase: true, items: ['synthetic-goods'],
      beforeSend: () => { time = 15001; return true; }, complete,
      sendDelivery: async (_client, _order, _items, _request, controls) => {
        if (controls.beforeSend({ channelId: CHANNEL }) !== true) throw new Error('Synthetic veto');
        return send();
      } });
    expect(outcome.outcome).toBe('RETRY'); expect(send).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
    expect(database.prepare('SELECT status FROM supplier_autobuy_delivery_attempts').get().status).toBe('RETRY');
  } finally { database.close(); }
});

test.each(['SQLITE_BUSY', 'SQLITE_LOCKED_SHAREDCACHE'])('retries guarded completion after %s using its positive receipt without another send or purchase', async code => {
  const t = fixture(), realComplete = t.settings.markOrderCompleted;
  const complete = vi.fn().mockImplementationOnce(() => { throw Object.assign(new Error('Synthetic SQLite contention'), { code }); })
    .mockImplementation(realComplete);
  t.settings.markOrderCompleted = complete;
  try {
    const order = await t.paid(), restarted = t.restart(); t.fetchWait.resolve();
    expect(await restarted.fulfillSupplierOrder(t.client, order.order_code)).toMatchObject({ status: 'DELIVERY_PENDING' });
    expect(t.journal()).toMatchObject({ status: 'SENT', message_id: MESSAGE, last_error: 'DELIVERY_COMPLETION_RETRY' });
    expect(t.intent()).toMatchObject({ status: 'DELIVERY_PENDING', last_error: 'DELIVERY_COMPLETION_RETRY' });
    t.advance(120001); await restarted.processPendingSupplierOrders(t.client, 3);
    expect(t.journal()).toMatchObject({ status: 'SENT', message_id: MESSAGE, last_error: null });
    expect(t.intent()).toMatchObject({ status: 'DELIVERED', dm_message_id: MESSAGE });
    expect(t.send).toHaveBeenCalledOnce(); expect(t.provider.createOrder).toHaveBeenCalledOnce(); expect(complete).toHaveBeenCalledTimes(2);
  } finally { t.database.close(); }
});

test.each(['ORDER_NOT_DELIVERABLE', 'SQLITE_CONSTRAINT', 'SOME_BUSY_ERROR'])('quarantines completion failure %s instead of broadening the transient retry allowlist', async code => {
  const t = fixture();
  t.settings.markOrderCompleted = vi.fn(() => { throw Object.assign(new Error('Synthetic guarded completion failure'), { code }); });
  try {
    const order = await t.paid(); t.fetchWait.resolve();
    expect(await t.restart().fulfillSupplierOrder(t.client, order.order_code)).toMatchObject({ status: 'REVIEW' });
    expect(t.journal()).toMatchObject({ status: 'REVIEW', message_id: MESSAGE });
    expect(t.intent().status).toBe('REVIEW'); t.advance(120001);
    await t.restart().processPendingSupplierOrders(t.client, 3);
    expect(t.send).toHaveBeenCalledOnce(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
  } finally { t.database.close(); }
});

async function legacyFixture() {
  const t = fixture(), send = vi.fn().mockRejectedValue(Object.assign(new Error('Synthetic old blocked DM'), { status: 403, code: 50007 }));
  const channel = { id: CHANNEL, type: 1, recipientId: CUSTOMER, send };
  t.client.users.fetch = vi.fn(async () => ({ id: CUSTOMER, createDM: async () => channel }));
  const order = await t.paid(); await t.service.fulfillSupplierOrder(t.client, order.order_code);
  const original = send.mock.calls[0][0], intent = t.intent();
  t.database.prepare('DELETE FROM supplier_autobuy_delivery_attempts').run(); t.advance(120001);
  const nonce = createHash('sha256').update(`supplier-delivery:${intent.request_id}`).digest('hex').slice(0, 24);
  const message = { id: MESSAGE, channelId: CHANNEL, author: { id: t.client.user.id }, nonce, content: original.content,
    createdTimestamp: Date.parse(intent.created_at) + 1000,
    attachments: new Map([['one', { name: `${order.order_code}-autobuy.txt`, size: original.files[0].attachment.length }]]) };
  channel.messages = { fetch: vi.fn(async () => new Map([[MESSAGE, message]])) };
  return { ...t, send, channel, order, message };
}

test('recovers a unique legacy positive receipt from the typed customer DM and exact original request nonce', async () => {
  const t = await legacyFixture();
  try {
    expect(await t.restart().fulfillSupplierOrder(t.client, t.order.order_code)).toMatchObject({ delivered: true });
    expect(t.journal()).toMatchObject({ status: 'SENT', message_format: 'LEGACY', message_id: MESSAGE, channel_id: CHANNEL });
    expect(t.intent()).toMatchObject({ status: 'DELIVERED', dm_message_id: MESSAGE });
    expect(t.send).toHaveBeenCalledOnce(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
    expect(t.channel.messages.fetch).toHaveBeenCalledOnce();
    const health = getSupplierAutobuyDeliveryHealth();
    expect(health).toMatchObject({ status: 'READY', journalAttempts: 1, legacyRecovered: 1, legacyUnknown: 0, sent: 1 });
    expect(Object.keys(health).sort()).toEqual(['checkedAt', 'completionRetry', 'journalAttempts', 'legacyRecovered', 'legacyUnknown', 'preparing', 'retry', 'review', 'sending', 'sent', 'status', 'unknown', 'vetoed'].sort());
    expect(JSON.stringify(health)).not.toContain(CUSTOMER); expect(JSON.stringify(health)).not.toContain(CHANNEL);
    expect(JSON.stringify(t.journal())).not.toContain('synthetic-private-goods');
    t.database.close();
    expect(getSupplierAutobuyDeliveryHealth()).toBe(health); // Strictly cache-only, even after database close.
  } finally { if (t.database.open) t.database.close(); }
});

test.each(['missing', 'null', 'different-request', 'new-format'])('holds a legacy message with %s nonce instead of assuming its payload from size', async mode => {
  const t = await legacyFixture();
  try {
    if (mode === 'missing') delete t.message.nonce;
    if (mode === 'null') t.message.nonce = null;
    if (mode === 'different-request') t.message.nonce = 'unrelated-original-request';
    if (mode === 'new-format') t.message.nonce = createHash('sha256').update(`supplier-delivery:dopermind:${t.intent().request_id}`).digest('hex').slice(0, 24);
    await t.restart().fulfillSupplierOrder(t.client, t.order.order_code);
    expect(t.journal()).toMatchObject({ status: 'UNKNOWN', message_format: 'LEGACY', channel_id: null, message_id: null });
    expect(getSupplierAutobuyDeliveryHealth()).toMatchObject({ journalAttempts: 1, legacyUnknown: 1, legacyRecovered: 0 });
    expect(t.send).toHaveBeenCalledOnce(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
    expect(t.service.getSupplierDeliveryForCustomer({ guildId: GUILD, customerId: CUSTOMER, orderCode: t.order.order_code }).items).toHaveLength(1);
  } finally { t.database.close(); }
});

test.each(['missing-type', 'string-type', 'group-DM', 'missing-recipient', 'foreign-recipient'])('does not adopt legacy evidence through %s channel metadata', async mode => {
  const t = await legacyFixture();
  try {
    if (mode === 'missing-type') delete t.channel.type;
    if (mode === 'string-type') t.channel.type = '1';
    if (mode === 'group-DM') t.channel.type = 3;
    if (mode === 'missing-recipient') delete t.channel.recipientId;
    if (mode === 'foreign-recipient') t.channel.recipientId = LOG;
    await t.restart().fulfillSupplierOrder(t.client, t.order.order_code);
    expect(t.journal()).toMatchObject({ status: 'UNKNOWN', channel_id: null, message_id: null });
    expect(t.channel.messages.fetch).not.toHaveBeenCalled(); expect(t.send).toHaveBeenCalledOnce();
  } finally { t.database.close(); }
});

test('keeps multiple matching legacy messages ambiguous instead of choosing one receipt', async () => {
  const t = await legacyFixture();
  try {
    const otherId = '555555555555555556';
    t.channel.messages.fetch.mockResolvedValue(new Map([[MESSAGE, t.message], [otherId, { ...t.message, id: otherId }]]));
    await t.restart().fulfillSupplierOrder(t.client, t.order.order_code);
    expect(t.journal()).toMatchObject({ status: 'UNKNOWN', message_format: 'LEGACY', message_id: null });
    expect(t.send).toHaveBeenCalledOnce();
  } finally { t.database.close(); }
});

test('upgrades the earlier null-channel legacy hold additively before exact positive discovery', async () => {
  const t = await legacyFixture();
  try {
    t.channel.messages.fetch.mockResolvedValueOnce(new Map());
    await t.restart().fulfillSupplierOrder(t.client, t.order.order_code);
    expect(t.journal().status).toBe('UNKNOWN');
    t.database.exec('ALTER TABLE supplier_autobuy_delivery_attempts DROP COLUMN message_format; ALTER TABLE supplier_autobuy_delivery_attempts DROP COLUMN discovery_after;');
    t.advance(120001);
    expect(await t.restart().fulfillSupplierOrder(t.client, t.order.order_code)).toMatchObject({ delivered: true });
    expect(t.journal()).toMatchObject({ status: 'SENT', message_format: 'LEGACY', message_id: MESSAGE }); expect(t.send).toHaveBeenCalledOnce();
  } finally { t.database.close(); }
});

test('retains legacy evidence for review if a refund commits during history discovery', async () => {
  const t = await legacyFixture();
  try {
    t.channel.messages.fetch.mockImplementationOnce(async () => {
      t.database.prepare("UPDATE orders SET status='REFUNDED',payment_status='REFUNDED'").run();
      return new Map([[MESSAGE, t.message]]);
    });
    expect(await t.restart().fulfillSupplierOrder(t.client, t.order.order_code)).toMatchObject({ status: 'REVIEW' });
    expect(t.journal()).toMatchObject({ status: 'REVIEW', message_format: 'LEGACY', message_id: MESSAGE, channel_id: CHANNEL });
    expect(t.database.prepare('SELECT status FROM orders').get().status).toBe('REFUNDED'); expect(t.send).toHaveBeenCalledOnce();
  } finally { t.database.close(); }
});

function journalContention(t, codes, change = () => {}) {
  const prepare = t.database.prepare.bind(t.database), attempts = [];
  const transaction = t.database.transaction.bind(t.database);
  let injected;
  t.database.transaction = callback => {
    const wrapped = transaction(callback);
    return Object.assign((...args) => wrapped(...args), { immediate: (...args) => {
      try { return wrapped.immediate(...args); }
      catch (error) {
        // Runs after SQLite rolled back the failed metadata transaction,
        // matching a committed external change before the bounded retry.
        if (error === injected) { injected = null; change(); }
        throw error;
      }
    } });
  };
  t.database.prepare = sql => {
    const statement = prepare(sql);
    if (!/^INSERT INTO supplier_autobuy_delivery_attempts/.test(sql)) return statement;
    return { run: (...args) => {
      attempts.push(args[0]);
      if (codes.length) { const code = codes.shift(); injected = Object.assign(new Error('Synthetic journal preparation error'), { code }); throw injected; }
      return statement.run(...args);
    } };
  };
  return attempts;
}

test.each(['SQLITE_BUSY', 'SQLITE_BUSY_SNAPSHOT', 'SQLITE_LOCKED', 'SQLITE_LOCKED_SHAREDCACHE'])('retries fresh pre-transport journal %s once with the same attempt identity and survives restart', async code => {
  const t = fixture(), attempts = journalContention(t, [code]);
  try {
    const order = await t.paid(); t.fetchWait.resolve();
    expect(await t.service.fulfillSupplierOrder(t.client, order.order_code)).toMatchObject({ delivered: true });
    expect(attempts).toHaveLength(2); expect(attempts[0]).toBe(attempts[1]);
    expect(t.journal()).toMatchObject({ status: 'SENT', message_format: 'CURRENT', message_id: MESSAGE });
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM supplier_autobuy_delivery_attempts').get().n).toBe(1);
    expect(await t.restart().fulfillSupplierOrder(t.client, order.order_code)).toMatchObject({ delivered: true, reused: true });
    expect(t.send).toHaveBeenCalledOnce(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
  } finally { t.database.close(); }
});

test('keeps a durable source receipt held without sends or repurchase after both fresh metadata attempts are busy', async () => {
  const t = fixture(), attempts = journalContention(t, ['SQLITE_BUSY', 'SQLITE_BUSY']);
  t.client.users.fetch = vi.fn(async () => ({ id: CUSTOMER, createDM: async () => ({ id: CHANNEL, type: 1, recipientId: CUSTOMER,
    send: t.send, messages: { fetch: vi.fn(async () => new Map()) } }) }));
  try {
    const order = await t.paid();
    expect(await t.service.fulfillSupplierOrder(t.client, order.order_code)).toMatchObject({ status: 'DELIVERY_PENDING' });
    expect(attempts).toHaveLength(2); expect(attempts[0]).toBe(attempts[1]);
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM supplier_autobuy_delivery_attempts').get().n).toBe(0);
    expect(t.intent().encrypted_payload).toMatch(/^enc:v1:/); expect(t.send).not.toHaveBeenCalled();
    t.advance(120001); await t.restart().fulfillSupplierOrder(t.client, order.order_code);
    expect(t.journal()).toMatchObject({ status: 'UNKNOWN', message_format: 'LEGACY' });
    expect(t.send).not.toHaveBeenCalled(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
    expect(t.service.getSupplierDeliveryForCustomer({ guildId: GUILD, customerId: CUSTOMER, orderCode: order.order_code }).items).toHaveLength(1);
  } finally { t.database.close(); }
});

test.each(['ORDER_NOT_DELIVERABLE', 'SQLITE_CONSTRAINT', 'SQLITE_IOERR', 'UNRELATED_BUSY'])('does not broaden metadata retries to %s', async code => {
  const t = fixture(), attempts = journalContention(t, [code]);
  try {
    const order = await t.paid();
    expect(await t.service.fulfillSupplierOrder(t.client, order.order_code)).toMatchObject({ status: 'DELIVERY_PENDING' });
    expect(attempts).toHaveLength(1); expect(t.send).not.toHaveBeenCalled(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
    expect(t.intent().encrypted_payload).toMatch(/^enc:v1:/);
  } finally { t.database.close(); }
});

test.each(['cancel', 'owner', 'provider', 'lease'])('rechecks current immutable ownership and lease after journal contention during %s', async change => {
  const t = fixture(), attempts = journalContention(t, ['SQLITE_BUSY'], () => {
    if (change === 'cancel') t.database.prepare("UPDATE orders SET status='CANCELLED'").run();
    if (change === 'owner') t.database.prepare("UPDATE orders SET customer_id='222222222222222222'").run();
    if (change === 'provider') t.database.prepare("UPDATE supplier_autobuy_intents SET provider='cdkvietnam',product_key='cdkvietnam:1'").run();
    if (change === 'lease') t.database.prepare("UPDATE supplier_autobuy_intents SET lease_token='new-worker'").run();
  });
  try {
    const order = await t.paid(); await t.service.fulfillSupplierOrder(t.client, order.order_code);
    expect(attempts).toHaveLength(1); expect(t.send).not.toHaveBeenCalled();
    expect(t.provider.createOrder).toHaveBeenCalledOnce(); expect(t.intent().encrypted_payload).toMatch(/^enc:v1:/);
    if (change === 'lease') expect(t.intent().lease_token).toBe('new-worker');
  } finally { t.database.close(); }
});

test('recovers one real two-connection SQLite writer lock before the first journal metadata transaction', async () => {
  const databasePath = path.join(os.tmpdir(), `cenar-delivery-journal-lock-${randomUUID()}.sqlite`);
  const t = fixture(databasePath), writer = new Database(databasePath), errors = [];
  t.database.pragma('busy_timeout=0'); writer.pragma('busy_timeout=0');
  const transaction = t.database.transaction.bind(t.database);
  let injectLock = true;
  t.database.transaction = callback => {
    const wrapped = transaction(callback);
    return Object.assign((...args) => wrapped(...args), { immediate: (...args) => {
      if (!injectLock || !String(callback).includes('INSERT INTO supplier_autobuy_delivery_attempts')) return wrapped.immediate(...args);
      injectLock = false;
      writer.exec('BEGIN IMMEDIATE');
      expect(writer.prepare('SELECT encrypted_payload FROM supplier_autobuy_intents').get().encrypted_payload).toMatch(/^enc:v1:/);
      try { return wrapped.immediate(...args); }
      catch (error) { errors.push(error.code); throw error; }
      finally { writer.exec('ROLLBACK'); }
    } });
  };
  try {
    const order = await t.paid(); t.fetchWait.resolve();
    expect(await t.service.fulfillSupplierOrder(t.client, order.order_code)).toMatchObject({ delivered: true });
    expect(errors).toEqual(['SQLITE_BUSY']); expect(t.journal()).toMatchObject({ status: 'SENT', message_format: 'CURRENT' });
    expect(t.send).toHaveBeenCalledOnce(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
    expect(await t.restart().fulfillSupplierOrder(t.client, order.order_code)).toMatchObject({ delivered: true, reused: true });
  } finally {
    writer.close(); t.database.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(databasePath + suffix, { force: true });
  }
});

test('does not treat a real failed admission COMMIT as an unknown Discord send and retries without rebuying', async () => {
  const databasePath = path.join(os.tmpdir(), `cenar-delivery-admission-lock-${randomUUID()}.sqlite`);
  const t = fixture(databasePath), reader = new Database(databasePath), errors = [];
  t.database.pragma('busy_timeout=0'); reader.pragma('busy_timeout=0');
  const transaction = t.database.transaction.bind(t.database);
  let injectLock = true;
  t.database.transaction = callback => {
    const wrapped = transaction(callback);
    return Object.assign((...args) => wrapped(...args), { immediate: (...args) => {
      if (!injectLock || !String(callback).includes("SET status='SENDING'")) return wrapped.immediate(...args);
      injectLock = false;
      reader.exec('BEGIN'); reader.prepare('SELECT * FROM supplier_autobuy_delivery_attempts').all();
      try { return wrapped.immediate(...args); }
      catch (error) { errors.push(error.code); throw error; }
      finally { reader.exec('ROLLBACK'); }
    } });
  };
  try {
    const order = await t.paid(); t.fetchWait.resolve();
    expect(await t.service.fulfillSupplierOrder(t.client, order.order_code)).toMatchObject({ status: 'DELIVERY_PENDING' });
    expect(errors).toEqual(['SQLITE_BUSY']); expect(t.send).not.toHaveBeenCalled();
    expect(t.journal()).toMatchObject({ status: 'RETRY', channel_id: null, send_started_at: null });
    expect(t.intent().encrypted_payload).toMatch(/^enc:v1:/);
    t.advance(120001);
    expect(await t.restart().fulfillSupplierOrder(t.client, order.order_code)).toMatchObject({ delivered: true });
    expect(t.journal()).toMatchObject({ status: 'SENT', message_id: MESSAGE, message_format: 'CURRENT' });
    expect(t.send).toHaveBeenCalledOnce(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
  } finally {
    reader.close(); t.database.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(databasePath + suffix, { force: true });
  }
});

test('vetoes a committed admission after the deadline before calling Discord and retries only the known unsent attempt', async () => {
  const t = fixture(), transaction = t.database.transaction.bind(t.database);
  let blockCommit = true;
  t.database.transaction = callback => {
    const wrapped = transaction(callback);
    return Object.assign((...args) => wrapped(...args), { immediate: (...args) => {
      const result = wrapped.immediate(...args);
      if (blockCommit && String(callback).includes("SET status='SENDING'")) { blockCommit = false; t.advance(16000); }
      return result;
    } });
  };
  try {
    const order = await t.paid(); t.fetchWait.resolve();
    expect(await t.service.fulfillSupplierOrder(t.client, order.order_code)).toMatchObject({ status: 'DELIVERY_PENDING' });
    expect(t.send).not.toHaveBeenCalled();
    expect(t.journal()).toMatchObject({ status: 'RETRY', channel_id: CHANNEL });
    expect(t.journal().send_started_at).not.toBeNull();
    t.advance(120001);
    expect(await t.restart().fulfillSupplierOrder(t.client, order.order_code)).toMatchObject({ delivered: true });
    expect(t.send).toHaveBeenCalledOnce(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
  } finally { t.database.close(); }
});

test('checks the elapsed deadline after a blocking journal retry before any DM preparation', async () => {
  const t = fixture(), prepare = t.database.prepare.bind(t.database), attempts = [];
  t.database.prepare = sql => {
    const statement = prepare(sql);
    if (!/^INSERT INTO supplier_autobuy_delivery_attempts/.test(sql)) return statement;
    return { run: (...args) => {
      attempts.push(args[0]); t.advance(8000);
      if (attempts.length === 1) throw Object.assign(new Error('Synthetic busy wait'), { code: 'SQLITE_BUSY' });
      return statement.run(...args);
    } };
  };
  try {
    const order = await t.paid(); await t.service.fulfillSupplierOrder(t.client, order.order_code);
    expect(attempts).toHaveLength(2); expect(t.journal().status).toBe('VETOED');
    expect(t.send).not.toHaveBeenCalled(); expect(t.client.users.fetch).not.toHaveBeenCalled(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
  } finally { t.database.close(); }
});

test.each(['existing-unknown', 'legacy-without-journal'])('does not promote or retry metadata creation for %s', async mode => {
  const t = fixture();
  t.send.mockRejectedValueOnce(mode === 'existing-unknown' ? new Error('Synthetic uncertain network response')
    : Object.assign(new Error('Synthetic old DM rejection'), { status: 403, code: 50007 }));
  try {
    const order = await t.paid(); t.fetchWait.resolve(); await t.service.fulfillSupplierOrder(t.client, order.order_code);
    if (mode === 'legacy-without-journal') t.database.prepare('DELETE FROM supplier_autobuy_delivery_attempts').run();
    const attempts = journalContention(t, ['SQLITE_BUSY']); t.advance(120001);
    await t.restart().fulfillSupplierOrder(t.client, order.order_code);
    expect(attempts).toHaveLength(mode === 'existing-unknown' ? 0 : 1);
    if (mode === 'existing-unknown') expect(t.journal()).toMatchObject({ status: 'UNKNOWN', message_format: 'CURRENT' });
    else expect(t.database.prepare('SELECT COUNT(*) AS n FROM supplier_autobuy_delivery_attempts').get().n).toBe(0);
    expect(t.send).toHaveBeenCalledOnce(); expect(t.provider.createOrder).toHaveBeenCalledOnce();
    expect(t.service.getSupplierDeliveryForCustomer({ guildId: GUILD, customerId: CUSTOMER, orderCode: order.order_code }).items).toHaveLength(1);
  } finally { t.database.close(); }
});


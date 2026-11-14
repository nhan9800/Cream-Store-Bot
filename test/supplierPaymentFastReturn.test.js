import fs from 'node:fs';
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(process.env, {
  ENV_FILE: '.env.supplier-fast-return-test-absent', DATABASE_PATH: `./data/test-supplier-fast-return-${process.pid}-${Date.now()}.sqlite`,
  ENCRYPTION_KEY: 'synthetic-encryption-key', PAYOS_CLIENT_ID: 'synthetic-client', PAYOS_API_KEY: 'synthetic-api',
  PAYOS_CHECKSUM_KEY: 'synthetic-checksum', PUBLIC_BASE_URL: 'https://bot.example', GUILD_ID: '1282637033340403754',
}));
const hooks = vi.hoisted(() => ({ start: vi.fn(), fulfill: vi.fn(), roles: vi.fn() }));
vi.mock('../src/services/supplierAutobuyOrderService.js', () => ({ fulfillSupplierOrder: hooks.fulfill }));
vi.mock('../src/services/customerRoleSyncService.js', async original => ({ ...await original(), syncCustomerRolesNow: hooks.roles }));
vi.mock('../src/services/supplierAutobuyPaymentNoticeService.js', async original => ({ ...await original(), startSupplierPaymentEffects: input => hooks.start(input) }));

import { db, initDatabase } from '../src/database/db.js';
import { createTicket } from '../src/services/ticketService.js';
import { createOrder, getOrderByCode, recordOrderPayment } from '../src/services/orderService.js';
import { deliverPaidOrder } from '../src/services/autoDeliveryService.js';
import { createSupplierPaymentNoticeService } from '../src/services/supplierAutobuyPaymentNoticeService.js';
import { createSupplierAutobuyCheckout } from '../src/services/supplierAutobuyCheckoutService.js';
import { finalizePaidOrder, handlePayOSWebhook, reconcileRecentPayOSPayments, syncPaymentStatusFromPayOS } from '../src/services/paymentService.js';

const guildId = '1282637033340403754', customerId = '1138315103821889566';
let sequence = 0, coordinator, sendNotice;
const gates = [];
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); const value = { promise, resolve }; gates.push(value); return value; };
const flush = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };
const client = () => ({ user: { id: '1666666666666666666' }, isReady: () => true, users: {}, guilds: { fetch: vi.fn(async () => null) } });

function fixture(supplier = true) {
  const code = `CN_${996000 + ++sequence}`;
  const ticket = createTicket({ guildId, customerId, channelId: `${1770000000000000000n + BigInt(sequence)}`, openedById: customerId, ticketType: 'ORDER' });
  createOrder({ orderCode: code, guildId, customerId, ticketId: ticket.id, ticketChannelId: ticket.channel_id,
    createdById: customerId, productName: 'Synthetic subscription', totalAmount: 61000, quantity: 1, durationMonths: 1,
    orderLogChannelId: '1888888888888888888' });
  db.prepare("UPDATE orders SET payment_link_id=?,created_at=? WHERE order_code=?").run(`synthetic-${code}`, new Date().toISOString(), code);
  if (supplier) {
    db.prepare("UPDATE orders SET fulfillment_mode='SUPPLIER' WHERE order_code=?").run(code);
    db.prepare(`INSERT INTO supplier_autobuy_intents(order_code,guild_id,customer_id,provider,product_key,request_id,request_hash,quote_id,quantity,sale_amount)
      VALUES(?,?,?,'dopermind','desc_synthetic',?,?,?,1,61000)`).run(code, guildId, customerId, `request-${code}`, `hash-${code}`, `quote-${code}`);
    db.prepare("INSERT INTO supplier_autobuy_payment_methods VALUES (?,'PAYOS')").run(code);
  }
  return getOrderByCode(code);
}
function paidInfo(order, changes = {}) {
  return { id: order.payment_link_id, orderCode: order.payos_order_code, status: 'PAID', amount: 61000, amountPaid: 61000, ...changes };
}
function webhook(order, amount = 61000, reference = `tx-${order.order_code}`) {
  const data = { orderCode: order.payos_order_code, amount, description: order.payment_code, reference, code: '00' };
  const signature = createHmac('sha256', 'synthetic-checksum').update(Object.keys(data).sort().map(key => `${key}=${data[key]}`).join('&')).digest('hex');
  return { code: '00', success: true, data, signature };
}
async function expectImmediatePaid(task, item) {
  let result, settled = false;
  const completion = task.then(value => { result = value; settled = true; });
  try {
    await vi.waitFor(() => expect(hooks.fulfill).toHaveBeenCalledOnce());
    expect(getOrderByCode(item.order_code)).toMatchObject({ payment_status: 'PAID', amount_paid: 61000, status: 'PROCESSING' });
    await vi.waitFor(() => expect(settled).toBe(true), { timeout: 250 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM payment_events WHERE order_code=?').get(item.order_code).n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM customer_role_sync_jobs WHERE guild_id=? AND customer_id=?').get(guildId, customerId).n).toBeGreaterThan(0);
    return result;
  } finally { for (const gate of gates) gate.resolve({ delivered: false }); await completion; await flush(); }
}
beforeAll(() => {
  initDatabase();
  db.exec(`CREATE TABLE supplier_autobuy_intents(order_code TEXT PRIMARY KEY,guild_id TEXT,customer_id TEXT,provider TEXT,product_key TEXT,
    request_id TEXT,request_hash TEXT,quote_id TEXT,quantity INTEGER,sale_amount INTEGER);
    CREATE TABLE supplier_autobuy_payment_methods(order_code TEXT PRIMARY KEY,method TEXT);`);
});
beforeEach(() => {
  db.prepare("UPDATE orders SET created_at='2000-01-01T00:00:00Z'").run();
  hooks.fulfill.mockReset().mockResolvedValue({ delivered: false }); hooks.roles.mockReset().mockResolvedValue({}); hooks.start.mockReset();
  sendNotice = vi.fn(async ({ recordReceipt }) => {
    recordReceipt('ticket', { messageId: '1555555555555555555', channelId: coordinator.currentChannel });
    recordReceipt('dm', { messageId: '1444444444444444444', channelId: '1333333333333333333' });
  });
  coordinator = createSupplierPaymentNoticeService({ database: db, scopeEnabled: () => true,
    fulfill: deliverPaidOrder, syncRoles: hooks.roles, sendNotice, recordLog: () => {} });
  coordinator.prepare();
  hooks.start.mockImplementation(input => { coordinator.currentChannel = input.order.ticket_channel_id; return coordinator.start(input); });
});
afterEach(async () => { for (const gate of gates.splice(0)) gate.resolve({ delivered: false }); await flush(); vi.restoreAllMocks(); });
afterAll(() => { db.close(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.DATABASE_PATH + suffix, { force: true }); });

describe('actual supplier paid response is independent of external postcommit work', () => {
  it('returns finalize after committing payment while supplier, roles and notice are all unresolved', async () => {
    const item = fixture(), source = deferred(), role = deferred(), notice = deferred();
    hooks.fulfill.mockReturnValue(source.promise); hooks.roles.mockReturnValue(role.promise); sendNotice.mockReturnValue(notice.promise);
    const result = await expectImmediatePaid(finalizePaidOrder(client(), item, { amount: 61000 }, `tx-${item.order_code}`, item.payment_code), item);
    expect(result).toMatchObject({ duplicate: false, repairedNotification: false, updated: { amount_paid: 61000 } });
    expect(hooks.roles).toHaveBeenCalledOnce(); expect(sendNotice).toHaveBeenCalledOnce();
  });
  it('returns actual owned checkout status after one paid GET while supplier queue is blocked', async () => {
    const item = fixture(), source = deferred(); hooks.fulfill.mockReturnValue(source.promise);
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code: '00', data: paidInfo(item) }));
    const checkout = createSupplierAutobuyCheckout({ database: db, customerFlag: () => ({}), ticketMute: () => ({}), readOrder: getOrderByCode, syncPayos: syncPaymentStatusFromPayOS,
      engine: { getSupplierOrderForCustomer: async ({ orderCode }) => { const fresh = getOrderByCode(orderCode); return { provider: 'dopermind', orderCode, status: fresh.status, paymentStatus: fresh.payment_status, totalAmount: fresh.total_amount }; } } });
    const result = await expectImmediatePaid(checkout.status({ client: client(), guildId, customerId, orderCode: item.order_code, provider: 'dopermind' }), item);
    expect(result).toMatchObject({ paymentStatus: 'PAID', status: 'PROCESSING', provider: 'dopermind' });
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1].method).toBe('GET');
  });
  it('acknowledges a signed actual webhook before fulfillment and coalesces a concurrent duplicate', async () => {
    const item = fixture(), source = deferred(), role = deferred(), notice = deferred(), bot = client();
    hooks.fulfill.mockReturnValue(source.promise); hooks.roles.mockReturnValue(role.promise); sendNotice.mockReturnValue(notice.promise);
    const responses = Promise.all([handlePayOSWebhook({ client: bot, body: webhook(item) }), handlePayOSWebhook({ client: bot, body: webhook(item) })]);
    const result = await expectImmediatePaid(responses, item);
    expect(result.map(value => value.status)).toEqual([200, 200]);
    expect(hooks.fulfill).toHaveBeenCalledOnce(); expect(hooks.roles).toHaveBeenCalledOnce(); expect(sendNotice).toHaveBeenCalledOnce();
  });
  it('keeps committed receipt and durable role job when optional metadata enqueue throws', async () => {
    const item = fixture(), source = deferred(); hooks.fulfill.mockReturnValue(source.promise);
    const prepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation(sql => {
      if (/INSERT INTO supplier_autobuy_payment_notices/.test(sql)) throw Object.assign(new Error('Synthetic metadata busy'), { code: 'SQLITE_BUSY' });
      return prepare(sql);
    });
    await expectImmediatePaid(finalizePaidOrder(client(), item, { amount: 61000 }, `tx-${item.order_code}`, item.payment_code), item);
    expect(sendNotice).not.toHaveBeenCalled(); expect(hooks.roles).toHaveBeenCalledOnce();
  });
  it('preserves actual received overpayment and refuses an insufficient receipt before any background effect', async () => {
    const item = fixture();
    await expect(finalizePaidOrder(client(), item, { amount: 60000 }, `short-${item.order_code}`, item.payment_code)).rejects.toMatchObject({ code: 'INSUFFICIENT_PAYMENT' });
    expect(hooks.start).not.toHaveBeenCalled(); expect(getOrderByCode(item.order_code).payment_status).toBe('UNPAID');
    const result = await finalizePaidOrder(client(), item, { amount: 62000 }, `tx-${item.order_code}`, item.payment_code);
    expect(result.updated.amount_paid).toBe(62000); expect(hooks.start.mock.calls[0][0].order.amount_paid).toBe(62000); await flush();
  });
  it('keeps the canonical invoice identity gate before the new fast branch', async () => {
    const item = fixture();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      db.prepare('UPDATE orders SET customer_id=? WHERE order_code=?').run('1222222222222222222', item.order_code);
      return Response.json({ code: '00', data: paidInfo(item) });
    });
    await expect(syncPaymentStatusFromPayOS({ client: client(), orderCode: item.order_code })).rejects.toMatchObject({ code: 'PAYMENT_IDENTITY_MISMATCH' });
    expect(hooks.start).not.toHaveBeenCalled(); expect(getOrderByCode(item.order_code).payment_status).toBe('UNPAID');
  });
});

describe('global reconciliation candidate fairness', () => {
  it('excludes all journal-owned paid supplier statuses before LIMIT, preserving unpaid and legacy lookups', async () => {
    for (const status of ['PENDING', 'SENDING', 'SENT', 'UNKNOWN', 'REVIEW']) {
      const item = fixture(); recordOrderPayment({ orderCode: item.order_code, provider: 'PAYOS', transactionId: `old-${item.order_code}`, amount: 61000 });
      db.prepare(`INSERT INTO supplier_autobuy_payment_notices(order_code,guild_id,customer_id,provider,request_id,sale_amount,paid_amount,identity_json,status,updated_at)
        VALUES(?,?,?,'dopermind',?,61000,61000,'{}',?,?)`).run(item.order_code, guildId, customerId, `request-${item.order_code}`, status, new Date().toISOString());
    }
    const unpaid = fixture(), legacy = fixture(false);
    recordOrderPayment({ orderCode: legacy.order_code, provider: 'PAYOS', transactionId: `legacy-${legacy.order_code}`, amount: 61000 });
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
      const item = String(url).endsWith(unpaid.payment_link_id) ? unpaid : legacy;
      return Response.json({ code: '00', data: paidInfo(item, { status: 'PENDING', amountPaid: 0 }) });
    });
    const report = await reconcileRecentPayOSPayments(client(), { limit: 2 });
    expect(report.scanned).toBe(2); expect(report.failed).toEqual([]); expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map(([url]) => String(url).split('/').at(-1))).toEqual([unpaid.payment_link_id, legacy.payment_link_id]);
    expect(hooks.start).not.toHaveBeenCalled();
  });
});

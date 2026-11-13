import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/database/db.js', () => ({ db: { transaction: fn => Object.assign(fn, { immediate: fn }) } }));
vi.mock('../src/config.js', () => ({ config: {} }));
import { createSupplierAutobuyCheckout } from '../src/services/supplierAutobuyCheckoutService.js';

const guildId = '1282637033340403754';
const users = ['111111111111111111', '222222222222222222', '333333333333333333'];
const databases = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const error = code => Object.assign(new Error('Synthetic checkout rejection'), { code });
function fixture() {
  const database = new Database(':memory:'); databases.push(database);
  database.exec(`CREATE TABLE orders(order_code TEXT PRIMARY KEY,guild_id TEXT,customer_id TEXT,fulfillment_mode TEXT,payment_status TEXT,
    status TEXT,total_amount INTEGER,quantity INTEGER,payment_link_id TEXT,payment_checkout_url TEXT,payment_qr_code TEXT,payment_qr_text TEXT,payment_expired_at TEXT);
    CREATE TABLE supplier_autobuy_intents(order_code TEXT PRIMARY KEY,guild_id TEXT,customer_id TEXT,provider TEXT,product_key TEXT,quantity INTEGER);
    CREATE TABLE test_wallets(customer_id TEXT PRIMARY KEY,balance INTEGER);
    CREATE TABLE test_debits(order_code TEXT PRIMARY KEY,amount INTEGER);`);
  for (const user of users) database.prepare('INSERT INTO test_wallets VALUES(?,?)').run(user, 1000000);
  const add = (orderCode, user = users[0], provider = 'dopermind', key = 'desc_shared') => {
    database.prepare(`INSERT INTO orders(order_code,guild_id,customer_id,fulfillment_mode,payment_status,status,total_amount,quantity)
      VALUES(?,?,?,'SUPPLIER','UNPAID','PENDING_PAYMENT',61000,1)`).run(orderCode, guildId, user);
    database.prepare('INSERT INTO supplier_autobuy_intents VALUES(?,?,?,?,?,1)').run(orderCode, guildId, user, provider, key);
    return { guildId, customerId: user, orderCode, provider, method: 'payos' };
  };
  const a = add('CN_123456'), b = add('CN_123457', users[1], 'cdkvietnam', 'cdkvietnam:1');
  const readOrder = code => database.prepare('SELECT * FROM orders WHERE order_code=?').get(code);
  const owned = vi.fn(async input => {
    const row = readOrder(input.orderCode), intent = database.prepare('SELECT * FROM supplier_autobuy_intents WHERE order_code=?').get(input.orderCode);
    if (!row || row.guild_id !== input.guildId || row.customer_id !== input.customerId) throw error('ORDER_NOT_FOUND');
    if (input.provider !== undefined && input.provider !== intent.provider) throw error('PROVIDER_MISMATCH');
    return { orderCode: row.order_code, provider: intent.provider, status: row.status };
  });
  const stock = new Map(), barriers = new Map(), blocked = new Set();
  const validate = vi.fn(async input => {
    await barriers.get(input.orderCode)?.promise;
    const intent = database.prepare('SELECT * FROM supplier_autobuy_intents WHERE order_code=?').get(input.orderCode);
    const reserved = database.prepare(`SELECT COALESCE(SUM(i.quantity),0) AS n FROM supplier_autobuy_intents i
      JOIN orders o ON o.order_code=i.order_code JOIN supplier_autobuy_payment_methods m ON m.order_code=i.order_code
      WHERE i.order_code!=? AND i.provider=? AND i.product_key=? AND o.status IN ('PENDING_PAYMENT','PROCESSING')`)
      .get(input.orderCode, intent.provider, intent.product_key).n;
    if ((stock.get(intent.product_key) ?? 100) < intent.quantity + reserved) throw error('OUT_OF_STOCK');
  });
  const debitWallet = vi.fn(input => database.transaction(() => {
    const order = readOrder(input.orderCode);
    const balance = database.prepare('SELECT balance FROM test_wallets WHERE customer_id=?').get(input.customerId).balance;
    if (balance < order.total_amount) throw error('INSUFFICIENT_BALANCE');
    if (order.payment_status !== 'UNPAID' || order.total_amount !== input.amount) throw error('PAYMENT_CHANGED');
    database.prepare('UPDATE test_wallets SET balance=balance-? WHERE customer_id=?').run(input.amount, input.customerId);
    database.prepare('INSERT INTO test_debits VALUES(?,?)').run(input.orderCode, input.amount);
    database.prepare("UPDATE orders SET payment_status='PAID',status='PROCESSING' WHERE order_code=?").run(input.orderCode);
    return { order: readOrder(input.orderCode) };
  }).immediate());
  const payosLink = vi.fn(async order => {
    database.prepare("UPDATE orders SET payment_link_id=?,payment_checkout_url=? WHERE order_code=?")
      .run(`link-${order.order_code}`, `https://pay.payos.vn/web/${order.order_code}`, order.order_code);
    return readOrder(order.order_code);
  });
  const fulfill = vi.fn(async (_client, code) => ({ updated: readOrder(code) }));
  const engine = { getSupplierOrderForCustomer: owned, validateSupplierOrderForPayment: validate, fulfillSupplierOrder: fulfill };
  const checkout = createSupplierAutobuyCheckout({ database, enabled: () => true, engine,
    customerFlag: (_guild, user) => ({ is_blacklisted: blocked.has(user) ? 1 : 0 }), ticketMute: () => ({}),
    readOrder, debitWallet, payosLink, syncPayos: vi.fn(), publishOrder: vi.fn(), publishTicketOrder: vi.fn() });
  return { database, a, b, add, checkout, payosLink, fulfill, validate, stock, barriers, blocked, readOrder, owned, debitWallet };
}

describe('independent financial checkout progress', () => {
  it('lets another customer/source pay while an unrelated PayOS request is stalled', async () => {
    const t = fixture(), wait = deferred(), normalLink = t.payosLink.getMockImplementation();
    t.payosLink.mockImplementation(async order => { if (order.order_code === t.a.orderCode) await wait.promise; return normalLink(order); });
    const a = t.checkout.payment(t.a); await vi.waitFor(() => expect(t.payosLink).toHaveBeenCalledOnce());
    let bDone = false; const b = t.checkout.payment(t.b).then(result => { bDone = true; return result; });
    let progressed;
    try { await vi.waitFor(() => expect(bDone).toBe(true), { timeout: 300 }); progressed = true; }
    catch { progressed = false; }
    finally { wait.resolve(); await Promise.all([a, b]); }
    expect(progressed).toBe(true);
    expect(t.payosLink).toHaveBeenCalledTimes(2); expect(t.debitWallet).not.toHaveBeenCalled();
  });
  it('does not hold another SKU/customer behind wallet fulfillment', async () => {
    const t = fixture(), wait = deferred();
    t.fulfill.mockImplementationOnce(async () => { await wait.promise; return { updated: t.readOrder(t.a.orderCode) }; });
    const a = t.checkout.payment({ ...t.a, method: 'wallet' });
    await vi.waitFor(() => expect(t.fulfill).toHaveBeenCalledOnce());
    try { expect(await t.checkout.payment(t.b)).toMatchObject({ orderCode: t.b.orderCode, paid: false }); }
    finally { wait.resolve(); }
    expect(await a).toMatchObject({ paid: true, totalAmount: 61000 });
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM test_debits').get().n).toBe(1);
  });
  it('responds after durable wallet debit without waiting for slow source or DM work', async () => {
    const t = fixture(), wait = deferred();
    t.fulfill.mockImplementationOnce(async () => { await wait.promise; return { updated: { status: 'COMPLETED' } }; });
    const paid = await t.checkout.payment({ ...t.a, method: 'wallet' });
    expect(paid).toMatchObject({ paid: true, status: 'PROCESSING', totalAmount: 61000, method: 'WALLET' });
    expect(t.readOrder(t.a.orderCode)).toMatchObject({ payment_status: 'PAID', status: 'PROCESSING' });
    expect(t.fulfill).toHaveBeenCalledOnce();
    const next = await t.checkout.payment({ ...t.a, method: 'payos' });
    expect(next).toMatchObject({ paid: true, method: 'WALLET' });
    expect(t.payosLink).not.toHaveBeenCalled(); expect(t.debitWallet).toHaveBeenCalledOnce();
    wait.resolve();
  });
  it('contains an untrusted background fulfillment error and leaves paid work durable for the worker', async () => {
    const t = fixture(); t.fulfill.mockRejectedValueOnce(new Error('private-source-secret'));
    const paid = await t.checkout.payment({ ...t.a, method: 'wallet' });
    await Promise.resolve();
    expect(paid).toMatchObject({ paid: true, status: 'PROCESSING', totalAmount: 61000 });
    expect(JSON.stringify(paid)).not.toContain('private-source-secret');
    await t.checkout.payment({ ...t.a, method: 'wallet' });
    expect(t.fulfill).toHaveBeenCalledOnce(); expect(t.debitWallet).toHaveBeenCalledOnce();
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM test_debits').get().n).toBe(1);
  });
  it('admits only one of two same-SKU customers with stock one, without mutual preflight rejection', async () => {
    const t = fixture(), other = t.add('CN_123458', users[2]), wait = deferred(), invoice = deferred();
    t.stock.set('desc_shared', 1); t.barriers.set(t.a.orderCode, wait);
    t.payosLink.mockImplementationOnce(async order => { await invoice.promise; return { ...order, payment_link_id: 'fixed-invoice' }; });
    const first = t.checkout.payment(t.a); await vi.waitFor(() => expect(t.validate).toHaveBeenCalledOnce());
    const second = t.checkout.payment(other), secondCheck = expect(second).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
    expect(t.validate).toHaveBeenCalledOnce(); wait.resolve(); await secondCheck;
    expect(t.payosLink).toHaveBeenCalledOnce();
    expect(t.database.prepare('SELECT order_code FROM supplier_autobuy_payment_methods').all()).toEqual([{ order_code: t.a.orderCode }]);
    invoice.resolve(); await first;
  });
  it('coalesces the exact method but rejects a wallet-vs-PayOS race for the same order', async () => {
    const t = fixture(), wait = deferred(), normal = t.payosLink.getMockImplementation();
    t.payosLink.mockImplementationOnce(async order => { await wait.promise; return normal(order); });
    const one = t.checkout.payment(t.a); await vi.waitFor(() => expect(t.payosLink).toHaveBeenCalledOnce());
    const repeated = t.checkout.payment(t.a), wallet = t.checkout.payment({ ...t.a, method: 'wallet' });
    const walletCheck = expect(wallet).rejects.toMatchObject({ code: 'PAYMENT_METHOD_LOCKED' });
    wait.resolve(); const [firstResult, repeatResult] = await Promise.all([one, repeated]); await walletCheck;
    expect(firstResult).toEqual(repeatResult); expect(t.payosLink).toHaveBeenCalledOnce(); expect(t.debitWallet).not.toHaveBeenCalled();
    expect(t.database.prepare('SELECT method FROM supplier_autobuy_payment_methods').get().method).toBe('PAYOS');
  });
  it('preserves an uncertain invoice choice while releasing queues for retry and unrelated orders', async () => {
    const t = fixture(); t.payosLink.mockRejectedValueOnce(new Error('Synthetic lost invoice response'));
    await expect(t.checkout.payment(t.a)).rejects.toThrow('Synthetic lost invoice response');
    await expect(t.checkout.payment({ ...t.a, method: 'wallet' })).rejects.toMatchObject({ code: 'PAYMENT_METHOD_LOCKED' });
    expect(await t.checkout.payment(t.b)).toMatchObject({ orderCode: t.b.orderCode });
    expect(await t.checkout.payment(t.a)).toMatchObject({ orderCode: t.a.orderCode });
    expect(t.payosLink.mock.calls.map(([order]) => order.order_code)).toEqual([t.a.orderCode, t.b.orderCode, t.a.orderCode]);
    expect(t.debitWallet).not.toHaveBeenCalled();
  });
  it('releases a rejected preflight claim so another same-SKU order can reserve stock', async () => {
    const t = fixture(), other = t.add('CN_123458', users[2]); t.stock.set('desc_shared', 1);
    t.validate.mockRejectedValueOnce(error('QUOTE_CHANGED'));
    const rejected = t.checkout.payment(t.a), rejectedCheck = expect(rejected).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    const accepted = t.checkout.payment(other); await rejectedCheck;
    expect(await accepted).toMatchObject({ orderCode: other.orderCode });
    expect(t.payosLink).toHaveBeenCalledOnce();
    expect(t.database.prepare('SELECT order_code FROM supplier_autobuy_payment_methods').all()).toEqual([{ order_code: other.orderCode }]);
  });
  it.each(['cancelled', 'restricted'])('rechecks %s changes during slow preflight before any debit or invoice', async changed => {
    const t = fixture(), wait = deferred(); t.barriers.set(t.a.orderCode, wait);
    const payment = t.checkout.payment({ ...t.a, method: 'wallet' });
    const check = expect(payment).rejects.toMatchObject({ code: changed === 'cancelled' ? 'ORDER_NOT_PAYABLE' : 'CUSTOMER_RESTRICTED' });
    await vi.waitFor(() => expect(t.validate).toHaveBeenCalledOnce());
    if (changed === 'cancelled') t.database.prepare("UPDATE orders SET status='CANCELLED' WHERE order_code=?").run(t.a.orderCode);
    else t.blocked.add(t.a.customerId);
    wait.resolve(); await check;
    expect(t.debitWallet).not.toHaveBeenCalled(); expect(t.payosLink).not.toHaveBeenCalled();
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM supplier_autobuy_payment_methods').get().n).toBe(0);
  });
  it('retains wallet atomicity across independent SKU queues when a customer has funds for only one order', async () => {
    const t = fixture(), other = t.add('CN_123458', users[0], 'dopermind', 'desc_other');
    t.database.prepare('UPDATE test_wallets SET balance=61000 WHERE customer_id=?').run(users[0]);
    const result = await Promise.allSettled([t.checkout.payment({ ...t.a, method: 'wallet' }), t.checkout.payment({ ...other, method: 'wallet' })]);
    expect(result.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(result.find(row => row.status === 'rejected').reason).toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(t.database.prepare('SELECT balance FROM test_wallets WHERE customer_id=?').get(users[0]).balance).toBe(0);
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM test_debits').get().n).toBe(1);
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM supplier_autobuy_payment_methods').get().n).toBe(1);
  });
  it('releases stock admission when an older invoice has authoritatively expired', async () => {
    const t = fixture(), other = t.add('CN_123458', users[2]); t.stock.set('desc_shared', 1);
    await t.checkout.payment(t.a);
    t.database.prepare("UPDATE orders SET status='CANCELLED' WHERE order_code=?").run(t.a.orderCode);
    expect(await t.checkout.payment(other)).toMatchObject({ orderCode: other.orderCode });
    await expect(t.checkout.payment({ ...t.a, method: 'wallet' })).rejects.toMatchObject({ code: 'ORDER_NOT_PAYABLE' });
    expect(t.payosLink).toHaveBeenCalledTimes(2); expect(t.debitWallet).not.toHaveBeenCalled();
  });
  it('reports an already-settled PayOS result as paid rather than an unpaid invoice', async () => {
    const t = fixture();
    t.payosLink.mockImplementationOnce(async order => {
      t.database.prepare("UPDATE orders SET payment_status='PAID',status='PROCESSING' WHERE order_code=?").run(order.order_code);
      return t.readOrder(order.order_code);
    });
    expect(await t.checkout.payment(t.a)).toMatchObject({ paid: true, status: 'PROCESSING', totalAmount: 61000 });
    expect(t.fulfill).not.toHaveBeenCalled(); expect(t.debitWallet).not.toHaveBeenCalled();
  });
  it('refuses foreign or untrusted invoice DTO amounts without exposing them or debiting a wallet', async () => {
    const t = fixture();
    t.payosLink.mockImplementationOnce(async order => ({ ...order, customer_id: users[1], total_amount: 'private-payment-data' }));
    await expect(t.checkout.payment(t.a)).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND' });
    t.payosLink.mockImplementationOnce(async order => ({ ...order, total_amount: 'private-payment-data' }));
    await expect(t.checkout.payment(t.a)).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    expect(t.debitWallet).not.toHaveBeenCalled();
  });
});

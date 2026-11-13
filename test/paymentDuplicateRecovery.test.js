import fs from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(process.env, {
  ENV_FILE: '.env.payment-duplicate-test-absent', DATABASE_PATH: `./data/test-payment-duplicate-${process.pid}-${Date.now()}.sqlite`,
  PAYOS_CLIENT_ID: 'synthetic-client', PAYOS_API_KEY: 'synthetic-api', PAYOS_CHECKSUM_KEY: 'synthetic-checksum', PUBLIC_BASE_URL: 'https://bot.example',
}));
const preflight = vi.hoisted(() => vi.fn());
vi.mock('../src/services/supplierAutobuyOrderService.js', () => ({ validateSupplierOrderForPayment: preflight }));
import { db, initDatabase } from '../src/database/db.js';
import { createTicket } from '../src/services/ticketService.js';
import { createOrder, getOrderByCode } from '../src/services/orderService.js';
import { createOrLoadPayOSLink, syncPaymentStatusFromPayOS } from '../src/services/paymentService.js';

let sequence = 0;
beforeAll(() => {
  initDatabase();
  db.exec('CREATE TABLE IF NOT EXISTS supplier_autobuy_payment_methods(order_code TEXT PRIMARY KEY,method TEXT,created_at TEXT)');
});
afterEach(() => { vi.restoreAllMocks(); preflight.mockReset(); });
afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.DATABASE_PATH + suffix, { force: true });
});
function fixture(supplier = true) {
  const code = `CN_${980000 + ++sequence}`;
  const ticket = createTicket({ guildId: '1282637033340403754', channelId: `duplicate-${code}`, customerId: '1138315103821889566',
    openedById: '1138315103821889566', ticketType: 'ORDER' });
  const order = createOrder({ orderCode: code, guildId: ticket.guild_id, customerId: ticket.customer_id, ticketId: ticket.id,
    ticketChannelId: ticket.channel_id, createdById: ticket.customer_id, productName: 'Synthetic package', totalAmount: 61000,
    quantity: 1, durationMonths: 1, orderLogChannelId: 'fixture-log' });
  if (supplier) {
    db.prepare("UPDATE orders SET fulfillment_mode='SUPPLIER' WHERE order_code=?").run(code);
    db.prepare("INSERT INTO supplier_autobuy_payment_methods VALUES (?,'PAYOS',CURRENT_TIMESTAMP)").run(code);
  }
  return getOrderByCode(order.order_code);
}
function info(order, changes = {}) {
  return { id: `link-${order.order_code}`, orderCode: order.payos_order_code, amount: order.total_amount, status: 'PENDING', ...changes };
}
function duplicateLookup(order, changes = {}, beforeLookup = () => {}) {
  return vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ code: '231', desc: 'Đơn thanh toán đã tồn tại' }))
    .mockImplementationOnce(async () => { beforeLookup(); return Response.json({ code: '00', data: info(order, changes) }); });
}
function noPaymentEffects(order) {
  expect(db.prepare('SELECT COUNT(*) AS n FROM payment_events WHERE order_code=?').get(order.order_code).n).toBe(0);
  expect(db.prepare('SELECT COUNT(*) AS n FROM order_fulfillments WHERE order_code=?').get(order.order_code).n).toBe(0);
}

describe('recovery of one original PayOS invoice after uncertain creation', () => {
  it.each([true, false])('recovers a matching pending invoice without changing its identity (supplier=%s)', async supplier => {
    const order = fixture(supplier), fetch = duplicateLookup(order);
    const saved = await createOrLoadPayOSLink(order);
    expect(saved).toMatchObject({ status: 'PENDING_PAYMENT', payment_status: 'UNPAID', payos_order_code: order.payos_order_code,
      payment_link_id: `link-${order.order_code}`, payment_checkout_url: `https://pay.payos.vn/web/link-${order.order_code}` });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[0][1].body).orderCode).toBe(order.payos_order_code);
    expect(fetch.mock.calls[1][0].endsWith(`/v2/payment-requests/${order.payos_order_code}`)).toBe(true);
    noPaymentEffects(order);
  });
  it('preserves the legacy camelCase input for a matching pending invoice', async () => {
    const order = fixture(false), fetch = duplicateLookup(order);
    const saved = await createOrLoadPayOSLink({ orderCode: order.order_code, payosOrderCode: order.payos_order_code,
      totalAmount: order.total_amount, productName: order.product_name, paymentCode: order.payment_code });
    expect(saved).toMatchObject({ payment_link_id: `link-${order.order_code}`, status: 'PENDING_PAYMENT', payment_status: 'UNPAID' });
    expect(fetch).toHaveBeenCalledTimes(2); noPaymentEffects(order);
  });
  it.each(['EXPIRED', 'CANCELLED'])('does not offer a recovered %s invoice as payable or create another one', async status => {
    const order = fixture(), expiry = new Date(Date.now() - 3600000).toISOString();
    db.prepare('UPDATE orders SET payment_expired_at=? WHERE order_code=?').run(expiry, order.order_code);
    const fetch = duplicateLookup(order, { status });
    await expect(createOrLoadPayOSLink(getOrderByCode(order.order_code))).rejects.toMatchObject({ code: 'PAYMENT_RECONCILIATION_REQUIRED' });
    expect(getOrderByCode(order.order_code)).toMatchObject({ status: 'CANCELLED', payment_status: 'UNPAID',
      payment_link_id: `link-${order.order_code}`, payment_checkout_url: null, payment_qr_code: null, payment_expired_at: expiry });
    expect(db.prepare('SELECT method FROM supplier_autobuy_payment_methods WHERE order_code=?').get(order.order_code).method).toBe('PAYOS');
    await expect(createOrLoadPayOSLink(getOrderByCode(order.order_code))).rejects.toMatchObject({ code: 'PAYMENT_METHOD_LOCKED' });
    expect(fetch).toHaveBeenCalledTimes(2); noPaymentEffects(order);
  });
  it.each(['PAID', 'PROCESSING', 'UNKNOWN', ''])('holds recovered %s for reconciliation without a QR, invented receipt or repeated POST', async status => {
    const order = fixture(), fetch = duplicateLookup(order, { status });
    fetch.mockResolvedValueOnce(Response.json({ code: '00', data: info(order, { status }) }));
    await expect(createOrLoadPayOSLink(order)).rejects.toMatchObject({ code: 'PAYMENT_RECONCILIATION_REQUIRED' });
    const saved = getOrderByCode(order.order_code);
    expect(saved).toMatchObject({ status: 'PENDING_PAYMENT', payment_status: 'UNPAID', amount_paid: 0,
      payment_link_id: `link-${order.order_code}`, payment_checkout_url: null, payment_qr_code: null });
    await expect(createOrLoadPayOSLink(saved)).rejects.toMatchObject({ code: 'PAYMENT_RECONCILIATION_REQUIRED' });
    expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
    expect(fetch.mock.calls.filter(([, options]) => options.method === 'GET')).toHaveLength(2);
    noPaymentEffects(order);
  });
  it.each(['PAID', 'EXPIRED', 'CANCELLED', 'PROCESSING', 'UNKNOWN', null])('does not expose explicit %s even on a successful create response', async status => {
    const order = fixture();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ code: '00', data: {
      paymentLinkId: `link-${order.order_code}`, orderCode: order.payos_order_code, amount: order.total_amount, status,
      checkoutUrl: `https://pay.payos.vn/web/link-${order.order_code}`, qrCode: '000201synthetic',
    } }));
    await expect(createOrLoadPayOSLink(order)).rejects.toMatchObject({ code: 'PAYMENT_RECONCILIATION_REQUIRED' });
    expect(getOrderByCode(order.order_code)).toMatchObject({ payment_status: 'UNPAID', amount_paid: 0,
      payment_link_id: `link-${order.order_code}`, payment_checkout_url: null, payment_qr_code: null });
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1].method).toBe('POST');
    noPaymentEffects(order);
  });
  it.each([
    ['foreign order', order => ({ orderCode: order.payos_order_code + 1 })],
    ['missing order', () => ({ orderCode: undefined })],
    ['boolean order', () => ({ orderCode: true })],
    ['wrong amount', () => ({ amount: 62000 })],
    ['fractional amount', () => ({ amount: 61000.5 })],
    ['boolean amount', () => ({ amount: true })],
    ['null amount', () => ({ amount: null })],
    ['missing link', () => ({ id: undefined })],
  ])('refuses %s before saving any invoice or payment', async (_label, changes) => {
    const order = fixture(), fetch = duplicateLookup(order, changes(order));
    await expect(createOrLoadPayOSLink(order)).rejects.toMatchObject({ code: 'PAYMENT_IDENTITY_MISMATCH' });
    expect(getOrderByCode(order.order_code)).toEqual(order);
    expect(fetch).toHaveBeenCalledTimes(2); noPaymentEffects(order);
  });
  it('checks an incomplete known link with GET and refuses a different returned link', async () => {
    const order = fixture();
    db.prepare("UPDATE orders SET payment_link_id='original-link' WHERE order_code=?").run(order.order_code);
    const saved = getOrderByCode(order.order_code);
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code: '00', data: info(order, { id: 'different-link' }) }));
    await expect(createOrLoadPayOSLink(saved)).rejects.toMatchObject({ code: 'PAYMENT_IDENTITY_MISMATCH' });
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0][1].method).toBe('GET');
    expect(getOrderByCode(order.order_code)).toEqual(saved); noPaymentEffects(order);
  });
  it('never overwrites a replacement invoice committed while the duplicate lookup was pending', async () => {
    const order = fixture(), fetch = duplicateLookup(order, {}, () => {
      db.prepare("UPDATE orders SET payos_order_code=payos_order_code+10000,payment_link_id='replacement-link',payment_checkout_url='https://pay.payos.vn/web/replacement-link' WHERE order_code=?").run(order.order_code);
    });
    await expect(createOrLoadPayOSLink(order)).rejects.toMatchObject({ code: 'PAYMENT_IDENTITY_MISMATCH' });
    expect(getOrderByCode(order.order_code)).toMatchObject({ payos_order_code: order.payos_order_code + 10000, payment_link_id: 'replacement-link' });
    expect(fetch).toHaveBeenCalledTimes(2); noPaymentEffects(order);
  });
  it('does not cancel a webhook payment that committed during an expired duplicate lookup', async () => {
    const order = fixture(), fetch = duplicateLookup(order, { status: 'EXPIRED' }, () => {
      db.prepare("UPDATE orders SET status='PROCESSING',payment_status='PAID',amount_paid=total_amount WHERE order_code=?").run(order.order_code);
    });
    await expect(createOrLoadPayOSLink(order)).rejects.toMatchObject({ code: 'PAYMENT_RECONCILIATION_REQUIRED' });
    expect(getOrderByCode(order.order_code)).toMatchObject({ status: 'PROCESSING', payment_status: 'PAID', amount_paid: 61000 });
    expect(fetch).toHaveBeenCalledTimes(2); noPaymentEffects(order);
  });
  it.each(['replacement identity', 'amount', 'customer'])('does not overwrite a changed %s after a successful pending POST', async change => {
    const order = fixture();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      if (change === 'replacement identity') db.prepare("UPDATE orders SET payos_order_code=payos_order_code+10000,payment_link_id='replacement-link',payment_checkout_url='https://pay.payos.vn/web/replacement-link' WHERE order_code=?").run(order.order_code);
      if (change === 'amount') db.prepare('UPDATE orders SET total_amount=62000 WHERE order_code=?').run(order.order_code);
      if (change === 'customer') db.prepare("UPDATE orders SET customer_id='222222222222222222' WHERE order_code=?").run(order.order_code);
      return Response.json({ code: '00', data: { paymentLinkId: 'original-link', orderCode: order.payos_order_code,
        amount: order.total_amount, status: 'PENDING', checkoutUrl: 'https://pay.payos.vn/web/original-link' } });
    });
    await expect(createOrLoadPayOSLink(order)).rejects.toMatchObject({ code: 'PAYMENT_IDENTITY_MISMATCH' });
    const fresh = getOrderByCode(order.order_code);
    expect(fresh.payment_link_id).toBe(change === 'replacement identity' ? 'replacement-link' : null);
    expect(fetch).toHaveBeenCalledOnce(); noPaymentEffects(order);
  });
  it('does not overwrite a replacement link even when its numeric invoice code was retained', async () => {
    const order = fixture();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      db.prepare("UPDATE orders SET payment_link_id='replacement-link' WHERE order_code=?").run(order.order_code);
      return Response.json({ code: '00', data: { paymentLinkId: 'original-link', checkoutUrl: 'https://pay.payos.vn/web/original-link' } });
    });
    await expect(createOrLoadPayOSLink(order)).rejects.toMatchObject({ code: 'PAYMENT_IDENTITY_MISMATCH' });
    expect(getOrderByCode(order.order_code).payment_link_id).toBe('replacement-link');
    expect(fetch).toHaveBeenCalledOnce(); noPaymentEffects(order);
  });
  it.each(['CANCELLED', 'REFUNDED', 'PAID'])('retains accepted invoice identity without QR after concurrent %s', async state => {
    const order = fixture();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      db.prepare('UPDATE orders SET status=?,payment_status=?,amount_paid=? WHERE order_code=?')
        .run(state === 'PAID' ? 'PROCESSING' : state, state, state === 'PAID' ? order.total_amount : 0, order.order_code);
      return Response.json({ code: '00', data: { paymentLinkId: 'accepted-link', checkoutUrl: 'https://pay.payos.vn/web/accepted-link' } });
    });
    await expect(createOrLoadPayOSLink(order)).rejects.toMatchObject({ code: 'PAYMENT_RECONCILIATION_REQUIRED' });
    expect(getOrderByCode(order.order_code)).toMatchObject({ status: state === 'PAID' ? 'PROCESSING' : state, payment_status: state,
      payment_link_id: 'accepted-link', payment_checkout_url: null, payment_qr_code: null });
    expect(fetch).toHaveBeenCalledOnce(); noPaymentEffects(order);
  });
  it.each(['replacement identity', 'amount', 'customer'])('does not credit a changed %s from an old paid GET snapshot', async change => {
    const order = fixture(), client = { guilds: { fetch: vi.fn() }, users: { fetch: vi.fn() } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      if (change === 'replacement identity') db.prepare("UPDATE orders SET payos_order_code=payos_order_code+10000,payment_link_id='replacement-link' WHERE order_code=?").run(order.order_code);
      if (change === 'amount') db.prepare('UPDATE orders SET total_amount=60000 WHERE order_code=?').run(order.order_code);
      if (change === 'customer') db.prepare("UPDATE orders SET customer_id='222222222222222222' WHERE order_code=?").run(order.order_code);
      return Response.json({ code: '00', data: info(order, { status: 'PAID', amountPaid: order.total_amount }) });
    });
    await expect(syncPaymentStatusFromPayOS({ client, orderCode: order.order_code })).rejects.toMatchObject({ code: 'PAYMENT_IDENTITY_MISMATCH' });
    expect(getOrderByCode(order.order_code)).toMatchObject({ status: 'PENDING_PAYMENT', payment_status: 'UNPAID', amount_paid: 0 });
    expect(fetch).toHaveBeenCalledOnce(); expect(client.guilds.fetch).not.toHaveBeenCalled(); expect(client.users.fetch).not.toHaveBeenCalled();
    noPaymentEffects(order);
  });
});

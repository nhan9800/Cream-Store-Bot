import fs from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(process.env, {
  ENV_FILE: '.env.supplier-payment-routes-test-absent', DATABASE_PATH: `./data/test-supplier-payment-routes-${process.pid}.sqlite`,
  PAYOS_CLIENT_ID: 'fixture-client', PAYOS_API_KEY: 'fixture-api', PAYOS_CHECKSUM_KEY: 'fixture-checksum', PUBLIC_BASE_URL: 'https://bot.example',
}));
const preflight = vi.hoisted(() => vi.fn());
vi.mock('../src/services/supplierAutobuyOrderService.js', () => ({ validateSupplierOrderForPayment: preflight }));
import { db, initDatabase } from '../src/database/db.js';
import { createTicket } from '../src/services/ticketService.js';
import { createOrder, getOrderByCode } from '../src/services/orderService.js';
import { createOrLoadPayOSLink, regeneratePaymentQr, sendVietQRPayment, syncPaymentStatusFromPayOS } from '../src/services/paymentService.js';

let sequence = 0;
function fixture(method = 'PAYOS') {
  const ticket = createTicket({ guildId: '1282637033340403754', channelId: `fixture-${++sequence}`,
    customerId: '1138315103821889566', openedById: '1138315103821889566', ticketType: 'ORDER' });
  const order = createOrder({ orderCode: `CN_${960000 + sequence}`, guildId: ticket.guild_id, customerId: ticket.customer_id,
    ticketId: ticket.id, ticketChannelId: ticket.channel_id, createdById: ticket.customer_id,
    productName: '[AutoBuy] Fixture', totalAmount: 61000, quantity: 1, durationMonths: 1, orderLogChannelId: 'fixture-log' });
  db.prepare("UPDATE orders SET fulfillment_mode='SUPPLIER',payment_link_id='existing-link',payment_checkout_url='https://pay.payos.vn/web/existing-link' WHERE order_code=?").run(order.order_code);
  db.prepare('INSERT INTO supplier_autobuy_payment_methods VALUES (?,?,?)').run(order.order_code, method, new Date().toISOString());
  return getOrderByCode(order.order_code);
}
beforeAll(() => {
  initDatabase();
  db.exec('CREATE TABLE IF NOT EXISTS supplier_autobuy_payment_methods(order_code TEXT PRIMARY KEY,method TEXT,created_at TEXT)');
});
afterEach(() => { vi.restoreAllMocks(); preflight.mockReset(); });
afterAll(() => { db.close(); for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.DATABASE_PATH + suffix, { force: true }); });

describe('supplier payment lower route protections', () => {
  it('rejects generic VietQR fallback without fetching a QR or posting bank details', async () => {
    const order = fixture();
    const fetch = vi.spyOn(globalThis, 'fetch');
    const guild = { channels: { fetch: vi.fn() } };
    await expect(sendVietQRPayment({ guild, orderCode: order.order_code })).rejects.toMatchObject({ code: 'PAYMENT_METHOD_LOCKED' });
    expect(fetch).not.toHaveBeenCalled(); expect(guild.channels.fetch).not.toHaveBeenCalled();
    expect(getOrderByCode(order.order_code)).toEqual(order);
  });
  it('never cancels or resets an uncertain existing supplier payment identity', async () => {
    const order = fixture();
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(regeneratePaymentQr({ guild: {}, orderCode: order.order_code })).rejects.toMatchObject({ code: 'PAYMENT_METHOD_LOCKED' });
    expect(fetch).not.toHaveBeenCalled(); expect(getOrderByCode(order.order_code)).toEqual(order);
  });
  it('rechecks current quote before returning even an existing supplier PayOS invoice', async () => {
    const order = fixture();
    preflight.mockRejectedValueOnce(Object.assign(new Error('safe quote failure'), { code: 'QUOTE_CHANGED' }));
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(createOrLoadPayOSLink({ ...order, fulfillment_mode: 'LEGACY', total_amount: 1 })).rejects.toMatchObject({ code: 'QUOTE_CHANGED' });
    expect(preflight).toHaveBeenCalledExactlyOnceWith({ guildId: order.guild_id, customerId: order.customer_id, orderCode: order.order_code });
    expect(fetch).not.toHaveBeenCalled(); expect(getOrderByCode(order.order_code)).toEqual(order);
  });
  it('denies a generic PayOS request on an order locked to wallet', async () => {
    const order = fixture('WALLET');
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(createOrLoadPayOSLink(order)).rejects.toMatchObject({ code: 'PAYMENT_METHOD_LOCKED' });
    expect(preflight).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['EXPIRED', 'CANCELLED'])('releases an unpaid reservation only after matching PayOS %s', async status => {
    const order = fixture();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code: '00', data: { id: order.payment_link_id, orderCode: order.payos_order_code, status } }));
    expect(await syncPaymentStatusFromPayOS({ client: {}, orderCode: order.order_code })).toMatchObject({ state: status, synced: true });
    expect(getOrderByCode(order.order_code)).toMatchObject({ status: 'CANCELLED', payment_status: 'UNPAID' });
  });
  it('retains a pending reservation on a mismatched expired invoice', async () => {
    const order = fixture();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code: '00', data: { id: 'foreign-link', orderCode: order.payos_order_code, status: 'EXPIRED' } }));
    await expect(syncPaymentStatusFromPayOS({ client: {}, orderCode: order.order_code })).rejects.toMatchObject({ code: 'PAYMENT_IDENTITY_MISMATCH' });
    expect(getOrderByCode(order.order_code)).toEqual(order);
  });
  it('never cancels payment committed by a webhook while the terminal lookup was in flight', async () => {
    const order = fixture();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      db.prepare("UPDATE orders SET status='PROCESSING',payment_status='PAID',amount_paid=total_amount WHERE order_code=?").run(order.order_code);
      return Response.json({ code: '00', data: { id: order.payment_link_id, orderCode: order.payos_order_code, status: 'EXPIRED' } });
    });
    expect(await syncPaymentStatusFromPayOS({ client: {}, orderCode: order.order_code })).toMatchObject({ synced: false });
    expect(getOrderByCode(order.order_code)).toMatchObject({ status: 'PROCESSING', payment_status: 'PAID' });
  });
  it('never cancels a replacement invoice when an older terminal lookup returns late', async () => {
    const order = fixture();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      db.prepare("UPDATE orders SET payos_order_code=payos_order_code+1,payment_link_id='replacement-link' WHERE order_code=?").run(order.order_code);
      return Response.json({ code: '00', data: { id: order.payment_link_id, orderCode: order.payos_order_code, status: 'EXPIRED' } });
    });
    expect(await syncPaymentStatusFromPayOS({ client: {}, orderCode: order.order_code })).toMatchObject({ synced: false });
    expect(getOrderByCode(order.order_code)).toMatchObject({ status: 'PENDING_PAYMENT', payment_link_id: 'replacement-link' });
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const databasePath = vi.hoisted(() => {
  const value = `./data/test-payment-deadline-${process.pid}-${Date.now()}.sqlite`;
  Object.assign(process.env, { ENV_FILE: '.env.payment-deadline-not-present', DATABASE_PATH: value,
    ENCRYPTION_KEY: 'test-payment-deadline-key', PAYOS_CLIENT_ID: 'test-client',
    PAYOS_API_KEY: 'test-api', PAYOS_CHECKSUM_KEY: 'test-checksum', PUBLIC_BASE_URL: 'https://bot.example' });
  return value;
});
import { db, initDatabase } from '../src/database/db.js';
import { createTicket } from '../src/services/ticketService.js';
import { createOrder, getOrderByCode } from '../src/services/orderService.js';
import { createOrLoadPayOSLink, getPayOSPaymentInfo, sendVietQRPayment, syncPaymentStatusFromPayOS } from '../src/services/paymentService.js';

let sequence = 0;
function pendingOrder() {
  const code = `CN_${970000 + ++sequence}`;
  const ticket = createTicket({ guildId: 'deadline-fixture', channelId: `web-${code}`,
    customerId: '123456789012345678', openedById: '123456789012345678', ticketType: 'ORDER' });
  return createOrder({ orderCode: code, guildId: ticket.guild_id, ticketId: ticket.id,
    ticketChannelId: ticket.channel_id, customerId: ticket.customer_id, productName: 'Test package',
    quantity: 1, totalAmount: 190_000, durationMonths: 6, orderLogChannelId: 'test-order-log', createdById: ticket.customer_id });
}
function stall(signal) {
  return new Promise((_, reject) => {
    if (signal?.aborted) reject(signal.reason);
    else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}
function assertUntouched(order) {
  expect(getOrderByCode(order.order_code)).toEqual(order);
  for (const table of ['payment_events', 'order_fulfillments', 'order_delivery_items']) {
    expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count).toBe(0);
  }
}

describe('payment provider request deadlines', () => {
  beforeAll(() => initDatabase());
  beforeEach(() => {
    vi.useFakeTimers();
    db.exec('DELETE FROM order_delivery_items; DELETE FROM order_fulfillments; DELETE FROM payment_events; DELETE FROM orders;');
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  afterAll(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${path.resolve(databasePath)}${suffix}`, { force: true });
  });

  it('bounds stalled PayOS headers without retrying an uncertain link creation', async () => {
    const order = pendingOrder();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => stall(init.signal));
    const result = createOrLoadPayOSLink(order).catch(error => error);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    assertUntouched(order);
  });

  it('bounds stalled PayOS JSON and never confirms or cancels an uncertain payment', async () => {
    const order = pendingOrder();
    const client = { guilds: { fetch: vi.fn() }, users: { fetch: vi.fn() } };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => Promise.resolve({
      ok: true, status: 200, json: () => stall(init.signal),
    }));
    const result = syncPaymentStatusFromPayOS({ client, orderCode: order.order_code }).catch(error => error);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(fetchMock.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(client.guilds.fetch).not.toHaveBeenCalled();
    expect(client.users.fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    assertUntouched(order);
  });

  it('rejects invalid provider JSON instead of accepting an empty success', async () => {
    const order = pendingOrder();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200,
      json: async () => { throw new SyntaxError('Incomplete JSON'); } });
    await expect(getPayOSPaymentInfo(order.payos_order_code)).rejects.toThrow('PayOS trả về dữ liệu không hợp lệ');
    expect(vi.getTimerCount()).toBe(0);
    assertUntouched(order);
  });

  it('keeps successful lookups and duplicate-link recovery compatible', async () => {
    const order = pendingOrder();
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ code: '231', desc: 'Đơn thanh toán đã tồn tại' }))
      .mockResolvedValueOnce(Response.json({ code: '00', data: { id: 'existing-link', orderCode: order.payos_order_code, status: 'PENDING' } }));
    const saved = await createOrLoadPayOSLink(order);
    expect(saved).toMatchObject({ payment_link_id: 'existing-link', payment_checkout_url: 'https://pay.payos.vn/web/existing-link', payment_status: 'UNPAID' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('persists the submitted invoice expiry when create response omits it', async () => {
    const order = pendingOrder();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ code: '00', data: { id: 'new-invoice', checkoutUrl: 'https://pay.payos.vn/web/new-invoice', qrCode: '000201fixture' } }));
    const saved = await createOrLoadPayOSLink(order);
    const submitted = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(saved.payment_expired_at).toBe(new Date(submitted.expiredAt * 1000).toISOString());
    expect(Date.parse(saved.payment_expired_at)).toBeGreaterThan(Date.now());
  });

  it('retains original expiry on duplicate lookup rather than inventing a fresh lifetime', async () => {
    const order = pendingOrder();
    const original = new Date(Date.now() - 3600000).toISOString();
    db.prepare('UPDATE orders SET payment_expired_at=? WHERE order_code=?').run(original, order.order_code);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ code: '231', desc: 'Đơn thanh toán đã tồn tại' }))
      .mockResolvedValueOnce(Response.json({ code: '00', data: { id: 'old-invoice', orderCode: order.payos_order_code, status: 'EXPIRED' } }));
    await expect(createOrLoadPayOSLink(getOrderByCode(order.order_code))).rejects.toMatchObject({ code: 'PAYMENT_RECONCILIATION_REQUIRED' });
    expect(getOrderByCode(order.order_code)).toMatchObject({ payment_expired_at: original, status: 'CANCELLED', payment_checkout_url: null });
  });

  it('bounds a stalled VietQR image before sending a message or saving link data', async () => {
    const order = pendingOrder();
    db.prepare(`INSERT INTO guild_settings (guild_id, ticket_category_id, order_log_channel_id, feedback_channel_id,
      bank_alias, bank_bin, bank_account_no, bank_account_name)
      VALUES (?, 'fixture-category', 'fixture-log', 'fixture-feedback', 'MB', '970422', '1234567890', 'FIXTURE')
      ON CONFLICT(guild_id) DO UPDATE SET bank_bin=excluded.bank_bin,
      bank_account_no=excluded.bank_account_no, bank_account_name=excluded.bank_account_name`).run(order.guild_id);
    const guild = { channels: { fetch: vi.fn() } };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => Promise.resolve({
      ok: true, arrayBuffer: () => stall(init?.signal),
    }));
    const result = sendVietQRPayment({ guild, orderCode: order.order_code }).catch(error => error);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(await result).toMatchObject({ name: 'AbortError' });
    expect(guild.channels.fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    assertUntouched(order);
  });
});

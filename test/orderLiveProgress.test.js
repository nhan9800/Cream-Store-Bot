import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';

const databasePath = vi.hoisted(() => {
  const path = `./data/test-live-progress-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.test-live-progress-absent';
  process.env.DATABASE_PATH = path;
  process.env.BOT_API_KEY = 'live-progress-test-key';
  process.env.ENCRYPTION_KEY = 'live-progress-test-encryption';
  return path;
});
import { db, initDatabase } from '../src/database/db.js';
import { config } from '../src/config.js';
import { createTicket, closeTicket } from '../src/services/ticketService.js';
import { createOrder, getOrderByCode, queueOrderDelivery } from '../src/services/orderService.js';
import { getOrderProgress, updateOrderProgress } from '../src/services/orderProgressService.js';
import { registerAdminRoutes } from '../src/services/adminApiRoutes.js';
import { deliverPaidOrder } from '../src/services/autoDeliveryService.js';
import { execute as deliverManually } from '../src/commands/giaohang.js';
import { encrypt } from '../src/utils/crypto.js';
import { buildCustomerOrderView } from '../src/services/orderCustomerView.js';

const guild = 'progress-test-guild';
const customer = '123456789012345678';
let sequence = 0; let server; let base; let oldGuild;
function fixture(paid = true) {
  const code = `CN_${960000 + ++sequence}`;
  const ticket = createTicket({ guildId: guild, channelId: `channel-${code}`, customerId: customer,
    openedById: customer, ticketType: 'ORDER', relatedOrderCode: code });
  createOrder({ orderCode: code, guildId: guild, ticketId: ticket.id, ticketChannelId: ticket.channel_id,
    customerId: customer, productName: 'Manual Pack', quantity: 1, totalAmount: 100_000,
    durationMonths: 1, orderLogChannelId: 'test-log', createdById: customer });
  if (paid) db.prepare("UPDATE orders SET status='PROCESSING',payment_status='PAID',amount_paid=100000,paid_at=created_at WHERE order_code=?").run(code);
  return getOrderByCode(code);
}
const change = (order, extra = {}) => ({ orderCode: order.order_code, guildId: guild, actorId: 'admin-progress',
  stage: 'PREPARING', note: 'Đang kiểm tra gói của bạn.', requestId: `request_${order.order_code}`, expectedVersion: 0, ...extra });

beforeAll(async () => {
  initDatabase(); oldGuild = config.guildId; config.guildId = guild;
  db.prepare("INSERT INTO web_users(id,email,role) VALUES ('admin-progress','progress-admin@example.test','admin'),('member-progress','progress-member@example.test','member')").run();
  const app = express(); app.use(express.json()); registerAdminRoutes(app);
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  await new Promise(resolve => server.close(resolve)); config.guildId = oldGuild; db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(databasePath + suffix, { force: true });
});

describe('live order progress', () => {
  it('stores history once and preserves money, delivery and status', () => {
    const order = fixture(); const before = getOrderByCode(order.order_code);
    const saved = updateOrderProgress(change(order));
    expect(saved.progress).toMatchObject({ stage: 'PREPARING', writable: true });
    expect(updateOrderProgress(change(order)).duplicate).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM order_progress_events WHERE order_code=?').get(order.order_code).n).toBe(1);
    expect(getOrderByCode(order.order_code)).toEqual(before);
    expect(JSON.stringify(saved.progress)).not.toContain('admin-progress');
    expect(buildCustomerOrderView(order, { progress: saved.progress })).not.toHaveProperty('order_progress');
  });
  it('rejects conflicting editors, reused request payloads and another shop', () => {
    const order = fixture(); updateOrderProgress(change(order));
    expect(() => updateOrderProgress(change(order, { requestId: 'another_request_123' }))).toThrow('người khác');
    expect(() => updateOrderProgress(change(order, { note: 'Changed payload' }))).toThrow('nội dung khác');
    expect(() => updateOrderProgress(change(order, { guildId: 'other-shop' }))).toThrow('shop hiện tại');
  });
  it('keeps unpaid, closed, missing-ticket, completed and refunded orders read-only', () => {
    const unpaid = fixture(false);
    expect(() => updateOrderProgress(change(unpaid))).toThrow('Chỉ cập nhật');
    const closed = fixture(); closeTicket(closed.ticket_id, 'admin-progress');
    expect(() => updateOrderProgress(change(closed))).toThrow('Chỉ cập nhật');
    const missing = fixture(); db.prepare("UPDATE tickets SET customer_id='another-customer' WHERE id=?").run(missing.ticket_id);
    expect(() => updateOrderProgress(change(missing))).toThrow('Chỉ cập nhật');
    for (const status of ['COMPLETED', 'REFUNDED']) {
      const order = fixture(); db.prepare('UPDATE orders SET status=? WHERE order_code=?').run(status, order.order_code);
      expect(() => updateOrderProgress(change(order))).toThrow('Chỉ cập nhật');
      expect(getOrderProgress(getOrderByCode(order.order_code)).stage).toBe(status);
    }
  });
  it('enforces current account permissions and ignores forged identity fields', async () => {
    const order = fixture(); const url = `${base}/api/bot/admin/orders/${order.order_code}/progress`;
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url, { headers: { 'x-bot-api-key': 'live-progress-test-key', 'x-user-id': 'member-progress', 'x-user-role': 'admin' } })).status).toBe(403);
    const headers = { 'x-bot-api-key': 'live-progress-test-key', 'x-user-id': 'admin-progress', 'Content-Type': 'application/json' };
    const response = await fetch(url, { method: 'PUT', headers, body: JSON.stringify({ ...change(order), actorId: 'attacker', guildId: 'other', orderCode: 'CN_000000' }) });
    expect(response.status).toBe(200);
    expect(db.prepare('SELECT actor_id FROM order_progress_events WHERE order_code=?').get(order.order_code).actor_id).toBe('admin-progress');
    const read = await fetch(url, { headers }); expect((await read.json()).data.progress.stage).toBe('PREPARING');
    config.guildId = 'other'; expect((await fetch(url, { headers })).status).toBe(404); config.guildId = guild;
  });
  it('manual orders do not consume stock even when stock is available', async () => {
    const order = fixture();
    db.prepare("UPDATE orders SET fulfillment_mode='MANUAL' WHERE order_code=?").run(order.order_code);
    db.prepare("INSERT INTO account_stock(service_type,credentials) VALUES ('manual pack',?)").run(encrypt('fake@example.test|fake-password'));
    queueOrderDelivery(order.order_code);
    const client = { users: { fetch: vi.fn() } };
    expect(await deliverPaidOrder(client, order.order_code)).toEqual({ delivered: false });
    expect(client.users.fetch).not.toHaveBeenCalled();
    expect(db.prepare('SELECT status FROM account_stock ORDER BY id DESC LIMIT 1').get().status).toBe('AVAILABLE');
    expect(getOrderByCode(order.order_code).status).toBe('PROCESSING');
  });
  it('manual Discord delivery never completes when customer lookup or DM fails', async () => {
    for (const stage of ['lookup', 'dm', 'send']) {
      const order = fixture();
      const dm = { id: 'test-dm', send: vi.fn().mockResolvedValue(null) };
      const user = { createDM: vi.fn().mockResolvedValue(stage === 'dm' ? null : dm) };
      const interaction = { guildId: guild, channelId: order.ticket_channel_id,
        user: { id: 'admin-progress' }, deferReply: vi.fn(), editReply: vi.fn(),
        guild: { members: { fetch: vi.fn().mockResolvedValue({ permissions: { has: () => true } }) } },
        client: { users: { fetch: vi.fn().mockResolvedValue(stage === 'lookup' ? null : user) } },
        options: { getString: name => ({ ma_don: order.order_code, gmail: 'fake@example.test', mat_khau: 'fake-password' })[name] || null,
          getBoolean: () => true } };
      await deliverManually(interaction);
      expect(getOrderByCode(order.order_code).status).toBe('PROCESSING');
      expect(getOrderByCode(order.order_code).completed_at).toBeNull();
    }
  });
});

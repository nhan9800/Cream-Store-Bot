import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const databasePath = vi.hoisted(() => {
  const value = `./data/test-customer-role-sync-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.customer-role-sync-not-present';
  process.env.DATABASE_PATH = value;
  process.env.GUILD_ID = '987654321098765432';
  process.env.BOT_API_KEY = 'test-customer-role-api-key';
  process.env.ENCRYPTION_KEY = 'test-customer-role-encryption';
  process.env.WEB_CHECKOUT_ENABLED = 'true';
  return value;
});

import { db, initDatabase, nowIso } from '../src/database/db.js';
import { createOrder, markOrderPaid, payOrderWithWallet, cancelOrder, recordOrderPayment } from '../src/services/orderService.js';
import { createTicket } from '../src/services/ticketService.js';
import { upsertGuildConfig } from '../src/services/guildConfigService.js';
import { applyCustomerRoles, resolveCustomerRoleTiers } from '../src/services/roleService.js';
import { backfillCustomerRoleSync, getCustomerRoleSyncState, processPendingCustomerRoles, queueCustomerRoleSync, syncCustomerRolesNow } from '../src/services/customerRoleSyncService.js';
import { getCustomerPurchaseSummary } from '../src/services/customerActivityService.js';
import { addWalletBalance, getWalletBalance } from '../src/services/walletService.js';
import { finalizePaidOrder } from '../src/services/paymentService.js';
import { registerBotApiRoutes } from '../src/services/botApiRoutes.js';

const guildId = process.env.GUILD_ID;
const customerId = '123456789012345678';
const patronId = '222222222222222222';
const vipId = '333333333333333333';
let sequence = 0;

function pendingOrder(amount = 75_000, customer = customerId) {
  const code = `CN_${930000 + ++sequence}`;
  const ticket = createTicket({ guildId, channelId: `web-${code}`, customerId: customer,
    openedById: customer, ticketType: 'ORDER', supportSource: 'WEBSITE_ORDER' });
  return createOrder({ orderCode: code, guildId, ticketId: ticket.id, ticketChannelId: ticket.channel_id,
    customerId: customer, productName: 'Netflix Web', quantity: 1, totalAmount: amount,
    durationMonths: 1, orderLogChannelId: 'unavailable-log', createdById: customer });
}

function paidOrder(amount = 75_000, customer = customerId) {
  const order = pendingOrder(amount, customer);
  return markOrderPaid(order.order_code, { amountPaid: amount, transactionId: `TX_${sequence}` });
}

function mockDiscord() {
  const roleCache = new Map([[patronId, { id: patronId, name: 'Customer' }], [vipId, { id: vipId, name: 'VIP' }]]);
  const member = { user: { username: 'test buyer' }, roles: { cache: new Map() }, send: vi.fn().mockResolvedValue({ id: 'dm' }) };
  member.roles.add = vi.fn(async (id) => { member.roles.cache.set(id, roleCache.get(id)); return member; });
  member.roles.remove = vi.fn(async (id) => { member.roles.cache.delete(id); return member; });
  const client = { guilds: { cache: new Map(), fetch: vi.fn() }, users: { fetch: vi.fn().mockRejectedValue(new Error('DM unavailable')) } };
  const guild = { id: guildId, name: 'Test Store', client,
    roles: { cache: roleCache, everyone: { id: guildId } },
    members: { fetch: vi.fn().mockResolvedValue(member) },
    channels: { fetch: vi.fn().mockResolvedValue(null), create: vi.fn().mockRejectedValue(new Error('channel unavailable')) } };
  client.guilds.cache.set(guildId, guild);
  client.guilds.fetch.mockResolvedValue(guild);
  return { client, guild, member };
}

const job = () => db.prepare('SELECT * FROM customer_role_sync_jobs WHERE guild_id = ? AND customer_id = ?').get(guildId, customerId);

describe('paid website purchaser role synchronization', () => {
  beforeAll(() => initDatabase());
  beforeEach(() => {
    db.exec(`DELETE FROM order_delivery_items; DELETE FROM order_fulfillments; DELETE FROM checkout_requests;
      DELETE FROM payment_events; DELETE FROM staff_logs; DELETE FROM wallet_transactions; DELETE FROM orders;
      DELETE FROM customer_role_sync_jobs; DELETE FROM customer_profiles; DELETE FROM product_catalog;
      DELETE FROM viotp_orders; DELETE FROM card_charging_orders; DELETE FROM card_buy_orders; DELETE FROM guild_settings;`);
    upsertGuildConfig({ guild_id: guildId, customer_role_id: patronId, vip_role_id: vipId,
      ticket_category_id: '444444444444444444', order_log_channel_id: '555555555555555555', feedback_channel_id: '666666666666666666' });
  });
  afterAll(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${path.resolve(databasePath)}${suffix}`, { force: true });
  });

  it('grants the configured guild customer role immediately after paid checkout, before delivery', async () => {
    paidOrder();
    const { client, guild, member } = mockDiscord();
    expect(job().status).toBe('PENDING');
    expect(await syncCustomerRolesNow(client, guildId, customerId)).toMatchObject({ synced: true, applied: [patronId] });
    expect(guild.members.fetch).toHaveBeenCalledWith({ user: customerId, force: true });
    expect(member.roles.cache.has(patronId)).toBe(true);
    expect(member.roles.add).not.toHaveBeenCalledWith('1282637103045279820', expect.anything());
    expect(job().status).toBe('SYNCED');
    await syncCustomerRolesNow(client, guildId, customerId);
    expect(member.roles.add).toHaveBeenCalledOnce();
    expect(member.send).toHaveBeenCalledOnce();
  });

  it('does not award customer/VIP roles for unpaid, partially paid, cancelled or refunded orders', async () => {
    pendingOrder(8_000_000);
    const cancelled = paidOrder();
    cancelOrder(cancelled.order_code, 'cancelled');
    const refunded = paidOrder();
    db.prepare("UPDATE orders SET status = 'REFUNDED' WHERE order_code = ?").run(refunded.order_code);
    const partial = pendingOrder(3_000_000);
    db.prepare("UPDATE orders SET payment_status = 'PAID', amount_paid = 1 WHERE order_code = ?").run(partial.order_code);
    const { guild, member } = mockDiscord();
    expect(await applyCustomerRoles(guild, customerId)).toMatchObject({ synced: true, applied: [], spent: 0 });
    expect(member.roles.add).not.toHaveBeenCalled();
    expect(getCustomerPurchaseSummary(guildId, customerId).paidOrders).toBe(0);
  });

  it('keeps role failures pending and does not announce success until Discord grants the role', async () => {
    paidOrder();
    const { client, member } = mockDiscord();
    member.roles.add.mockRejectedValueOnce(Object.assign(new Error('Missing permissions'), { code: 50013 }));
    expect(await syncCustomerRolesNow(client, guildId, customerId)).toMatchObject({ synced: false, applied: [] });
    expect(job()).toMatchObject({ status: 'PENDING', last_error: '50013', attempts: 1 });
    expect(getCustomerRoleSyncState().queue).toMatchObject({ pending: 1, failed: 1, errors: [{ code: '50013', count: 1 }] });
    expect(JSON.stringify(getCustomerRoleSyncState())).not.toContain(customerId);
    expect(member.send).not.toHaveBeenCalled();
    expect(await processPendingCustomerRoles(client)).toMatchObject({ scanned: 0 });
    db.prepare('UPDATE customer_role_sync_jobs SET retry_at = ?').run(nowIso());
    expect(await processPendingCustomerRoles(client)).toMatchObject({ scanned: 1, synced: 1, pending: 0 });
    expect(member.send).toHaveBeenCalledOnce();
  });

  it('uses Store 1 canonical fallback but never applies Store 1 IDs to another guild', () => {
    const { guild } = mockDiscord();
    const canonicalId = '1282637103045279820';
    guild.id = '1282637033340403754';
    expect(resolveCustomerRoleTiers(guild).find((tier) => tier.requireActivity)?.id).toBe(canonicalId);
    guild.id = '1070676180103086132';
    expect(resolveCustomerRoleTiers(guild)).toEqual([]);
    expect(resolveCustomerRoleTiers(guild, { customer_role_id: patronId }).at(-1).id).toBe(patronId);
  });

  it('keeps guild jobs isolated and reports an absent purchaser role configuration for retry', async () => {
    paidOrder();
    const { client, member } = mockDiscord();
    db.prepare('UPDATE guild_settings SET customer_role_id = NULL WHERE guild_id = ?').run(guildId);
    expect(await processPendingCustomerRoles(client)).toMatchObject({ pending: 1, synced: 0 });
    expect(job().last_error).toBe('CUSTOMER_ROLE_NOT_CONFIGURED');
    expect(member.roles.add).not.toHaveBeenCalled();
    queueCustomerRoleSync('1070676180103086132', customerId);
    expect(await processPendingCustomerRoles(client)).toMatchObject({ scanned: 0 });
    expect(db.prepare('SELECT status FROM customer_role_sync_jobs WHERE guild_id = ?').get('1070676180103086132').status).toBe('PENDING');
  });

  it('restores missing roles when a paid customer joins the server later', async () => {
    paidOrder();
    const { client, guild, member } = mockDiscord();
    guild.members.fetch.mockRejectedValueOnce(Object.assign(new Error('Unknown member'), { code: 10007 }));
    expect(await syncCustomerRolesNow(client, guildId, customerId)).toMatchObject({ synced: false, error: 'MEMBER_NOT_FOUND' });
    expect(job().status).toBe('PENDING');
    queueCustomerRoleSync(guildId, customerId);
    expect(await syncCustomerRolesNow(client, guildId, customerId)).toMatchObject({ synced: true });
    expect(member.roles.cache.has(patronId)).toBe(true);
  });

  it('backfills old web purchases and preserves pending retries across startup', async () => {
    paidOrder();
    db.exec('DELETE FROM customer_role_sync_jobs');
    expect(backfillCustomerRoleSync()).toMatchObject({ scanned: 1, queued: 1 });
    const revision = job().revision;
    backfillCustomerRoleSync();
    expect(job().revision).toBe(revision);
    expect(await processPendingCustomerRoles(mockDiscord().client)).toMatchObject({ synced: 1 });
  });

  it('commits wallet debit and the durable role job atomically and rolls both back on failure', () => {
    const order = pendingOrder();
    addWalletBalance(guildId, customerId, order.total_amount, 'TOPUP', 'test', 'wallet-role-topup');
    db.exec(`CREATE TRIGGER fail_test_role_job BEFORE INSERT ON customer_role_sync_jobs
      BEGIN SELECT RAISE(ABORT, 'queue failure'); END;`);
    try {
      expect(() => payOrderWithWallet({ orderCode: order.order_code, guildId, customerId, amount: order.total_amount })).toThrow('queue failure');
      expect(getWalletBalance(guildId, customerId)).toBe(order.total_amount);
      expect(job()).toBeUndefined();
      expect(db.prepare('SELECT payment_status FROM orders WHERE order_code = ?').get(order.order_code).payment_status).toBe('UNPAID');
    } finally { db.exec('DROP TRIGGER fail_test_role_job'); }
    payOrderWithWallet({ orderCode: order.order_code, guildId, customerId, amount: order.total_amount });
    expect(job().status).toBe('PENDING');
    expect(getWalletBalance(guildId, customerId)).toBe(0);
  });

  it('repairs a replayed payment role even when the confirmation staff log already exists', async () => {
    const order = paidOrder();
    recordOrderPayment({ orderCode: order.order_code, provider: 'PAYOS', transactionId: 'replay-role', amount: order.total_amount });
    db.prepare(`INSERT INTO staff_logs (guild_id, action, related_order_code, created_at)
      VALUES (?, 'PAYMENT_CONFIRMED_PENDING_DELIVERY', ?, ?)`).run(guildId, order.order_code, nowIso());
    const { client, member } = mockDiscord();
    const result = await finalizePaidOrder(client, order, { amount: order.total_amount }, 'replay-role', order.order_code);
    expect(result.duplicate).toBe(true);
    expect(member.roles.cache.has(patronId)).toBe(true);
    expect(job().status).toBe('SYNCED');
  });

  it('keeps a newer purchase pending when it arrives during an in-flight role request', async () => {
    paidOrder();
    const { client, member } = mockDiscord();
    member.roles.add.mockImplementationOnce(async (id) => {
      paidOrder(1_000_000);
      member.roles.cache.set(id, { id });
      return member;
    });
    expect(await syncCustomerRolesNow(client, guildId, customerId)).toMatchObject({ synced: false, pending: true });
    expect(job().status).toBe('PENDING');
    await syncCustomerRolesNow(client, guildId, customerId);
    expect(member.roles.cache.has(vipId)).toBe(true);
    expect(job().status).toBe('SYNCED');
  });

  it('removes earned roles after the only paid purchase is refunded', async () => {
    const order = paidOrder(1_000_000);
    const { client, member } = mockDiscord();
    await syncCustomerRolesNow(client, guildId, customerId);
    db.prepare("UPDATE orders SET status = 'REFUNDED' WHERE order_code = ?").run(order.order_code);
    await syncCustomerRolesNow(client, guildId, customerId);
    expect(member.roles.cache.size).toBe(0);
    expect(member.roles.remove).toHaveBeenCalledTimes(2);
  });

  it('grants the role on the actual wallet API despite failed Discord ticket creation and retries without charging twice', async () => {
    const product = db.prepare(`INSERT INTO product_catalog (guild_id, name, price, duration_months, is_active)
      VALUES (?, 'Netflix Web', 75000, 1, 1)`).run(guildId);
    addWalletBalance(guildId, customerId, 75_000, 'TOPUP', 'test', 'wallet-api-topup');
    const { client, member } = mockDiscord();
    const app = express();
    app.locals.discordClient = client;
    app.use(express.json());
    registerBotApiRoutes(app);
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const request = () => fetch(`http://127.0.0.1:${server.address().port}/api/bot/web-orders`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bot-api-key': process.env.BOT_API_KEY,
        'x-discord-id': customerId, 'x-user-id': 'web-test', 'x-idempotency-key': 'checkout_role_1234567890' },
      body: JSON.stringify({ items: [{ id: String(product.lastInsertRowid), quantity: 1 }], paymentProvider: 'WALLET' }),
    }).then((response) => response.json());
    try {
      expect((await request()).ok).toBe(true);
      await vi.waitFor(() => expect(member.roles.cache.has(patronId)).toBe(true));
      expect((await request()).data.reused).toBe(true);
      expect(member.roles.add).toHaveBeenCalledOnce();
      expect(getWalletBalance(guildId, customerId)).toBe(0);
      expect(db.prepare("SELECT COUNT(*) AS count FROM wallet_transactions WHERE type = 'PAYMENT'").get().count).toBe(1);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});

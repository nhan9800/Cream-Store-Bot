import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const databasePath = vi.hoisted(() => {
  const value = `./data/test-manual-delivery-race-${process.pid}-${Date.now()}.sqlite`;
  Object.assign(process.env, { ENV_FILE: '.env.manual-delivery-race-not-present', DATABASE_PATH: value,
    ENCRYPTION_KEY: 'synthetic-delivery-race-key', GUILD_ID: '987654321098765432' });
  return value;
});
vi.mock('../src/utils/permissions.js', () => ({ assertStaffCapability: () => true }));
vi.mock('../src/services/guildConfigService.js', () => ({ getGuildConfig: () => ({}) }));
vi.mock('../src/services/notificationService.js', () => ({ sendCompletedTicketFlow: vi.fn(async () => {}), updateOrderLogMessage: vi.fn(async () => {}) }));
vi.mock('../src/services/roleService.js', () => ({ applyCustomerRoles: vi.fn(async () => {}) }));
vi.mock('../src/services/staffLogService.js', () => ({ emitStaffLog: vi.fn(async () => {}) }));
vi.mock('../src/services/cenarHub.js', () => ({ getCenarHub: vi.fn(() => null) }));
vi.mock('../src/services/adminOrderCenterService.js', () => ({ markAdminOrderReminderLifecycleChanged: vi.fn(), scheduleAdminOrderCenterRefresh: vi.fn() }));
vi.mock('../src/services/deliverySubscriptionService.js', () => ({
  detectDeliverySubscriptionService: vi.fn(() => 'netflix'), syncDeliverySubscription: vi.fn(() => ({ id: 1 })),
}));

import { db, initDatabase } from '../src/database/db.js';
import { encrypt } from '../src/utils/crypto.js';
import { createTicket } from '../src/services/ticketService.js';
import { createOrder, getOrderByCode, markOrderCompleted, markOrderPaid } from '../src/services/orderService.js';
import { detectDeliverySubscriptionService, syncDeliverySubscription } from '../src/services/deliverySubscriptionService.js';
import { updateOrderLogMessage } from '../src/services/notificationService.js';
import { getCenarHub } from '../src/services/cenarHub.js';
import { execute } from '../src/commands/giaohang.js';

let serial = 0;
function fixture(hooks = {}) {
  const guildId = process.env.GUILD_ID, customerId = '123456789012345678', staffId = '234567890123456789';
  const code = `CN_${970000 + ++serial}`;
  const ticket = createTicket({ guildId, customerId, openedById: customerId, channelId: `test-${code}`, ticketType: 'ORDER' });
  const original = createOrder({ orderCode: code, guildId, ticketId: ticket.id, ticketChannelId: ticket.channel_id,
    customerId, productName: 'Netflix Premium', quantity: 1, totalAmount: 100000, durationMonths: 3,
    orderLogChannelId: 'test-order-log', createdById: staffId });
  markOrderPaid(code, { amountPaid: original.total_amount, transactionId: `receipt-${code}` });
  const receipt = { id: String(345678901234567890n + BigInt(serial)), edit: vi.fn(async () => {}) };
  const send = vi.fn(async () => { hooks.onSend?.(code); return receipt; });
  const channel = { id: '456789012345678901', send };
  const customer = { id: customerId, username: 'Synthetic customer',
    createDM: vi.fn(async () => { hooks.onCreateDm?.(code); return channel; }) };
  const client = { users: { fetch: vi.fn(async () => { hooks.onFetch?.(code); return customer; }) } };
  const fields = { ma_don: code, gmail: 'synthetic@example.test', mat_khau: 'synthetic-password' };
  const interaction = { guildId, channelId: ticket.channel_id, client, user: { id: staffId },
    guild: { id: guildId, client, members: { fetch: vi.fn(async () => ({})) }, channels: { fetch: vi.fn(async () => null) } },
    options: { getString: name => fields[name] ?? null, getBoolean: () => true },
    deferReply: vi.fn(async () => {}), editReply: vi.fn(async () => {}) };
  return { code, send, receipt, interaction };
}
beforeAll(() => initDatabase());
beforeEach(() => vi.clearAllMocks());
afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${path.resolve(databasePath)}${suffix}`, { force: true });
});

describe('manual delivery fences around Discord I/O', () => {
  it('does not send credentials or resurrect an order cancelled during DM setup', async () => {
    const f = fixture({ onCreateDm: code => db.prepare("UPDATE orders SET status = 'CANCELLED' WHERE order_code = ?").run(code) });
    await execute(f.interaction);
    expect(f.send).not.toHaveBeenCalled();
    expect(getOrderByCode(f.code)).toMatchObject({ status: 'CANCELLED', completed_at: null, delivered_at: null });
    expect(syncDeliverySubscription).not.toHaveBeenCalled();
  });
  it('preserves a refund made while Discord accepts the DM and does not activate a subscription', async () => {
    const f = fixture({ onSend: code => db.prepare("UPDATE orders SET status='REFUNDED',payment_status='REFUNDED',updated_at=? WHERE order_code=?")
      .run('2026-11-15T23:00:00.000Z', code) });
    await execute(f.interaction);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(getOrderByCode(f.code)).toMatchObject({ status: 'REFUNDED', payment_status: 'REFUNDED',
      completed_at: null, delivery_dm_message_id: null, delivered_at: null, credential_email: null });
    expect(db.prepare('SELECT outcome FROM manual_delivery_receipts WHERE order_code=?').get(f.code)).toEqual({ outcome: 'REVIEW' });
    expect(syncDeliverySubscription).not.toHaveBeenCalled();
    expect(f.interaction.editReply.mock.calls.at(-1)[0].content).toContain('đã gửi');
  });
  it('does not record an attempted but rejected DM as delivered', async () => {
    const f = fixture();
    f.send.mockRejectedValueOnce(Object.assign(new Error('Discord rejected DM'), { code: 50007, status: 403 }));
    await execute(f.interaction);
    expect(getOrderByCode(f.code)).toMatchObject({ status: 'PROCESSING', completed_at: null, delivered_at: null,
      delivery_dm_message_id: null, credential_email: null });
    expect(syncDeliverySubscription).not.toHaveBeenCalled();
  });
  it('does not send to the old customer when ownership changes during setup', async () => {
    const f = fixture({ onFetch: code => db.prepare('UPDATE orders SET customer_id=? WHERE order_code=?')
      .run('567890123456789012', code) });
    await execute(f.interaction);
    expect(f.send).not.toHaveBeenCalled();
    expect(getOrderByCode(f.code)).toMatchObject({ customer_id: '567890123456789012', completed_at: null, delivered_at: null });
  });
  it('does not deliver credentials chosen for an old product or term after an edit during setup', async () => {
    const f = fixture({ onCreateDm: code => db.prepare('UPDATE orders SET product_name=?,duration_months=? WHERE order_code=?')
      .run('YouTube Premium', 12, code) });
    await execute(f.interaction);
    expect(f.send).not.toHaveBeenCalled();
    expect(getOrderByCode(f.code)).toMatchObject({ product_name: 'YouTube Premium', duration_months: 12, completed_at: null, delivered_at: null });
    expect(syncDeliverySubscription).not.toHaveBeenCalled();
  });
  it('holds completion if another editor changes the order version while Discord sends', async () => {
    const f = fixture({ onSend: code => db.prepare('UPDATE orders SET note=?,updated_at=? WHERE order_code=?')
      .run('synthetic competing editor', '2026-11-15T23:01:00.000Z', code) });
    await execute(f.interaction);
    expect(getOrderByCode(f.code)).toMatchObject({ status: 'PROCESSING', completed_at: null, delivery_dm_message_id: null });
    expect(db.prepare('SELECT outcome FROM manual_delivery_receipts WHERE order_code=?').get(f.code)).toEqual({ outcome: 'REVIEW' });
    expect(syncDeliverySubscription).not.toHaveBeenCalled();
  });
  it.each(['refund', 'product', 'owner'])('preserves current delivery credentials on a competing %s change and journals the positive receipt', async change => {
    const f = fixture({ onSend: code => {
      if (change === 'refund') db.prepare("UPDATE orders SET status='REFUNDED',payment_status='REFUNDED' WHERE order_code=?").run(code);
      if (change === 'product') db.prepare('UPDATE orders SET product_name=?,duration_months=? WHERE order_code=?').run('YouTube Premium', 12, code);
      if (change === 'owner') db.prepare('UPDATE orders SET customer_id=? WHERE order_code=?').run('567890123456789012', code);
    } });
    const oldEmail = encrypt('previous@example.test'), oldPassword = encrypt('previous-password');
    db.prepare('UPDATE orders SET credential_email=?,credential_password=?,delivered_at=?,delivery_dm_message_id=? WHERE order_code=?')
      .run(oldEmail, oldPassword, '2026-10-01T00:00:00.000Z', '678901234567890123', f.code);
    await execute(f.interaction);
    expect(getOrderByCode(f.code)).toMatchObject({ credential_email: oldEmail, credential_password: oldPassword,
      delivered_at: '2026-10-01T00:00:00.000Z', delivery_dm_message_id: '678901234567890123', completed_at: null });
    const journal = db.prepare('SELECT * FROM manual_delivery_receipts WHERE order_code=?').get(f.code);
    expect(journal).toMatchObject({ dm_message_id: f.receipt.id, customer_id: '123456789012345678', outcome: 'REVIEW' });
    expect(JSON.parse(journal.contract_snapshot)).toMatchObject({ product_name: 'Netflix Premium', duration_months: 3 });
    expect(journal.contract_snapshot).not.toMatch(/synthetic-password|previous-password|credential_email|credential_password/);
    expect(syncDeliverySubscription).not.toHaveBeenCalled();
  });
  it('does not activate a subscription if a refund occurs during completion notification I/O', async () => {
    const f = fixture();
    updateOrderLogMessage.mockImplementationOnce(async () => {
      db.prepare("UPDATE orders SET status='REFUNDED',payment_status='REFUNDED' WHERE order_code=?").run(f.code);
    });
    await execute(f.interaction);
    expect(getOrderByCode(f.code)).toMatchObject({ status: 'REFUNDED', payment_status: 'REFUNDED' });
    expect(syncDeliverySubscription).not.toHaveBeenCalled();
  });
  it.each([true, false])('never edits the original customer DM with a new owner credential after notification I/O (tracked=%s)', async tracked => {
    const f = fixture();
    detectDeliverySubscriptionService.mockReturnValueOnce(tracked ? 'netflix' : null);
    updateOrderLogMessage.mockImplementationOnce(async () => {
      db.prepare('UPDATE orders SET customer_id=?,credential_email=?,credential_password=? WHERE order_code=?')
        .run('567890123456789012', encrypt('new-owner@example.test'), encrypt('new-owner-secret-password'), f.code);
    });
    await execute(f.interaction);
    expect(f.receipt.edit).not.toHaveBeenCalled();
    expect(JSON.stringify(f.send.mock.calls)).not.toContain('new-owner-secret-password');
    expect(syncDeliverySubscription).not.toHaveBeenCalled();
    expect(getCenarHub).not.toHaveBeenCalled();
    expect(db.prepare('SELECT dm_message_id FROM manual_delivery_receipts WHERE order_code=?').get(f.code))
      .toEqual({ dm_message_id: f.receipt.id });
  });
  it.each(['CANCELLED', 'REFUNDED', 'FAILED'])('centrally rejects completion of terminal %s orders', status => {
    const f = fixture();
    db.prepare('UPDATE orders SET status=? WHERE order_code=?').run(status, f.code);
    expect(() => markOrderCompleted(f.code, 'synthetic-staff')).toThrow(expect.objectContaining({ code: 'ORDER_NOT_COMPLETABLE' }));
    expect(getOrderByCode(f.code)).toMatchObject({ status, completed_at: null });
  });
  it('keeps the explicit admin unpaid-completion override available', () => {
    const f = fixture();
    db.prepare("UPDATE orders SET status='PENDING_PAYMENT',payment_status='UNPAID',amount_paid=0 WHERE order_code=?").run(f.code);
    expect(markOrderCompleted(f.code, 'synthetic-admin')).toMatchObject({ status: 'COMPLETED', payment_status: 'UNPAID' });
  });
  it('rejects a stale completion snapshot without overwriting the updated price', () => {
    const f = fixture();
    const expected = getOrderByCode(f.code);
    db.prepare('UPDATE orders SET total_amount=?,updated_at=? WHERE order_code=?')
      .run(120000, '2026-11-15T23:02:00.000Z', f.code);
    expect(() => markOrderCompleted(f.code, 'synthetic-staff', 24, expected))
      .toThrow(expect.objectContaining({ code: 'ORDER_COMPLETION_CONFLICT' }));
    expect(getOrderByCode(f.code)).toMatchObject({ status: 'PROCESSING', total_amount: 120000, completed_at: null });
  });
  it('still completes a paid delivery, saves its receipt and activates the subscription', async () => {
    const f = fixture();
    await execute(f.interaction);
    expect(getOrderByCode(f.code)).toMatchObject({ status: 'COMPLETED', payment_status: 'PAID', delivery_dm_message_id: f.receipt.id });
    expect(syncDeliverySubscription).toHaveBeenCalledTimes(1);
  });
});

describe('delivery subscription backfill eligibility', () => {
  it.each([
    ['CANCELLED', 'PAID'], ['REFUNDED', 'PAID'], ['FAILED', 'PAID'],
    ['COMPLETED', 'REFUNDED'], ['PROCESSING', 'UNPAID'],
  ])('does not activate a subscription from %s / %s delivery evidence', async (status, paymentStatus) => {
    const f = fixture();
    db.prepare(`UPDATE orders SET status=?,payment_status=?,delivered_at=?,credential_email=?,credential_password=? WHERE order_code=?`)
      .run(status, paymentStatus, new Date().toISOString(), 'synthetic@example.test', 'synthetic-password', f.code);
    const { backfillRecentDeliverySubscriptions } = await vi.importActual('../src/services/deliverySubscriptionService.js');
    backfillRecentDeliverySubscriptions({ lookbackDays: 14 });
    expect(db.prepare('SELECT id FROM subscription_accounts WHERE related_order_code=?').get(f.code)).toBeUndefined();
  });
  it('keeps a paid delivered order eligible for subscription recovery', async () => {
    const f = fixture();
    db.prepare(`UPDATE orders SET status='COMPLETED',delivered_at=?,credential_email=?,credential_password=? WHERE order_code=?`)
      .run(new Date().toISOString(), 'synthetic@example.test', 'synthetic-password', f.code);
    const { backfillRecentDeliverySubscriptions } = await vi.importActual('../src/services/deliverySubscriptionService.js');
    backfillRecentDeliverySubscriptions({ lookbackDays: 14 });
    expect(db.prepare('SELECT status FROM subscription_accounts WHERE related_order_code=?').get(f.code)).toEqual({ status: 'ACTIVE' });
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

let tempRoot;
let db;
let deliverySubscriptions;
let subscriptions;
const previousEnv = {
  ENV_FILE: process.env.ENV_FILE,
  DATABASE_PATH: process.env.DATABASE_PATH,
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
};

const CREATED_AT = '2026-08-01T02:00:00.000Z';
const PAID_AT = '2026-08-07T07:15:00.000Z';
const DELIVERED_AT = '2026-08-07T07:29:00.000Z';
const CORRECT_EXPIRY = '2026-09-07T07:29:00.000Z';

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-netflix-date-'));
  process.env.ENV_FILE = path.join(tempRoot, '.env.test');
  process.env.DATABASE_PATH = path.join(tempRoot, 'netflix-date.sqlite');
  process.env.ENCRYPTION_KEY = 'netflix-delivery-date-test-key';

  const database = await import('../src/database/db.js');
  db = database.db;
  database.initDatabase();
  deliverySubscriptions = await import('../src/services/deliverySubscriptionService.js');
  subscriptions = await import('../src/services/subscriptionService.js');

  const ticket = db.prepare(`
    INSERT INTO tickets (ticket_code, guild_id, channel_id, customer_id, opened_by_id, created_at)
    VALUES ('T_NETFLIX_DATE', 'TEST_GUILD', 'NETFLIX_CHANNEL', 'CUSTOMER', 'CUSTOMER', ?)
  `).run(CREATED_AT);
  db.prepare(`
    INSERT INTO orders (
      order_code, guild_id, ticket_id, ticket_channel_id, customer_id,
      product_name, quantity, total_amount, amount_paid, payment_status, status,
      order_log_channel_id, created_by_id, duration_months,
      paid_at, completed_at, delivered_at, created_at, updated_at
    ) VALUES (
      'CN_NETFLIX_DATE', 'TEST_GUILD', ?, 'NETFLIX_CHANNEL', 'CUSTOMER',
      'Netflix Premium 1 Tháng', 1, 45000, 45000, 'PAID', 'COMPLETED',
      'ORDER_LOG', 'ADMIN', 1,
      ?, ?, ?, ?, ?
    )
  `).run(Number(ticket.lastInsertRowid), PAID_AT, DELIVERED_AT, DELIVERED_AT, CREATED_AT, DELIVERED_AT);
});

afterAll(() => {
  if (db?.open) db.close();
  if (tempRoot?.startsWith(os.tmpdir())) fs.rmSync(tempRoot, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('Netflix delivery date integrity', () => {
  test('prefers delivery, completion, payment, then creation time', () => {
    const resolve = deliverySubscriptions.resolveDeliveryServiceStartAt;
    expect(resolve({ delivered_at: DELIVERED_AT, completed_at: PAID_AT, paid_at: CREATED_AT })).toBe(DELIVERED_AT);
    expect(resolve({ completed_at: PAID_AT, paid_at: CREATED_AT })).toBe(PAID_AT);
    expect(resolve({ paid_at: PAID_AT, created_at: CREATED_AT })).toBe(PAID_AT);
    expect(resolve({ created_at: CREATED_AT })).toBe(CREATED_AT);
  });

  test('repairs the historical created-at bug and delivery retry keeps the correct date', () => {
    const order = db.prepare("SELECT * FROM orders WHERE order_code = 'CN_NETFLIX_DATE'").get();
    const input = deliverySubscriptions.buildDeliverySubscriptionInput({
      order,
      gmailEmail: 'netflix@example.com',
      gmailPassword: 'test-password',
      profile: 'Profile 1',
    });
    expect(input.purchaseDate).toBe(DELIVERED_AT);

    const wrong = subscriptions.addSubscription({
      ...input,
      purchaseDate: CREATED_AT,
      source: 'DISCORD_MODAL',
    });
    db.prepare(`
      UPDATE subscription_accounts
      SET renewal_remind_sent_at = '2026-08-31T00:00:00.000Z',
          admin_reminder_stage = 'URGENT_1D',
          admin_reminder_sent_at = '2026-08-31T00:00:00.000Z'
      WHERE id = ?
    `).run(wrong.id);

    const repair = subscriptions.repairNetflixDeliveryStartDates({ now: new Date('2026-09-01T00:00:00.000Z') });
    expect(repair.repaired).toHaveLength(1);
    expect(repair.repaired[0]).toMatchObject({
      orderCode: 'CN_NETFLIX_DATE',
      previousStartAt: CREATED_AT,
      startAt: DELIVERED_AT,
      expiryAt: CORRECT_EXPIRY,
    });

    const repaired = subscriptions.getSubscriptionById(wrong.id);
    expect(repaired).toMatchObject({
      purchase_date: DELIVERED_AT,
      expiry_at: CORRECT_EXPIRY,
      status: 'ACTIVE',
      renewal_remind_sent_at: null,
      admin_reminder_stage: null,
      admin_reminder_sent_at: null,
    });
    expect(subscriptions.getSubscriptionHistory(wrong.id).some((event) => event.event_type === 'START_DATE_REPAIRED')).toBe(true);

    db.prepare('UPDATE subscription_accounts SET purchase_date = ?, expiry_at = ? WHERE id = ?')
      .run(CREATED_AT, '2026-09-01T02:00:00.000Z', wrong.id);
    const resynced = subscriptions.upsertSubscriptionFromDelivery(input);
    expect(resynced.purchase_date).toBe(DELIVERED_AT);
    expect(resynced.expiry_at).toBe(CORRECT_EXPIRY);
  });
});

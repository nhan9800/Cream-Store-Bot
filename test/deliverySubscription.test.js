import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, initDatabase } from '../src/database/db.js';
import { decrypt, encrypt } from '../src/utils/crypto.js';
import {
  backfillRecentDeliverySubscriptions,
  buildDeliverySubscriptionInput,
  syncDeliverySubscription,
} from '../src/services/deliverySubscriptionService.js';

const ORDER_CODE = `TEST_SUB_${Date.now()}`;
const BACKFILL_ORDER_CODE = `${ORDER_CODE}_BACKFILL`;
const BACKFILL_TICKET_CHANNEL = `${ORDER_CODE}_CHANNEL`;
const originalEncryptionKey = process.env.ENCRYPTION_KEY;

const netflixOrder = {
  guild_id: 'test_delivery_subscription',
  order_code: ORDER_CODE,
  customer_id: '123456789012345678',
  product_name: 'Netflix Premium 3 Tháng',
  service_type: 'netflix',
  duration_months: 3,
  delivered_at: '2026-08-08T12:00:00.000Z',
};

describe('/giaohang subscription synchronization', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = originalEncryptionKey || 'test-delivery-subscription-encryption-key';
    initDatabase();
    db.prepare('DELETE FROM subscription_accounts WHERE related_order_code IN (?, ?)').run(ORDER_CODE, BACKFILL_ORDER_CODE);
    db.prepare('DELETE FROM orders WHERE order_code = ?').run(BACKFILL_ORDER_CODE);
    db.prepare('DELETE FROM tickets WHERE channel_id = ?').run(BACKFILL_TICKET_CHANNEL);
  });

  afterAll(() => {
    db.prepare('DELETE FROM subscription_accounts WHERE related_order_code IN (?, ?)').run(ORDER_CODE, BACKFILL_ORDER_CODE);
    db.prepare('DELETE FROM orders WHERE order_code = ?').run(BACKFILL_ORDER_CODE);
    db.prepare('DELETE FROM tickets WHERE channel_id = ?').run(BACKFILL_TICKET_CHANNEL);
    if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  it('builds the Netflix renewal schedule from the delivered order', () => {
    const input = buildDeliverySubscriptionInput({
      order: netflixOrder,
      gmailEmail: 'customer@example.com',
      gmailPassword: 'first-password',
      profile: 'Cenar 01',
      customerDiscordName: 'customer',
    });

    expect(input).toMatchObject({
      serviceType: 'netflix',
      renewalMode: 'auto_cycle',
      renewalCycleMonths: 1,
      totalDurationMonths: 3,
      relatedOrderCode: ORDER_CODE,
      note: 'Profile: Cenar 01',
    });
  });

  it('upserts by order code instead of creating duplicate website records', () => {
    const first = syncDeliverySubscription({
      order: netflixOrder,
      gmailEmail: 'customer@example.com',
      gmailPassword: 'first-password',
      profile: 'Cenar 01',
      customerDiscordName: 'customer',
    });
    const second = syncDeliverySubscription({
      order: netflixOrder,
      gmailEmail: 'updated@example.com',
      gmailPassword: 'updated-password',
      profile: 'Cenar 02',
      customerDiscordName: 'customer',
    });

    const rows = db.prepare('SELECT * FROM subscription_accounts WHERE related_order_code = ?').all(ORDER_CODE);
    expect(rows).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(rows[0].gmail_email).toBe('updated@example.com');
    expect(decrypt(rows[0].gmail_password)).toBe('updated-password');
    expect(rows[0].note).toBe('Profile: Cenar 02');
  });

  it('requires both credentials for a tracked subscription', () => {
    expect(() => buildDeliverySubscriptionInput({
      order: netflixOrder,
      gmailEmail: 'customer@example.com',
      gmailPassword: '',
    })).toThrow(/Gmail và mật khẩu/);
  });

  it('backfills a recent delivered Netflix order that is missing from the website', () => {
    const timestamp = new Date().toISOString();
    const ticket = db.prepare(`
      INSERT INTO tickets (
        guild_id, channel_id, customer_id, opened_by_id,
        ticket_type, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'test_delivery_subscription',
      BACKFILL_TICKET_CHANNEL,
      '123456789012345678',
      'test_staff',
      'ORDER',
      'CLOSED',
      timestamp,
    );

    db.prepare(`
      INSERT INTO orders (
        order_code, guild_id, ticket_id, ticket_channel_id, customer_id,
        product_name, quantity, total_amount, amount_paid, payment_provider,
        payment_status, status, order_log_channel_id, created_by_id,
        duration_months, service_type, delivered_at,
        credential_email, credential_password, credential_profile,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      BACKFILL_ORDER_CODE,
      'test_delivery_subscription',
      Number(ticket.lastInsertRowid),
      BACKFILL_TICKET_CHANNEL,
      '123456789012345678',
      'Netflix Premium 1 Tháng',
      1,
      50000,
      50000,
      'PAYOS',
      'PAID',
      'COMPLETED',
      'test_order_log_channel',
      'test_staff',
      1,
      'netflix',
      timestamp,
      encrypt('backfill@example.com'),
      encrypt('backfill-password'),
      encrypt('Cenar Backfill'),
      timestamp,
      timestamp,
    );

    const result = backfillRecentDeliverySubscriptions({ lookbackDays: 14 });
    const row = db.prepare('SELECT * FROM subscription_accounts WHERE related_order_code = ?').get(BACKFILL_ORDER_CODE);

    expect(result.created).toBeGreaterThanOrEqual(1);
    expect(result.failed).toHaveLength(0);
    expect(row.service_type).toBe('netflix');
    expect(row.note).toBe('Profile: Cenar Backfill');
    expect(decrypt(row.gmail_password)).toBe('backfill-password');
  });
});

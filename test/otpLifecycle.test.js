import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db, initDatabase } from '../src/database/db.js';
import { expireOtpOrder } from '../src/services/otpLifecycleService.js';
import { getWalletBalance } from '../src/services/walletService.js';

const testDatabasePath = vi.hoisted(() => {
  const relativePath = `./data/test-otp-lifecycle-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.test-otp-lifecycle-not-present';
  process.env.DATABASE_PATH = relativePath;
  return relativePath;
});

const suffix = Date.now().toString();
const guildId = `test_otp_guild_${suffix}`;
const customerId = `test_otp_customer_${suffix}`;
const requestId = `test_otp_request_${suffix}`;

describe('OTP lifecycle idempotency', () => {
  beforeAll(() => {
    initDatabase();
    db.prepare(`
      INSERT INTO viotp_orders (
        guild_id, customer_id, service_id, service_name, price,
        request_id, phone_number, status
      ) VALUES (?, ?, 7, 'Test OTP', 8000, ?, '0900000000', 'PENDING')
    `).run(guildId, customerId, requestId);
  });

  afterAll(() => {
    db.prepare('DELETE FROM wallet_transactions WHERE guild_id = ? AND customer_id = ?').run(guildId, customerId);
    db.prepare('DELETE FROM viotp_orders WHERE request_id = ?').run(requestId);
    db.prepare('DELETE FROM customer_profiles WHERE guild_id = ? AND customer_id = ?').run(guildId, customerId);
    db.close();
    const absolutePath = path.resolve(process.cwd(), testDatabasePath);
    for (const suffixToRemove of ['', '-shm', '-wal']) {
      fs.rmSync(`${absolutePath}${suffixToRemove}`, { force: true });
    }
  });

  it('refunds an expired OTP exactly once even when two workers finalize it', () => {
    const first = expireOtpOrder(requestId, 'Test refund');
    const second = expireOtpOrder(requestId, 'Duplicate test refund');

    expect(first.transitioned).toBe(true);
    expect(second.transitioned).toBe(false);
    expect(getWalletBalance(guildId, customerId)).toBe(8000);
    const refunds = db.prepare(`
      SELECT COUNT(*) AS count
      FROM wallet_transactions
      WHERE guild_id = ? AND customer_id = ? AND related_code = ? AND type = 'REFUND'
    `).get(guildId, customerId, requestId);
    expect(refunds.count).toBe(1);
  });
});

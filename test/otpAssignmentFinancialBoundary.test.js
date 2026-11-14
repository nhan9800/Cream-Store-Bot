import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js', () => ({ config: {}, getPayOSCancelUrl: () => '', getPayOSReturnUrl: () => '' }));
vi.mock('../src/database/db.js', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE customer_profiles(guild_id TEXT,customer_id TEXT,wallet_balance INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(guild_id,customer_id));
    CREATE TABLE wallet_transactions(id INTEGER PRIMARY KEY,guild_id TEXT,customer_id TEXT,amount INTEGER,type TEXT,description TEXT,related_code TEXT,created_at TEXT);
    CREATE TABLE viotp_orders(id INTEGER PRIMARY KEY,guild_id TEXT,customer_id TEXT,service_id INTEGER,service_name TEXT,
      price INTEGER,request_id TEXT UNIQUE,phone_number TEXT,status TEXT,otp_code TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  return { db, nowIso: () => new Date().toISOString() };
});
vi.mock('../src/utils/emojiHelper.js', () => ({
  createEmojiResolver: () => Object.assign(() => '', { component: () => null }),
}));
vi.mock('../src/services/viotpService.js', () => ({ getBalance: vi.fn(), getServices: vi.fn(), requestOtp: vi.fn(), checkSession: vi.fn() }));
vi.mock('../src/services/roleService.js', () => ({ applyCustomerRoles: vi.fn(async () => {}) }));
vi.mock('../src/services/automationLogService.js', () => ({ emitAutomationLog: vi.fn(async () => {}), maskPhone: () => 'masked synthetic phone' }));

import { db } from '../src/database/db.js';
import { getServices, requestOtp } from '../src/services/viotpService.js';
import { emitAutomationLog } from '../src/services/automationLogService.js';
import { addWalletBalance, getWalletBalance } from '../src/services/walletService.js';
import { completeOtpOrder, expireOtpOrder } from '../src/services/otpLifecycleService.js';
import { handleOtpInteraction } from '../src/events/otpHandlers.js';

const guildId = '123456789012345678', customerId = '234567890123456789', requestId = 'synthetic-session-1';
function interaction() {
  return { customId: 'otp:select_service', values: ['7'], guildId, user: { id: customerId }, guild: {}, client: {},
    deferred: true, replied: false, deferReply: vi.fn(async () => {}), editReply: vi.fn(async () => {}), reply: vi.fn(async () => {}) };
}
const refunds = () => db.prepare("SELECT * FROM wallet_transactions WHERE type='REFUND'").all();
beforeEach(() => {
  db.exec('DELETE FROM viotp_orders; DELETE FROM wallet_transactions; DELETE FROM customer_profiles');
  vi.clearAllMocks();
  getServices.mockResolvedValue([{ id: 7, name: 'Synthetic OTP', price: 5000 }]);
  requestOtp.mockResolvedValue({ request_id: requestId, phone_number: '0900000000' });
  emitAutomationLog.mockResolvedValue(undefined);
  addWalletBalance(guildId, customerId, 8000, 'TOPUP', 'Synthetic initial credit');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => db.close());

describe('OTP assignment financial boundary', () => {
  it.each(['reply', 'log'])('does not refund an assigned session when the subsequent Discord %s fails', async failure => {
    const command = interaction();
    if (failure === 'reply') command.editReply.mockRejectedValueOnce(new Error('synthetic Discord reply failure'));
    else emitAutomationLog.mockRejectedValueOnce(new Error('synthetic automation log failure'));
    await handleOtpInteraction(command);
    expect(db.prepare('SELECT status,price FROM viotp_orders WHERE request_id=?').get(requestId)).toEqual({ status: 'PENDING', price: 8000 });
    const balanceAfterAssignment = getWalletBalance(guildId, customerId);
    expect(expireOtpOrder(requestId).transitioned).toBe(true);
    expect(expireOtpOrder(requestId).transitioned).toBe(false);
    expect(getWalletBalance(guildId, customerId)).toBe(8000);
    expect(refunds()).toHaveLength(1);
    expect(refunds()[0].related_code).toBe(requestId);
    expect(balanceAfterAssignment).toBe(0);
  });
  it('still refunds once when the provider rejects number assignment before any session exists', async () => {
    requestOtp.mockRejectedValueOnce(new Error('synthetic provider rejection'));
    await handleOtpInteraction(interaction());
    expect(db.prepare('SELECT COUNT(*) AS n FROM viotp_orders').get().n).toBe(0);
    expect(getWalletBalance(guildId, customerId)).toBe(8000);
    expect(refunds()).toHaveLength(1);
  });
  it('keeps the debit for a successful OTP rather than refunding it after completion', async () => {
    await handleOtpInteraction(interaction());
    expect(completeOtpOrder(requestId, '123456').transitioned).toBe(true);
    expect(expireOtpOrder(requestId).transitioned).toBe(false);
    expect(getWalletBalance(guildId, customerId)).toBe(0);
    expect(refunds()).toHaveLength(0);
  });
});

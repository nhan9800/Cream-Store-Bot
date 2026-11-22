import { describe, expect, it } from 'vitest';
import {
  BACKUP_INTERVAL_MS,
  TELEGRAM_RETRY_AFTER_FAILURE_MS,
  scheduledBackupReason,
  startupBackupReason,
  telegramSlotKey,
} from '../src/services/backupStartupPolicy.js';

// 21:30 giờ VN ngày 22/11/2026 = 14:30 UTC.
const now = Date.parse('2026-11-22T14:30:00.000Z');
const hoursAgo = (hours) => new Date(now - hours * 60 * 60 * 1000).toISOString();
const telegramEnv = { TELEGRAM_BACKUP_TOKEN: 'token', TELEGRAM_BACKUP_CHAT_ID: '-100123' };

describe('Telegram slot keys follow Vietnam wall-clock time', () => {
  it('maps a moment to the latest 03:00 or 15:00 slot that has started', () => {
    expect(telegramSlotKey(Date.parse('2026-11-22T14:30:00.000Z'))).toBe('2026-11-22@15'); // 21:30 VN
    expect(telegramSlotKey(Date.parse('2026-11-22T07:59:00.000Z'))).toBe('2026-11-22@03'); // 14:59 VN
    expect(telegramSlotKey(Date.parse('2026-11-22T08:00:00.000Z'))).toBe('2026-11-22@15'); // 15:00 VN
    expect(telegramSlotKey(Date.parse('2026-11-21T20:00:00.000Z'))).toBe('2026-11-22@03'); // 03:00 VN
  });

  it('treats the hours before 03:00 as the previous day afternoon slot', () => {
    // 02:08 VN ngày 22/11 (lần gửi đầu tiên thực tế) thuộc lượt 15:00 ngày 21/11.
    expect(telegramSlotKey(Date.parse('2026-11-21T19:08:00.000Z'))).toBe('2026-11-21@15');
  });

  it('returns null for an unreadable time', () => {
    expect(telegramSlotKey('not a date')).toBeNull();
  });
});

describe('scheduled backup policy', () => {
  it('backs up when no previous status exists', () => {
    expect(scheduledBackupReason(null, { now, env: {} })).toBe('no_previous_backup');
    expect(scheduledBackupReason({ completedAt: 'invalid' }, { now, env: {} })).toBe('no_previous_backup');
  });

  it('backs up when the newest local backup is older than 12 hours, whatever restarts happened', () => {
    const status = { completedAt: new Date(now - BACKUP_INTERVAL_MS).toISOString(), telegram: { status: 'success' } };
    expect(scheduledBackupReason(status, { now, env: telegramEnv, lastTelegramSentAt: hoursAgo(1) })).toBe('previous_backup_stale');
  });

  it('sends the current Telegram slot when it has not been sent yet', () => {
    // Bản gửi lúc 02:08 VN thuộc lượt hôm trước, nên lượt 15:00 hôm nay vẫn đến hạn lúc 21:30.
    const status = { completedAt: hoursAgo(2), telegram: { status: 'skipped', reason: 'already_sent_this_slot' } };
    expect(scheduledBackupReason(status, { now, env: telegramEnv, lastTelegramSentAt: '2026-11-21T19:08:45.000Z' })).toBe('telegram_slot_due');
    expect(scheduledBackupReason(status, { now, env: telegramEnv, lastTelegramSentAt: null })).toBe('telegram_slot_due');
  });

  it('waits once the current slot was delivered', () => {
    const status = { completedAt: hoursAgo(1), telegram: { status: 'success' } };
    expect(scheduledBackupReason(status, { now, env: telegramEnv, lastTelegramSentAt: '2026-11-22T08:05:00.000Z' })).toBeNull();
  });

  it('ignores Telegram slots when Telegram is not fully configured', () => {
    const status = { completedAt: hoursAgo(1), telegram: { status: 'skipped', reason: 'not_configured' } };
    expect(scheduledBackupReason(status, { now, env: {} })).toBeNull();
    expect(scheduledBackupReason(status, { now, env: { TELEGRAM_BACKUP_TOKEN: 'token' } })).toBeNull();
  });

  it('retries a failed upload hourly instead of on every 10-minute check', () => {
    const failed = { completedAt: hoursAgo(0.5), telegram: { status: 'failed', reason: 'telegram_error' } };
    expect(scheduledBackupReason(failed, { now, env: telegramEnv })).toBeNull();
    const older = { completedAt: new Date(now - TELEGRAM_RETRY_AFTER_FAILURE_MS).toISOString(), telegram: { status: 'failed' } };
    expect(scheduledBackupReason(older, { now, env: telegramEnv })).toBe('telegram_slot_due');
  });

  it('uses the same policy for the first check after startup', () => {
    expect(startupBackupReason).toBe(scheduledBackupReason);
  });
});

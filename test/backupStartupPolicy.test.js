import { describe, expect, it } from 'vitest';
import { BACKUP_INTERVAL_MS, startupBackupReason } from '../src/services/backupStartupPolicy.js';

const now = Date.parse('2026-11-22T00:00:00.000Z');
const hoursAgo = (hours) => new Date(now - hours * 60 * 60 * 1000).toISOString();
const telegramEnv = { TELEGRAM_BACKUP_TOKEN: 'token', TELEGRAM_BACKUP_CHAT_ID: '-100123' };

describe('startup backup catch-up policy', () => {
  it('backs up after startup when no previous status exists', () => {
    expect(startupBackupReason(null, { now, env: {} })).toBe('no_previous_backup');
    expect(startupBackupReason({ completedAt: null }, { now, env: {} })).toBe('no_previous_backup');
    expect(startupBackupReason({ completedAt: 'invalid' }, { now, env: {} })).toBe('no_previous_backup');
  });

  it('backs up when the newest backup is older than the regular interval', () => {
    const status = { completedAt: new Date(now - BACKUP_INTERVAL_MS).toISOString(), telegram: { status: 'success' } };
    expect(startupBackupReason(status, { now, env: telegramEnv })).toBe('previous_backup_stale');
  });

  it('waits for the regular interval after a recent backup', () => {
    expect(startupBackupReason({ completedAt: hoursAgo(2), telegram: { status: 'skipped', reason: 'not_configured' } }, { now, env: {} })).toBeNull();
    expect(startupBackupReason({ completedAt: hoursAgo(2), telegram: { status: 'success' } }, { now, env: telegramEnv })).toBeNull();
    expect(startupBackupReason({ completedAt: hoursAgo(2), telegram: { status: 'skipped', reason: 'already_sent_today' } }, { now, env: telegramEnv })).toBeNull();
  });

  it('backs up promptly when Telegram was just configured or the last upload failed', () => {
    expect(startupBackupReason({ completedAt: hoursAgo(1), telegram: { status: 'skipped', reason: 'not_configured' } }, { now, env: telegramEnv })).toBe('remote_target_pending');
    expect(startupBackupReason({ completedAt: hoursAgo(1), telegram: { status: 'failed', reason: 'encryption_key_missing' } }, { now, env: telegramEnv })).toBe('remote_target_pending');
  });

  it('ignores a partial Telegram configuration for the catch-up decision', () => {
    const status = { completedAt: hoursAgo(1), telegram: { status: 'failed', reason: 'incomplete_configuration' } };
    expect(startupBackupReason(status, { now, env: { TELEGRAM_BACKUP_TOKEN: 'token' } })).toBeNull();
  });
});

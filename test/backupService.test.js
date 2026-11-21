import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const testPaths = vi.hoisted(() => {
  const token = `${process.pid}-${Date.now()}`;
  const database = `./data/test-backup-${token}.sqlite`;
  const backups = `./data/test-backups-${token}`;
  process.env.ENV_FILE = '.env.test-backup-not-present';
  process.env.DATABASE_PATH = database;
  process.env.BACKUP_DIRECTORY = backups;
  process.env.ENCRYPTION_KEY = 'test-backup-key';
  return { database, backups };
});

import { db, initDatabase } from '../src/database/db.js';
import { backupDatabase, verifyBackupRestore } from '../src/services/backupService.js';

describe('backup restore verification and status reporting', () => {
  beforeAll(() => initDatabase());

  beforeEach(() => {
    delete process.env.TELEGRAM_BACKUP_TOKEN;
    delete process.env.TELEGRAM_BACKUP_CHAT_ID;
    delete process.env.GD_CLIENT_EMAIL;
    delete process.env.GD_PRIVATE_KEY;
    delete process.env.GD_FOLDER_ID;
    delete process.env.BACKUP_ENCRYPTION_KEY;
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    db.close();
    const databasePath = path.resolve(process.cwd(), testPaths.database);
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${databasePath}${suffix}`, { force: true });
    fs.rmSync(path.resolve(process.cwd(), testPaths.backups), { recursive: true, force: true });
  });

  it('restores every scheduled backup and reports unconfigured remote targets accurately', async () => {
    const first = await backupDatabase({ snapshot: false });
    const second = await backupDatabase({ snapshot: false });

    expect(first.backupPath).not.toBe(second.backupPath);
    expect(second).toMatchObject({
      overallStatus: 'local_only',
      local: { status: 'success' },
      restoreVerification: { status: 'success', integrity: 'ok' },
      telegram: { status: 'skipped', reason: 'not_configured' },
      googleDrive: { status: 'skipped', reason: 'not_configured' },
    });
    expect(second.restoreVerification.tableCount).toBeGreaterThan(0);

    const savedStatus = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), testPaths.backups, 'latest-status.json'), 'utf8'));
    expect(savedStatus.backupPath).toBe(second.backupPath);
    expect(savedStatus.overallStatus).toBe('local_only');
  });

  it('marks partial Telegram configuration as failed instead of successful', async () => {
    process.env.TELEGRAM_BACKUP_TOKEN = 'configured-without-chat-id';
    const report = await backupDatabase({ snapshot: false });

    expect(report.overallStatus).toBe('degraded');
    expect(report.telegram).toEqual({ status: 'failed', reason: 'incomplete_configuration' });
  });

  it('never uploads a plaintext database when the encryption key is missing or weak', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.TELEGRAM_BACKUP_TOKEN = 'telegram-token';
    process.env.TELEGRAM_BACKUP_CHAT_ID = '-100123';

    const missing = await backupDatabase({ snapshot: false });
    expect(missing.telegram).toEqual({ status: 'failed', reason: 'encryption_key_missing' });
    expect(missing.overallStatus).toBe('degraded');

    process.env.BACKUP_ENCRYPTION_KEY = 'too-short';
    const weak = await backupDatabase({ snapshot: false });
    expect(weak.telegram).toEqual({ status: 'failed', reason: 'encryption_key_too_short' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uploads only the encrypted copy to Telegram and removes the temporary file', async () => {
    const bodies = [];
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      bodies.push(Buffer.from(init.body));
      return { json: async () => ({ ok: true, result: { message_id: 42 } }) };
    }));
    process.env.TELEGRAM_BACKUP_TOKEN = 'telegram-token';
    process.env.TELEGRAM_BACKUP_CHAT_ID = '-100123';
    process.env.BACKUP_ENCRYPTION_KEY = 'k'.repeat(40);

    const report = await backupDatabase({ snapshot: false });
    expect(report.telegram).toEqual({ status: 'success', messageId: 42, retention: { keep: 1, deleted: 0, failed: 0 } });
    expect(report.encryption).toMatchObject({ status: 'success', algorithm: 'aes-256-gcm+scrypt' });
    expect(report.overallStatus).toBe('success');
    expect(bodies).toHaveLength(1);
    expect(bodies[0].includes(Buffer.from('SQLite format 3'))).toBe(false);
    expect(bodies[0].includes(Buffer.from('CENARBK1'))).toBe(true);
    expect(bodies[0].includes(Buffer.from('.sqlite.gz.cenc'))).toBe(true);
    const leftovers = fs.readdirSync(path.resolve(process.cwd(), testPaths.backups)).filter((name) => name.endsWith('.cenc'));
    expect(leftovers).toEqual([]);
  });

  it('keeps only the newest Telegram backup by deleting the previous message', async () => {
    const statePath = path.resolve(process.cwd(), testPaths.backups, 'remote-state-shopbot-store1.json');
    // Giả lập bản của hôm qua (đã gửi 24 giờ trước) để bot được phép gửi lại hôm nay.
    const previous = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(previous.telegram.map((entry) => entry.messageId)).toEqual([42]);
    fs.writeFileSync(statePath, JSON.stringify({
      telegram: [
        { messageId: 41, chatId: '-100123', sentAt: new Date(Date.now() - 30 * 3600 * 1000).toISOString() },
        { ...previous.telegram[0], sentAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString() },
      ],
    }));
    const { __resetTelegramDayForTests } = await import('../src/services/backupService.js');
    __resetTelegramDayForTests();
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      calls.push({ url: String(url), body: init.body });
      if (String(url).endsWith('/deleteMessage')) return { json: async () => ({ ok: true, result: true }) };
      return { json: async () => ({ ok: true, result: { message_id: 43 } }) };
    }));
    process.env.TELEGRAM_BACKUP_TOKEN = 'telegram-token';
    process.env.TELEGRAM_BACKUP_CHAT_ID = '-100123';
    process.env.BACKUP_ENCRYPTION_KEY = 'k'.repeat(40);

    const report = await backupDatabase({ snapshot: false });
    expect(report.telegram).toMatchObject({ status: 'success', messageId: 43, retention: { keep: 1, deleted: 2, failed: 0 } });
    const deletedIds = calls.filter((c) => c.url.endsWith('/deleteMessage')).map((c) => JSON.parse(c.body).message_id).sort();
    expect(deletedIds).toEqual([41, 42]);
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(state.telegram.map((entry) => entry.messageId)).toEqual([43]);

    // Cùng ngày thì không gửi thêm bản thứ hai, kể cả sau khi bot khởi động lại.
    __resetTelegramDayForTests();
    const again = await backupDatabase({ snapshot: false });
    expect(again.telegram).toEqual({ status: 'skipped', reason: 'already_sent_today' });
  });

  it('rejects a file that cannot be restored as SQLite', () => {
    const corruptPath = path.resolve(process.cwd(), testPaths.backups, 'corrupt.sqlite');
    fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
    fs.writeFileSync(corruptPath, 'not a sqlite database');
    expect(() => verifyBackupRestore(corruptPath)).toThrow();
  });
});

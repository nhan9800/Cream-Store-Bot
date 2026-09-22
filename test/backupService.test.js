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

  it('rejects a file that cannot be restored as SQLite', () => {
    const corruptPath = path.resolve(process.cwd(), testPaths.backups, 'corrupt.sqlite');
    fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
    fs.writeFileSync(corruptPath, 'not a sqlite database');
    expect(() => verifyBackupRestore(corruptPath)).toThrow();
  });
});

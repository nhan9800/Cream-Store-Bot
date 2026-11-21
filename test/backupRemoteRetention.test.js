import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRemoteKeepCount, pruneGoogleDriveBackups, pruneTelegramBackups } from '../src/services/backupRemoteRetention.js';

afterEach(() => vi.unstubAllGlobals());

describe('remote backup retention', () => {
  it('defaults to keeping only the newest backup', () => {
    expect(getRemoteKeepCount({})).toBe(1);
    expect(getRemoteKeepCount({ BACKUP_REMOTE_KEEP: '3' })).toBe(3);
    expect(getRemoteKeepCount({ BACKUP_REMOTE_KEEP: '0' })).toBe(1);
    expect(getRemoteKeepCount({ BACKUP_REMOTE_KEEP: 'abc' })).toBe(1);
  });

  it('drops Telegram entries it can no longer delete after 48 hours but retries recent ones', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-retention-'));
    const statePath = path.join(dir, 'state.json');
    const now = Date.now();
    fs.writeFileSync(statePath, JSON.stringify({ telegram: [
      { messageId: 1, sentAt: new Date(now - 72 * 3600e3).toISOString() },
      { messageId: 2, sentAt: new Date(now - 20 * 3600e3).toISOString() },
    ] }));
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ ok: false, description: 'Bad Request: message can\'t be deleted' }) })));
    const result = await pruneTelegramBackups({
      statePath, token: 't', chatId: 'c', keep: 1, now,
      newEntry: { messageId: 3, sentAt: new Date(now).toISOString() },
    });
    expect(result.failed.map((f) => f.messageId)).toEqual([2, 1]);
    const ids = JSON.parse(fs.readFileSync(statePath, 'utf8')).telegram.map((e) => e.messageId);
    expect(ids).toEqual([3, 2]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('deletes older Google Drive copies of the same store only', async () => {
    const calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method || 'GET' });
      if (!init.method) {
        return { json: async () => ({ files: [
          { id: 'new', name: 'shopbot-store1-b.sqlite.gz.cenc' },
          { id: 'old', name: 'shopbot-store1-a.sqlite.gz.cenc' },
          { id: 'other', name: 'shopbot-store1-notes.txt' },
        ] }) };
      }
      return { status: 204, ok: true };
    }));
    const result = await pruneGoogleDriveBackups({ accessToken: 'x', folderId: 'f', prefix: 'shopbot-store1', keep: 1 });
    expect(result).toEqual({ deleted: 1, failed: [] });
    const deletes = calls.filter((c) => c.method === 'DELETE').map((c) => c.url);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain('/files/old?');
    expect(new URL(calls[0].url).searchParams.get('q')).toContain("name contains 'shopbot-store1-'");
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { Collection } from 'discord.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let root, db, server, base;
const original = { ...process.env };
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-system-permissions-'));
  fs.mkdirSync(path.join(root, 'data'));
  process.env.ENV_FILE = path.join(root, 'no-env');
  process.env.DATABASE_PATH = path.join(root, 'data', 'test.sqlite');
  process.env.BOT_API_KEY = 'system-permissions-test-only';
  process.env.ENCRYPTION_KEY = 'system-permissions-encryption-test-only';
  process.env.GUILD_ID = '123456789012345678';
  const database = await import('../src/database/db.js');
  db = database.db; database.initDatabase();
  for (const role of ['staff', 'admin', 'member']) {
    db.prepare('INSERT INTO web_users(id, email, role) VALUES (?, ?, ?)').run(role, `${role}@example.invalid`, role);
  }
  const app = express(); app.use(express.json());
  const guild = { id: process.env.GUILD_ID, channels: { cache: new Collection() } };
  app.locals.discordClient = { guilds: { cache: new Collection([[guild.id, guild]]) } };
  const { registerAdminRoutes } = await import('../src/services/adminApiRoutes.js');
  registerAdminRoutes(app);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/bot/admin`;
}, 30_000);
afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (db?.open) db.close();
  if (root && path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true });
  process.env = original;
});
function call(route, method = 'GET', body, userId = 'staff') {
  return fetch(`${base}${route}`, {
    method, headers: {
      'Content-Type': 'application/json', 'X-Bot-Api-Key': 'system-permissions-test-only',
      'X-User-Id': userId, 'X-User-Role': 'admin', 'X-Session-Version': '0',
    }, body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const restricted = [
  ['/settings', 'GET'], ['/settings', 'POST', { settings: { shop_name: 'Unauthorized' } }],
  ['/ai-knowledge', 'GET'], ['/ai-knowledge', 'POST', { content: 'Unauthorized' }],
  ['/data/backup', 'GET'], ['/data/backups-list', 'GET'],
  ['/data/restore', 'POST', { filename: 'backup_123.sqlite' }],
  ['/data/optimize', 'POST', {}], ['/data/purge', 'POST', { days: 90 }],
];
describe('system administration permissions', () => {
  it.each(restricted)('denies actual Staff %s %s despite claimed admin header', async (route, method, body) => {
    const before = db.prepare('SELECT * FROM system_settings ORDER BY key').all();
    const response = await call(route, method, body);
    expect(response.status).toBe(403);
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(db.prepare('SELECT * FROM system_settings ORDER BY key').all()).toEqual(before);
    expect(fs.existsSync(path.join(root, 'backups'))).toBe(false);
  });
  it('also gates case-insensitive Express paths and trailing slashes', async () => {
    expect((await call('/DATA/BACKUP/')).status).toBe(403);
  });
  it('keeps Staff order and music reads available', async () => {
    expect((await call('/orders')).status).toBe(200);
    expect((await call('/music')).status).toBe(200);
  });
  it('lets actual Admin configure settings and create a usable SQLite backup', async () => {
    expect((await call('/settings', 'POST', { settings: { shop_name: 'Admin fixture' } }, 'admin')).status).toBe(200);
    const settings = await call('/settings', 'GET', undefined, 'admin');
    expect((await settings.json()).data.shop_name).toBe('Admin fixture');
    const backup = await call('/data/backup', 'GET', undefined, 'admin');
    expect(backup.status).toBe(200);
    expect(backup.headers.get('content-disposition')).toMatch(/backup_\d+\.sqlite/);
    expect(Buffer.from(await backup.arrayBuffer()).subarray(0, 16).toString()).toBe('SQLite format 3\0');
  });
  it.each([-1, 0, 30, 89, 90.5, 3651, '90', null, 1e300])('rejects invalid retention %s without deleting logs', async days => {
    const before = db.prepare('SELECT count(*) AS n FROM staff_logs').get().n;
    expect((await call('/data/purge', 'POST', { days }, 'admin')).status).toBe(400);
    expect(db.prepare('SELECT count(*) AS n FROM staff_logs').get().n).toBe(before);
  });
  it('preserves historical wallet/payment evidence during authorized log cleanup', async () => {
    db.prepare("INSERT INTO staff_logs (guild_id, actor_id, action, detail, created_at) VALUES ('TEST', 'admin', 'TEST', 'fixture', '2000-01-01')").run();
    db.prepare("INSERT INTO wallet_transactions (guild_id, customer_id, amount, type, created_at) VALUES ('TEST', 'customer', 100, 'CREDIT', '2000-01-01')").run();
    db.prepare("INSERT INTO payment_events (order_code, provider, transaction_id, raw_payload, created_at) VALUES ('CN_TEST', 'TEST', 'test-transaction', '{}', '2000-01-01')").run();
    const response = await call('/data/purge', 'POST', { days: 90 }, 'admin');
    expect(response.status).toBe(200);
    expect(db.prepare("SELECT count(*) AS n FROM staff_logs WHERE action = 'TEST'").get().n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM wallet_transactions WHERE customer_id = 'customer'").get().n).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM payment_events WHERE order_code = 'CN_TEST'").get().n).toBe(1);
  });
  it('persists link warnings independently per server across database initialization', async () => {
    const { incrementLinkWarningCount, getLinkWarningCount } = await import('../src/utils/antiScam.js');
    expect(incrementLinkWarningCount('fixture-user', 'fixture-guild')).toBe(1);
    expect(incrementLinkWarningCount('fixture-user', 'fixture-guild')).toBe(2);
    expect(getLinkWarningCount('fixture-user', 'another-guild')).toBe(0);
    const { initDatabase } = await import('../src/database/db.js'); initDatabase();
    expect(getLinkWarningCount('fixture-user', 'fixture-guild')).toBe(2);
  });
});

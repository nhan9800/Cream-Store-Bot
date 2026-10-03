import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

let root, db, server, base, security;
const original = { ...process.env };
const guildId = '123456789012345678';
const discordId = '987654321098765432';

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-web-account-ban-'));
  process.env.ENV_FILE = path.join(root, 'no-env');
  process.env.DATABASE_PATH = path.join(root, 'test.sqlite');
  process.env.BOT_API_KEY = 'account-ban-test-only';
  process.env.ENCRYPTION_KEY = 'account-ban-encryption-test-only';
  process.env.GUILD_ID = guildId;
  process.env.WEB_CHECKOUT_ENABLED = 'true';
  const database = await import('../src/database/db.js');
  db = database.db; database.initDatabase();
  security = await import('../src/services/accountSecurityService.js');
  for (const [id, role, discord, google] of [['admin', 'admin', null, null], ['staff', 'staff', null, null], ['buyer', 'member', discordId, 'google-buyer'], ['second-admin', 'admin', null, null]]) {
    db.prepare('INSERT INTO web_users(id, email, role, discord_id, google_id, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(id, `${id}@example.com`, role, discord, google, security.hashAccountPassword('valid-password'));
    security.getAccountSecurity(id);
  }
  const app = express(); app.use(express.json());
  const { registerBotApiRoutes } = await import('../src/services/botApiRoutes.js'); registerBotApiRoutes(app);
  const { registerAuthRoutes } = await import('../src/services/authApiRoutes.js'); registerAuthRoutes(app);
  const { registerAdminRoutes } = await import('../src/services/adminApiRoutes.js'); registerAdminRoutes(app);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/bot`;
}, 30_000);

beforeEach(() => {
  db.exec('DELETE FROM customer_flags; DELETE FROM web_account_tokens; UPDATE web_account_security SET session_version = 0;');
  db.prepare('UPDATE web_users SET display_name = NULL WHERE id = ?').run('buyer');
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db?.open) db.close();
  if (root && path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true });
  process.env = original;
});

async function call(route, { method = 'GET', body, userId = 'admin', version = 0 } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Bot-Api-Key': 'account-ban-test-only' };
  if (userId) Object.assign(headers, { 'X-User-Id': userId, 'X-Discord-Id': userId === 'buyer' ? discordId : '', 'X-User-Role': userId === 'buyer' ? 'member' : 'admin', 'X-Session-Version': String(version) });
  return fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
function setBan(id = 'buyer', ban = true, userId = 'admin') {
  return call(`/admin/users/${id}/ban`, { method: 'POST', userId, body: { ban, reason: 'Account policy test' } });
}
async function expectBanned(response) {
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ ok: false, code: 'ACCOUNT_BANNED' });
}

describe('website account suspension is enforced independently of Discord blacklist', () => {
  it('blocks password login and revokes sessions plus outstanding email tokens', async () => {
    const token = security.issueAccountEmailToken('buyer@example.com', 'reset');
    expect((await setBan()).status).toBe(200);
    expect(security.getAccountSecurity('buyer').session_version).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM web_account_tokens WHERE user_id = ?').get('buyer').count).toBe(0);
    expect(security.consumeAccountEmailToken(token.token, 'reset', 'changed-password')).toBe(false);
    const wrongPassword = await call('/auth/login', { method: 'POST', userId: null, body: { email: 'buyer@example.com', password: 'wrong-password' } });
    expect(wrongPassword.status).toBe(401);
    expect(await wrongPassword.json()).not.toHaveProperty('code', 'ACCOUNT_BANNED');
    await expectBanned(await call('/auth/login', { method: 'POST', userId: null, body: { email: 'buyer@example.com', password: 'valid-password' } }));
    expect(db.prepare('SELECT guild_id, customer_id FROM customer_flags WHERE is_blacklisted = 1').all()).toEqual([{ guild_id: 'WEB', customer_id: 'buyer' }]);
  });

  it('blocks Discord and Google OAuth resolution before profile mutation', async () => {
    await setBan();
    for (const body of [
      { provider: 'discord', discordId, displayName: 'Should not change' },
      { provider: 'google', googleId: 'google-buyer', displayName: 'Should not change' },
      { provider: 'google', googleId: 'new-google', email: 'buyer@example.com', emailVerified: true, displayName: 'Should not change' },
    ]) await expectBanned(await call('/auth/upsert-oauth', { method: 'POST', userId: null, body }));
    expect(db.prepare('SELECT display_name, google_id FROM web_users WHERE id = ?').get('buyer')).toEqual({ display_name: null, google_id: 'google-buyer' });
  });

  it('rejects stale and even freshly forged banned session identities at resource and account boundaries', async () => {
    await setBan();
    await expectBanned(await call('/auth/user/buyer', { userId: 'buyer' }));
    await expectBanned(await call('/auth/security', { userId: 'buyer', version: 1 }));
    await expectBanned(await call(`/wallet/${discordId}`, { userId: 'buyer', version: 1 }));
    await expectBanned(await call('/web-orders', { method: 'POST', userId: 'buyer', version: 1, body: { items: [] } }));
    expect(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count).toBe(0);
  });

  it('unbans safely, permits new login, and does not reactivate an old session', async () => {
    await setBan();
    expect((await setBan('buyer', false)).status).toBe(200);
    expect(security.getAccountSecurity('buyer').session_version).toBe(2);
    const login = await call('/auth/login', { method: 'POST', userId: null, body: { email: 'buyer@example.com', password: 'valid-password' } });
    expect(login.status).toBe(200);
    expect((await login.json()).data.session_version).toBe(2);
    expect((await call(`/wallet/${discordId}`, { userId: 'buyer', version: 0 })).status).toBe(403);
    expect((await call(`/wallet/${discordId}`, { userId: 'buyer', version: 2 })).status).toBe(200);
  });

  it('does not increment session version repeatedly for an unchanged suspension state', async () => {
    await setBan(); await setBan();
    expect(security.getAccountSecurity('buyer').session_version).toBe(1);
    await setBan('buyer', false); await setBan('buyer', false);
    expect(security.getAccountSecurity('buyer').session_version).toBe(2);
  });

  it('prevents self suspension and denies staff or a suspended administrator', async () => {
    expect((await setBan('admin')).status).toBe(403);
    expect((await setBan('buyer', true, 'staff')).status).toBe(403);
    expect((await setBan('second-admin')).status).toBe(200);
    await expectBanned(await call('/admin/users', { userId: 'second-admin', version: 1 }));
    await expectBanned(await setBan('buyer', true, 'second-admin'));
    expect(db.prepare('SELECT is_blacklisted FROM customer_flags WHERE guild_id = ? AND customer_id = ?').get('WEB', 'buyer')).toBeUndefined();
  });

  it('rejects invalid ban values and missing users without orphan flag rows', async () => {
    expect((await call('/admin/users/buyer/ban', { method: 'POST', body: { ban: 'false' } })).status).toBe(400);
    expect((await setBan('missing')).status).toBe(404);
    expect(db.prepare('SELECT COUNT(*) AS count FROM customer_flags').get().count).toBe(0);
  });
});

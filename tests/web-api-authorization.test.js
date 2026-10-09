import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
let root, db, server, base, security, adminHandlers = [];
const original = { ...process.env };
const owner = '123456789012345678', other = '987654321098765432';
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-api-authorization-'));
  process.env.ENV_FILE = path.join(root, 'no-env'); process.env.DATABASE_PATH = path.join(root, 'test.sqlite');
  process.env.BOT_API_KEY = 'authorization-test-only'; process.env.ENCRYPTION_KEY = 'authorization-encryption-test-only';
  const database = await import('../src/database/db.js'); db = database.db; database.initDatabase();
  security = await import('../src/services/accountSecurityService.js');
  for (const [id, email, discord, role] of [['owner', 'owner@example.com', owner, 'member'], ['other', 'other@example.com', other, 'member'], ['admin', 'admin@example.com', '111111111111111111', 'admin']]) {
    db.prepare('INSERT INTO web_users(id, email, discord_id, role, password_hash) VALUES (?, ?, ?, ?, ?)').run(id, email, discord, role, security.hashAccountPassword('test-password'));
    if (role === 'admin') {
      security.getAccountSecurity(id);
      db.prepare('UPDATE web_account_security SET mfa_secret = ? WHERE user_id = ?').run('test-mfa-present', id);
    }
  }
  const app = express(); app.use(express.json());
  const { registerBotApiRoutes } = await import('../src/services/botApiRoutes.js'); registerBotApiRoutes(app);
  const { registerAuthRoutes } = await import('../src/services/authApiRoutes.js'); registerAuthRoutes(app);
  const { registerAdminRoutes } = await import('../src/services/adminApiRoutes.js');
  const registry = Object.fromEntries(['get', 'post', 'put', 'delete'].map((method) => [method, (route, ...handlers) => adminHandlers.push({ route, method, guard: handlers[0] })]));
  registerAdminRoutes(registry);
  const quests = await import('../src/services/questService.js'); quests.listQuestPlans();
  db.prepare(`INSERT INTO tickets(id, ticket_code, guild_id, channel_id, customer_id, opened_by_id)
    VALUES (1, 'TKT_OTHER', 'TEST', 'test-channel', ?, ?)`).run(other, other);
  db.prepare(`INSERT INTO orders(order_code, guild_id, ticket_id, ticket_channel_id, customer_id, product_name, status, created_by_id, order_log_channel_id)
    VALUES ('CN_OTHER', 'TEST', 1, 'test-channel', ?, 'Private product', 'COMPLETED', 'other', 'test-log')`).run(other);
  db.prepare(`INSERT INTO quest_service_requests(id, request_code, guild_id, discord_id, plan_code, quoted_price, quest_name) VALUES (1, 'QS_123456', 'TEST', ?, 'QUEST_VN', 35000, 'Private quest')`).run(other);
  server = app.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/bot`;
}, 30_000);
afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db?.open) db.close();
  if (root && path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true });
  process.env = original;
});
async function call(route, { method = 'GET', body, userId = 'owner', discordId = owner, role = 'member', key = 'authorization-test-only', version, proof } = {}) {
  const headers = { 'Content-Type': 'application/json', 'X-Bot-Api-Key': key, 'X-User-Id': userId, 'X-Discord-Id': discordId, 'X-User-Role': role };
  if (version !== undefined) headers['X-Session-Version'] = String(version);
  if (proof) headers['X-Admin-Step-Up'] = proof;
  if (proof !== false && !proof && userId === 'admin' && role === 'admin') headers['X-Admin-Step-Up'] = security.issueAdminStepUp('admin');
  return fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
describe('web API authorization', () => {
  it('rejects wrong API keys before customer access', async () => { expect((await call(`/wallet/${owner}`, { key: 'wrong' })).status).toBe(401); });
  it('binds wallet reads and topups to the current DB Discord link', async () => {
    expect((await call(`/wallet/${owner}`)).status).toBe(200);
    expect((await call(`/wallet/${other}`)).status).toBe(403);
    expect((await call(`/wallet/${other}`, { discordId: other })).status).toBe(403);
    expect((await call('/wallet/topup', { method: 'POST', body: { customerId: other, amount: 50000 } })).status).toBe(403);
  });
  it('rejects forged staff roles', async () => { expect((await call(`/wallet/${other}`, { role: 'admin' })).status).toBe(403); });
  it('binds order detail and delivery to canonical ownership and a fresh staff grant', async () => {
    expect((await call('/orders/CN_OTHER', { role: 'admin' })).status).toBe(403);
    expect((await call('/orders/CN_OTHER', { discordId: other })).status).toBe(403);
    expect((await call('/orders/CN_OTHER', { userId: 'other', discordId: other })).status).toBe(200);
    expect((await call('/orders/CN_OTHER', { userId: 'missing', discordId: '', role: 'admin' })).status).toBe(403);
  });
  it('hides another customer Quest and rejects spoofed linked IDs', async () => {
    expect((await call('/quest-service/requests/1')).status).toBe(404);
    expect((await call('/quest-service/requests/1', { discordId: other })).status).toBe(403);
    expect((await call('/quest-service/requests/1', { userId: 'other', discordId: other })).status).toBe(200);
  });
  it('rejects review writes under a stale or injected Discord identity', async () => {
    expect((await call('/products/youtube/reviews', { method: 'POST', discordId: other, body: { stars: 5, content: 'Very good service' } })).status).toBe(403);
  });
  it('does not disclose invalid warranty capability links', async () => { expect((await call('/youtube-warranty/not-a-token')).status).toBe(404); });
  it('protects every registered admin endpoint with the current DB role', () => {
    expect(adminHandlers.length).toBeGreaterThan(50);
    for (const { guard, route } of adminHandlers) {
      const next = vi.fn(); const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
      const request = { header: (name) => ({ 'x-bot-api-key': 'authorization-test-only', 'x-user-id': 'owner', 'x-user-role': 'admin' })[name] };
      guard(request, response, next);
      expect(next, route).not.toHaveBeenCalled(); expect(response.status, route).toHaveBeenCalledWith(403);
    }
  });
  it('requires MFA proof and rejects revoked versions at both bot staff boundaries', async () => {
    const guard = adminHandlers[0].guard;
    const headers = { 'x-bot-api-key': 'authorization-test-only', 'x-user-id': 'admin', 'x-session-version': '0' };
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }; const next = vi.fn();
    guard({ header: (name) => headers[name] }, response, next); expect(next).not.toHaveBeenCalled(); expect(response.status).toHaveBeenCalledWith(403);
    headers['x-admin-step-up'] = security.issueAdminStepUp('admin');
    expect((await call(`/wallet/${other}`, { userId: 'admin', role: 'admin', discordId: '111111111111111111', version: 0, proof: false })).status).toBe(403);
    expect((await call(`/wallet/${other}`, { userId: 'admin', role: 'admin', discordId: '111111111111111111', version: 0, proof: headers['x-admin-step-up'] })).status).toBe(200);
    guard({ header: (name) => headers[name] }, response, next); expect(next).toHaveBeenCalledOnce();
    next.mockClear(); security.revokeAccountSessions('admin');
    guard({ header: (name) => headers[name] }, response, next); expect(next).not.toHaveBeenCalled(); expect(response.status).toHaveBeenCalledWith(401);
    expect((await call(`/wallet/${other}`, { userId: 'admin', role: 'admin', discordId: '111111111111111111', version: 0, proof: headers['x-admin-step-up'] })).status).toBe(403);
  });
  it('requires the current session version and password for account revocation', async () => {
    expect((await call('/auth/security/revoke', { method: 'POST', body: { password: 'test-password' } })).status).toBe(401);
    expect((await call('/auth/security/revoke', { method: 'POST', body: { password: 'wrong' }, version: 0 })).status).toBe(401);
    expect((await call('/auth/security/revoke', { method: 'POST', body: { password: 'test-password' }, version: 0 })).status).toBe(200);
    expect((await call('/auth/security', { version: 0 })).status).toBe(401);
  });
  it('blocks unenrolled staff business access while keeping MFA setup reachable', async () => {
    db.prepare('UPDATE web_account_security SET mfa_secret = NULL, session_version = 0 WHERE user_id = ?').run('admin');
    const blocked = await call(`/wallet/${other}`, { userId: 'admin', role: 'admin', version: 0, proof: false });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ code: 'MFA_ENROLLMENT_REQUIRED', mfa_required: true });
    const setup = await call('/auth/security', { userId: 'admin', role: 'admin', version: 0, proof: false });
    expect(setup.status).toBe(200);
    const self = await call('/auth/user/admin', { userId: 'admin', role: 'admin', version: 0, proof: false });
    expect(self.status).toBe(200);
    const cross = await call('/auth/user/owner', { userId: 'admin', role: 'admin', version: 0, proof: false });
    expect(cross.status).toBe(403);
    db.prepare('UPDATE web_account_security SET mfa_secret = ? WHERE user_id = ?').run('test-mfa-present', 'admin');
  });
  it('rejects automatic OAuth linking by unverified email', async () => {
    const response = await call('/auth/upsert-oauth', { method: 'POST', body: { provider: 'google', googleId: 'attacker-google', email: 'owner@example.com', emailVerified: false } });
    expect(response.status).toBe(403);
    expect(db.prepare('SELECT google_id FROM web_users WHERE id = ?').get('owner').google_id).toBeNull();
  });
});

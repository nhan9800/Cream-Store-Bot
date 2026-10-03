import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let root, db, server, base, wallet;
const original = { ...process.env };
const guildId = '123456789012345678';
const otherGuildId = '222222222222222222';
const discordId = '987654321098765432';

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-admin-wallet-'));
  process.env.ENV_FILE = path.join(root, 'no-env');
  process.env.DATABASE_PATH = path.join(root, 'test.sqlite');
  process.env.BOT_API_KEY = 'admin-wallet-test-only';
  process.env.ENCRYPTION_KEY = 'admin-wallet-encryption-test-only';
  process.env.GUILD_ID = guildId;
  const database = await import('../src/database/db.js');
  db = database.db;
  database.initDatabase();
  wallet = await import('../src/services/walletService.js');
  for (const [id, role, discord] of [['admin', 'admin', null], ['staff', 'staff', null], ['buyer', 'member', discordId], ['unlinked', 'member', null]]) {
    db.prepare('INSERT INTO web_users(id, email, role, discord_id) VALUES (?, ?, ?, ?)').run(id, `${id}@example.com`, role, discord);
  }
  const app = express();
  app.use(express.json());
  const { registerBotApiRoutes } = await import('../src/services/botApiRoutes.js');
  registerBotApiRoutes(app);
  const { registerAdminRoutes } = await import('../src/services/adminApiRoutes.js');
  registerAdminRoutes(app);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/bot`;
}, 30_000);

beforeEach(() => {
  db.exec('DROP TRIGGER IF EXISTS fail_admin_wallet_ledger');
  db.exec('DELETE FROM wallet_transactions; DELETE FROM customer_profiles;');
  wallet.addWalletBalance(guildId, discordId, 150_000, 'TOPUP', 'Current wallet');
  wallet.addWalletBalance('WEB', 'buyer', 9_000, 'ADMIN_ADJUST', 'Legacy wallet');
  wallet.addWalletBalance(otherGuildId, discordId, 77_000, 'TOPUP', 'Other store');
  wallet.addWalletBalance(otherGuildId, 'buyer', 88_000, 'TOPUP', 'Other store web ID');
  wallet.addWalletBalance('WEB', 'unlinked', 4_000, 'ADMIN_ADJUST', 'Legacy unlinked wallet');
});

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db?.open) db.close();
  if (root && path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true });
  process.env = original;
});

async function call(route, { method = 'GET', body, userId = 'admin', key = 'admin-wallet-test-only' } = {}) {
  return fetch(`${base}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Bot-Api-Key': key, 'X-User-Id': userId, 'X-Discord-Id': userId === 'buyer' ? discordId : '', 'X-Session-Version': '0' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('admin wallet uses the same persisted Discord wallet as checkout', () => {
  it('lists usable balance separately from preserved legacy WEB funds', async () => {
    const response = await call('/admin/users');
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.find((user) => user.id === 'buyer')).toMatchObject({ wallet_balance: 150_000, legacy_wallet_balance: 9_000, wallet_linked: true });
    expect(data.find((user) => user.id === 'unlinked')).toMatchObject({ wallet_balance: 0, legacy_wallet_balance: 4_000, wallet_linked: false });
  });

  it('credits the checkout wallet and leaves legacy and other-store balances unchanged', async () => {
    const response = await call('/admin/users/buyer/wallet', { method: 'POST', body: { type: 'add', amount: 50_000, reason: 'Verified adjustment', discordId: '111111111111111111' } });
    expect(response.status).toBe(200);
    expect(wallet.getWalletBalance(guildId, discordId)).toBe(200_000);
    expect(wallet.getWalletBalance('WEB', 'buyer')).toBe(9_000);
    expect(wallet.getWalletBalance(otherGuildId, discordId)).toBe(77_000);
    const customer = await call(`/wallet/${discordId}`, { userId: 'buyer' });
    expect(customer.status).toBe(200);
    expect((await customer.json()).data.balance).toBe(200_000);
    expect(wallet.getWalletTransactions(guildId, discordId).find((entry) => entry.type === 'ADMIN_ADJUST')).toMatchObject({ amount: 50_000, guild_id: guildId, customer_id: discordId });
  });

  it('keeps current and legacy history explicit without exposing another store ledger', async () => {
    const response = await call('/admin/users/buyer/transactions');
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toHaveLength(2);
    expect(data).toEqual(expect.arrayContaining([
      expect.objectContaining({ guild_id: guildId, customer_id: discordId, amount: 150_000, wallet_scope: 'CURRENT' }),
      expect.objectContaining({ guild_id: 'WEB', customer_id: 'buyer', amount: 9_000, wallet_scope: 'LEGACY_WEB' }),
    ]));
    expect(data.some((entry) => entry.guild_id === otherGuildId)).toBe(false);
    const unlinked = await call('/admin/users/unlinked/transactions');
    expect((await unlinked.json()).data).toEqual([expect.objectContaining({ amount: 4_000, wallet_scope: 'LEGACY_WEB' })]);
  });

  it('rejects unlinked or unknown adjustment targets without creating disconnected wallets', async () => {
    expect((await call('/admin/users/unlinked/wallet', { method: 'POST', body: { type: 'add', amount: 10_000 } })).status).toBe(409);
    expect((await call('/admin/users/missing/wallet', { method: 'POST', body: { type: 'add', amount: 10_000 } })).status).toBe(404);
    expect((await call('/admin/users/missing/transactions')).status).toBe(404);
    expect(wallet.getWalletBalance('WEB', 'unlinked')).toBe(4_000);
    expect(db.prepare('SELECT COUNT(*) AS count FROM wallet_transactions').get().count).toBe(5);
  });

  it('rejects invalid operations, noninteger money and overdrafts with no ledger changes', async () => {
    for (const body of [
      { type: 'invalid', amount: 10_000 }, { type: 'add', amount: -10_000 },
      { type: 'add', amount: 0 }, { type: 'add', amount: 1.5 },
      { type: 'add', amount: true }, { type: 'add', amount: null },
      { type: 'add', amount: '' }, { type: 'add', amount: ' ' },
      { type: 'add', amount: Number.MAX_SAFE_INTEGER },
      { type: 'subtract', amount: 150_001 }, { type: 'set', amount: -1 },
    ]) expect((await call('/admin/users/buyer/wallet', { method: 'POST', body })).status, JSON.stringify(body)).toBe(400);
    expect(wallet.getWalletBalance(guildId, discordId)).toBe(150_000);
    expect(db.prepare('SELECT COUNT(*) AS count FROM wallet_transactions').get().count).toBe(5);
  });

  it('sets the live balance to zero and computes successive ledger changes from current funds', async () => {
    expect((await call('/admin/users/buyer/wallet', { method: 'POST', body: { type: 'subtract', amount: 50_000 } })).status).toBe(200);
    expect((await call('/admin/users/buyer/wallet', { method: 'POST', body: { type: 'set', amount: 0 } })).status).toBe(200);
    expect(wallet.getWalletBalance(guildId, discordId)).toBe(0);
    expect(wallet.getWalletTransactions(guildId, discordId).filter((entry) => entry.type === 'ADMIN_ADJUST').map((entry) => entry.amount).sort((a, b) => a - b)).toEqual([-100_000, -50_000]);
    expect(wallet.getWalletBalance('WEB', 'buyer')).toBe(9_000);
  });

  it('rolls back a balance adjustment when ledger insertion fails', async () => {
    db.exec(`CREATE TRIGGER fail_admin_wallet_ledger BEFORE INSERT ON wallet_transactions
      WHEN NEW.type = 'ADMIN_ADJUST' BEGIN SELECT RAISE(ABORT, 'test ledger failure'); END;`);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect((await call('/admin/users/buyer/wallet', { method: 'POST', body: { type: 'set', amount: 200_000 } })).status).toBe(500);
    } finally { quiet.mockRestore(); }
    expect(wallet.getWalletBalance(guildId, discordId)).toBe(150_000);
    expect(db.prepare('SELECT COUNT(*) AS count FROM wallet_transactions').get().count).toBe(5);
  });

  it('retains admin-only financial permission and the API key boundary', async () => {
    const body = { type: 'add', amount: 50_000 };
    expect((await call('/admin/users/buyer/wallet', { method: 'POST', userId: 'staff', body })).status).toBe(403);
    expect((await call('/admin/users/buyer/wallet', { method: 'POST', userId: 'buyer', body })).status).toBe(403);
    expect((await call('/admin/users/buyer/wallet', { method: 'POST', key: 'wrong', body })).status).toBe(401);
    expect(wallet.getWalletBalance(guildId, discordId)).toBe(150_000);
  });
});

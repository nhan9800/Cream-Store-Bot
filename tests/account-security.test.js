import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
let root, db, service;
const original = { ...process.env };
beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-account-security-'));
  process.env.ENV_FILE = path.join(root, 'no-env');
  process.env.DATABASE_PATH = path.join(root, 'test.sqlite');
  process.env.ENCRYPTION_KEY = 'account-security-encryption-test-only';
  process.env.BOT_API_KEY = 'account-security-signing-test-only';
  const database = await import('../src/database/db.js');
  db = database.db; database.initDatabase();
  service = await import('../src/services/accountSecurityService.js');
}, 30_000);
afterAll(() => {
  if (db?.open) db.close();
  if (root && path.dirname(root) === os.tmpdir()) fs.rmSync(root, { recursive: true, force: true });
  process.env = original;
});
function user() {
  const id = crypto.randomBytes(8).toString('hex');
  db.prepare('INSERT INTO web_users(id, email, password_hash, role) VALUES (?, ?, ?, ?)').run(id, `${id}@example.com`, service.hashAccountPassword('original-password'), 'admin');
  return db.prepare('SELECT * FROM web_users WHERE id = ?').get(id);
}
describe('account security', () => {
  it('preserves legacy sessions at version zero without exposing authentication secrets', () => {
    const row = user();
    expect(service.presentWebUser(row)).toMatchObject({ session_version: 0, mfa_enabled: false, mfa_required: false, email_verified: false });
    expect(JSON.stringify(service.presentWebUser(row))).not.toContain('password_hash');
  });
  it('allows unenrolled Admin but retains Staff enrollment and opt-in Admin MFA', () => {
    const row = user();
    expect(service.getWebStaffMfaError(row.id, '')).toBeNull();
    db.prepare('UPDATE web_users SET role = ? WHERE id = ?').run('staff', row.id);
    expect(service.getWebStaffMfaError(row.id, '')?.code).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(service.presentWebUser({ ...row, role: 'staff' }).mfa_required).toBe(true);
    db.prepare('UPDATE web_users SET role = ? WHERE id = ?').run('admin', row.id);
    db.prepare('UPDATE web_account_security SET mfa_secret = ? WHERE user_id = ?').run('test-mfa-present', row.id);
    expect(service.getWebStaffMfaError(row.id, '')?.code).toBe('MFA_REQUIRED');
    const proof = service.issueAdminStepUp(row.id);
    expect(service.getWebStaffMfaError(row.id, proof)).toBeNull();
    expect(service.presentWebUser(row).mfa_required).toBe(true);
    service.revokeAccountSessions(row.id);
    expect(service.getWebStaffMfaError(row.id, proof)?.code).toBe('MFA_REQUIRED');
  });
  it('validates RFC 6238 SHA1 test vectors', () => {
    const secret = service.encodeBase32(Buffer.from('12345678901234567890'));
    for (const [seconds, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
      expect(service.totpCode(secret, Math.floor(seconds / 30), 8)).toBe(expected);
    }
  });
  it('stores only token hashes, verifies once and rejects expired tokens', () => {
    const row = user(); const now = Date.now();
    const issued = service.issueAccountEmailToken(row.email, 'verify', now);
    expect(JSON.stringify(db.prepare('SELECT * FROM web_account_tokens WHERE user_id = ?').all(row.id))).not.toContain(issued.token);
    expect(service.consumeAccountEmailToken(issued.token, 'reset', 'new-password', now)).toBe(false);
    expect(service.consumeAccountEmailToken(issued.token, 'verify', undefined, now)).toBe(true);
    expect(service.consumeAccountEmailToken(issued.token, 'verify', undefined, now)).toBe(false);
    expect(service.presentWebUser(row).email_verified).toBe(true);
    const reset = service.issueAccountEmailToken(row.email, 'reset', now);
    expect(service.consumeAccountEmailToken(reset.token, 'reset', 'new-password', now + 16 * 60_000)).toBe(false);
  });
  it('reset tokens change the password and revoke every old session', () => {
    const row = user(); const token = service.issueAccountEmailToken(row.email, 'reset');
    expect(service.consumeAccountEmailToken(token.token, 'reset', 'new-password')).toBe(true);
    const updated = db.prepare('SELECT * FROM web_users WHERE id = ?').get(row.id);
    expect(service.verifyAccountPassword('original-password', updated.password_hash)).toBe(false);
    expect(service.verifyAccountPassword('new-password', updated.password_hash)).toBe(true);
    expect(service.getAccountSecurity(row.id).session_version).toBe(1);
    expect(service.consumeAccountEmailToken(token.token, 'reset', 'another-password')).toBe(false);
  });
  it('invalidates links after session revocation or an email change', () => {
    const row = user(); const token = service.issueAccountEmailToken(row.email, 'reset');
    service.revokeAccountSessions(row.id);
    expect(service.consumeAccountEmailToken(token.token, 'reset', 'new-password')).toBe(false);
    const next = service.issueAccountEmailToken(row.email, 'reset');
    db.prepare('UPDATE web_users SET email = ? WHERE id = ?').run('changed@example.com', row.id);
    expect(service.consumeAccountEmailToken(next.token, 'reset', 'new-password')).toBe(false);
  });
  it('encrypts MFA secrets, prevents OTP replay and consumes recovery codes once', () => {
    const row = user(); const now = Math.floor(Date.now() / 30_000) * 30_000;
    const setup = service.prepareAccountMfa(row.id, now);
    expect(service.getAccountSecurity(row.id).mfa_pending_secret).not.toContain(setup.secret);
    expect(service.confirmAccountMfa(row.id, 'invalid', now)).toBeNull();
    const code = service.totpCode(setup.secret, Math.floor(now / 30_000));
    const recovery = service.confirmAccountMfa(row.id, code, now);
    expect(recovery).toHaveLength(8);
    expect(service.verifyAccountMfa(row.id, code, now)).toBe(false);
    expect(service.verifyAccountMfa(row.id, service.totpCode(setup.secret, Math.floor(now / 30_000) + 1), now + 30_000)).toBe(true);
    expect(JSON.stringify(service.getAccountSecurity(row.id))).not.toContain(recovery[0]);
    expect(service.verifyAccountMfa(row.id, recovery[0], now)).toBe(true);
    expect(service.verifyAccountMfa(row.id, recovery[0], now)).toBe(false);
  });
  it('rejects expired MFA setup and binds step-up proof to account, version and expiry', () => {
    const row = user(); const now = Date.now();
    const setup = service.prepareAccountMfa(row.id, now);
    expect(service.confirmAccountMfa(row.id, service.totpCode(setup.secret, Math.floor((now + 11 * 60_000) / 30_000)), now + 11 * 60_000)).toBeNull();
    const activeSetup = service.prepareAccountMfa(row.id, now + 12 * 60_000);
    const activeCode = service.totpCode(activeSetup.secret, Math.floor((now + 12 * 60_000) / 30_000));
    expect(service.confirmAccountMfa(row.id, activeCode, now + 12 * 60_000)).toHaveLength(8);
    const proof = service.issueAdminStepUp(row.id, now);
    expect(service.verifyAdminStepUp(proof, row.id, now)).toBe(true);
    expect(service.verifyAdminStepUp(proof, 'another-user', now)).toBe(false);
    expect(service.verifyAdminStepUp(proof, row.id, now + 16 * 60_000)).toBe(false);
    service.revokeAccountSessions(row.id);
    expect(service.verifyAdminStepUp(proof, row.id, now)).toBe(false);
  });
});

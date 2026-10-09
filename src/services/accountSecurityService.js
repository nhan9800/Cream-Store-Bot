import crypto from 'node:crypto';
import { db } from '../database/db.js';
import { decrypt, encrypt, isEncrypted, safeEqual } from '../utils/crypto.js';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const digest = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const nowIso = () => new Date().toISOString();
const STAFF_ROLES = new Set(['admin', 'staff']);

export function isWebStaffRole(role) {
  return STAFF_ROLES.has(String(role || '').trim().toLowerCase());
}

export function hashAccountPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyAccountPassword(password, storedHash) {
  if (typeof password !== 'string' || password.length > 128) return false;
  const [salt, key] = String(storedHash || '').split(':');
  if (!/^[a-f0-9]{32}$/i.test(salt || '') || !/^[a-f0-9]{128}$/i.test(key || '')) return false;
  return safeEqual(key, crypto.scryptSync(password, salt, 64).toString('hex'));
}

export function getAccountSecurity(userId) {
  const existing = db.prepare('SELECT * FROM web_account_security WHERE user_id = ?').get(userId);
  if (existing) return existing;
  if (!db.prepare('SELECT 1 FROM web_users WHERE id = ?').get(userId)) return null;
  db.prepare('INSERT OR IGNORE INTO web_account_security(user_id) VALUES (?)').run(userId);
  return db.prepare('SELECT * FROM web_account_security WHERE user_id = ?').get(userId);
}
export function isWebAccountBanned(userId) {
  return Boolean(userId && Number(db.prepare(`SELECT is_blacklisted FROM customer_flags
    WHERE guild_id = 'WEB' AND customer_id = ?`).get(String(userId))?.is_blacklisted) === 1);
}

export function rejectBannedWebAccount(res) {
  res.set('Cache-Control', 'no-store');
  return res.status(403).json({ ok: false, code: 'ACCOUNT_BANNED', error: 'Tài khoản đã bị khóa. Liên hệ Cenar Care để được hỗ trợ.' });
}

export function presentWebUser(user) {
  if (!user) return null;
  const security = getAccountSecurity(user.id);
  return {
    id: user.id, email: user.email, display_name: user.display_name,
    discord_id: user.discord_id, discord_username: user.discord_username, discord_avatar: user.discord_avatar,
    google_id: user.google_id, google_email: user.google_email, auth_provider: user.auth_provider,
    role: user.role, created_at: user.created_at, updated_at: user.updated_at,
    session_version: security.session_version, email_verified: Boolean(security.email_verified_at),
    mfa_enabled: Boolean(security.mfa_secret),
    // Staff and Admin accounts must enroll Authenticator before using any
    // privileged commerce or administration API. Keep this flag explicit so
    // the website can route the user to the security setup screen.
    mfa_required: isWebStaffRole(user.role),
    account_banned: isWebAccountBanned(user.id),
  };
}

/**
 * Return the authoritative MFA gate for a web staff account.
 *
 * This is intentionally based on the role currently stored in SQLite rather
 * than an untrusted x-user-role header. Account setup and recovery routes call
 * this helper only after establishing the current session, so an unenrolled
 * owner can still finish setup without being locked out.
 */
export function getWebStaffMfaError(userId, proof, now = Date.now()) {
  const user = db.prepare('SELECT id, role FROM web_users WHERE id = ? LIMIT 1').get(String(userId || ''));
  if (!user || !isWebStaffRole(user.role)) return null;
  const security = getAccountSecurity(user.id);
  if (!security?.mfa_secret) {
    return {
      status: 403,
      code: 'MFA_ENROLLMENT_REQUIRED',
      mfa_required: true,
      error: 'Tài khoản Admin/Staff phải bật Authenticator trước khi sử dụng khu vực vận hành.',
    };
  }
  if (!verifyAdminStepUp(proof, user.id, now)) {
    return {
      status: 403,
      code: 'MFA_REQUIRED',
      mfa_required: true,
      error: 'Cần xác minh Authenticator để sử dụng khu vực vận hành.',
    };
  }
  return null;
}

export function revokeAccountSessions(userId) {
  getAccountSecurity(userId);
  db.prepare('UPDATE web_account_security SET session_version = session_version + 1 WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM web_account_tokens WHERE user_id = ?').run(userId);
  return getAccountSecurity(userId).session_version;
}

export function issueAccountEmailToken(email, kind, now = Date.now()) {
  if (!['verify', 'reset'].includes(kind)) throw new Error('Invalid token kind');
  const user = db.prepare('SELECT * FROM web_users WHERE email = ?').get(String(email).trim().toLowerCase());
  if (!user || (kind === 'reset' && !user.password_hash)) return null;
  const security = getAccountSecurity(user.id);
  if (kind === 'verify' && security.email_verified_at) return null;
  const recent = db.prepare('SELECT created_at FROM web_account_tokens WHERE user_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1').get(user.id, kind);
  if (recent && recent.created_at > now - 60_000) return null;
  const token = crypto.randomBytes(32).toString('base64url');
  db.transaction(() => {
    db.prepare('DELETE FROM web_account_tokens WHERE expires_at <= ? OR (user_id = ? AND kind = ?)').run(now, user.id, kind);
    db.prepare('INSERT INTO web_account_tokens(token_hash, user_id, kind, email, session_version, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(digest(token), user.id, kind, user.email, security.session_version, now + (kind === 'reset' ? 15 * 60_000 : 24 * 60 * 60_000), now);
  })();
  // Server-to-server only. Website email sender must never return this to a browser.
  return { token, email: user.email, kind };
}

export function consumeAccountEmailToken(token, kind, password, now = Date.now()) {
  if (!['verify', 'reset'].includes(kind) || !/^[A-Za-z0-9_-]{43}$/.test(String(token || ''))) return false;
  if (kind === 'reset' && (typeof password !== 'string' || password.length < 8 || password.length > 128)) return false;
  const tokenHash = digest(token);
  const passwordHash = kind === 'reset' ? hashAccountPassword(password) : null;
  return db.transaction(() => {
    const row = db.prepare(`SELECT t.*, u.email AS current_email, s.session_version AS current_version
      FROM web_account_tokens t JOIN web_users u ON u.id = t.user_id
      JOIN web_account_security s ON s.user_id = t.user_id WHERE token_hash = ? AND kind = ?`).get(tokenHash, kind);
    if (!row || row.expires_at <= now || row.email !== row.current_email || row.session_version !== row.current_version) return false;
    db.prepare('DELETE FROM web_account_tokens WHERE token_hash = ?').run(tokenHash);
    if (kind === 'verify') db.prepare('UPDATE web_account_security SET email_verified_at = ? WHERE user_id = ?').run(nowIso(), row.user_id);
    else {
      db.prepare('UPDATE web_users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, nowIso(), row.user_id);
      db.prepare('UPDATE web_account_security SET email_verified_at = ? WHERE user_id = ?').run(nowIso(), row.user_id);
      revokeAccountSessions(row.user_id);
    }
    return true;
  })();
}

export function encodeBase32(bytes) {
  let bits = 0, value = 0, result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; result += alphabet[(value >>> bits) & 31]; }
  }
  if (bits > 0) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function decodeBase32(secret) {
  if (!/^[A-Z2-7]{16,128}$/.test(secret)) throw new Error('Invalid authenticator secret');
  let bits = 0, value = 0; const bytes = [];
  for (const char of secret) {
    value = (value << 5) | alphabet.indexOf(char); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  return Buffer.from(bytes);
}
export function totpCode(secret, counter, digits = 6) {
  const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', decodeBase32(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, '0');
}
function matchingCounter(encryptedSecret, code, lastCounter = -1, now = Date.now()) {
  const secret = decrypt(encryptedSecret);
  if (!isEncrypted(encryptedSecret) || isEncrypted(secret) || !/^[0-9]{6}$/.test(String(code || ''))) return null;
  const current = Math.floor(now / 30_000);
  for (const counter of [current, current - 1, current + 1]) {
    if (counter > lastCounter && safeEqual(totpCode(secret, counter), code)) return counter;
  }
  return null;
}

export function prepareAccountMfa(userId, now = Date.now()) {
  const security = getAccountSecurity(userId);
  if (!security || security.mfa_secret) throw new Error('MFA đã được bật.');
  const secret = encodeBase32(crypto.randomBytes(20));
  db.prepare('UPDATE web_account_security SET mfa_pending_secret = ?, mfa_pending_until = ? WHERE user_id = ?').run(encrypt(secret), now + 10 * 60_000, userId);
  const user = db.prepare('SELECT email FROM web_users WHERE id = ?').get(userId);
  return { secret, uri: `otpauth://totp/${encodeURIComponent(`Cenar Store:${user.email}`)}?secret=${secret}&issuer=Cenar%20Store&algorithm=SHA1&digits=6&period=30` };
}
export function confirmAccountMfa(userId, code, now = Date.now()) {
  return db.transaction(() => {
    const security = getAccountSecurity(userId);
    if (!security?.mfa_pending_secret || security.mfa_pending_until <= now || security.mfa_secret) return null;
    const counter = matchingCounter(security.mfa_pending_secret, code, -1, now);
    if (counter === null) return null;
    const recoveryCodes = Array.from({ length: 8 }, () => crypto.randomBytes(8).toString('hex'));
    db.prepare(`UPDATE web_account_security SET mfa_secret = mfa_pending_secret, mfa_pending_secret = NULL,
      mfa_pending_until = NULL, mfa_last_counter = ?, recovery_hashes = ? WHERE user_id = ?`).run(counter, JSON.stringify(recoveryCodes.map(digest)), userId);
    revokeAccountSessions(userId);
    return recoveryCodes;
  })();
}
export function verifyAccountMfa(userId, code, now = Date.now()) {
  return db.transaction(() => {
    const security = getAccountSecurity(userId);
    if (!security?.mfa_secret) return false;
    const counter = matchingCounter(security.mfa_secret, code, security.mfa_last_counter, now);
    if (counter !== null) {
      db.prepare('UPDATE web_account_security SET mfa_last_counter = ? WHERE user_id = ?').run(counter, userId);
      return true;
    }
    if (!/^[a-f0-9]{16}$/i.test(String(code || ''))) return false;
    const hashes = JSON.parse(security.recovery_hashes);
    const hash = digest(String(code).toLowerCase());
    const index = hashes.findIndex((item) => safeEqual(item, hash));
    if (index < 0) return false;
    hashes.splice(index, 1);
    db.prepare('UPDATE web_account_security SET recovery_hashes = ? WHERE user_id = ?').run(JSON.stringify(hashes), userId);
    return true;
  })();
}
export function disableAccountMfa(userId) {
  db.transaction(() => {
    db.prepare(`UPDATE web_account_security SET mfa_secret = NULL, mfa_pending_secret = NULL,
      mfa_pending_until = NULL, mfa_last_counter = -1, recovery_hashes = '[]' WHERE user_id = ?`).run(userId);
    revokeAccountSessions(userId);
  })();
}

export function issueAdminStepUp(userId, now = Date.now()) {
  const key = String(process.env.BOT_API_KEY || '').trim();
  if (!key) throw new Error('Missing signing key');
  const security = getAccountSecurity(userId);
  if (!security?.mfa_secret) throw new Error('MFA enrollment required');
  const payload = Buffer.from(JSON.stringify({ sub: userId, version: security.session_version, exp: now + 15 * 60_000, purpose: 'admin-step-up' })).toString('base64url');
  const signature = crypto.createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
export function verifyAdminStepUp(proof, userId, now = Date.now()) {
  if (typeof proof !== 'string' || proof.length > 1024) return false;
  const [payload, signature, extra] = proof.split('.');
  const key = String(process.env.BOT_API_KEY || '').trim();
  if (!payload || !signature || extra || !key) return false;
  if (!safeEqual(signature, crypto.createHmac('sha256', key).update(payload).digest('base64url'))) return false;
  try {
    const claim = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const security = getAccountSecurity(userId);
    return Boolean(security?.mfa_secret && claim.sub === userId && claim.purpose === 'admin-step-up' && claim.exp > now && claim.exp <= now + 15 * 60_000 && claim.version === security.session_version);
  } catch { return false; }
}

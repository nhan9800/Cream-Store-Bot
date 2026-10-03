import crypto from 'node:crypto';
import { db } from '../database/db.js';
import { authLimiter, checkLoginLock, recordLoginFailure, clearLoginAttempts } from './rateLimitMiddleware.js';
import { sanitizeString, isValidEmail, errorResponse, successResponse } from '../utils/inputValidator.js';
import { safeEqual } from '../utils/crypto.js';
import {
  hashAccountPassword, verifyAccountPassword, presentWebUser, getAccountSecurity,
  revokeAccountSessions, issueAccountEmailToken, consumeAccountEmailToken,
  prepareAccountMfa, confirmAccountMfa, verifyAccountMfa, disableAccountMfa, issueAdminStepUp,
  isWebAccountBanned, rejectBannedWebAccount,
} from './accountSecurityService.js';
import { createRateLimiter } from './rateLimitMiddleware.js';

// Utils hash password
const hashPassword = hashAccountPassword;

const verifyPassword = verifyAccountPassword;
const securityLimiter = createRateLimiter({
  name: 'account-security', max: 10, windowMs: 5 * 60_000,
  keyGenerator: (req) => crypto.createHash('sha256').update(String(req.header('x-user-id') || req.body?.email || req.ip || '').toLowerCase().slice(0, 254)).digest('hex'),
});

export function registerAuthRoutes(app) {
  // Middleware xác thực API key (dùng lại hoặc định nghĩa riêng)
  function requireApiKey(req, res, next) {
    const expectedKey = process.env.BOT_API_KEY?.trim();
    if (!expectedKey) {
      return res.status(503).json({ ok: false, error: 'BOT_API_KEY chưa cấu hình' });
    }
    const providedKey = (req.header('x-bot-api-key') || req.header('X-Bot-Api-Key') || '').trim();
    if (!safeEqual(providedKey, expectedKey)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    next();
  }

  app.post('/api/bot/auth/register', requireApiKey, (req, res) => {
    try {
      const { email, password, displayName } = req.body;
      if (!email || !password) return errorResponse(res, 400, 'Thiếu email/password');
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
        return errorResponse(res, 400, 'Mật khẩu phải từ 8 đến 128 ký tự');
      }

      const emailLower = sanitizeString(email, 200).toLowerCase();
      if (!isValidEmail(emailLower)) return errorResponse(res, 400, 'Email không hợp lệ');
      
      // Check exist
      const exist = db.prepare('SELECT id FROM web_users WHERE email = ?').get(emailLower);
      if (exist) return errorResponse(res, 400, 'Email đã được đăng ký');

      const id = `user_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const hash = hashPassword(password);
      const safeName = sanitizeString(displayName || emailLower.split('@')[0], 100);
      
      db.prepare(`
        INSERT INTO web_users (id, email, password_hash, display_name, auth_provider, role)
        VALUES (?, ?, ?, ?, 'email', 'member')
      `).run(id, emailLower, hash, safeName);

      return successResponse(res, { id, email: emailLower, display_name: safeName, role: 'member' });
    } catch (e) {
      console.error('[AUTH API] Lỗi register:', e);
      return errorResponse(res, 500, 'Lỗi server');
    }
  });

  app.post('/api/bot/auth/login', requireApiKey, authLimiter, (req, res) => {
    try {
      const clientIp = `${req.ip || 'unknown'}:${crypto.createHash('sha256').update(String(req.body?.email || '').trim().toLowerCase().slice(0, 254)).digest('hex')}`;
      
      // Check if IP is locked
      const lockStatus = checkLoginLock(clientIp);
      if (lockStatus.locked) {
        return errorResponse(res, 429, `Tài khoản bị khóa tạm thời. Thử lại sau ${lockStatus.remainMin} phút.`);
      }

      const { email, password } = req.body;
      if (!email || !password) return errorResponse(res, 400, 'Thiếu email/password');
      if (typeof password !== 'string' || password.length > 128) {
        recordLoginFailure(clientIp);
        return errorResponse(res, 401, 'Sai tài khoản hoặc mật khẩu');
      }

      const emailLower = sanitizeString(email, 200).toLowerCase();
      const user = db.prepare('SELECT * FROM web_users WHERE email = ?').get(emailLower);
      
      if (!user || !user.password_hash) {
        recordLoginFailure(clientIp);
        return errorResponse(res, 401, 'Sai tài khoản hoặc mật khẩu');
      }

      if (!verifyPassword(password, user.password_hash)) {
        recordLoginFailure(clientIp);
        return errorResponse(res, 401, 'Sai tài khoản hoặc mật khẩu');
      }
      if (isWebAccountBanned(user.id)) return rejectBannedWebAccount(res);

      if (getAccountSecurity(user.id).mfa_secret && !verifyAccountMfa(user.id, req.body?.mfaCode)) {
        recordLoginFailure(clientIp);
        return errorResponse(res, 401, 'Cần mã Authenticator hoặc mã khôi phục hợp lệ.');
      }

      // Success → clear login attempts
      clearLoginAttempts(clientIp);

      const safeUser = presentWebUser(user);
      if (safeUser.mfa_enabled && ['admin', 'staff'].includes(user.role)) safeUser.admin_step_up = issueAdminStepUp(user.id);
      return successResponse(res, safeUser);
    } catch (e) {
      console.error('[AUTH API] Lỗi login:', e);
      return errorResponse(res, 500, 'Lỗi server');
    }
  });

  app.post('/api/bot/auth/upsert-oauth', requireApiKey, (req, res) => {
    try {
      const { userId, provider, email, displayName, discordId, discordUsername, discordAvatar, googleId, googleEmail, emailVerified } = req.body;
      if (!['discord', 'google'].includes(provider)) return res.status(400).json({ ok: false, error: 'Provider không hợp lệ' });
      if (userId && String(req.header('x-user-id') || '') !== String(userId)) return errorResponse(res, 403, 'Không thể liên kết tài khoản này.');

      let user = null;

      if (userId) {
        user = db.prepare('SELECT * FROM web_users WHERE id = ?').get(userId);
      }

      if (!user) {
        if (provider === 'discord' && discordId) {
          user = db.prepare('SELECT * FROM web_users WHERE discord_id = ?').get(discordId);
        } else if (provider === 'google' && googleId) {
          user = db.prepare('SELECT * FROM web_users WHERE google_id = ?').get(googleId);
        }
      }

      if (!user && email) {
        const existing = db.prepare('SELECT * FROM web_users WHERE email = ?').get(email.toLowerCase());
        if (existing && emailVerified !== true) return errorResponse(res, 403, 'Nhà cung cấp cần xác minh email trước khi liên kết.');
        user = existing;
      }
      if (user && isWebAccountBanned(user.id)) return rejectBannedWebAccount(res);

      // Xử lý xung đột tài khoản liên kết Discord
      if (user && provider === 'discord' && discordId) {
        const conflictingUser = db.prepare('SELECT * FROM web_users WHERE discord_id = ? AND id != ?')
          .get(discordId, user.id);
        
        if (conflictingUser) {
          return errorResponse(res, 409, 'Discord đã liên kết với tài khoản khác. Liên hệ Cenar Care để hợp nhất an toàn.');
        }
      }

      const now = new Date().toISOString();

      if (user) {
        // Update
        const params = [];
        let query = 'UPDATE web_users SET updated_at = ?';
        params.push(now);

        if (provider === 'discord') {
          query += ', discord_id = ?, discord_username = ?, discord_avatar = ?';
          params.push(discordId, discordUsername, discordAvatar);
        } else if (provider === 'google') {
          query += ', google_id = ?, google_email = ?';
          params.push(googleId, googleEmail);
        }

        if (displayName) {
          query += ', display_name = ?';
          params.push(displayName);
        }

        query += ' WHERE id = ?';
        params.push(user.id);

        db.prepare(query).run(...params);
        user = db.prepare('SELECT * FROM web_users WHERE id = ?').get(user.id);
      } else {
        // Insert
        const id = `user_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const finalEmail = (email || `${provider}_${discordId || googleId}@cenarstore.local`).toLowerCase();
        
        db.prepare(`
          INSERT INTO web_users (
            id, email, display_name, discord_id, discord_username, discord_avatar,
            google_id, google_email, auth_provider, role
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'member')
        `).run(
          id, finalEmail, displayName || finalEmail.split('@')[0], 
          discordId || null, discordUsername || null, discordAvatar || null,
          googleId || null, googleEmail || null, provider
        );
        user = db.prepare('SELECT * FROM web_users WHERE id = ?').get(id);
      }

      getAccountSecurity(user.id);
      if (emailVerified === true && String(email || '').toLowerCase() === user.email.toLowerCase()) {
        db.prepare('UPDATE web_account_security SET email_verified_at = ? WHERE user_id = ?').run(new Date().toISOString(), user.id);
      }
      res.json({ ok: true, data: presentWebUser(user) });
    } catch (e) {
      console.error('[AUTH API] Lỗi upsert oauth:', e);
      res.status(500).json({ ok: false, error: 'Lỗi server' });
    }
  });

  app.get('/api/bot/auth/user/:id', requireApiKey, (req, res) => {
    try {
      const callerId = String(req.header('x-user-id') || '').trim();
      const callerRole = String(req.header('x-user-role') || '').trim().toLowerCase();
      const requestedId = String(req.params.id || '').trim();
      const caller = callerId
        ? db.prepare('SELECT role FROM web_users WHERE id = ? LIMIT 1').get(callerId)
        : null;
      const currentRole = String(caller?.role || '').trim().toLowerCase();
      const isStaff = (callerRole === 'admin' || callerRole === 'staff')
        && (currentRole === 'admin' || currentRole === 'staff');
      if (!callerId || (!isStaff && callerId !== requestedId)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      const user = db.prepare('SELECT * FROM web_users WHERE id = ? OR discord_id = ?').get(requestedId, requestedId);
      if (!user) return res.status(404).json({ ok: false, error: 'Không tìm thấy user' });
      if (isWebAccountBanned(user.id)) return rejectBannedWebAccount(res);
      
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, data: presentWebUser(user) });
    } catch (e) {
      console.error('[AUTH API] Lỗi get user:', e);
      res.status(500).json({ ok: false, error: 'Lỗi server' });
    }
  });

  function requireCurrentAccount(req, res, next) {
    const userId = String(req.header('x-user-id') || '').trim();
    const user = db.prepare('SELECT * FROM web_users WHERE id = ?').get(userId);
    if (user && isWebAccountBanned(userId)) return rejectBannedWebAccount(res);
    const security = user ? getAccountSecurity(userId) : null;
    const rawVersion = String(req.header('x-session-version') || '');
    if (!security || !/^\d{1,10}$/.test(rawVersion) || Number(rawVersion) !== security.session_version) {
      return errorResponse(res, 401, 'Phiên đăng nhập đã hết hiệu lực. Vui lòng đăng nhập lại.');
    }
    req.accountUser = user;
    req.accountSecurity = security;
    res.set('Cache-Control', 'no-store');
    next();
  }
  function canManageSecurity(req) {
    const user = req.accountUser;
    if (user.password_hash) return verifyPassword(req.body?.password, user.password_hash);
    const authTime = Number(req.header('x-auth-time'));
    return Number.isFinite(authTime) && authTime > Date.now() - 15 * 60_000 && authTime <= Date.now();
  }

  app.get('/api/bot/auth/security', requireApiKey, requireCurrentAccount, (req, res) => {
    res.json({ ok: true, data: presentWebUser(req.accountUser) });
  });
  app.post('/api/bot/auth/email-token', requireApiKey, securityLimiter, (req, res) => {
    const kind = req.body?.kind;
    if (!['verify', 'reset'].includes(kind) || typeof req.body?.email !== 'string' || !isValidEmail(req.body.email)) return errorResponse(res, 400, 'Yêu cầu không hợp lệ.');
    const delivery = issueAccountEmailToken(req.body.email, kind);
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, delivery });
  });
  app.post('/api/bot/auth/email-consume', requireApiKey, securityLimiter, (req, res) => {
    if (!consumeAccountEmailToken(req.body?.token, req.body?.kind, req.body?.password)) return errorResponse(res, 400, 'Liên kết đã hết hạn hoặc đã được sử dụng.');
    return res.json({ ok: true });
  });
  app.post('/api/bot/auth/security/:action', requireApiKey, securityLimiter, requireCurrentAccount, (req, res) => {
    try {
      const { action } = req.params;
      const userId = req.accountUser.id;
      const code = String(req.body?.mfaCode || '').trim();
      if (action === 'step-up') {
        if (!verifyAccountMfa(userId, code)) return errorResponse(res, 401, 'Mã Authenticator không hợp lệ hoặc đã dùng.');
        return res.json({ ok: true, proof: issueAdminStepUp(userId) });
      }
      if (!['revoke', 'mfa-setup', 'mfa-confirm', 'mfa-disable'].includes(action)) return errorResponse(res, 404, 'Không tìm thấy thao tác.');
      if (!canManageSecurity(req)) return errorResponse(res, 401, 'Xác minh lại mật khẩu; với Google/Discord, vui lòng đăng nhập lại trong 15 phút.');
      if (action === 'mfa-confirm') {
        const recoveryCodes = confirmAccountMfa(userId, code);
        if (!recoveryCodes) return errorResponse(res, 400, 'Mã không hợp lệ hoặc thiết lập đã hết hạn.');
        return res.json({ ok: true, recoveryCodes, signInAgain: true });
      }
      if (req.accountSecurity.mfa_secret && !verifyAccountMfa(userId, code)) return errorResponse(res, 401, 'Cần mã Authenticator hoặc mã khôi phục.');
      if (action === 'mfa-setup') return res.json({ ok: true, data: prepareAccountMfa(userId) });
      if (action === 'mfa-disable') disableAccountMfa(userId);
      else revokeAccountSessions(userId);
      return res.json({ ok: true, signInAgain: true });
    } catch {
      return errorResponse(res, 400, 'Không thể cập nhật bảo mật tài khoản.');
    }
  });
}

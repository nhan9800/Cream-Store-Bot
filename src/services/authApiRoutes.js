import crypto from 'node:crypto';
import { db } from '../database/db.js';
import { authLimiter, checkLoginLock, recordLoginFailure, clearLoginAttempts } from './rateLimitMiddleware.js';
import { sanitizeString, isValidEmail, errorResponse, successResponse } from '../utils/inputValidator.js';
import { safeEqual } from '../utils/crypto.js';

// Utils hash password
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  const [salt, key] = storedHash.split(':');
  if (!salt || !key) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return safeEqual(key, hash);
}

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
      const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
      
      // Check if IP is locked
      const lockStatus = checkLoginLock(clientIp);
      if (lockStatus.locked) {
        return errorResponse(res, 429, `Tài khoản bị khóa tạm thời. Thử lại sau ${lockStatus.remainMin} phút.`);
      }

      const { email, password } = req.body;
      if (!email || !password) return errorResponse(res, 400, 'Thiếu email/password');

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

      // Success → clear login attempts
      clearLoginAttempts(clientIp);

      const { password_hash, ...safeUser } = user;
      return successResponse(res, safeUser);
    } catch (e) {
      console.error('[AUTH API] Lỗi login:', e);
      return errorResponse(res, 500, 'Lỗi server');
    }
  });

  app.post('/api/bot/auth/upsert-oauth', requireApiKey, (req, res) => {
    try {
      const { userId, provider, email, displayName, discordId, discordUsername, discordAvatar, googleId, googleEmail } = req.body;
      if (!provider) return res.status(400).json({ ok: false, error: 'Thiếu provider' });

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
        user = db.prepare('SELECT * FROM web_users WHERE email = ?').get(email.toLowerCase());
      }

      // Xử lý xung đột tài khoản liên kết Discord
      if (user && provider === 'discord' && discordId) {
        const conflictingUser = db.prepare('SELECT * FROM web_users WHERE discord_id = ? AND id != ?')
          .get(discordId, user.id);
        
        if (conflictingUser) {
          if (!conflictingUser.google_id) {
            // Xóa tài khoản chỉ có Discord để giải phóng discordId
            db.prepare('DELETE FROM web_users WHERE id = ?').run(conflictingUser.id);
          } else {
            // Gỡ liên kết khỏi tài khoản Google cũ để tránh lỗi UNIQUE
            db.prepare('UPDATE web_users SET discord_id = NULL, discord_username = NULL, discord_avatar = NULL, updated_at = ? WHERE id = ?')
              .run(new Date().toISOString(), conflictingUser.id);
          }
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

      const { password_hash, ...safeUser } = user;
      res.json({ ok: true, data: safeUser });
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
      const isStaff = callerRole === 'admin' || callerRole === 'staff';
      if (!callerId || (!isStaff && callerId !== requestedId)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      const user = db.prepare('SELECT * FROM web_users WHERE id = ? OR discord_id = ?').get(requestedId, requestedId);
      if (!user) return res.status(404).json({ ok: false, error: 'Không tìm thấy user' });
      
      const { password_hash, ...safeUser } = user;
      res.json({ ok: true, data: safeUser });
    } catch (e) {
      console.error('[AUTH API] Lỗi get user:', e);
      res.status(500).json({ ok: false, error: 'Lỗi server' });
    }
  });
}

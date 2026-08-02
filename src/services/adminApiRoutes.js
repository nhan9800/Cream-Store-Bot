import { db } from '../database/db.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  sanitizeString, sanitizePositiveInt, sanitizePagination,
  isValidRole, isValidOrderStatus, isValidServiceType,
  errorResponse, successResponse, validateRequired,
} from '../utils/inputValidator.js';
import { setBlacklistStatus } from './blacklistService.js';
import { addWalletBalance, getWalletBalance } from './walletService.js';
import { createCoupon, listCoupons, deactivateCoupon } from './couponService.js';
import * as subService from './subscriptionService.js';
import { getAiKnowledge, updateAiKnowledge } from './aiKnowledgeService.js';
import { transitionOrderStatus } from './orderStateMachine.js';
import { encrypt, decrypt } from '../utils/crypto.js';

function catalogKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export function registerAdminRoutes(app) {
  function safeEqual(a, b) {
    const bufA = Buffer.from(String(a ?? ''), 'utf8');
    const bufB = Buffer.from(String(b ?? ''), 'utf8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  function requireAdminRole(req, res, next) {
    const expectedKey = process.env.BOT_API_KEY?.trim();
    if (!expectedKey) return res.status(503).json({ ok: false, error: 'BOT_API_KEY chưa cấu hình' });

    const providedKey = (req.header('x-bot-api-key') || req.header('X-Bot-Api-Key') || '').trim();
    if (!safeEqual(providedKey, expectedKey)) return res.status(401).json({ ok: false, error: 'Unauthorized key' });

    // Cần header x-user-id từ nextjs backend gửi xuống — phải là user thật trong web_users
    const userId = req.header('x-user-id');
    if (!userId) return res.status(401).json({ ok: false, error: 'Thiếu x-user-id' });

    const user = db.prepare('SELECT role FROM web_users WHERE id = ?').get(userId);

    if (!user || (user.role !== 'admin' && user.role !== 'staff')) {
      return res.status(403).json({ ok: false, error: 'Forbidden. Cần quyền Admin hoặc Staff.' });
    }

    req.adminRole = user.role; // 'admin' or 'staff'
    next();
  }

  // ==== 1. DASHBOARD STATS ====
  app.get('/api/bot/admin/stats', requireAdminRole, (req, res) => {
    try {
      const totalOrdersRow = db.prepare('SELECT COUNT(*) as total FROM orders').get();
      const revenueRow = db.prepare("SELECT COALESCE(SUM(amount_paid), 0) AS total FROM orders WHERE payment_status = 'PAID' AND status != 'CANCELLED'").get();
      const usersRow = db.prepare('SELECT COUNT(*) as total FROM web_users').get();
      
      const botStatus = {
        online: true,
        ping: req.app.locals.discordClient?.ws?.ping || 0,
        uptime: process.uptime()
      };

      res.json({
        ok: true,
        data: {
          totalOrders: totalOrdersRow.total,
          revenue: revenueRow.total,
          totalUsers: usersRow.total,
          botStatus
        }
      });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  // ==== 1.1 REVENUE CHART ====
  app.get('/api/bot/admin/revenue-chart', requireAdminRole, (req, res) => {
    try {
      const daily = db.prepare(`
        SELECT date(created_at) AS day, COALESCE(SUM(amount_paid), 0) AS total
        FROM orders
        WHERE payment_status = 'PAID'
          AND status != 'CANCELLED'
          AND created_at >= datetime('now', '-30 days')
        GROUP BY date(created_at)
        ORDER BY day ASC
      `).all();

      const todayHourly = db.prepare(`
        SELECT strftime('%H', created_at) AS hour, COALESCE(SUM(amount_paid), 0) AS total
        FROM orders
        WHERE payment_status = 'PAID'
          AND status != 'CANCELLED'
          AND date(created_at) = date('now')
        GROUP BY strftime('%H', created_at)
        ORDER BY hour ASC
      `).all();

      res.json({
        ok: true,
        data: {
          daily,
          todayHourly
        }
      });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  // ==== 2. PRODUCTS ====
  app.get('/api/bot/admin/products', requireAdminRole, (req, res) => {
    try {
      const products = db.prepare("SELECT * FROM product_catalog WHERE guild_id = 'WEB' ORDER BY sort_order ASC, id DESC").all();
      res.json({ ok: true, data: products });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.post('/api/bot/admin/products', requireAdminRole, (req, res) => {
    try {
      const { name, description, price, duration_months, service_type, emoji, is_active, is_featured, virtual_purchase_count, sort_order, require_email, require_phone, original_price } = req.body;
      const safeName = sanitizeString(name, 180).trim();
      if (!safeName) return errorResponse(res, 400, 'Tên sản phẩm không được để trống.');
      const duplicate = db.prepare(`SELECT id FROM product_catalog WHERE guild_id = 'WEB' AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND duration_months = ? LIMIT 1`).get(safeName, Number(duration_months) || 1);
      if (duplicate) return errorResponse(res, 409, 'Sản phẩm cùng tên và thời hạn đã tồn tại.');
      const result = db.prepare(`
        INSERT INTO product_catalog (guild_id, name, description, price, duration_months, service_type, emoji, is_active, is_featured, virtual_purchase_count, sort_order, require_email, require_phone, original_price, product_key)
        VALUES ('WEB', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(safeName, sanitizeString(description, 2000), Math.max(0, Number(price) || 0), Math.max(1, Number(duration_months) || 1), sanitizeString(service_type, 40) || 'other', sanitizeString(emoji, 80) || '📦', is_active ? 1 : 0, is_featured ? 1 : 0, Math.max(0, Number(virtual_purchase_count) || 0), Number(sort_order) || 0, require_email ? 1 : 0, require_phone ? 1 : 0, Math.max(0, Number(original_price) || 0), catalogKey(safeName));
      
      res.json({ ok: true, id: result.lastInsertRowid });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.put('/api/bot/admin/products/:id', requireAdminRole, (req, res) => {
    try {
      const { name, description, price, duration_months, service_type, emoji, is_active, is_featured, virtual_purchase_count, sort_order, require_email, require_phone, original_price } = req.body;
      const safeName = sanitizeString(name, 180).trim();
      if (!safeName) return errorResponse(res, 400, 'Tên sản phẩm không được để trống.');
      const duplicate = db.prepare(`SELECT id FROM product_catalog WHERE guild_id = 'WEB' AND id != ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND duration_months = ? LIMIT 1`).get(req.params.id, safeName, Number(duration_months) || 1);
      if (duplicate) return errorResponse(res, 409, 'Sản phẩm cùng tên và thời hạn đã tồn tại.');
      db.prepare(`
        UPDATE product_catalog 
        SET name = ?, description = ?, price = ?, duration_months = ?, service_type = ?, emoji = ?, is_active = ?, is_featured = ?, virtual_purchase_count = ?, sort_order = ?, require_email = ?, require_phone = ?, original_price = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(safeName, sanitizeString(description, 2000), Math.max(0, Number(price) || 0), Math.max(1, Number(duration_months) || 1), sanitizeString(service_type, 40) || 'other', sanitizeString(emoji, 80) || '📦', is_active ? 1 : 0, is_featured ? 1 : 0, Math.max(0, Number(virtual_purchase_count) || 0), Number(sort_order) || 0, require_email ? 1 : 0, require_phone ? 1 : 0, Math.max(0, Number(original_price) || 0), req.params.id);
      
      res.json({ ok: true });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  // ==== 2.1 PRODUCT REVIEWS ====
  app.get('/api/bot/admin/reviews', requireAdminRole, (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
      const reviews = db.prepare(`
        SELECT f.*, COALESCE(u.discord_username, u.display_name, 'Khách #' || SUBSTR(f.customer_id, -4)) AS customer_name
        FROM feedbacks f
        LEFT JOIN web_users u ON u.discord_id = f.customer_id
        ORDER BY f.created_at DESC LIMIT ?
      `).all(limit);
      return res.json({ ok: true, data: reviews });
    } catch (e) {
      console.error('[ADMIN] reviews', e);
      return res.status(500).json({ ok: false, error: 'Không thể tải danh sách đánh giá.' });
    }
  });

  app.put('/api/bot/admin/reviews/:id', requireAdminRole, (req, res) => {
    try {
      const stars = Math.min(5, Math.max(1, Number(req.body?.stars) || 5));
      const content = sanitizeString(req.body?.content, 1000).trim();
      const productId = req.body?.product_id ? Number(req.body.product_id) : null;
      const isVisible = req.body?.is_visible ? 1 : 0;
      if (content.length < 3) return errorResponse(res, 400, 'Nội dung đánh giá quá ngắn.');
      const product = productId ? db.prepare('SELECT id, name FROM product_catalog WHERE id = ?').get(productId) : null;
      const result = db.prepare(`
        UPDATE feedbacks
        SET stars = ?, content = ?, product_id = ?, product_name = COALESCE(?, product_name), is_visible = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(stars, content, product?.id || null, product?.name || null, isVisible, req.params.id);
      if (!result.changes) return errorResponse(res, 404, 'Không tìm thấy đánh giá.');
      return successResponse(res, null, 'Đã cập nhật đánh giá.');
    } catch (e) {
      console.error('[ADMIN] review update', e);
      return res.status(500).json({ ok: false, error: 'Không thể cập nhật đánh giá.' });
    }
  });

  // ==== 3. ORDERS ====
  app.get('/api/bot/admin/orders', requireAdminRole, (req, res) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ?').all(limit);
      res.json({ ok: true, data: orders });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.put('/api/bot/admin/orders/:code/status', requireAdminRole, (req, res) => {
    try {
      const { status } = req.body;
      const result = transitionOrderStatus(req.params.code, status, { changedBy: req.user?.email || 'ADMIN', reason: 'Admin dashboard manual update', dbInstance: db });
      if (!result.success) {
        return res.status(400).json({ ok: false, error: result.error });
      }
      res.json({ ok: true, data: result.order });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  // ==== 4. USERS ====
  app.get('/api/bot/admin/users', requireAdminRole, (req, res) => {
    try {
      const users = db.prepare(`
        SELECT u.id, u.email, u.display_name, u.auth_provider, u.role, u.created_at, u.discord_id, u.discord_username, u.google_email,
               COALESCE(cp.wallet_balance, 0) AS wallet_balance,
               COALESCE(cf.is_blacklisted, 0) AS is_blacklisted,
               cf.blacklist_reason
        FROM web_users u
        LEFT JOIN customer_profiles cp ON u.id = cp.customer_id AND cp.guild_id = 'WEB'
        LEFT JOIN customer_flags cf ON u.id = cf.customer_id AND cf.guild_id = 'WEB'
        ORDER BY u.created_at DESC
      `).all();
      res.json({ ok: true, data: users });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.put('/api/bot/admin/users/:id/role', requireAdminRole, (req, res) => {
    try {
      if (req.adminRole !== 'admin') {
        return errorResponse(res, 403, 'Chỉ Admin mới có quyền đổi role.');
      }
      const { role } = req.body;
      if (!isValidRole(role)) return errorResponse(res, 400, 'Invalid role. Must be: admin, staff, or member');

      const userId = sanitizeString(req.params.id, 100);
      db.prepare('UPDATE web_users SET role = ? WHERE id = ?').run(role, userId);
      
      // Audit log
      try {
        db.prepare(`INSERT INTO staff_logs (guild_id, actor_id, action, detail, created_at) VALUES ('WEB', ?, 'ADMIN_ROLE_CHANGE', ?, CURRENT_TIMESTAMP)`)
          .run(req.header('x-user-id'), `Changed role of ${userId} to ${role}`);
      } catch { /* ignore audit failures */ }

      return successResponse(res, null, `Đã đổi role thành ${role}`);
    } catch (e) {
      return errorResponse(res, 500, e.message);
    }
  });

  app.post('/api/bot/admin/users/:id/ban', requireAdminRole, (req, res) => {
    try {
      if (req.adminRole !== 'admin') {
        return errorResponse(res, 403, 'Chỉ Admin mới có quyền khóa tài khoản.');
      }
      const { ban, reason } = req.body;
      const userId = sanitizeString(req.params.id, 100);
      const actorId = req.header('x-user-id');

      setBlacklistStatus('WEB', userId, ban ? 1 : 0, actorId, reason);

      // Audit log
      try {
        db.prepare(`INSERT INTO staff_logs (guild_id, actor_id, action, detail, created_at) VALUES ('WEB', ?, 'ADMIN_USER_BAN', ?, CURRENT_TIMESTAMP)`)
          .run(actorId, `${ban ? 'Banned' : 'Unbanned'} user ${userId}. Reason: ${reason || 'None'}`);
      } catch { /* ignore audit failures */ }

      return successResponse(res, null, ban ? 'Đã khóa tài khoản' : 'Đã mở khóa tài khoản');
    } catch (e) {
      return errorResponse(res, 500, e.message);
    }
  });

  app.post('/api/bot/admin/users/:id/wallet', requireAdminRole, (req, res) => {
    try {
      if (req.adminRole !== 'admin') {
        return errorResponse(res, 403, 'Chỉ Admin mới có quyền thay đổi số dư ví.');
      }
      const { amount, type, reason } = req.body;
      const userId = sanitizeString(req.params.id, 100);
      const actorId = req.header('x-user-id');

      let changeAmount;
      if (type === 'set') {
        const current = getWalletBalance('WEB', userId);
        changeAmount = amount - current;
      } else {
        changeAmount = type === 'add' ? amount : -amount;
      }
      if (changeAmount !== 0) addWalletBalance('WEB', userId, changeAmount, 'ADMIN_ADJUST', reason);

      // Audit log
      try {
        db.prepare(`INSERT INTO staff_logs (guild_id, actor_id, action, detail, created_at) VALUES ('WEB', ?, 'ADMIN_WALLET_ADJUST', ?, CURRENT_TIMESTAMP)`)
          .run(actorId, `Adjusted wallet of user ${userId} by ${changeAmount}đ. Reason: ${reason || 'None'}`);
      } catch { /* ignore audit failures */ }

      return successResponse(res, null, 'Cập nhật số dư thành công');
    } catch (e) {
      return errorResponse(res, 500, e.message);
    }
  });

  // Edit user info (display_name)
  app.put('/api/bot/admin/users/:id', requireAdminRole, (req, res) => {
    try {
      if (req.adminRole !== 'admin') {
        return errorResponse(res, 403, 'Chỉ Admin mới có quyền chỉnh sửa người dùng.');
      }
      const { displayName } = req.body;
      const userId = sanitizeString(req.params.id, 100);
      const actorId = req.header('x-user-id');
      if (userId === actorId) return errorResponse(res, 403, 'Không thể tự chỉnh sửa chính mình.');

      const updates = [];
      const params = [];
      if (displayName !== undefined) {
        updates.push('display_name = ?');
        params.push(sanitizeString(displayName, 100));
      }
      if (updates.length === 0) return errorResponse(res, 400, 'Không có thay đổi nào.');
      params.push(userId);
      db.prepare(`UPDATE web_users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
      return successResponse(res, null, 'Đã cập nhật thông tin người dùng');
    } catch (e) {
      return errorResponse(res, 500, e.message);
    }
  });

  app.post('/api/bot/admin/users', requireAdminRole, (req, res) => {
    try {
      if (req.adminRole !== 'admin') {
        return errorResponse(res, 403, 'Chỉ Admin mới có quyền tạo user.');
      }
      const { email, password, displayName, role = 'member' } = req.body;
      if (!email || !password) return errorResponse(res, 400, 'Thiếu email/password');

      const emailLower = sanitizeString(email, 200).toLowerCase();
      
      const exist = db.prepare('SELECT id FROM web_users WHERE email = ?').get(emailLower);
      if (exist) return errorResponse(res, 400, 'Email đã được đăng ký');

      // Hash password
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(password, salt, 64).toString('hex');
      const passwordHash = `${salt}:${hash}`;

      const id = `user_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const safeName = sanitizeString(displayName || emailLower.split('@')[0], 100);

      db.prepare(`
        INSERT INTO web_users (id, email, password_hash, display_name, auth_provider, role)
        VALUES (?, ?, ?, ?, 'email', ?)
      `).run(id, emailLower, passwordHash, safeName, role);

      // Create a default customer profile for wallet balance tracking
      db.prepare(`
        INSERT OR IGNORE INTO customer_profiles (guild_id, customer_id, wallet_balance)
        VALUES ('WEB', ?, 0)
      `).run(id);

      return successResponse(res, { id, email: emailLower, display_name: safeName, role });
    } catch (e) {
      console.error('[ADMIN USER CREATE]', e);
      return errorResponse(res, 500, e.message);
    }
  });

  app.delete('/api/bot/admin/users/:id', requireAdminRole, (req, res) => {
    try {
      if (req.adminRole !== 'admin') {
        return errorResponse(res, 403, 'Chỉ Admin mới có quyền xóa user.');
      }
      const userId = sanitizeString(req.params.id, 100);
      if (userId === req.header('x-user-id')) {
        return errorResponse(res, 400, 'Bạn không thể tự xóa chính mình.');
      }

      // Delete from web_users, customer_profiles, customer_flags
      db.prepare('DELETE FROM web_users WHERE id = ?').run(userId);
      db.prepare("DELETE FROM customer_profiles WHERE customer_id = ? AND guild_id = 'WEB'").run(userId);
      db.prepare("DELETE FROM customer_flags WHERE customer_id = ? AND guild_id = 'WEB'").run(userId);

      return successResponse(res, null, 'Đã xóa người dùng thành công.');
    } catch (e) {
      console.error('[ADMIN USER DELETE]', e);
      return errorResponse(res, 500, e.message);
    }
  });

  // ==== 7. COUPONS/VOUCHERS ====
  app.get('/api/bot/admin/coupons', requireAdminRole, (req, res) => {
    try {
      const coupons = listCoupons('WEB', true); // get all, including inactive
      res.json({ ok: true, data: coupons });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.post('/api/bot/admin/coupons', requireAdminRole, (req, res) => {
    try {
      const { code, type, value, minOrder, maxUses, maxPerUser, productFilter, expiresAt } = req.body;
      
      const newCoupon = createCoupon({
        guildId: 'WEB',
        code: code ? String(code).trim().toUpperCase() : null,
        type: type || 'percent',
        value: Number(value),
        minOrder: Number(minOrder || 0),
        maxUses: Number(maxUses || 0),
        maxPerUser: Number(maxPerUser || 1),
        productFilter: productFilter ? String(productFilter).trim() : null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        createdBy: req.header('x-user-id')
      });

      res.json({ ok: true, data: newCoupon });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.delete('/api/bot/admin/coupons/:code', requireAdminRole, (req, res) => {
    try {
      const code = String(req.params.code).trim().toUpperCase();
      deactivateCoupon('WEB', code);
      res.json({ ok: true });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  // ==== 5. AUDIT LOG ====
  app.get('/api/bot/admin/audit-log', requireAdminRole, (req, res) => {
    try {
      const { page, limit } = sanitizePagination(req.query.page, req.query.limit, 50);
      const offset = (page - 1) * limit;
      
      const totalRow = db.prepare('SELECT COUNT(*) as total FROM staff_logs').get();
      const logs = db.prepare('SELECT * FROM staff_logs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
      
      return successResponse(res, {
        logs,
        pagination: { page, limit, total: totalRow.total, totalPages: Math.ceil(totalRow.total / limit) }
      });
    } catch (e) {
      return errorResponse(res, 500, e.message);
    }
  });

  // ==== 6. SYSTEM HEALTH ====
  app.get('/api/bot/admin/system-health', requireAdminRole, (req, res) => {
    try {
      const memUsage = process.memoryUsage();
      const dbSizeRow = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get();
      
      return successResponse(res, {
        uptime: process.uptime(),
        memory: {
          rss: Math.round(memUsage.rss / 1024 / 1024),
          heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        },
        database: {
          sizeMB: Math.round((dbSizeRow?.size || 0) / 1024 / 1024 * 100) / 100,
        },
        node: process.version,
        platform: process.platform,
        botPing: req.app.locals.discordClient?.ws?.ping || 0,
        botStatus: req.app.locals.discordClient?.ws?.status === 0 ? 'READY' : 'CONNECTING',
      });
    } catch (e) {
      return errorResponse(res, 500, e.message);
    }
  });

  // ==== 7. GENERAL CONFIG SETTINGS ====
  app.get('/api/bot/admin/settings', requireAdminRole, (req, res) => {
    try {
      const rows = db.prepare('SELECT * FROM system_settings').all();
      const settings = {};
      rows.forEach(r => {
        settings[r.key] = r.value;
      });
      res.json({ ok: true, data: settings });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.post('/api/bot/admin/settings', requireAdminRole, (req, res) => {
    try {
      const { settings } = req.body;
      if (!settings || typeof settings !== 'object') {
        return res.status(400).json({ ok: false, error: 'Thiếu cấu hình gửi lên' });
      }

      const insertStmt = db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
      const transact = db.transaction((sets) => {
        for (const [k, v] of Object.entries(sets)) {
          insertStmt.run(k, String(v));
        }
      });
      transact(settings);

      res.json({ ok: true, message: 'Đã cập nhật cấu hình hệ thống thành công!' });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  // ==== 8. DATABASE BACKUP & OPTIMIZATION ====
  app.get('/api/bot/admin/data/backup', requireAdminRole, (req, res) => {
    try {
      const projectRoot = path.resolve(path.dirname(db.name), '..');
      const backupDir = path.resolve(projectRoot, 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const filename = `backup_${Date.now()}.sqlite`;
      const filePath = path.join(backupDir, filename);

      db.backup(filePath)
        .then(() => {
          res.download(filePath, filename);
        })
        .catch((err) => {
          console.error('[ADMIN]', err); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
        });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.get('/api/bot/admin/data/backups-list', requireAdminRole, (req, res) => {
    try {
      const projectRoot = path.resolve(path.dirname(db.name), '..');
      const backupDir = path.resolve(projectRoot, 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const files = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('backup_') && f.endsWith('.sqlite'))
        .map(f => {
          const stat = fs.statSync(path.join(backupDir, f));
          return {
            filename: f,
            sizeBytes: stat.size,
            createdAt: stat.mtime.toISOString()
          };
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      res.json({ ok: true, data: files });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.post('/api/bot/admin/data/restore', requireAdminRole, (req, res) => {
    try {
      if (req.adminRole !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Admin mới có quyền phục hồi dữ liệu.' });
      }
      const { filename } = req.body;
      if (!filename) return res.status(400).json({ ok: false, error: 'Thiếu tên file khôi phục' });

      // Chống path traversal: chỉ chấp nhận đúng định dạng file backup do hệ thống tạo ra
      const safeName = path.basename(String(filename));
      if (safeName !== filename || !/^backup_\d+\.sqlite$/.test(safeName)) {
        return res.status(400).json({ ok: false, error: 'Tên file backup không hợp lệ' });
      }

      const projectRoot = path.resolve(path.dirname(db.name), '..');
      const backupDir = path.resolve(projectRoot, 'backups');
      const filePath = path.join(backupDir, safeName);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ ok: false, error: 'Không tìm thấy file backup tương ứng' });
      }

      const srcDb = new Database(filePath);
      srcDb.backup(db.name)
        .then(() => {
          srcDb.close();
          res.json({ ok: true, message: 'Khôi phục dữ liệu thành công!' });
        })
        .catch(e => {
          srcDb.close();
          console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
        });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.post('/api/bot/admin/data/optimize', requireAdminRole, (req, res) => {
    try {
      db.exec('VACUUM');
      db.exec('ANALYZE');
      res.json({ ok: true, message: 'Tối ưu hóa dung lượng database (VACUUM/ANALYZE) thành công!' });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.post('/api/bot/admin/data/purge', requireAdminRole, (req, res) => {
    try {
      if (req.adminRole !== 'admin') {
        return res.status(403).json({ ok: false, error: 'Chỉ Admin mới có quyền dọn dẹp log.' });
      }
      const { days = 90 } = req.body;
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const resultLogs = db.prepare("DELETE FROM staff_logs WHERE created_at < ?").run(cutoffDate);
      const resultTrans = db.prepare("DELETE FROM wallet_transactions WHERE created_at < ?").run(cutoffDate);
      const resultEvents = db.prepare("DELETE FROM payment_events WHERE created_at < ?").run(cutoffDate);

      res.json({
        ok: true,
        message: `Dọn dẹp hoàn tất. Đã xóa: ${resultLogs.changes} audit logs, ${resultTrans.changes} transactions, ${resultEvents.changes} payment events.`
      });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  // ==== 9. WALLET LEDGER TRANSACTION ====
  app.get('/api/bot/admin/users/:id/transactions', requireAdminRole, (req, res) => {
    try {
      const targetUserId = sanitizeString(req.params.id, 100);
      const transactions = db.prepare('SELECT * FROM wallet_transactions WHERE customer_id = ? ORDER BY created_at DESC').all(targetUserId);
      res.json({ ok: true, data: transactions });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

// Global memory cache for Discord users to prevent hitting rate limits
const discordUserCache = new Map();
const DISCORD_USER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const fetchWithTimeout = (promise, ms) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
  ]);
};

  // ==== 10. TICKETS LIST (LIVE CHAT ADMIN) ====
  app.get('/api/bot/admin/tickets', requireAdminRole, async (req, res) => {
    try {
      // Limit to 150 to prevent crash/timeout on large database
      const tickets = db.prepare("SELECT * FROM tickets ORDER BY status ASC, created_at DESC LIMIT 150").all();
      const client = req.app.locals.discordClient;

      const mapped = await Promise.all(tickets.map(async (t) => {
        let name = t.opened_by_id || 'Khách vãng lai';
        let avatar = null;

        const webUser = db.prepare('SELECT display_name, discord_avatar FROM web_users WHERE id = ? OR discord_id = ?').get(t.customer_id, t.customer_id);
        if (webUser) {
          name = webUser.display_name;
          avatar = webUser.discord_avatar;
        } else if (t.customer_id && t.customer_id !== 'web_user' && client) {
          try {
            // Check memory cache first
            const cachedEntry = discordUserCache.get(t.customer_id);
            if (cachedEntry && (Date.now() - cachedEntry.ts < DISCORD_USER_CACHE_TTL)) {
              name = cachedEntry.name;
              avatar = cachedEntry.avatar;
            } else {
              const cached = client.users.cache.get(t.customer_id);
              if (cached) {
                name = cached.username;
                avatar = cached.displayAvatarURL();
                discordUserCache.set(t.customer_id, { name, avatar, ts: Date.now() });
              } else {
                // Fetch in parallel with 1.5s timeout to prevent hanging the API request
                const dUser = await fetchWithTimeout(client.users.fetch(t.customer_id), 1500).catch(() => null);
                if (dUser) {
                  name = dUser.username;
                  avatar = dUser.displayAvatarURL();
                  discordUserCache.set(t.customer_id, { name, avatar, ts: Date.now() });
                }
              }
            }
          } catch (e) {
            console.error(`Error resolving Discord user ${t.customer_id}:`, e.message);
          }
        }

        return {
          ...t,
          customer_name: name,
          customer_avatar: avatar
        };
      }));

      res.json({ ok: true, data: mapped });
    } catch (e) {
      console.error('[ADMIN TICKETS GET ERROR]', e);
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  // ==== 10.1 CLOSE TICKET ====
  app.post('/api/bot/admin/tickets/:code/close', requireAdminRole, async (req, res) => {
    try {
      const code = String(req.params.code || '').toUpperCase();
      const ticket = db.prepare('SELECT * FROM tickets WHERE ticket_code = ?').get(code);
      if (!ticket) return res.status(404).json({ ok: false, error: 'Không tìm thấy ticket' });

      // Cập nhật database
      db.prepare("UPDATE tickets SET status = 'CLOSED', closed_at = CURRENT_TIMESTAMP, closed_by_id = ? WHERE ticket_code = ?")
        .run(req.header('x-user-id'), code);

      // Thử đóng kênh Discord nếu có
      const client = req.app.locals.discordClient;
      if (client && ticket.channel_id && ticket.channel_id !== 'web') {
        const guild = await client.guilds.fetch(ticket.guild_id).catch(() => null);
        if (guild) {
          const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
          if (channel) {
            await channel.send('**[Hệ thống]**: Ticket đã được đóng từ Web Admin Panel. Kênh chat Discord này sẽ bị xóa sau 5 giây.').catch(() => null);
            setTimeout(async () => {
              await channel.delete('Closed from Web Admin Panel').catch(() => null);
            }, 5000);
          }
        }
      }

      res.json({ ok: true, message: 'Đã đóng ticket thành công!' });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  // ==== 11. STOCK INVENTORY CRUD ====
  app.get('/api/bot/admin/stock', requireAdminRole, (req, res) => {
    try {
      const counts = db.prepare(`
        SELECT service_type,
               SUM(CASE WHEN status = 'AVAILABLE' THEN 1 ELSE 0 END) AS available_count,
               SUM(CASE WHEN status = 'SOLD' THEN 1 ELSE 0 END) AS sold_count
        FROM account_stock
        GROUP BY service_type
      `).all();

      const stock = db.prepare('SELECT * FROM account_stock ORDER BY id DESC LIMIT 500').all()
        .map(s => ({ ...s, credentials: decrypt(s.credentials) }));
      res.json({ ok: true, data: { counts, stock } });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.post('/api/bot/admin/stock', requireAdminRole, (req, res) => {
    try {
      const { serviceType, credentials } = req.body;
      if (!serviceType || !credentials) {
        return res.status(400).json({ ok: false, error: 'Thiếu thông tin nhập kho' });
      }

      const lines = credentials.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const insertStmt = db.prepare('INSERT INTO account_stock (service_type, credentials, status) VALUES (?, ?, "AVAILABLE")');

      const transact = db.transaction((type, accounts) => {
        for (const acc of accounts) {
          insertStmt.run(type.toLowerCase(), encrypt(acc));
        }
      });
      transact(serviceType, lines);

      res.json({ ok: true, message: `Đã nhập thành công ${lines.length} tài khoản vào kho ${serviceType}.` });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.delete('/api/bot/admin/stock/:id', requireAdminRole, (req, res) => {
    try {
      db.prepare('DELETE FROM account_stock WHERE id = ?').run(req.params.id);
      res.json({ ok: true, message: 'Đã xóa tài khoản khỏi kho thành công!' });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  // ==== 12. SUBSCRIPTIONS MANAGEMENT ====
  app.get('/api/bot/admin/subscriptions', requireAdminRole, (req, res) => {
    try {
      const { serviceType, status, q } = req.query;
      let query = 'SELECT * FROM subscription_accounts WHERE 1=1';
      const params = [];
      
      if (serviceType) {
        query += ' AND service_type = ?';
        params.push(serviceType);
      }
      if (status) {
        query += ' AND status = ?';
        params.push(status);
      }
      if (q) {
        query += ' AND (gmail_email LIKE ? OR customer_discord_name LIKE ? OR customer_id LIKE ?)';
        const likeStr = `%${q}%`;
        params.push(likeStr, likeStr, likeStr);
      }
      
      query += ' ORDER BY status ASC, next_renewal_at ASC, id DESC';
      const rows = db.prepare(query).all(...params)
        .map(r => ({ ...r, gmail_password: decrypt(r.gmail_password) }));
      res.json({ ok: true, data: rows });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.post('/api/bot/admin/subscriptions', requireAdminRole, (req, res) => {
    try {
      const {
        serviceType,
        renewalMode,
        gmailEmail,
        gmailPassword,
        customerId,
        customerDiscordName,
        relatedOrderCode,
        purchaseDate,
        totalDurationMonths,
        renewalCycleMonths,
        spotifyFamilyName,
        spotifySlotsUsed,
        note
      } = req.body;

      if (!gmailEmail || !gmailPassword || !purchaseDate) {
        return res.status(400).json({ ok: false, error: 'Thiếu email, mật khẩu hoặc ngày mua' });
      }

      const newSub = subService.addSubscription({
        guildId: 'WEB',
        serviceType: serviceType || 'nitro',
        renewalMode: renewalMode || 'auto_cycle',
        gmailEmail,
        gmailPassword,
        customerId: customerId || null,
        customerDiscordName: customerDiscordName || null,
        relatedOrderCode: relatedOrderCode || null,
        purchaseDate,
        totalDurationMonths: Number(totalDurationMonths || 2),
        renewalCycleMonths: Number(renewalCycleMonths || 2),
        spotifyFamilyName: spotifyFamilyName || null,
        spotifySlotsUsed: Number(spotifySlotsUsed || 0),
        note: note || null
      });

      res.json({ ok: true, data: newSub });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.put('/api/bot/admin/subscriptions/:id', requireAdminRole, (req, res) => {
    try {
      const { id } = req.params;
      const {
        serviceType,
        renewalMode,
        gmailEmail,
        gmailPassword,
        customerId,
        customerDiscordName,
        relatedOrderCode,
        purchaseDate,
        totalDurationMonths,
        renewalCycleMonths,
        spotifyFamilyName,
        spotifySlotsUsed,
        note,
        status,
        nextRenewalAt,
        expiryAt,
        timesRenewed
      } = req.body;

      const existing = db.prepare('SELECT id FROM subscription_accounts WHERE id = ?').get(id);
      if (!existing) {
        return res.status(404).json({ ok: false, error: 'Không tìm thấy tài khoản gia hạn' });
      }

      db.prepare(`
        UPDATE subscription_accounts
        SET service_type = ?,
            renewal_mode = ?,
            gmail_email = ?,
            gmail_password = ?,
            customer_id = ?,
            customer_discord_name = ?,
            related_order_code = ?,
            purchase_date = ?,
            total_duration_months = ?,
            renewal_cycle_months = ?,
            spotify_family_name = ?,
            spotify_slots_used = ?,
            note = ?,
            status = ?,
            next_renewal_at = ?,
            expiry_at = ?,
            times_renewed = ?,
            updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
      `).run(
        serviceType || 'nitro',
        renewalMode || 'auto_cycle',
        gmailEmail,
        gmailPassword != null ? encrypt(gmailPassword) : null,
        customerId || null,
        customerDiscordName || null,
        relatedOrderCode || null,
        purchaseDate,
        Number(totalDurationMonths),
        Number(renewalCycleMonths),
        spotifyFamilyName || null,
        Number(spotifySlotsUsed || 0),
        note || null,
        status || 'ACTIVE',
        nextRenewalAt || null,
        expiryAt,
        Number(timesRenewed || 0),
        id
      );

      const updated = subService.getSubscriptionById(id);
      res.json({ ok: true, data: updated });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.post('/api/bot/admin/subscriptions/:id/renew', requireAdminRole, (req, res) => {
    try {
      const { id } = req.params;
      const renewed = subService.markRenewed(Number(id));
      if (!renewed) {
        return res.status(404).json({ ok: false, error: 'Không tìm thấy bản ghi hoặc gia hạn thất bại' });
      }
      res.json({ ok: true, data: renewed });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.delete('/api/bot/admin/subscriptions/:id', requireAdminRole, (req, res) => {
    try {
      const { id } = req.params;
      subService.deleteSubscription(Number(id));
      res.json({ ok: true, message: 'Đã xóa bản ghi gia hạn thành công!' });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  // ==== 13. AI KNOWLEDGE ====
  app.get('/api/bot/admin/ai-knowledge', requireAdminRole, (req, res) => {
    try {
      const content = getAiKnowledge('WEB');
      res.json({ ok: true, data: { content } });
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.post('/api/bot/admin/ai-knowledge', requireAdminRole, (req, res) => {
    try {
      const { content } = req.body;
      const updatedBy = req.header('x-user-id') || 'admin';
      const success = updateAiKnowledge('WEB', content || '', updatedBy);
      if (success) {
        res.json({ ok: true, message: 'Cập nhật tài liệu huấn luyện AI thành công!' });
      } else {
        res.status(500).json({ ok: false, error: 'Không thể cập nhật tài liệu huấn luyện AI' });
      }
    } catch (e) {
      console.error('[ADMIN]', e); res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });
}

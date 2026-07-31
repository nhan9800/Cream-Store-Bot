import { db } from '../database/db.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import {
  sanitizeString, sanitizePositiveInt, sanitizePagination,
  isValidRole, isValidOrderStatus, isValidServiceType,
  errorResponse, successResponse, validateRequired,
} from '../utils/inputValidator.js';
import { setBlacklistStatus } from './blacklistService.js';
import { addWalletBalance } from './walletService.js';

export function registerAdminRoutes(app) {
  function requireAdminRole(req, res, next) {
    const expectedKey = process.env.BOT_API_KEY?.trim();
    if (!expectedKey) return res.status(503).json({ ok: false, error: 'BOT_API_KEY chưa cấu hình' });
    
    const providedKey = (req.header('x-bot-api-key') || req.header('X-Bot-Api-Key') || '').trim();
    if (providedKey !== expectedKey) return res.status(401).json({ ok: false, error: 'Unauthorized key' });

    // Cần header x-user-id từ nextjs backend gửi xuống
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
      res.status(500).json({ ok: false, error: e.message });
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
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ==== 2. PRODUCTS ====
  app.get('/api/bot/admin/products', requireAdminRole, (req, res) => {
    try {
      const products = db.prepare('SELECT * FROM product_catalog ORDER BY sort_order ASC, id DESC').all();
      res.json({ ok: true, data: products });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/bot/admin/products', requireAdminRole, (req, res) => {
    try {
      const { name, description, price, duration_months, service_type, is_active, sort_order, require_email, require_phone } = req.body;
      const result = db.prepare(`
        INSERT INTO product_catalog (guild_id, name, description, price, duration_months, service_type, is_active, sort_order, require_email, require_phone)
        VALUES ('WEB', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(name, description, price, duration_months || 1, service_type || 'other', is_active ? 1 : 0, sort_order || 0, require_email ? 1 : 0, require_phone ? 1 : 0);
      
      res.json({ ok: true, id: result.lastInsertRowid });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.put('/api/bot/admin/products/:id', requireAdminRole, (req, res) => {
    try {
      const { name, description, price, duration_months, service_type, is_active, sort_order, require_email, require_phone } = req.body;
      db.prepare(`
        UPDATE product_catalog 
        SET name = ?, description = ?, price = ?, duration_months = ?, service_type = ?, is_active = ?, sort_order = ?, require_email = ?, require_phone = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name, description, price, duration_months, service_type, is_active ? 1 : 0, sort_order, require_email ? 1 : 0, require_phone ? 1 : 0, req.params.id);
      
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ==== 3. ORDERS ====
  app.get('/api/bot/admin/orders', requireAdminRole, (req, res) => {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 50;
      const offset = (page - 1) * limit;
      
      const search = req.query.search ? `%${req.query.search}%` : null;
      const statusFilter = req.query.status || 'ALL';
      const platformFilter = req.query.platform || 'ALL';

      let queryStr = 'SELECT * FROM orders WHERE 1=1';
      let countStr = 'SELECT COUNT(*) as total FROM orders WHERE 1=1';
      const params = [];

      if (search) {
        queryStr += ' AND (order_code LIKE ? OR product_name LIKE ? OR credential_email LIKE ? OR customer_id LIKE ?)';
        countStr += ' AND (order_code LIKE ? OR product_name LIKE ? OR credential_email LIKE ? OR customer_id LIKE ?)';
        params.push(search, search, search, search);
      }

      if (statusFilter !== 'ALL') {
        if (statusFilter === 'COMPLETED') {
          queryStr += " AND status = 'COMPLETED'";
          countStr += " AND status = 'COMPLETED'";
        } else if (statusFilter === 'PROCESSING') {
          queryStr += " AND (status = 'PROCESSING' OR status = 'PENDING_PAYMENT')";
          countStr += " AND (status = 'PROCESSING' OR status = 'PENDING_PAYMENT')";
        } else if (statusFilter === 'CANCELLED') {
          queryStr += " AND status = 'CANCELLED'";
          countStr += " AND status = 'CANCELLED'";
        }
      }

      if (platformFilter !== 'ALL') {
        if (platformFilter === 'WEB') {
          queryStr += " AND (guild_id = 'WEB' OR ticket_channel_id = 'WEB')";
          countStr += " AND (guild_id = 'WEB' OR ticket_channel_id = 'WEB')";
        } else if (platformFilter === 'DISCORD') {
          queryStr += " AND (guild_id != 'WEB' AND (ticket_channel_id IS NULL OR ticket_channel_id != 'WEB'))";
          countStr += " AND (guild_id != 'WEB' AND (ticket_channel_id IS NULL OR ticket_channel_id != 'WEB'))";
        }
      }

      // Count total
      const totalRow = db.prepare(countStr).get(...params);
      const total = totalRow ? totalRow.total : 0;

      // Add ordering, limit and offset
      queryStr += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      const selectParams = [...params, limit, offset];

      const orders = db.prepare(queryStr).all(...selectParams);

      res.json({
        ok: true,
        data: orders,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.put('/api/bot/admin/orders/:code/status', requireAdminRole, (req, res) => {
    try {
      const { status } = req.body;
      db.prepare('UPDATE orders SET status = ?, status_changed_at = CURRENT_TIMESTAMP WHERE order_code = ?').run(status, req.params.code);
      
      // Audit log
      try {
        db.prepare(`INSERT INTO staff_logs (guild_id, actor_id, action, detail, related_order_code, created_at) VALUES ('WEB', ?, 'ADMIN_ORDER_STATUS', ?, ?, CURRENT_TIMESTAMP)`)
          .run(req.header('x-user-id') || 'UNKNOWN', `Changed status of order ${req.params.code} to ${status}`, req.params.code);
      } catch (err) {
        console.error('[AUDIT ERROR]', err);
      }

      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
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
      res.status(500).json({ ok: false, error: e.message });
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
      
      const changeAmount = type === 'add' ? amount : -amount;
      addWalletBalance('WEB', userId, changeAmount, 'ADMIN_ADJUST', reason);

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

  // ==== 7. SYSTEM SETTINGS (Admin Only) ====
  app.get('/api/bot/admin/settings', requireAdminRole, (req, res) => {
    try {
      if (req.adminRole !== 'admin') {
        return errorResponse(res, 403, 'Chỉ Super Admin mới có quyền truy cập.');
      }

      // Return configuration values (mask sensitive ones)
      const settings = {
        BOT_TOKEN: config.botToken ? `${config.botToken.substring(0, 10)}...` : '',
        CLIENT_ID: config.clientId || '',
        GUILD_ID: config.guildId || '',
        STORE_NAME: config.storeName || '',
        PUBLIC_BASE_URL: config.publicBaseUrl || '',
        PAYOS_CLIENT_ID: config.payosClientId || '',
        PAYOS_API_KEY: config.payosApiKey ? `${config.payosApiKey.substring(0, 5)}...` : '',
        PAYOS_CHECKSUM_KEY: config.payosChecksumKey ? `${config.payosChecksumKey.substring(0, 8)}...` : '',
        PAYOS_WEBHOOK_PATH: config.payosWebhookPath || '/webhooks/payos',
        PAYOS_RETURN_PATH: config.payosReturnPath || '/payments/payos/return',
        PAYOS_CANCEL_PATH: config.payosCancelPath || '/payments/payos/cancel',
        WEBSITE_URL: process.env.WEBSITE_URL || '',
      };

      res.json({ ok: true, data: settings });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.put('/api/bot/admin/settings', requireAdminRole, (req, res) => {
    try {
      if (req.adminRole !== 'admin') {
        return errorResponse(res, 403, 'Chỉ Super Admin mới có quyền chỉnh sửa.');
      }

      const updates = req.body;
      const envPath = path.resolve(process.cwd(), '.env');
      if (!fs.existsSync(envPath)) {
        return errorResponse(res, 500, 'Không tìm thấy file .env');
      }

      let content = fs.readFileSync(envPath, 'utf8');
      let lines = content.split(/\r?\n/);

      const envToConfigMap = {
        BOT_TOKEN: 'botToken',
        CLIENT_ID: 'clientId',
        GUILD_ID: 'guildId',
        STORE_NAME: 'storeName',
        PUBLIC_BASE_URL: 'publicBaseUrl',
        PAYOS_CLIENT_ID: 'payosClientId',
        PAYOS_API_KEY: 'payosApiKey',
        PAYOS_CHECKSUM_KEY: 'payosChecksumKey',
        PAYOS_WEBHOOK_PATH: 'payosWebhookPath',
        PAYOS_RETURN_PATH: 'payosReturnPath',
        PAYOS_CANCEL_PATH: 'payosCancelPath',
        WEBSITE_URL: 'websiteUrl'
      };

      const auditDetails = [];

      for (const [key, val] of Object.entries(updates)) {
        // Skip updating if it's masked value (e.g. ends with '...')
        if (typeof val === 'string' && val.endsWith('...')) {
          continue;
        }

        let found = false;
        const linePrefix = `${key}=`;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].trim().startsWith(linePrefix)) {
            lines[i] = `${key}=${val}`;
            found = true;
            break;
          }
        }
        if (!found) {
          lines.push(`${key}=${val}`);
        }

        // Update in-memory process.env
        process.env[key] = String(val);

        // Update config object in-memory
        const configKey = envToConfigMap[key];
        if (configKey) {
          config[configKey] = val;
        }

        // Update database system_settings
        db.prepare('INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)').run(key, String(val));

        auditDetails.push(`${key} changed`);
      }

      fs.writeFileSync(envPath, lines.join('\n'), 'utf8');

      // Audit log
      try {
        db.prepare(`INSERT INTO staff_logs (guild_id, actor_id, action, detail, created_at) VALUES ('WEB', ?, 'ADMIN_SETTINGS_UPDATE', ?, CURRENT_TIMESTAMP)`)
          .run(req.header('x-user-id'), `Updated settings: ${auditDetails.join(', ')}`);
      } catch { /* ignore audit failures */ }

      res.json({ ok: true, message: 'Đã cập nhật cấu hình hệ thống thành công.' });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

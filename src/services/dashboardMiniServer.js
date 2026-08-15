import { db } from '../database/db.js';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { encrypt, decrypt } from '../utils/crypto.js';
import { applyCors } from '../utils/cors.js';
import { awardOrderPoints } from './loyaltyService.js';
import { orderLookupLimiter } from './rateLimitMiddleware.js';
import { anonymizeCustomerEmail } from '../utils/productFormatting.js';
import { config } from '../config.js';
import { getSubscriptionProgress } from './subscriptionService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function safeCount(sql, fallback = 0) {
  try {
    const row = db.prepare(sql).get();
    const value = row?.total ?? row?.count ?? fallback;
    return Number.isFinite(Number(value)) ? Number(value) : fallback;
  } catch {
    return fallback;
  }
}

function safeAll(sql, fallback = []) {
  try {
    return db.prepare(sql).all();
  } catch {
    return fallback;
  }
}

function getDashboardSnapshotRaw() {
  const totalOrders = safeCount('SELECT COUNT(*) AS total FROM orders');
  const processing = safeCount("SELECT COUNT(*) AS total FROM orders WHERE status IN ('PENDING_PAYMENT','PROCESSING')");
  const completed = safeCount("SELECT COUNT(*) AS total FROM orders WHERE status = 'COMPLETED'");
  const revenue = (() => {
    try {
      // Chỉ tính đơn đã PAID và KHÔNG bị hủy
      const row = db.prepare("SELECT COALESCE(SUM(amount_paid), 0) AS total FROM orders WHERE payment_status = 'PAID' AND status != 'CANCELLED'").get();
      return Number(row?.total ?? 0);
    } catch {
      return 0;
    }
  })();
  const expiringSoon = safeCount(`
    SELECT COUNT(*) AS total
    FROM orders
    WHERE expiry_at IS NOT NULL
      AND datetime(expiry_at) <= datetime('now', '+2 days')
      AND datetime(expiry_at) > datetime('now')
  `);

  const topCustomers = safeAll(`
    SELECT customer_id,
           COUNT(*) AS total_orders,
           COALESCE(SUM(CASE WHEN status != 'CANCELLED' THEN amount_paid ELSE 0 END), 0) AS total_spent
    FROM orders
    WHERE payment_status = 'PAID' AND status != 'CANCELLED'
    GROUP BY customer_id
    ORDER BY total_spent DESC, total_orders DESC
    LIMIT 10
  `);

  const staffKpi = safeAll(`
    SELECT actor_id,
           SUM(CASE WHEN action IN ('ORDER_COMPLETED','ORDER_COMPLETE_MANUAL','ORDER_COMPLETE_AUTO') THEN 1 ELSE 0 END) AS completed_count,
           SUM(CASE WHEN action IN ('ORDER_DELIVERED','DELIVERY_SENT') THEN 1 ELSE 0 END) AS delivered_count,
           COUNT(*) AS total_actions
    FROM staff_logs
    GROUP BY actor_id
    ORDER BY delivered_count DESC, completed_count DESC, total_actions DESC
    LIMIT 10
  `);

  return {
    totalOrders,
    processing,
    completed,
    revenue,
    expiringSoon,
    topCustomers,
    staffKpi,
    generatedAt: new Date().toISOString(),
  };
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a ?? ''), 'utf8');
  const bufB = Buffer.from(String(b ?? ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isDashboardAuthorized(req) {
  const token = String(process.env.DASHBOARD_TOKEN ?? '').trim();
  if (!token) return false;
  const provided = req.headers['x-dashboard-token'] || req.query.token;
  return safeEqual(provided, token);
}

export function registerDashboardRoutes(app) {
  // --- Helper safeCount ---
  function safeCount(sql, ...params) {
    try {
      const row = db.prepare(sql).get(...params);
      return row ? (row.count || row.total || 0) : 0;
    } catch (e) {
      return 0;
    }
  }

  // --- Public APIs for Storefront ---
  app.get('/api/public/products', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT id, guild_id, name, description, price, original_price, duration_months, service_type, emoji, is_active, sort_order
        FROM product_catalog
        WHERE is_active = 1
        ORDER BY sort_order ASC
      `).all();
      res.json({ ok: true, data: rows });
    } catch (e) {
      console.error('[PUBLIC API] Error listing products:', e);
      res.status(500).json({ ok: false, error: 'Lỗi tải danh sách sản phẩm.' });
    }
  });

  app.get('/api/public/stats', (req, res) => {
    try {
      const totalOrders = safeCount('SELECT COUNT(*) AS total FROM orders');
      const completedOrders = safeCount("SELECT COUNT(*) AS total FROM orders WHERE status = 'COMPLETED'");
      const totalCustomers = safeCount('SELECT COUNT(DISTINCT customer_id) AS total FROM orders');
      const ratingRow = db.prepare("SELECT AVG(stars) as avg_rating FROM feedbacks").get();
      const avgRating = Number(ratingRow?.avg_rating || 4.9);
      
      res.json({
        ok: true,
        data: {
          total_orders: totalOrders,
          completed_orders: completedOrders,
          total_customers: totalCustomers,
          avg_rating: avgRating
        }
      });
    } catch (e) {
      console.error('[PUBLIC API] Error getting stats:', e);
      res.status(500).json({ ok: false, error: 'Lỗi tải thống kê.' });
    }
  });

  app.get('/api/public/activity', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT order_code, product_name, total_amount, status, created_at, customer_id
        FROM orders
        WHERE status = 'COMPLETED'
        ORDER BY completed_at DESC, created_at DESC
        LIMIT 10
      `).all();

      const activity = rows.map(r => ({
        order_code: r.order_code,
        product_name: r.product_name,
        amount: r.total_amount,
        customer_name: anonymizeCustomerEmail(r.customer_id),
        timestamp: r.created_at
      }));

      res.json({ ok: true, data: activity });
    } catch (e) {
      console.error('[PUBLIC API] Error getting activity:', e);
      res.status(500).json({ ok: false, error: 'Lỗi tải hoạt động.' });
    }
  });

  app.get('/api/public/feedbacks', (req, res) => {
    try {
      const rows = db.prepare(`
        SELECT f.*, o.customer_id
        FROM feedbacks f
        LEFT JOIN orders o ON f.order_code = o.order_code
        WHERE f.stars >= 4
        ORDER BY f.id DESC
        LIMIT 10
      `).all();
      
      const mapped = rows.map(r => {
        let username = "Khách hàng Discord";
        try {
          const cl = req.app.locals.discordClient;
          if (cl && r.customer_id) {
            const dUser = cl.users.cache.get(r.customer_id);
            if (dUser) username = dUser.username;
          }
        } catch (e) {}
        return {
          id: r.id,
          order_code: r.order_code,
          stars: r.stars,
          content: r.content,
          username: username
        };
      });
      
      res.json({ ok: true, data: mapped });
    } catch (e) {
      console.error('[PUBLIC API] Error listing feedbacks:', e);
      res.status(500).json({ ok: false, error: 'Lỗi tải đánh giá.' });
    }
  });

  app.get('/api/public/orders/:code', orderLookupLimiter, (req, res) => {
    try {
      const code = String(req.params.code || '').toUpperCase();
      const order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(code);
      if (!order) return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn hàng.' });

      const isAuthenticated = Boolean(req.headers['x-bot-api-key'] && req.headers['x-bot-api-key'] === (process.env.ADMIN_TOKEN || process.env.BOT_API_KEY));
      const safe = { ...order };

      if (!isAuthenticated) {
        if (safe.credential_password) safe.credential_password = '••••••••••••';
        if (safe.credential_pin) safe.credential_pin = '••••';
        if (safe.credential_profile) safe.credential_profile = 'Protected Profile';
        if (safe.delivery_login_url) safe.delivery_login_url = 'https://cenarstore.xyz';
        if (safe.claim_notes) safe.claim_notes = 'Tài khoản được bảo mật IDOR.';
      }

      const deliveredAccount = order.credential_email ? {
        email: order.credential_email,
        password: isAuthenticated ? order.credential_password : '••••••••••••',
        warrantyCode: `BH-${order.order_code}`,
        activationLink: order.delivery_login_url || null,
        note: isAuthenticated ? (order.claim_notes || '') : 'Tài khoản được bảo vệ IDOR.'
      } : null;

      res.json({ ok: true, order: { ...safe, deliveredAccount }, data: { ...safe, deliveredAccount } });
    } catch (e) {
      console.error('[PUBLIC API] Error getting order:', e);
      res.status(500).json({ ok: false, error: 'Lỗi truy vấn đơn hàng.' });
    }
  });

  app.post('/api/public/orders', async (req, res) => {
    try {
      const { productId, discord_id, contact, note } = req.body || {};
      if (!productId) return res.status(400).json({ ok: false, error: 'Thiếu thông tin sản phẩm.' });
      if (!contact) return res.status(400).json({ ok: false, error: 'Thiếu thông tin email liên hệ.' });

      const product = db.prepare("SELECT * FROM product_catalog WHERE id = ?").get(productId);
      if (!product || !product.is_active) {
        return res.status(404).json({ ok: false, error: 'Sản phẩm không tồn tại hoặc đã ngừng bán.' });
      }

      // Forward request to internal botApiRoutes web-orders endpoint
      const botResponse = await fetch(`http://127.0.0.1:${config.httpPort}/api/bot/web-orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bot-Api-Key': process.env.BOT_API_KEY
        },
        body: JSON.stringify({
          items: [{
            id: product.id,
            name: product.name,
            price: product.price,
            duration_months: product.duration_months,
            product_name: product.name
          }],
          contact: contact,
          note: note || '',
          discord_id: discord_id || null,
          source: 'web'
        })
      });

      const botData = await botResponse.json();
      if (!botResponse.ok) {
        return res.status(botResponse.status || 400).json({ ok: false, error: botData.error || 'Lỗi từ Bot API.' });
      }

      return res.json(botData);
    } catch (e) {
      console.error('[PUBLIC API] Error creating order:', e);
      res.status(500).json({ ok: false, error: 'Lỗi máy chủ khi tạo đơn hàng.' });
    }
  });

  // Redirect root '/' and '/payment' to the official website 'https://cenarstore.xyz'
  app.get('/', (req, res) => {
    res.redirect('https://cenarstore.xyz');
  });

  app.get('/payment', (req, res) => {
    res.redirect('https://cenarstore.xyz');
  });

  const enabled = String(process.env.DASHBOARD_ENABLED ?? 'false').toLowerCase() === 'true';
  if (!enabled) return;

  app.get('/dashboard/health', (req, res) => {
    if (!isDashboardAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    return res.json({ ok: true, service: 'cream-store-dashboard' });
  });

  app.get('/dashboard/stats', (req, res) => {
    if (!isDashboardAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    return res.json({ ok: true, data: getDashboardSnapshotRaw() });
  });

  // --- Redirect Old Route ---
  app.get('/dashboard', (req, res) => {
    res.redirect('/web');
  });

  // --- Web Dashboard (Mới) ---
  // Look for the dashboard-web folder in a few possible places
  const possiblePaths = [
    path.join(process.cwd(), 'dashboard-web'),
    path.join(__dirname, 'dashboard-web'),
    path.join(process.cwd(), 'src', 'dashboard-web')
  ];
  let webPath = possiblePaths[0];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      webPath = p; break;
    }
  }

  app.use('/web', express.static(webPath));
  
  // Tránh lỗi gõ thiếu dấu /
  app.get('/web', (req, res) => {
    res.sendFile(path.join(webPath, 'index.html'), (err) => {
       if (err) res.status(404).json({ error: 'Không tìm thấy thư mục dashboard-web trên server.', pathScanned: webPath });
    });
  });

  // --- Account API cho Website (CORS allowlist) ---
  app.use('/dashboard/api', (req, res, next) => {
    if (applyCors(req, res, { headers: 'Origin, X-Requested-With, Content-Type, Accept, x-dashboard-token' })) return;

    if (req.path === '/login') {
      return next();
    }

    if (!isDashboardAuthorized(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    next();
  });

  // AI Service Classifier Helper
  function aiClassifyService(productName) {
    if (!productName) return 'other';
    const name = productName.toLowerCase();
    if (name.includes('netflix') || name.includes('nf ')) return 'netflix';
    if (name.includes('spotify') || name.includes('spoti')) return 'spotify';
    if (name.includes('youtube') || name.includes('ytb') || name.includes('yt ')) return 'youtube';
    if (name.includes('discord') || name.includes('nitro') || name.includes('dizz')) return 'discord';
    return 'other';
  }

  app.post('/dashboard/api/login', (req, res) => {
    const { password } = req.body || {};
    const validPassword = String(process.env.DASHBOARD_TOKEN ?? '').trim();
    if (!validPassword) {
      return res.status(503).json({ ok: false, error: 'Dashboard chưa cấu hình DASHBOARD_TOKEN.' });
    }
    if (safeEqual(password, validPassword)) {
      return res.json({ ok: true, token: validPassword });
    }
    return res.status(401).json({ ok: false, error: 'Sai mật khẩu!' });
  });

  app.get('/dashboard/api/accounts', (req, res) => {
    try {
      const dbAccounts = safeAll("SELECT * FROM orders ORDER BY id DESC");
      const mapped = dbAccounts.map(o => {
        let stDate = o.claimed_at || o.status_changed_at || o.created_at;
        let expDate = o.expiry_at;
        if (!expDate) {
           const start = new Date(stDate);
           start.setMonth(start.getMonth() + (o.duration_months || 1));
           expDate = start.toISOString();
        }
        return {
          id: o.order_code,
          service: aiClassifyService(o.product_name),
          productName: (o.product_name || '').replace(/<.*?>/g, '').trim(),
          email: decrypt(o.credential_email) || '',
          password: decrypt(o.credential_password) || '',
          profileName: decrypt(o.credential_profile) || '',
          pin: decrypt(o.credential_pin) || '',
          customerName: o.customer_id, // we will display ID if name is missing
          customerDiscord: o.customer_id,
          customerGmail: o.customer_gmail || '',
          spotifyOwner: o.spotify_owner || '',
          spotifyMember: o.spotify_member || '',
          discordPaymentGmail: o.discord_payment_gmail || '',
          discordRenewalCycle: o.discord_renewal_cycle || 2,
          monthsPurchased: o.duration_months || 1,
          startDate: stDate,
          expiryDate: expDate,
          createdAt: o.created_at,
          note: o.note || '',
          claimNotes: o.claim_notes || '',
          history: o.history_json ? JSON.parse(o.history_json) : []
        };
      });
      res.json({ ok: true, accounts: mapped });
    } catch (e) {
      console.error('[DASHBOARD]', e);
      res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.get('/dashboard/api/customers', async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 24;
      const offset = (page - 1) * limit;

      const totalRow = db.prepare('SELECT COUNT(*) as count FROM customer_profiles').get();
      const totalCount = totalRow.count;
      const totalPages = Math.ceil(totalCount / limit);

      const rows = db.prepare(`
        SELECT cp.*, cf.is_blacklisted, cf.warning_count 
        FROM customer_profiles cp 
        LEFT JOIN customer_flags cf ON cp.customer_id = cf.customer_id 
        ORDER BY cp.total_spent DESC 
        LIMIT ? OFFSET ?
      `).all(limit, offset);

      const results = [];
      for (const row of rows) {
        let userProfile = { username: 'Unknown User', avatar: 'https://cdn.discordapp.com/embed/avatars/0.png', tag: 'Unknown#0000' };
        try {
          const cl = req.app.locals.discordClient;
          if (cl) {
            const dUser = cl.users.cache.get(row.customer_id) || await cl.users.fetch(row.customer_id).catch(() => null);
            if (dUser) {
              userProfile.username = dUser.username;
              userProfile.tag = dUser.tag;
              userProfile.avatar = dUser.displayAvatarURL({ extension: 'png', size: 128 });
            }
          }
        } catch (e) {}
        
        // --- Fetch Recent Orders + AI mapping ---
        let recentOrders = [];
        try {
          const uOrders = db.prepare('SELECT order_code, product_name, duration_months, total_amount, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 5').all(row.customer_id);
          recentOrders = uOrders.map(uo => ({
             orderCode: uo.order_code,
             productName: uo.product_name,
             service: aiClassifyService(uo.product_name),
             months: uo.duration_months,
             amount: uo.total_amount,
             date: uo.created_at
          }));
        } catch(e) {}

        results.push({
          id: row.customer_id,
          username: userProfile.username,
          tag: userProfile.tag,
          avatar: userProfile.avatar,
          totalSpent: row.total_spent || 0,
          totalOrders: row.total_orders || 0,
          firstSeenAt: row.first_seen_at,
          lastSeenAt: row.last_seen_at,
          isBlacklisted: row.is_blacklisted || 0,
          warningCount: row.warning_count || 0,
          recentOrders: recentOrders
        });
      }

      res.json({ ok: true, data: results, pagination: { page, limit, totalCount, totalPages } });
    } catch (e) {
      console.error('[API Customers] Error:', e);
      res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.post('/dashboard/api/accounts/:id/deliver', async (req, res) => {
    try {
      const orderId = req.params.id;
      const order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(orderId);
      if (!order) return res.status(404).json({ ok: false, error: 'Đơn hàng không tồn tại' });
      if (!order.customer_id) return res.status(400).json({ ok: false, error: 'Đơn hàng không có ID Discord khách hàng' });

      const client = req.app.locals.discordClient;
      if (!client) return res.status(500).json({ ok: false, error: 'Bot chưa kết nối discordClient.' });

      let targetUser;
      try {
        targetUser = await client.users.fetch(order.customer_id);
      } catch(e) {
        return res.status(400).json({ ok: false, error: 'Không tìm thấy người dùng Discord này.' });
      }

      // Prepare Embed
      const serviceName = (order.service_type || 'Dịch Vụ').toUpperCase();
      const embed = {
        title: `Giao Hàng Thành Công: ${serviceName}`,
        description: `Cảm ơn bạn đã mua hàng. Dưới đây là thông tin tài khoản cho đơn hàng **${order.order_code}**:`,
        color: 0x9333ea,
        fields: [],
        footer: { text: 'Cenar Store - Quản Lý Tự Động' },
        timestamp: new Date().toISOString()
      };

      const _email = decrypt(order.credential_email);
      const _password = decrypt(order.credential_password);
      const _profile = decrypt(order.credential_profile);
      const _pin = decrypt(order.credential_pin);
      if (_email) embed.fields.push({ name: 'Email', value: `\`${_email}\``, inline: true });
      if (_password) embed.fields.push({ name: 'Mật Khẩu', value: `\`${_password}\``, inline: true });
      if (_profile) embed.fields.push({ name: 'Profile', value: `\`${_profile}\``, inline: true });
      if (_pin) embed.fields.push({ name: 'Mã PIN', value: `\`${_pin}\``, inline: true });
      if (order.expiry_at) embed.fields.push({ name: 'Ngày Hết Hạn', value: `<t:${Math.floor(new Date(order.expiry_at).getTime() / 1000)}:D>`, inline: false });

      await targetUser.send({ embeds: [embed] });

      // Cập nhật trạng thái history & log
      const hist = order.history_json ? JSON.parse(order.history_json) : [];
      hist.push({ date: new Date().toISOString(), action: 'Admin đã nhấn nút Giao Tài Khoản qua DM' });
      
      const nowTs = new Date();
      let newExpiry = order.expiry_at;
      if (!newExpiry) {
        newExpiry = new Date(nowTs);
        newExpiry.setMonth(newExpiry.getMonth() + (order.duration_months || 1));
        newExpiry = newExpiry.toISOString();
      }

      db.prepare("UPDATE orders SET status = 'COMPLETED', completed_at = COALESCE(completed_at, ?), expiry_at = ?, status_changed_at = ?, history_json = ? WHERE order_code = ?")
        .run(nowTs.toISOString(), newExpiry, nowTs.toISOString(), JSON.stringify(hist), orderId);

      // Tích lũy điểm khi hoàn thành đơn hàng qua Web Dashboard
      try {
        const updated = db.prepare('SELECT * FROM orders WHERE order_code = ?').get(orderId);
        if (updated && updated.guild_id !== 'WEB' && updated.customer_id !== 'WEB') {
          awardOrderPoints(updated.guild_id, updated.customer_id, updated.order_code, updated.total_amount);
        }
      } catch (e) {
        console.error('[LOYALTY] Lỗi awardOrderPoints trong Dashboard deliver-dm:', e);
      }

      // Staff Log Report
      try {
        const guildConfig = db.prepare('SELECT staff_log_channel_id FROM guild_settings WHERE guild_id = ?').get(order.guild_id);
        if (guildConfig && guildConfig.staff_log_channel_id) {
          const logChan = client.channels.cache.get(guildConfig.staff_log_channel_id);
          if (logChan) {
            logChan.send(`[Web Admin] da giao don \`${order.order_code}\` qua DM cho KH <@${order.customer_id}>.`);
          }
        }
      } catch(e){}

      return res.json({ ok: true });
    } catch(e) {
      console.error(e);
      res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  // Helper: gửi staff log
  async function sendStaffLog(client, guildId, message) {
    try {
      const gCfg = db.prepare('SELECT staff_log_channel_id FROM guild_settings WHERE guild_id = ?').get(guildId);
      if (gCfg?.staff_log_channel_id) {
        const ch = client?.channels?.cache?.get(gCfg.staff_log_channel_id);
        ch?.send(message);
      }
    } catch(e) {}
  }

  app.post('/dashboard/api/accounts', async (req, res) => {
    try {
      const data = req.body;
      const id = data.id && data.id.startsWith('CR_') ? data.id : 'CR_W_' + Math.floor(Math.random()*1000000);
      db.prepare(`
        INSERT INTO orders (
          order_code, guild_id, ticket_id, ticket_channel_id, customer_id, product_name,
          service_type, credential_email, credential_password, credential_profile, credential_pin,
          customer_name, customer_discord, customer_gmail, spotify_owner, spotify_member,
          discord_payment_gmail, discord_renewal_cycle, duration_months,
          status, expiry_at, created_at, updated_at, history_json
        ) VALUES (
          ?, 'WEB', 0, 'WEB', 'WEB', 'Web Account',
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          'COMPLETED', ?, ?, ?, ?
        )
      `).run(
        id, data.service,
        data.email != null ? encrypt(data.email) : null,
        data.password != null ? encrypt(data.password) : null,
        data.profileName != null ? encrypt(data.profileName) : null,
        data.pin != null ? encrypt(data.pin) : null,
        data.customerName, data.customerDiscord, data.customerGmail, data.spotifyOwner, data.spotifyMember,
        data.discordPaymentGmail, data.discordRenewalCycle, data.monthsPurchased,
        data.expiryDate, data.startDate || new Date().toISOString(), new Date().toISOString(),
        data.history ? JSON.stringify(data.history) : '[]'
      );
      res.json({ ok: true, id });
      // Staff Log
      const cl = req.app.locals.discordClient;
      const guilds = cl?.guilds?.cache;
      if (guilds) {
        const firstGuild = guilds.first();
        if (firstGuild) sendStaffLog(cl, firstGuild.id, `**Web Admin** vừa **THÊM** tài khoản \`${data.email}\` cho KH **${data.customerName}**`);
      }
    } catch(e) {
      console.error('[DASHBOARD]', e);
      res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.put('/dashboard/api/accounts/:id', async (req, res) => {
    try {
      const data = req.body;
      const id = req.params.id;
      db.prepare(`
        UPDATE orders SET
          service_type=?, credential_email=?, credential_password=?, credential_profile=?, credential_pin=?,
          customer_name=?, customer_discord=?, customer_gmail=?, spotify_owner=?, spotify_member=?,
          discord_payment_gmail=?, discord_renewal_cycle=?, duration_months=?,
          expiry_at=?, claimed_at=?, updated_at=?, history_json=?
        WHERE order_code=?
      `).run(
        data.service,
        data.email != null ? encrypt(data.email) : null,
        data.password != null ? encrypt(data.password) : null,
        data.profileName != null ? encrypt(data.profileName) : null,
        data.pin != null ? encrypt(data.pin) : null,
        data.customerName, data.customerDiscord, data.customerGmail, data.spotifyOwner, data.spotifyMember,
        data.discordPaymentGmail, data.discordRenewalCycle, data.monthsPurchased,
        data.expiryDate, data.startDate, new Date().toISOString(), data.history ? JSON.stringify(data.history) : '[]', id
      );
      res.json({ ok: true, id });
      // Staff Log
      const cl = req.app.locals.discordClient;
      const guilds = cl?.guilds?.cache;
      if (guilds) {
        const firstGuild = guilds.first();
        if (firstGuild) sendStaffLog(cl, firstGuild.id, `[Web Admin] **SUA** tai khoan \`${id}\` (${data.email}) cho KH **${data.customerName}**`);
      }
    } catch(e) {
      console.error('[DASHBOARD]', e);
      res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.delete('/dashboard/api/accounts/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM orders WHERE order_code=?').run(req.params.id);
      res.json({ ok: true });
      // Staff Log
      const cl = req.app.locals.discordClient;
      const guilds = cl?.guilds?.cache;
      if (guilds) {
        const firstGuild = guilds.first();
        if (firstGuild) sendStaffLog(cl, firstGuild.id, `[Web Admin] **XOA** order \`${req.params.id}\` tren he thong.`);
      }
    } catch(e) {
      console.error('[DASHBOARD]', e);
      res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  // ═══════ Subscription Accounts API ═══════

  app.get('/dashboard/api/subscriptions', (req, res) => {
    try {
      const rows = safeAll("SELECT * FROM subscription_accounts ORDER BY service_type ASC, status ASC, next_renewal_at ASC");
      const mapped = rows.map(s => ({
        id: s.id,
        serviceType: s.service_type,
        renewalMode: s.renewal_mode,
        gmail: s.gmail_email,
        password: decrypt(s.gmail_password),
        customerId: s.customer_id,
        customerName: s.customer_discord_name,
        relatedOrderCode: s.related_order_code,
        purchaseDate: s.purchase_date,
        totalDurationMonths: s.total_duration_months,
        renewalCycleMonths: s.renewal_cycle_months,
        nextRenewalAt: s.next_renewal_at,
        expiryAt: s.expiry_at,
        timesRenewed: s.times_renewed,
        spotifyFamilyName: s.spotify_family_name,
        spotifySlotsUsed: s.spotify_slots_used,
        status: s.status,
        customerResponse: s.customer_response,
        progressStatus: s.progress_status,
        progressReviewNote: s.progress_review_note,
        ...getSubscriptionProgress(s),
        note: s.note,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
      }));
      res.json({ ok: true, subscriptions: mapped });
    } catch (e) {
      console.error('[DASHBOARD]', e);
      res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.get('/dashboard/api/subscriptions/stats', (req, res) => {
    try {
      const byType = safeAll(`
        SELECT service_type, status, COUNT(*) AS total
        FROM subscription_accounts
        GROUP BY service_type, status
      `);
      const dueIn7 = safeCount(`
        SELECT COUNT(*) AS total FROM subscription_accounts
        WHERE status = 'ACTIVE'
          AND (
            (renewal_mode = 'auto_cycle' AND next_renewal_at IS NOT NULL AND datetime(next_renewal_at) <= datetime('now', '+7 days'))
            OR
            (renewal_mode IN ('one_time', 'full_paid') AND datetime(expiry_at) <= datetime('now', '+7 days'))
          )
      `);
      const totalActive = safeCount("SELECT COUNT(*) AS total FROM subscription_accounts WHERE status = 'ACTIVE'");
      const totalExpired = safeCount("SELECT COUNT(*) AS total FROM subscription_accounts WHERE status = 'EXPIRED'");

      res.json({
        ok: true,
        stats: {
          byType,
          dueIn7Days: dueIn7,
          totalActive,
          totalExpired,
          generatedAt: new Date().toISOString(),
        }
      });
    } catch (e) {
      console.error('[DASHBOARD]', e);
      res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });
  // ═══════ Revenue Chart API ═══════

  app.get('/dashboard/api/revenue-chart', (req, res) => {
    try {
      // Daily revenue for last 14 days — chỉ tính PAID + không cancelled
      const daily = safeAll(`
        SELECT date(created_at) AS day, COALESCE(SUM(amount_paid), 0) AS total
        FROM orders
        WHERE payment_status = 'PAID'
          AND status != 'CANCELLED'
          AND created_at >= datetime('now', '-14 days')
        GROUP BY date(created_at)
        ORDER BY day ASC
      `);

      // Monthly revenue for last 6 months
      const monthly = safeAll(`
        SELECT strftime('%Y-%m', created_at) AS month, COALESCE(SUM(amount_paid), 0) AS total
        FROM orders
        WHERE payment_status = 'PAID'
          AND status != 'CANCELLED'
          AND created_at >= datetime('now', '-6 months')
        GROUP BY strftime('%Y-%m', created_at)
        ORDER BY month ASC
      `);

      // Fill missing days with 0
      const filledDaily = [];
      const now = new Date();
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        const match = daily.find(r => r.day === key);
        filledDaily.push({
          label: `${d.getDate()}/${d.getMonth() + 1}`,
          date: key,
          total: match ? Number(match.total) : 0,
        });
      }

      res.json({
        ok: true,
        daily: filledDaily,
        monthly: monthly.map(m => ({
          label: m.month,
          total: Number(m.total),
        })),
      });
    } catch (e) {
      console.error('[DASHBOARD]', e);
      res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  // ═══════ Advanced API Endpoints for Premium Redesign ═══════

  app.get('/dashboard/api/system-health', (req, res) => {
    try {
      const memUsage = process.memoryUsage();
      let dbSize = 0;
      try {
        const dbSizeRow = db.prepare("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()").get();
        dbSize = dbSizeRow?.size || 0;
      } catch {}
      const client = req.app.locals.discordClient;
      res.json({
        ok: true,
        data: {
          uptime: process.uptime(),
          memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024),
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
          },
          database: {
            sizeMB: Math.round(dbSize / 1024 / 1024 * 100) / 100,
          },
          node: process.version,
          platform: process.platform,
          botPing: client?.ws?.ping || 0,
          botStatus: client?.ws?.status === 0 ? 'READY' : 'CONNECTING',
        }
      });
    } catch (e) {
      console.error('[DASHBOARD]', e);
      res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.get('/dashboard/api/audit-log', (req, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
      const offset = (page - 1) * limit;

      const totalRow = db.prepare('SELECT COUNT(*) as total FROM staff_logs').get();
      const total = totalRow?.total || 0;

      const logs = db.prepare('SELECT * FROM staff_logs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
      res.json({
        ok: true,
        data: logs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (e) {
      console.error('[DASHBOARD]', e);
      res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.get('/dashboard/api/analytics', (req, res) => {
    try {
      const totalRevenueRow = db.prepare("SELECT COALESCE(SUM(amount_paid), 0) AS total FROM orders WHERE payment_status = 'PAID' AND status != 'CANCELLED'").get();
      const totalRevenue = totalRevenueRow?.total || 0;

      const serviceStats = db.prepare(`
        SELECT service_type, COUNT(*) as count, COALESCE(SUM(amount_paid), 0) as revenue
        FROM orders
        WHERE payment_status = 'PAID' AND status != 'CANCELLED'
        GROUP BY service_type
      `).all();

      const topSpenders = db.prepare(`
        SELECT customer_id, COUNT(*) as count, COALESCE(SUM(amount_paid), 0) as total_spent
        FROM orders
        WHERE payment_status = 'PAID' AND status != 'CANCELLED'
        GROUP BY customer_id
        ORDER BY total_spent DESC
        LIMIT 5
      `).all();

      res.json({
        ok: true,
        data: {
          totalRevenue,
          serviceStats,
          topSpenders
        }
      });
    } catch (e) {
      console.error('[DASHBOARD]', e);
      res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });

  app.post('/dashboard/api/accounts/:id/renew', (req, res) => {
    try {
      const orderCode = req.params.id;
      const { months } = req.body;
      const monthsNum = parseInt(months) || 1;

      const order = db.prepare("SELECT * FROM orders WHERE order_code = ?").get(orderCode);
      if (!order) {
        return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn hàng' });
      }

      const now = new Date();
      let currentExpiry = order.expiry_at ? new Date(order.expiry_at) : new Date();
      let newStart = currentExpiry > now ? currentExpiry : now;
      let newExpiry = new Date(newStart);
      newExpiry.setMonth(newExpiry.getMonth() + monthsNum);

      const hist = order.history_json ? JSON.parse(order.history_json) : [];
      hist.push({
        id: 'CR_W_' + Math.floor(Math.random()*1000000),
        type: 'renewal',
        date: now.toISOString(),
        months: monthsNum,
        startDate: newStart.toISOString(),
        expiryDate: newExpiry.toISOString(),
        accountEmail: decrypt(order.credential_email) || ''
      });

      db.prepare(`
        UPDATE orders 
        SET expiry_at = ?, duration_months = ?, updated_at = ?, history_json = ? 
        WHERE order_code = ?
      `).run(newExpiry.toISOString(), monthsNum, now.toISOString(), JSON.stringify(hist), orderCode);

      // Staff Log
      const cl = req.app.locals.discordClient;
      const guilds = cl?.guilds?.cache;
      if (guilds) {
        const firstGuild = guilds.first();
        if (firstGuild) sendStaffLog(cl, firstGuild.id, `**Web Admin** vừa **GIA HẠN** đơn \`${orderCode}\` thêm **${monthsNum} tháng**`);
      }

      res.json({ ok: true, expiryDate: newExpiry.toISOString() });
    } catch (e) {
      console.error('[DASHBOARD]', e);
      res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
    }
  });


}

// ═══════ WebSocket Broadcast ═══════

const wsClients = new Set();

export function registerWebSocketUpgrade(server) {
  if (!server) return;

  server.on('upgrade', (request, socket, head) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(request.url, 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }
    if (parsedUrl.pathname !== '/ws/dashboard') {
      socket.destroy();
      return;
    }

    // Auth: yêu cầu token hợp lệ qua query (?token=) hoặc header
    const token = String(process.env.DASHBOARD_TOKEN ?? '').trim();
    if (!token) { socket.destroy(); return; }
    const provided = parsedUrl.searchParams.get('token')
      || request.headers['x-dashboard-token'];
    if (!safeEqual(provided, token)) { socket.destroy(); return; }

    // Simple WebSocket handshake
    const key = request.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }

    const accept = crypto
      .createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-5AB5DC76B45B')
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );

    // Wrap socket for WS frames
    const client = { socket, alive: true };
    wsClients.add(client);

    socket.on('data', () => { client.alive = true; });
    socket.on('close', () => { wsClients.delete(client); });
    socket.on('error', () => { wsClients.delete(client); });
  });

  // Ping interval to keep connections alive
  setInterval(() => {
    for (const client of wsClients) {
      if (!client.alive) {
        client.socket.destroy();
        wsClients.delete(client);
        continue;
      }
      client.alive = false;
      try {
        // Send ping frame
        const pingFrame = Buffer.alloc(2);
        pingFrame[0] = 0x89; // ping opcode
        pingFrame[1] = 0x00; // no payload
        client.socket.write(pingFrame);
      } catch { wsClients.delete(client); }
    }
  }, 30000);

  console.log('[WS] WebSocket upgrade handler registered for /ws/dashboard');
}

/**
 * Broadcast a message to all connected WebSocket clients
 */
export function broadcastDashboardEvent(type, message = '') {
  const payload = JSON.stringify({ type, message, timestamp: Date.now() });
  const buf = Buffer.from(payload, 'utf-8');
  
  // Create WS text frame
  let frame;
  if (buf.length < 126) {
    frame = Buffer.alloc(2 + buf.length);
    frame[0] = 0x81; // FIN + text opcode
    frame[1] = buf.length;
    buf.copy(frame, 2);
  } else if (buf.length < 65536) {
    frame = Buffer.alloc(4 + buf.length);
    frame[0] = 0x81;
    frame[1] = 126;
    frame.writeUInt16BE(buf.length, 2);
    buf.copy(frame, 4);
  } else {
    frame = Buffer.alloc(10 + buf.length);
    frame[0] = 0x81;
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(buf.length), 2);
    buf.copy(frame, 10);
  }

  for (const client of wsClients) {
    try { client.socket.write(frame); } catch { wsClients.delete(client); }
  }
}

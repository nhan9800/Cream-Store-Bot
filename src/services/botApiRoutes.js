/**
 * ╔══════════════════════════════════════════════════════╗
 * ║       Bot API Routes — Read-only API cho web         ║
 * ║                                                      ║
 * ║  Cho phép Cenar Store (web) đọc data từ bot:         ║
 * ║   - Đơn hàng theo customer_id Discord                 ║
 * ║   - Profile khách + spending stats                   ║
 * ║   - Feedback, transactions                           ║
 * ║                                                      ║
 * ║  Auth: Header `X-Bot-Api-Key` phải khớp .env         ║
 * ║  Endpoint base: /api/bot/*                           ║
 * ╚══════════════════════════════════════════════════════╝
 */

import { db, nowIso } from '../database/db.js';
import { config } from '../config.js';
import { getAiKnowledge } from './aiKnowledgeService.js';
import { applyCors } from '../utils/cors.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { safeEqual } from '../utils/crypto.js';
import { runtimeCommitSha } from '../utils/revision.js';

let storeInviteCache = { url: '', expiresAt: 0 };

async function resolveStoreOneInvite(client, configuredUrl) {
    const explicit = String(configuredUrl || process.env.DISCORD_INVITE_URL || '').trim();
    if (/^https:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]+/i.test(explicit)) return explicit;
    if (storeInviteCache.url && storeInviteCache.expiresAt > Date.now()) return storeInviteCache.url;

    const cachedGuild = client?.guilds?.cache?.get(config.guildId);
    const fetchedGuild = !cachedGuild && client?.guilds?.fetch
        ? await client.guilds.fetch(config.guildId).catch(() => null)
        : null;
    const guild = cachedGuild || fetchedGuild;
    if (!guild) return '';

    const vanity = guild.vanityURLCode
        || (guild.fetchVanityData
            ? (await guild.fetchVanityData().catch(() => null))?.code
            : null);
    if (vanity) {
        storeInviteCache = { url: `https://discord.gg/${vanity}`, expiresAt: Date.now() + 15 * 60_000 };
        return storeInviteCache.url;
    }

    const invites = guild.invites?.fetch
        ? await guild.invites.fetch().catch(() => null)
        : null;
    const existing = invites
        ? [...invites.values()]
            .filter((invite) => !invite.temporary && (!invite.maxAge || invite.maxAge === 0) && (!invite.maxUses || invite.maxUses === 0))
            .sort((left, right) => Number(right.uses || 0) - Number(left.uses || 0))[0]
        : null;
    if (existing?.url) {
        storeInviteCache = { url: existing.url, expiresAt: Date.now() + 15 * 60_000 };
        return existing.url;
    }
    return '';
}

/**
 * Middleware xác thực API key
 */
function requireApiKey(req, res, next) {
    const expectedKey = process.env.BOT_API_KEY?.trim();
    if (!expectedKey) {
        return res.status(503).json({
            ok: false,
            error: 'BOT_API_KEY chưa cấu hình trong .env',
        });
    }

    const providedKey = (req.header('x-bot-api-key') || req.header('X-Bot-Api-Key') || '').trim();
    if (!safeEqual(providedKey, expectedKey)) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    next();
}

function canAccessCustomerResource(req, customerId) {
    const role = String(req.header('x-user-role') || '').trim().toLowerCase();
    if (role === 'admin' || role === 'staff') return true;
    const discordId = String(req.header('x-discord-id') || '').trim();
    return Boolean(discordId && customerId && discordId === String(customerId));
}

/**
 * Helper: chạy SQL an toàn, trả {ok, data} hoặc {ok:false, error}
 */
function safeQuery(fn) {
    try {
        const data = fn();
        return { ok: true, data };
    } catch (e) {
        console.error('[BOT_API] DB error:', e);
        return { ok: false, error: 'Lỗi máy chủ nội bộ.' };
    }
}

/**
 * Register all /api/bot/* routes lên app Express
 */
export function registerBotApiRoutes(app) {
    // CORS — allowlist (server-to-server callers không gửi Origin nên không bị chặn)
    const corsHandler = (req, res, next) => {
        if (applyCors(req, res, { methods: 'GET, POST, OPTIONS', headers: 'Content-Type, X-Bot-Api-Key, x-bot-api-key' })) return;
        next();
    };

    // ── HEALTH (PUBLIC & BOT) ───────────────────────────────────
    app.get(['/api/health', '/api/bot/health'], (req, res) => {
        const discordReady = Boolean(req.app.locals.discordClient?.isReady?.());
        res.set('Cache-Control', 'no-store');
        res.status(discordReady ? 200 : 503).json({
            ok: discordReady,
            service: 'cenar-store-bot',
            commitSha: runtimeCommitSha,
            discordReady,
            uptime: Math.floor(process.uptime()),
            timestamp: Date.now(),
        });
    });

    // Tất cả route /api/bot/* require API key
    app.use('/api/bot', corsHandler, requireApiKey);

    // ── PUBLIC SETTINGS ──────────────────────────────────────────
    app.get('/api/bot/settings', async (req, res) => {
        const result = safeQuery(() => {
            const rows = db.prepare('SELECT * FROM system_settings').all();
            const settings = {};
            rows.forEach(r => {
                if ([
                  'shop_name', 'shop_description', 'hotline', 
                  'discord_link', 'facebook_link', 'support_email', 
                  'maintenance_mode'
                ].includes(r.key)) {
                    settings[r.key] = r.value;
                }
            });
            return settings;
        });
        if (result.ok) {
            const client = req.app.locals.discordClient;
            const guild = client?.guilds?.cache?.get(config.guildId);
            result.data.discord_link = await resolveStoreOneInvite(client, result.data.discord_link);
            result.data.guild_id = config.guildId;
            result.data.guild_name = guild?.name || config.storeName || 'Cenar Store';
            result.data.store = 'STORE_1';
        }
        res.json(result);
    });

    // ── AI KNOWLEDGE (read-only) — web AI chat đọc tài liệu huấn luyện ──
    app.get('/api/bot/ai-knowledge', (req, res) => {
        const result = safeQuery(() => ({ content: getAiKnowledge('WEB') }));
        res.json(result);
    });

    // ── STATS — số liệu tổng để hiển thị web admin ────────────
    app.get('/api/bot/stats', (req, res) => {
        const result = safeQuery(() => {
            const stats = {
                total_orders: db.prepare("SELECT COUNT(*) as c FROM orders").get()?.c ?? 0,
                completed_orders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'COMPLETED'").get()?.c ?? 0,
                pending_orders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status IN ('PENDING_PAYMENT', 'PROCESSING')").get()?.c ?? 0,
                cancelled_orders: db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'CANCELLED'").get()?.c ?? 0,
                // Doanh thu: chỉ tính đơn đã PAID + không bị hủy
                total_revenue: db.prepare("SELECT COALESCE(SUM(amount_paid), 0) as s FROM orders WHERE payment_status = 'PAID' AND status != 'CANCELLED'").get()?.s ?? 0,
                total_customers: db.prepare("SELECT COUNT(DISTINCT customer_id) as c FROM customer_profiles").get()?.c ?? 0,
                total_feedbacks: db.prepare("SELECT COUNT(*) as c FROM feedbacks").get()?.c ?? 0,
                avg_rating: db.prepare("SELECT ROUND(AVG(stars), 2) as r FROM feedbacks").get()?.r ?? null,
                today_orders: db.prepare(`
                    SELECT COUNT(*) as c FROM orders
                    WHERE date(created_at) = date('now', 'localtime')
                `).get()?.c ?? 0,
                today_revenue: db.prepare(`
                    SELECT COALESCE(SUM(amount_paid), 0) as s FROM orders
                    WHERE payment_status = 'PAID'
                      AND status != 'CANCELLED'
                      AND date(paid_at) = date('now', 'localtime')
                `).get()?.s ?? 0,
            };
            return stats;
        });
        res.json(result);
    });

    // ── ORDERS — lọc theo customer hoặc all ───────────────────
    app.get('/api/bot/orders', (req, res) => {
        const { customer_id, status, limit = 50, offset = 0 } = req.query;
        const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
        const off = Math.max(0, parseInt(offset, 10) || 0);

        const result = safeQuery(() => {
            let sql = `
                SELECT
                    order_code, guild_id, customer_id, product_name, quantity,
                    total_amount, amount_paid, payment_provider, payment_status,
                    payment_code, status, status_changed_at,
                    duration_months, expiry_at,
                    paid_at, completed_at, delivered_at, created_at, updated_at
                FROM orders
                WHERE 1=1
            `;
            const params = {};
            if (customer_id) { sql += ` AND customer_id = @customer_id`; params.customer_id = String(customer_id); }
            if (status) { sql += ` AND status = @status`; params.status = String(status).toUpperCase(); }
            sql += ` ORDER BY created_at DESC LIMIT @lim OFFSET @off`;
            params.lim = lim;
            params.off = off;
            const rows = db.prepare(sql).all(params);

            // Total count cho pagination
            let countSql = `SELECT COUNT(*) as c FROM orders WHERE 1=1`;
            const countParams = {};
            if (customer_id) { countSql += ` AND customer_id = @customer_id`; countParams.customer_id = String(customer_id); }
            if (status) { countSql += ` AND status = @status`; countParams.status = String(status).toUpperCase(); }
            const total = db.prepare(countSql).get(countParams)?.c ?? 0;

            return { rows, total, limit: lim, offset: off };
        });
        res.json(result);
    });

    // ── ORDER DETAIL — 1 đơn cụ thể ───────────────────────────
    app.get('/api/bot/orders/:code', async (req, res) => {
        const code = String(req.params.code || '').toUpperCase();
        let order;
        try {
            order = db.prepare(`SELECT * FROM orders WHERE order_code = ?`).get(code);
        } catch (e) {
            return res.json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
        }
        if (!order) return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn' });

        const safe = { ...order };

        // Tạo QR on-the-fly cho đơn cũ chưa có payment_qr_code
        if (!safe.payment_qr_code && safe.status === 'PENDING_PAYMENT' && safe.guild_id) {
            try {
                const { getGuildConfig } = await import('./guildConfigService.js');
                const guildCfg = getGuildConfig(safe.guild_id);
                let bankBin = config.vietqrBankBin || '970418';
                let accountNo = config.vietqrAccountNo || '';
                let accountName = config.vietqrAccountName || 'CREAM STORE';
                
                if (guildCfg?.bank_bin && guildCfg?.bank_account_no) {
                    bankBin = guildCfg.bank_bin;
                    accountNo = guildCfg.bank_account_no;
                    accountName = guildCfg.bank_account_name || 'CREAM STORE';
                }
                
                if (accountNo) {
                    const content = safe.payment_code || safe.order_code;
                    const qrUrl = `https://img.vietqr.io/image/${bankBin}-${accountNo}-compact2.png?amount=${safe.total_amount}&addInfo=${encodeURIComponent(content)}&accountName=${encodeURIComponent(accountName)}`;
                    safe.payment_qr_code = qrUrl;
                    const { savePaymentLinkData } = await import('./orderService.js');
                    savePaymentLinkData(safe.order_code, { paymentLinkId: null, checkoutUrl: null, qrCode: qrUrl, qrUrl });
                }
            } catch (_) {}
        }

        res.json({ ok: true, data: safe });
    });

    // ── CUSTOMER PROFILE — info + spending stats ──────────────
    app.get('/api/bot/customer/:discord_id', (req, res) => {
        const discordId = String(req.params.discord_id || '').trim();
        if (!discordId) return res.status(400).json({ ok: false, error: 'Thiếu discord_id' });

        const result = safeQuery(() => {
            const profiles = db.prepare(`
                SELECT * FROM customer_profiles WHERE customer_id = ?
            `).all(discordId);

            const flags = db.prepare(`
                SELECT * FROM customer_flags WHERE customer_id = ?
            `).all(discordId);

            const recentOrders = db.prepare(`
                SELECT order_code, product_name, quantity, total_amount, amount_paid,
                       status, payment_status, created_at, completed_at
                FROM orders WHERE customer_id = ?
                ORDER BY created_at DESC LIMIT 10
            `).all(discordId);

            const stats = db.prepare(`
                SELECT
                    COUNT(*) as total_orders,
                    SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled,
                    -- Tổng đã chi: chỉ đơn không bị hủy + đã thanh toán
                    COALESCE(SUM(CASE WHEN payment_status = 'PAID' AND status != 'CANCELLED' THEN amount_paid ELSE 0 END), 0) as total_spent,
                    MAX(created_at) as last_order_at
                FROM orders WHERE customer_id = ?
            `).get(discordId);

            return { discord_id: discordId, profiles, flags, recentOrders, stats };
        });
        res.json(result);
    });

    // ── FEEDBACKS — lấy review của customer hoặc all ────────
    app.get('/api/bot/feedbacks', async (req, res) => {
        try {
            const { customer_id, limit = 20, min_stars, offset = 0, q = '' } = req.query;
            const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
            const off = Math.min(10_000, Math.max(0, parseInt(offset, 10) || 0));
            const minStars = min_stars
                ? Math.min(5, Math.max(1, parseInt(min_stars, 10) || 1))
                : null;
            const search = String(q || '').trim().slice(0, 80);

            let whereSql = 'WHERE 1=1';
            const params = {};
            if (customer_id) {
                whereSql += ' AND customer_id = @customer_id';
                params.customer_id = String(customer_id);
            }
            if (minStars) {
                whereSql += ' AND stars >= @min_stars';
                params.min_stars = minStars;
            }
            if (search) {
                whereSql += ' AND (content LIKE @search OR order_code LIKE @search OR customer_id LIKE @search)';
                params.search = `%${search}%`;
            }

            const total = db.prepare(`SELECT COUNT(*) AS total FROM feedbacks ${whereSql}`).get(params)?.total ?? 0;
            const sql = `
                SELECT id, guild_id, order_code, customer_id, stars, content, created_at
                FROM feedbacks ${whereSql}
                ORDER BY created_at DESC
                LIMIT @lim OFFSET @offset
            `;
            params.lim = lim;
            params.offset = off;
            const feedbacks = db.prepare(sql).all(params);

            const client = req.app.locals.discordClient;
            const guildId = config.guildId;
            const guild = client?.guilds?.cache?.get(guildId) || null;
            const customerIds = [...new Set(feedbacks.map((feedback) => feedback.customer_id))];
            const webUsers = new Map();
            const oauthUsers = new Map();

            if (customerIds.length > 0) {
                const placeholders = customerIds.map(() => '?').join(',');
                for (const row of db.prepare(`
                    SELECT discord_id, discord_username, discord_avatar
                    FROM web_users
                    WHERE discord_id IN (${placeholders})
                `).all(...customerIds)) {
                    webUsers.set(row.discord_id, row);
                }
                for (const row of db.prepare(`
                    SELECT discord_id, username, avatar
                    FROM oauth_backups
                    WHERE guild_id IN (?, '') AND discord_id IN (${placeholders})
                    ORDER BY CASE WHEN guild_id = ? THEN 0 ELSE 1 END
                `).all(guildId, ...customerIds, guildId)) {
                    if (!oauthUsers.has(row.discord_id)) oauthUsers.set(row.discord_id, row);
                }
            }

            const richFeedbacks = feedbacks.map((fb) => {
                let displayName = `Khách #${fb.customer_id.slice(-4)}`;
                let avatar = null;
                const member = guild?.members?.cache?.get(fb.customer_id) || null;
                const cachedUser = member?.user || client?.users?.cache?.get(fb.customer_id) || null;
                const webUser = webUsers.get(fb.customer_id);
                const oauthUser = oauthUsers.get(fb.customer_id);

                displayName = member?.displayName
                    || cachedUser?.username
                    || webUser?.discord_username
                    || oauthUser?.username
                    || displayName;
                avatar = cachedUser?.displayAvatarURL?.({ size: 128 })
                    || webUser?.discord_avatar
                    || (oauthUser?.avatar
                        ? `https://cdn.discordapp.com/avatars/${fb.customer_id}/${oauthUser.avatar}.webp?size=128`
                        : null);

                if (avatar && !/^https:\/\//i.test(avatar)) {
                    avatar = null;
                }

                return {
                    id: fb.id,
                    guild_id: fb.guild_id,
                    order_code: fb.order_code,
                    customer_id: fb.customer_id,
                    stars: fb.stars,
                    content: fb.content,
                    created_at: fb.created_at,
                    customer_name: displayName,
                    customer_avatar: avatar
                };
            });

            res.json({ ok: true, data: richFeedbacks, total, limit: lim, offset: off });
        } catch (error) {
            console.error('[BOT_API] Feedbacks error:', error);
            res.status(500).json({ ok: false, error: error.message });
        }
    });

    // ── LEADERBOARD — Bảng xếp hạng tuần/tháng ──────────────────
    app.get('/api/bot/leaderboard', async (req, res) => {
        try {
            const period = req.query.period || 'weekly'; // weekly or monthly
            const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
            
            let timeFilter = "datetime('now', '-7 days')";
            if (period === 'monthly') {
                timeFilter = "datetime('now', '-30 days')";
            }

            const sql = `
                SELECT customer_id,
                       COUNT(*) as orders,
                       COALESCE(SUM(amount_paid), 0) as total_spent,
                       MAX(created_at) as last_order_at
                FROM orders
                WHERE payment_status = 'PAID'
                  AND status != 'CANCELLED'
                  AND created_at >= ${timeFilter}
                GROUP BY customer_id
                ORDER BY total_spent DESC
                LIMIT ?
            `;
            const rows = db.prepare(sql).all(limit);

            const client = req.app.locals.discordClient;
            const guildId = config.guildId;
            let guild = null;
            if (client) {
                guild = await client.guilds.fetch(guildId).catch(() => null);
            }

            const richRows = await Promise.all(rows.map(async (row) => {
                let displayName = `Khách #${row.customer_id.slice(-4)}`;
                let avatar = null;

                if (client) {
                    try {
                        if (guild) {
                            const member = await guild.members.fetch(row.customer_id).catch(() => null);
                            if (member) {
                                displayName = member.displayName || member.user.username;
                                avatar = member.user.displayAvatarURL({ size: 128 });
                            } else {
                                const user = await client.users.fetch(row.customer_id).catch(() => null);
                                if (user) {
                                    displayName = user.username;
                                    avatar = user.displayAvatarURL({ size: 128 });
                                }
                            }
                        } else {
                            const user = await client.users.fetch(row.customer_id).catch(() => null);
                            if (user) {
                                displayName = user.username;
                                avatar = user.displayAvatarURL({ size: 128 });
                            }
                        }
                    } catch (e) {
                        console.error(`Error fetching user ${row.customer_id}:`, e);
                    }
                }

                return {
                    customer_id: row.customer_id,
                    orders: row.orders,
                    total_spent: row.total_spent,
                    last_order_at: row.last_order_at,
                    customer_name: displayName,
                    customer_avatar: avatar
                };
            }));

            res.json({ ok: true, data: richRows });
        } catch (error) {
            console.error('[BOT_API] Leaderboard error:', error);
            res.status(500).json({ ok: false, error: error.message });
        }
    });


    // ── PRODUCTS — bảng giá sản phẩm bot bán ───────────────
    app.get('/api/bot/products', (req, res) => {
        const result = safeQuery(() =>
            db.prepare(`
                SELECT pc.id, pc.guild_id, pc.name, pc.description, pc.price, pc.duration_months,
                       pc.service_type, pc.emoji, pc.is_active, pc.sort_order, pc.original_price,
                       (
                         SELECT COUNT(*)
                         FROM account_stock stock
                         WHERE stock.status = 'AVAILABLE'
                           AND (
                             LOWER(stock.service_type) = LOWER(pc.name)
                             OR LOWER(stock.service_type) = LOWER(pc.service_type)
                           )
                       ) AS stock_count
                FROM product_catalog pc
                WHERE pc.is_active = 1
                ORDER BY pc.sort_order ASC, pc.name ASC
            `).all()
        );
        res.json(result);
    });

    // ── PRODUCT DETAIL BY SLUG OR ID ─────────────────────────
    app.get('/api/bot/products/:slugOrId', (req, res) => {
        const query = String(req.params.slugOrId || '').trim();
        const result = safeQuery(() => {
            const allProducts = db.prepare(`
                SELECT pc.id, pc.guild_id, pc.name, pc.description, pc.price, pc.duration_months,
                       pc.service_type, pc.emoji, pc.is_active, pc.sort_order, pc.original_price,
                       (
                         SELECT COUNT(*)
                         FROM account_stock stock
                         WHERE stock.status = 'AVAILABLE'
                           AND (
                             LOWER(stock.service_type) = LOWER(pc.name)
                             OR LOWER(stock.service_type) = LOWER(pc.service_type)
                           )
                       ) AS stock_count
                FROM product_catalog pc
                WHERE pc.is_active = 1
            `).all();
            const norm = query.toLowerCase();
            const match = allProducts.find(p =>
                String(p.id) === norm ||
                String(p.name || '').toLowerCase() === norm ||
                String(p.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === norm
            );
            return match || null;
        });
        if (!result) {
            return res.status(404).json({ ok: false, error: 'Sản phẩm không tồn tại' });
        }
        res.json({ ok: true, data: result });
    });

    // ── TOP CUSTOMERS — top N khách mua nhiều ─────────────
    app.get('/api/bot/top-customers', (req, res) => {
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
        const result = safeQuery(() =>
            db.prepare(`
                SELECT customer_id,
                       COUNT(*) as orders,
                       COALESCE(SUM(amount_paid), 0) as total_spent,
                       MAX(created_at) as last_order_at
                FROM orders
                WHERE payment_status = 'PAID'
                  AND status != 'CANCELLED'
                GROUP BY customer_id
                ORDER BY total_spent DESC
                LIMIT ?
            `).all(limit)
        );
        res.json(result);
    });

    // ── TOP PRODUCTS — top sản phẩm bán chạy ───────────────
    app.get('/api/bot/top-products', (req, res) => {
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
        const result = safeQuery(() =>
            db.prepare(`
                SELECT product_name,
                       COUNT(*) as total_orders,
                       SUM(quantity) as total_qty,
                       COALESCE(SUM(amount_paid), 0) as total_revenue
                FROM orders
                WHERE payment_status = 'PAID'
                  AND status != 'CANCELLED'
                GROUP BY product_name
                ORDER BY total_orders DESC
                LIMIT ?
            `).all(limit)
        );
        res.json(result);
    });

    // ── WALLET API — Ví điện tử ───────────────
    app.get('/api/bot/wallet/:customerId', async (req, res) => {
        const customerId = req.params.customerId;
        if (!canAccessCustomerResource(req, customerId)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        const guildId = config.guildId;
        try {
            const { getWalletBalance, getWalletTransactions } = await import('./walletService.js');
            const balance = getWalletBalance(guildId, customerId);
            const transactions = getWalletTransactions(guildId, customerId, 20);
            res.json({ ok: true, data: { balance, transactions } });
        } catch (e) {
            console.error('[WALLET GET]', e);
            res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
        }
    });

    app.post('/api/bot/wallet/topup', async (req, res) => {
        const customerId = String(req.body?.customerId || '').trim();
        const amount = Number(req.body?.amount);
        if (!canAccessCustomerResource(req, customerId)) {
            return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        if (!customerId || !Number.isSafeInteger(amount) || amount < 10000 || amount > 100000000) {
            return res.status(400).json({ ok: false, error: 'Số tiền phải từ 10.000đ đến 100.000.000đ' });
        }
        const guildId = config.guildId;
        try {
            const { createTopupCheckout } = await import('./walletService.js');
            const data = await createTopupCheckout(guildId, customerId, amount);
            res.json({ ok: true, data });
        } catch (e) {
            console.error('[WALLET TOPUP]', e);
            res.status(500).json({ ok: false, error: 'Lỗi tạo đơn nạp tiền PayOS' });
        }
    });

    // ── WEB ORDERS — nhận đơn hàng từ website ──────────────
    app.post('/api/bot/web-orders', async (req, res) => {
        if (process.env.WEB_CHECKOUT_ENABLED !== 'true') {
            return res.status(503).json({
                ok: false,
                code: 'CHECKOUT_MAINTENANCE',
                error: 'Web checkout đang tạm khóa để hoàn tất kiểm tra giá và thanh toán.',
            });
        }
        try {
            const { items } = req.body;
            if (!Array.isArray(items) || items.length !== 1) {
                return res.status(400).json({ ok: false, error: 'Mỗi lần checkout chỉ hỗ trợ một sản phẩm.' });
            }

            const customerId = String(req.header('x-discord-id') || '').trim();
            if (!/^\d{15,22}$/.test(customerId)) {
                return res.status(401).json({ ok: false, error: 'Discord login is required.' });
            }

            const requestedProductId = String(items[0]?.id || items[0]?.product_id || '').trim();
            const quantity = Number(items[0]?.quantity ?? items[0]?.qty);
            if (!requestedProductId || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10) {
                return res.status(400).json({ ok: false, error: 'Sản phẩm hoặc số lượng không hợp lệ.' });
            }

            const catalogProduct = db.prepare(`
                SELECT id, name, price, duration_months
                FROM product_catalog
                WHERE id = ? AND is_active = 1
                LIMIT 1
            `).get(requestedProductId);
            const unitPrice = Number(catalogProduct?.price);
            if (!catalogProduct || !Number.isFinite(unitPrice) || unitPrice <= 0) {
                return res.status(400).json({ ok: false, error: 'Sản phẩm không thể checkout trực tuyến.' });
            }

            const totalAmount = unitPrice * quantity;
            if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
                return res.status(400).json({ ok: false, error: 'Tổng tiền không hợp lệ.' });
            }

            const requestedProvider = String(req.body.paymentProvider || 'VIETQR').trim().toUpperCase();
            if (!['VIETQR', 'PAYOS', 'WALLET'].includes(requestedProvider)) {
                return res.status(400).json({ ok: false, error: 'Phương thức thanh toán chưa được hỗ trợ.' });
            }
            const paymentProvider = requestedProvider;
            const contact = typeof req.body.contact === 'string' ? req.body.contact.trim().slice(0, 100) : '';
            const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 1_000) : '';
            
            // Lấy db helpers và orderService
            const { generateUniqueOrderCode, createOrder, saveOrderLogMessage } = await import('./orderService.js');
            
            const firstItem = catalogProduct;
            const orderCode = generateUniqueOrderCode();
            
            // Xử lý duration_months, tránh undefined/null
            let durationMonths = firstItem.duration_months;
            if (durationMonths == null || isNaN(durationMonths)) {
                durationMonths = null;
            } else {
                durationMonths = parseInt(durationMonths, 10);
            }
            
            const guildId = config.guildId;

            // Let's create the ticket channel first
            let channelId = `web-${orderCode.toLowerCase().replace('_', '-')}`;
            let ticketId = 0;
            let discordChannel = null;

            try {
                const client = req.app.locals.discordClient;
                if (client) {
                    const guild = await client.guilds.fetch(guildId).catch(() => null);
                    if (guild) {
                        const { getGuildConfig } = await import('./guildConfigService.js');
                        const guildConfig = getGuildConfig(guildId);
                        if (guildConfig) {
                            const { ChannelType, PermissionFlagsBits } = await import('discord.js');
                            const { TICKET_MEMBER_PERMISSIONS } = await import('../utils/permissions.js');
                            
                            const overwrites = [
                                {
                                    id: guild.roles.everyone.id,
                                    deny: [PermissionFlagsBits.ViewChannel],
                                },
                                {
                                    id: client.user.id,
                                    allow: [
                                        PermissionFlagsBits.ViewChannel,
                                        PermissionFlagsBits.SendMessages,
                                        PermissionFlagsBits.ReadMessageHistory,
                                        PermissionFlagsBits.ManageChannels
                                    ],
                                },
                            ];
                            
                            if (guildConfig.support_role_id) {
                                overwrites.push({ id: guildConfig.support_role_id, allow: TICKET_MEMBER_PERMISSIONS });
                            }
                            if (customerId && customerId !== 'web_user') {
                                const member = await guild.members.fetch(customerId).catch(() => null);
                                if (member) {
                                    overwrites.push({ id: customerId, allow: TICKET_MEMBER_PERMISSIONS });
                                }
                            }
                            
                            const categoryId = guildConfig.ticket_category_id;
                            const channel = await guild.channels.create({
                                name: `web-${orderCode.toLowerCase().replace('_', '-')}`,
                                type: ChannelType.GuildText,
                                parent: categoryId,
                                permissionOverwrites: overwrites,
                            }).catch(() => null);
                            
                            if (channel) {
                                discordChannel = channel;
                                channelId = channel.id;
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('[WEB ORDER] Lỗi tạo kênh Discord:', err);
            }

            // Tạo ticket trong DB
            const { createTicket } = await import('./ticketService.js');
            const ticket = createTicket({
                guildId,
                channelId,
                customerId,
                openedById: customerId,
                ticketType: 'ORDER',
                relatedOrderCode: orderCode
            });
            ticketId = ticket.id;

            // Nếu thanh toán bằng ví, kiểm tra số dư và trừ tiền
            if (paymentProvider === 'WALLET') {
                const { getWalletBalance, addWalletBalance } = await import('./walletService.js');
                const balance = getWalletBalance(guildId, customerId);
                if (balance < totalAmount) {
                    return res.status(400).json({ ok: false, error: 'Số dư ví không đủ.' });
                }
                // Trừ tiền ngay
                addWalletBalance(guildId, customerId, -totalAmount, 'PAYMENT', `Thanh toán đơn ${orderCode}`, orderCode);
            }

            const { getGuildConfig } = await import('./guildConfigService.js');
            const guildConfig = getGuildConfig(guildId);
            const orderLogChannelId = guildConfig?.order_log_channel_id || channelId || 'default_log';

            const orderPayload = {
                orderCode,
                guildId,
                ticketId,
                ticketChannelId: channelId,
                customerId,
                productName: firstItem.name,
                quantity,
                totalAmount: totalAmount,
                durationMonths: durationMonths,
                note: note || '',
                orderLogChannelId,
                createdById: customerId
            };
            
            const order = createOrder(orderPayload);
            let payment_qr_code = null;
            let finalStatus = order.status;

             let payment_checkout_url = null;

             if (paymentProvider === 'WALLET') {
                // Đánh dấu đã thanh toán
                const { markOrderPaid } = await import('./orderService.js');
                markOrderPaid(orderCode, {
                    amountPaid: totalAmount,
                    transactionId: `WALLET_${Date.now()}`,
                    transactionContent: 'Thanh toán bằng số dư Ví',
                });
                finalStatus = 'PROCESSING';
            } else {
                // Nếu cấu hình chính là PAYOS
                if (config.paymentProvider === 'PAYOS') {
                    try {
                        const { createOrLoadPayOSLink } = await import('./paymentService.js');
                        // Lấy đầy đủ bản ghi order vừa tạo
                        const payosOrder = await createOrLoadPayOSLink(order);
                        payment_checkout_url = payosOrder.payment_checkout_url || payosOrder.payment_qr_url;
                        payment_qr_code = payosOrder.payment_qr_code;
                    } catch (err) {
                        console.error('[WEB ORDER] Lỗi tạo cổng thanh toán PayOS:', err);
                        // Fallback sang VietQR thường bên dưới
                    }
                }
                
                // Fallback hoặc dùng VietQR thường nếu PayOS lỗi/không bật
                if (!payment_checkout_url) {
                    let bankBin = config.vietqrBankBin || '970418';
                    let accountNo = config.vietqrAccountNo || '';
                    let accountName = config.vietqrAccountName || 'CREAM STORE';

                    if (guildConfig && guildConfig.bank_bin && guildConfig.bank_account_no) {
                        bankBin = guildConfig.bank_bin;
                        accountNo = guildConfig.bank_account_no;
                        accountName = guildConfig.bank_account_name || 'CREAM STORE';
                    }

                    if (accountNo) {
                        const encodedContent = encodeURIComponent(orderCode);
                        const encodedName = encodeURIComponent(accountName);
                        payment_qr_code = `https://img.vietqr.io/image/${bankBin}-${accountNo}-compact2.png?amount=${totalAmount}&addInfo=${encodedContent}&accountName=${encodedName}`;
                        
                        const { savePaymentLinkData } = await import('./orderService.js');
                        savePaymentLinkData(orderCode, {
                            qrCode: payment_qr_code,
                            qrUrl: payment_qr_code
                        });
                    }
                }
            }
            
            // Trả về JSON cho Web Next.js
            res.json({
                ok: true,
                data: {
                    order_code: orderCode,
                    payment_checkout_url: payment_checkout_url,
                    payment_qr_code: payment_qr_code,
                    total_amount: totalAmount,
                    status: finalStatus
                }
            });

            // Gửi welcome embed và components vào kênh Discord mới
            if (discordChannel) {
                try {
                    const { buildTicketWelcomeV2, buildTicketControlComponents } = await import('../utils/embeds.js');
                    const { container: welcomeV2, flags: welcomeV2Flags } = buildTicketWelcomeV2(
                        orderCode, customerId, 'ORDER', null, null, guildId
                    );
                    await discordChannel.send({
                        components: [welcomeV2, ...buildTicketControlComponents(ticketId, customerId)],
                        flags: welcomeV2Flags,
                    }).catch(() => null);
                    
                    if (customerId && /^\\d+$/.test(customerId)) {
                        await discordChannel.send({ content: `<@${customerId}> — Đơn hàng từ Web của bạn đã tạo ticket này!` }).catch(() => null);
                    } else {
                        await discordChannel.send({ content: `Có đơn hàng mới từ Web (Khách Vãng Lai)! Đơn hàng: **${orderCode}**.` }).catch(() => null);
                    }
                } catch (welcomeErr) {
                    console.error('[WEB ORDER] Lỗi gửi welcome embed vào kênh Discord:', welcomeErr);
                }
            }
            
            // Gửi thông báo về kênh bot log
            try {
                const client = req.app.locals.discordClient;
                if (client) {
                    const guild = await client.guilds.fetch(guildId).catch(() => null);
                    if (guild) {
                        const { getGuildConfig } = await import('./guildConfigService.js');
                        const guildConfig = getGuildConfig(guildId);
                        if (guildConfig && guildConfig.order_log_channel_id) {
                            const orderLogChannel = await guild.channels.fetch(guildConfig.order_log_channel_id).catch(() => null);
                            if (orderLogChannel && orderLogChannel.isTextBased()) {
                                const { buildOrderCreatedV2 } = await import('../utils/embeds.js');
                                const { container, actionRow, flags } = buildOrderCreatedV2(order, guildConfig.order_log_channel_id);

                                const { TextDisplayBuilder } = await import('discord.js');
                                container.addTextDisplayComponents(
                                    new TextDisplayBuilder().setContent(
                                        `> **Khách hàng Web** — Contact: ${contact || 'Không có'} · Discord: <@${customerId}>\n` +
                                        `> **Ghi chú:** ${note || 'Không có'}`
                                    )
                                );

                                const orderLogMsg = await orderLogChannel.send({ components: [container, actionRow], flags }).catch(() => null);
                                if (orderLogMsg) {
                                    saveOrderLogMessage(orderCode, orderLogMsg.id);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.error('Lỗi gửi embed log Discord:', e);
            }
            
        } catch (e) {
            console.error('[WEB ORDERS API]', e);
            res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
        }
    });

    // ── ORDER CHAT — đồng bộ tin nhắn 2 chiều ──────────────────
    app.get('/api/bot/orders/:code/chat', async (req, res) => {
        try {
            const code = String(req.params.code || '').toUpperCase();
            const order = db.prepare(`SELECT * FROM orders WHERE order_code = ?`).get(code);
            if (!order) {
                return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn hàng' });
            }

            if (!canAccessCustomerResource(req, order.customer_id)) {
                return res.status(403).json({ ok: false, error: 'Forbidden' });
            }

            // Proxy check to route to the correct bot process
            if (order.guild_id && order.guild_id !== config.guildId) {
                const targetPort = order.guild_id === '1070676180103086132' ? 8080 : 5000;
                try {
                    const response = await fetch(`http://127.0.0.1:${targetPort}${req.originalUrl || req.url}`, {
                        method: 'GET',
                        headers: {
                            'X-Bot-Api-Key': req.header('X-Bot-Api-Key') || '',
                            'x-discord-id': req.header('x-discord-id') || '',
                            'x-user-role': req.header('x-user-role') || ''
                        }
                    });
                    const data = await response.json();
                    return res.status(response.status).json(data);
                } catch (proxyError) {
                    console.error('[GET CHAT PROXY ERROR]', proxyError);
                    return res.status(502).json({ ok: false, error: 'Failed to proxy request to target bot' });
                }
            }

            const channelId = order.ticket_channel_id;
            if (!channelId || channelId === 'web' || channelId.startsWith('web-')) {
                return res.json({ ok: true, messages: [] });
            }

            const client = req.app.locals.discordClient;
            if (!client) {
                return res.json({ ok: true, messages: [] });
            }

            const guildId = order.guild_id || config.guildId;
            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                return res.json({ ok: true, messages: [] });
            }

            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel || !channel.isTextBased()) {
                return res.json({ ok: true, messages: [] });
            }

            const messages = await channel.messages.fetch({ limit: 50 }).catch(() => []);
            if (!messages || messages.size === 0) {
                return res.json({ ok: true, messages: [] });
            }

            const formatted = Array.from(messages.values()).map(m => {
                let authorType = 'staff';
                let content = m.content || '';
                let authorName = m.author?.username || 'Hệ thống';
                let authorAvatar = m.author ? m.author.displayAvatarURL() : null;

                if (m.author?.bot) {
                    if (content.startsWith('**[Khách từ Web]**:')) {
                        authorType = 'customer';
                        content = content.replace('**[Khách từ Web]**:', '').trim();
                    } else if (content.startsWith('**[Khách hàng từ Web]**:')) {
                        authorType = 'customer';
                        content = content.replace('**[Khách hàng từ Web]**:', '').trim();
                    } else {
                        authorType = 'system';
                    }
                } else {
                    if (m.author?.id === order.customer_id) {
                        authorType = 'customer';
                        authorName = m.member?.displayName || m.author?.displayName || m.author?.username || 'Khách hàng';
                    } else {
                        authorType = 'staff';
                        authorName = m.member?.displayName || m.author?.displayName || m.author?.username || 'Staff';
                    }
                }

                if (!content && m.embeds && m.embeds.length > 0) {
                    const embed = m.embeds[0];
                    content = embed.description || embed.title || '';
                    authorType = 'system';
                }

                return {
                    id: m.id,
                    authorType,
                    authorName,
                    authorAvatar,
                    content,
                    timestamp: m.createdAt.toISOString()
                };
            }).reverse().filter(msg => msg.content || msg.authorType === 'system');

            res.json({ ok: true, messages: formatted });
        } catch (e) {
            console.error('[CHAT GET API ERROR]', e);
            res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
        }
    });

    app.post('/api/bot/orders/:code/chat', async (req, res) => {
        try {
            const code = String(req.params.code || '').toUpperCase();
            const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
            if (!content || content.length > 2000) {
                return res.status(400).json({ ok: false, error: 'Tin nhắn phải dài từ 1 đến 2.000 ký tự' });
            }

            const order = db.prepare(`SELECT * FROM orders WHERE order_code = ?`).get(code);
            if (!order) {
                return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn hàng' });
            }

            if (!canAccessCustomerResource(req, order.customer_id)) {
                return res.status(403).json({ ok: false, error: 'Forbidden' });
            }

            // Proxy check to route to the correct bot process
            if (order.guild_id && order.guild_id !== config.guildId) {
                const targetPort = order.guild_id === '1070676180103086132' ? 8080 : 5000;
                try {
                    const response = await fetch(`http://127.0.0.1:${targetPort}${req.originalUrl || req.url}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'X-Bot-Api-Key': req.header('X-Bot-Api-Key') || '',
                            'x-discord-id': req.header('x-discord-id') || '',
                            'x-user-role': req.header('x-user-role') || ''
                        },
                        body: JSON.stringify(req.body)
                    });
                    const data = await response.json();
                    return res.status(response.status).json(data);
                } catch (proxyError) {
                    console.error('[POST CHAT PROXY ERROR]', proxyError);
                    return res.status(502).json({ ok: false, error: 'Failed to proxy request to target bot' });
                }
            }

            let channelId = order.ticket_channel_id;
            const client = req.app.locals.discordClient;
            let channel = null;

            if (client) {
                const guild = await client.guilds.fetch(order.guild_id).catch(() => null);
                if (guild) {
                    if (!channelId || channelId === 'web' || channelId.startsWith('web-')) {
                        // Self-healing
                        const { getGuildConfig } = await import('./guildConfigService.js');
                        const guildConfig = getGuildConfig(order.guild_id);
                        if (guildConfig) {
                            const { ChannelType, PermissionFlagsBits } = await import('discord.js');
                            const { TICKET_MEMBER_PERMISSIONS } = await import('../utils/permissions.js');
                            
                            const overwrites = [
                                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                                {
                                    id: client.user.id,
                                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels]
                                }
                            ];
                            if (guildConfig.support_role_id) {
                                overwrites.push({ id: guildConfig.support_role_id, allow: TICKET_MEMBER_PERMISSIONS });
                            }
                            if (order.customer_id && order.customer_id !== 'web_user') {
                                const member = await guild.members.fetch(order.customer_id).catch(() => null);
                                if (member) {
                                    overwrites.push({ id: order.customer_id, allow: TICKET_MEMBER_PERMISSIONS });
                                }
                            }
                            
                            const categoryId = guildConfig.ticket_category_id;
                            const newChannel = await guild.channels.create({
                                name: `web-${order.order_code.toLowerCase().replace('_', '-')}`,
                                type: ChannelType.GuildText,
                                parent: categoryId,
                                permissionOverwrites: overwrites,
                            }).catch(() => null);

                            if (newChannel) {
                                channel = newChannel;
                                channelId = newChannel.id;
                                db.prepare(`UPDATE orders SET ticket_channel_id = ?, updated_at = ? WHERE order_code = ?`).run(channelId, nowIso(), order.order_code);
                                
                                const { buildTicketWelcomeV2, buildTicketControlComponents } = await import('../utils/embeds.js');
                                const { container: welcomeV2, flags: welcomeV2Flags } = buildTicketWelcomeV2(
                                    order.order_code, order.customer_id, 'ORDER', null, null, order.guild_id
                                );
                                await channel.send({
                                    components: [welcomeV2, ...buildTicketControlComponents(order.ticket_id, order.customer_id)],
                                    flags: welcomeV2Flags,
                                }).catch(() => null);
                            }
                        }
                    } else {
                        channel = await guild.channels.fetch(channelId).catch(() => null);
                    }
                }
            }

            if (channel && channel.isTextBased()) {
                await channel.send({ content: `**[Khách từ Web]**: ${content}` });
                return res.json({ ok: true });
            } else {
                return res.status(503).json({ ok: false, error: 'Đang không thể kết nối tới hỗ trợ Discord' });
            }
        } catch (e) {
            console.error('[CHAT POST API ERROR]', e);
            res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
        }
    });

    // ── GENERAL TICKETS — tạo ticket hỗ trợ trực tuyến ─────────
    app.post('/api/bot/tickets/start', async (req, res) => {
        try {
            const contact = typeof req.body?.contact === 'string'
                ? req.body.contact.trim().slice(0, 100)
                : '';
            const authenticatedDiscordId = String(req.header('x-discord-id') || '').trim();
            if (!authenticatedDiscordId) {
                return res.status(401).json({ ok: false, error: 'Discord login is required' });
            }
            if (!contact) return res.status(400).json({ ok: false, error: 'Thiếu thông tin liên hệ (tên/SĐT)' });

            const guildId = config.guildId;
            const customerId = authenticatedDiscordId;
            
            let channelId = `live-${contact.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'guest'}-${Math.random().toString().slice(2, 6)}`;
            let ticketId = 0;
            let discordChannel = null;

            const client = req.app.locals.discordClient;
            if (client) {
                const guild = await client.guilds.fetch(guildId).catch(() => null);
                if (guild) {
                    const { getGuildConfig } = await import('./guildConfigService.js');
                    const guildConfig = getGuildConfig(guildId);
                    if (guildConfig) {
                        const { ChannelType, PermissionFlagsBits } = await import('discord.js');
                        const { TICKET_MEMBER_PERMISSIONS } = await import('../utils/permissions.js');
                        
                        const overwrites = [
                            {
                                id: guild.roles.everyone.id,
                                deny: [PermissionFlagsBits.ViewChannel],
                            },
                            {
                                id: client.user.id,
                                allow: [
                                    PermissionFlagsBits.ViewChannel,
                                    PermissionFlagsBits.SendMessages,
                                    PermissionFlagsBits.ReadMessageHistory,
                                    PermissionFlagsBits.ManageChannels
                                ],
                            },
                        ];
                        
                        if (guildConfig.support_role_id) {
                            overwrites.push({ id: guildConfig.support_role_id, allow: TICKET_MEMBER_PERMISSIONS });
                        }
                        if (customerId && customerId !== 'web_user') {
                            const member = await guild.members.fetch(customerId).catch(() => null);
                            if (member) {
                                overwrites.push({ id: customerId, allow: TICKET_MEMBER_PERMISSIONS });
                            }
                        }
                        
                        const categoryId = guildConfig.support_category_id || guildConfig.ticket_category_id;
                        const channel = await guild.channels.create({
                            name: `live-${contact.toLowerCase().replace(/[^a-z0-9]/g, '-') || 'guest'}`,
                            type: ChannelType.GuildText,
                            parent: categoryId,
                            permissionOverwrites: overwrites,
                        }).catch(() => null);
                        
                        if (channel) {
                            discordChannel = channel;
                            channelId = channel.id;
                        }
                    }
                }
            }

            // Tạo ticket trong DB
            const { createTicket } = await import('./ticketService.js');
            const ticket = createTicket({
                guildId,
                channelId,
                customerId,
                openedById: customerId,
                ticketType: 'SUPPORT'
            });

            if (discordChannel) {
                try {
                    const { buildTicketWelcomeV2, buildTicketControlComponents } = await import('../utils/embeds.js');
                    const { container: welcomeV2, flags: welcomeV2Flags } = buildTicketWelcomeV2(
                        ticket.ticket_code, customerId, 'SUPPORT', null, null, guildId
                    );
                    await discordChannel.send({
                        components: [welcomeV2, ...buildTicketControlComponents(ticket.id, customerId)],
                        flags: welcomeV2Flags,
                    }).catch(() => null);

                    const E2 = createEmojiResolver(guildId);
                    await discordChannel.send({
                        content: `${E2('panel_order')} **YÊU CẦU HỖ TRỢ TRỰC TUYẾN TỪ WEB**\nLiên hệ: **${contact}**\nDiscord: ${customerId === 'web_user' ? 'Khách vãng lai' : `<@${customerId}>`}`
                    }).catch(() => null);
                } catch (err) {
                    console.error('[LIVE CHAT START] Lỗi gửi welcome embed:', err);
                }
            }

            res.json({ ok: true, data: { ticket_code: ticket.ticket_code } });
        } catch (e) {
            console.error('[LIVE CHAT START API ERROR]', e);
            res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
        }
    });

    // ── GENERAL TICKETS CHAT ──────────────────────────────────
    app.get('/api/bot/tickets/:code/chat', async (req, res) => {
        try {
            const code = String(req.params.code || '').toUpperCase();
            const ticket = db.prepare(`SELECT * FROM tickets WHERE ticket_code = ?`).get(code);
            if (!ticket) {
                return res.status(404).json({ ok: false, error: 'Không tìm thấy ticket' });
            }

            if (!canAccessCustomerResource(req, ticket.customer_id)) {
                return res.status(403).json({ ok: false, error: 'Forbidden' });
            }

            const ticketStatus = ticket.status; // OPEN, CLOSED, etc.
            const channelId = ticket.channel_id;
            if (!channelId || channelId === 'web' || channelId.startsWith('live-')) {
                return res.json({ ok: true, messages: [], status: ticketStatus });
            }

            const client = req.app.locals.discordClient;
            if (!client) {
                return res.json({ ok: true, messages: [], status: ticketStatus });
            }

            const guildId = ticket.guild_id || config.guildId;
            const guild = await client.guilds.fetch(guildId).catch(() => null);
            if (!guild) {
                return res.json({ ok: true, messages: [], status: ticketStatus });
            }

            const channel = await guild.channels.fetch(channelId).catch(() => null);
            if (!channel || !channel.isTextBased()) {
                return res.json({ ok: true, messages: [], status: ticketStatus });
            }

            const messages = await channel.messages.fetch({ limit: 50 }).catch(() => []);
            if (!messages || messages.size === 0) {
                return res.json({ ok: true, messages: [], status: ticketStatus });
            }

            const formatted = Array.from(messages.values()).map(m => {
                let authorType = 'staff';
                let content = m.content || '';
                let authorName = m.author?.username || 'Hệ thống';
                let authorAvatar = m.author ? m.author.displayAvatarURL() : null;

                if (m.author?.bot) {
                    if (content.startsWith('**[Khách từ Web]**:') || content.startsWith('**[Khách hàng từ Web]**:')) {
                        authorType = 'customer';
                        content = content.replace(/^\*\*\[Khách\s*(hàng\s*)?từ\s*Web\]\*\*:/i, '').trim();
                    } else if (content.startsWith('**[Staff ') && content.includes('từ Web]**:')) {
                        authorType = 'staff';
                        const match = content.match(/^\*\*\[Staff\s+(.*?)\s+từ\s+Web\]\*\*:/i);
                        authorName = match ? match[1] : 'Staff';
                        content = content.replace(/^\*\*\[Staff\s+.*?\s+từ\s*Web\]\*\*:/i, '').trim();
                    } else if (content.startsWith('**[Admin từ Web]**:')) {
                        authorType = 'staff';
                        authorName = 'Admin';
                        content = content.replace('**[Admin từ Web]**:', '').trim();
                    } else {
                        authorType = 'system';
                    }
                } else {
                    if (m.author?.id === ticket.customer_id) {
                        authorType = 'customer';
                        authorName = m.member?.displayName || m.author?.displayName || m.author?.username || 'Khách hàng';
                    } else {
                        authorType = 'staff';
                        authorName = m.member?.displayName || m.author?.displayName || m.author?.username || 'Staff';
                    }
                }

                if (!content && m.embeds && m.embeds.length > 0) {
                    const embed = m.embeds[0];
                    content = embed.description || embed.title || '';
                    authorType = 'system';
                }

                return {
                    id: m.id,
                    authorType,
                    authorName,
                    authorAvatar,
                    content,
                    timestamp: m.createdAt.toISOString()
                };
            }).reverse().filter(msg => msg.content && msg.content.trim());

            res.json({ ok: true, messages: formatted, status: ticketStatus });
        } catch (e) {
            console.error('[TICKET CHAT GET API ERROR]', e);
            res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
        }
    });

    app.post('/api/bot/tickets/:code/chat', async (req, res) => {
        try {
            const code = String(req.params.code || '').toUpperCase();
            const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
            if (!content || content.length > 2000) {
                return res.status(400).json({ ok: false, error: 'Tin nhắn phải dài từ 1 đến 2.000 ký tự' });
            }

            const ticket = db.prepare(`SELECT * FROM tickets WHERE ticket_code = ?`).get(code);
            if (!ticket) {
                return res.status(404).json({ ok: false, error: 'Không tìm thấy ticket' });
            }

            if (!canAccessCustomerResource(req, ticket.customer_id)) {
                return res.status(403).json({ ok: false, error: 'Forbidden' });
            }

            if (ticket.status === 'CLOSED') {
                return res.status(400).json({ ok: false, error: 'Ticket này đã đóng. Không thể gửi thêm tin nhắn.' });
            }

            let channelId = ticket.channel_id;
            const client = req.app.locals.discordClient;
            let channel = null;

            if (client) {
                const guild = await client.guilds.fetch(ticket.guild_id).catch(() => null);
                if (guild) {
                    if (!channelId || channelId.startsWith('live-')) {
                        // self-healing
                        const { getGuildConfig } = await import('./guildConfigService.js');
                        const guildConfig = getGuildConfig(ticket.guild_id);
                        if (guildConfig) {
                            const { ChannelType, PermissionFlagsBits } = await import('discord.js');
                            const { TICKET_MEMBER_PERMISSIONS } = await import('../utils/permissions.js');
                            
                            const overwrites = [
                                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                                {
                                    id: client.user.id,
                                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels]
                                }
                            ];
                            if (guildConfig.support_role_id) {
                                overwrites.push({ id: guildConfig.support_role_id, allow: TICKET_MEMBER_PERMISSIONS });
                            }
                            if (ticket.customer_id && ticket.customer_id !== 'web_user') {
                                const member = await guild.members.fetch(ticket.customer_id).catch(() => null);
                                if (member) {
                                    overwrites.push({ id: ticket.customer_id, allow: TICKET_MEMBER_PERMISSIONS });
                                }
                            }
                            
                            const categoryId = guildConfig.support_category_id || guildConfig.ticket_category_id;
                            const newChannel = await guild.channels.create({
                                name: `live-help`,
                                type: ChannelType.GuildText,
                                parent: categoryId,
                                permissionOverwrites: overwrites,
                            }).catch(() => null);

                            if (newChannel) {
                                channel = newChannel;
                                channelId = newChannel.id;
                                db.prepare(`UPDATE tickets SET channel_id = ? WHERE ticket_code = ?`).run(channelId, ticket.ticket_code);
                                
                                const { buildTicketWelcomeV2, buildTicketControlComponents } = await import('../utils/embeds.js');
                                const { container: welcomeV2, flags: welcomeV2Flags } = buildTicketWelcomeV2(
                                    ticket.ticket_code, ticket.customer_id, 'SUPPORT', null, null, ticket.guild_id
                                );
                                await channel.send({
                                    components: [welcomeV2, ...buildTicketControlComponents(ticket.id, ticket.customer_id)],
                                    flags: welcomeV2Flags,
                                }).catch(() => null);
                            }
                        }
                    } else {
                        channel = await guild.channels.fetch(channelId).catch(() => null);
                    }
                }
            }

            if (channel && channel.isTextBased()) {
                const userId = req.header('x-user-id');
                let prefix = '**[Khách từ Web]**';
                if (userId) {
                    const user = db.prepare('SELECT role, display_name FROM web_users WHERE id = ?').get(userId);
                    if (user && (user.role === 'admin' || user.role === 'staff')) {
                        prefix = `**[Staff ${user.display_name || 'Admin'} từ Web]**`;
                    }
                }
                await channel.send({ content: `${prefix}: ${content}` });
                return res.json({ ok: true });
            } else {
                return res.status(503).json({ ok: false, error: 'Không thể kết nối với hỗ trợ Discord lúc này' });
            }
        } catch (e) {
            console.error('[TICKET CHAT POST API ERROR]', e);
            res.status(500).json({ ok: false, error: 'Lỗi máy chủ nội bộ.' });
        }
    });

    // Deploy slash commands — gọi từ GitHub Actions sau mỗi lần deploy
    console.log('[BOT_API] Registered /api/bot/* routes');
}

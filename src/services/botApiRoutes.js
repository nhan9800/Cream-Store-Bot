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
    if (providedKey !== expectedKey) {
        return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    next();
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
        return { ok: false, error: e.message };
    }
}

/**
 * Register all /api/bot/* routes lên app Express
 */
export function registerBotApiRoutes(app) {
    // CORS — cho web cùng domain gọi
    const corsHandler = (req, res, next) => {
        res.set('Access-Control-Allow-Origin', '*');
        res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, X-Bot-Api-Key, x-bot-api-key');
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    };

    // Tất cả route /api/bot/* require API key
    app.use('/api/bot', corsHandler, requireApiKey);

    // ── HEALTH ──────────────────────────────────────────────────
    app.get('/api/bot/health', (req, res) => {
        res.json({
            ok: true,
            service: 'cream-bot',
            uptime: Math.floor(process.uptime()),
            timestamp: Date.now(),
        });
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
    app.get('/api/bot/orders/:code', (req, res) => {
        const code = String(req.params.code || '').toUpperCase();
        const result = safeQuery(() => {
            const order = db.prepare(`SELECT * FROM orders WHERE order_code = ?`).get(code);
            if (!order) return null;

            // Loại bỏ các field nhạy cảm trước khi trả
            const safe = { ...order };
            // Giữ credential nếu có (để admin web xem được — vì đã require API key)
            return safe;
        });
        if (result.ok && !result.data) {
            return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn' });
        }
        res.json(result);
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
    app.get('/api/bot/feedbacks', (req, res) => {
        const { customer_id, limit = 20, min_stars } = req.query;
        const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

        const result = safeQuery(() => {
            let sql = `
                SELECT id, guild_id, order_code, customer_id, stars, content, created_at
                FROM feedbacks WHERE 1=1
            `;
            const params = {};
            if (customer_id) { sql += ` AND customer_id = @customer_id`; params.customer_id = String(customer_id); }
            if (min_stars) { sql += ` AND stars >= @min_stars`; params.min_stars = parseInt(min_stars, 10) || 1; }
            sql += ` ORDER BY created_at DESC LIMIT @lim`;
            params.lim = lim;
            return db.prepare(sql).all(params);
        });
        res.json(result);
    });

    // ── PRODUCTS — bảng giá sản phẩm bot bán ───────────────
    app.get('/api/bot/products', (req, res) => {
        const result = safeQuery(() =>
            db.prepare(`
                SELECT id, guild_id, name, description, price, duration_months,
                       service_type, emoji, is_active, sort_order, require_email, require_phone
                FROM product_catalog
                WHERE is_active = 1
                ORDER BY sort_order ASC, name ASC
            `).all()
        );
        res.json(result);
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
        const guildId = process.env.PRIMARY_GUILD_ID || '1264259885827391629';
        try {
            const { getWalletBalance, getWalletTransactions } = await import('./walletService.js');
            const balance = getWalletBalance(guildId, customerId);
            const transactions = getWalletTransactions(guildId, customerId, 20);
            res.json({ ok: true, data: { balance, transactions } });
        } catch (e) {
            console.error('[WALLET GET]', e);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/bot/wallet/topup', async (req, res) => {
        const { customerId, amount } = req.body;
        if (!customerId || !amount || amount < 10000) {
            return res.status(400).json({ ok: false, error: 'Số tiền tối thiểu 10,000đ' });
        }
        const guildId = process.env.PRIMARY_GUILD_ID || '1264259885827391629';
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
        try {
            const { items, contact, note, discord_id, source } = req.body;
            if (!items || items.length === 0) return res.status(400).json({ ok: false, error: 'Giỏ hàng trống' });
            
            // Lấy db helpers và orderService
            const { generateUniqueOrderCode, createOrder, saveOrderLogMessage } = await import('./orderService.js');
            
            const firstItem = items[0];
            const totalAmount = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const orderCode = generateUniqueOrderCode();
            
            // Xử lý duration_months, tránh undefined/null
            let durationMonths = firstItem.duration_months;
            if (durationMonths == null || isNaN(durationMonths)) {
                durationMonths = null;
            } else {
                durationMonths = parseInt(durationMonths, 10);
            }
            
            const guildId = process.env.PRIMARY_GUILD_ID || '1264259885827391629';
            const customerId = discord_id || 'web_user';
            const paymentProvider = req.body.paymentProvider || 'vietqr'; // Lấy từ request nếu có, vd: 'WALLET'

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
                productName: firstItem.product_name || firstItem.name || 'Sản phẩm Web',
                quantity: items.reduce((sum, item) => sum + item.quantity, 0),
                totalAmount: totalAmount,
                durationMonths: durationMonths,
                note: note || '',
                orderLogChannelId,
                createdById: customerId
            };
            
            const order = createOrder(orderPayload);
            let payment_qr_code = null;
            let finalStatus = order.status;

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
                let bankBin = '970418';
                let accountNo = '';
                let accountName = 'CREAM STORE';

                if (guildConfig && guildConfig.bank_bin && guildConfig.bank_account_no) {
                    bankBin = guildConfig.bank_bin;
                    accountNo = guildConfig.bank_account_no;
                    accountName = guildConfig.bank_account_name || 'CREAM STORE';
                } else if (process.env.SEPAY_BANK_ACCOUNT) {
                    bankBin = process.env.VIETQR_BANK_BIN || '970418';
                    accountNo = process.env.SEPAY_BANK_ACCOUNT;
                    accountName = process.env.VIETQR_ACCOUNT_NAME || 'CREAM STORE';
                }

                if (accountNo) {
                    const encodedContent = encodeURIComponent(orderCode);
                    const encodedName = encodeURIComponent(accountName);
                    payment_qr_code = `https://img.vietqr.io/image/${bankBin}-${accountNo}-compact2.png?amount=${totalAmount}&addInfo=${encodedContent}&accountName=${encodedName}`;
                    
                    // Lưu mã QR vào DB để trang chi tiết đơn hàng tra cứu được
                    const { savePaymentLinkData } = await import('./orderService.js');
                    savePaymentLinkData(orderCode, {
                        qrCode: payment_qr_code,
                        qrUrl: payment_qr_code
                    });
                }
            }
            
            // Trả về JSON cho Web Next.js
            res.json({
                ok: true,
                data: {
                    order_code: orderCode,
                    payment_checkout_url: null, // Sẽ dùng QR trực tiếp
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
                    
                    if (customerId && customerId !== 'web_user') {
                        await discordChannel.send({ content: `<@${customerId}> — Đơn hàng từ Web của bạn đã tạo ticket này!` }).catch(() => null);
                    } else {
                        await discordChannel.send({ content: `🔔 Có đơn hàng mới từ Web! Đơn hàng: **${orderCode}**.` }).catch(() => null);
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
                                const { container, actionRow } = buildOrderCreatedV2(order, guildConfig.order_log_channel_id);
                                
                                container.addFields([
                                    { name: 'Khách hàng Web', value: `👤 Contact: ${contact || 'Không có'}\n🆔 Discord: <@${customerId}>`, inline: true },
                                    { name: 'Ghi chú đơn', value: `📝 ${note || 'Không có Ghi chú'}`, inline: true }
                                ]);
                                
                                const orderLogMsg = await orderLogChannel.send({ embeds: [container], components: [actionRow] }).catch(() => null);
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
            res.status(500).json({ ok: false, error: e.message });
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

            const channelId = order.ticket_channel_id;
            if (!channelId || channelId === 'web' || channelId.startsWith('web-')) {
                return res.json({ ok: true, messages: [] });
            }

            const client = req.app.locals.discordClient;
            if (!client) {
                return res.json({ ok: true, messages: [] });
            }

            const guildId = order.guild_id || process.env.PRIMARY_GUILD_ID || '1264259885827391629';
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
                    authorType = 'staff';
                    authorName = m.member?.displayName || m.author?.displayName || m.author?.username || 'Staff';
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
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/bot/orders/:code/chat', async (req, res) => {
        try {
            const code = String(req.params.code || '').toUpperCase();
            const { content } = req.body;
            if (!content) return res.status(400).json({ ok: false, error: 'Tin nhắn không được để trống' });

            const order = db.prepare(`SELECT * FROM orders WHERE order_code = ?`).get(code);
            if (!order) {
                return res.status(404).json({ ok: false, error: 'Không tìm thấy đơn hàng' });
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
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── GENERAL TICKETS — tạo ticket hỗ trợ trực tuyến ─────────
    app.post('/api/bot/tickets/start', async (req, res) => {
        try {
            const { contact, discord_id } = req.body;
            if (!contact) return res.status(400).json({ ok: false, error: 'Thiếu thông tin liên hệ (tên/SĐT)' });

            const guildId = process.env.PRIMARY_GUILD_ID || '1264259885827391629';
            const customerId = discord_id || 'web_user';
            
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

                    await discordChannel.send({
                        content: `🔔 **YÊU CẦU HỖ TRỢ TRỰC TUYẾN TỪ WEB**\n👤 Liên hệ: **${contact}**\n🆔 Discord: ${customerId === 'web_user' ? 'Khách vãng lai' : `<@${customerId}>`}`
                    }).catch(() => null);
                } catch (err) {
                    console.error('[LIVE CHAT START] Lỗi gửi welcome embed:', err);
                }
            }

            res.json({ ok: true, data: { ticket_code: ticket.ticket_code } });
        } catch (e) {
            console.error('[LIVE CHAT START API ERROR]', e);
            res.status(500).json({ ok: false, error: e.message });
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

            const ticketStatus = ticket.status; // OPEN, CLOSED, etc.
            const channelId = ticket.channel_id;
            if (!channelId || channelId === 'web' || channelId.startsWith('live-')) {
                return res.json({ ok: true, messages: [], status: ticketStatus });
            }

            const client = req.app.locals.discordClient;
            if (!client) {
                return res.json({ ok: true, messages: [], status: ticketStatus });
            }

            const guildId = ticket.guild_id || process.env.PRIMARY_GUILD_ID || '1264259885827391629';
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
                    authorType = 'staff';
                    authorName = m.member?.displayName || m.author?.displayName || m.author?.username || 'Staff';
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

            res.json({ ok: true, messages: formatted, status: ticketStatus });
        } catch (e) {
            console.error('[TICKET CHAT GET API ERROR]', e);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    app.post('/api/bot/tickets/:code/chat', async (req, res) => {
        try {
            const code = String(req.params.code || '').toUpperCase();
            const { content } = req.body;
            if (!content) return res.status(400).json({ ok: false, error: 'Tin nhắn không được để trống' });

            const ticket = db.prepare(`SELECT * FROM tickets WHERE ticket_code = ?`).get(code);
            if (!ticket) {
                return res.status(404).json({ ok: false, error: 'Không tìm thấy ticket' });
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
                await channel.send({ content: `**[Khách từ Web]**: ${content}` });
                return res.json({ ok: true });
            } else {
                return res.status(503).json({ ok: false, error: 'Không thể kết nối với hỗ trợ Discord lúc này' });
            }
        } catch (e) {
            console.error('[TICKET CHAT POST API ERROR]', e);
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    console.log('[BOT_API] Registered /api/bot/* routes');
}

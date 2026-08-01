import express from 'express';
import path from 'node:path';
import { registerDashboardRoutes, registerWebSocketUpgrade } from './dashboardMiniServer.js';
import { handlePayOSWebhook } from './paymentService.js';
import { registerBotApiRoutes } from './botApiRoutes.js';
import { registerAuthRoutes } from './authApiRoutes.js';
import { registerAdminRoutes } from './adminApiRoutes.js';
import { registerOauthRoutes } from './oauthBackupRoutes.js';
import {
  securityHeaders,
  generalLimiter,
  webhookLimiter,
  trustedBotApiLimiter,
  isTrustedBotApiRequest,
} from './rateLimitMiddleware.js';
import { applyCors } from '../utils/cors.js';
import { handleCardSwapCallback } from './cardSwapService.js';
import { config } from '../config.js';
import { db } from '../database/db.js';

let httpServer = null;
let appInstance = null;

function getBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, '');
}

function getWebhookPath() {
  return String(process.env.PAYOS_WEBHOOK_PATH ?? '/webhooks/payos').trim() || '/webhooks/payos';
}

function getReturnPath() {
  return String(process.env.PAYOS_RETURN_PATH ?? '/payments/payos/return').trim() || '/payments/payos/return';
}

function getCancelPath() {
  return String(process.env.PAYOS_CANCEL_PATH ?? '/payments/payos/cancel').trim() || '/payments/payos/cancel';
}

function renderPage(title, lines = []) {
  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body{font-family:Arial,sans-serif;background:#0f172a;color:#e5e7eb;padding:24px}
    .card{background:#111827;border:1px solid #334155;border-radius:16px;padding:20px;max-width:720px}
    h1{margin:0 0 12px 0}
    p{opacity:.95}
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    ${lines.map((line) => `<p>${line}</p>`).join('')}
  </div>
</body>
</html>`;
}

export function registerPaymentRoutes(app) {
  app.get('/health', (req, res) => {
    res.json({ ok: true, service: 'cenar-store-http-server' });
  });

  app.get(getReturnPath(), (req, res) => {
    const webUrl = process.env.WEBSITE_URL || 'https://cenarstore.xyz';
    const payosOrderCode = Number(req.query.orderCode);
    const order = Number.isSafeInteger(payosOrderCode)
      ? db.prepare('SELECT order_code FROM orders WHERE payos_order_code = ?').get(payosOrderCode)
      : null;
    if (order?.order_code) {
      return res.redirect(`${webUrl}/orders/${encodeURIComponent(order.order_code)}?payment=success`);
    }
    const topup = Number.isSafeInteger(payosOrderCode)
      ? db.prepare('SELECT topup_code FROM wallet_topup_orders WHERE payos_order_code = ?').get(payosOrderCode)
      : null;
    if (topup?.topup_code) {
      return res.redirect(`${webUrl}/account/wallet?payment=success&topup=${encodeURIComponent(topup.topup_code)}`);
    }
    return res.redirect(`${webUrl}/payment?status=success`);
  });

  app.get(getCancelPath(), (req, res) => {
    const webUrl = process.env.WEBSITE_URL || 'https://cenarstore.xyz';
    const payosOrderCode = Number(req.query.orderCode);
    const order = Number.isSafeInteger(payosOrderCode)
      ? db.prepare('SELECT order_code FROM orders WHERE payos_order_code = ?').get(payosOrderCode)
      : null;
    if (order?.order_code) {
      return res.redirect(`${webUrl}/orders/${encodeURIComponent(order.order_code)}?payment=cancel`);
    }
    const topup = Number.isSafeInteger(payosOrderCode)
      ? db.prepare('SELECT topup_code FROM wallet_topup_orders WHERE payos_order_code = ?').get(payosOrderCode)
      : null;
    if (topup?.topup_code) {
      return res.redirect(`${webUrl}/account/wallet?payment=cancel&topup=${encodeURIComponent(topup.topup_code)}`);
    }
    return res.redirect(`${webUrl}/payment?status=cancel`);
  });

  app.get(getWebhookPath(), (req, res) => {
    res.status(200).json({
      ok: true,
      message: 'PayOS webhook endpoint is alive. Use POST for webhook payloads.',
    });
  });

  app.post(getWebhookPath(), async (req, res) => {
    try {
      const result = await handlePayOSWebhook({
        client: req.app.locals.discordClient,
        body: req.body,
      });
      return res.status(result.status ?? 200).json(result.body ?? { ok: true });
    } catch (error) {
      console.error('[WEBHOOK] Lỗi xử lý PayOS webhook:', error);
      return res.status(500).json({
        error: 1,
        message: error.message || 'Webhook processing failed',
      });
    }
  });

  app.get('/api/public/cardswap/callback', async (req, res) => {
    try {
      await handleCardSwapCallback(req.query, req.app.locals.discordClient);
      res.status(200).send('OK');
    } catch (e) {
      console.error('[CARDSWAP WEBHOOK] Lỗi xử lý callback:', e.message);
      res.status(400).send('ERROR');
    }
  });
}


export async function startWebhookServer(client = null) {
  if (httpServer) {
    if (appInstance && client) appInstance.locals.discordClient = client;
    return { app: appInstance, server: httpServer };
  }

  const app = express();
  appInstance = app;
  app.locals.discordClient = client;

  // Global CORS Middleware (allowlist-based)
  app.use((req, res, next) => {
    if (applyCors(req, res)) return;
    next();
  });

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Security headers (helmet-lite — no external dependency)
  app.use(securityHeaders);

  // Public callers stay on the strict limiter. The authenticated website backend
  // gets its own budget so a hosting reverse proxy cannot collapse all traffic
  // into one IP bucket and take the storefront catalog offline.
  app.use('/api/', (req, res, next) => {
    const limiter = isTrustedBotApiRequest(req) ? trustedBotApiLimiter : generalLimiter;
    limiter(req, res, next);
  });
  app.use('/webhooks/', webhookLimiter);
  
  // Serve static transcripts
  app.use('/transcripts', express.static(path.join(process.cwd(), 'data', 'transcripts')));

  registerPaymentRoutes(app);
  registerDashboardRoutes(app);
  registerBotApiRoutes(app);
  registerAuthRoutes(app);
  registerOauthRoutes(app);
  registerAdminRoutes(app);

  const port = config.httpPort;

  httpServer = await new Promise((resolve, reject) => {
    const server = app.listen(port, '0.0.0.0', () => resolve(server));
    server.on('error', reject);
  });

  console.log(`[WEBHOOK] HTTP server listening on port ${port}`);
  console.log(`[WEBHOOK] PayOS path: ${getWebhookPath()}`);

  // Register WebSocket upgrade handler
  registerWebSocketUpgrade(httpServer);

  const baseUrl = getBaseUrl();
  if (baseUrl) {
    console.log(`[WEBHOOK] Public PayOS URL: ${baseUrl}${getWebhookPath()}`);
    console.log(`[WEBHOOK] Return URL: ${baseUrl}${getReturnPath()}`);
    console.log(`[WEBHOOK] Cancel URL: ${baseUrl}${getCancelPath()}`);
    if (String(process.env.DASHBOARD_ENABLED ?? 'false').toLowerCase() === 'true') {
      console.log(`[WEBHOOK] Dashboard URL: ${baseUrl}/dashboard`);
    }
  }

  return { app, server: httpServer };
}

export async function stopWebhookServer() {
  if (!httpServer) return;
  await new Promise((resolve) => httpServer.close(() => resolve()));
  httpServer = null;
  appInstance = null;
}

import { afterEach, expect, it, vi } from 'vitest';

const { payos } = vi.hoisted(() => ({ payos: vi.fn() }));
vi.mock('../src/services/paymentService.js', () => ({ handlePayOSWebhook: payos }));
vi.mock('../src/services/binancePayService.js', () => ({ handleBinancePayWebhook: vi.fn() }));
vi.mock('../src/services/dashboardMiniServer.js', () => ({ registerDashboardRoutes: vi.fn(), registerWebSocketUpgrade: vi.fn() }));
vi.mock('../src/services/botApiRoutes.js', () => ({ registerBotApiRoutes: vi.fn() }));
vi.mock('../src/services/authApiRoutes.js', () => ({ registerAuthRoutes: vi.fn() }));
vi.mock('../src/services/adminApiRoutes.js', () => ({ registerAdminRoutes: vi.fn() }));
vi.mock('../src/services/oauthBackupRoutes.js', () => ({ registerOauthRoutes: vi.fn() }));
vi.mock('../src/services/rateLimitMiddleware.js', () => ({}));
vi.mock('../src/services/cardSwapService.js', () => ({ handleCardSwapCallback: vi.fn() }));
vi.mock('../src/config.js', () => ({ config: {
  binancePayWebhookPath: '/webhooks/binance',
  binancePayReturnPath: '/binance/return',
  binancePayCancelPath: '/binance/cancel',
} }));
vi.mock('../src/database/db.js', () => ({ db: {} }));

import { registerPaymentRoutes } from '../src/services/webhookServer.js';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it('returns a retryable error and never echoes private PayOS callback details', async () => {
  vi.stubEnv('PAYOS_WEBHOOK_PATH', '/webhooks/payos-test');
  const routes = new Map();
  registerPaymentRoutes({ get() {}, post: (path, handler) => routes.set(path, handler) });
  payos.mockRejectedValueOnce(Object.assign(new Error('private-bank-data'), {
    code: 'SQLITE_BUSY', config: { headers: { Authorization: 'test-secret' } },
  }));
  const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});

  await routes.get('/webhooks/payos-test')({ app: { locals: {} }, body: {} }, response);

  expect(response.status).toHaveBeenCalledWith(500);
  expect(response.json).toHaveBeenCalledWith({ error: 1, message: 'Webhook processing failed' });
  expect(log.mock.calls).toEqual([['[PAYOS] Lỗi xử lý callback thanh toán', { code: 'SQLITE_BUSY', status: undefined }]]);
});

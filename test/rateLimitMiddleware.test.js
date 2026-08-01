import { afterEach, describe, expect, test } from 'vitest';
import { isTrustedBotApiRequest } from '../src/services/rateLimitMiddleware.js';

const originalBotApiKey = process.env.BOT_API_KEY;

afterEach(() => {
  if (originalBotApiKey === undefined) delete process.env.BOT_API_KEY;
  else process.env.BOT_API_KEY = originalBotApiKey;
});

function request(url, key) {
  return {
    originalUrl: url,
    header: (name) => (name.toLowerCase() === 'x-bot-api-key' ? key : undefined),
  };
}

describe('trusted bot API request detection', () => {
  test('accepts the configured server key only on bot API routes', () => {
    process.env.BOT_API_KEY = 'production-server-key';

    expect(isTrustedBotApiRequest(request('/api/bot/products?active=1', 'production-server-key'))).toBe(true);
    expect(isTrustedBotApiRequest(request('/api/admin/products', 'production-server-key'))).toBe(false);
  });

  test('keeps missing and invalid keys on the strict public limiter', () => {
    process.env.BOT_API_KEY = 'production-server-key';

    expect(isTrustedBotApiRequest(request('/api/bot/products', 'wrong-key'))).toBe(false);
    expect(isTrustedBotApiRequest(request('/api/bot/products'))).toBe(false);
  });

  test('fails closed when the server key is not configured', () => {
    delete process.env.BOT_API_KEY;

    expect(isTrustedBotApiRequest(request('/api/bot/products', 'any-key'))).toBe(false);
  });
});

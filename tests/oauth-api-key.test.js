import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let isOAuthApiKeyAuthorized;
const originalApiKey = process.env.BOT_API_KEY;

beforeAll(async () => {
  process.env.BOT_API_KEY = 'oauth-test-key';
  ({ isOAuthApiKeyAuthorized } = await import('../src/services/oauthBackupRoutes.js'));
});

afterAll(() => {
  if (originalApiKey === undefined) delete process.env.BOT_API_KEY;
  else process.env.BOT_API_KEY = originalApiKey;
});

describe('OAuth backup API key transport', () => {
  it('accepts the key from the header', () => {
    expect(isOAuthApiKeyAuthorized({
      headers: { 'x-bot-api-key': 'oauth-test-key' },
      query: {},
    })).toBe(true);
  });

  it('rejects a key supplied through the query string', () => {
    expect(isOAuthApiKeyAuthorized({
      headers: {},
      query: { api_key: 'oauth-test-key' },
    })).toBe(false);
  });
});


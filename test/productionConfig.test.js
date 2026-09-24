import { describe, expect, it } from 'vitest';
import { collectProductionConfigIssues } from '../src/config.js';

const coreSecrets = {
  ENCRYPTION_KEY: 'a'.repeat(64),
  BOT_API_KEY: 'bot_' + 'b'.repeat(48),
};

describe('production environment security checks', () => {
  it('fails closed when core encryption/API secrets are absent', () => {
    const issues = collectProductionConfigIssues({
      env: { DASHBOARD_ENABLED: 'false' },
      requireDashboard: false,
      requireOAuth: false,
    });

    expect(issues).toEqual(expect.arrayContaining(['Thiếu ENCRYPTION_KEY', 'Thiếu BOT_API_KEY']));
  });

  it('rejects sample placeholders for core and enabled dashboard secrets', () => {
    const issues = collectProductionConfigIssues({
      env: {
        ENCRYPTION_KEY: 'YOUR_64_CHAR_HEX_KEY',
        BOT_API_KEY: 'YOUR_BOT_API_KEY',
        DASHBOARD_ENABLED: 'true',
        DASHBOARD_TOKEN: 'YOUR_DASHBOARD_TOKEN',
      },
    });

    expect(issues).toEqual(expect.arrayContaining([
      'ENCRYPTION_KEY vẫn đang dùng placeholder',
      'BOT_API_KEY vẫn đang dùng placeholder',
      'DASHBOARD_TOKEN vẫn đang dùng placeholder',
    ]));
  });

  it('requires OAuth client credentials only when the OAuth flow is enabled', () => {
    expect(collectProductionConfigIssues({
      env: { ...coreSecrets, OAUTH_ENABLED: 'true' },
    })).toContain('Thiếu CLIENT_SECRET');

    expect(collectProductionConfigIssues({
      env: coreSecrets,
      requireDashboard: false,
      requireOAuth: false,
    })).toEqual([]);
  });

  it('rejects an OAuth placeholder even when the optional flow is disabled', () => {
    const issues = collectProductionConfigIssues({
      env: { ...coreSecrets, CLIENT_SECRET: 'CLIENT_SECRET_HERE' },
      requireDashboard: false,
      requireOAuth: false,
    });

    expect(issues).toContain('CLIENT_SECRET vẫn đang dùng placeholder');
  });
});

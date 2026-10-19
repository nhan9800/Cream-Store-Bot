import { describe, expect, it } from 'vitest';
import { resolveOAuthCallbackStore } from '../src/utils/oauthCallbackRouting.js';

const hint = (payload) => `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.routingOnlySignature`;
describe('shared registered OAuth callback routing', () => {
  it('routes the second application to Store 2 without changing its registered redirect URI', () => {
    const state = hint({ v: 1, clientId: '1139187282075721768', store: 'store2' });
    expect(resolveOAuthCallbackStore(`/oauth/callback?code=once&state=${state}`)).toBe('store2');
    expect(resolveOAuthCallbackStore(`/oauth/callback?error=access_denied&state=${state}`)).toBe('store2');
  });
  it('leaves Store 1 and legacy in-flight states on Store 1', () => {
    expect(resolveOAuthCallbackStore(`/oauth/callback?state=${hint({ v: 1, store: 'store1', clientId: '1382729296724099132' })}`)).toBe('store1');
    expect(resolveOAuthCallbackStore(`/oauth/callback?state=${hint({ v: 1, guildId: '1282637033340403754' })}`)).toBe('store1');
  });
  it.each([
    '/oauth/login?state=broken', '/unrelated?state=broken', '/oauth/callback',
    '/oauth/callback?state=%not_base64', '/oauth/callback?state=a.b&state=a.b',
    `/oauth/callback?state=${hint({ v: 1, clientId: 'bad', store: 'store2' })}`,
    `/oauth/callback?state=${hint({ v: 2, clientId: '1139187282075721768', store: 'store2' })}`,
    `/oauth/callback?state=${'a'.repeat(2049)}.sig`,
  ])('does not derive any alternate target from malformed input: %s', (url) => {
    expect(resolveOAuthCallbackStore(url)).toBe('store1');
  });
});

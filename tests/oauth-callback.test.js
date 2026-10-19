import express from 'express';
import { Collection, PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  config: { clientId: '1382729296724099132', guildId: '1282637033340403754', publicBaseUrl: 'https://api.example.test/' },
  run: vi.fn(), snapshot: vi.fn().mockResolvedValue(undefined), memberSnapshot: vi.fn(),
}));
vi.mock('../src/config.js', () => ({ config: fixtures.config }));
vi.mock('../src/database/db.js', () => ({ db: { prepare: vi.fn(() => ({ run: fixtures.run })) } }));
vi.mock('../src/utils/crypto.js', () => ({ encrypt: (value) => `encrypted:${value}` }));
vi.mock('../src/services/guildRecoveryService.js', () => ({ snapshotGuildForRecovery: fixtures.snapshot, updateOauthMemberSnapshot: fixtures.memberSnapshot }));
vi.mock('../src/services/verificationPanelService.js', () => ({ buildVerificationSuccessDmV2: () => ({ content: 'Verified test' }) }));

import { registerOauthRoutes } from '../src/services/oauthBackupRoutes.js';
import { createOAuthState, oauthStateCookieName, verifyOAuthState } from '../src/utils/oauthState.js';
import { resolveOAuthCallbackStore } from '../src/utils/oauthCallbackRouting.js';

const nativeFetch = globalThis.fetch;
const guildId = fixtures.config.guildId;
const memberId = '200000000000000001';
let server, base, guild, member, upstream;

beforeAll(async () => {
  const app = express();
  app.locals.discordClient = { isReady: () => true, guilds: { fetch: async (id) => id === guildId ? guild : null } };
  registerOauthRoutes(app);
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  vi.stubEnv('CLIENT_SECRET', 'test-client-secret');
  vi.stubEnv('ENCRYPTION_KEY', 'test-state-and-token-encryption');
  vi.stubEnv('OAUTH_STATE_SECRET', 'test-state-key');
  vi.stubEnv('ENV_FILE', '.env');
  vi.stubEnv('VERIFIED_ROLE_ID', '');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  fixtures.run.mockClear(); fixtures.snapshot.mockClear(); fixtures.memberSnapshot.mockClear();
  member = { roles: { cache: new Collection(), add: vi.fn().mockResolvedValue(undefined) }, send: vi.fn().mockResolvedValue(undefined) };
  const role = { id: '1282638730812854345', name: '⌘ Cenar Explorer', managed: false, position: 5, permissions: new PermissionsBitField(67108864n) };
  guild = { id: guildId, name: 'Cenar test', roles: { cache: new Collection([[role.id, role]]) }, members: {
    me: { permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles), roles: { highest: { position: 37 } } },
    fetch: vi.fn().mockResolvedValue(member),
  } };
  upstream = vi.fn(async (url) => new Response(JSON.stringify(String(url).endsWith('/token')
    ? { access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 604800, scope: 'identify guilds.join' }
    : { id: memberId, username: 'Test Member', discriminator: '0' }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', upstream);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

async function callback({ state, error, code = 'one-use-code', cookie = true, extraCookie = '' } = {}) {
  const session = state ?? createOAuthState(guildId, Date.now(), { clientId: fixtures.config.clientId, store: 'store1' });
  const query = new URLSearchParams({ state: session });
  if (code !== null) query.set('code', code);
  if (error) { query.set('error', error); query.set('error_description', '<script>private-provider-text</script>'); }
  const headers = cookie ? { cookie: `${oauthStateCookieName(fixtures.config.clientId)}=${encodeURIComponent(session)}${extraCookie}` } : {};
  return nativeFetch(`${base}/oauth/callback?${query}`, { headers });
}

describe('verification callback integrity and delivery', () => {
  it('uses canonical Discord authorize URL, normalized URI, exact scopes and signed application/store routing', async () => {
    vi.stubEnv('ENV_FILE', '.env.store2');
    const r = await nativeFetch(`${base}/oauth/login`, { redirect: 'manual' });
    const url = new URL(r.headers.get('location'));
    expect(r.status).toBe(302); expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(url.searchParams.get('scope')).toBe('identify guilds.join');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.test/oauth/callback');
    const state = url.searchParams.get('state');
    expect(verifyOAuthState(state, state)).toMatchObject({ clientId: fixtures.config.clientId, store: 'store2', guildId });
    expect(resolveOAuthCallbackStore(`/oauth/callback?state=${state}`)).toBe('store2');
    expect(r.headers.get('cache-control')).toContain('no-store');
    expect(r.headers.get('set-cookie')).toContain('Path=/oauth/callback; HttpOnly; SameSite=Lax; Secure');
  });
  it('grants the renamed real Explorer role only after signed OAuth and matching membership, encrypting stored tokens', async () => {
    const r = await callback({ extraCookie: '; unrelated=%E0%A4%A' });
    expect(r.status).toBe(200);
    expect(member.roles.add).toHaveBeenCalledWith(guild.roles.cache.first());
    expect(fixtures.run).toHaveBeenCalledWith(memberId, guildId, 'encrypted:access-test', 'encrypted:refresh-test', expect.any(String), 'Test Member', null, null, 'identify guilds.join');
    expect(member.send).toHaveBeenCalledTimes(1);
    expect(r.headers.get('cache-control')).toContain('no-store');
    expect(await r.text()).toContain('Xác Minh Thành Công');
  });
  it('does not send repeated welcome DMs to already verified members', async () => {
    member.roles.cache.set(guild.roles.cache.first().id, guild.roles.cache.first());
    expect((await callback()).status).toBe(200);
    expect(member.roles.add).not.toHaveBeenCalled(); expect(member.send).not.toHaveBeenCalled();
  });
  it.each(['no-cookie', 'tampered', 'expired', 'wrong-application', 'wrong-store'])('rejects %s before Discord token exchange or mutations', async (kind) => {
    let state = createOAuthState(guildId, kind === 'expired' ? Date.now() - 700000 : Date.now(), {
      clientId: kind === 'wrong-application' ? '1139187282075721768' : fixtures.config.clientId, store: kind === 'wrong-store' ? 'store2' : 'store1',
    });
    if (kind === 'tampered') state += 'a';
    expect((await callback({ state, cookie: kind !== 'no-cookie' })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled(); expect(fixtures.run).not.toHaveBeenCalled(); expect(member.roles.add).not.toHaveBeenCalled();
  });
  it('shows cancellation safely without reflecting provider text or claiming a role was granted', async () => {
    const r = await callback({ error: 'access_denied', code: null });
    expect(r.status).toBe(400); const html = await r.text();
    expect(html).toContain('Bạn đã hủy hoặc từ chối'); expect(html).not.toContain('private-provider-text');
    expect(upstream).not.toHaveBeenCalled(); expect(fixtures.run).not.toHaveBeenCalled();
  });
  it('reports other Discord authorization restrictions without reflecting provider content', async () => {
    const r = await callback({ error: 'arbitrary-private-error', code: null });
    expect(r.status).toBe(400); const html = await r.text();
    expect(html).toContain('bot bị hạn chế chống spam'); expect(html).not.toContain('arbitrary-private-error');
    expect(upstream).not.toHaveBeenCalled();
  });
  it('handles Discord timeout without changing DB or roles, and applies a request deadline', async () => {
    upstream.mockRejectedValueOnce(new DOMException('request timed out', 'TimeoutError'));
    const r = await callback();
    expect(r.status).toBe(504); expect(await r.text()).toContain('quá thời gian chờ');
    expect(upstream.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(fixtures.run).not.toHaveBeenCalled(); expect(member.roles.add).not.toHaveBeenCalled();
  });
  it('does not log raw Discord failure bodies', async () => {
    upstream.mockResolvedValueOnce(new Response('private-token-body', { status: 403 }));
    const r = await callback();
    expect(r.status).toBe(502); expect(await r.text()).not.toContain('private-token-body');
    expect(JSON.stringify(console.error.mock.calls)).not.toContain('private-token-body');
    expect(fixtures.run).not.toHaveBeenCalled();
  });
  it('rejects insufficient consent or invalid identity without storing tokens or granting roles', async () => {
    upstream.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', scope: 'identify', expires_in: 500 })));
    expect((await callback()).status).toBe(502);
    expect(fixtures.run).not.toHaveBeenCalled(); expect(member.roles.add).not.toHaveBeenCalled();
  });
  it('does not grant roles when the authorized account is not a guild member', async () => {
    guild.members.fetch.mockResolvedValueOnce(null);
    expect((await callback()).status).toBe(400);
    expect(fixtures.run).not.toHaveBeenCalled(); expect(member.roles.add).not.toHaveBeenCalled();
  });
});

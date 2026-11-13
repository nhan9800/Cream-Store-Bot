import Database from 'better-sqlite3';
import express from 'express';
import http from 'node:http';
import { Collection } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/database/db.js', () => ({ db: {} }));
vi.mock('../src/config.js', () => ({ config: {} }));
import { registerOauthRoutes } from '../src/services/oauthBackupRoutes.js';
import { createOAuthRequestGuard } from '../src/services/oauthRequestGuard.js';
import { createOAuthState, oauthStateCookieName } from '../src/utils/oauthState.js';

const guildId = '1282637033340403754', clientId = '1382729296724099132', userId = '1138315103821889566';
const databases = [], servers = [];
beforeEach(() => {
  for (const [key, value] of Object.entries({ ENV_FILE: '.env', CLIENT_SECRET: 'synthetic-client-secret', ENCRYPTION_KEY: 'synthetic-encryption-key',
    OAUTH_STATE_SECRET: 'synthetic-state-signing-key', VERIFIED_ROLE_ID: '' })) vi.stubEnv(key, value);
  vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
  for (const database of databases.splice(0)) database.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function fixture(options = {}) {
  const database = options.database || new Database(':memory:'); if (!options.database) databases.push(database);
  database.exec(`CREATE TABLE IF NOT EXISTS oauth_backups(discord_id TEXT,guild_id TEXT,access_token TEXT,refresh_token TEXT,
    token_expires_at TEXT,username TEXT,email TEXT,avatar TEXT,scopes TEXT,recovery_consent_at TEXT,verified_at TEXT,UNIQUE(discord_id,guild_id));`);
  let time = Date.parse('2026-11-14T02:00:00Z');
  const role = { id: '1282638730812854345', name: 'Cenar Explorer', position: 1, permissions: 0n, editable: true };
  const member = { id: userId, guild: { id: guildId }, roles: { cache: new Collection(), add: vi.fn(async () => { member.roles.cache.set(role.id, role); }) },
    send: vi.fn(async () => ({ id: '1555555555555555555' })) };
  const guild = { id: guildId, name: 'Cenar Store', roles: { cache: new Collection([[role.id, role]]) }, members: { fetch: vi.fn(async () => member) } };
  const client = { isReady: () => true, guilds: { fetch: vi.fn(async () => guild) } };
  const fetchImpl = options.fetchImpl || vi.fn(async url => url.endsWith('/token')
    ? new Response(JSON.stringify({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', scope: 'identify guilds.join', expires_in: 3600 }))
    : new Response(JSON.stringify({ id: userId, username: 'synthetic-user', discriminator: '0' })));
  const snapshotGuild = options.snapshotGuild || vi.fn(async () => ({})), updateMemberSnapshot = vi.fn();
  const configuration = { clientId, guildId, publicBaseUrl: 'https://shop.example', ...options.configuration };
  const guard = createOAuthRequestGuard({ database, now: () => time });
  const app = express(); app.locals.discordClient = client;
  registerOauthRoutes(app, { database, configuration, requestGuard: guard, fetchImpl, now: () => time,
    encryptTokens: value => `enc:v1:${Buffer.from(value).toString('base64')}`, snapshotGuild, updateMemberSnapshot, buildSuccessDm: () => ({ content: 'Verified' }) });
  const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); }); servers.push(server);
  const request = (path, cookie) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path, headers: cookie ? { Cookie: cookie } : {} }, res => {
      let body = ''; res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }); req.on('error', reject); req.end();
  });
  const state = patch => createOAuthState(guildId, time, { clientId: configuration.clientId, store: 'store1', ...patch });
  const cookie = value => `${oauthStateCookieName(configuration.clientId)}=${encodeURIComponent(value)}`;
  const callback = (value, suffix = '') => request(`/oauth/callback?code=synthetic-code&state=${encodeURIComponent(value)}${suffix}`, cookie(value));
  return { database, guard, request, state, cookie, callback, fetchImpl, member, client, guild, snapshotGuild, updateMemberSnapshot,
    advance: ms => { time += ms; } };
}

// Minimal RFC6265 path-aware jar: exercise real HTTP Set-Cookie and request
// headers, including two same-named cookies with distinct legacy/current paths.
function jar() {
  const cookies = new Map();
  return { absorb(response) { for (const raw of response.headers['set-cookie'] || []) {
    const [pair, ...attributes] = raw.split(';').map(value => value.trim());
    const path = attributes.find(value => value.startsWith('Path='))?.slice(5) || '/';
    const name = pair.split('=')[0], key = `${name}:${path}`;
    if (attributes.includes('Max-Age=0')) cookies.delete(key); else cookies.set(key, { pair, path });
  } }, header(path) { return [...cookies.values()].filter(item => path === item.path || path.startsWith(`${item.path}/`)).map(item => item.pair).join('; '); } };
}

describe('real HTTP OAuth callback rate/replay handling', () => {
  it('serializes same-member completions through fresh membership and leaves the later queued grant canonical', async () => {
    let issued = 0;
    const fetchImpl = vi.fn(async url => url.endsWith('/token')
      ? Response.json({ access_token: `access-${++issued}`, refresh_token: `refresh-${issued}`, scope: 'identify guilds.join', expires_in: 3600 })
      : Response.json({ id: userId, username: 'synthetic-user' }));
    const t = await fixture({ fetchImpl });
    let release; const gate = new Promise(resolve => { release = resolve; });
    t.guild.members.fetch.mockImplementationOnce(async () => { await gate; return t.member; }).mockResolvedValue(t.member);
    const first = t.callback(t.state());
    await vi.waitFor(() => expect(t.guild.members.fetch).toHaveBeenCalledOnce());
    t.advance(1); const second = t.callback(t.state());
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4));
    expect(t.guild.members.fetch).toHaveBeenCalledOnce();
    release(); const results = await Promise.all([first, second]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(t.database.prepare('SELECT access_token,refresh_token FROM oauth_backups').get()).toEqual({
      access_token: `enc:v1:${Buffer.from('access-2').toString('base64')}`, refresh_token: `enc:v1:${Buffer.from('refresh-2').toString('base64')}` });
    expect(t.guild.members.fetch.mock.calls).toEqual([[{ user: userId, force: true }], [{ user: userId, force: true }]]);
    expect(t.member.send).toHaveBeenCalledOnce();
  });
  it('keeps another member completion independent of a stalled membership read', async () => {
    const otherId = '1138315103821889567'; let profiles = 0;
    const fetchImpl = vi.fn(async url => url.endsWith('/token')
      ? Response.json({ access_token: 'access', refresh_token: 'refresh', scope: 'identify guilds.join', expires_in: 3600 })
      : Response.json({ id: ++profiles === 1 ? userId : otherId, username: 'synthetic-user' }));
    const t = await fixture({ fetchImpl });
    const other = { ...t.member, id: otherId, roles: { cache: new Collection(), add: vi.fn(async () => {}) }, send: vi.fn(async () => ({ id: '1555555555555555556' })) };
    let release; const gate = new Promise(resolve => { release = resolve; });
    t.guild.members.fetch.mockImplementation(async ({ user }) => { if (user === userId) { await gate; return t.member; } return other; });
    const first = t.callback(t.state()); await vi.waitFor(() => expect(t.guild.members.fetch).toHaveBeenCalledOnce());
    expect((await t.callback(t.state())).status).toBe(200); expect(other.send).toHaveBeenCalledOnce();
    expect(t.member.send).not.toHaveBeenCalled(); release(); expect((await first).status).toBe(200);
  });
  it('releases a failed member turn so a queued valid callback can finish', async () => {
    const t = await fixture(); let release; const gate = new Promise(resolve => { release = resolve; });
    t.guild.members.fetch.mockImplementationOnce(async () => { await gate; return null; }).mockResolvedValue(t.member);
    const first = t.callback(t.state()); await vi.waitFor(() => expect(t.guild.members.fetch).toHaveBeenCalledOnce());
    const next = t.callback(t.state()); await vi.waitFor(() => expect(t.fetchImpl).toHaveBeenCalledTimes(4));
    release(); expect((await first).status).toBe(400); expect((await next).status).toBe(200);
    expect(t.member.send).toHaveBeenCalledOnce();
  });
  it('returns successful callbacks and releases the member turn while an optional welcome is still pending', async () => {
    const t = await fixture(); let release; const gate = new Promise(resolve => { release = resolve; });
    t.member.roles.add.mockResolvedValue(t.member); // Gateway role cache stays stale.
    t.member.send.mockImplementation(() => gate);
    let firstResponse, secondResponse;
    const first = t.callback(t.state()).then(value => { firstResponse = value; return value; });
    await vi.waitFor(() => expect(t.member.send).toHaveBeenCalledOnce());
    const second = t.callback(t.state()).then(value => { secondResponse = value; return value; });
    try {
      await vi.waitFor(() => {
        expect(firstResponse?.status).toBe(200); expect(secondResponse?.status).toBe(200);
      }, { timeout: 200 });
      expect(t.member.send).toHaveBeenCalledOnce();
      expect(t.database.prepare('SELECT status,message_id FROM oauth_verification_welcomes').get()).toEqual({ status: 'SENDING', message_id: null });
    } finally { release({ id: '1555555555555555555' }); await Promise.all([first, second]); }
    await vi.waitFor(() => expect(t.database.prepare('SELECT status,message_id FROM oauth_verification_welcomes').get())
      .toEqual({ status: 'SENT', message_id: '1555555555555555555' }));
  });
  it('durably coalesces optional welcomes despite a stale Gateway cache, including a route restart', async () => {
    const t = await fixture(), role = t.guild.roles.cache.first();
    t.member.roles.add.mockImplementation(async () => ({ ...t.member, roles: { cache: new Collection([[role.id, role]]) } }));
    expect((await t.callback(t.state())).status).toBe(200); expect((await t.callback(t.state())).status).toBe(200);
    expect(t.member.send).toHaveBeenCalledOnce();
    const restarted = await fixture({ database: t.database });
    expect((await restarted.callback(restarted.state())).status).toBe(200); expect(restarted.member.send).not.toHaveBeenCalled();
    const journal = t.database.prepare('SELECT * FROM oauth_verification_welcomes').get();
    expect(journal).toMatchObject({ client_id: clientId, store: 'store1', guild_id: guildId, discord_id: userId,
      status: 'SENT', message_id: '1555555555555555555' });
    expect(JSON.stringify(journal)).not.toMatch(/access-|refresh-|synthetic-access|synthetic-refresh|synthetic-code/);
    expect(t.member.send.mock.calls[0][0]).toMatchObject({ nonce: expect.any(String), enforceNonce: true, allowedMentions: { parse: [] } });
  });
  it('snapshots the confirmed role from discord.js returned member while Gateway cache is stale', async () => {
    const t = await fixture(), role = t.guild.roles.cache.first();
    const updated = { ...t.member, roles: { cache: new Collection([[role.id, role]]) } };
    t.member.roles.add.mockResolvedValue(updated);
    expect((await t.callback(t.state())).status).toBe(200);
    expect(t.updateMemberSnapshot).toHaveBeenCalledWith(guildId, updated);
  });
  it.each(['failure', 'unknown', 'interrupted'])('holds an optional welcome after an uncertain %s without blind retry', async kind => {
    const t = await fixture();
    t.member.roles.add.mockResolvedValue(t.member); // Keep Gateway cache stale.
    if (kind === 'failure') t.member.send.mockRejectedValue(new Error('secret-provider-error'));
    if (kind === 'unknown') t.member.send.mockResolvedValue({});
    if (kind === 'interrupted') {
      await t.callback(t.state());
      t.database.prepare("UPDATE oauth_verification_welcomes SET status='SENDING',message_id=NULL").run();
      t.member.send.mockClear();
    }
    expect((await t.callback(t.state())).status).toBe(200); expect((await t.callback(t.state())).status).toBe(200);
    expect(t.member.send).toHaveBeenCalledTimes(kind === 'interrupted' ? 0 : 1);
    const entry = t.database.prepare('SELECT status,message_id FROM oauth_verification_welcomes').get();
    expect(entry).toEqual({ status: kind === 'interrupted' ? 'SENDING' : 'UNKNOWN', message_id: null });
    expect(JSON.stringify(console.warn.mock.calls)).not.toContain('secret-provider-error');
  });
  it.each(['revoked', 'deleted', 'new-grant'])('does not override a canonical %s during the membership wait', async kind => {
    const t = await fixture();
    t.database.prepare(`INSERT INTO oauth_backups(discord_id,guild_id,access_token,refresh_token,scopes,recovery_consent_at,verified_at)
      VALUES(?,?,'enc:previous-access','enc:previous-refresh','identify guilds.join','previous-consent','previous-verify')`).run(userId,guildId);
    let changed;
    t.guild.members.fetch.mockImplementation(async () => {
      if (kind === 'revoked') t.database.prepare('UPDATE oauth_backups SET recovery_consent_at=NULL').run();
      if (kind === 'deleted') t.database.prepare('DELETE FROM oauth_backups').run();
      if (kind === 'new-grant') t.database.prepare("UPDATE oauth_backups SET access_token='enc:new-grant',refresh_token='enc:new-refresh'").run();
      changed = t.database.prepare('SELECT * FROM oauth_backups').get();
      return t.member;
    });
    expect((await t.callback(t.state())).status).toBe(409);
    expect(t.database.prepare('SELECT * FROM oauth_backups').get()).toEqual(changed);
    expect(t.member.roles.add).not.toHaveBeenCalled(); expect(t.member.send).not.toHaveBeenCalled();
    expect(t.updateMemberSnapshot).not.toHaveBeenCalled(); expect(t.snapshotGuild).not.toHaveBeenCalled();
  });
  it('does not welcome or snapshot when consent changes while the role PUT is pending', async () => {
    const t = await fixture();
    t.member.roles.add.mockImplementation(async () => { t.database.prepare('UPDATE oauth_backups SET recovery_consent_at=NULL').run(); });
    expect((await t.callback(t.state())).status).toBe(409);
    expect(t.database.prepare('SELECT recovery_consent_at FROM oauth_backups').get().recovery_consent_at).toBeNull();
    expect(t.member.send).not.toHaveBeenCalled(); expect(t.updateMemberSnapshot).not.toHaveBeenCalled();
  });
  it.each([
    { access_token: '   ' }, { refresh_token: '\t ' }, { scope: ['identify', 'guilds.join'] },
    { scope: 'identify' }, { expires_in: true }, { expires_in: null }, { expires_in: -1 }, { expires_in: 31536001 },
  ])('rejects malformed token metadata before profile or member effects: %j', async patch => {
    const fetchImpl = vi.fn(async () => Response.json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh',
      scope: 'identify guilds.join', expires_in: 3600, ...patch }));
    const t = await fixture({ fetchImpl }); expect((await t.callback(t.state())).status).toBe(502);
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(t.guild.members.fetch).not.toHaveBeenCalled(); expect(t.member.send).not.toHaveBeenCalled();
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM oauth_backups').get().n).toBe(0);
  });
  it.each(['guild', 'member', 'member-guild'])('rejects an incorrectly bound %s before consent or roles', async kind => {
    const t = await fixture();
    if (kind === 'guild') t.guild.id = '1282637033340403755';
    if (kind === 'member') t.member.id = '1138315103821889567';
    if (kind === 'member-guild') t.member.guild.id = '1282637033340403755';
    expect((await t.callback(t.state())).status).toBe(400);
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM oauth_backups').get().n).toBe(0);
    expect(t.member.roles.add).not.toHaveBeenCalled(); expect(t.member.send).not.toHaveBeenCalled();
  });
  it('reuses a browser flow across login tabs using an OAuth-wide cookie without dropping requested scopes', async () => {
    const t = await fixture(), browser = jar();
    const first = await t.request('/oauth/login'); browser.absorb(first);
    const second = await t.request('/oauth/login', browser.header('/oauth/login'));
    expect(first.status).toBe(302); expect(second.status).toBe(302);
    const a = new URL(first.headers.location), b = new URL(second.headers.location);
    expect(a.searchParams.get('state')).toBe(b.searchParams.get('state'));
    expect(a.searchParams.get('scope')).toBe('identify guilds.join');
    expect(browser.header('/oauth/callback')).toContain('cenar_oauth_state_');
    expect(browser.header('/unrelated')).toBe('');
    expect(first.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('Path=/oauth;'), expect.stringContaining('Max-Age=0; Path=/oauth/callback;')]));
  });
  it('persists encrypted consent and returns success without awaiting the coalesced guild snapshot', async () => {
    const snapshotGuild = vi.fn(() => new Promise(() => {})); const t = await fixture({ snapshotGuild });
    const result = await t.callback(t.state()); expect(result.status).toBe(200); expect(result.body).toContain('Xác Minh Thành Công');
    expect(t.member.roles.add).toHaveBeenCalledOnce(); expect(t.member.send).toHaveBeenCalledOnce(); expect(snapshotGuild).toHaveBeenCalledOnce();
    const saved = t.database.prepare('SELECT * FROM oauth_backups').get();
    expect(saved).toMatchObject({ discord_id: userId, guild_id: guildId, scopes: 'identify guilds.join' });
    expect(saved.access_token).toMatch(/^enc:v1:/); expect(result.body).not.toMatch(/synthetic-access|synthetic-refresh|synthetic-code/);
  });
  it('returns Discord token429 with cooldown and prevents new login or code exchange until expiry', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"retry_after":7,"private":"never-reflect-this"}', { status: 429, headers: { 'retry-after': '7' } }));
    const t = await fixture({ fetchImpl }); const first = await t.callback(t.state());
    expect(first.status).toBe(429); expect(first.headers['retry-after']).toBe('7'); expect(first.body).toContain('Không tải lại');
    expect(first.body).not.toContain('never-reflect-this');
    expect((await t.request('/oauth/login')).status).toBe(429);
    expect((await t.callback(t.state())).status).toBe(429); expect(fetchImpl).toHaveBeenCalledOnce();
    expect(t.member.roles.add).not.toHaveBeenCalled(); expect(t.database.prepare('SELECT COUNT(*) AS n FROM oauth_backups').get().n).toBe(0);
    t.advance(7001); expect((await t.request('/oauth/login')).status).toBe(302);
  });
  it('applies the same cooldown to a profile429 without storing partial credentials or granting roles', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('{"access_token":"access","refresh_token":"refresh","scope":"identify guilds.join","expires_in":3600}'))
      .mockResolvedValueOnce(new Response('{"retry_after":2}', { status: 429 }));
    const t = await fixture({ fetchImpl }); const result = await t.callback(t.state());
    expect(result.status).toBe(429); expect(result.headers['retry-after']).toBe('2'); expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((await t.request('/oauth/login')).status).toBe(429); expect(t.member.roles.add).not.toHaveBeenCalled();
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM oauth_backups').get().n).toBe(0);
  });
  it('blocks new work immediately while a body-only429 is still being read, then honors its actual wait', async () => {
    let body;
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({ start(controller) { body = controller; } }), { status: 429 }));
    const t = await fixture({ fetchImpl }), pending = t.callback(t.state());
    await vi.waitFor(() => expect(t.guard.getHealth({ clientId, store: 'store1' }).status).toBe('COOLDOWN'));
    expect((await t.request('/oauth/login')).status).toBe(429); expect(fetchImpl).toHaveBeenCalledOnce();
    body.enqueue(new TextEncoder().encode('{"retry_after":2}')); body.close();
    const result = await pending;
    expect(result.status).toBe(429); expect(result.headers['retry-after']).toBe('2');
    expect(t.guard.retryAfter({ clientId, store: 'store1' })).toBe(2000);
  });
  it('stops an in-flight successful token flow before profile lookup when another flow establishes cooldown', async () => {
    let releaseToken;
    const pendingToken = new Promise(resolve => { releaseToken = resolve; });
    let tokenCalls = 0;
    const fetchImpl = vi.fn(async url => {
      if (url.endsWith('/token')) {
        if (++tokenCalls === 1) return pendingToken;
        return new Response('{"retry_after":7}', { status: 429, headers: { 'retry-after': '7' } });
      }
      return new Response(JSON.stringify({ id: userId, username: 'test-user' }));
    });
    const t = await fixture({ fetchImpl }), alreadyInFlight = t.callback(t.state());
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    const limited = await t.callback(t.state());
    expect(limited.status).toBe(429);
    releaseToken(new Response('{"access_token":"access","refresh_token":"refresh","scope":"identify guilds.join","expires_in":3600}'));
    const resumed = await alreadyInFlight;
    expect(resumed.status).toBe(429); expect(resumed.headers['retry-after']).toBe('7');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.every(([url]) => url.endsWith('/token'))).toBe(true);
    expect(t.member.roles.add).not.toHaveBeenCalled();
    expect(t.member.send).not.toHaveBeenCalled();
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM oauth_backups').get().n).toBe(0);
    expect(t.guard.getHealth({ clientId, store: 'store1' }).providerRateLimits).toBe(1);
  });
  it('claims valid state before exchange and blocks concurrent replay plus replay after restart', async () => {
    let release; const pause = new Promise(resolve => { release = resolve; });
    const fetchImpl = vi.fn(async url => {
      if (url.endsWith('/token')) { await pause; return new Response('{"access_token":"access","refresh_token":"refresh","scope":"identify guilds.join","expires_in":3600}'); }
      return new Response(JSON.stringify({ id: userId, username: 'test-user' }));
    });
    const t = await fixture({ fetchImpl }), state = t.state(); const first = t.callback(state);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    expect((await t.callback(state)).status).toBe(409); release(); expect((await first).status).toBe(200);
    const restarted = await fixture({ database: t.database, fetchImpl });
    expect((await restarted.callback(state)).status).toBe(409); expect(fetchImpl).toHaveBeenCalledTimes(2);
    const rows = t.database.prepare('SELECT * FROM oauth_callback_claims').all();
    expect(rows).toHaveLength(1); expect(JSON.stringify(rows)).not.toMatch(/synthetic-code|access|refresh|eyJ/);
  });
  it.each(['cookie', 'application', 'store', 'denial'])('rejects %s mismatch/denial before exchange and role side effects', async kind => {
    const t = await fixture(); let result;
    if (kind === 'cookie') result = await t.request(`/oauth/callback?code=synthetic-code&state=${encodeURIComponent(t.state())}`);
    if (kind === 'application') result = await t.callback(t.state({ clientId: '1382729296724099133' }));
    if (kind === 'store') result = await t.callback(t.state({ store: 'store2' }));
    if (kind === 'denial') result = await t.callback(t.state(), '&error=access_denied');
    expect(result.status).toBe(400); expect(t.fetchImpl).not.toHaveBeenCalled(); expect(t.member.roles.add).not.toHaveBeenCalled();
    expect(t.database.prepare('SELECT COUNT(*) AS n FROM oauth_backups').get().n).toBe(0);
  });
});

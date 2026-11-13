import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';

vi.mock('../src/database/db.js', () => ({ db: {} }));
vi.mock('../src/config.js', () => ({ config: {} }));
vi.mock('../src/utils/permissions.js', () => ({ hasConfiguredOwnerRole: () => false, isBotDeveloper: () => false }));
vi.mock('../src/utils/emojiHelper.js', () => ({ createEmojiResolver: () => () => '' }));
vi.mock('../src/services/guildRecoveryService.js', () => ({ getRecoveryRoleMapping: () => ({ ids: [], skipped: [] }) }));

import { addMemberToGuild, createRecoveryCommand, createRecoveryMemberCooldownGuard, refreshAccessToken } from '../src/commands/chuyen-server.js';
import { createOAuthRequestGuard } from '../src/services/oauthRequestGuard.js';

const source = '1234567890123456789', target = '9876543210987654321', app = '1382729296724099132';
const configuration = { clientId: app, botToken: 'synthetic-bot-token' };
const env = { ENV_FILE: '.env', CLIENT_SECRET: 'synthetic-client-secret' };
const scope = { clientId: app, store: 'store1' };
const memberRequest = (options = {}) => addMemberToGuild(target, '1111111111111111111', 'synthetic-access', configuration.botToken, [], options);
const connections = [];
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); for (const db of connections.splice(0)) db.close(); });

function fakeDeadline() {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('request timeout', 'TimeoutError')), milliseconds);
    return controller.signal;
  });
}
function fixture(rows = []) {
  const database = new Database(':memory:'); connections.push(database);
  database.exec(`CREATE TABLE oauth_backups (discord_id TEXT,guild_id TEXT,username TEXT,access_token TEXT,
    refresh_token TEXT,token_expires_at TEXT,member_roles_json TEXT,scopes TEXT,recovery_consent_at TEXT,
    verified_at TEXT,last_refreshed_at TEXT,PRIMARY KEY(discord_id,guild_id));`);
  let clock = Date.parse('2026-11-14T01:00:00Z');
  const now = () => clock;
  const sleep = vi.fn(async ms => { clock += ms; });
  for (const [index, overrides] of rows.entries()) {
    const row = { discord_id: String(1111111111111111111n + BigInt(index)), guild_id: source, username: `customer-${index}`,
      access_token: 'enc:synthetic-access', refresh_token: 'enc:synthetic-refresh',
      token_expires_at: new Date(clock + 86400000).toISOString(), member_roles_json: '[]', scopes: 'identify guilds.join',
      recovery_consent_at: '2026-11-01', verified_at: String(index), ...overrides };
    database.prepare(`INSERT INTO oauth_backups(discord_id,guild_id,username,access_token,refresh_token,token_expires_at,
      member_roles_json,scopes,recovery_consent_at,verified_at) VALUES(@discord_id,@guild_id,@username,@access_token,
      @refresh_token,@token_expires_at,@member_roles_json,@scopes,@recovery_consent_at,@verified_at)`).run(row);
  }
  const guild = { id: target, name: 'Target @everyone <@1234567890123456789>', members: {
    me: { permissions: new PermissionsBitField([PermissionFlagsBits.CreateInstantInvite, PermissionFlagsBits.ManageRoles]) },
  } };
  const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
  const roleMapping = vi.fn(() => ({ ids: ['safe-role'], skipped: [] }));
  const syncRoles = vi.fn(async () => ({ synced: 1, missing: 0, error: '' }));
  const requestGuard = createOAuthRequestGuard({ database, now });
  const memberCooldownGuard = createRecoveryMemberCooldownGuard({ database, now });
  const options = { database, configuration, env, now, sleep, fetchImpl, roleMapping, syncRoles, requestGuard, memberCooldownGuard,
    decryptTokens: value => String(value || '').replace(/^enc:/, ''), encryptTokens: value => `enc:${value}`,
    emojiResolver: () => () => '' };
  const interaction = () => ({ guildId: source, user: { id: '2222222222222222222' }, member: {},
    memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
    options: { getString: key => key === 'guild_id' ? target : null },
    client: { user: { id: app }, guilds: { fetch: vi.fn(async () => guild) } },
    reply: vi.fn(async () => {}), deferReply: vi.fn(async () => {}), editReply: vi.fn(async () => {}) });
  return { database, now, sleep, fetchImpl, options, requestGuard, memberCooldownGuard, roleMapping, syncRoles, interaction,
    advance: ms => { clock += ms; }, run: createRecoveryCommand(options) };
}

describe('bounded recovery member requests', () => {
  it.each([[120, 2], [2, 120]])('defers the full larger Retry-After (%s header, %s body) without inline sleep', async (header, body) => {
    const fetchImpl = vi.fn(async () => Response.json({ retry_after: body, message: 'secret-provider-body' },
      { status: 429, headers: { 'Retry-After': String(header) } }));
    const sleep = vi.fn(), onRateLimit = vi.fn();
    const result = await memberRequest({ fetchImpl, sleep, onRateLimit });
    expect(result).toMatchObject({ deferred: true, status: 429, retryAfterMs: 120000 });
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(sleep).not.toHaveBeenCalled();
    expect(onRateLimit).toHaveBeenCalledWith(120000, false);
    expect(JSON.stringify(result)).not.toContain('secret-provider-body');
  });
  it('uses exponential 5xx pacing when Retry-After is absent instead of parsing null as zero', async () => {
    let count = 0; const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => ++count < 5 ? Response.json({}, { status: 503 }) : new Response(null, { status: 204 }));
    expect(await memberRequest({ fetchImpl, sleep })).toMatchObject({ ok: true, status: 204, retries: 4 });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([250, 500, 1000, 2000]);
  });
  it('stops immediately for a global limit even when the stated wait is short', async () => {
    const sleep = vi.fn(), onRateLimit = vi.fn();
    const fetchImpl = vi.fn(async () => Response.json({ retry_after: 0.1, global: true }, { status: 429 }));
    expect(await memberRequest({ fetchImpl, sleep, onRateLimit })).toMatchObject({ deferred: true, global: true, retryAfterMs: 100 });
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(sleep).not.toHaveBeenCalled(); expect(onRateLimit).toHaveBeenCalledWith(100, true);
  });
  it('honors date-form Retry-After and fails closed on unrepresentable waits', async () => {
    const clock = Date.parse('2026-11-14T01:00:00Z');
    for (const header of [new Date(clock + 120000).toUTCString(), '9999999999999999999999999']) {
      const sleep = vi.fn();
      const result = await memberRequest({ now: () => clock, sleep,
        fetchImpl: async () => Response.json({}, { status: 429, headers: { 'Retry-After': header } }) });
      expect(result.deferred).toBe(true); expect(result.retryAfterMs).toBeGreaterThanOrEqual(120000); expect(sleep).not.toHaveBeenCalled();
    }
  });
  it('cancels oversized error bodies and never reflects provider content', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('secret-token'.repeat(500))); }, cancel });
    const result = await memberRequest({ fetchImpl: async () => new Response(body, { status: 429, headers: { 'Retry-After': '120' } }) });
    expect(result.retryAfterMs).toBe(120000); expect(cancel).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toContain('secret-token');
  });
  it('bounds a stalled rate-limit body while retaining the full known Retry-After', async () => {
    fakeDeadline(); const cancel = vi.fn();
    const pending = memberRequest({ timeoutMs: 100, fetchImpl: async () => new Response(new ReadableStream({ cancel }),
      { status: 429, headers: { 'Retry-After': '120' } }) });
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ deferred: true, retryAfterMs: 120000 }); expect(cancel).toHaveBeenCalledOnce();
  });
  it('bounds stalled request headers on every attempt and sanitizes transport errors', async () => {
    fakeDeadline();
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const pending = memberRequest({ fetchImpl, timeoutMs: 100, sleep: async () => {} });
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ ok: false, status: 0, retries: 4 }); expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(fetchImpl.mock.calls.every(([, opts]) => opts.signal.aborted && opts.redirect === 'error')).toBe(true);
    const result = await memberRequest({ fetchImpl: async () => { throw new Error('https://secret.example/token?access=secret'); }, sleep: async () => {} });
    expect(JSON.stringify(result)).not.toMatch(/secret|https:/);
  });
  it('checks a newly observed cooldown before a retry rather than issuing the next request', async () => {
    let wait = 0; const fetchImpl = vi.fn(async () => Response.json({}, { status: 503 }));
    const result = await memberRequest({ fetchImpl, checkCooldown: () => wait, sleep: async () => { wait = 120000; } });
    expect(result).toMatchObject({ deferred: true, retryAfterMs: 120000 }); expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe('durable recovery cooldowns', () => {
  it('keeps member target/global buckets separate from OAuth, other apps and other targets', () => {
    const f = fixture(); f.memberCooldownGuard.setCooldown(app, target, 120000);
    const reopened = createRecoveryMemberCooldownGuard({ database: f.database, now: f.now });
    expect(reopened.retryAfter(app, target)).toBe(120000); expect(reopened.retryAfter(app, source)).toBe(0);
    expect(reopened.retryAfter('other-app', target)).toBe(0); expect(f.requestGuard.retryAfter(scope)).toBe(0);
    reopened.setCooldown(app, target, 45000, true);
    expect(reopened.retryAfter(app, source)).toBe(45000); expect(reopened.retryAfter(app, target)).toBe(120000);
    f.advance(120000); expect(reopened.retryAfter(app, target)).toBe(0);
  });
  it('shares a token 429 with verification guards scoped to the exact app and store', async () => {
    const f = fixture(); const fetchImpl = vi.fn(async () => Response.json({ retry_after: 120 }, { status: 429 }));
    await expect(refreshAccessToken('synthetic-refresh', { ...f.options, fetchImpl })).rejects.toMatchObject({ code: 'TOKEN_COOLDOWN', retryAfterMs: 120000 });
    const verification = createOAuthRequestGuard({ database: f.database, now: f.now });
    expect(verification.retryAfter(scope)).toBe(120000);
    expect(verification.retryAfter({ ...scope, store: 'store2' })).toBe(0);
    expect(verification.retryAfter({ ...scope, clientId: 'other-app' })).toBe(0);
    expect(f.memberCooldownGuard.retryAfter(app, target)).toBe(0);
    await expect(refreshAccessToken('synthetic-refresh', { ...f.options, fetchImpl, requestGuard: verification })).rejects.toMatchObject({ code: 'TOKEN_COOLDOWN' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe('explicit admin recovery run', () => {
  it('stops on the first token429, paces the deferred record and leaves all later users untouched', async () => {
    const f = fixture([{ token_expires_at: 'invalid-expiry' }, { token_expires_at: '2026-01-01' }]);
    f.fetchImpl.mockImplementation(async () => Response.json({ retry_after: 120, message: 'synthetic-secret-body' }, { status: 429 }));
    const interaction = f.interaction();
    expect(await f.run(interaction)).toMatchObject({ status: 'DEFERRED', processed: 1, remaining: 2, retryAfterMs: 120000 });
    expect(f.fetchImpl).toHaveBeenCalledOnce(); expect(f.fetchImpl.mock.calls[0][0]).toBe('https://discord.com/api/oauth2/token');
    expect(f.sleep.mock.calls).toEqual([[120]]); expect(f.roleMapping).not.toHaveBeenCalled(); expect(f.syncRoles).not.toHaveBeenCalled();
    expect(f.database.prepare('SELECT access_token FROM oauth_backups').all()).toEqual([{ access_token: 'enc:synthetic-access' }, { access_token: 'enc:synthetic-access' }]);
    const report = JSON.stringify(interaction.editReply.mock.calls);
    expect(report).not.toMatch(/synthetic-secret|synthetic-access|synthetic-refresh|synthetic-client-secret/);
    expect(interaction.editReply.mock.calls[0][0].allowedMentions).toMatchObject({ parse: [] });
    await createRecoveryCommand(f.options)(f.interaction()); expect(f.fetchImpl).toHaveBeenCalledOnce();
  });
  it('does not process another user after a global member cooldown and preserves a deferred join-only fallback', async () => {
    for (const fallback of [false, true]) {
      const f = fixture([{}, {}]);
      if (fallback) f.fetchImpl.mockResolvedValueOnce(Response.json({}, { status: 403 }));
      f.fetchImpl.mockResolvedValue(Response.json({ retry_after: 0.1, global: true }, { status: 429 }));
      expect(await f.run(f.interaction())).toMatchObject({ status: 'DEFERRED', processed: 1, remaining: 2 });
      expect(f.fetchImpl).toHaveBeenCalledTimes(fallback ? 2 : 1);
      expect(f.syncRoles).not.toHaveBeenCalled(); expect(f.sleep.mock.calls).toEqual([[120]]);
      expect(f.memberCooldownGuard.retryAfter(app, source)).toBe(0); // The 100ms global wait elapsed during record pacing.
      expect(f.requestGuard.retryAfter(scope)).toBe(0);
    }
  });
  it('paces every skipped/failed record and selects only rows with explicit consent', async () => {
    const f = fixture([{ scopes: 'identify' }, { access_token: null }, { token_expires_at: 'invalid-expiry' }, {},
      { recovery_consent_at: null }, { recovery_consent_at: '  ' }]);
    f.fetchImpl.mockResolvedValueOnce(Response.json({}, { status: 400 })).mockResolvedValueOnce(new Response(null, { status: 201 }));
    expect(await f.run(f.interaction())).toMatchObject({ status: 'COMPLETE', processed: 4, failed: 3, added: 1 });
    expect(f.sleep.mock.calls).toEqual([[120], [120], [120], [120]]); expect(f.fetchImpl).toHaveBeenCalledTimes(2);
    expect(f.syncRoles).toHaveBeenCalledOnce(); expect(f.roleMapping).toHaveBeenCalledOnce();
  });
  it('persists token rotation before the member request and retains role mapping on success', async () => {
    const f = fixture([{ token_expires_at: 'invalid-expiry' }]);
    f.fetchImpl.mockImplementation(async (url, options) => {
      if (url.endsWith('/oauth2/token')) return Response.json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 86400, scope: 'identify guilds.join' });
      expect(f.database.prepare('SELECT access_token,refresh_token FROM oauth_backups').get()).toEqual({ access_token: 'enc:rotated-access', refresh_token: 'enc:rotated-refresh' });
      expect(JSON.parse(options.body)).toEqual({ access_token: 'rotated-access', roles: ['safe-role'] });
      return new Response(null, { status: 204 });
    });
    expect(await f.run(f.interaction())).toMatchObject({ status: 'COMPLETE', already: 1 });
    expect(f.fetchImpl).toHaveBeenCalledTimes(2); expect(f.syncRoles).toHaveBeenCalledWith(expect.anything(), '1111111111111111111', ['safe-role']);
  });
  it('refreshes a revoked access token once and preserves the same user and mapped roles', async () => {
    const f = fixture([{}]);
    f.fetchImpl.mockResolvedValueOnce(Response.json({}, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 86400 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    expect(await f.run(f.interaction())).toMatchObject({ status: 'COMPLETE', added: 1 });
    expect(f.fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `https://discord.com/api/v10/guilds/${target}/members/1111111111111111111`,
      'https://discord.com/api/oauth2/token',
      `https://discord.com/api/v10/guilds/${target}/members/1111111111111111111`,
    ]);
    expect(JSON.parse(f.fetchImpl.mock.calls[2][1].body)).toEqual({ access_token: 'rotated-access', roles: ['safe-role'] });
    expect(f.syncRoles).toHaveBeenCalledOnce(); expect(f.sleep.mock.calls).toEqual([[120]]);
  });
  it('preserves join-only recovery after a role-related denial and sanitizes a role-sync failure', async () => {
    const f = fixture([{}]);
    f.fetchImpl.mockResolvedValueOnce(Response.json({ message: 'secret-provider-body' }, { status: 403 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    f.syncRoles.mockResolvedValueOnce({ synced: 0, missing: 1, error: 'https://secret.example/access=synthetic-access' });
    const interaction = f.interaction();
    expect(await f.run(interaction)).toMatchObject({ status: 'COMPLETE', added: 1 });
    expect(JSON.parse(f.fetchImpl.mock.calls[0][1].body).roles).toEqual(['safe-role']);
    expect(JSON.parse(f.fetchImpl.mock.calls[1][1].body).roles).toEqual([]);
    expect(JSON.stringify(interaction.editReply.mock.calls)).not.toMatch(/secret-provider|secret\.example|synthetic-access/);
    expect(f.syncRoles).toHaveBeenCalledWith(expect.anything(), '1111111111111111111', ['safe-role']);
  });
  it.each([401, 403, 503])('stops subsequent refreshes after a systemic token HTTP%s response', async status => {
    const f = fixture([{ token_expires_at: 'invalid-expiry' }, { token_expires_at: 'invalid-expiry' }]);
    f.fetchImpl.mockResolvedValue(Response.json({ message: 'secret-provider-body' }, { status }));
    expect(await f.run(f.interaction())).toMatchObject({ status: 'DEFERRED', processed: 1, remaining: 2 });
    expect(f.fetchImpl).toHaveBeenCalledOnce(); expect(f.sleep.mock.calls).toEqual([[120]]);
  });
  it('blocks member PUT if verification establishes token cooldown while refresh is in flight', async () => {
    const f = fixture([{ token_expires_at: 'invalid-expiry' }, {}]);
    f.fetchImpl.mockImplementation(async () => {
      f.requestGuard.setCooldown(scope, 120000);
      return Response.json({ access_token: 'rotated-access', expires_in: 86400 });
    });
    expect(await f.run(f.interaction())).toMatchObject({ status: 'DEFERRED', processed: 1 });
    expect(f.fetchImpl).toHaveBeenCalledOnce(); expect(f.syncRoles).not.toHaveBeenCalled();
  });
  it('allows only one run per application across factories and releases the lock after completion', async () => {
    const f = fixture([{}]); const first = f.interaction(), second = f.interaction();
    let release; const gate = new Promise(resolve => { release = resolve; });
    first.client.guilds.fetch.mockImplementation(async () => { await gate; return second.client.guilds.fetch(); });
    const pending = f.run(first); await Promise.resolve();
    await createRecoveryCommand(f.options)(second);
    expect(second.reply).toHaveBeenCalledOnce(); expect(second.deferReply).not.toHaveBeenCalled(); expect(f.fetchImpl).not.toHaveBeenCalled();
    release(); await pending;
    expect(await createRecoveryCommand(f.options)(f.interaction())).toMatchObject({ status: 'COMPLETE', added: 1 });
  });
  it('releases the run lock after an interaction failure and does not bypass admin checks', async () => {
    const f = fixture([{}]); const first = f.interaction(); first.deferReply.mockRejectedValue(new Error('interaction expired'));
    await expect(f.run(first)).rejects.toThrow('interaction expired');
    expect(await f.run(f.interaction())).toMatchObject({ status: 'COMPLETE' });
    const unauthorized = f.interaction(); unauthorized.memberPermissions = new PermissionsBitField();
    await f.run(unauthorized); expect(unauthorized.reply).toHaveBeenCalledOnce(); expect(unauthorized.deferReply).not.toHaveBeenCalled();
    expect(f.fetchImpl).toHaveBeenCalledOnce();
  });
  it('stops on systemic token failure and strips upstream exceptions from the final report', async () => {
    const f = fixture([{ token_expires_at: 'invalid-expiry', username: '@everyone `<@1234567890123456789>' }, {}]);
    f.fetchImpl.mockRejectedValue(new Error('https://secret.example/?refresh=synthetic-refresh'));
    const interaction = f.interaction();
    expect(await f.run(interaction)).toMatchObject({ status: 'DEFERRED', processed: 1, remaining: 2 });
    expect(f.fetchImpl).toHaveBeenCalledOnce(); expect(JSON.stringify(interaction.editReply.mock.calls)).not.toMatch(/secret\.example|synthetic-refresh|@everyone|<@/);
  });
});

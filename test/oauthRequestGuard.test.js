import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOAuthRequestGuard, fetchDiscordOAuthJson } from '../src/services/oauthRequestGuard.js';
const databases = [];
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); for (const database of databases.splice(0)) database.close(); });
const TOKEN = 'https://discord.com/api/oauth2/token';
const scope = { clientId: '1382729296724099132', store: 'store1' };

describe('OAuth request guards', () => {
  it('persists one-use hashed claims and full provider waits across restart and isolates apps/stores', () => {
    const database = new Database(':memory:'); databases.push(database); let time = 1800000000000;
    const guard = createOAuthRequestGuard({ database, now: () => time });
    const claim = { ...scope, state: 'private-signed-state', guildId: '1282637033340403754', expiresAt: time + 600000 };
    expect(guard.claim(claim)).toBe(true); expect(guard.claim(claim)).toBe(false);
    guard.setCooldown(scope, 7 * 86400000);
    const restart = createOAuthRequestGuard({ database, now: () => time });
    expect(restart.claim(claim)).toBe(false); expect(restart.retryAfter(scope)).toBe(7 * 86400000);
    expect(restart.retryAfter({ ...scope, store: 'store2' })).toBe(0);
    expect(restart.retryAfter({ ...scope, clientId: '1382729296724099133' })).toBe(0);
    expect(JSON.stringify(database.prepare('SELECT * FROM oauth_callback_claims').all())).not.toContain('private-signed-state');
    time += 7 * 86400000 + 1; expect(restart.retryAfter(scope)).toBe(0);
  });
  it('honors 429 headers/body without retrying or reflecting provider content', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ retry_after: 12.5, access_token: 'private-provider-body' }),
      { status: 429, headers: { 'retry-after': '4', 'content-type': 'application/json' } }));
    const rateLimit = vi.fn();
    await expect(fetchDiscordOAuthJson(TOKEN, { method: 'POST' }, { fetchImpl, onRateLimit: rateLimit }))
      .rejects.toMatchObject({ code: 'RATE_LIMITED', status: 429, retryAfterMs: 12500, message: 'Discord OAuth rate limited' });
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(rateLimit.mock.calls).toEqual([[4000, true], [12500, false]]);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'error', method: 'POST' });
  });
  it('uses body-only retry_after and fails closed on unrepresentable deadlines', async () => {
    await expect(fetchDiscordOAuthJson(TOKEN, {}, { fetchImpl: async () => new Response('{"retry_after":2}', { status: 429 }) }))
      .rejects.toMatchObject({ retryAfterMs: 2000 });
    const database = new Database(':memory:'); databases.push(database);
    const guard = createOAuthRequestGuard({ database, now: () => 1800000000000 });
    guard.setCooldown(scope, Infinity);
    expect(guard.retryAfter(scope)).toBeGreaterThan(100 * 365 * 86400000);
  });
  it('resolves only its own provisional wait and never shortens a newer concurrent response', () => {
    const database = new Database(':memory:'); databases.push(database);
    const guard = createOAuthRequestGuard({ database, now: () => 1800000000000 });
    const first = guard.setCooldown(scope, 60000);
    guard.finalizeCooldown(scope, first, 2000); expect(guard.retryAfter(scope)).toBe(2000);
    const old = guard.setCooldown(scope, 60000); guard.setCooldown(scope, 120000);
    guard.finalizeCooldown(scope, old, 1000); expect(guard.retryAfter(scope)).toBe(120000);
  });
  it('bounds an error response body and retains a safe wait without echoing arbitrary payloads', async () => {
    const onRateLimit = vi.fn();
    await expect(fetchDiscordOAuthJson(TOKEN, {}, { fetchImpl: async () => new Response('private'.repeat(2000), { status: 429 }), onRateLimit }))
      .rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfterMs: 60000 });
    expect(onRateLimit).toHaveBeenCalledWith(60000, true);
  });
  it('keeps a deadline through stalled success response bodies and cancels the reader', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
      const controller = new AbortController(); setTimeout(() => controller.abort(new DOMException('Deadline', 'TimeoutError')), milliseconds); return controller.signal;
    });
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }));
    const pending = fetchDiscordOAuthJson(TOKEN, {}, { fetchImpl: async () => response, timeoutMs: 1000 });
    const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(1000); await assertion;
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('uses independent valid browser budgets behind a shared reverse proxy IP', () => {
    const database = new Database(':memory:'); databases.push(database);
    const guard = createOAuthRequestGuard({ database }); const req = { ip: '127.0.0.1' };
    for (let index = 0; index < 10; index++) expect(guard.limit(req, { ...scope, kind: 'login', validState: 'browser-a' })).toBe(0);
    expect(guard.limit(req, { ...scope, kind: 'login', validState: 'browser-a' })).toBeGreaterThan(0);
    expect(guard.limit(req, { ...scope, kind: 'login', validState: 'browser-b' })).toBe(0);
  });
});

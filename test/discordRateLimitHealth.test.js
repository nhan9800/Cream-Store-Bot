import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESTEvents } from 'discord.js';

const context = { guildId: '1282637033340403754', envFile: '.env' };
const now = new Date('2026-11-14T17:50:00.000Z');
let install, getHealth, logger, fetch;
const client = () => ({ rest: new EventEmitter() });

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers(); vi.setSystemTime(now);
  logger = vi.spyOn(console, 'warn').mockImplementation(() => {});
  fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected telemetry request'));
  ({ installDiscordRateLimitHealth: install, getDiscordRateLimitHealth: getHealth } = await import('../src/services/discordRateLimitHealthService.js'));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('passive Discord REST rate-limit diagnostics', () => {
  it('performs no I/O, timers or logs on import, install, or cached health reads', () => {
    expect(getHealth()).toEqual({ status: 'NOT_INSTALLED', eventCount: 0, globalCount: 0, retryAfterSeconds: null, observedAt: null });
    const bot = client(), monitoring = install(bot, context);
    expect(monitoring).toMatchObject({ status: 'MONITORING', eventCount: 0 });
    expect(getHealth()).toBe(monitoring); expect(getHealth()).toBe(monitoring);
    expect(Object.isFrozen(monitoring)).toBe(true);
    expect(bot.rest.eventNames()).toEqual([RESTEvents.RateLimited]);
    expect(fetch).not.toHaveBeenCalled(); expect(logger).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('installs exactly once for a client and counts each library event once', () => {
    const bot = client();
    install(bot, context); install(bot, context); install(bot, context);
    expect(bot.rest.listenerCount(RESTEvents.RateLimited)).toBe(1);
    bot.rest.emit(RESTEvents.RateLimited, { global: false, retryAfter: 1501, timeToReset: 500, sublimitTimeout: 0 });
    expect(getHealth()).toEqual({ status: 'RATE_LIMIT_OBSERVED', eventCount: 1, globalCount: 0,
      retryAfterSeconds: 2, observedAt: now.toISOString() });
    expect(install(bot, context)).toBe(getHealth());
  });

  it('aggregates distinct clients within this process without borrowing event identifiers', () => {
    const first = client(), second = client();
    install(first, context); install(second, context);
    first.rest.emit(RESTEvents.RateLimited, { global: false, retryAfter: 2000 });
    second.rest.emit(RESTEvents.RateLimited, { global: true, retryAfter: 64000 });
    expect(getHealth()).toMatchObject({ eventCount: 2, globalCount: 1, retryAfterSeconds: 64 });
    expect(Object.keys(getHealth()).sort()).toEqual(['status', 'eventCount', 'globalCount', 'retryAfterSeconds', 'observedAt'].sort());
  });

  it.each([
    { guildId: '1070676180103086132', envFile: '.env.store2' },
    { guildId: context.guildId, envFile: '.env.store2' },
    { guildId: '1070676180103086132', envFile: '.env' },
    { guildId: context.guildId, envFile: '/home/container/.env' },
  ])('does not install Store1 telemetry for another process context %j', other => {
    const bot = client();
    expect(install(bot, other).status).toBe('DISABLED_OTHER_STORE');
    bot.rest.emit(RESTEvents.RateLimited, { global: true, retryAfter: 99999 });
    expect(bot.rest.listenerCount(RESTEvents.RateLimited)).toBe(0);
    expect(getHealth()).toMatchObject({ status: 'DISABLED_OTHER_STORE', eventCount: 0, globalCount: 0 });
    expect(logger).not.toHaveBeenCalled();
  });

  it('does not reset an installed Store1 snapshot after an unrelated install attempt', () => {
    const own = client(), other = client(); install(own, context);
    own.rest.emit(RESTEvents.RateLimited, { global: true, retryAfter: 1000 });
    const before = getHealth();
    install(other, { guildId: '1070676180103086132', envFile: '.env.store2' });
    expect(getHealth()).toBe(before); expect(other.rest.listenerCount(RESTEvents.RateLimited)).toBe(0);
  });

  it('never logs or exposes URLs, tokens, headers, route IDs, bodies or extra property names', () => {
    const bot = client(); install(bot, context);
    const forbidden = ['synthetic-token', 'https://discord.com/api/private-secret', 'secret-route', 'secret-user-id', 'secret-guild-id', 'secret-body', 'secret-dynamic-key'];
    bot.rest.emit(RESTEvents.RateLimited, { global: true, retryAfter: 65000, url: forbidden[1],
      route: forbidden[2], majorParameter: forbidden[3], guildId: forbidden[4], token: forbidden[0],
      headers: { Authorization: forbidden[0] }, response: { body: forbidden[5] }, [forbidden[6]]: forbidden[0] });
    const serialized = JSON.stringify({ health: getHealth(), logs: logger.mock.calls });
    for (const value of forbidden) expect(serialized).not.toContain(value);
    expect(logger).toHaveBeenCalledExactlyOnceWith('[DISCORD-RATE-LIMIT]', getHealth());
    expect(getHealth()).toMatchObject({ eventCount: 1, globalCount: 1, retryAfterSeconds: 65 });
  });

  it('does not invoke hostile event getters, coercion, or serialization hooks', () => {
    const bot = client(); install(bot, context);
    const invoked = vi.fn(() => { throw new Error('Secret getter'); });
    const event = { retryAfter: { valueOf: invoked, toString: invoked }, toJSON: invoked };
    for (const property of ['global', 'timeToReset', 'sublimitTimeout', 'url', 'headers', 'route']) Object.defineProperty(event, property, { get: invoked });
    expect(() => bot.rest.emit(RESTEvents.RateLimited, event)).not.toThrow();
    expect(invoked).not.toHaveBeenCalled();
    expect(getHealth()).toMatchObject({ eventCount: 1, globalCount: 0, retryAfterSeconds: null });
    expect(JSON.stringify(logger.mock.calls)).not.toContain('Secret getter');
  });

  it.each([undefined, null, 'secret-string', { global: 'true', retryAfter: 'secret-number' },
    { retryAfter: -1, timeToReset: Infinity, sublimitTimeout: NaN }])('retains safe aggregate data for malformed payload %j', payload => {
    const bot = client(); install(bot, context); bot.rest.emit(RESTEvents.RateLimited, payload);
    expect(getHealth()).toMatchObject({ eventCount: 1, globalCount: 0, retryAfterSeconds: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the longest documented wait including the sublimit, in seconds', () => {
    const bot = client(); install(bot, context);
    bot.rest.emit(RESTEvents.RateLimited, { global: false, retryAfter: 200, timeToReset: 3500, sublimitTimeout: 4200 });
    expect(getHealth().retryAfterSeconds).toBe(5);
  });

  it('coalesces repeated limits while keeping every event in health and logs an aggregate after one minute', () => {
    const bot = client(); install(bot, context);
    bot.rest.emit(RESTEvents.RateLimited, { global: false, retryAfter: 3000 });
    for (let i = 0; i < 100; i++) bot.rest.emit(RESTEvents.RateLimited, { global: false, retryAfter: 3000 });
    expect(getHealth().eventCount).toBe(101); expect(logger).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date(now.getTime() + 60000));
    bot.rest.emit(RESTEvents.RateLimited, { global: false, retryAfter: 3000 });
    expect(logger).toHaveBeenCalledTimes(2);
    expect(logger.mock.calls[1][1]).toMatchObject({ eventCount: 102, observedAt: new Date(now.getTime() + 60000).toISOString() });
    expect(vi.getTimerCount()).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });

  it('logs a new global limit or substantially longer wait immediately, without any retry action', () => {
    const bot = client(); install(bot, context);
    const request = vi.fn(); bot.rest.request = request;
    bot.rest.emit(RESTEvents.RateLimited, { global: false, retryAfter: 2000 });
    bot.rest.emit(RESTEvents.RateLimited, { global: true, retryAfter: 2000 });
    bot.rest.emit(RESTEvents.RateLimited, { global: true, retryAfter: 10000 });
    expect(logger).toHaveBeenCalledTimes(3); expect(getHealth()).toMatchObject({ eventCount: 3, globalCount: 2, retryAfterSeconds: 10 });
    expect(request).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never lets a diagnostic logger failure interfere with REST event processing', () => {
    logger.mockImplementation(() => { throw new Error('Logger unavailable'); });
    const bot = client(); install(bot, context);
    expect(() => bot.rest.emit(RESTEvents.RateLimited, { global: true, retryAfter: 1000 })).not.toThrow();
    expect(getHealth()).toMatchObject({ eventCount: 1, globalCount: 1 });
  });

  it.each([null, {}, { rest: {} }])('handles an unavailable REST emitter without adding work %j', invalid => {
    expect(install(invalid, context).status).toBe('UNAVAILABLE');
    expect(logger).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});

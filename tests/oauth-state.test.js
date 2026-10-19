import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { createOAuthState, OAUTH_STATE_TTL_MS, parseCookieHeader, verifyOAuthState } from '../src/utils/oauthState.js';

const GUILD_ID = '1282637033340403754';
const NOW = 1_792_300_000_000;

beforeEach(() => vi.stubEnv('OAUTH_STATE_SECRET', 'test-only-state-signing-secret'));
afterEach(() => vi.unstubAllEnvs());

describe('OAuth callback cookie parsing', () => {
  it('ignores malformed unrelated cookies while retaining a valid signed state', () => {
    const state = createOAuthState(GUILD_ID, NOW);
    const cookies = parseCookieHeader(`bad=%E0%A4%A; state=${encodeURIComponent(state)}; %ZZ=value; other=hello%20world`);
    expect(cookies.bad).toBeUndefined();
    expect(cookies.other).toBe('hello world');
    expect(verifyOAuthState(state, cookies.state, NOW).guildId).toBe(GUILD_ID);
  });

  it('fails closed on a malformed state cookie rather than throwing during parsing', () => {
    const state = createOAuthState(GUILD_ID, NOW);
    const cookies = parseCookieHeader('state=%E0%A4%A');
    expect(() => verifyOAuthState(state, cookies.state, NOW)).toThrow('không hợp lệ');
  });

  it('treats prototype-sensitive cookie names as inert own values', () => {
    const cookies = parseCookieHeader('__proto__=untrusted; constructor=untrusted; normal=ok');
    expect(Object.getPrototypeOf(cookies)).toBe(Object.prototype);
    expect(Object.hasOwn(cookies, '__proto__')).toBe(true);
    expect(cookies.__proto__).toBe('untrusted');
    expect(cookies.normal).toBe('ok');
    expect({}.polluted).toBeUndefined();
  });
});

describe('signed OAuth state guards', () => {
  it('accepts a matching unexpired signed state and preserves the original guild', () => {
    const state = createOAuthState(GUILD_ID, NOW);
    const payload = verifyOAuthState(state, state, NOW + 1000);
    expect(payload.guildId).toBe(GUILD_ID);
    expect(payload).not.toHaveProperty('clientId');
    expect(payload).not.toHaveProperty('store');
  });

  it('signs and returns an optional application and store route binding', () => {
    const state = createOAuthState(GUILD_ID, NOW, { clientId: '1382729296724099132', store: 'store2' });
    expect(verifyOAuthState(state, state, NOW)).toMatchObject({ guildId: GUILD_ID, clientId: '1382729296724099132', store: 'store2' });
    const [encoded, signature] = state.split('.');
    const altered = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    altered.store = 'store1';
    const tampered = `${Buffer.from(JSON.stringify(altered)).toString('base64url')}.${signature}`;
    expect(() => verifyOAuthState(tampered, tampered, NOW)).toThrow('Chữ ký');
  });

  it.each([{ clientId: 'short' }, { clientId: '' }, { clientId: null }, { store: 'other' }, { store: null }])('rejects invalid optional bindings at creation: %j', (options) => {
    expect(() => createOAuthState(GUILD_ID, NOW, options)).toThrow('OAuth không hợp lệ');
  });

  it.each([{ clientId: 'short' }, { clientId: 123 }, { clientId: null }, { store: 'other' }, { store: null }])('rejects invalid optional bindings even in a correctly signed payload: %j', (changes) => {
    const original = createOAuthState(GUILD_ID, NOW);
    const payload = JSON.parse(Buffer.from(original.split('.')[0], 'base64url').toString('utf8'));
    Object.assign(payload, changes);
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = createHmac('sha256', process.env.OAUTH_STATE_SECRET).update(encoded).digest('base64url');
    const invalid = `${encoded}.${signature}`;
    expect(() => verifyOAuthState(invalid, invalid, NOW)).toThrow('không hợp lệ');
  });

  it('rejects cookie mismatch, signature tampering and expired sessions', () => {
    const state = createOAuthState(GUILD_ID, NOW);
    expect(() => verifyOAuthState(state, `${state}x`, NOW)).toThrow();
    const [payload, signature] = state.split('.');
    const forged = `${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    expect(() => verifyOAuthState(forged, forged, NOW)).toThrow('Chữ ký');
    expect(() => verifyOAuthState(state, state, NOW + OAUTH_STATE_TTL_MS + 1)).toThrow('hết hạn');
  });
});

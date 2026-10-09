import { afterEach, describe, expect, it } from 'vitest';
import {
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_TTL_MS,
  checkDashboardLoginLock,
  clearDashboardLoginFailures,
  dashboardLoginKey,
  dashboardLoginLimiter,
  isDashboardAuthorized,
  isDashboardSessionValid,
  isDashboardWebSocketOriginAllowed,
  issueDashboardSession,
  recordDashboardLoginFailure,
  readCookie,
  revokeDashboardSession,
} from '../src/services/dashboardAuth.js';

const originalDashboardToken = process.env.DASHBOARD_TOKEN;
const originalNodeEnv = process.env.NODE_ENV;
const originalStoreWebsiteUrl = process.env.STORE_WEBSITE_URL;

afterEach(() => {
  if (originalDashboardToken === undefined) delete process.env.DASHBOARD_TOKEN;
  else process.env.DASHBOARD_TOKEN = originalDashboardToken;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalStoreWebsiteUrl === undefined) delete process.env.STORE_WEBSITE_URL;
  else process.env.STORE_WEBSITE_URL = originalStoreWebsiteUrl;
});

describe('dashboard authentication hardening', () => {
  it('accepts the dashboard token only from a header, never a query string', () => {
    process.env.DASHBOARD_TOKEN = 'dashboard-test-secret';

    expect(isDashboardAuthorized({
      headers: { 'x-dashboard-token': 'dashboard-test-secret' },
      query: {},
    })).toBe(true);
    expect(isDashboardAuthorized({
      headers: {},
      query: { token: 'dashboard-test-secret' },
    })).toBe(false);
  });

  it('authenticates an opaque HttpOnly session cookie and revokes it', () => {
    process.env.DASHBOARD_TOKEN = 'dashboard-test-secret';
    const issued = issueDashboardSession(1_000);
    const cookie = `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(issued.token)}; Path=/`;

    expect(readCookie(cookie, DASHBOARD_SESSION_COOKIE)).toBe(issued.token);
    expect(isDashboardAuthorized({ headers: { cookie } }, 1_000 + 1)).toBe(true);
    expect(isDashboardSessionValid(issued.token, 1_000 + DASHBOARD_SESSION_TTL_MS - 1)).toBe(true);
    expect(revokeDashboardSession(issued.token)).toBe(true);
    expect(isDashboardAuthorized({ headers: { cookie } }, 1_000 + 1)).toBe(false);
  });

  it('expires dashboard sessions and scopes failure keys by source address', () => {
    process.env.DASHBOARD_TOKEN = 'dashboard-rotation-a';
    const issued = issueDashboardSession(5_000);
    expect(isDashboardSessionValid(issued.token, 5_000 + DASHBOARD_SESSION_TTL_MS)).toBe(false);
    const rotated = issueDashboardSession(6_000);
    process.env.DASHBOARD_TOKEN = 'dashboard-rotation-b';
    expect(isDashboardSessionValid(rotated.token, 6_001)).toBe(false);
    expect(dashboardLoginKey({ ip: '127.0.0.1' })).toBe('dashboard:127.0.0.1');
    expect(dashboardLoginKey({ connection: { remoteAddress: '::1' } })).toBe('dashboard:::1');
  });

  it('requires an explicit same-origin Origin for dashboard WebSocket upgrades', () => {
    process.env.NODE_ENV = 'test';
    process.env.STORE_WEBSITE_URL = '';
    expect(isDashboardWebSocketOriginAllowed({ headers: { host: '127.0.0.1:4010', origin: 'http://127.0.0.1:4010' } })).toBe(true);
    expect(isDashboardWebSocketOriginAllowed({ headers: { host: '127.0.0.1:4010', origin: 'https://attacker.example' } })).toBe(false);
    expect(isDashboardWebSocketOriginAllowed({ headers: { host: '127.0.0.1:4010' } })).toBe(false);
  });

  it('locks repeated dashboard failures and applies the strict request budget', () => {
    const req = { ip: `dashboard-test-${Date.now()}` };
    for (let attempt = 0; attempt < 4; attempt += 1) {
      recordDashboardLoginFailure(req);
    }
    expect(checkDashboardLoginLock(req).locked).toBe(false);
    const fifth = recordDashboardLoginFailure(req);
    expect(fifth.lockedUntil).toBeGreaterThan(Date.now());

    const limitedReq = { ip: `dashboard-rate-test-${Date.now()}` };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      dashboardLoginLimiter(limitedReq, {
        setHeader() {},
      }, () => {});
    }
    const response = {
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.payload = payload; return this; },
    };
    dashboardLoginLimiter(limitedReq, response, () => { response.nextCalled = true; });
    expect(response.statusCode).toBe(429);
    expect(response.nextCalled).not.toBe(true);
    clearDashboardLoginFailures(req);
  });
});


import crypto from 'node:crypto';
import {
  checkLoginLock,
  clearLoginAttempts,
  createRateLimiter,
  recordLoginFailure,
} from './rateLimitMiddleware.js';

export const DASHBOARD_SESSION_COOKIE = 'cenar_dashboard_session';
export const DASHBOARD_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const dashboardSessions = new Map();
const dashboardSessionCleanup = setInterval(() => {
  const now = Date.now();
  for (const [token, expiresAt] of dashboardSessions) {
    if (expiresAt <= now) dashboardSessions.delete(token);
  }
}, 10 * 60 * 1000);
dashboardSessionCleanup.unref?.();

// Dashboard credentials protect delivery accounts and customer data. Keep the
// login budget stricter than the public API budget and keyed by the source IP.
export const dashboardLoginLimiter = createRateLimiter({
  name: 'dashboard-login',
  windowMs: 5 * 60 * 1000,
  max: 5,
  message: 'Quá nhiều lần đăng nhập dashboard, vui lòng thử lại sau 5 phút.',
  keyGenerator: (req) => dashboardLoginKey(req),
});

export function dashboardLoginKey(req) {
  return `dashboard:${String(req?.ip || req?.connection?.remoteAddress || 'unknown')}`;
}

export function checkDashboardLoginLock(req) {
  return checkLoginLock(dashboardLoginKey(req));
}

export function recordDashboardLoginFailure(req) {
  return recordLoginFailure(dashboardLoginKey(req));
}

export function clearDashboardLoginFailures(req) {
  clearLoginAttempts(dashboardLoginKey(req));
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ''), 'utf8');
  const b = Buffer.from(String(right ?? ''), 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function readCookie(header, name) {
  const target = String(name || '');
  for (const part of String(header || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1 || part.slice(0, separator).trim() !== target) continue;
    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return '';
}

export function issueDashboardSession(now = Date.now()) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = now + DASHBOARD_SESSION_TTL_MS;
  dashboardSessions.set(token, expiresAt);
  return { token, expiresAt };
}

export function revokeDashboardSession(token) {
  return dashboardSessions.delete(String(token || ''));
}

export function isDashboardSessionValid(token, now = Date.now()) {
  const key = String(token || '');
  const expiresAt = dashboardSessions.get(key);
  if (!expiresAt) return false;
  if (expiresAt <= now) {
    dashboardSessions.delete(key);
    return false;
  }
  return true;
}

export function invalidateDashboardSession(req) {
  return revokeDashboardSession(readCookie(req?.headers?.cookie, DASHBOARD_SESSION_COOKIE));
}

export function isDashboardAuthorized(req, now = Date.now()) {
  const expected = String(process.env.DASHBOARD_TOKEN ?? '').trim();
  if (!expected) return false;

  // Static token is accepted only in a header. Query strings are deliberately
  // ignored so credentials cannot enter browser history, referrers or logs.
  const provided = req?.headers?.['x-dashboard-token']
    || req?.headers?.['X-Dashboard-Token'];
  if (safeEqual(provided, expected)) return true;

  const session = readCookie(req?.headers?.cookie, DASHBOARD_SESSION_COOKIE);
  return isDashboardSessionValid(session, now);
}

export function setDashboardSessionCookie(req, res, token) {
  const secure = req?.secure || req?.headers?.['x-forwarded-proto'] === 'https';
  const maxAge = Math.floor(DASHBOARD_SESSION_TTL_MS / 1000);
  // maxAge is intentionally derived from the fixed TTL, not user input.
  res.setHeader('Set-Cookie', `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`);
}

export function clearDashboardSessionCookie(req, res) {
  const secure = req?.secure || req?.headers?.['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${DASHBOARD_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`);
}


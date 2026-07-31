import rateLimit from 'express-rate-limit';

export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { ok: false, error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
  keyGenerator: (req) => req.ip || req.connection?.remoteAddress || 'unknown',
});

export const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: { ok: false, error: 'Quá nhiều lần đăng nhập, vui lòng thử lại sau 5 phút.' },
  keyGenerator: (req) => req.ip || req.connection?.remoteAddress || 'unknown',
});

export const webhookLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { ok: false, error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
  keyGenerator: (req) => req.ip || req.connection?.remoteAddress || 'unknown',
});

export const dashboardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { ok: false, error: 'Quá nhiều yêu cầu, vui lòng thử lại sau.' },
  keyGenerator: (req) => req.ip || req.connection?.remoteAddress || 'unknown',
});

// ═══════════════════════════════════════════════
// Login Attempt Tracker
// ═══════════════════════════════════════════════
const loginAttempts = new Map(); // ip → { failures, lockedUntil }
const MAX_LOGIN_FAILURES = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export function checkLoginLock(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return { locked: false };
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) {
    const remainMs = entry.lockedUntil - Date.now();
    return { locked: true, remainMs, remainMin: Math.ceil(remainMs / 60000) };
  }
  // Lock expired, reset
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    loginAttempts.delete(ip);
  }
  return { locked: false };
}

export function recordLoginFailure(ip) {
  let entry = loginAttempts.get(ip);
  if (!entry) {
    entry = { failures: 0, lockedUntil: null };
    loginAttempts.set(ip, entry);
  }
  entry.failures++;
  if (entry.failures >= MAX_LOGIN_FAILURES) {
    entry.lockedUntil = Date.now() + LOCK_DURATION_MS;
    console.warn(`[SECURITY] IP ${ip} locked for ${LOCK_DURATION_MS / 60000} minutes after ${entry.failures} failed login attempts`);
  }
  return entry;
}

export function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

// ═══════════════════════════════════════════════
// Security Headers Middleware (helmet-lite)
// ═══════════════════════════════════════════════
export function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.removeHeader('X-Powered-By');
  next();
}

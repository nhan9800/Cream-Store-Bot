// ═══════════════════════════════════════════════
// Rate Limiter Middleware (In-Memory)
// ═══════════════════════════════════════════════

const stores = new Map(); // key → { hits: Map<ip, {count, resetAt}> }

/**
 * Create a rate limiter middleware
 * @param {object} opts
 * @param {string} opts.name       - Unique name for this limiter
 * @param {number} opts.windowMs   - Time window in ms (default 15 min)
 * @param {number} opts.max        - Max requests per window (default 100)
 * @param {string} [opts.message]  - Response message on limit
 * @param {boolean} [opts.skipSuccessfulRequests] - Only count failed requests
 * @param {function} [opts.keyGenerator] - Custom key generator (req) => string
 */
export function createRateLimiter(opts = {}) {
  const {
    name = 'default',
    windowMs = 15 * 60 * 1000,
    max = 100,
    message = 'Quá nhiều yêu cầu, vui lòng thử lại sau.',
    keyGenerator = (req) => req.ip || req.connection?.remoteAddress || 'unknown',
  } = opts;

  if (!stores.has(name)) {
    stores.set(name, new Map());
  }
  const store = stores.get(name);

  // Cleanup expired entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key);
    }
  }, 5 * 60 * 1000);

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', resetSeconds);

    if (entry.count > max) {
      res.setHeader('Retry-After', resetSeconds);
      return res.status(429).json({
        ok: false,
        error: message,
        retryAfter: resetSeconds,
      });
    }

    next();
  };
}

// ═══════════════════════════════════════════════
// Pre-built Limiters
// ═══════════════════════════════════════════════

/** General API: 200 requests per 15 minutes */
export const generalLimiter = createRateLimiter({
  name: 'general',
  windowMs: 15 * 60 * 1000,
  max: 200,
});

/** Auth API: 10 requests per 5 minutes (strict) */
export const authLimiter = createRateLimiter({
  name: 'auth',
  windowMs: 5 * 60 * 1000,
  max: 10,
  message: 'Quá nhiều lần đăng nhập, vui lòng thử lại sau 5 phút.',
});

/** Webhook API: 500 requests per 15 minutes (high throughput) */
export const webhookLimiter = createRateLimiter({
  name: 'webhook',
  windowMs: 15 * 60 * 1000,
  max: 500,
});

/** Dashboard API: 120 requests per 15 minutes */
export const dashboardLimiter = createRateLimiter({
  name: 'dashboard',
  windowMs: 15 * 60 * 1000,
  max: 120,
});

/** Order Lookup API: 20 requests per minute */
export const orderLookupLimiter = createRateLimiter({
  name: 'orderLookup',
  windowMs: 60 * 1000,
  max: 20,
  message: 'Quá nhiều yêu cầu tra cứu đơn hàng, vui lòng thử lại sau.'
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

import crypto from 'node:crypto';

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_VERSION = 1;

function stateSecret() {
  const secret = String(
    process.env.OAUTH_STATE_SECRET
      || process.env.ENCRYPTION_KEY
      || process.env.BOT_API_KEY
      || '',
  ).trim();
  if (!secret) {
    throw new Error('Thiếu OAUTH_STATE_SECRET, ENCRYPTION_KEY hoặc BOT_API_KEY để bảo vệ OAuth state.');
  }
  return secret;
}

function sign(encodedPayload) {
  return crypto.createHmac('sha256', stateSecret()).update(encodedPayload).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function createOAuthState(guildId, now = Date.now(), options = {}) {
  if (!/^\d{17,20}$/.test(String(guildId || ''))) {
    throw new Error('Guild ID OAuth không hợp lệ.');
  }
  const { clientId, store } = options;
  if (clientId !== undefined && !/^\d{17,20}$/.test(String(clientId || ''))) {
    throw new Error('Client ID OAuth không hợp lệ.');
  }
  if (store !== undefined && !['store1', 'store2'].includes(store)) {
    throw new Error('Store OAuth không hợp lệ.');
  }

  const payload = {
    v: STATE_VERSION,
    guildId: String(guildId),
    nonce: crypto.randomBytes(24).toString('base64url'),
    iat: now,
    exp: now + STATE_TTL_MS,
    ...(clientId !== undefined ? { clientId: String(clientId) } : {}),
    ...(store !== undefined ? { store } : {}),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function verifyOAuthState(state, cookieState, now = Date.now()) {
  const [encodedPayload, signature, ...extra] = String(state || '').split('.');
  if (!encodedPayload || !signature || extra.length || !safeEqual(state, cookieState)) {
    throw new Error('Phiên xác minh không hợp lệ hoặc không thuộc trình duyệt này.');
  }
  if (!safeEqual(signature, sign(encodedPayload))) {
    throw new Error('Chữ ký phiên xác minh không hợp lệ.');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Dữ liệu phiên xác minh không hợp lệ.');
  }

  if (
    payload?.v !== STATE_VERSION
    || !/^\d{17,20}$/.test(String(payload?.guildId || ''))
    || (payload?.clientId !== undefined && (typeof payload.clientId !== 'string' || !/^\d{17,20}$/.test(payload.clientId)))
    || (payload?.store !== undefined && !['store1', 'store2'].includes(payload.store))
    || typeof payload?.nonce !== 'string'
    || payload.nonce.length < 20
    || !Number.isFinite(payload?.iat)
    || !Number.isFinite(payload?.exp)
    || payload.iat > now + 30_000
    || payload.exp < now
    || payload.exp - payload.iat > STATE_TTL_MS
  ) {
    throw new Error('Phiên xác minh đã hết hạn hoặc không hợp lệ.');
  }

  return payload;
}

export function parseCookieHeader(header = '') {
  return String(header)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separator = part.indexOf('=');
      if (separator < 1) return cookies;
      try {
        const key = decodeURIComponent(part.slice(0, separator).trim());
        const value = decodeURIComponent(part.slice(separator + 1).trim());
        // Cookie names are untrusted; never let them mutate the object prototype.
        Object.defineProperty(cookies, key, { value, enumerable: true, configurable: true, writable: true });
      } catch {
        // Ignore malformed unrelated cookies. A malformed state cookie remains
        // absent and is rejected by verifyOAuthState without crashing callback.
      }
      return cookies;
    }, {});
}

export function oauthStateCookieName(clientId) {
  const suffix = String(clientId || '').replace(/\D/g, '').slice(-8) || 'default';
  return `cenar_oauth_state_${suffix}`;
}

export const OAUTH_STATE_TTL_MS = STATE_TTL_MS;

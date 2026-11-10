// Transport only. Product, status and delivery response schemas must be verified
// before enabling a purchase worker. Importing this module performs no requests.
export const DAIPHUC_PARTNER_ORIGIN = 'https://docs-tele.ryan-zola.dev';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RESPONSE_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 64 * 1024;
const MESSAGES = Object.freeze({
  INVALID_CONFIGURATION: 'Supplier client configuration is invalid.',
  NOT_CONFIGURED: 'Supplier API credentials are not configured.',
  INVALID_REQUEST: 'Supplier request parameters are invalid.',
  TIMEOUT: 'Supplier request exceeded its deadline.',
  NETWORK_ERROR: 'Supplier request could not be completed.',
  REDIRECT_REJECTED: 'Supplier redirects are not allowed.',
  AUTHENTICATION_FAILED: 'Supplier credentials were rejected.',
  RATE_LIMITED: 'Supplier request was rate limited.',
  REQUEST_REJECTED: 'Supplier rejected the request.',
  UPSTREAM_ERROR: 'Supplier service returned an error.',
  UNEXPECTED_STATUS: 'Supplier returned an undocumented status.',
  RESPONSE_TOO_LARGE: 'Supplier response exceeded the size limit.',
  INVALID_RESPONSE: 'Supplier response was not a valid JSON object.',
});

export class DaiphucPartnerError extends Error {
  constructor(code, { operation = 'configure', status = null, outcome = 'NOT_SUBMITTED' } = {}) {
    super(MESSAGES[code] || MESSAGES.NETWORK_ERROR);
    this.name = 'DaiphucPartnerError';
    this.code = Object.hasOwn(MESSAGES, code) ? code : 'NETWORK_ERROR';
    this.operation = operation;
    this.status = Number.isInteger(status) ? status : null;
    // UNKNOWN must be reconciled against the durable request. Never generate a
    // new purchase/idempotency key merely because the HTTP response was lost.
    this.outcome = outcome;
  }
}

function invalidRequest(operation) {
  return new DaiphucPartnerError('INVALID_REQUEST', { operation });
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function requireIdentifier(value, operation, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength
      || !value.isWellFormed() || /[\u0000-\u001f\u007f]/.test(value) || value === '.' || value === '..') {
    throw invalidRequest(operation);
  }
  return value;
}

function serializeOrder({ productId, quantity = 1, inputs = {}, idempotencyKey } = {}) {
  const operation = 'createOrder';
  requireIdentifier(productId, operation, 100);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100 || !isRecord(inputs)
      || typeof idempotencyKey !== 'string'
      || !/^[A-Za-z0-9._:-]{1,200}$/.test(idempotencyKey)) {
    throw invalidRequest(operation);
  }
  // Do not silently drop undefined/functions or rewrite Dates/non-finite values
  // in customer input: the persisted request and submitted body must agree.
  const seen = new Set();
  let nodes = 0;
  const visit = (value, depth = 0) => {
    nodes += 1;
    if (nodes > 2000 || depth > 12) throw invalidRequest(operation);
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if ((!isRecord(value) && !Array.isArray(value)) || seen.has(value)) throw invalidRequest(operation);
    seen.add(value);
    if (Object.getOwnPropertySymbols(value).length) throw invalidRequest(operation);
    if (Array.isArray(value)) {
      if (value.length > 2000) throw invalidRequest(operation);
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw invalidRequest(operation);
      }
    }
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!Object.hasOwn(descriptor, 'value')) throw invalidRequest(operation);
      if (Array.isArray(value) && name === 'length') continue;
      // Reject silent serialization changes, including hidden toJSON handlers
      // and custom array properties which JSON.stringify would discard.
      if (!descriptor.enumerable || (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(name))) throw invalidRequest(operation);
      visit(descriptor.value, depth + 1);
    }
    seen.delete(value);
  };
  try {
    visit(inputs);
    const body = JSON.stringify({ product_id: productId, quantity, inputs });
    if (Buffer.byteLength(body, 'utf8') > MAX_REQUEST_BYTES) throw invalidRequest(operation);
    return { body, idempotencyKey };
  } catch {
    throw invalidRequest(operation);
  }
}

async function readJsonObject(response, { maxResponseBytes, fail, controller }) {
  const declaredSize = response.headers.get('content-length');
  if (declaredSize && /^\d+$/.test(declaredSize) && Number(declaredSize) > maxResponseBytes) {
    throw fail('RESPONSE_TOO_LARGE');
  }
  const contentType = response.headers.get('content-type') || '';
  if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|\s*$)/i.test(contentType)) {
    throw fail('INVALID_RESPONSE');
  }
  if (!response.body || typeof response.body.getReader !== 'function') throw fail('INVALID_RESPONSE');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  controller.signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (controller.signal.aborted) throw fail('TIMEOUT');
      const { done, value } = await reader.read();
      if (controller.signal.aborted) throw fail('TIMEOUT');
      if (done) break;
      size += value.byteLength;
      if (size > maxResponseBytes) throw fail('RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
    } catch {
      throw fail('INVALID_RESPONSE');
    }
    if (!isRecord(parsed)) throw fail('INVALID_RESPONSE');
    return parsed;
  } finally {
    controller.signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

export function createDaiphucPartnerClient({
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxResponseBytes = DEFAULT_RESPONSE_BYTES,
} = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000
      || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 4 * 1024 * 1024) {
    throw new DaiphucPartnerError('INVALID_CONFIGURATION');
  }

  async function request(operation, path, { body, idempotencyKey, authenticated = true } = {}) {
    const isPurchase = body !== undefined;
    let key = '';
    if (authenticated) {
      key = apiKey === undefined ? process.env.DAIPHUC_PARTNER_API_KEY : apiKey;
      if (typeof key !== 'string' || !key.trim()) throw new DaiphucPartnerError('NOT_CONFIGURED', { operation });
      key = key.trim();
      if (key.length > 4096 || /[^\x21-\x7e]/.test(key)) throw new DaiphucPartnerError('INVALID_CONFIGURATION', { operation });
    }
    const url = new URL(path, DAIPHUC_PARTNER_ORIGIN);
    if (url.origin !== DAIPHUC_PARTNER_ORIGIN || url.protocol !== 'https:') throw invalidRequest(operation);
    const controller = new AbortController();
    let attempted = false;
    let response;
    const fail = (code, status = null) => new DaiphucPartnerError(code, {
      operation,
      status,
      outcome: isPurchase && attempted ? 'UNKNOWN' : 'NOT_SUBMITTED',
    });
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(fail('TIMEOUT'));
      }, timeoutMs);
    });
    const run = async () => {
      attempted = true;
      response = await fetchImpl(url.href, {
        method: isPurchase ? 'POST' : 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(authenticated ? { Authorization: `Bearer ${key}` } : {}),
          ...(isPurchase ? { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey } : {}),
        },
        ...(isPurchase ? { body } : {}),
      });
      if (controller.signal.aborted) {
        if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
        throw fail('TIMEOUT');
      }
      if (response.redirected || (response.status >= 300 && response.status < 400)
          || (response.url && response.url !== url.href)) throw fail('REDIRECT_REJECTED', response.status);
      if (response.status === 401 || response.status === 403) throw fail('AUTHENTICATION_FAILED', response.status);
      if (response.status === 429) throw fail('RATE_LIMITED', response.status);
      if (response.status >= 500) throw fail('UPSTREAM_ERROR', response.status);
      if (response.status >= 400) throw fail('REQUEST_REJECTED', response.status);
      if (response.status !== (isPurchase ? 201 : 200)) throw fail('UNEXPECTED_STATUS', response.status);
      return readJsonObject(response, { maxResponseBytes, fail, controller });
    };
    try {
      // The explicit race also bounds injected transports which ignore abort.
      return await Promise.race([run(), deadline]);
    } catch (error) {
      if (error instanceof DaiphucPartnerError) throw error;
      throw fail(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
    }
  }

  return Object.freeze({
    getHealth: () => request('getHealth', '/health', { authenticated: false }),
    getMe: () => request('getMe', '/v1/me'),
    getProducts: () => request('getProducts', '/v1/products'),
    listOrders: ({ limit = 50 } = {}) => {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw invalidRequest('listOrders');
      return request('listOrders', `/v1/orders?limit=${limit}`);
    },
    getOrder: (orderId) => request('getOrder', `/v1/orders/${encodeURIComponent(requireIdentifier(orderId, 'getOrder'))}`),
    getOrderLogs: (orderId) => request('getOrderLogs', `/v1/orders/${encodeURIComponent(requireIdentifier(orderId, 'getOrderLogs'))}/logs`),
    createOrder: (params) => {
      let serialized;
      try { serialized = serializeOrder(params); } catch { throw invalidRequest('createOrder'); }
      return request('createOrder', '/v1/orders', serialized);
    },
  });
}

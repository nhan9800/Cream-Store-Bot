import { createHash } from 'node:crypto';

// Importing this transport never performs requests. Purchases require an exact
// durable caller-owned request ID; no retry or new ID is generated here.
export const DOPERMIND_ORIGIN = 'https://api-gateway-production-be99.up.railway.app';

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
  INVALID_RESPONSE: 'Supplier response was not valid JSON.',
  PROVIDER_REJECTED: 'Supplier did not confirm a successful response.',
  INVALID_SCHEMA: 'Supplier response did not match its verified schema.',
  PRICE_LIMIT_EXCEEDED: 'Supplier charged above the confirmed cost limit.',
});

const PROVIDER_CODES = new Set(['INVALID_REQUEST_ID', 'INVALID_JSON', 'INVALID_API_KEY', 'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE', 'PRODUCT_NOT_FOUND', 'NOT_ENOUGH_STOCK', 'INSUFFICIENT_BALANCE', 'PRICE_CHANGED',
  'API_REQUEST_CONFLICT', 'API_ORDER_MANUALLY_FULFILLED', 'ORDER_FULFILLMENT_PENDING', 'ORDER_HISTORY_PENDING', 'RATE_LIMITED']);
const DEFINITIVE_REJECTIONS = new Set(['INVALID_REQUEST_ID', 'INVALID_JSON', 'INVALID_API_KEY', 'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE', 'PRODUCT_NOT_FOUND', 'NOT_ENOUGH_STOCK', 'INSUFFICIENT_BALANCE', 'PRICE_CHANGED', 'RATE_LIMITED']);
const rateSlots = new Map();
const privateReadCache = new Map();
function cacheState(identity) {
  if (!privateReadCache.has(identity)) privateReadCache.set(identity, { generation: 0, balance: null, stock: null });
  if (privateReadCache.size > 1000) privateReadCache.delete(privateReadCache.keys().next().value);
  return privateReadCache.get(identity);
}

async function rateSlot(key, operation, controller, timeoutMs, fail) {
  const identity = createHash('sha256').update(key).digest('hex');
  const state = rateSlots.get(identity) || { read: 0, balance: 0, stock: 0, purchase: 0 };
  const field = operation === 'createOrder' ? 'purchase' : operation === 'getBalance' ? 'balance' : 'stock';
  const time = Date.now();
  const at = Math.max(time, state[field], field === 'purchase' ? 0 : state.read);
  const delay = at - time;
  if (delay > Math.max(0, timeoutMs - 250)) throw fail('RATE_LIMITED');
  state[field] = at + (field === 'stock' ? 2100 : 5100);
  if (field !== 'purchase') state.read = at + 1450;
  rateSlots.set(identity, state);
  if (rateSlots.size > 1000) rateSlots.delete(rateSlots.keys().next().value);
  if (delay > 0) await new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(fail('TIMEOUT')); };
    const timer = setTimeout(() => { controller.signal.removeEventListener('abort', onAbort); resolve(); }, delay);
    controller.signal.addEventListener('abort', onAbort, { once: true });
    if (controller.signal.aborted) onAbort();
  });
}

export class DopermindError extends Error {
  constructor(code, { operation = 'configure', status = null, outcome = 'NOT_SUBMITTED', providerCode = null } = {}) {
    const safeCode = Object.hasOwn(MESSAGES, code) ? code : 'NETWORK_ERROR';
    super(MESSAGES[safeCode]);
    this.name = 'DopermindError';
    this.code = safeCode;
    this.operation = ['configure', 'getBalance', 'getStock', 'createOrder'].includes(operation) ? operation : 'configure';
    this.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    this.outcome = ['NOT_SUBMITTED', 'UNKNOWN', 'REJECTED', 'FULFILLED_REVIEW'].includes(outcome) ? outcome : 'UNKNOWN';
    this.providerCode = PROVIDER_CODES.has(providerCode) ? providerCode : null;
  }
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const text = (value, maximum = 500) => typeof value === 'string' && value.trim().length > 0
  && value.length <= maximum && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);
const date = value => typeof value === 'string' && value.length <= 40
  && /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

function productKey(value, operation = 'getStock') {
  if (!text(value, 200)) throw new DopermindError('INVALID_REQUEST', { operation });
  return value;
}

function dataFrom(envelope, fail) {
  if (!record(envelope)) throw fail('INVALID_SCHEMA');
  if (envelope.success !== true) throw fail('PROVIDER_REJECTED');
  if (!record(envelope.data)) throw fail('INVALID_SCHEMA');
  return envelope.data;
}

function balanceFrom(envelope, fail) {
  const data = dataFrom(envelope, fail);
  if (!integer(data.balance) || data.currency !== 'VND' || !date(data.updated_at)) throw fail('INVALID_SCHEMA');
  return Object.freeze({ balanceVnd: data.balance, currency: 'VND', updatedAt: data.updated_at });
}

function productsFrom(envelope, fail, filter) {
  const data = dataFrom(envelope, fail);
  if (!Array.isArray(data.products) || data.products.length > 5000) throw fail('INVALID_SCHEMA');
  const seen = new Set();
  const products = data.products.map(item => {
    if (!record(item) || !text(item.product_key, 200) || !text(item.name)
      || !text(item.name_en) || !text(item.type, 80) || !integer(item.price)
      || !integer(item.base_price) || typeof item.unlimited !== 'boolean'
      || !integer(item.stock, item.unlimited ? -1 : 0) || seen.has(item.product_key)
      || (filter !== undefined && item.product_key !== filter)) throw fail('INVALID_SCHEMA');
    seen.add(item.product_key);
    // Supplier names are data, never Markdown/HTML or trusted command inputs.
    // Unlimited stock uses -1 in the verified live response; preserve it only
    // when unlimited=true rather than presenting an invented finite quantity.
    return Object.freeze({
      productKey: item.product_key, name: item.name, nameEn: item.name_en,
      type: item.type, priceVnd: item.price, basePriceVnd: item.base_price,
      stock: item.stock, unlimited: item.unlimited,
    });
  });
  return Object.freeze(products);
}

function purchaseFrom(envelope, fail, request) {
  const data = dataFrom(envelope, fail);
  if (data.request_id !== request.requestId || data.product_key !== request.productKey || data.quantity !== request.quantity
    || !text(data.order_code, 200) || !integer(data.unit_price, 1) || !integer(data.total_amount, 1)
    || !integer(data.balance_after) || !date(data.created_at) || typeof data.idempotent !== 'boolean'
    || !Array.isArray(data.items) || data.items.length !== request.quantity
    || data.items.some(item => typeof item !== 'string' || !item.trim() || !item.isWellFormed() || item.length > 128000)
    || Buffer.byteLength(JSON.stringify(data.items), 'utf8') > 512 * 1024
    || BigInt(data.unit_price) * BigInt(request.quantity) !== BigInt(data.total_amount)) throw fail('INVALID_SCHEMA');
  // Keep the validated receipt even if an upstream race exceeded the local cost
  // ceiling. The engine must retain/encrypt it for staff review, never re-buy.
  return Object.freeze({ requestId: data.request_id, orderCode: data.order_code, productKey: data.product_key,
    quantity: data.quantity, unitPriceVnd: data.unit_price, totalAmountVnd: data.total_amount,
    balanceAfterVnd: data.balance_after, createdAt: data.created_at, idempotent: data.idempotent,
    overCostLimit: data.unit_price > request.maxUnitCostVnd, items: Object.freeze([...data.items]) });
}

async function readJson(response, { maxResponseBytes, fail, controller }) {
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxResponseBytes) throw fail('RESPONSE_TOO_LARGE');
  if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') || '')
    || !response.body || typeof response.body.getReader !== 'function') throw fail('INVALID_RESPONSE');
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
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
    } catch { throw fail('INVALID_RESPONSE'); }
  } finally {
    controller.signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

export function createDopermindClient({
  apiKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
  maxResponseBytes = 1024 * 1024,
  enforceRateLimits = fetchImpl === globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
    || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 4 * 1024 * 1024
    || typeof enforceRateLimits !== 'boolean') {
    throw new DopermindError('INVALID_CONFIGURATION');
  }
  const credential = operation => {
    const raw = apiKey === undefined ? process.env.DOPERMIND_API_KEY : apiKey;
    if (typeof raw !== 'string' || !raw.trim()) throw new DopermindError('NOT_CONFIGURED', { operation });
    const key = raw.trim();
    if (key.length > 4096 || /[^\x21-\x7e]/.test(key)) throw new DopermindError('INVALID_CONFIGURATION', { operation });
    return key;
  };
  const identity = operation => createHash('sha256').update(credential(operation)).digest('hex');
  async function cachedRead(operation, path, normalize, filter = undefined) {
    if (!enforceRateLimits) return request(operation, path, normalize);
    const state = cacheState(identity(operation));
    const entry = operation === 'getBalance' ? state.balance : state.stock;
    const ttl = operation === 'getBalance' ? 5500 : 2500;
    if (entry && Date.now() - entry.at >= 0 && Date.now() - entry.at < ttl) {
      return filter === undefined ? entry.value : Object.freeze(entry.value.filter(item => item.productKey === filter));
    }
    const generation = state.generation;
    const value = await request(operation, path, normalize);
    // Filtered reads cannot stand in for the full stock catalog.
    if (generation === state.generation && (operation === 'getBalance' || filter === undefined)) {
      state[operation === 'getBalance' ? 'balance' : 'stock'] = { at: Date.now(), value };
    }
    return value;
  }

  async function request(operation, path, normalize, purchase = null) {
    let attempted = false;
    const fail = (code, status = null, extra = {}) => new DopermindError(code, {
      operation, status, outcome: purchase && attempted ? 'UNKNOWN' : 'NOT_SUBMITTED', ...extra,
    });
    const key = credential(operation);
    const url = new URL(path, DOPERMIND_ORIGIN);
    if (url.origin !== DOPERMIND_ORIGIN || url.protocol !== 'https:') throw fail('INVALID_REQUEST');
    const controller = new AbortController();
    let response;
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(fail('TIMEOUT')); }, timeoutMs);
    });
    const run = async () => {
      if (enforceRateLimits) await rateSlot(key, operation, controller, timeoutMs, fail);
      if (controller.signal.aborted) throw fail('TIMEOUT');
      attempted = true;
      response = await fetchImpl(url.href, {
        method: purchase ? 'POST' : 'GET', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: `Bearer ${key}`,
          ...(purchase ? { 'Content-Type': 'application/json' } : {}) },
        ...(purchase ? { body: JSON.stringify({ product_key: purchase.productKey, quantity: purchase.quantity, request_id: purchase.requestId }) } : {}),
      });
      if (controller.signal.aborted) throw fail('TIMEOUT');
      if (response.redirected || (response.status >= 300 && response.status < 400)
        || (response.url && response.url !== url.href)) throw fail('REDIRECT_REJECTED', response.status);
      if (response.status === 401 || response.status === 403) throw fail('AUTHENTICATION_FAILED', response.status, { outcome: 'NOT_SUBMITTED' });
      if (purchase && response.status >= 400) {
        const body = await readJson(response, { maxResponseBytes, fail, controller });
        const candidate = body?.error?.code ?? body?.code;
        const providerCode = PROVIDER_CODES.has(candidate) ? candidate : null;
        throw fail(response.status === 429 ? 'RATE_LIMITED' : response.status >= 500 ? 'UPSTREAM_ERROR' : 'REQUEST_REJECTED', response.status, {
          providerCode, outcome: DEFINITIVE_REJECTIONS.has(providerCode) ? 'REJECTED' : 'UNKNOWN',
        });
      }
      if (response.status === 429) throw fail('RATE_LIMITED', response.status);
      if (response.status >= 500) throw fail('UPSTREAM_ERROR', response.status);
      if (response.status >= 400) throw fail('REQUEST_REJECTED', response.status);
      if (response.status !== 200) throw fail('UNEXPECTED_STATUS', response.status);
      return normalize(await readJson(response, { maxResponseBytes, fail, controller }), fail);
    };
    try {
      // Also bounds a stalled body or injected fetch which ignores abort.
      return await Promise.race([run(), deadline]);
    } catch (error) {
      if (error instanceof DopermindError) throw error;
      throw fail(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR');
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
    }
  }

  return Object.freeze({
    getBalance: () => cachedRead('getBalance', '/v1/balance', balanceFrom),
    getStock: ({ productKey: filter } = {}) => {
      if (filter !== undefined) productKey(filter);
      const path = filter === undefined ? '/v1/stock' : `/v1/stock?${new URLSearchParams({ product_key: filter })}`;
      return cachedRead('getStock', path, (envelope, fail) => productsFrom(envelope, fail, filter), filter);
    },
    createOrder: ({ productKey: key, quantity, requestId, maxUnitCostVnd } = {}) => {
      productKey(key, 'createOrder');
      if (!integer(quantity, 1) || quantity > 1000 || typeof requestId !== 'string'
        || !/^[A-Za-z0-9._:-]{8,96}$/.test(requestId) || !integer(maxUnitCostVnd, 1)) {
        throw new DopermindError('INVALID_REQUEST', { operation: 'createOrder' });
      }
      const purchase = { productKey: key, quantity, requestId, maxUnitCostVnd };
      const execute = async () => {
        const state = enforceRateLimits ? cacheState(identity('createOrder')) : null;
        if (state) { state.generation++; state.balance = null; state.stock = null; }
        const receipt = await request('createOrder', '/v1/orders', (envelope, fail) => purchaseFrom(envelope, fail, purchase), purchase);
        if (state && receipt.idempotent === false && Math.abs(Date.now() - Date.parse(receipt.createdAt)) <= 30000) {
          state.balance = { at: Date.now(), value: Object.freeze({ balanceVnd: receipt.balanceAfterVnd, currency: 'VND', updatedAt: receipt.createdAt }) };
        }
        return receipt;
      };
      return execute();
    },
  });
}

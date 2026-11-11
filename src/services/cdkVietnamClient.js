import { createHash } from 'node:crypto';

/**
 * CDK Việt Nam dealer API transport.
 *
 * The provider uses numeric product IDs while Cenar's supplier engine uses a
 * stable string key.  The adapter deliberately exposes keys as
 * `cdkvietnam:<id>` so a provider switch can never accidentally purchase a
 * similarly named product from another source.
 */
export const CDK_VIETNAM_ORIGIN = 'https://api.cdkvietnam.com';
const PRODUCT_KEY_PREFIX = 'cdkvietnam:';
const MAX_PRODUCTS = 5000;
const MAX_QUANTITY = 100;
const ORDER_ID = /^ord_[a-f0-9]{32}$/;
const PRODUCT_KEY = /^cdkvietnam:(\d+)$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,79}$/;
const PROVIDER_CODES = new Set([
  'INVALID_ORDER', 'INVALID_IDEMPOTENCY_KEY', 'INVALID_JSON', 'UNAUTHORIZED',
  'INSUFFICIENT_BALANCE', 'ACCOUNT_DISABLED', 'IP_DENIED', 'SERVER_ONLY',
  'PRODUCT_NOT_FOUND', 'ORDER_NOT_FOUND', 'OUT_OF_STOCK', 'PRODUCT_LOCKED',
  'PRICE_CHANGED', 'IDEMPOTENCY_CONFLICT', 'DELIVERY_REVIEW', 'RATE_LIMITED',
  'INTERNAL_ERROR', 'BUSY', 'BODY_TOO_LARGE', 'HTTPS_REQUIRED',
]);
const REJECTED_CODES = new Set([
  'INVALID_ORDER', 'INVALID_IDEMPOTENCY_KEY', 'INVALID_JSON', 'UNAUTHORIZED',
  'ACCOUNT_DISABLED', 'IP_DENIED', 'SERVER_ONLY', 'PRODUCT_NOT_FOUND',
  'ORDER_NOT_FOUND', 'OUT_OF_STOCK', 'PRODUCT_LOCKED', 'PRICE_CHANGED',
  'IDEMPOTENCY_CONFLICT', 'BODY_TOO_LARGE', 'HTTPS_REQUIRED',
]);

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
  DELIVERY_PENDING: 'Supplier order is awaiting delivery.',
});

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum;
const text = (value, maximum = 1000) => typeof value === 'string' && value.trim().length > 0
  && value.length <= maximum && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);
const isoDate = value => typeof value === 'string' && value.length <= 40
  && /^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

function productIdFromKey(value, operation = 'getStock') {
  if (typeof value !== 'string' || !PRODUCT_KEY.test(value)) {
    throw new CdkVietnamError('INVALID_REQUEST', { operation });
  }
  const id = Number(value.slice(PRODUCT_KEY_PREFIX.length));
  if (!integer(id, 1)) throw new CdkVietnamError('INVALID_REQUEST', { operation });
  return id;
}

function safeProviderCode(value) {
  return PROVIDER_CODES.has(value) ? value : null;
}

function envelopeBody(body, fail) {
  if (!record(body)) throw fail('INVALID_SCHEMA');
  return body;
}

function priceForQuantity(prices, quantity = 1, fail = code => new CdkVietnamError(code)) {
  if (!Array.isArray(prices) || prices.length < 1 || prices.length > 100) throw fail('INVALID_SCHEMA');
  const rows = prices.map(row => {
    if (!record(row) || !integer(row.min_quantity, 1) || !integer(row.unit_price, 1)) throw fail('INVALID_SCHEMA');
    return { minQuantity: row.min_quantity, unitPrice: row.unit_price };
  }).sort((a, b) => a.minQuantity - b.minQuantity);
  let selected = rows[0].unitPrice;
  for (const row of rows) if (row.minQuantity <= quantity) selected = row.unitPrice;
  return selected;
}

function productsFrom(body, fail) {
  const payload = envelopeBody(body, fail);
  if (!Array.isArray(payload.products) || payload.products.length > MAX_PRODUCTS) throw fail('INVALID_SCHEMA');
  const seen = new Set();
  const products = payload.products.map(item => {
    if (!record(item) || !integer(item.id, 1) || seen.has(item.id) ||
      !text(item.name, 500) ||
      !text(item.currency, 8) || item.currency !== 'VND' || !integer(item.stock) ||
      typeof item.locked !== 'boolean' || !['automatic', 'manual'].includes(item.delivery)) {
      throw fail('INVALID_SCHEMA');
    }
    const unitPrice = priceForQuantity(item.prices, 1, fail);
    seen.add(item.id);
    return Object.freeze({
      productKey: `${PRODUCT_KEY_PREFIX}${item.id}`,
      providerProductId: item.id,
      name: item.name,
      nameEn: item.name,
      type: 'cdk',
      priceVnd: unitPrice,
      basePriceVnd: unitPrice,
      stock: item.stock,
      unlimited: false,
      locked: item.locked,
      delivery: item.delivery,
      description: text(item.description, 12000) ? item.description : null,
    });
  });
  return Object.freeze(products);
}

function balanceFrom(body, fail, now) {
  const payload = envelopeBody(body, fail);
  if (!integer(payload.balance) || payload.currency !== 'VND') throw fail('INVALID_SCHEMA');
  const updatedAt = isoDate(payload.updated_at) ? payload.updated_at : new Date(now()).toISOString();
  return Object.freeze({ balanceVnd: payload.balance, currency: 'VND', updatedAt });
}

function orderFrom(body, fail, request, now) {
  const payload = envelopeBody(body, fail);
  const order = payload.order;
  if (!record(order) || !ORDER_ID.test(order.id) || order.idempotency_key !== request.requestId
    || order.product_id !== request.productId || !text(order.product_name, 500)
    || order.quantity !== request.quantity || !integer(order.unit_price, 1)
    || !integer(order.total_price, 1) || order.currency !== 'VND'
    || !['delivered', 'awaiting_delivery'].includes(order.status)
    || !isoDate(order.created_at) || !Array.isArray(order.items)
    || order.items.length > request.quantity || order.items.some(item => !text(item, 128000))
    || BigInt(order.unit_price) * BigInt(order.quantity) !== BigInt(order.total_price)) {
    throw fail('INVALID_SCHEMA');
  }
  if (order.status === 'awaiting_delivery' || order.items.length !== request.quantity) {
    // Keep the provider order ID so the durable commerce worker can poll the
    // documented GET endpoint instead of creating a second paid order.
    throw fail('DELIVERY_PENDING', null, { providerCode: 'DELIVERY_REVIEW', outcome: 'UNKNOWN', providerOrderCode: order.id });
  }
  return Object.freeze({
    requestId: order.idempotency_key,
    orderCode: order.id,
    productKey: request.productKey,
    quantity: order.quantity,
    unitPriceVnd: order.unit_price,
    totalAmountVnd: order.total_price,
    balanceAfterVnd: integer(payload.balance_after, 0) ? payload.balance_after : null,
    createdAt: order.created_at,
    idempotent: payload.replayed === true,
    overCostLimit: order.unit_price > request.maxUnitCostVnd,
    items: Object.freeze([...order.items]),
  });
}

function orderReadFrom(body, fail) {
  const payload = envelopeBody(body, fail);
  const order = payload.order ?? payload;
  if (!record(order) || !ORDER_ID.test(order.id) || !integer(order.product_id, 1)
    || !text(order.product_name, 500) || !integer(order.quantity, 1)
    || !integer(order.unit_price, 1) || !integer(order.total_price, 1)
    || order.currency !== 'VND' || !['delivered', 'awaiting_delivery'].includes(order.status)
    || !isoDate(order.created_at) || !Array.isArray(order.items)
    || order.items.some(item => !text(item, 128000))) throw fail('INVALID_SCHEMA');
  return Object.freeze({ orderCode: order.id, productId: order.product_id, productName: order.product_name,
    quantity: order.quantity, unitPriceVnd: order.unit_price, totalAmountVnd: order.total_price,
    currency: order.currency, status: order.status, createdAt: order.created_at,
    items: Object.freeze([...order.items]) });
}

export class CdkVietnamError extends Error {
  constructor(code, { operation = 'configure', status = null, outcome = 'NOT_SUBMITTED', providerCode = null, providerOrderCode = null } = {}) {
    const safeCode = Object.hasOwn(MESSAGES, code) ? code : 'NETWORK_ERROR';
    super(MESSAGES[safeCode]);
    this.name = 'CdkVietnamError';
    this.code = safeCode;
    this.operation = ['configure', 'getBalance', 'getStock', 'createOrder', 'getOrder'].includes(operation) ? operation : 'configure';
    this.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    this.outcome = ['NOT_SUBMITTED', 'UNKNOWN', 'REJECTED'].includes(outcome) ? outcome : 'UNKNOWN';
    this.providerCode = safeProviderCode(providerCode);
    this.providerOrderCode = typeof providerOrderCode === 'string' && ORDER_ID.test(providerOrderCode) ? providerOrderCode : null;
  }
}

async function readJson(response, { maxResponseBytes, fail, controller }) {
  const declared = response.headers.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxResponseBytes) throw fail('RESPONSE_TOO_LARGE');
  if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|\s*$)/i.test(response.headers.get('content-type') || '')
    || !response.body || typeof response.body.getReader !== 'function') throw fail('INVALID_RESPONSE');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
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
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
    catch { throw fail('INVALID_RESPONSE'); }
  } finally { controller.signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
}

export function createCdkVietnamClient({
  apiKey, fetchImpl = globalThis.fetch, timeoutMs = 10000, maxResponseBytes = 4 * 1024 * 1024,
  now = Date.now,
} = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
    || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 8 * 1024 * 1024
    || typeof now !== 'function') throw new CdkVietnamError('INVALID_CONFIGURATION');
  const credential = operation => {
    const raw = apiKey === undefined ? process.env.CDKVIETNAM_API_KEY : apiKey;
    if (typeof raw !== 'string' || !raw.trim()) throw new CdkVietnamError('NOT_CONFIGURED', { operation });
    const key = raw.trim();
    if (key.length > 4096 || /[^\x21-\x7e]/.test(key)) throw new CdkVietnamError('INVALID_CONFIGURATION', { operation });
    return key;
  };
  const identity = operation => createHash('sha256').update(credential(operation)).digest('hex');
  const cache = new Map();
  async function request(operation, path, { method = 'GET', body = null, requestId = null } = {}) {
    let attempted = false; let response; let timer;
    const fail = (code, status = null, extra = {}) => new CdkVietnamError(code, {
      operation, status, outcome: attempted && method === 'POST' ? 'UNKNOWN' : 'NOT_SUBMITTED', ...extra,
    });
    const key = credential(operation); const url = new URL(path, CDK_VIETNAM_ORIGIN);
    if (url.origin !== CDK_VIETNAM_ORIGIN || url.protocol !== 'https:') throw fail('INVALID_REQUEST');
    const controller = new AbortController();
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(fail('TIMEOUT')); }, timeoutMs); });
    const run = async () => {
      attempted = true;
      response = await fetchImpl(url.href, { method, redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: `Bearer ${key}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}), ...(requestId ? { 'Idempotency-Key': requestId } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      if (controller.signal.aborted) throw fail('TIMEOUT');
      if (response.redirected || (response.status >= 300 && response.status < 400) || (response.url && response.url !== url.href)) throw fail('REDIRECT_REJECTED', response.status);
      if (response.status === 401 || response.status === 403) throw fail('AUTHENTICATION_FAILED', response.status, { outcome: method === 'POST' ? 'NOT_SUBMITTED' : 'NOT_SUBMITTED', providerCode: response.status === 403 ? 'SERVER_ONLY' : 'UNAUTHORIZED' });
      if (response.status === 429) throw fail('RATE_LIMITED', response.status, { providerCode: 'RATE_LIMITED' });
      const bodyJson = await readJson(response, { maxResponseBytes, fail, controller });
      if (response.status >= 500) throw fail('UPSTREAM_ERROR', response.status, { providerCode: bodyJson?.error?.code ?? bodyJson?.code });
      if (response.status >= 400) {
        const providerCode = bodyJson?.error?.code ?? bodyJson?.code;
        const safe = safeProviderCode(providerCode);
        throw fail(response.status === 429 ? 'RATE_LIMITED' : 'REQUEST_REJECTED', response.status, { providerCode: safe,
          outcome: REJECTED_CODES.has(safe) ? 'REJECTED' : method === 'POST' ? 'UNKNOWN' : 'NOT_SUBMITTED' });
      }
      if (![200, 201, 202].includes(response.status)) throw fail('UNEXPECTED_STATUS', response.status);
      return { status: response.status, body: bodyJson };
    };
    try { return await Promise.race([run(), deadline]); }
    catch (error) { if (error instanceof CdkVietnamError) throw error; throw fail(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR'); }
    finally { clearTimeout(timer); controller.abort(); if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {}); }
  }
  async function getStock({ productKey = undefined } = {}) {
    let filterId = null;
    if (productKey !== undefined) filterId = productIdFromKey(productKey, 'getStock');
    const identityKey = identity('getStock');
    const cacheKey = `${identityKey}:${filterId ?? 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    let after = 0; const all = [];
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({ after: String(after), limit: '100' });
      const response = await request('getStock', `/v1/products?${query}`);
      const rows = productsFrom(response.body, code => new CdkVietnamError(code, { operation: 'getStock' }));
      all.push(...rows);
      if ((filterId !== null && all.some(row => row.providerProductId === filterId))
        || !Number.isSafeInteger(response.body?.next_after) || response.body.next_after <= after) break;
      after = response.body.next_after;
    }
    const value = Object.freeze(filterId === null ? all : all.filter(row => row.providerProductId === filterId));
    cache.set(cacheKey, { value, expiresAt: Date.now() + 2500 });
    return value;
  }
  async function getBalance() {
    const response = await request('getBalance', '/v1/balance');
    return balanceFrom(response.body, code => new CdkVietnamError(code, { operation: 'getBalance' }), now);
  }
  async function createOrder({ productKey, quantity, requestId, maxUnitCostVnd } = {}) {
    const productId = productIdFromKey(productKey, 'createOrder');
    if (!integer(quantity, 1) || quantity > MAX_QUANTITY || typeof requestId !== 'string' || !REQUEST_ID.test(requestId)
      || !integer(maxUnitCostVnd, 1) || BigInt(maxUnitCostVnd) * BigInt(quantity) > 1_000_000_000_000n) {
      throw new CdkVietnamError('INVALID_REQUEST', { operation: 'createOrder' });
    }
    const response = await request('createOrder', '/v1/orders', {
      method: 'POST', requestId, body: { product_id: productId, quantity, max_total: maxUnitCostVnd * quantity },
    });
    return orderFrom(response.body, (code, status, extra) => new CdkVietnamError(code, { operation: 'createOrder', status, ...extra }),
      { productId, productKey, quantity, requestId, maxUnitCostVnd }, now);
  }
  async function getOrder({ orderId } = {}) {
    if (typeof orderId !== 'string' || !ORDER_ID.test(orderId)) throw new CdkVietnamError('INVALID_REQUEST', { operation: 'getOrder' });
    const response = await request('getOrder', `/v1/orders/${encodeURIComponent(orderId)}`);
    return orderReadFrom(response.body, code => new CdkVietnamError(code, { operation: 'getOrder' }));
  }
  return Object.freeze({ getBalance, getStock, createOrder, getOrder });
}


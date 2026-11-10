// Read-only transport. Importing this module never performs requests and the
// returned client has no purchase capability. Credentials belong server-side.
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
});

export class DopermindError extends Error {
  constructor(code, { operation = 'configure', status = null } = {}) {
    const safeCode = Object.hasOwn(MESSAGES, code) ? code : 'NETWORK_ERROR';
    super(MESSAGES[safeCode]);
    this.name = 'DopermindError';
    this.code = safeCode;
    this.operation = ['configure', 'getBalance', 'getStock'].includes(operation) ? operation : 'configure';
    this.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    this.outcome = 'NOT_SUBMITTED';
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
} = {}) {
  if (typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
    || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 4 * 1024 * 1024) {
    throw new DopermindError('INVALID_CONFIGURATION');
  }

  async function request(operation, path, normalize) {
    const fail = (code, status = null) => new DopermindError(code, { operation, status });
    const raw = apiKey === undefined ? process.env.DOPERMIND_API_KEY : apiKey;
    if (typeof raw !== 'string' || !raw.trim()) throw fail('NOT_CONFIGURED');
    const key = raw.trim();
    if (key.length > 4096 || /[^\x21-\x7e]/.test(key)) throw fail('INVALID_CONFIGURATION');
    const url = new URL(path, DOPERMIND_ORIGIN);
    if (url.origin !== DOPERMIND_ORIGIN || url.protocol !== 'https:') throw fail('INVALID_REQUEST');
    const controller = new AbortController();
    let response;
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(fail('TIMEOUT')); }, timeoutMs);
    });
    const run = async () => {
      response = await fetchImpl(url.href, {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
      });
      if (controller.signal.aborted) throw fail('TIMEOUT');
      if (response.redirected || (response.status >= 300 && response.status < 400)
        || (response.url && response.url !== url.href)) throw fail('REDIRECT_REJECTED', response.status);
      if (response.status === 401 || response.status === 403) throw fail('AUTHENTICATION_FAILED', response.status);
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
    getBalance: () => request('getBalance', '/v1/balance', balanceFrom),
    getStock: ({ productKey: filter } = {}) => {
      if (filter !== undefined) productKey(filter);
      const path = filter === undefined ? '/v1/stock' : `/v1/stock?${new URLSearchParams({ product_key: filter })}`;
      return request('getStock', path, (envelope, fail) => productsFrom(envelope, fail, filter));
    },
  });
}

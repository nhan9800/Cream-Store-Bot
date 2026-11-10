import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { createDaiphucPartnerClient, DaiphucPartnerError } from './daiphucPartnerClient.js';

const OPERATIONS = Object.freeze([
  ['health', 'getHealth'], ['account', 'getMe'], ['products', 'getProducts'],
]);
const ERROR_CODES = new Set([
  'INVALID_CONFIGURATION', 'NOT_CONFIGURED', 'INVALID_REQUEST', 'TIMEOUT',
  'NETWORK_ERROR', 'REDIRECT_REJECTED', 'AUTHENTICATION_FAILED', 'RATE_LIMITED',
  'REQUEST_REJECTED', 'UPSTREAM_ERROR', 'UNEXPECTED_STATUS', 'RESPONSE_TOO_LARGE', 'INVALID_RESPONSE',
]);

function emptyChecks() {
  return Object.fromEntries(OPERATIONS.map(([name]) => [name, {
    requestSucceeded: false, httpStatus: null, error: null,
  }]));
}

function freezeSnapshot(status, startedAt = null, checkedAt = null, checks = emptyChecks()) {
  for (const result of Object.values(checks)) Object.freeze(result);
  return Object.freeze({
    status, readOnly: true, purchasesEnabled: false, schemaMapped: false,
    startedAt, checkedAt, checks: Object.freeze(checks),
  });
}

function safeFailure(error) {
  // Only our typed transport metadata is eligible. Never serialize a provider
  // payload, arbitrary message/code, cause, URL, credential or dictionary key.
  let code = 'REQUEST_FAILED';
  let httpStatus = null;
  try {
    if (error instanceof DaiphucPartnerError) {
      if (ERROR_CODES.has(error.code)) code = error.code;
      if (Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) httpStatus = error.status;
    }
  } catch {
    // Even hostile accessors must leave only constant metadata in public health.
    code = 'REQUEST_FAILED';
    httpStatus = null;
  }
  return { requestSucceeded: false, httpStatus, error: code };
}

/**
 * One read-only startup probe per process. No intervals, restart loop, payment
 * hooks or purchase method are exposed. A successful HTTP read does not prove
 * the undocumented account/product schema or authorize a sellable offer.
 */
export function createSupplierAutobuyRuntime({
  clientFactory = createDaiphucPartnerClient,
  now = Date.now,
  requestTimeoutMs = 10000,
} = {}) {
  if (typeof clientFactory !== 'function' || typeof now !== 'function'
    || !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 10000) {
    throw new Error('Supplier runtime configuration is invalid.');
  }
  let snapshot = freezeSnapshot('NOT_STARTED');
  let startPromise = null;
  const checkedTime = () => {
    try {
      const value = now();
      return Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000
        ? new Date(value).toISOString() : null;
    } catch {
      return null;
    }
  };
  const probe = async (client, method) => {
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new DaiphucPartnerError('TIMEOUT')), requestTimeoutMs);
    });
    try {
      await Promise.race([Promise.resolve().then(() => client[method]()), deadline]);
      // The transport validates HTTP200 and a JSON object. Discard the entire
      // response rather than interpreting unknown fields as verified success.
      return { requestSucceeded: true, httpStatus: 200, error: null };
    } catch (error) {
      return safeFailure(error);
    } finally {
      clearTimeout(timer);
    }
  };

  function start({ guildId, envFile, apiKey } = {}) {
    if (startPromise) return startPromise;
    // Root .env is inherited by both child processes. Both exact guards are
    // necessary; possessing the key must never enable Store2 diagnostics.
    if (guildId !== STORE_ONE_GUILD_ID || envFile !== '.env') {
      snapshot = freezeSnapshot('DISABLED_OTHER_STORE');
      startPromise = Promise.resolve(snapshot);
      return startPromise;
    }
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      snapshot = freezeSnapshot('DISABLED_MISSING_KEY');
      startPromise = Promise.resolve(snapshot);
      return startPromise;
    }
    const startedAt = checkedTime();
    snapshot = freezeSnapshot('CHECKING', startedAt);
    startPromise = Promise.resolve().then(async () => {
      let client;
      try {
        client = clientFactory({ apiKey, timeoutMs: requestTimeoutMs });
      } catch (error) {
        const checks = Object.fromEntries(OPERATIONS.map(([name]) => [name, safeFailure(error)]));
        snapshot = freezeSnapshot('CHECK_FAILED', startedAt, checkedTime(), checks);
        return snapshot;
      }
      // Independent reads deliberately retain both /me and /products failures.
      // No order endpoint is consulted, and one rejection never triggers retry.
      const results = await Promise.all(OPERATIONS.map(([, method]) => probe(client, method)));
      const checks = Object.fromEntries(OPERATIONS.map(([name], index) => [name, results[index]]));
      const status = results.some(result => result.error === 'AUTHENTICATION_FAILED' || [401, 403].includes(result.httpStatus))
        ? 'AUTH_REJECTED'
        : results.every(result => result.requestSucceeded) ? 'HTTP_OK_SCHEMA_UNVERIFIED' : 'CHECK_FAILED';
      snapshot = freezeSnapshot(status, startedAt, checkedTime(), checks);
      return snapshot;
    });
    return startPromise;
  }

  return Object.freeze({ start, getHealth: () => snapshot });
}

export const supplierAutobuyRuntime = createSupplierAutobuyRuntime();

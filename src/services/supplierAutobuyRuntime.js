import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { createDaiphucPartnerClient, DaiphucPartnerError } from './daiphucPartnerClient.js';
import { createDopermindClient, DopermindError } from './dopermindClient.js';

const OPERATIONS = Object.freeze([
  ['health', 'getHealth'], ['account', 'getMe'], ['products', 'getProducts'],
]);
const DOPERMIND_OPERATIONS = Object.freeze([['account', 'getBalance'], ['products', 'getStock']]);
const ERROR_CODES = new Set([
  'INVALID_CONFIGURATION', 'NOT_CONFIGURED', 'INVALID_REQUEST', 'TIMEOUT',
  'NETWORK_ERROR', 'REDIRECT_REJECTED', 'AUTHENTICATION_FAILED', 'RATE_LIMITED',
  'REQUEST_REJECTED', 'UPSTREAM_ERROR', 'UNEXPECTED_STATUS', 'RESPONSE_TOO_LARGE', 'INVALID_RESPONSE',
  'PROVIDER_REJECTED', 'INVALID_SCHEMA',
]);

function emptyChecks(operations = OPERATIONS) {
  return Object.fromEntries(operations.map(([name]) => [name, {
    requestSucceeded: false, httpStatus: null, error: null,
  }]));
}

function freezeSnapshot(status, startedAt = null, checkedAt = null, checks = emptyChecks(), metadata = {}) {
  for (const result of Object.values(checks)) Object.freeze(result);
  return Object.freeze({
    status, readOnly: true, purchasesEnabled: false, schemaMapped: metadata.schemaMapped === true,
    provider: metadata.provider === 'dopermind' ? 'dopermind' : metadata.provider === 'unsupported' ? 'unsupported' : 'daiphuc',
    productCount: Number.isSafeInteger(metadata.productCount) && metadata.productCount >= 0 ? metadata.productCount : null,
    startedAt, checkedAt, checks: Object.freeze(checks),
  });
}

function safeFailure(error) {
  // Only our typed transport metadata is eligible. Never serialize a provider
  // payload, arbitrary message/code, cause, URL, credential or dictionary key.
  let code = 'REQUEST_FAILED';
  let httpStatus = null;
  try {
    if (error instanceof DaiphucPartnerError || error instanceof DopermindError) {
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
 * a purchase/delivery contract or authorize a sellable offer.
 */
export function createSupplierAutobuyRuntime({
  clientFactory = createDaiphucPartnerClient,
  dopermindClientFactory = createDopermindClient,
  now = Date.now,
  requestTimeoutMs = 10000,
} = {}) {
  if (typeof clientFactory !== 'function' || typeof dopermindClientFactory !== 'function' || typeof now !== 'function'
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
      const value = await Promise.race([Promise.resolve().then(() => client[method]()), deadline]);
      // The provider adapter owns envelope/schema validation. Retain the result
      // only long enough to derive aggregate counts; never serialize its fields.
      return { check: { requestSucceeded: true, httpStatus: 200, error: null }, value };
    } catch (error) {
      return { check: safeFailure(error) };
    } finally {
      clearTimeout(timer);
    }
  };

  function start({ guildId, envFile, apiKey, provider = 'daiphuc' } = {}) {
    if (startPromise) return startPromise;
    const supported = provider === 'daiphuc' || provider === 'dopermind';
    const operations = provider === 'dopermind' ? DOPERMIND_OPERATIONS : OPERATIONS;
    const metadata = { provider: supported ? provider : 'unsupported' };
    const makeSnapshot = (status, startedAt, checkedAt, checks) => freezeSnapshot(status, startedAt, checkedAt, checks ?? emptyChecks(operations), metadata);
    // Root .env is inherited by both child processes. Both exact guards are
    // necessary; possessing the key must never enable Store2 diagnostics.
    if (guildId !== STORE_ONE_GUILD_ID || envFile !== '.env') {
      snapshot = makeSnapshot('DISABLED_OTHER_STORE');
      startPromise = Promise.resolve(snapshot);
      return startPromise;
    }
    if (!supported) {
      snapshot = makeSnapshot('DISABLED_UNSUPPORTED_PROVIDER');
      startPromise = Promise.resolve(snapshot);
      return startPromise;
    }
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      snapshot = makeSnapshot('DISABLED_MISSING_KEY');
      startPromise = Promise.resolve(snapshot);
      return startPromise;
    }
    const startedAt = checkedTime();
    snapshot = makeSnapshot('CHECKING', startedAt);
    startPromise = Promise.resolve().then(async () => {
      let client;
      try {
        const factory = provider === 'dopermind' ? dopermindClientFactory : clientFactory;
        client = factory({ apiKey, timeoutMs: requestTimeoutMs });
      } catch (error) {
        const checks = Object.fromEntries(operations.map(([name]) => [name, safeFailure(error)]));
        snapshot = makeSnapshot('CHECK_FAILED', startedAt, checkedTime(), checks);
        return snapshot;
      }
      // Independent reads retain both account and catalog failures.
      // No order endpoint is consulted, and one rejection never triggers retry.
      const results = await Promise.all(operations.map(([, method]) => probe(client, method)));
      const checks = Object.fromEntries(operations.map(([name], index) => [name, results[index].check]));
      const succeeded = results.every(result => result.check.requestSucceeded);
      if (provider === 'dopermind' && succeeded) {
        // The provider-specific client validates both documented envelopes and
        // whitelists product fields. Only aggregate metadata leaves this scope.
        metadata.schemaMapped = true;
        metadata.productCount = Array.isArray(results[1].value) ? results[1].value.length : null;
      }
      const status = results.some(result => result.check.error === 'AUTHENTICATION_FAILED' || [401, 403].includes(result.check.httpStatus))
        ? 'AUTH_REJECTED'
        : succeeded ? provider === 'dopermind' ? 'CONNECTED' : 'HTTP_OK_SCHEMA_UNVERIFIED' : 'CHECK_FAILED';
      snapshot = makeSnapshot(status, startedAt, checkedTime(), checks);
      return snapshot;
    });
    return startPromise;
  }

  return Object.freeze({ start, getHealth: () => snapshot });
}

export const supplierAutobuyRuntime = createSupplierAutobuyRuntime();

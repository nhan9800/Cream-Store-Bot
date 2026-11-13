import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupplierAutobuyRuntime, createSupplierAutobuyRuntimeRegistry } from '../src/services/supplierAutobuyRuntime.js';
import { DaiphucPartnerError } from '../src/services/daiphucPartnerClient.js';
import { STORE_ONE_GUILD_ID } from '../src/utils/locale.js';

const NOW = Date.parse('2026-11-10T14:00:00Z');
const secret = 'synthetic-secret-credential';
const context = { guildId: STORE_ONE_GUILD_ID, envFile: '.env', apiKey: secret };
function setup(overrides = {}, options = {}) {
  const client = {
    getHealth: vi.fn().mockResolvedValue({ ok: true }),
    getMe: vi.fn().mockResolvedValue({ account: 'private-account' }),
    getProducts: vi.fn().mockResolvedValue({ products: [] }),
    createOrder: vi.fn(), listOrders: vi.fn(), getOrder: vi.fn(), getOrderLogs: vi.fn(),
    ...overrides,
  };
  const clientFactory = vi.fn(() => client);
  return { client, clientFactory, runtime: createSupplierAutobuyRuntime({ clientFactory, now: () => NOW, ...options }) };
}

afterEach(() => vi.useRealTimers());

describe('independent provider runtime registry', () => {
  it('binds startup to each entry and never borrows the other source readiness', async () => {
    const cdk = { getBalance: vi.fn(async () => ({ balanceVnd: 0 })), getStock: vi.fn(async () => [1, 2]), createOrder: vi.fn() };
    const doper = { getBalance: vi.fn(async () => { throw new Error('Synthetic provider outage'); }), getStock: vi.fn(async () => [1]), createOrder: vi.fn() };
    const cdkFactory = vi.fn(() => cdk), doperFactory = vi.fn(() => doper);
    const registry = createSupplierAutobuyRuntimeRegistry({ defaultProvider: () => 'cdkvietnam',
      runtimeFactory: () => createSupplierAutobuyRuntime({ cdkVietnamClientFactory: cdkFactory, dopermindClientFactory: doperFactory, now: () => NOW }) });
    expect(registry.forProvider('cdkvietnam').getHealth()).toMatchObject({ provider: 'cdkvietnam', status: 'NOT_STARTED' });
    await Promise.all([registry.forProvider('cdkvietnam').start({ ...context, provider: 'dopermind', envFile: '.env' }),
      registry.forProvider('dopermind').start({ ...context, envFile: '.env' })]);
    registry.forProvider('cdkvietnam').setSalesEnabled(true); registry.forProvider('dopermind').setSalesEnabled(true);
    expect(registry.getHealth()).toMatchObject({ provider: 'cdkvietnam', purchasesEnabled: true });
    expect(registry.getAllHealth()).toMatchObject({ cdkvietnam: { status: 'CONNECTED', productCount: 2, purchasesEnabled: true },
      dopermind: { status: 'CHECK_FAILED', purchasesEnabled: false } });
    expect(registry.forProvider('cdkvietnam')).toBe(registry.forProvider('cdkvietnam'));
    expect(cdkFactory).toHaveBeenCalledOnce(); expect(doperFactory).toHaveBeenCalledOnce();
    expect(cdk.createOrder).not.toHaveBeenCalled(); expect(doper.createOrder).not.toHaveBeenCalled();
  });
});

describe('supplier one-shot read-only runtime', () => {
  it('performs no work on construction or health reads', () => {
    const { clientFactory, runtime } = setup();
    expect(runtime.getHealth()).toMatchObject({ status: 'NOT_STARTED', readOnly: true, purchasesEnabled: false, schemaMapped: false });
    expect(runtime.getHealth()).toBe(runtime.getHealth());
    expect(clientFactory).not.toHaveBeenCalled();
    expect(Object.keys(runtime).sort()).toEqual(['getHealth', 'setSalesEnabled', 'start']);
  });

  it.each([
    { guildId: 'another-store' }, { envFile: '.env.store2' }, { envFile: undefined },
    { envFile: '/home/container/.env' }, { guildId: undefined },
  ])('does not construct a client for another store or ambiguous environment %j', async patch => {
    const { clientFactory, runtime } = setup();
    await expect(runtime.start({ ...context, ...patch })).resolves.toMatchObject({ status: 'DISABLED_OTHER_STORE', purchasesEnabled: false });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it.each([undefined, '', '   ', null])('stays disabled without a configured key', async apiKey => {
    const { clientFactory, runtime } = setup();
    await expect(runtime.start({ ...context, apiKey })).resolves.toMatchObject({ status: 'DISABLED_MISSING_KEY' });
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('reads exactly health/account/products once and never exposes purchase capability', async () => {
    const { client, clientFactory, runtime } = setup();
    const result = await runtime.start(context);
    expect(clientFactory).toHaveBeenCalledExactlyOnceWith({ apiKey: secret, timeoutMs: 10000 });
    for (const method of ['getHealth', 'getMe', 'getProducts']) expect(client[method]).toHaveBeenCalledExactlyOnceWith();
    for (const method of ['createOrder', 'listOrders', 'getOrder', 'getOrderLogs']) expect(client[method]).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'HTTP_OK_SCHEMA_UNVERIFIED', readOnly: true, purchasesEnabled: false,
      schemaMapped: false, startedAt: new Date(NOW).toISOString(), checkedAt: new Date(NOW).toISOString(),
      checks: { account: { requestSucceeded: true, httpStatus: 200, error: null } } });
    expect(result).not.toHaveProperty('authenticated');
  });

  it('coalesces concurrent/repeated starts and never rechecks via public health', async () => {
    let finish;
    const { client, runtime } = setup({ getMe: vi.fn(() => new Promise(resolve => { finish = resolve; })) });
    const first = runtime.start(context);
    expect(runtime.getHealth().status).toBe('CHECKING');
    expect(runtime.start(context)).toBe(first);
    await Promise.resolve();
    await Promise.resolve();
    finish({ secret });
    await first;
    expect(runtime.start({ ...context, apiKey: 'replacement' })).toBe(first);
    for (let index = 0; index < 20; index++) runtime.getHealth();
    for (const method of ['getHealth', 'getMe', 'getProducts']) expect(client[method]).toHaveBeenCalledTimes(1);
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('keeps a disabled process bound to its first start instead of later accepting inherited credentials', async () => {
    const { clientFactory, runtime } = setup();
    const first = runtime.start({ ...context, envFile: '.env.store2' });
    await first;
    expect(runtime.start(context)).toBe(first);
    expect(runtime.getHealth().status).toBe('DISABLED_OTHER_STORE');
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('reports both rejected auth reads independently without retries', async () => {
    const rejected = () => Promise.reject(new DaiphucPartnerError('AUTHENTICATION_FAILED', { status: 401 }));
    const { client, runtime } = setup({ getMe: vi.fn(rejected), getProducts: vi.fn(rejected) });
    const result = await runtime.start(context);
    expect(result).toMatchObject({ status: 'AUTH_REJECTED', checks: {
      health: { requestSucceeded: true, httpStatus: 200 },
      account: { requestSucceeded: false, httpStatus: 401, error: 'AUTHENTICATION_FAILED' },
      products: { requestSucceeded: false, httpStatus: 401, error: 'AUTHENTICATION_FAILED' },
    } });
    expect(client.getMe).toHaveBeenCalledTimes(1);
    expect(client.getProducts).toHaveBeenCalledTimes(1);
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('discards all provider fields, values, dynamic keys and business-success claims', async () => {
    const malicious = { [secret]: { api_key: secret, error: secret, balance: 1234567 },
      authenticated: true, schemaMapped: true, purchasesEnabled: true, success: false };
    const response = () => Promise.resolve(malicious);
    const { runtime } = setup({ getHealth: vi.fn(response), getMe: vi.fn(response), getProducts: vi.fn(response) });
    const result = await runtime.start(context);
    expect(result.status).toBe('HTTP_OK_SCHEMA_UNVERIFIED');
    expect(result.purchasesEnabled).toBe(false);
    expect(result.schemaMapped).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/synthetic-secret|api_key|1234567|authenticated/);
    expect(Object.keys(result.checks.account).sort()).toEqual(['error', 'httpStatus', 'requestSucceeded']);
  });

  it('sanitizes arbitrary exceptions and typed errors carrying hostile extra metadata', async () => {
    const error = new DaiphucPartnerError('INVALID_RESPONSE');
    error.code = secret;
    error.status = 'private-status';
    error.message = secret;
    error.cause = { secret };
    const { runtime } = setup({ getMe: vi.fn().mockRejectedValue(error), getProducts: vi.fn().mockRejectedValue({ message: secret, code: secret, status: 401 }) });
    const result = await runtime.start(context);
    expect(result.status).toBe('CHECK_FAILED');
    expect(result.checks.account).toEqual({ requestSucceeded: false, httpStatus: null, error: 'REQUEST_FAILED' });
    expect(result.checks.products).toEqual({ requestSucceeded: false, httpStatus: null, error: 'REQUEST_FAILED' });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('contains hostile error accessors without rejecting startup', async () => {
    const error = new DaiphucPartnerError('TIMEOUT');
    Object.defineProperty(error, 'code', { get() { throw new Error(secret); } });
    const { runtime } = setup({ getMe: vi.fn().mockRejectedValue(error) });
    expect(await runtime.start(context)).toMatchObject({ status: 'CHECK_FAILED', checks: { account: { error: 'REQUEST_FAILED' } } });
  });

  it('settles on a bounded timeout even if an injected client never resolves', async () => {
    vi.useFakeTimers();
    const { client, runtime } = setup({ getMe: vi.fn(() => new Promise(() => {})) }, { requestTimeoutMs: 25 });
    const promise = runtime.start(context);
    await vi.advanceTimersByTimeAsync(25);
    const result = await promise;
    expect(result).toMatchObject({ status: 'CHECK_FAILED', checks: { account: { error: 'TIMEOUT' }, products: { requestSucceeded: true } } });
    await vi.advanceTimersByTimeAsync(60000);
    expect(client.getMe).toHaveBeenCalledTimes(1);
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('contains factory configuration failures as sanitized inactive health', async () => {
    const runtime = createSupplierAutobuyRuntime({ clientFactory: () => { throw new Error(secret); }, now: () => NOW });
    const result = await runtime.start(context);
    expect(result.status).toBe('CHECK_FAILED');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.purchasesEnabled).toBe(false);
  });

  it('returns a deeply immutable snapshot', async () => {
    const { runtime } = setup();
    const result = await runtime.start(context);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.checks)).toBe(true);
    expect(Object.isFrozen(result.checks.account)).toBe(true);
    expect(() => { result.purchasesEnabled = true; }).toThrow(TypeError);
    expect(() => { result.checks.account.error = secret; }).toThrow(TypeError);
    expect(runtime.getHealth().purchasesEnabled).toBe(false);
  });
});

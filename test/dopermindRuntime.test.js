import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSupplierAutobuyRuntime } from '../src/services/supplierAutobuyRuntime.js';
import { DopermindError } from '../src/services/dopermindClient.js';
import { STORE_ONE_GUILD_ID } from '../src/utils/locale.js';

const context = { guildId: STORE_ONE_GUILD_ID, envFile: '.env', provider: 'dopermind', apiKey: 'synthetic-new-secret' };
const NOW = Date.parse('2026-11-10T16:00:00Z');
function setup(patch = {}, options = {}) {
  const client = { getBalance: vi.fn().mockResolvedValue({ balanceVnd: 1234567, currency: 'VND', updatedAt: 'private' }),
    getStock: vi.fn().mockResolvedValue([{ productKey: 'private-key', name: 'private-name', priceVnd: 99000 }]),
    createOrder: vi.fn(), getHealth: vi.fn(), getMe: vi.fn(), getProducts: vi.fn(), ...patch };
  const legacy = vi.fn();
  const factory = vi.fn(() => client);
  return { client, legacy, factory, runtime: createSupplierAutobuyRuntime({ clientFactory: legacy, dopermindClientFactory: factory, now: () => NOW, ...options }) };
}
afterEach(() => vi.useRealTimers());

describe('Dopermind provider migration runtime', () => {
  it('selects only the new client and reads the two documented endpoints exactly once', async () => {
    const { runtime, factory, legacy, client } = setup();
    const pending = runtime.start(context);
    expect(runtime.start(context)).toBe(pending);
    const health = await pending;
    expect(factory).toHaveBeenCalledExactlyOnceWith({ apiKey: context.apiKey, timeoutMs: 10000 });
    expect(legacy).not.toHaveBeenCalled();
    expect(client.getBalance).toHaveBeenCalledExactlyOnceWith();
    expect(client.getStock).toHaveBeenCalledExactlyOnceWith();
    for (const method of ['getHealth', 'getMe', 'getProducts', 'createOrder']) expect(client[method]).not.toHaveBeenCalled();
    expect(health).toMatchObject({ provider: 'dopermind', status: 'CONNECTED', productCount: 1, schemaMapped: true,
      readOnly: true, purchasesEnabled: false, checkedAt: new Date(NOW).toISOString() });
    expect(Object.keys(health.checks)).toEqual(['account', 'products']);
    expect(JSON.stringify(health)).not.toMatch(/synthetic-new-secret|1234567|99000|private/);
    expect(Object.isFrozen(health.checks.products)).toBe(true);
    for (let index = 0; index < 10; index++) runtime.getHealth();
    expect(client.getStock).toHaveBeenCalledTimes(1);
    expect(Object.keys(runtime).sort()).toEqual(['getHealth', 'start']);
  });

  it.each([{ envFile: '.env.store2' }, { guildId: 'other' }, { envFile: undefined }])('never leaks inherited credentials to Store2 %j', async patch => {
    const { runtime, factory, legacy } = setup();
    expect(await runtime.start({ ...context, ...patch })).toMatchObject({ status: 'DISABLED_OTHER_STORE', provider: 'dopermind', purchasesEnabled: false });
    expect(factory).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('fails closed for unknown providers without falling back to either credential', async () => {
    const { runtime, factory, legacy } = setup();
    expect(await runtime.start({ ...context, provider: 'https://malicious.invalid' })).toMatchObject({ status: 'DISABLED_UNSUPPORTED_PROVIDER', provider: 'unsupported' });
    expect(factory).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it('does not fall back to the previous supplier when the new key is missing', async () => {
    const { runtime, factory, legacy } = setup();
    expect(await runtime.start({ ...context, apiKey: undefined })).toMatchObject({ status: 'DISABLED_MISSING_KEY', provider: 'dopermind' });
    expect(factory).not.toHaveBeenCalled();
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each([401, 403])('reports authentication rejection without provider details or purchase retry (%i)', async status => {
    const { runtime, client } = setup({ getBalance: vi.fn().mockRejectedValue(new DopermindError('AUTHENTICATION_FAILED', { status })) });
    const result = await runtime.start(context);
    expect(result).toMatchObject({ status: 'AUTH_REJECTED', schemaMapped: false, productCount: null, checks: { account: { httpStatus: status } } });
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('does not call a partially failed schema connected', async () => {
    const { runtime } = setup({ getStock: vi.fn().mockRejectedValue(new DopermindError('INVALID_RESPONSE')) });
    expect(await runtime.start(context)).toMatchObject({ status: 'CHECK_FAILED', schemaMapped: false, productCount: null });
  });

  it('bounds a stalled new-provider call without blocking the process', async () => {
    vi.useFakeTimers();
    const { runtime } = setup({ getStock: vi.fn(() => new Promise(() => {})) }, { requestTimeoutMs: 25 });
    const pending = runtime.start(context);
    await vi.advanceTimersByTimeAsync(25);
    expect(await pending).toMatchObject({ status: 'CHECK_FAILED', checks: { products: { error: 'TIMEOUT' } } });
  });
});

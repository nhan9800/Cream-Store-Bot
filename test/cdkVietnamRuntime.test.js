import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSupplierAutobuyRuntime } from '../src/services/supplierAutobuyRuntime.js';
import { CdkVietnamError } from '../src/services/cdkVietnamClient.js';
import { STORE_ONE_GUILD_ID } from '../src/utils/locale.js';

const context = { guildId: STORE_ONE_GUILD_ID, envFile: '.env', provider: 'cdkvietnam', apiKey: 'synthetic-cdk-key' };
const NOW = Date.parse('2026-11-11T00:00:00Z');
function setup(patch = {}, options = {}) {
  const client = { getBalance: vi.fn().mockResolvedValue({ balanceVnd: 0, currency: 'VND', updatedAt: 'private' }),
    getStock: vi.fn().mockResolvedValue([{ productKey: 'cdkvietnam:6', name: 'private-name', priceVnd: 525000 }]),
    createOrder: vi.fn(), getOrder: vi.fn(), ...patch };
  const cdkFactory = vi.fn(() => client);
  return { client, cdkFactory, runtime: createSupplierAutobuyRuntime({
    clientFactory: vi.fn(), dopermindClientFactory: vi.fn(), cdkVietnamClientFactory: cdkFactory, now: () => NOW, ...options,
  }) };
}
afterEach(() => vi.useRealTimers());

describe('CDK Việt Nam provider runtime', () => {
  it('selects the CDK adapter, probes balance and products, and stays read-only until trusted sales setup', async () => {
    const { runtime, cdkFactory, client } = setup();
    const health = await runtime.start(context);
    expect(cdkFactory).toHaveBeenCalledExactlyOnceWith({ apiKey: context.apiKey, timeoutMs: 10000 });
    expect(client.getBalance).toHaveBeenCalledExactlyOnceWith();
    expect(client.getStock).toHaveBeenCalledExactlyOnceWith();
    expect(health).toMatchObject({ provider: 'cdkvietnam', status: 'CONNECTED', productCount: 1,
      schemaMapped: true, readOnly: true, purchasesEnabled: false });
    expect(JSON.stringify(health)).not.toContain('synthetic-cdk-key');
    expect(Object.keys(health.checks)).toEqual(['account', 'products']);
  });

  it('promotes only a connected CDK runtime and can pause it again', async () => {
    const { runtime, client } = setup();
    await runtime.start(context);
    expect(runtime.setSalesEnabled(true)).toMatchObject({ provider: 'cdkvietnam', status: 'CONNECTED', purchasesEnabled: true, readOnly: false });
    expect(runtime.setSalesEnabled(false)).toMatchObject({ purchasesEnabled: false, readOnly: true });
    expect(client.createOrder).not.toHaveBeenCalled();
  });

  it('fails closed on authentication rejection and never calls purchase', async () => {
    const { runtime, client } = setup({ getBalance: vi.fn().mockRejectedValue(new CdkVietnamError('AUTHENTICATION_FAILED', { status: 401 })) });
    await runtime.start(context);
    expect(runtime.getHealth()).toMatchObject({ provider: 'cdkvietnam', status: 'AUTH_REJECTED', purchasesEnabled: false, schemaMapped: false });
    expect(client.createOrder).not.toHaveBeenCalled();
  });
});


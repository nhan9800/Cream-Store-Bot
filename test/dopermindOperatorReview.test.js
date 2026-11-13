import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/supplierAutobuyCatalogService.js', () => ({ getSupplierCatalogReviewSnapshot: vi.fn() }));
import { runDopermindCatalogReview } from '../src/services/dopermindCatalogReview20261114.js';
const guildId = '1282637033340403754';
const fixture = () => ({ guildId, envFile: '.env', now: () => Date.parse('2026-11-13T18:00:00Z'), log: vi.fn(),
  readSnapshot: vi.fn(() => ({ status: 'READY', products: [
    { productKey: 'new-product', name: 'Clear product', nameEn: 'Product', type: 'ACCOUNT', stock: 3,
      reviewReason: 'NOT_REVIEWED', apiKey: 'secret-key', unitCostVnd: 123456, balanceVnd: 998877,
      receipt: 'private-goods' },
    { productKey: 'known-product', name: 'Existing offer', reviewReason: 'SELLABLE' },
  ] })) });
describe('temporary protected Dopermind review', () => {
  it('emits only excluded cached metadata once and never costs, credentials or receipts', () => {
    const options = fixture(), client = {};
    expect(runDopermindCatalogReview(client, options)).toEqual({ status: 'DONE', sourceCount: 2, excludedCount: 1 });
    expect(options.readSnapshot).toHaveBeenCalledExactlyOnceWith('dopermind');
    const logged = JSON.stringify(options.log.mock.calls);
    expect(logged).toContain('new-product'); expect(logged).not.toContain('known-product');
    expect(logged).not.toMatch(/secret-key|unitCost|123456|balanceVnd|998877|private-goods/);
    expect(runDopermindCatalogReview(client, options).status).toBe('SKIPPED');
    expect(options.log).toHaveBeenCalledTimes(3);
  });
  it.each([{ guildId: '1070676180103086132' }, { envFile: '.env.store2' },
    { now: () => Date.parse('2026-11-15T00:00:00Z') }, { now: () => NaN },
    { release: { enabled: true, authorizedUntil: 'invalid' } }])('never reads another store or expired release %j', patch => {
    const options = { ...fixture(), ...patch };
    expect(runDopermindCatalogReview({}, options).status).toBe('DISABLED');
    expect(options.readSnapshot).not.toHaveBeenCalled(); expect(options.log).not.toHaveBeenCalled();
  });
});

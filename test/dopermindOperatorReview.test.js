import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/services/supplierAutobuyCatalogService.js', () => ({ getSupplierCatalogReviewSnapshot: vi.fn() }));
import { DOPERMIND_REVIEW, runDopermindCatalogReview } from '../src/services/dopermindCatalogReview20261114.js';
const guildId = '1282637033340403754';
const fixture = () => ({ guildId, envFile: '.env', now: () => Date.parse('2026-11-13T18:00:00Z'), log: vi.fn(),
  release: { ...DOPERMIND_REVIEW, enabled: true },
  readSnapshot: vi.fn(() => ({ status: 'READY', products: [
    { productKey: 'new-product', name: 'Clear product', nameEn: 'Product', type: 'ACCOUNT', stock: 3,
      reviewReason: 'NOT_REVIEWED', apiKey: 'secret-key', unitCostVnd: 123456, balanceVnd: 998877,
      receipt: 'private-goods' },
    { productKey: 'known-product', name: 'Existing offer', reviewReason: 'SELLABLE' },
  ] })) });
describe('temporary protected Dopermind review', () => {
  it('keeps the completed operator projection disabled without reading the source snapshot', () => {
    const options = fixture(); delete options.release;
    expect(runDopermindCatalogReview({}, options)).toEqual({ status: 'DISABLED' });
    expect(options.readSnapshot).not.toHaveBeenCalled(); expect(options.log).not.toHaveBeenCalled();
  });
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
  it('limits the current review to new identities and leaves prior policy/price decisions out of the operator log', () => {
    const options = fixture();
    const snapshot = options.readSnapshot();
    snapshot.products.push({ productKey: 'held-policy', name: 'Prior held product', reviewReason: 'POLICY_EXCLUDED' },
      { productKey: 'held-price', name: 'Prior price guard', reviewReason: 'NO_PROFITABLE_PRICE' });
    options.readSnapshot.mockReturnValue(snapshot);
    expect(runDopermindCatalogReview({}, options)).toMatchObject({ status: 'DONE', sourceCount: 4, excludedCount: 1 });
    const logged = JSON.stringify(options.log.mock.calls);
    expect(logged).toContain('new-product'); expect(logged).not.toMatch(/held-policy|held-price|known-product/);
  });
  it('whitelists complete safe recommendation parameters without projecting arbitrary supplier financial fields', () => {
    const options = fixture(), snapshot = options.readSnapshot();
    Object.assign(snapshot.products[0], { recommendedMarkupVnd: 30000, recommendedReserveVnd: 5000,
      rawCost: 123456, suggestedSale: 166666, netProfitVnd: 23456 });
    options.readSnapshot.mockReturnValue(snapshot);
    runDopermindCatalogReview({}, options);
    const row = JSON.parse(options.log.mock.calls[1][1]);
    expect(row).toMatchObject({ recommendedMarkupVnd: 30000, recommendedReserveVnd: 5000 });
    expect(JSON.stringify(row)).not.toMatch(/rawCost|suggestedSale|netProfit|123456|166666|23456|secret-key|private-goods/);
  });
  it.each([{ recommendedMarkupVnd: '30000', recommendedReserveVnd: 5000 },
    { recommendedMarkupVnd: 30000, recommendedReserveVnd: -1 },
    { recommendedMarkupVnd: Infinity, recommendedReserveVnd: 5000 },
    { recommendedMarkupVnd: 30000, recommendedReserveVnd: Number.MAX_SAFE_INTEGER + 1 },
  ])('does not log incomplete or invalid pricing recommendations %j', recommendation => {
    const options = fixture(), snapshot = options.readSnapshot(); Object.assign(snapshot.products[0], recommendation);
    options.readSnapshot.mockReturnValue(snapshot); runDopermindCatalogReview({}, options);
    const row = JSON.parse(options.log.mock.calls[1][1]);
    expect(row).not.toHaveProperty('recommendedMarkupVnd'); expect(row).not.toHaveProperty('recommendedReserveVnd');
  });
  it('never attaches recommendation fields to an earlier held decision even in a legacy excluded-product projection', () => {
    const options = fixture(), snapshot = options.readSnapshot();
    snapshot.products.push({ productKey: 'held-policy', name: 'Prior held product', reviewReason: 'POLICY_EXCLUDED',
      recommendedMarkupVnd: 30000, recommendedReserveVnd: 5000 });
    options.release = { enabled: true, authorizedUntil: '2026-11-14T20:00:00Z', onlyUnreviewed: false };
    options.readSnapshot.mockReturnValue(snapshot); runDopermindCatalogReview({}, options);
    const row = options.log.mock.calls.map(([, value]) => JSON.parse(value)).find(value => value.productKey === 'held-policy');
    expect(row).toBeDefined(); expect(row).not.toHaveProperty('recommendedMarkupVnd'); expect(row).not.toHaveProperty('recommendedReserveVnd');
  });
});

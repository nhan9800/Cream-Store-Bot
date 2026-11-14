import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/db.js', () => ({ db: {} }));
vi.mock('../src/config.js', () => ({ config: {} }));
import { createSupplierAutobuyCatalog } from '../src/services/supplierAutobuyCatalogService.js';

const now = Date.parse('2026-11-15T01:00:00Z');
const databases = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
function fixture(cost, extra = {}) {
  const database = new Database(':memory:'); databases.push(database);
  const known = { productKey: 'desc_known', name: 'Reviewed synthetic month', priceVnd: 36000, stock: 5 };
  const unknown = { productKey: 'desc_unknown', name: 'Unreviewed synthetic month', priceVnd: cost, stock: 5, ...extra };
  const policy = { version: 'synthetic-unchanged-v1', referenceMaxAgeDays: 30,
    pricingDefaults: { feeReserveBps: 300, minProfitVnd: 20000, roundToVnd: 1000 },
    references: { benchmark: { kind: 'BENCHMARK', url: 'https://www.capcut.com/pricing', checkedAt: new Date(now).toISOString(), referenceCapVnd: 500000 } },
    products: [{ productKey: known.productKey, expectedName: known.name, enabled: true, markupVnd: 20000, reserveVnd: 3000,
      referenceId: 'benchmark', durationMonths: 1, termLabel: '1 month', warrantyLabel: 'Synthetic source warranty', accountForm: 'Synthetic account' }] };
  const getStock = vi.fn(async () => [known, unknown]);
  const service = createSupplierAutobuyCatalog({ policy, database, now: () => now, enabled: () => true,
    clientFactory: () => ({ getStock }) });
  return { service, getStock, policy, database };
}

describe('operator-only recommendations for new Dopermind identities', () => {
  it.each([
    [1, 20000, 3000], [50000, 20000, 3000], [50001, 30000, 5000], [150000, 30000, 5000],
    [150001, 50000, 10000], [300000, 50000, 10000], [300001, 100000, 15000], [600000, 100000, 15000],
    [600001, 150000, 25000], [1000000, 150000, 25000], [1000001, 250000, 50000],
    [2000000, 250000, 50000], [2000001, 250000, 51000], [4000001, 250000, 101000],
    [Number.MAX_SAFE_INTEGER, 250000, 225179981369000],
  ])('uses the documented source-cost tier for synthetic cost %s without releasing the source cost', async (cost, markup, reserve) => {
    const t = fixture(cost); await t.service.getOffers();
    const row = t.service.getReviewSnapshot().products.find(product => product.productKey === 'desc_unknown');
    expect(row).toMatchObject({ reviewReason: 'NOT_REVIEWED', recommendedMarkupVnd: markup, recommendedReserveVnd: reserve });
    expect(row).not.toHaveProperty('priceVnd'); expect(row).not.toHaveProperty('unitCostVnd');
    expect(row).not.toHaveProperty('basePriceVnd'); expect(row).not.toHaveProperty('netProfitVnd');
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '50000', true])('does not derive recommendations from invalid cost %s', async cost => {
    const t = fixture(cost); await t.service.getOffers();
    const row = t.service.getReviewSnapshot().products.find(product => product.productKey === 'desc_unknown');
    expect(row.reviewReason).toBe('NOT_REVIEWED'); expect(row).not.toHaveProperty('recommendedMarkupVnd');
    expect(row).not.toHaveProperty('recommendedReserveVnd');
  });

  it('keeps recommendations out of public offers, health and existing quote terms, without another source or DB read', async () => {
    const t = fixture(27777);
    const offers = await t.service.getOffers(), quote = await t.service.getQuote('desc_known');
    const before = JSON.stringify(quote), policyBefore = JSON.stringify(t.policy);
    const prepare = vi.spyOn(t.database, 'prepare'), exec = vi.spyOn(t.database, 'exec');
    const read = t.service.getReviewSnapshot();
    expect(prepare).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    prepare.mockRestore(); exec.mockRestore();
    expect(read.products.find(row => row.productKey === 'desc_known')).not.toHaveProperty('recommendedMarkupVnd');
    expect(read.products.find(row => row.productKey === 'desc_unknown')).toHaveProperty('recommendedMarkupVnd', 20000);
    expect(JSON.stringify([offers, t.service.getHealth()])).not.toMatch(/recommended|unitCost|27777|netProfit|reserveVnd/);
    expect(JSON.stringify(quote)).not.toMatch(/recommended/);
    expect(JSON.stringify(await t.service.getQuote('desc_known'))).toBe(before);
    expect(JSON.stringify(t.policy)).toBe(policyBefore); expect(t.getStock).toHaveBeenCalledOnce();
    await expect(t.service.getQuote('desc_unknown')).rejects.toMatchObject({ code: 'NOT_REVIEWED' });
    expect((await t.service.getOffers()).offers.map(row => row.productKey)).toEqual(['desc_known']);
  });

  it('does not recommend parameters for a locked source or an explicitly held policy', async () => {
    const t = fixture(36000, { locked: true }); await t.service.getOffers();
    expect(t.service.getReviewSnapshot().products.find(row => row.productKey === 'desc_unknown'))
      .toMatchObject({ reviewReason: 'SOURCE_LOCKED' });
    expect(t.service.getReviewSnapshot().products.every(row => row.recommendedMarkupVnd === undefined)).toBe(true);
    const held = fixture(36000);
    held.policy.products.push({ productKey: 'desc_unknown', expectedName: 'Unreviewed synthetic month', enabled: false, reason: 'OWNER_RETIRED_TEST' });
    // A separate catalog receives the explicit policy at construction time.
    const service = createSupplierAutobuyCatalog({ policy: held.policy, database: databases.at(-1), now: () => now,
      enabled: () => true, clientFactory: () => ({ getStock: held.getStock }) });
    await service.getOffers();
    const row = service.getReviewSnapshot().products.find(product => product.productKey === 'desc_unknown');
    expect(row.reviewReason).toBe('POLICY_EXCLUDED'); expect(row).not.toHaveProperty('recommendedMarkupVnd');
  });
});

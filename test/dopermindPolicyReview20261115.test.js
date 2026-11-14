import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/db.js', () => ({ db: {} }));
vi.mock('../src/config.js', () => ({ config: {} }));
import { createSupplierAutobuyCatalog, priceSupplierProduct } from '../src/services/supplierAutobuyCatalogService.js';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const policy = read('../src/data/supplierAutobuyPricingPolicy.json');
const previous = read('./fixtures/dopermind-approved-20261114.json');
const audit = read('./fixtures/dopermind-new-metadata-20261115.json');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const approved = [
  'desc_af41da59-622c-428d-8bf5-00e4e3e622ca', 'desc_e64dc5c4-8fce-45ae-8c14-dae666b6dacd',
  'desc_52c8a2ad-7b1b-4305-b8e2-02006933c77f', 'desc_ced04ccd-c32f-4f19-bd0e-0d851e9d815c',
  'desc_c281864c-9266-4a6d-908b-f9b2e70250b5', 'desc_b60308e8-9a29-4893-9d99-f32bbfc6f33a',
];
const held = ['desc_7fe12942-fe76-4b28-b4fa-0b09a3a09a1e', 'desc_ad25d2d3-40f2-48aa-ae25-086f2a029b8a',
  'desc_eeb81979-033c-41ef-a1b7-548a01d80f39'];
const entry = key => policy.products.find(row => row.productKey === key);
const nowMs = Math.max(...approved.map(key => Date.parse(policy.references[entry(key)?.referenceId]?.checkedAt))) + 60_000;
// Deliberately synthetic costs. Live source costs are not test fixtures.
const syntheticCost = row => ({ 20000: 10000, 30000: 100000, 50000: 200000,
  100000: 400000, 150000: 800000, 250000: 1100000 }[row.markupVnd]);
const source = (row, priceVnd = syntheticCost(row)) => ({ productKey: row.productKey, name: row.expectedName,
  priceVnd, stock: 3, unlimited: false, locked: false });

describe('nine new Dopermind identities reviewed on 2026-11-15', () => {
  it('pins every live identity independently and keeps the previous 103 policy decisions intact', () => {
    expect(audit.sourceCount).toBe(111); expect(audit.products).toHaveLength(9);
    expect(policy.products).toHaveLength(112);
    expect(new Set(policy.products.map(row => row.productKey)).size).toBe(112);
    expect(hash(policy.products.slice(0, 103))).toBe(previous.allProductsHash);
    const oldReferences = Object.fromEntries(Object.keys(previous.references).map(key => [key, policy.references[key]]));
    expect(hash(oldReferences)).toBe(previous.allReferencesHash);
    for (const field of ['version', 'checkedAt', 'fx', 'pricingDefaults', 'referenceMaxAgeDays', 'sourceReview']) {
      expect(policy[field]).toEqual(previous[field]);
    }
    expect(policy.reviewRevision).toBe('dopermind-2026-11-15-expansion-v3');
    expect(policy.sourceReviews.at(-1)).toMatchObject({ sourceCount: 111, newProductCount: 9,
      reviewedProductCount: 9, approvedProductCount: 6, heldProductCount: 3, previousSourceMissingCount: 1 });
    for (const row of audit.products) expect(entry(row.productKey).expectedName).toBe(row.name);
    expect(policy.products.filter(row => row.enabled)).toHaveLength(49);
  });

  it.each(approved)('retains minimum profit, rounding, exact identity and reference caps for %s', key => {
    const row = entry(key), product = source(row);
    expect(row).toMatchObject({ enabled: true, reason: null });
    const priced = priceSupplierProduct(product, row, policy, { nowMs });
    expect(priced).toMatchObject({ ok: true, referenceKind: 'BENCHMARK', minProfitVnd: 20000 });
    expect(priced.priceVnd % 1000).toBe(0);
    expect(priced.netProfitVnd).toBeGreaterThanOrEqual(20000);
    expect(priced.feeReserveVnd).toBe(Math.ceil(priced.priceVnd * 0.03));
    expect(priced.priceVnd).toBeLessThan(row.referenceCapVnd);
    expect(priceSupplierProduct({ ...product, priceVnd: row.referenceCapVnd }, row, policy, { nowMs }))
      .toMatchObject({ ok: false, reason: 'NO_PROFITABLE_PRICE' });
    expect(priceSupplierProduct(product, row, policy, { nowMs, override: { price_vnd: row.referenceCapVnd } }))
      .toMatchObject({ ok: false, reason: 'NO_PROFITABLE_PRICE' });
    expect(priceSupplierProduct(product, row, policy, { nowMs, override: { price_vnd: product.priceVnd } }))
      .toMatchObject({ ok: false, reason: 'NO_PROFITABLE_PRICE' });
    expect(priceSupplierProduct({ ...product, name: 'A different package' }, row, policy, { nowMs }))
      .toMatchObject({ ok: false, reason: 'SOURCE_CHANGED' });
    expect(priceSupplierProduct({ ...product, locked: true }, row, policy, { nowMs }))
      .toMatchObject({ ok: false, reason: 'SOURCE_LOCKED' });
    const reference = policy.references[row.referenceId];
    expect(priceSupplierProduct(product, row, policy, { nowMs: Date.parse(reference.checkedAt) + 30 * 86400000 }))
      .toMatchObject({ ok: false, reason: 'REFERENCE_STALE' });
  });

  it.each(held)('holds incomplete terms even at a low cost and high stock for %s', key => {
    const row = entry(key);
    expect(row.enabled).toBe(false); expect(row.reason).toBeTruthy();
    expect(priceSupplierProduct(source(row, 1), row, policy, { nowMs }).ok).toBe(false);
  });

  it.each([false, true])('preserves all 43 previous quotes and fingerprints including existing overrides: %s', async override => {
    const oldDb = new Database(':memory:'), newDb = new Database(':memory:');
    const products = previous.products.map(row => source(row, 1000));
    const common = { enabled: () => true, now: () => nowMs, clientFactory: () => ({ getStock: async () => products }) };
    const oldCatalog = createSupplierAutobuyCatalog({ ...common, policy: previous, database: oldDb });
    const newCatalog = createSupplierAutobuyCatalog({ ...common, policy, database: newDb });
    try {
      await oldCatalog.getOffers(); await newCatalog.getOffers();
      for (const row of previous.products) {
        if (override) {
          const quote = await oldCatalog.getQuote(row.productKey);
          for (const database of [oldDb, newDb]) database.prepare(`INSERT INTO supplier_autobuy_price_overrides
            (product_key,price_vnd,revision,actor_id,updated_at) VALUES(?,?,?,?,?)`).run(row.productKey,
            quote.unitPriceVnd + 1000, 'synthetic-owner-override', '1138315103821889566', new Date(nowMs).toISOString());
        }
        expect(await newCatalog.getQuote(row.productKey, 2)).toEqual(await oldCatalog.getQuote(row.productKey, 2));
      }
    } finally { oldDb.close(); newDb.close(); }
  });

  it('publishes six reviewed offers while holding incomplete rows and refusing an out-of-stock quote', async () => {
    const database = new Database(':memory:');
    const products = audit.products.map(live => source(entry(live.productKey), syntheticCost(entry(live.productKey)) || 1000));
    products.find(row => row.productKey === approved[0]).stock = 0;
    const service = createSupplierAutobuyCatalog({ policy, database, enabled: () => true, now: () => nowMs,
      clientFactory: () => ({ getStock: async () => products }) });
    try {
      const result = await service.getOffers();
      expect(result.offers).toHaveLength(6); expect(result.unreviewedCount).toBe(0);
      expect(result.offers.filter(row => row.available)).toHaveLength(5);
      await expect(service.getQuote(approved[0])).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
      for (const key of held) await expect(service.getQuote(key)).rejects.toBeTruthy();
      expect(JSON.stringify(result.offers)).not.toMatch(/unitCost|markupVnd|reserveVnd|netProfit|recommendedMarkup/);
    } finally { database.close(); }
  });

  it('keeps month terms, warranty limits and benchmark comparisons distinct', () => {
    const [go, twoDay, sevenDay, noWarranty, pro500, plus] = approved.map(entry);
    expect(go).toMatchObject({ durationMonths: 3, referenceCapVnd: 618960 });
    expect(go.warrantyLabel).toMatch(/24\s*giờ/);
    expect(twoDay).toMatchObject({ durationMonths: 1 }); expect(twoDay.warrantyLabel).toMatch(/2\s*ngày/);
    expect(sevenDay.warrantyLabel).toMatch(/7\s*ngày/); expect(noWarranty.warrantyLabel).toMatch(/không bảo hành/i);
    expect(pro500).toMatchObject({ durationMonths: 1, referenceCapVnd: 12895000 });
    expect(plus).toMatchObject({ durationMonths: 1, referenceCapVnd: 206320 });
    expect(plus.warrantyLabel).toMatch(/chưa công bố/i);
    expect(go.comparisonDisclosure).toMatch(/3.*tháng|ba.*tháng/);
    expect(plus.comparisonDisclosure).toMatch(/Grok/);
  });
});

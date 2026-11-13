import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/db.js', () => ({ db: {} }));
vi.mock('../src/config.js', () => ({ config: {} }));
import { createSupplierAutobuyCatalog, priceSupplierProduct } from '../src/services/supplierAutobuyCatalogService.js';

const policy = JSON.parse(readFileSync(new URL('../src/data/supplierAutobuyPricingPolicy.json', import.meta.url), 'utf8'));
// Frozen approved baseline from the pre-expansion manifest. Do not generate it
// from the current policy: pending orders can outlive a quote's display TTL.
const previous = JSON.parse(readFileSync(new URL('./fixtures/dopermind-approved-20261110.json', import.meta.url), 'utf8'));
const audit = JSON.parse(readFileSync(new URL('./fixtures/dopermind-excluded-metadata-20261114.json', import.meta.url), 'utf8'));
const document = readFileSync(new URL('../docs/supplier-autobuy-expansion-20261114.md', import.meta.url), 'utf8');
const nowMs = Date.parse(policy.checkedAt) + 60_000;
const added = [
  ['desc_68ae0ca6-596d-4dc7-9c9c-6e32b983a60c', 30000, 5000],
  ['desc_7c96ab6a-184b-4ea6-b9b1-821a253e8b13', 150000, 25000],
  ['desc_a2c215b0-1b30-455a-91f7-b7f9f6027f27', 150000, 25000],
  ['desc_4154d58a-5a6c-4212-871c-cefc80cd3e9d', 150000, 25000],
  ['desc_e83df1d3-c1ad-4208-84a3-50de267d9372', 250000, 50000],
  ['desc_81154520-794e-4b0d-8844-63cc18cead5a', 250000, 50000],
  ['desc_d85f4ecb-e00f-4718-99bd-2eb18606902a', 30000, 5000],
  ['desc_a6081eef-4730-4e2d-8705-e0f1ce5adba4', 30000, 5000],
  ['desc_f8903574-9797-4a84-842b-24937f7e717a', 20000, 3000],
  ['desc_9476530e-e339-4025-9eba-56a94934635d', 20000, 3000],
  ['desc_d7feeccc-3ec3-4ba1-b1fd-3618205a82ba', 50000, 10000],
  ['desc_27578cf9-c3fe-4873-8877-6e1bd49d7b37', 30000, 5000],
];
const entry = key => policy.products.find(row => row.productKey === key);
const source = (row, priceVnd = 10000) => ({ productKey: row.productKey, name: row.expectedName, priceVnd, stock: 5, locked: false });

describe('Dopermind excluded-product review on 2026-11-14', () => {
  it('keeps an explicit decision for all 103 source identities and documents all seventy exclusions plus two new rows', () => {
    expect(policy.products).toHaveLength(103);
    expect(new Set(policy.products.map(row => row.productKey)).size).toBe(103);
    expect(policy.products.filter(row => row.enabled)).toHaveLength(43);
    const reviewed = policy.products.filter(row => !row.enabled || added.some(([key]) => row.productKey === key));
    expect(reviewed).toHaveLength(72);
    for (const row of reviewed) expect(document).toContain(row.productKey);
    expect(audit.products).toHaveLength(72);
    expect(policy.sourceReview).toMatchObject({ revision: audit.revision, sourceCount: 103,
      previouslyExcludedCount: 70, newProductCount: 2, reviewedProductCount: 72 });
    for (const live of audit.products) expect(entry(live.productKey).expectedName).toBe(live.name);
  });

  it('preserves all four explicit owner retirements and does not open token pools from guessed model entitlements', () => {
    const retired = policy.products.filter(row => row.reason?.startsWith('OWNER_RETIRED_'));
    expect(retired).toHaveLength(4); expect(retired.every(row => row.enabled === false)).toBe(true);
    const opaque = policy.products.filter(row => row.reason === 'OPAQUE_TOKEN_PLAN');
    expect(opaque).toHaveLength(33); expect(opaque.every(row => row.enabled === false)).toBe(true);
    for (const key of ['desc_391434d2-69c1-479d-8170-a60352dc33be', 'desc_a6d82ced-7a73-4c01-abc2-f4b17f104174']) {
      expect(entry(key).enabled).toBe(false);
    }
  });

  it.each([false, true])('keeps all 31 prior quote prices, terms and fingerprints identical (existing override: %s)', async withOverride => {
    const oldDatabase = new Database(':memory:'), newDatabase = new Database(':memory:');
    const products = previous.products.map(row => source(row, 1000));
    const settings = { now: () => nowMs, enabled: () => true, clientFactory: () => ({ getStock: async () => products }) };
    const oldCatalog = createSupplierAutobuyCatalog({ ...settings, policy: previous, database: oldDatabase });
    const newCatalog = createSupplierAutobuyCatalog({ ...settings, policy, database: newDatabase });
    try {
      expect(previous.products).toHaveLength(31);
      expect(policy.version).toBe(previous.version);
      expect(policy.reviewRevision).toBe('dopermind-2026-11-14-expansion-v2');
      await oldCatalog.getOffers(); await newCatalog.getOffers();
      for (const oldRow of previous.products) {
        expect(entry(oldRow.productKey)).toEqual(oldRow);
        expect(policy.references[oldRow.referenceId]).toEqual(previous.references[oldRow.referenceId]);
        if (withOverride) {
          const automatic = await oldCatalog.getQuote(oldRow.productKey);
          for (const database of [oldDatabase, newDatabase]) database.prepare(`INSERT INTO supplier_autobuy_price_overrides
            (product_key,price_vnd,revision,actor_id,updated_at) VALUES(?,?,?,?,?)`).run(oldRow.productKey,
            automatic.unitPriceVnd + 1000, 'existing-owner-override', '1138315103821889566', new Date(nowMs).toISOString());
        }
        const oldQuote = await oldCatalog.getQuote(oldRow.productKey, 2);
        const newQuote = await newCatalog.getQuote(oldRow.productKey, 2);
        expect(newQuote).toEqual(oldQuote);
      }
    } finally { oldDatabase.close(); newDatabase.close(); }
  });

  it.each(added)('preserves markup, reserves and the live profit/reference guards for %s', (key, markupVnd, reserveVnd) => {
    const row = entry(key);
    expect(row).toMatchObject({ enabled: true, reason: null, markupVnd, reserveVnd });
    const quote = priceSupplierProduct(source(row), row, policy, { nowMs });
    expect(quote).toMatchObject({ ok: true, referenceKind: 'BENCHMARK', minProfitVnd: 20000 });
    expect(quote.netProfitVnd).toBeGreaterThanOrEqual(20000);
    expect(quote.feeReserveVnd).toBe(Math.ceil(quote.priceVnd * 0.03));
    expect(quote.priceVnd % 1000).toBe(0);
    expect(quote.priceVnd).toBeLessThan(row.referenceCapVnd);
    expect(priceSupplierProduct(source(row, row.referenceCapVnd), row, policy, { nowMs })).toMatchObject({ ok: false, reason: 'NO_PROFITABLE_PRICE' });
    expect(priceSupplierProduct(source(row), row, policy, { nowMs, override: { price_vnd: row.referenceCapVnd, revision: 'fixture' } }))
      .toMatchObject({ ok: false, reason: 'NO_PROFITABLE_PRICE' });
    expect(priceSupplierProduct({ ...source(row), name: 'Different source package' }, row, policy, { nowMs }))
      .toMatchObject({ ok: false, reason: 'SOURCE_CHANGED' });
  });

  it('keeps the configured fee reserve, net profit floor, rounding step and dated exchange rate unchanged', () => {
    expect(policy.pricingDefaults).toEqual({ feeReserveBps: 300, minProfitVnd: 20000, roundToVnd: 1000 });
    expect(policy.fx).toMatchObject({ vndPerUsd: 25790, rateDateLocal: '2026-11-10 23:11:09 Asia/Ho_Chi_Minh' });
    expect(policy.referenceMaxAgeDays).toBe(30);
    for (const [key] of added) {
      expect(priceSupplierProduct(source(entry(key)), entry(key), policy, { nowMs: Date.parse(policy.checkedAt) + 30 * 86400000 }))
        .toMatchObject({ ok: false, reason: 'REFERENCE_STALE' });
    }
  });

  it('uses proportional short-period shop caps without claiming official daily plans or full subscription warranties', () => {
    expect(policy.references.x_premium_7days_shop_comparison.referenceCapVnd).toBe(180530);
    expect(policy.references.x_premium_14days_shop_comparison.referenceCapVnd).toBe(361060);
    expect(policy.references.norton_ultimate_7days_shop_comparison.referenceCapVnd).toBe(64293);
    const seven = entry('desc_a6081eef-4730-4e2d-8705-e0f1ce5adba4');
    const fourteen = entry('desc_d85f4ecb-e00f-4718-99bd-2eb18606902a');
    expect(priceSupplierProduct(source(seven), seven, policy, { nowMs })).toMatchObject({ durationDays: 7, durationMonths: 0 });
    expect(priceSupplierProduct(source(fourteen), fourteen, policy, { nowMs })).toMatchObject({ durationDays: 14, durationMonths: 0 });
    expect(fourteen.warrantyLabel).toContain('24 giờ');
    for (const row of [seven, fourteen]) expect(row.comparisonDisclosure).toContain('không phải');
    expect(entry('desc_7c96ab6a-184b-4ea6-b9b1-821a253e8b13')).toMatchObject({ durationMonths: 12, warrantyLabel: 'Bảo hành 1 tháng theo công bố nguồn.' });
  });

  it('keeps multi-month sums explicit and prevents the reference from becoming an official source SKU', () => {
    expect(policy.references.x_premium_three_month_shop_comparison.referenceCapVnd).toBe(2321100);
    expect(policy.references.primevideo_sixmonths_shop_comparison.referenceCapVnd).toBe(1391112);
    const prime = entry('desc_9476530e-e339-4025-9eba-56a94934635d');
    expect(prime).toMatchObject({ durationMonths: 6 });
    expect(prime.comparisonDisclosure).toContain('không phải giá gói 6 tháng chính thức');
    expect(prime.comparisonDisclosure).toContain('không quảng cáo');
    expect(prime.comparisonDisclosure).toContain('vùng cụ thể');
    for (const reference of Object.values(policy.references).filter(ref => ref.calculation?.includes('shop comparison'))) {
      expect(reference.kind).toBe('BENCHMARK'); expect(reference.calculation).toContain('not an official');
    }
  });

  it('maps the two new one-month Codex labels to ordinary Plus without inventing a separate paid plan or warranty', () => {
    const first = entry('desc_d7feeccc-3ec3-4ba1-b1fd-3618205a82ba');
    const second = entry('desc_27578cf9-c3fe-4873-8877-6e1bd49d7b37');
    expect(first).toMatchObject({ expectedName: 'ChatGPT Plus Codex 1T (BHF)', durationMonths: 1,
      warrantyLabel: 'Bảo hành đủ thời hạn gói theo công bố nguồn.', referenceId: 'chatgpt_plus_month', referenceCapVnd: 515800 });
    expect(second).toMatchObject({ expectedName: 'ChatGPT Plus GGPay Codex 1T', durationMonths: 1,
      warrantyLabel: 'Nguồn chưa công bố bảo hành; không cam kết BHF.', referenceId: 'chatgpt_plus_month', referenceCapVnd: 515800 });
    expect(second.accountForm).toContain('GGPay');
    for (const row of [first, second]) {
      const live = audit.products.find(product => product.productKey === row.productKey);
      expect(live.type).toBe('product'); expect(live.nameEn).toMatch(/Codex 1M/);
      expect(row.reviewEvidenceUrl).toBe('https://learn.chatgpt.com/docs/pricing');
      expect(row.comparisonDisclosure).toContain('20 USD/tháng đã gồm Codex');
      expect(row.comparisonDisclosure).toContain('không tạo một gói trả phí riêng');
      expect(row.comparisonDisclosure).toContain('không cam kết quota/model cố định');
    }
  });

  it('updates changed opaque-token labels from the audit while retaining their closed status', () => {
    const changed = ['desc_596db8ad-76ab-4456-b90e-db25f7d41a2f', 'desc_306ad185-c078-4275-abcf-9e6263b97fa6',
      'desc_732c3336-332b-42a6-8b1e-950d0abefedf', 'desc_96fc8c79-dbc9-44b9-aa8e-30927717bea6', 'desc_4eee68c0-8fcb-4a34-b235-d0e24b2a125b'];
    for (const key of changed) expect(entry(key)).toMatchObject({ enabled: false, reason: 'OPAQUE_TOKEN_PLAN',
      expectedName: audit.products.find(row => row.productKey === key).name });
    expect(entry(changed[0])).toMatchObject({ durationDays: 4, termLabel: '4 ngày' });
  });
});

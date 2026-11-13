import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/database/db.js', () => ({ db: {} }));
vi.mock('../src/config.js', () => ({ config: {} }));
import { priceSupplierProduct } from '../src/services/supplierAutobuyCatalogService.js';

const policy = JSON.parse(readFileSync(new URL('../src/data/cdkVietnamAutobuyPricingPolicy.json', import.meta.url), 'utf8'));
const nowMs = Date.parse(policy.checkedAt) + 60_000;
const entry = id => policy.products.find(product => product.productKey === `cdkvietnam:${id}`);
const source = (id, cost) => ({ productKey: entry(id).productKey, name: entry(id).expectedName,
  priceVnd: cost, delivery: entry(id).deliveryMode, stock: 5, locked: false });

describe('CDK source and owner terms review on 2026-11-14', () => {
  it('records a deliberate decision for all twelve live source identities', () => {
    expect(policy.products).toHaveLength(12);
    expect(policy.products.filter(product => product.enabled)).toHaveLength(12);
    expect(new Set(policy.products.map(product => product.productKey)).size).toBe(12);
  });
  it('uses the explicit supplier annual duration without inventing an official annual plan or full-year warranty', () => {
    const product = entry(12);
    const priced = priceSupplierProduct(source(12, 1_000_000), product, policy, { nowMs });
    expect(priced).toMatchObject({ ok: true, durationMonths: 12, referenceKind: 'BENCHMARK' });
    expect(product.deliveryMode).toBe('manual');
    expect(product.warrantyLabel).toContain('BHF theo nhãn nguồn');
    expect(product.warrantyLabel).toContain('không tự suy ra');
    expect(product.comparisonDisclosure).toContain('không phải gói năm chính thức');
    expect(policy.references[product.referenceId].calculation).toContain('12 payments x USD20 monthly');
    expect(priced.netProfitVnd).toBeGreaterThanOrEqual(policy.pricingDefaults.minProfitVnd);
  });
  it('discloses the Grok identity difference and preserves the existing profit guard', () => {
    const product = entry(18);
    expect(product.comparisonDisclosure).toContain('chưa xác nhận cùng gói X Subscription/SuperGrok');
    const priced = priceSupplierProduct(source(18, 400000), product, policy, { nowMs });
    expect(priced).toMatchObject({ ok: true, durationMonths: 1 });
    expect(priced.netProfitVnd).toBeGreaterThanOrEqual(20000);
    expect(priceSupplierProduct(source(18, 900000), product, policy, { nowMs }).reason).toBe('NO_PROFITABLE_PRICE');
  });
  it.each([5, 14, 15, 16])('records owner-confirmed one-month terms for CDK %s without changing the profit floor', id => {
    expect(entry(id)).toMatchObject({ enabled: true, durationMonths: 1, termLabel: '1 tháng', reason: null });
    expect(entry(id).ownerTermsConfirmation).toContain('thời hạn 1 tháng');
    const price = priceSupplierProduct(source(id, 100000), entry(id), policy, { nowMs });
    expect(price).toMatchObject({ ok: true, durationMonths: 1 });
    expect(price.netProfitVnd).toBeGreaterThanOrEqual(20000);
    expect(priceSupplierProduct(source(id, entry(id).referenceCapVnd), entry(id), policy, { nowMs }).reason).toBe('NO_PROFITABLE_PRICE');
  });
  it('keeps KBH explicit and does not mistake Ultra20x quota for a duration', () => {
    expect(entry(16).warrantyLabel).toContain('KBH (không bảo hành)');
    expect(entry(15)).toMatchObject({ enabled: true, deliveryMode: 'manual', durationMonths: 1 });
    expect(entry(15).accountForm).toContain('tài khoản chính chủ của khách');
    expect(entry(15).comparisonDisclosure).toContain('20x là cấp quota');
  });
});

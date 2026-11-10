import { describe, expect, it } from 'vitest';
import { createSupplierPriceQuote, assertSupplierPriceQuoteCurrent } from '../src/services/supplierPricingService.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const AT = new Date(NOW).toISOString();
const options = { nowMs: NOW };
const offer = { plan: 'Example Pro', region: 'VN', duration: 'P1M', accountForm: 'OWN_ACCOUNT', benefits: 'FULL' };
function input(patch = {}) {
  return {
    productId: 'synthetic-example', quantity: 1,
    supplier: { currency: 'VND', unitCostVnd: 100000, checkedAt: AT },
    offer,
    officialReference: {
      currency: 'VND', unitPriceVnd: 200000, sourceUrl: 'https://official.example/prices',
      checkedAt: AT, verified: true, comparable: true, kind: 'OFFICIAL', offer,
    },
    fees: { fixedPerOrderVnd: 1000, rateBps: 100, reservePerUnitVnd: 2000 },
    desiredMarkupVnd: 50000, minProfitPerUnitVnd: 20000,
    ...patch,
  };
}

describe('supplier quote profitability and retail comparison', () => {
  it('quotes exact VND with net profit after fixed/percentage fees and warranty reserve', () => {
    const source = input({ quantity: 2 });
    const before = structuredClone(source);
    const quote = createSupplierPriceQuote(source, options);
    expect(quote).toMatchObject({ ok: true, unitPriceVnd: 150000, totalPriceVnd: 300000, totalCostVnd: 200000,
      totalFeesVnd: 4000, totalReserveVnd: 4000, netProfitVnd: 92000, markupVnd: 50000 });
    expect(source).toEqual(before);
  });

  it('reduces to an allowed tier strictly below official retail instead of matching it', () => {
    const source = input();
    source.officialReference.unitPriceVnd = 150000;
    expect(createSupplierPriceQuote(source, options)).toMatchObject({ ok: true, unitPriceVnd: 140000, markupVnd: 40000 });
  });

  it('does not lower to an unapproved uplift or below minimum NET profit', () => {
    const source = input();
    source.officialReference.unitPriceVnd = 130000;
    expect(createSupplierPriceQuote(source, options)).toEqual({ ok: false, reason: 'NO_PROFITABLE_BELOW_RETAIL_PRICE' });
  });

  it('does not treat gross markup as profit when fees consume it', () => {
    const source = input({ fees: { fixedPerOrderVnd: 15000, rateBps: 1000, reservePerUnitVnd: 10000 } });
    expect(createSupplierPriceQuote(source, options)).toEqual({ ok: false, reason: 'NO_PROFITABLE_BELOW_RETAIL_PRICE' });
  });

  it('rounds percentage fees UP, never understating costs by fractions of a dong', () => {
    const source = input({ fees: { fixedPerOrderVnd: 0, rateBps: 1, reservePerUnitVnd: 0 } });
    source.supplier.unitCostVnd = 100001;
    expect(createSupplierPriceQuote(source, options)).toMatchObject({ ok: true, totalFeesVnd: 16, netProfitVnd: 49984 });
  });

  it.each([undefined, {}, { fixedPerOrderVnd: 0, rateBps: 0 }])('requires explicit known fees instead of defaulting unknown costs to zero', fees => {
    expect(createSupplierPriceQuote(input({ fees }), options).reason).toBe('INVALID_FEES');
  });

  it.each(['USD', undefined, 'vnd'])('does not guess exchange rates or accept unspecified currency %s', currency => {
    const source = input();
    source.supplier.currency = currency;
    expect(createSupplierPriceQuote(source, options).reason).toBe('UNSUPPORTED_CURRENCY');
  });

  it.each([0, -1, 1.5, '100000', NaN, Infinity])('rejects malformed or absent supplier cost %s', cost => {
    const source = input();
    source.supplier.unitCostVnd = cost;
    expect(createSupplierPriceQuote(source, options).reason).toBe('INVALID_AMOUNT');
  });

  it.each([0, 101, 1.1, '2'])('rejects unsupported purchase quantity %s', quantity => {
    expect(createSupplierPriceQuote(input({ quantity }), options).reason).toBe('INVALID_QUANTITY');
  });

  it('rejects unsafe totals even when each raw input is a safe integer', () => {
    const source = input({ quantity: 100 });
    source.supplier.unitCostVnd = Number.MAX_SAFE_INTEGER - 100000;
    source.officialReference.unitPriceVnd = Number.MAX_SAFE_INTEGER;
    expect(createSupplierPriceQuote(source, options).reason).toBe('AMOUNT_OVERFLOW');
  });

  it.each([19000, 60000, 260000, undefined])('rejects an undefined/unapproved markup policy %s', desiredMarkupVnd => {
    expect(createSupplierPriceQuote(input({ desiredMarkupVnd }), options).reason).toBe('INVALID_MARGIN_POLICY');
  });
});

describe('supplier quote trusted reference and freshness', () => {
  it.each([
    { verified: false }, { comparable: false }, { kind: 'RESELLER' },
    { sourceUrl: 'http://official.example/prices' }, { sourceUrl: 'https://user:secret@official.example' },
  ])('does not claim cheaper than official without verified comparable evidence %j', patch => {
    const source = input();
    Object.assign(source.officialReference, patch);
    expect(createSupplierPriceQuote(source, options).reason).toBe('REFERENCE_UNVERIFIED');
  });

  it.each(['plan', 'region', 'duration', 'accountForm', 'benefits'])('rejects mismatched %s even if comparable is asserted', field => {
    const source = input();
    source.officialReference.offer = { ...offer, [field]: 'DIFFERENT' };
    expect(createSupplierPriceQuote(source, options).reason).toBe('OFFER_NOT_COMPARABLE');
  });

  it.each(['', 'unknown', 'n/a', 'chưa rõ'])('rejects unknown equivalence dimensions %s', region => {
    const source = input({ offer: { ...offer, region } });
    source.officialReference.offer = { ...offer, region };
    expect(createSupplierPriceQuote(source, options).reason).toBe('OFFER_NOT_COMPARABLE');
  });

  it('bounds quote validity by the oldest remaining source freshness', () => {
    const source = input();
    source.supplier.checkedAt = new Date(NOW - 50000).toISOString();
    expect(createSupplierPriceQuote(source, options).expiresAt).toBe(new Date(NOW + 10000).toISOString());
  });

  it.each([-60000, 1])('refuses stale or future supplier price snapshots (%s ms)', offset => {
    const source = input();
    source.supplier.checkedAt = new Date(NOW + offset).toISOString();
    expect(createSupplierPriceQuote(source, options).reason).toBe('SUPPLIER_PRICE_STALE');
  });

  it.each([-86400000, 1])('refuses stale or future official references (%s ms)', offset => {
    const source = input();
    source.officialReference.checkedAt = new Date(NOW + offset).toISOString();
    expect(createSupplierPriceQuote(source, options).reason).toBe('REFERENCE_STALE');
  });

  it('refuses ambiguous timezone-less dates', () => {
    const source = input();
    source.supplier.checkedAt = '2026-11-10T12:00:00';
    expect(createSupplierPriceQuote(source, options).reason).toBe('SUPPLIER_PRICE_STALE');
  });
});

describe('supplier quote confirmation', () => {
  it('accepts fresh, independently refreshed sources with identical economics', () => {
    const previous = createSupplierPriceQuote(input(), options);
    const source = input();
    source.supplier.checkedAt = new Date(NOW + 1000).toISOString();
    const current = createSupplierPriceQuote(source, { nowMs: NOW + 1000 });
    expect(assertSupplierPriceQuoteCurrent(previous, current, NOW + 1000)).toBe(current);
  });

  it.each([
    source => { source.supplier.unitCostVnd += 1000; },
    source => { source.quantity = 2; },
    source => { source.productId = 'different-product'; },
    source => { source.fees.fixedPerOrderVnd += 1000; },
    source => { source.officialReference.unitPriceVnd += 1000; },
  ])('requires a new customer confirmation if price, product, quantity or costs change', change => {
    const previous = createSupplierPriceQuote(input(), options);
    const source = input();
    change(source);
    const current = createSupplierPriceQuote(source, options);
    expect(() => assertSupplierPriceQuoteCurrent(previous, current, NOW)).toThrow(expect.objectContaining({ code: 'SUPPLIER_QUOTE_CHANGED' }));
  });

  it('rejects expired persisted quotes even if fresh terms still match', () => {
    const previous = createSupplierPriceQuote(input(), options);
    const source = input();
    source.supplier.checkedAt = new Date(NOW + 60000).toISOString();
    const current = createSupplierPriceQuote(source, { nowMs: NOW + 60000 });
    expect(() => assertSupplierPriceQuoteCurrent(previous, current, NOW + 60000)).toThrow(expect.objectContaining({ code: 'SUPPLIER_QUOTE_EXPIRED' }));
  });

  it('rejects unavailable refreshed offers before invoice/debit', () => {
    const previous = createSupplierPriceQuote(input(), options);
    expect(() => assertSupplierPriceQuoteCurrent(previous, { ok: false, reason: 'REFERENCE_STALE' }, NOW))
      .toThrow(expect.objectContaining({ code: 'SUPPLIER_QUOTE_UNAVAILABLE' }));
  });
});

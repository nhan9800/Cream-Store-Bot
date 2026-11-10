import fs from 'node:fs';
import Database from 'better-sqlite3';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(process.env, { ENV_FILE: '.env.autobuy-catalog-test-absent', DATABASE_PATH: `./data/test-autobuy-catalog-${process.pid}.sqlite` }));
import { db } from '../src/database/db.js';
import { createSupplierAutobuyCatalog, priceSupplierProduct, supplierSalesConfigured } from '../src/services/supplierAutobuyCatalogService.js';

const NOW = Date.parse('2026-11-10T16:30:00Z');
const key = 'desc_reviewed-product';
const product = { productKey: key, name: 'Capcut Pro 30 Ngày (BHF)', priceVnd: 36000, stock: 10, unlimited: false };
const entry = { productKey: key, expectedName: product.name, enabled: true, category: 'Thiết kế', markupVnd: 20000,
  reserveVnd: 3000, referenceId: 'official', referenceCapVnd: 500000, termLabel: '30 ngày', warrantyLabel: 'Bảo hành đủ thời hạn gói', accountForm: 'Tài khoản cấp sẵn', comparisonDisclosure: 'Gói tham chiếu khác hình thức tài khoản.' };
const policy = { version: 'reviewed-test-v1', referenceMaxAgeDays: 30, pricingDefaults: { feeReserveBps: 300, minProfitVnd: 20000, roundToVnd: 1000 },
  references: { official: { kind: 'BENCHMARK', url: 'https://www.capcut.com/pricing', checkedAt: new Date(NOW).toISOString() } }, products: [entry] };
const databases = [];
function fixture(options = {}) {
  const database = new Database(':memory:'); databases.push(database);
  let time = NOW;
  const getStock = vi.fn().mockResolvedValue([{ ...product }]);
  const service = createSupplierAutobuyCatalog({ policy, database, now: () => time, clientFactory: () => ({ getStock }), enabled: () => true, ...options });
  return { database, service, getStock, advance: ms => { time += ms; } };
}
afterEach(() => { for (const d of databases.splice(0)) if (d.open) d.close(); });
afterAll(() => { if (db.open) db.close(); for (const s of ['', '-wal', '-shm']) fs.rmSync(process.env.DATABASE_PATH + s, { force: true }); });

describe('reviewed supplier pricing', () => {
  it('rounds up after explicit reserves and retains net margin below the dated official benchmark', () => {
    const result = priceSupplierProduct(product, entry, policy, { nowMs: NOW });
    expect(result).toMatchObject({ ok: true, priceVnd: 61000, durationDays: 30, durationMonths: 0, referenceKind: 'BENCHMARK' });
    expect(result.netProfitVnd).toBeGreaterThanOrEqual(20000);
    expect(result.priceVnd).toBeLessThan(result.referenceCapVnd);
    expect(result.comparisonDisclosure).toContain('khác');
  });
  it.each([
    ['source name changed', { ...product, name: 'Capcut Trial 7 Ngày' }, entry, policy, 'SOURCE_CHANGED'],
    ['free product', { ...product, priceVnd: 0 }, entry, policy, 'SOURCE_CHANGED'],
    ['unreviewed', product, { ...entry, enabled: false, reason: 'NOT_REVIEWED' }, policy, 'NOT_REVIEWED'],
    ['unknown term', product, { ...entry, termLabel: 'Theo tài khoản' }, policy, 'TERMS_UNVERIFIED'],
    ['missing warranty', product, { ...entry, warrantyLabel: '' }, policy, 'TERMS_UNVERIFIED'],
    ['cannot fit margin cap', product, { ...entry, referenceCapVnd: 50000 }, policy, 'NO_PROFITABLE_PRICE'],
    ['unverified official reference', product, { ...entry, referenceId: 'missing' }, policy, 'REFERENCE_UNVERIFIED'],
    ['stale reference', product, entry, { ...policy, references: { official: { ...policy.references.official, checkedAt: '2026-09-01T00:00:00Z' } } }, 'REFERENCE_STALE'],
    ['credentials in reference URL', product, entry, { ...policy, references: { official: { ...policy.references.official, url: 'https://user:pass@example.com' } } }, 'REFERENCE_UNVERIFIED'],
  ])('rejects %s', (_, p, e, manifest, reason) => expect(priceSupplierProduct(p, e, manifest, { nowMs: NOW })).toEqual({ ok: false, reason }));
  it('rejects lossy or invalid administrator overrides', () => {
    expect(priceSupplierProduct(product, entry, policy, { nowMs: NOW, override: { price_vnd: 50000 } }).ok).toBe(false);
    expect(priceSupplierProduct(product, entry, policy, { nowMs: NOW, override: { price_vnd: '61000' } }).reason).toBe('INVALID_OVERRIDE');
    expect(priceSupplierProduct(product, entry, policy, { nowMs: NOW, override: { price_vnd: 500000 } }).ok).toBe(false);
  });
});

describe('supplier catalog cache and private quotes', () => {
  it('coalesces reads, exposes only sale fields, and never puts costs/profit into public offers or health', async () => {
    const { service, getStock } = fixture();
    const [first, second] = await Promise.all([service.getOffers(), service.getOffers()]);
    expect(getStock).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.offers[0]).toMatchObject({ priceVnd: 61000, available: true, termLabel: '30 ngày' });
    const publicJson = JSON.stringify([first, service.getHealth()]);
    expect(publicJson).not.toMatch(/unitCost|36000|netProfit|reserveVnd|balance|apiKey/);
    const quote = await service.getQuote(key, 2);
    expect(quote).toMatchObject({ quantity: 2, totalPriceVnd: 122000, totalCostVnd: 72000, maxUnitCostVnd: 36000 });
    expect(Date.parse(quote.expiresAt)).toBe(NOW + 60000);
  });
  it('keeps fingerprints stable across timestamps but changes them for live cost or admin price revisions', async () => {
    const { service, advance, getStock } = fixture();
    const a = await service.getQuote(key);
    advance(1000);
    const b = await service.getQuote(key);
    expect(a.termsFingerprint).toBe(b.termsFingerprint);
    advance(2001);
    getStock.mockResolvedValue([{ ...product, priceVnd: 37000 }]);
    const c = await service.getQuote(key, 1, { force: true });
    expect(c.termsFingerprint).not.toBe(a.termsFingerprint);
  });
  it('does not present unlimited stock as a fabricated finite quantity', async () => {
    const { service } = fixture({ clientFactory: () => ({ getStock: async () => [{ ...product, stock: -1, unlimited: true }] }) });
    expect((await service.getOffers()).offers[0]).toMatchObject({ stock: -1, unlimited: true, available: true });
    expect((await service.getQuote(key, 10)).quantity).toBe(10);
  });
  it('shows out-of-stock reviewed products but rejects checkout', async () => {
    const { service } = fixture({ clientFactory: () => ({ getStock: async () => [{ ...product, stock: 0 }] }) });
    expect((await service.getOffers()).offers[0].available).toBe(false);
    await expect(service.getQuote(key)).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
  });
  it('fails closed on unavailable fresh source rather than using a stale sale quote', async () => {
    const { service, getStock, advance } = fixture();
    await service.getOffers(); advance(30001);
    getStock.mockRejectedValue(new Error('upstream private payload'));
    await expect(service.getQuote(key)).rejects.toMatchObject({ code: 'SUPPLIER_UNAVAILABLE' });
    expect(service.getHealth().status).toBe('UNAVAILABLE');
  });
  it('persists an authorized override/audit event and invalidates prepared quote fingerprints', async () => {
    const { service, database } = fixture();
    const before = await service.getQuote(key);
    await service.setPriceOverride({ guildId: '1282637033340403754', actorId: '1138315103821889566', authorized: true, productKey: key, priceVnd: 65000 });
    expect((await service.getQuote(key)).termsFingerprint).not.toBe(before.termsFingerprint);
    expect(database.prepare('SELECT COUNT(*) n FROM supplier_autobuy_price_events').get().n).toBe(1);
    const restored = createSupplierAutobuyCatalog({ policy, database, now: () => NOW, enabled: () => true, clientFactory: () => ({ getStock: async () => [product] }) });
    expect((await restored.getQuote(key)).unitPriceVnd).toBe(65000);
    await expect(service.setPriceOverride({ guildId: '1282637033340403754', actorId: '1138315103821889566', productKey: key, priceVnd: 70000 })).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
  it('never contacts the provider in an unconfigured or other-store context', async () => {
    const { service, getStock } = fixture({ enabled: () => false });
    await expect(service.getOffers()).rejects.toMatchObject({ code: 'AUTOBUY_DISABLED' });
    expect(getStock).not.toHaveBeenCalled();
    const env = { ENV_FILE: '.env', SUPPLIER_AUTOBUY_PROVIDER: 'dopermind', SUPPLIER_AUTOBUY_ENABLED: 'true', DOPERMIND_API_KEY: 'synthetic-only' };
    expect(supplierSalesConfigured(env, '1282637033340403754')).toBe(true);
    expect(supplierSalesConfigured({ ...env, ENV_FILE: '.env.store2' }, '1282637033340403754')).toBe(false);
    expect(supplierSalesConfigured(env, '1070676180103086132')).toBe(false);
  });
  it.each([0, 11, 1.5, '2', -1])('rejects invalid quantity %j before network', async quantity => {
    const { service, getStock } = fixture();
    await expect(service.getQuote(key, quantity)).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
    expect(getStock).not.toHaveBeenCalled();
  });
});

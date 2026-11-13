import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/database/db.js', () => ({ db: {} }));
vi.mock('../src/config.js', () => ({ config: {} }));
import { createSupplierAutobuyCatalog } from '../src/services/supplierAutobuyCatalogService.js';

const NOW = Date.parse('2026-11-14T03:00:00Z'), guildId = '1282637033340403754', actorId = '1138315103821889566';
const databases = [], temporaryFiles = [];
afterEach(() => { for (const database of databases.splice(0)) database.close();
  for (const file of temporaryFiles.splice(0)) rmSync(file, { force: true }); });
function fixture(size = 103, options = {}) {
  const database = options.database || new Database(':memory:'); if (!options.database) databases.push(database);
  let time = NOW;
  const work = { batchReads: 0, pointReads: 0, batchPrepares: 0, priceEvaluations: 0 };
  const counted = { exec: sql => database.exec(sql), transaction: fn => database.transaction(fn), prepare: sql => {
    const statement = database.prepare(sql);
    if (/SELECT product_key,price_vnd,revision FROM supplier_autobuy_price_overrides/.test(sql)) {
      work.batchPrepares++;
      return { all: (...args) => { work.batchReads++; return statement.all(...args); } };
    }
    if (/SELECT.+FROM supplier_autobuy_price_overrides WHERE product_key/.test(sql)) work.pointReads++;
    return statement;
  } };
  const products = Array.from({ length: size }, (_, index) => ({ productKey: `${options.prefix || 'desc_product_'}${index + 1}`,
    name: `Reviewed package ${index + 1}`, nameEn: `English package ${index + 1}`, type: 'NORMAL', priceVnd: 100000,
    stock: 5, unlimited: false, delivery: 'automatic' }));
  const entries = products.map(product => ({ productKey: product.productKey, expectedName: product.name, enabled: true,
    markupVnd: 30000, reserveVnd: 0, referenceId: 'official', termLabel: '1 tháng', durationMonths: 1,
    warrantyLabel: 'Bảo hành theo gói', accountForm: 'Reviewed test package',
    get category() { work.priceEvaluations++; return 'AI'; } }));
  const policy = { version: 'performance-test-v1', referenceMaxAgeDays: 30, pricingDefaults: { feeReserveBps: 100, minProfitVnd: 20000, roundToVnd: 1000 },
    references: { official: { kind: 'BENCHMARK', url: 'https://learn.chatgpt.com/docs/pricing', checkedAt: new Date(options.referenceCheckedAt ?? NOW).toISOString(), referenceCapVnd: 600000 } }, products: entries };
  const getStock = vi.fn(async () => products);
  const service = createSupplierAutobuyCatalog({ policy, database: counted, now: () => time,
    clientFactory: () => ({ getStock }), enabled: () => true, ...options.serviceOptions });
  return { database, service, getStock, work, products, policy, advance: ms => { time += ms; } };
}

describe('catalog navigation work and financial invalidation', () => {
  it.each([103, 500])('bounds %s-product navigation to one batch read per view and prices the unchanged source once', async size => {
    const t = fixture(size);
    const first = await t.service.getOffers();
    expect(first.offers).toHaveLength(size);
    await Promise.all(Array.from({ length: 19 }, () => t.service.getOffers()));
    expect(t.getStock).toHaveBeenCalledOnce();
    expect(t.work).toEqual({ batchReads: 20, pointReads: 0, batchPrepares: 1, priceEvaluations: size });
    const quote = await t.service.getQuote(t.products.at(-1).productKey, 1, { force: true });
    expect(quote.unitPriceVnd).toBe(132000);
    expect(t.work.priceEvaluations).toBe(size + 1); expect(t.work.batchReads).toBe(21);
    // Returning sale cards cannot allow callers to poison the cached financial
    // read model or the selected product's freshly evaluated quote.
    first.offers[0].priceVnd = 1; first.offers.splice(1);
    expect((await t.service.getOffers()).offers).toHaveLength(size);
    expect((await t.service.getQuote(t.products[0].productKey)).unitPriceVnd).toBe(132000);
  });
  it('invalidates list pricing and fingerprints immediately for service overrides and direct same-connection edits', async () => {
    const t = fixture(); const key = t.products[0].productKey;
    await t.service.getOffers(); const before = await t.service.getQuote(key);
    await t.service.setPriceOverride({ guildId, actorId, productKey: key, priceVnd: 145000, authorized: true });
    expect((await t.service.getOffers()).offers[0].priceVnd).toBe(145000);
    const changed = await t.service.getQuote(key); expect(changed.termsFingerprint).not.toBe(before.termsFingerprint);
    // A manual SQL writer need not know the service's local revision counter.
    t.database.prepare('UPDATE supplier_autobuy_price_overrides SET price_vnd=150000 WHERE product_key=?').run(key);
    expect((await t.service.getOffers()).offers[0].priceVnd).toBe(150000);
    expect((await t.service.getQuote(key)).termsFingerprint).not.toBe(changed.termsFingerprint);
    t.database.prepare('UPDATE supplier_autobuy_price_overrides SET price_vnd=100001 WHERE product_key=?').run(key);
    await expect(t.service.getQuote(key, 1, { force: true })).rejects.toMatchObject({ code: 'NO_PROFITABLE_PRICE' });
    expect((await t.service.getOffers()).offers.some(offer => offer.productKey === key)).toBe(false);
  });
  it('sees another SQLite connection commit without waiting for source TTL or a local revision counter', async () => {
    const file = join(tmpdir(), `cenar-catalog-performance-${randomUUID()}.sqlite`); temporaryFiles.push(file);
    const database = new Database(file); databases.push(database);
    const t = fixture(103, { database }), key = t.products[0].productKey;
    const before = await t.service.getQuote(key); await t.service.getOffers();
    const external = new Database(file); databases.push(external);
    external.prepare(`INSERT INTO supplier_autobuy_price_overrides(product_key,price_vnd,revision,actor_id,updated_at) VALUES(?,?,?,?,?)`)
      .run(key, 155000, 'external-commit', actorId, new Date(NOW).toISOString());
    expect((await t.service.getOffers()).offers[0].priceVnd).toBe(155000);
    const current = await t.service.getQuote(key, 1, { force: true });
    expect(current.unitPriceVnd).toBe(155000); expect(current.termsFingerprint).not.toBe(before.termsFingerprint);
    expect(t.getStock).toHaveBeenCalledOnce();
  });
  it('rechecks reference expiration while source TTL is still fresh', async () => {
    const t = fixture(103, { referenceCheckedAt: NOW - 30 * 86400000 + 20 });
    expect((await t.service.getOffers()).offers).toHaveLength(103);
    t.advance(21);
    expect((await t.service.getOffers()).offers).toHaveLength(0);
    await expect(t.service.getQuote(t.products[0].productKey)).rejects.toMatchObject({ code: 'REFERENCE_STALE' });
    expect(t.getStock).toHaveBeenCalledOnce(); expect(t.service.getHealth().blockedReasons).toEqual({ REFERENCE_STALE: 103 });
  });
  it('shares a forced refresh with navigation and fails closed after a known refresh outage', async () => {
    const t = fixture(); await t.service.getOffers(); t.advance(2001);
    let fail; t.getStock.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const quote = t.service.getQuote(t.products[0].productKey, 1, { force: true });
    const quoteCheck = expect(quote).rejects.toMatchObject({ code: 'SUPPLIER_UNAVAILABLE' });
    await vi.waitFor(() => expect(t.getStock).toHaveBeenCalledTimes(2));
    const navigationCheck = expect(t.service.getOffers()).rejects.toMatchObject({ code: 'SUPPLIER_UNAVAILABLE' });
    fail(new Error('Synthetic outage')); await Promise.all([quoteCheck, navigationCheck]);
    t.getStock.mockResolvedValueOnce(t.products.map(row => ({ ...row, stock: 0 })));
    const recovered = await t.service.getOffers();
    expect(t.getStock).toHaveBeenCalledTimes(3); expect(recovered.offers.every(offer => !offer.available)).toBe(true);
    await expect(t.service.getQuote(t.products[0].productKey)).rejects.toMatchObject({ code: 'OUT_OF_STOCK' });
  });
  it('keeps independent provider models safe when one source fails and rejects ambiguous identities', async () => {
    const cdk = fixture(103, { prefix: 'cdkvietnam:' });
    const doper = fixture(500, { database: cdk.database });
    await Promise.all([cdk.service.getOffers(), doper.service.getOffers()]); cdk.advance(30001);
    cdk.getStock.mockRejectedValueOnce(new Error('Only CDK unavailable'));
    await expect(cdk.service.getOffers()).rejects.toMatchObject({ code: 'SUPPLIER_UNAVAILABLE' });
    expect((await doper.service.getOffers()).offers).toHaveLength(500); expect(doper.getStock).toHaveBeenCalledOnce();
    cdk.getStock.mockResolvedValueOnce([cdk.products[0], cdk.products[0]]);
    await expect(cdk.service.getQuote(cdk.products[0].productKey, 1, { force: true })).rejects.toMatchObject({ code: 'SUPPLIER_UNAVAILABLE' });
  });
  it('keeps operator-only English names/type in the cached review snapshot without costs', async () => {
    const t = fixture(); await t.service.getOffers();
    expect(t.service.getReviewSnapshot().products[0]).toMatchObject({ nameEn: 'English package 1', type: 'NORMAL' });
    expect(JSON.stringify(t.service.getReviewSnapshot())).not.toMatch(/priceVnd|unitCost|100000|reserve|profit/i);
  });
});

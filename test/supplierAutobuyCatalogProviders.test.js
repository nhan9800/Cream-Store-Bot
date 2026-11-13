import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ rows: {}, factories: [], reads: [] }));
vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
vi.mock('../src/database/db.js', async () => ({ db: new (await import('better-sqlite3')).default(':memory:') }));
vi.mock('../src/services/dopermindClient.js', () => ({ createDopermindClient: options => {
  state.factories.push({ provider: 'dopermind', key: options.apiKey });
  return { getStock: async () => { state.reads.push('dopermind'); return state.rows.dopermind; } };
} }));
vi.mock('../src/services/cdkVietnamClient.js', () => ({ createCdkVietnamClient: options => {
  state.factories.push({ provider: 'cdkvietnam', key: options.apiKey });
  return { getStock: async () => { state.reads.push('cdkvietnam'); return state.rows.cdkvietnam; } };
} }));

import { db } from '../src/database/db.js';
import { getSupplierOffers, getSupplierQuote, getSupplierCatalogHealth, getSupplierCatalogReviewSnapshot,
  setSupplierPriceOverride, supplierSalesConfigured } from '../src/services/supplierAutobuyCatalogService.js';

const guildId = '1282637033340403754';
const policy = file => JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8'));
const policies = { cdkvietnam: policy('cdkVietnamAutobuyPricingPolicy.json'), dopermind: policy('supplierAutobuyPricingPolicy.json') };
const product = provider => policies[provider].products.find(row => row.enabled);
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T00:00:00Z'));
  for (const [key, value] of Object.entries({ ENV_FILE: '.env', SUPPLIER_AUTOBUY_ENABLED: 'true', SUPPLIER_AUTOBUY_PROVIDER: 'cdkvietnam',
    CDKVIETNAM_API_KEY: 'synthetic-cdk-only', DOPERMIND_API_KEY: 'synthetic-doper-only' })) vi.stubEnv(key, value);
  for (const provider of ['cdkvietnam', 'dopermind']) {
    const entry = product(provider);
    state.rows[provider] = [{ productKey: entry.productKey, name: entry.expectedName, priceVnd: 100000,
      delivery: entry.deliveryMode || 'automatic', stock: 20, locked: false }];
  }
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
afterAll(() => db.close());

describe('provider-keyed catalog registry', () => {
  it('keeps policy, source credentials, cache, quote and health isolated while CDK is the default', async () => {
    const cdk = await getSupplierOffers({ provider: 'cdkvietnam' });
    const doper = await getSupplierOffers({ provider: 'dopermind' });
    expect(cdk).toMatchObject({ provider: 'cdkvietnam', sourceCount: 1 });
    expect(doper).toMatchObject({ provider: 'dopermind', sourceCount: 1 });
    expect(cdk.offers).toHaveLength(1); expect(doper.offers).toHaveLength(1);
    expect(cdk.offers[0].productKey).toBe(product('cdkvietnam').productKey);
    expect(doper.offers[0].productKey).toBe(product('dopermind').productKey);
    expect(state.factories).toEqual([{ provider: 'cdkvietnam', key: 'synthetic-cdk-only' }, { provider: 'dopermind', key: 'synthetic-doper-only' }]);
    await getSupplierOffers(); await getSupplierOffers({ provider: 'dopermind' });
    expect(state.reads).toEqual(['cdkvietnam', 'dopermind']);
    for (const provider of ['cdkvietnam', 'dopermind']) {
      const q = await getSupplierQuote(product(provider).productKey, 1, { provider });
      expect(q.provider).toBe(provider);
      expect(getSupplierCatalogHealth(provider)).toMatchObject({ provider, sourceCount: 1, availableCount: 1 });
      expect(getSupplierCatalogReviewSnapshot(provider).products[0].productKey).toBe(product(provider).productKey);
    }
    expect(JSON.stringify([cdk, doper, getSupplierCatalogHealth('cdkvietnam'), getSupplierCatalogHealth('dopermind')]))
      .not.toMatch(/synthetic-|unitCost|balanceVnd|netProfit|priceVnd":100000/);
  });
  it('rejects quote/admin source mismatches before creating a client or fetching permissions', async () => {
    const before = state.factories.length;
    await expect(getSupplierQuote(product('cdkvietnam').productKey, 1, { provider: 'dopermind' })).rejects.toMatchObject({ code: 'PROVIDER_MISMATCH' });
    const fetch = vi.fn();
    await expect(setSupplierPriceOverride({ provider: 'dopermind', guildId, productKey: product('cdkvietnam').productKey,
      client: { guilds: { fetch } } })).rejects.toMatchObject({ code: 'PROVIDER_MISMATCH' });
    expect(fetch).not.toHaveBeenCalled(); expect(state.factories).toHaveLength(before);
  });
  it('uses each explicit key-presence gate and retains exact Store1 environment restrictions', () => {
    const env = { ENV_FILE: '.env', SUPPLIER_AUTOBUY_ENABLED: 'true', SUPPLIER_AUTOBUY_PROVIDER: 'cdkvietnam',
      CDKVIETNAM_API_KEY: '', DOPERMIND_API_KEY: 'synthetic-doper-only' };
    expect(supplierSalesConfigured(env, guildId)).toBe(false);
    expect(supplierSalesConfigured(env, guildId, 'dopermind')).toBe(true);
    expect(supplierSalesConfigured({ ...env, ENV_FILE: '.env.store2' }, guildId, 'dopermind')).toBe(false);
    expect(supplierSalesConfigured(env, '1070676180103086132', 'dopermind')).toBe(false);
    expect(supplierSalesConfigured(env, guildId, 'unknown')).toBe(false);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDopermindClient } from '../src/services/dopermindClient.js';

const response = data => new Response(JSON.stringify({ success: true, data }), { headers: { 'content-type': 'application/json' } });
const product = { product_key: 'desc_cache_product', name: 'Example', name_en: 'Example', type: 'product', price: 42000, base_price: 42000, stock: 3, unlimited: false };
const purchase = { productKey: product.product_key, quantity: 1, requestId: 'cache-purchase-request-1', maxUnitCostVnd: 42000 };
afterEach(() => vi.useRealTimers());

describe('private cross-instance provider read cache', () => {
  it('reuses normalized wallet reads for at most5500ms and keeps different keys isolated', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-10T17:00:00Z'));
    const fetchImpl = vi.fn(async () => response({ currency: 'VND', balance: 100000, updated_at: new Date().toISOString() }));
    const options = { apiKey: 'cache-balance-unique-1', fetchImpl, enforceRateLimits: true };
    const a = createDopermindClient(options); const b = createDopermindClient(options);
    expect(await a.getBalance()).toMatchObject({ balanceVnd: 100000 }); await b.getBalance(); expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5499); await b.getBalance(); expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2); await b.getBalance(); expect(fetchImpl).toHaveBeenCalledTimes(2);
    await createDopermindClient({ ...options, apiKey: 'cache-balance-unique-2' }).getBalance(); expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('uses a recent full stock read for filtered preflight without leaking unrelated products', async () => {
    const fetchImpl = vi.fn(async () => response({ products: [product, { ...product, product_key: 'desc_other' }] }));
    const options = { apiKey: 'cache-stock-unique', fetchImpl, enforceRateLimits: true };
    await createDopermindClient(options).getStock();
    const result = await createDopermindClient(options).getStock({ productKey: product.product_key });
    expect(result).toHaveLength(1); expect(result[0].productKey).toBe(product.product_key);
    expect(Object.isFrozen(result)).toBe(true); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('invalidates stock on purchase and updates balance only from a fresh non-idempotent receipt', async () => {
    const now = new Date().toISOString();
    const fetchImpl = vi.fn(async (url, options) => options.method === 'POST'
      ? response({ request_id: purchase.requestId, product_key: product.product_key, quantity: 1, order_code: 'API_CACHE', unit_price: 42000,
        total_amount: 42000, balance_after: 58000, items: ['private-item'], created_at: now, idempotent: false })
      : response({ products: [product] }));
    const client = createDopermindClient({ apiKey: 'cache-purchase-unique', fetchImpl, enforceRateLimits: true });
    await client.getStock(); await client.createOrder(purchase);
    expect(await client.getBalance()).toMatchObject({ balanceVnd: 58000 }); expect(fetchImpl).toHaveBeenCalledTimes(2);
    const next = client.getStock();
    await next; expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('does not reuse a historical idempotent receipt balance as the current wallet', async () => {
    const fetchImpl = vi.fn(async (url, options) => options.method === 'POST'
      ? response({ request_id: purchase.requestId, product_key: product.product_key, quantity: 1, order_code: 'API_CACHE_OLD', unit_price: 42000,
        total_amount: 42000, balance_after: 999999, items: ['private-item'], created_at: '2026-11-01T00:00:00Z', idempotent: true })
      : response({ balance: 0, currency: 'VND', updated_at: new Date().toISOString() }));
    const client = createDopermindClient({ apiKey: 'cache-old-receipt-unique', fetchImpl, enforceRateLimits: true });
    await client.createOrder(purchase); expect(await client.getBalance()).toMatchObject({ balanceVnd: 0 }); expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

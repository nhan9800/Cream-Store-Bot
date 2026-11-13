import { afterEach, describe, expect, it, vi } from 'vitest';
import { CDK_VIETNAM_ORIGIN, CdkVietnamError, createCdkVietnamClient } from '../src/services/cdkVietnamClient.js';

const SECRET = 'synthetic-cdk-server-only-credential';
const product = (patch = {}) => ({ id: 6, name: 'CDK Claude PRO 1M (IOS) - BH Gói',
  description: 'activation guide', currency: 'VND', prices: [{ min_quantity: 1, unit_price: 525000 }],
  stock: 41, locked: false, delivery: 'automatic', ...patch });
const balance = (patch = {}) => ({ balance: 0, currency: 'VND', ...patch });
const order = (patch = {}) => ({ id: 'ord_0123456789abcdef0123456789abcdef', idempotency_key: 'cenar-test-00000001',
  product_id: 6, product_name: product().name, quantity: 1, unit_price: 525000, total_price: 525000,
  currency: 'VND', status: 'delivered', created_at: '2026-11-11T00:00:00Z',
  items: ['CDK-EXAMPLE'], ...patch });
const jsonResponse = (data, options = {}) => new Response(JSON.stringify(data), {
  status: 200, headers: { 'content-type': 'application/json', ...options.headers }, ...options,
});
const setup = (data, options = {}) => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(data, options));
  return { fetchImpl, client: createCdkVietnamClient({ apiKey: SECRET, fetchImpl, ...options.client }) };
};
const request = { productKey: 'cdkvietnam:6', quantity: 1, requestId: 'cenar-test-00000001', maxUnitCostVnd: 525000 };

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('CDK Việt Nam fixed-origin transport', () => {
  it('runs an optional synchronous fence once before POST without changing the body or idempotency header', async () => {
    const { client, fetchImpl } = setup({ replayed: false, order: order() }, { status: 201 });
    const beforeSubmit = vi.fn(() => true);
    await client.createOrder({ ...request, beforeSubmit });
    expect(beforeSubmit).toHaveBeenCalledExactlyOnceWith();
    expect(beforeSubmit.mock.invocationCallOrder[0]).toBeLessThan(fetchImpl.mock.invocationCallOrder[0]);
    const options = fetchImpl.mock.calls[0][1];
    expect(options).not.toHaveProperty('beforeSubmit');
    expect(JSON.parse(options.body)).toEqual({ product_id: 6, quantity: 1, max_total: 525000 });
    expect(options.headers['Idempotency-Key']).toBe(request.requestId);
  });
  it.each([
    ['false', () => false], ['undefined', () => undefined], ['truthy', () => 1],
    ['throw', () => { throw new Error('private-guard-secret'); }],
    ['promise', () => Promise.resolve(true)], ['rejected promise', () => Promise.reject(new Error('private-guard-secret'))],
    ['hostile promise', () => {
      const promise = Promise.reject(new Error('private-guard-secret'));
      Object.defineProperty(promise, 'catch', { get() { throw new Error('private-guard-secret'); } });
      return promise;
    }],
  ])('blocks a %s fence with a sanitized definitely-unsubmitted result', async (_name, implementation) => {
    const { client, fetchImpl } = setup({ replayed: false, order: order() }, { status: 201 });
    const beforeSubmit = vi.fn(implementation);
    let failure;
    try { await client.createOrder({ ...request, beforeSubmit }); } catch (caught) { failure = caught; }
    expect(failure).toMatchObject({ code: 'SUBMISSION_BLOCKED', operation: 'createOrder', outcome: 'NOT_SUBMITTED', providerCode: null });
    expect(String(failure)).not.toContain('private-guard-secret'); expect(JSON.stringify(failure)).not.toContain('private-guard-secret');
    expect(beforeSubmit).toHaveBeenCalledOnce(); expect(fetchImpl).not.toHaveBeenCalled();
    await Promise.resolve();
  });
  it.each([null, true, 'unsafe', {}])('rejects an invalid supplied guard before a network request %j', async beforeSubmit => {
    const { client, fetchImpl } = setup({});
    await expect(client.createOrder({ ...request, beforeSubmit })).rejects.toMatchObject({ code: 'INVALID_REQUEST', outcome: 'NOT_SUBMITTED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('enforces elapsed deadline after a synchronous fence even before an abort timer is delivered', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T05:00:00Z'));
    const { client, fetchImpl } = setup({}, { client: { timeoutMs: 100 } });
    const beforeSubmit = vi.fn(() => { vi.setSystemTime(Date.now() + 101); return true; });
    await expect(client.createOrder({ ...request, beforeSubmit })).rejects.toMatchObject({ code: 'TIMEOUT', outcome: 'NOT_SUBMITTED' });
    expect(beforeSubmit).toHaveBeenCalledOnce(); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('does no work on construction and exposes read, purchase and order lookup methods', () => {
    const { client, fetchImpl } = setup({ products: [] });
    expect(Object.keys(client).sort()).toEqual(['createOrder', 'getBalance', 'getOrder', 'getStock']);
    expect(Object.isFrozen(client)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses Bearer auth and maps the documented balance response', async () => {
    const { client, fetchImpl } = setup(balance());
    const result = await client.getBalance();
    expect(result).toMatchObject({ balanceVnd: 0, currency: 'VND' });
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(`${CDK_VIETNAM_ORIGIN}/v1/balance`, expect.objectContaining({
      method: 'GET', redirect: 'error', headers: { Accept: 'application/json', Authorization: `Bearer ${SECRET}` },
    }));
  });

  it('maps numeric provider IDs to namespaced product keys and filters safely', async () => {
    const { client, fetchImpl } = setup({ products: [product(), product({ id: 1, name: 'Other product' })], next_after: null });
    const rows = await client.getStock();
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ productKey: 'cdkvietnam:6', providerProductId: 6, priceVnd: 525000, delivery: 'automatic' }),
      expect.objectContaining({ productKey: 'cdkvietnam:1', providerProductId: 1 }),
    ]));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const filtered = await setup({ products: [product()], next_after: null }).client.getStock({ productKey: 'cdkvietnam:6' });
    expect(filtered).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(SECRET);
  });

  it('continues pagination when a requested SKU is not on the first page', async () => {
    const first = product({ id: 1, name: 'First product' });
    const second = product({ id: 6 });
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ products: [first], next_after: 1 }))
      .mockResolvedValueOnce(jsonResponse({ products: [second], next_after: null }));
    const client = createCdkVietnamClient({ apiKey: SECRET, fetchImpl });
    const rows = await client.getStock({ productKey: 'cdkvietnam:6' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ productKey: 'cdkvietnam:6', providerProductId: 6 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it('includes every page in the full source catalog without requiring a short last page', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ products: [product({ id: 1 })], next_after: 1 }))
      .mockResolvedValueOnce(jsonResponse({ products: [product({ id: 2 })], next_after: 2 }))
      .mockResolvedValueOnce(jsonResponse({ products: [product({ id: 3 })], next_after: null }));
    const client = createCdkVietnamClient({ apiKey: SECRET, fetchImpl });
    expect((await client.getStock()).map(row => row.productKey)).toEqual(['cdkvietnam:1', 'cdkvietnam:2', 'cdkvietnam:3']);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([0, 1, 2].map(after => `${CDK_VIETNAM_ORIGIN}/v1/products?after=${after}&limit=100`));
  });
  it.each(['2', -1, 0, 1.5])('rejects malformed or non-advancing cursor %j rather than returning a truncated catalog', async next_after => {
    const { client } = setup({ products: [product({ id: 1 })], next_after });
    await expect(client.getStock()).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
  });
  it('rejects repeated products across pages and never caches the partial catalog', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ products: [product({ id: 1 })], next_after: 1 }))
      .mockResolvedValueOnce(jsonResponse({ products: [product({ id: 1 })], next_after: null }))
      .mockResolvedValueOnce(jsonResponse({ products: [product({ id: 3 })], next_after: null }));
    const client = createCdkVietnamClient({ apiKey: SECRET, fetchImpl });
    await expect(client.getStock()).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
    expect((await client.getStock())[0].productKey).toBe('cdkvietnam:3');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('rejects a next cursor without any source rows', async () => {
    const { client } = setup({ products: [], next_after: 4 });
    await expect(client.getStock()).rejects.toMatchObject({ code: 'INVALID_SCHEMA' });
  });

  it('sends the documented purchase body, idempotency header and maps a delivered receipt', async () => {
    const { client, fetchImpl } = setup({ replayed: false, order: order() }, { status: 201 });
    const result = await client.createOrder(request);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(`${CDK_VIETNAM_ORIGIN}/v1/orders`, expect.objectContaining({
      method: 'POST', redirect: 'error', body: JSON.stringify({ product_id: 6, quantity: 1, max_total: 525000 }),
      headers: { Accept: 'application/json', Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json', 'Idempotency-Key': request.requestId },
    }));
    expect(result).toMatchObject({ requestId: request.requestId, orderCode: order().id, productKey: request.productKey,
      unitPriceVnd: 525000, totalAmountVnd: 525000, idempotent: false, items: ['CDK-EXAMPLE'] });
  });

  it('retrieves a provider order by its exact API order ID', async () => {
    const { client, fetchImpl } = setup({ order: order({ idempotency_key: undefined }) });
    const result = await client.getOrder({ orderId: order().id });
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(`${CDK_VIETNAM_ORIGIN}/v1/orders/${order().id}`, expect.objectContaining({ method: 'GET' }));
    expect(result).toMatchObject({ orderCode: order().id, productId: 6, status: 'delivered', items: ['CDK-EXAMPLE'] });
  });

  it('keeps a 202 awaiting-delivery outcome uncertain instead of inventing a delivery', async () => {
    const { client } = setup({ replayed: false, order: order({ status: 'awaiting_delivery', items: [] }) }, { status: 202 });
    await expect(client.createOrder(request)).rejects.toMatchObject({ name: 'CdkVietnamError', code: 'DELIVERY_PENDING', outcome: 'UNKNOWN', providerCode: 'DELIVERY_REVIEW', providerOrderCode: order().id });
  });

  it.each([[401, 'AUTHENTICATION_FAILED'], [403, 'AUTHENTICATION_FAILED'], [402, 'REQUEST_REJECTED'], [409, 'REQUEST_REJECTED'], [500, 'UPSTREAM_ERROR']])(
    'maps HTTP%s to a safe error without echoing provider content', async (status, code) => {
      const { client } = setup({ error: { code: 'INSUFFICIENT_BALANCE', message: SECRET } }, { status });
      await expect(client.getBalance()).rejects.toMatchObject({ name: 'CdkVietnamError', code });
      try { await client.getBalance(); } catch (error) { expect(error.message).not.toContain(SECRET); }
    });

  it('reads only CDKVIETNAM_API_KEY when no explicit key is supplied', async () => {
    vi.stubEnv('CDKVIETNAM_API_KEY', SECRET);
    const { fetchImpl, client } = setup(balance(), { client: { apiKey: undefined } });
    await client.getBalance();
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${SECRET}`);
    vi.stubEnv('CDKVIETNAM_API_KEY', '');
    await expect(client.getBalance()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(['cdkvietnam:0', 'cdkvietnam:x', 'desc_123'])('rejects malformed product keys before transmission %s', async productKey => {
    const { client, fetchImpl } = setup({ products: [] });
    await expect(client.getStock({ productKey })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});


import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDopermindClient, DOPERMIND_ORIGIN } from '../src/services/dopermindClient.js';

const KEY = 'synthetic-purchase-key';
const request = { productKey: 'desc_product', quantity: 2, requestId: 'cenar-test-00000001', maxUnitCostVnd: 42000 };
const receipt = (patch = {}) => ({ request_id: request.requestId, product_key: request.productKey, quantity: 2,
  order_code: 'API_TEST_1', unit_price: 42000, total_amount: 84000, balance_after: 100000,
  items: ['private-account-one|password', 'private-account-two|password'], created_at: '2026-11-10T16:00:00Z', idempotent: false, ...patch });
function setup(data = { success: true, data: receipt() }, options = {}) {
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(data), { status: options.status || 200, headers: { 'content-type': 'application/json' } }));
  return { fetchImpl, client: createDopermindClient({ apiKey: KEY, fetchImpl, ...options.client }) };
}
afterEach(() => vi.useRealTimers());
describe('Dopermind durable purchase transport', () => {
  it('sends exactly the documented payload with caller request ID, no unsupported price parameter', async () => {
    const { client, fetchImpl } = setup();
    const result = await client.createOrder(request);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(`${DOPERMIND_ORIGIN}/v1/orders`, expect.objectContaining({ method: 'POST', redirect: 'error',
      headers: { Accept: 'application/json', Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_key: request.productKey, quantity: 2, request_id: request.requestId }) }));
    expect(result).toMatchObject({ requestId: request.requestId, orderCode: 'API_TEST_1', quantity: 2, unitPriceVnd: 42000,
      totalAmountVnd: 84000, overCostLimit: false, idempotent: false });
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.items)).toBe(true);
  });
  it.each([{ quantity: 0 }, { quantity: 1001 }, { quantity: 1.5 }, { requestId: 'short' }, { requestId: 'x'.repeat(97) },
    { requestId: 'unsafe request id' }, { maxUnitCostVnd: 0 }])('rejects unsafe requests without transmission %j', patch => {
    const { client, fetchImpl } = setup();
    expect(() => client.createOrder({ ...request, ...patch })).toThrow(); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([{ request_id: 'foreign-request' }, { product_key: 'foreign-product' }, { quantity: 3 }, { items: [] },
    { total_amount: 100000 }, { unit_price: 0 }, { balance_after: -1 }, { idempotent: null }, { created_at: 'bad' }])('treats invalid successful receipt as uncertain %j', async patch => {
    const { client } = setup({ success: true, data: receipt(patch) });
    await expect(client.createOrder(request)).rejects.toMatchObject({ code: 'INVALID_SCHEMA', outcome: 'UNKNOWN' });
  });
  it('retains a valid over-ceiling receipt for encrypted review instead of losing already charged items', async () => {
    const { client } = setup({ success: true, data: receipt({ unit_price: 45000, total_amount: 90000 }) });
    expect(await client.createOrder(request)).toMatchObject({ overCostLimit: true, items: receipt().items });
  });
  it('accepts the same request receipt marked idempotent without generating any new request ID', async () => {
    const { client, fetchImpl } = setup({ success: true, data: receipt({ idempotent: true }) });
    expect((await client.createOrder(request)).idempotent).toBe(true);
    expect((await client.createOrder(request)).requestId).toBe(request.requestId);
    expect(fetchImpl.mock.calls.map(x => JSON.parse(x[1].body).request_id)).toEqual([request.requestId, request.requestId]);
  });
  it.each(['NOT_ENOUGH_STOCK', 'INSUFFICIENT_BALANCE', 'PRICE_CHANGED'])('whitelists a documented business rejection %s without leaking details', async code => {
    const { client } = setup({ success: false, error: { code, message: KEY, balance: 1234567 } }, { status: 409 });
    let error; try { await client.createOrder(request); } catch (caught) { error = caught; }
    expect(error).toMatchObject({ code: 'REQUEST_REJECTED', providerCode: code, outcome: 'REJECTED', status: 409 });
    expect(JSON.stringify(error)).not.toMatch(/synthetic-purchase|1234567/);
  });
  it.each(['ORDER_HISTORY_PENDING', 'ORDER_FULFILLMENT_PENDING', 'API_REQUEST_CONFLICT', 'API_ORDER_MANUALLY_FULFILLED'])('keeps uncertain/manual outcomes uncertain %s', async code => {
    const { client } = setup({ success: false, code, message: KEY }, { status: code === 'ORDER_HISTORY_PENDING' ? 503 : 409 });
    await expect(client.createOrder(request)).rejects.toMatchObject({ providerCode: code, outcome: 'UNKNOWN' });
  });
  it('discards unknown provider codes and messages', async () => {
    const { client } = setup({ error: { code: KEY, message: KEY } }, { status: 409 });
    await expect(client.createOrder(request)).rejects.toMatchObject({ providerCode: null, outcome: 'UNKNOWN' });
  });
  it('never retries a timed-out POST and reports unknown financial outcome', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const client = createDopermindClient({ apiKey: KEY, fetchImpl, timeoutMs: 25 });
    const promise = client.createOrder(request);
    const check = expect(promise).rejects.toMatchObject({ code: 'TIMEOUT', outcome: 'UNKNOWN' });
    await vi.advanceTimersByTimeAsync(25); await check; expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('rejects local provider-rate overflow before another purchase transmission', async () => {
    const { fetchImpl } = setup();
    const client = createDopermindClient({ apiKey: 'unique-rate-test-key', fetchImpl, enforceRateLimits: true, timeoutMs: 100 });
    await client.createOrder(request);
    await expect(client.createOrder(request)).rejects.toMatchObject({ code: 'RATE_LIMITED', outcome: 'NOT_SUBMITTED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

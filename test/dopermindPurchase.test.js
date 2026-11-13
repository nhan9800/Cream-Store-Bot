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
  it('runs a synchronous submission guard once immediately before the unchanged documented POST', async () => {
    const { client, fetchImpl } = setup(), beforeSubmit = vi.fn(() => true);
    await client.createOrder({ ...request, beforeSubmit });
    expect(beforeSubmit).toHaveBeenCalledExactlyOnceWith();
    expect(beforeSubmit.mock.invocationCallOrder[0]).toBeLessThan(fetchImpl.mock.invocationCallOrder[0]);
    const options = fetchImpl.mock.calls[0][1];
    expect(options).not.toHaveProperty('beforeSubmit');
    expect(JSON.parse(options.body)).toEqual({ product_key: request.productKey, quantity: request.quantity, request_id: request.requestId });
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
  ])('sanitizes a %s guard veto before transmission, including rejected async fences', async (_name, implementation) => {
    const { client, fetchImpl } = setup(), beforeSubmit = vi.fn(implementation);
    let failure;
    try { await client.createOrder({ ...request, beforeSubmit }); } catch (caught) { failure = caught; }
    expect(failure).toMatchObject({ code: 'SUBMISSION_BLOCKED', operation: 'createOrder', outcome: 'NOT_SUBMITTED', providerCode: null });
    expect(String(failure)).not.toContain('private-guard-secret'); expect(JSON.stringify(failure)).not.toContain('private-guard-secret');
    expect(beforeSubmit).toHaveBeenCalledOnce(); expect(fetchImpl).not.toHaveBeenCalled();
    await Promise.resolve();
  });
  it.each([null, true, 'unsafe', {}])('rejects an invalid supplied guard type before reserving a rate slot %j', beforeSubmit => {
    const { client, fetchImpl } = setup();
    expect(() => client.createOrder({ ...request, beforeSubmit })).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST', outcome: 'NOT_SUBMITTED' }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('rechecks a pause after the internal purchase-rate wait instead of posting stale approval', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T04:00:00Z'));
    const { fetchImpl } = setup();
    const client = createDopermindClient({ apiKey: 'synthetic-wire-fence-delay', fetchImpl, enforceRateLimits: true, timeoutMs: 10000 });
    await client.createOrder(request);
    let enabled = true; const beforeSubmit = vi.fn(() => enabled);
    const pending = client.createOrder({ ...request, beforeSubmit });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'SUBMISSION_BLOCKED', outcome: 'NOT_SUBMITTED' });
    await vi.advanceTimersByTimeAsync(5099);
    expect(beforeSubmit).not.toHaveBeenCalled(); expect(fetchImpl).toHaveBeenCalledOnce();
    enabled = false; await vi.advanceTimersByTimeAsync(1); await rejected;
    expect(beforeSubmit).toHaveBeenCalledOnce(); expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('does not POST when a synchronous guard exhausts the deadline before the timer can fire', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-14T05:00:00Z'));
    const { client, fetchImpl } = setup(undefined, { client: { timeoutMs: 100 } });
    const beforeSubmit = vi.fn(() => { vi.setSystemTime(Date.now() + 101); return true; });
    await expect(client.createOrder({ ...request, beforeSubmit })).rejects.toMatchObject({ code: 'TIMEOUT', outcome: 'NOT_SUBMITTED' });
    expect(beforeSubmit).toHaveBeenCalledOnce(); expect(fetchImpl).not.toHaveBeenCalled();
  });
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

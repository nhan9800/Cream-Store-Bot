import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDaiphucPartnerClient, DaiphucPartnerError, DAIPHUC_PARTNER_ORIGIN } from '../src/services/daiphucPartnerClient.js';

const key = 'synthetic-bearer-secret';
const order = { productId: 'sku-1', quantity: 2, inputs: { recipient: 'synthetic' }, idempotencyKey: 'store1:order-1:v1' };
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
});

function clientWith(response, options = {}) {
  const fetchImpl = vi.fn().mockImplementation(async () => typeof response === 'function' ? response() : response);
  const client = createDaiphucPartnerClient({ apiKey: key, fetchImpl, ...options });
  return { client, fetchImpl };
}

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('DaiPhuc documented request contract', () => {
  it('has no network or credential capture side effects on construction', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => json({ products: [] }));
    vi.stubEnv('DAIPHUC_PARTNER_API_KEY', 'earlier-key');
    const client = createDaiphucPartnerClient({ fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    vi.stubEnv('DAIPHUC_PARTNER_API_KEY', 'replacement-key');
    await client.getProducts();
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer replacement-key');
  });

  it.each([
    ['getMe', [], '/v1/me'],
    ['getProducts', [], '/v1/products'],
    ['listOrders', [], '/v1/orders?limit=50'],
    ['listOrders', [{ limit: 12 }], '/v1/orders?limit=12'],
    ['getOrder', ['id/with?symbols#'], '/v1/orders/id%2Fwith%3Fsymbols%23'],
    ['getOrderLogs', ['order-1'], '/v1/orders/order-1/logs'],
  ])('%s uses only its documented GET endpoint', async (method, params, path) => {
    const raw = { arbitrary_provider_shape: { remains: 'unchanged' } };
    const { client, fetchImpl } = clientWith(json(raw));
    expect(await client[method](...params)).toEqual(raw);
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(`${DAIPHUC_PARTNER_ORIGIN}${path}`, expect.objectContaining({
      method: 'GET', redirect: 'error', headers: { Accept: 'application/json', Authorization: `Bearer ${key}` },
    }));
    expect(fetchImpl.mock.calls[0][1].body).toBeUndefined();
  });

  it('does not disclose a bearer credential to the unauthenticated health endpoint', async () => {
    const { client, fetchImpl } = clientWith(json({ ok: true }), { apiKey: '' });
    expect(await client.getHealth()).toEqual({ ok: true });
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ Accept: 'application/json' });
  });

  it('submits the exact persisted inputs and caller-supplied stable key once', async () => {
    const { client, fetchImpl } = clientWith(json({ order: { opaque_id: 'provider-1' } }, 201));
    expect(await client.createOrder(order)).toEqual({ order: { opaque_id: 'provider-1' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${DAIPHUC_PARTNER_ORIGIN}/v1/orders`);
    expect(options).toMatchObject({ method: 'POST', redirect: 'error', headers: {
      Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': order.idempotencyKey,
    } });
    expect(JSON.parse(options.body)).toEqual({ product_id: 'sku-1', quantity: 2, inputs: { recipient: 'synthetic' } });
    expect(options.body).not.toContain('idempotencyKey');
  });

  it('defaults quantity and inputs but never invents an idempotency key', async () => {
    const { client, fetchImpl } = clientWith(json({}, 201));
    await client.createOrder({ productId: 'one', idempotencyKey: 'persisted-key' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ product_id: 'one', quantity: 1, inputs: {} });
    expect(() => client.createOrder({ productId: 'one' })).toThrow(DaiphucPartnerError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('DaiPhuc preflight validation', () => {
  it.each([
    undefined, null, {}, { ...order, productId: '' }, { ...order, productId: 'x'.repeat(101) },
    { ...order, quantity: 0 }, { ...order, quantity: 101 }, { ...order, quantity: 1.5 }, { ...order, quantity: '1' },
    { ...order, inputs: [] }, { ...order, inputs: { value: undefined } }, { ...order, inputs: { value: NaN } },
    { ...order, inputs: { value: new Date() } }, { ...order, inputs: { value: 1n } },
    { ...order, inputs: { value: 'x'.repeat(65_536) } },
    { ...order, idempotencyKey: '' }, { ...order, idempotencyKey: 'bad\r\nheader' },
  ])('rejects invalid order inputs without any provider call', (params) => {
    const { client, fetchImpl } = clientWith(json({}, 201));
    try { client.createOrder(params); throw new Error('expected rejection'); } catch (error) {
      expect(error).toMatchObject({ name: 'DaiphucPartnerError', code: 'INVALID_REQUEST', outcome: 'NOT_SUBMITTED' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects cyclic and accessor input rather than exposing its error or dropping values', () => {
    const { client, fetchImpl } = clientWith(json({}, 201));
    const inputs = {}; inputs.self = inputs;
    expect(() => client.createOrder({ ...order, inputs })).toThrow('Supplier request parameters are invalid.');
    const throwing = { ...order, get inputs() { throw new Error('private-password'); } };
    expect(() => client.createOrder(throwing)).toThrow('Supplier request parameters are invalid.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects sparse arrays, extra array properties and hidden serialization hooks', () => {
    const { client, fetchImpl } = clientWith(json({}, 201));
    const sparse = new Array(2); sparse[1] = 'kept';
    const decorated = ['first']; decorated.metadata = 'would-disappear';
    const hidden = {}; Object.defineProperty(hidden, 'toJSON', { value: () => ({ altered: true }) });
    for (const inputs of [{ value: sparse }, { value: decorated }, hidden]) {
      expect(() => client.createOrder({ ...order, inputs })).toThrow(DaiphucPartnerError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('preserves dense nested JSON arrays without mutating the input', async () => {
    const { client, fetchImpl } = clientWith(json({}, 201));
    const inputs = { list: ['value', null, true, 1, { nested: ['another'] }] };
    const snapshot = JSON.stringify(inputs);
    await client.createOrder({ ...order, inputs });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).inputs).toEqual(inputs);
    expect(JSON.stringify(inputs)).toBe(snapshot);
  });

  it.each(['', '.', '..', 'x\nAuthorization: injected', '\ud800'])('rejects unsafe order identifiers %j', (id) => {
    const { client, fetchImpl } = clientWith(json({}));
    expect(() => client.getOrder(id)).toThrow(DaiphucPartnerError);
    expect(() => client.getOrderLogs(id)).toThrow(DaiphucPartnerError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([0, -1, 101, '10', 1.5])('bounds list requests: %j', (limit) => {
    const { client, fetchImpl } = clientWith(json({}));
    expect(() => client.listOrders({ limit })).toThrow(DaiphucPartnerError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['', 'token\nsecret', 'x'.repeat(4097)])('rejects missing/unsafe credentials without sending', async (apiKey) => {
    const { client, fetchImpl } = clientWith(json({}), { apiKey });
    await expect(client.getMe()).rejects.toMatchObject({ outcome: 'NOT_SUBMITTED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('DaiPhuc bounded and sanitized failures', () => {
  it.each([
    [401, 'AUTHENTICATION_FAILED'], [403, 'AUTHENTICATION_FAILED'], [429, 'RATE_LIMITED'],
    [422, 'REQUEST_REJECTED'], [500, 'UPSTREAM_ERROR'], [202, 'UNEXPECTED_STATUS'],
  ])('never retries or exposes provider error contents for POST status %i', async (status, code) => {
    const { client, fetchImpl } = clientWith(json({ detail: `${key} customer-password` }, status));
    const error = await client.createOrder(order).catch(value => value);
    expect(error).toMatchObject({ code, status, operation: 'createOrder', outcome: 'UNKNOWN' });
    expect(`${error.stack} ${JSON.stringify(error)}`).not.toMatch(/synthetic-bearer-secret|customer-password/);
    expect(error.cause).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not mark a failed GET as a submitted purchase', async () => {
    const { client } = clientWith(json({ private: key }, 401));
    await expect(client.getMe()).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED', outcome: 'NOT_SUBMITTED' });
  });

  it.each([301, 302, 307, 308])('refuses status %i without following a redirect', async (status) => {
    const { client, fetchImpl } = clientWith(new Response(null, { status, headers: { Location: 'https://untrusted.invalid/' } }));
    await expect(client.createOrder(order)).rejects.toMatchObject({ code: 'REDIRECT_REJECTED', outcome: 'UNKNOWN' });
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('error');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects an already-followed/off-origin response from an injected transport', async () => {
    const response = json({});
    Object.defineProperty(response, 'url', { value: 'http://untrusted.invalid/v1/products' });
    const { client } = clientWith(response);
    await expect(client.getProducts()).rejects.toMatchObject({ code: 'REDIRECT_REJECTED' });
  });

  it.each([null, [], 'text', 7])('requires an object response, rejecting %j', async (value) => {
    const { client } = clientWith(json(value, 201));
    await expect(client.createOrder(order)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', outcome: 'UNKNOWN' });
  });

  it('rejects proxy HTML and malformed JSON without exposing raw response text', async () => {
    for (const response of [new Response(key), new Response(`{"secret":"${key}`, { headers: { 'content-type': 'application/json' } })]) {
      const { client } = clientWith(response);
      await expect(client.getProducts()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    }
  });

  it('bounds oversized declared responses before reading body', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'application/json', 'content-length': '1000' } });
    const { client } = clientWith(response, { maxResponseBytes: 100 });
    await expect(client.getProducts()).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('bounds streamed responses even without a trustworthy content length', async () => {
    const { client } = clientWith(json({ payload: 'x'.repeat(300) }), { maxResponseBytes: 100 });
    await expect(client.createOrder(order)).rejects.toMatchObject({ code: 'UNEXPECTED_STATUS', outcome: 'UNKNOWN' });
    const second = clientWith(json({ payload: 'x'.repeat(300) }, 201), { maxResponseBytes: 100 });
    await expect(second.client.createOrder(order)).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE', outcome: 'UNKNOWN' });
  });

  it('bounds a transport that ignores abort and never retries a lost purchase response', async () => {
    const fetchImpl = vi.fn().mockImplementation(() => new Promise(() => {}));
    const client = createDaiphucPartnerClient({ apiKey: key, fetchImpl, timeoutMs: 15 });
    await expect(client.createOrder(order)).rejects.toMatchObject({ code: 'TIMEOUT', outcome: 'UNKNOWN' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('includes response body consumption in the same deadline and cancels a stalled stream', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"partial":')); }, cancel,
    }), { status: 201, headers: { 'content-type': 'application/json' } });
    const { client, fetchImpl } = clientWith(response, { timeoutMs: 15 });
    await expect(client.createOrder(order)).rejects.toMatchObject({ code: 'TIMEOUT', outcome: 'UNKNOWN' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('cancels a late response from an abort-ignoring transport after returning timeout', async () => {
    let release;
    const fetchImpl = vi.fn().mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { status: 201, headers: { 'content-type': 'application/json' } });
    const client = createDaiphucPartnerClient({ apiKey: key, fetchImpl, timeoutMs: 10 });
    await expect(client.createOrder(order)).rejects.toMatchObject({ code: 'TIMEOUT', outcome: 'UNKNOWN' });
    release(response);
    await new Promise(resolve => setImmediate(resolve));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed UTF-8 rather than silently rewriting delivered credentials', async () => {
    const bytes = new Uint8Array([123, 34, 107, 34, 58, 34, 0xff, 34, 125]);
    const { client } = clientWith(new Response(bytes, { status: 201, headers: { 'content-type': 'application/json' } }));
    await expect(client.createOrder(order)).rejects.toMatchObject({ code: 'INVALID_RESPONSE', outcome: 'UNKNOWN' });
  });

  it('sanitizes network exceptions instead of attaching a secret-bearing cause', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error(`network failed: ${key}`));
    const client = createDaiphucPartnerClient({ apiKey: key, fetchImpl });
    const error = await client.createOrder(order).catch(value => value);
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', outcome: 'UNKNOWN' });
    expect(`${error.stack} ${JSON.stringify(error)}`).not.toContain(key);
    expect(error.cause).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

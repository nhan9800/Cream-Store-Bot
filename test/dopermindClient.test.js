import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDopermindClient, DopermindError, DOPERMIND_ORIGIN } from '../src/services/dopermindClient.js';

const SECRET = 'synthetic-server-only-credential';
const product = (patch = {}) => ({ product_key: 'desc_4a514ea7-5fb0-49bd-98bc-e56a42c75e44',
  name: 'Example subscription', name_en: 'Example subscription', type: 'product',
  price: 42000, base_price: 45000, stock: 82, unlimited: false, ...patch });
const balance = (patch = {}) => ({ balance: 1250000, currency: 'VND', updated_at: '2026-11-10T10:30:00+07:00', ...patch });
const envelope = data => ({ success: true, data });
const jsonResponse = (data, options = {}) => new Response(JSON.stringify(data), {
  status: 200, ...options, headers: { 'content-type': 'application/json', ...options.headers },
});
const setup = (data, options = {}) => {
  const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(data));
  return { fetchImpl, client: createDopermindClient({ apiKey: SECRET, fetchImpl, ...options }) };
};
const rejects = async (promise, code) => {
  await expect(promise).rejects.toMatchObject({ name: 'DopermindError', code, outcome: 'NOT_SUBMITTED' });
};

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('Dopermind fixed-origin read-only transport', () => {
  it('exposes only balance and stock operations and performs no work on construction', () => {
    const { client, fetchImpl } = setup({});
    expect(Object.keys(client).sort()).toEqual(['getBalance', 'getStock']);
    expect(Object.isFrozen(client)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses documented Bearer auth against the exact origin and balance route', async () => {
    const { client, fetchImpl } = setup(envelope(balance()));
    const result = await client.getBalance();
    expect(result).toEqual({ balanceVnd: 1250000, currency: 'VND', updatedAt: '2026-11-10T10:30:00+07:00' });
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(`${DOPERMIND_ORIGIN}/v1/balance`, expect.objectContaining({
      method: 'GET', redirect: 'error', headers: { Accept: 'application/json', Authorization: `Bearer ${SECRET}` },
    }));
    expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty('body');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('reads the documented stock list and drops arbitrary supplier fields', async () => {
    const { client, fetchImpl } = setup({ ...envelope({ products: [product({ token: SECRET, extra: { secret: SECRET } })], secret: SECRET }), token: SECRET });
    const result = await client.getStock();
    expect(fetchImpl.mock.calls[0][0]).toBe(`${DOPERMIND_ORIGIN}/v1/stock`);
    expect(result).toEqual([{ productKey: product().product_key, name: 'Example subscription', nameEn: 'Example subscription',
      type: 'product', priceVnd: 42000, basePriceVnd: 45000, stock: 82, unlimited: false }]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
  });

  it('retains distinct product keys even when display names match', async () => {
    const { client } = setup(envelope({ products: [product(), product({ product_key: 'desc_other', unlimited: true, stock: -1 })] }));
    const result = await client.getStock();
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ productKey: 'desc_other', unlimited: true, stock: -1 });
  });

  it('encodes a product key as one query value, without allowing path or parameter injection', async () => {
    const filter = 'desc_one&host=https://elsewhere.example/?x=1#fragment';
    const { client, fetchImpl } = setup(envelope({ products: [product({ product_key: filter })] }));
    await client.getStock({ productKey: filter });
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.origin).toBe(DOPERMIND_ORIGIN);
    expect(url.pathname).toBe('/v1/stock');
    expect([...url.searchParams]).toEqual([['product_key', filter]]);
    expect(url.hash).toBe('');
  });

  it('accepts a valid empty stock response and zero VND balance', async () => {
    const stocks = setup(envelope({ products: [] }));
    expect(await stocks.client.getStock()).toEqual([]);
    expect(await setup(envelope(balance({ balance: 0 }))).client.getBalance()).toMatchObject({ balanceVnd: 0 });
  });

  it('loads only the new server environment variable when no explicit key is supplied', async () => {
    vi.stubEnv('DOPERMIND_API_KEY', SECRET);
    vi.stubEnv('DAIPHUC_PARTNER_API_KEY', 'unrelated-old-credential');
    const { client, fetchImpl } = setup(envelope(balance()), { apiKey: undefined });
    await client.getBalance();
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${SECRET}`);
    vi.stubEnv('DOPERMIND_API_KEY', '');
    await rejects(client.getBalance(), 'NOT_CONFIGURED');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([null, '', '   ', 123])('does not request with a missing credential %j', async apiKey => {
    const { client, fetchImpl } = setup(envelope(balance()), { apiKey });
    await rejects(client.getBalance(), 'NOT_CONFIGURED');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['secret\r\nInjected: header', 'contains a space', 'unicode-đ', 'x'.repeat(4097)])('rejects invalid credential bytes without echoing them', async apiKey => {
    const { client, fetchImpl } = setup(envelope(balance()), { apiKey });
    try { await client.getBalance(); throw new Error('Expected rejection'); } catch (error) {
      expect(error).toBeInstanceOf(DopermindError);
      expect(error.code).toBe('INVALID_CONFIGURATION');
      expect(JSON.stringify(error)).not.toContain(apiKey);
      expect(error.message).not.toContain(apiKey);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([null, '', '  ', 'x'.repeat(201), 'unsafe\nvalue', '\ud800'])('rejects invalid product filters before requesting', filter => {
    const { client, fetchImpl } = setup({});
    expect(() => client.getStock({ productKey: filter })).toThrow(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([{ fetchImpl: null }, { timeoutMs: 0 }, { timeoutMs: 30001 }, { maxResponseBytes: 0 }, { maxResponseBytes: 4194305 }])('rejects invalid client configuration %j', options => {
    expect(() => createDopermindClient(options)).toThrow(expect.objectContaining({ code: 'INVALID_CONFIGURATION' }));
  });
});

describe('Dopermind verified response schema', () => {
  it.each([
    null, [], { data: balance() }, { success: false, error: { message: SECRET } },
    { success: 'true', data: balance() }, { success: true, data: null },
  ])('does not treat HTTP200 as proof of successful balance %j', async payload => {
    const { client } = setup(payload);
    await expect(client.getBalance()).rejects.toBeInstanceOf(DopermindError);
  });

  it.each([
    { balance: -1 }, { balance: 1.1 }, { balance: '1250000' }, { balance: Number.MAX_SAFE_INTEGER + 1 },
    { currency: 'USD' }, { currency: undefined }, { updated_at: undefined }, { updated_at: 'not-a-date' },
  ])('rejects invalid balance fields %j', async patch => {
    await rejects(setup(envelope(balance(patch))).client.getBalance(), 'INVALID_SCHEMA');
  });

  it.each([
    { product_key: undefined }, { product_key: '' }, { name: '' }, { name: 'x'.repeat(501) }, { name_en: null },
    { type: '' }, { price: -1 }, { price: 0.1 }, { price: '42000' }, { base_price: undefined },
    { stock: -1 }, { stock: 0.5 }, { stock: '5' }, { stock: -2, unlimited: true }, { unlimited: 1 },
  ])('rejects ambiguous or invalid stock fields %j', async patch => {
    await rejects(setup(envelope({ products: [product(patch)] })).client.getStock(), 'INVALID_SCHEMA');
  });

  it('rejects duplicate keys while permitting duplicate display names', async () => {
    await rejects(setup(envelope({ products: [product(), product()] })).client.getStock(), 'INVALID_SCHEMA');
  });

  it('rejects products outside a requested key rather than misquoting another product', async () => {
    await rejects(setup(envelope({ products: [product()] })).client.getStock({ productKey: 'requested-key' }), 'INVALID_SCHEMA');
  });

  it.each([undefined, null, {}, 'not-an-array'])('rejects malformed catalog containers %j', async products => {
    await rejects(setup(envelope({ products })).client.getStock(), 'INVALID_SCHEMA');
  });

  it('rejects excessively many catalog items even inside the byte limit', async () => {
    await rejects(setup(envelope({ products: Array(5001).fill(null) })).client.getStock(), 'INVALID_SCHEMA');
  });
});

describe('Dopermind failures, bounded bodies and privacy', () => {
  it.each([[401, 'AUTHENTICATION_FAILED'], [403, 'AUTHENTICATION_FAILED'], [429, 'RATE_LIMITED'],
    [400, 'REQUEST_REJECTED'], [404, 'REQUEST_REJECTED'], [500, 'UPSTREAM_ERROR'], [503, 'UPSTREAM_ERROR'],
    [201, 'UNEXPECTED_STATUS'], [204, 'UNEXPECTED_STATUS']])('maps HTTP%s to a fixed safe error', async (status, code) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(status === 204 ? null : SECRET, { status }));
    const client = createDopermindClient({ apiKey: SECRET, fetchImpl });
    await rejects(client.getBalance(), code);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([301, 302, 307, 308])('does not follow HTTP%s redirects or leak auth to another origin', async status => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status, headers: { location: 'https://elsewhere.example/' } }));
    await rejects(createDopermindClient({ apiKey: SECRET, fetchImpl }).getBalance(), 'REDIRECT_REJECTED');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].redirect).toBe('error');
  });

  it.each([{ redirected: true }, { url: 'https://elsewhere.example/' }])('rejects an unexpectedly redirected transport result %j', async patch => {
    const response = jsonResponse(envelope(balance()));
    for (const [key, value] of Object.entries(patch)) Object.defineProperty(response, key, { value });
    const fetchImpl = vi.fn().mockResolvedValue(response);
    await rejects(createDopermindClient({ apiKey: SECRET, fetchImpl }).getBalance(), 'REDIRECT_REJECTED');
  });

  it('does not expose provider messages, response bodies, exception causes or credentials', async () => {
    const { client } = setup({ success: false, message: SECRET, error: { code: SECRET }, data: { token: SECRET } });
    try { await client.getBalance(); } catch (error) {
      expect(error.code).toBe('PROVIDER_REJECTED');
      expect(error.message + JSON.stringify(error)).not.toContain(SECRET);
      expect(error).not.toHaveProperty('cause');
    }
    const fetchImpl = vi.fn().mockRejectedValue(new Error(`Authorization: Bearer ${SECRET}`));
    try { await createDopermindClient({ apiKey: SECRET, fetchImpl }).getStock(); } catch (error) {
      expect(error.code).toBe('NETWORK_ERROR');
      expect(error.message + JSON.stringify(error)).not.toContain(SECRET);
    }
  });

  it.each([
    ['text/html', '{"success":true}'], ['application/json', '{broken'],
    ['application/json', String.fromCharCode(0xff)], ['application/json', '[]'],
  ])('rejects invalid response content %s %j', async (contentType, body) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': contentType } }));
    await expect(createDopermindClient({ apiKey: SECRET, fetchImpl }).getBalance()).rejects.toBeInstanceOf(DopermindError);
  });

  it('rejects malformed UTF8 instead of silently replacing bytes', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([0xff, 0xfe]), { headers: { 'content-type': 'application/json' } }));
    await rejects(createDopermindClient({ apiKey: SECRET, fetchImpl }).getBalance(), 'INVALID_RESPONSE');
  });

  it('bounds declared response size before reading', async () => {
    const response = jsonResponse(envelope(balance()), { headers: { 'content-length': '1048577' } });
    const fetchImpl = vi.fn().mockResolvedValue(response);
    await rejects(createDopermindClient({ apiKey: SECRET, fetchImpl }).getBalance(), 'RESPONSE_TOO_LARGE');
  });

  it('bounds the actual streamed response even when content-length is omitted', async () => {
    await rejects(setup(envelope(balance()), { maxResponseBytes: 8 }).client.getBalance(), 'RESPONSE_TOO_LARGE');
  });

  it('times out a fetch which ignores abort and never retries', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const promise = createDopermindClient({ apiKey: SECRET, fetchImpl, timeoutMs: 25 }).getBalance();
    const check = rejects(promise, 'TIMEOUT');
    await vi.advanceTimersByTimeAsync(25);
    await check;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it('includes a stalled response body in the same deadline and cancels its reader', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'application/json' } }));
    const promise = createDopermindClient({ apiKey: SECRET, fetchImpl, timeoutMs: 25 }).getStock();
    const check = rejects(promise, 'TIMEOUT');
    await vi.advanceTimersByTimeAsync(25);
    await check;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

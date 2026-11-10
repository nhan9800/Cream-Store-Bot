import { describe, expect, it, vi } from 'vitest';
import { formatDiagnosticReport, runCli, runDiagnostic } from '../scripts/check-dopermind.js';

const secret = 'synthetic-private-credential';
const NOW = Date.parse('2026-11-10T15:30:00Z');
const balance = { balanceVnd: 987654321, currency: 'VND', updatedAt: 'private-updated-at', [secret]: secret };
const products = [
  { productKey: 'private-product-key', name: 'private-product-name', priceVnd: 123456789, stock: 3, unlimited: false },
  { productKey: 'private-product-key-2', name: 'private-product-name-2', priceVnd: 234567890, stock: 0, unlimited: false },
  { productKey: 'private-product-key-3', name: 'private-product-name-3', priceVnd: 345678901, stock: -1, unlimited: true },
];
function mockClient() {
  return { getBalance: vi.fn().mockResolvedValue(balance), getStock: vi.fn().mockResolvedValue(products), createOrder: vi.fn(), getOrder: vi.fn() };
}
const missingFile = () => { throw Object.assign(new Error('private-file-detail'), { code: 'ENOENT' }); };
const outputs = () => {
  const output = [];
  return { output, writeOutput: line => output.push(line) };
};

describe('Dopermind read-only diagnostic', () => {
  it('reads balance and stock exactly once without paid operations and reports only aggregates', async () => {
    const client = mockClient();
    const report = await runDiagnostic(client, { now: () => NOW });
    expect(client.getBalance).toHaveBeenCalledExactlyOnceWith();
    expect(client.getStock).toHaveBeenCalledExactlyOnceWith();
    expect(client.createOrder).not.toHaveBeenCalled();
    expect(client.getOrder).not.toHaveBeenCalled();
    expect(report).toMatchObject({ provider: 'dopermind', readOnly: true, purchasesEnabled: false, configured: true,
      authenticated: true, ok: true, schemaMapped: true, currency: 'VND', productCount: 3, availableCount: 2, checkedAt: new Date(NOW).toISOString() });
    for (const output of [formatDiagnosticReport(report), formatDiagnosticReport(report, true)]) {
      for (const value of [secret, '987654321', 'private-updated-at', 'private-product-key', 'private-product-name', '123456789']) expect(output).not.toContain(value);
    }
  });

  it('retains both HTTP failures while suppressing provider error text and dictionary keys', async () => {
    const client = mockClient();
    client.getBalance.mockRejectedValue({ status: 401, message: secret, code: secret, [secret]: balance });
    client.getStock.mockRejectedValue({ status: 429, message: secret, body: products });
    const report = await runDiagnostic(client);
    expect(report).toMatchObject({ ok: false, authenticated: false, schemaMapped: false, checks: {
      balance: { requestSucceeded: false, httpStatus: 401, error: 'AUTH_REJECTED' },
      stock: { requestSucceeded: false, httpStatus: 429, error: 'RATE_LIMITED' },
    } });
    expect(report).not.toHaveProperty('currency');
    expect(report).not.toHaveProperty('productCount');
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it.each([null, {}, { currency: 'USD', balanceVnd: 10 }, { currency: 'VND', balanceVnd: -1 }, { currency: 'VND', balanceVnd: 1.5 }])('rejects non-normalized balance %j', async invalid => {
    const client = mockClient();
    client.getBalance.mockResolvedValue(invalid);
    expect(await runDiagnostic(client)).toMatchObject({ ok: false, checks: { balance: { error: 'INVALID_RESPONSE' } }, productCount: 3 });
  });

  it.each([{}, null, [{ unlimited: false, stock: -1 }], [{ unlimited: 'yes', stock: 1 }], [{ unlimited: true, stock: -2 }]])('rejects malformed stock %j', async invalid => {
    const client = mockClient();
    client.getStock.mockResolvedValue(invalid);
    const result = await runDiagnostic(client);
    expect(result).toMatchObject({ authenticated: true, ok: false, checks: { stock: { error: 'INVALID_RESPONSE' } } });
    expect(result).not.toHaveProperty('productCount');
  });

  it('counts an empty validated catalog and zero available products accurately', async () => {
    const client = mockClient();
    client.getStock.mockResolvedValue([]);
    expect(await runDiagnostic(client)).toMatchObject({ ok: true, productCount: 0, availableCount: 0 });
  });

  it('contains hostile status/property/clock getters without leaking errors', async () => {
    const client = mockClient();
    const error = Object.defineProperty({}, 'status', { get() { throw new Error(secret); } });
    const value = Object.defineProperty({}, 'currency', { get() { throw new Error(secret); } });
    client.getBalance.mockRejectedValue(error);
    client.getStock.mockResolvedValue([value]);
    const report = await runDiagnostic(client, { now() { throw new Error(secret); } });
    expect(report.checkedAt).toBeNull();
    expect(report.checks.balance).toEqual({ requestSucceeded: false, httpStatus: null, error: 'PROVIDER_REQUEST_FAILED' });
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it('rejects unconfigured clients before any work', async () => {
    expect(await runDiagnostic(null)).toMatchObject({ configured: false, ok: false, error: { code: 'CLIENT_NOT_CONFIGURED' } });
  });
});

describe('Dopermind diagnostic configuration', () => {
  it('requires a secret before client construction', async () => {
    const clientFactory = vi.fn();
    const log = outputs();
    expect(await runCli({ args: ['--json'], env: {}, readEnvFile: missingFile, clientFactory, ...log })).toBe(1);
    expect(clientFactory).not.toHaveBeenCalled();
    expect(JSON.parse(log.output[0]).error.code).toBe('MISSING_API_KEY');
  });

  it('uses existing environment over dotenv without mutating or printing either secret', async () => {
    const env = { DOPERMIND_API_KEY: secret };
    const clientFactory = vi.fn(mockClient);
    const readEnvFile = vi.fn(() => 'DOPERMIND_API_KEY=file-secret\nOTHER=private-other');
    const log = outputs();
    expect(await runCli({ args: ['--env-file', './protected.env', '--json'], env, readEnvFile, clientFactory, ...log })).toBe(0);
    expect(clientFactory).toHaveBeenCalledExactlyOnceWith({ apiKey: secret });
    expect(readEnvFile).toHaveBeenCalledOnce();
    expect(env).toEqual({ DOPERMIND_API_KEY: secret });
    for (const value of [secret, 'file-secret', 'private-other', '987654321']) expect(log.output.join('')).not.toContain(value);
  });

  it('loads a protected file only when the environment key is absent', async () => {
    const clientFactory = vi.fn(mockClient);
    const log = outputs();
    expect(await runCli({ args: [], env: {}, readEnvFile: () => 'DOPERMIND_API_KEY="file-only-secret"', clientFactory, ...log })).toBe(0);
    expect(clientFactory).toHaveBeenCalledExactlyOnceWith({ apiKey: 'file-only-secret' });
    expect(log.output.join('')).not.toContain('file-only-secret');
  });

  it('does not fall back to a file when the process explicitly disables its key', async () => {
    const clientFactory = vi.fn();
    const log = outputs();
    expect(await runCli({ args: [], env: { DOPERMIND_API_KEY: '' }, readEnvFile: () => 'DOPERMIND_API_KEY=file-secret', clientFactory, ...log })).toBe(1);
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it('fails for explicit unreadable files without their error or path', async () => {
    const clientFactory = vi.fn();
    const log = outputs();
    expect(await runCli({ args: ['--env-file', './private.env', '--json'], env: {}, readEnvFile: missingFile, clientFactory, ...log })).toBe(1);
    expect(clientFactory).not.toHaveBeenCalled();
    expect(log.output.join('')).toContain('ENV_FILE_READ_FAILED');
    expect(log.output.join('')).not.toContain('private-file-detail');
    expect(log.output.join('')).not.toContain('private.env');
  });

  it.each([['--api-key', secret], ['--env-file'], ['--unknown'], ['--env-file', 'a', '--env-file', 'b']])('rejects unsupported args without echoing them %j', async args => {
    const clientFactory = vi.fn();
    const log = outputs();
    expect(await runCli({ args, env: {}, readEnvFile: () => '', clientFactory, ...log })).toBe(1);
    expect(clientFactory).not.toHaveBeenCalled();
    expect(log.output.join('')).toContain('INVALID_ARGUMENTS');
    expect(log.output.join('')).not.toContain(secret);
  });

  it('suppresses client construction failures', async () => {
    const log = outputs();
    const clientFactory = () => { throw new Error(secret); };
    expect(await runCli({ args: ['--json'], env: { DOPERMIND_API_KEY: secret }, readEnvFile: missingFile, clientFactory, ...log })).toBe(1);
    expect(log.output.join('')).toContain('CLIENT_CONFIGURATION_FAILED');
    expect(log.output.join('')).not.toContain(secret);
  });

  it('prints help without reading files or constructing a client', async () => {
    const readEnvFile = vi.fn();
    const clientFactory = vi.fn();
    const log = outputs();
    expect(await runCli({ args: ['--help'], env: {}, readEnvFile, clientFactory, ...log })).toBe(0);
    expect(readEnvFile).not.toHaveBeenCalled();
    expect(clientFactory).not.toHaveBeenCalled();
    expect(log.output.join('')).toContain('DOPERMIND_API_KEY');
  });
});

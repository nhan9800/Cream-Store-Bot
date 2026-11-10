import { describe, expect, it, vi } from 'vitest';
import { describeStructure, formatDiagnosticReport, runCli, runDiagnostic } from '../scripts/check-daiphuc-partner.js';

const account = { data: { account: 'private-account', balance: 987654321, api_key: 'secret-credential', customer: { email: 'customer@private.example' } } };
const products = { products: [{ id: 'private-product-id', price: 123456789, fields: [{ label: 'Customer password', value: 'private-password' }] }] };
const mockClient = () => ({
  getMe: vi.fn().mockResolvedValue(account),
  getProducts: vi.fn().mockResolvedValue(products),
  listOrders: vi.fn(), getOrder: vi.fn(), getOrderLogs: vi.fn(), createOrder: vi.fn(),
});
const missingFile = () => { throw Object.assign(new Error('private file detail'), { code: 'ENOENT' }); };

describe('read-only partner diagnostic', () => {
  it('calls only account and product GETs and reports bounded structural types, never values', async () => {
    const client = mockClient();
    const report = await runDiagnostic(client);
    expect(client.getMe).toHaveBeenCalledExactlyOnceWith();
    expect(client.getProducts).toHaveBeenCalledExactlyOnceWith();
    for (const method of ['listOrders', 'getOrder', 'getOrderLogs', 'createOrder']) expect(client[method]).not.toHaveBeenCalled();
    expect(report).toMatchObject({ readOnly: true, configured: true, authenticated: null, meRequestSucceeded: true, ok: true, schemaMapped: false });
    expect(report.productsShape.fields.products).toMatchObject({ type: 'array', count: 1 });
    for (const output of [formatDiagnosticReport(report), formatDiagnosticReport(report, true)]) {
      expect(output).toContain('api_key');
      expect(output).toContain('balance');
      for (const value of ['private-account', '987654321', 'secret-credential', 'customer@private.example', 'private-product-id', '123456789', 'private-password', 'Customer password']) {
        expect(output).not.toContain(value);
      }
    }
  });

  it('stops after rejected authentication and suppresses arbitrary provider error text/code/body', async () => {
    const client = mockClient();
    client.getMe.mockRejectedValue({ status: 401, code: 'secret-token', message: 'secret-token', body: account });
    const report = await runDiagnostic(client);
    expect(report).toMatchObject({ authenticated: false, ok: false, error: { stage: 'me', code: 'AUTH_REJECTED', httpStatus: 401 } });
    expect(client.getProducts).not.toHaveBeenCalled();
    expect(JSON.stringify(report)).not.toContain('secret-token');
    expect(JSON.stringify(report)).not.toContain('private-account');
  });

  it('retains successful account read when product read fails without assuming authentication', async () => {
    const client = mockClient();
    client.getProducts.mockRejectedValue({ statusCode: 429, message: 'authorization private-secret' });
    const report = await runDiagnostic(client);
    expect(report).toMatchObject({ authenticated: null, meRequestSucceeded: true, ok: false, error: { stage: 'products', code: 'RATE_LIMITED', httpStatus: 429 } });
    expect(JSON.stringify(report)).not.toContain('private-secret');
    expect(report.productsShape).toBeUndefined();
  });

  it('uses a fixed failure code for unknown failures and ignores unsafe status values', async () => {
    const client = mockClient();
    client.getMe.mockRejectedValue({ status: 'private-key', name: 'private-key', message: 'private-key' });
    const report = await runDiagnostic(client);
    expect(report.error).toEqual({ stage: 'me', code: 'PROVIDER_REQUEST_FAILED' });
    expect(JSON.stringify(report)).not.toContain('private-key');
  });

  it('bounds depth, samples, field names and total structure without inspecting array values', () => {
    const large = { items: Array.from({ length: 10000 }, () => ({ secret: 'hidden' })) };
    const shape = describeStructure(large);
    expect(shape.fields.items.count).toBe(10000);
    expect(shape.fields.items.samples).toHaveLength(3);
    expect(shape.fields.items.truncated).toBe(true);
    const cyclic = { 'customer@private.example': 'hidden' };
    cyclic.self = cyclic;
    expect(describeStructure(cyclic)).toMatchObject({ hiddenKeys: 2, fields: { field_2: { truncated: true } } });
    const deep = { data: { data: { data: { data: { data: 'hidden' } } } } };
    expect(describeStructure(deep).fields.data.fields.data.fields.data.fields.data).toMatchObject({ truncated: true });
    const wide = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`field_${i}`, large]));
    const output = JSON.stringify(describeStructure(wide));
    expect(output.length).toBeLessThan(16000);
    expect(output).not.toContain('"hidden"');
  });

  it('hides unknown alphanumeric property names that may themselves contain credentials or handles', () => {
    const value = { secretAlphanumericToken: { customerHandle123: 'private value' }, data: { available: true } };
    const shape = describeStructure(value);
    const output = JSON.stringify(shape);
    expect(output).not.toContain('secretAlphanumericToken');
    expect(output).not.toContain('customerHandle123');
    expect(output).not.toContain('private value');
    expect(shape).toMatchObject({ keyCount: 2, hiddenKeys: 1, fields: { field_1: { hiddenKeys: 1 }, data: { fields: { available: { type: 'boolean' } } } } });
  });

  it('handles unconfigured clients without any network access', async () => {
    expect(await runDiagnostic(null)).toMatchObject({ configured: false, authenticated: false, ok: false, error: { code: 'CLIENT_NOT_CONFIGURED' } });
  });
});

describe('diagnostic CLI configuration', () => {
  it('fails before constructing the client when the secret is missing', async () => {
    const factory = vi.fn();
    const output = [];
    const code = await runCli({ args: ['--json'], env: {}, readEnvFile: missingFile, clientFactory: factory, writeOutput: line => output.push(line) });
    expect(code).toBe(1);
    expect(factory).not.toHaveBeenCalled();
    expect(JSON.parse(output[0]).error.code).toBe('MISSING_API_KEY');
  });

  it('loads an explicit protected dotenv file silently without overriding existing environment', async () => {
    const factory = vi.fn(() => mockClient());
    const env = { DAIPHUC_PARTNER_API_KEY: 'environment-secret' };
    const readEnvFile = vi.fn(() => 'DAIPHUC_PARTNER_API_KEY=file-secret\nUNRELATED_VALUE=do-not-print');
    const output = [];
    const code = await runCli({ args: ['--env-file', './protected.env', '--json'], env, readEnvFile, clientFactory: factory, writeOutput: line => output.push(line) });
    expect(code).toBe(0);
    expect(factory).toHaveBeenCalledExactlyOnceWith({ apiKey: 'environment-secret' });
    expect(env).toEqual({ DAIPHUC_PARTNER_API_KEY: 'environment-secret' });
    expect(readEnvFile).toHaveBeenCalledOnce();
    for (const secret of ['environment-secret', 'file-secret', 'do-not-print', 'private-account']) expect(output.join('')).not.toContain(secret);
  });

  it('uses dotenv credentials when environment is unset, while keeping the file values out of the report', async () => {
    const factory = vi.fn(() => mockClient());
    const output = [];
    expect(await runCli({ args: [], env: {}, readEnvFile: () => 'DAIPHUC_PARTNER_API_KEY="file-only-secret"', clientFactory: factory, writeOutput: line => output.push(line) })).toBe(0);
    expect(factory).toHaveBeenCalledExactlyOnceWith({ apiKey: 'file-only-secret' });
    expect(output.join('')).not.toContain('file-only-secret');
  });

  it('fails closed for explicit unreadable files and never outputs their error messages', async () => {
    const factory = vi.fn();
    const output = [];
    expect(await runCli({ args: ['--env-file', './missing.env', '--json'], env: {}, readEnvFile: missingFile, clientFactory: factory, writeOutput: line => output.push(line) })).toBe(1);
    expect(factory).not.toHaveBeenCalled();
    expect(output.join('')).toContain('ENV_FILE_READ_FAILED');
    expect(output.join('')).not.toContain('private file detail');
  });

  it.each([
    { args: ['--api-key', 'secret-on-cli'] },
    { args: ['--env-file'] },
    { args: ['--unknown'] },
    { args: ['--env-file', 'a.env', '--env-file', 'b.env'] },
  ])('rejects unsupported arguments without echoing them: $args', async ({ args }) => {
    const factory = vi.fn();
    const output = [];
    expect(await runCli({ args, env: {}, readEnvFile: () => '', clientFactory: factory, writeOutput: line => output.push(line) })).toBe(1);
    expect(factory).not.toHaveBeenCalled();
    expect(output.join('')).toContain('INVALID_ARGUMENTS');
    expect(output.join('')).not.toContain('secret-on-cli');
  });

  it('does not echo a constructor failure containing credentials', async () => {
    const output = [];
    const factory = () => { throw new Error('environment-secret'); };
    expect(await runCli({ args: ['--json'], env: { DAIPHUC_PARTNER_API_KEY: 'environment-secret' }, readEnvFile: missingFile, clientFactory: factory, writeOutput: line => output.push(line) })).toBe(1);
    expect(output.join('')).toContain('CLIENT_CONFIGURATION_FAILED');
    expect(output.join('')).not.toContain('environment-secret');
  });
});

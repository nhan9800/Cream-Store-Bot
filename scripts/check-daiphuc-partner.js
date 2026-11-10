import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const ENV_NAME = 'DAIPHUC_PARTNER_API_KEY';
const DEFAULT_ENV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
const MAX_DEPTH = 4;
const MAX_NODES = 120;
const MAX_KEYS = 20;
const MAX_ARRAY_SAMPLES = 3;
const STRUCTURAL_FIELD_NAMES = new Set([
  'data', 'products', 'product', 'items', 'item', 'results', 'result',
  'id', 'name', 'title', 'description', 'type', 'status', 'success', 'ok',
  'error', 'errors', 'code', 'message', 'meta', 'pagination', 'page', 'limit',
  'total', 'count', 'price', 'cost', 'currency', 'stock', 'quantity', 'available',
  'active', 'enabled', 'fields', 'label', 'value', 'required', 'options',
  'account', 'user', 'customer', 'shop', 'balance', 'email', 'username',
  'api_key', 'apiKey', 'key_id', 'keyId', 'token', 'permissions', 'scopes',
  'created_at', 'createdAt', 'updated_at', 'updatedAt', 'expires_at', 'expiresAt',
  'product_id', 'productId', 'category', 'categories', 'duration', 'warranty',
]);

// Values, error messages and response bodies must never reach the report.
// Dynamic dictionary keys (including alphanumeric tokens/handles) are hidden.
// This vocabulary is presentation-only, not an assumed provider schema.
export function describeStructure(value) {
  let remaining = MAX_NODES;
  const visited = new WeakSet();
  const describe = (item, depth) => {
    if (--remaining < 0) return { type: 'omitted', reason: 'node_limit' };
    if (item === null) return { type: 'null' };
    const type = Array.isArray(item) ? 'array' : typeof item;
    if (!['array', 'object'].includes(type)) return { type };
    if (visited.has(item)) return { type, truncated: true };
    visited.add(item);
    if (type === 'array') {
      const shape = { type, count: item.length };
      if (depth >= MAX_DEPTH || remaining <= 0) return { ...shape, truncated: true };
      shape.samples = item.slice(0, MAX_ARRAY_SAMPLES).map(child => describe(child, depth + 1));
      if (item.length > shape.samples.length) shape.truncated = true;
      return shape;
    }
    const entries = Object.entries(item);
    const shape = { type, keyCount: entries.length };
    if (depth >= MAX_DEPTH || remaining <= 0) return { ...shape, truncated: true };
    shape.fields = Object.create(null);
    let hiddenKeys = 0;
    for (const [index, [key, child]] of entries.slice(0, MAX_KEYS).entries()) {
      const publicKey = STRUCTURAL_FIELD_NAMES.has(key) ? key : `field_${index + 1}`;
      if (publicKey !== key) hiddenKeys += 1;
      shape.fields[publicKey] = describe(child, depth + 1);
      if (remaining <= 0) break;
    }
    if (hiddenKeys) shape.hiddenKeys = hiddenKeys;
    if (entries.length > MAX_KEYS || remaining <= 0) shape.truncated = true;
    return shape;
  };
  return describe(value, 0);
}

function safeFailure(error, stage) {
  // Only standardized numeric HTTP statuses are inspected. Provider codes and
  // messages may echo Authorization headers, URLs or customer payloads.
  const status = error?.status ?? error?.statusCode;
  const httpStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : null;
  const code = httpStatus === 401 || httpStatus === 403 ? 'AUTH_REJECTED'
    : httpStatus === 429 ? 'RATE_LIMITED'
      : 'PROVIDER_REQUEST_FAILED';
  return { stage, code, ...(httpStatus ? { httpStatus } : {}) };
}

export async function runDiagnostic(client) {
  const report = {
    provider: 'daiphuc',
    readOnly: true,
    configured: Boolean(client),
    authenticated: false,
    meRequestSucceeded: false,
    ok: false,
    schemaMapped: false,
  };
  if (!client || typeof client.getMe !== 'function' || typeof client.getProducts !== 'function') {
    return { ...report, error: { stage: 'configuration', code: 'CLIENT_NOT_CONFIGURED' } };
  }
  try {
    const account = await client.getMe();
    // HTTP success alone cannot validate an undocumented success/error envelope.
    report.authenticated = null;
    report.meRequestSucceeded = true;
    report.accountShape = describeStructure(account);
  } catch (error) {
    return { ...report, error: safeFailure(error, 'me') };
  }
  try {
    report.productsShape = describeStructure(await client.getProducts());
    report.ok = true;
  } catch (error) {
    report.error = safeFailure(error, 'products');
  }
  return report;
}

export function formatDiagnosticReport(report, json = false) {
  if (json) return JSON.stringify(report, null, 2);
  const lines = [
    'DaiPhuc Partner API — read-only diagnostic',
    `Configured: ${report.configured ? 'yes' : 'no'}`,
    `Authentication: ${report.authenticated === true ? 'confirmed' : 'not confirmed'}`,
    `GET /me request: ${report.meRequestSucceeded ? 'succeeded' : 'not confirmed'}`,
    `Result: ${report.ok ? 'OK' : 'FAILED'}`,
    'Schema/currency/pricing mapping: not verified',
  ];
  if (report.error) lines.push(`Error: ${report.error.stage} / ${report.error.code}${report.error.httpStatus ? ` / HTTP ${report.error.httpStatus}` : ''}`);
  if (report.accountShape) lines.push(`Account structure: ${JSON.stringify(report.accountShape)}`);
  if (report.productsShape) lines.push(`Product structure: ${JSON.stringify(report.productsShape)}`);
  return lines.join('\n');
}

function configurationFailure(code) {
  return {
    provider: 'daiphuc', readOnly: true, configured: false,
    authenticated: false, meRequestSucceeded: false, ok: false, schemaMapped: false,
    error: { stage: 'configuration', code },
  };
}

/** No credential CLI argument is accepted. Existing environment wins over file. */
export async function runCli({
  args = process.argv.slice(2),
  env = process.env,
  readEnvFile = path => readFileSync(path, 'utf8'),
  clientFactory = null,
  writeOutput = line => process.stdout.write(`${line}\n`),
} = {}) {
  let json = false;
  let envPath = DEFAULT_ENV_PATH;
  let explicitEnv = false;
  const emit = report => {
    writeOutput(formatDiagnosticReport(report, json));
    return report.ok ? 0 : 1;
  };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--json') json = true;
    else if (args[index] === '--env-file' && args[index + 1] && !args[index + 1].startsWith('--')) {
      if (explicitEnv) return emit(configurationFailure('INVALID_ARGUMENTS'));
      envPath = resolve(args[++index]);
      explicitEnv = true;
    } else if (args[index] === '--help' && args.length === 1) {
      writeOutput('Usage: node scripts/check-daiphuc-partner.js [--env-file <protected path>] [--json]\nReads only /me and /products. Credentials must be in DAIPHUC_PARTNER_API_KEY; never pass a key as an argument.');
      return 0;
    } else return emit(configurationFailure('INVALID_ARGUMENTS'));
  }

  let fileEnv = {};
  try {
    // parse() is silent and never mutates process.env (equivalent to override:false).
    fileEnv = dotenv.parse(readEnvFile(envPath));
  } catch (error) {
    if (explicitEnv || error?.code !== 'ENOENT') return emit(configurationFailure('ENV_FILE_READ_FAILED'));
  }
  const apiKey = String(env[ENV_NAME] ?? fileEnv[ENV_NAME] ?? '').trim();
  if (!apiKey) return emit(configurationFailure('MISSING_API_KEY'));
  try {
    const createClient = clientFactory || (await import('../src/services/daiphucPartnerClient.js')).createDaiphucPartnerClient;
    const report = await runDiagnostic(createClient({ apiKey }));
    return emit(report);
  } catch {
    return emit(configurationFailure('CLIENT_CONFIGURATION_FAILED'));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runCli();
}

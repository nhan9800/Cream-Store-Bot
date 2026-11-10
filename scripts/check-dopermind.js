import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const ENV_NAME = 'DOPERMIND_API_KEY';
const DEFAULT_ENV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env');
const MAX_PRODUCTS = 5000;

function baseReport(configured, now = Date.now) {
  let checkedAt = null;
  try {
    const time = now();
    if (Number.isSafeInteger(time) && time >= 0 && time <= 8640000000000000) checkedAt = new Date(time).toISOString();
  } catch { /* A clock failure must not expose arbitrary exception text. */ }
  return {
    provider: 'dopermind', readOnly: true, purchasesEnabled: false,
    configured, authenticated: false, ok: false, schemaMapped: false, checkedAt,
  };
}

function safeFailure(error) {
  // Never trust provider error names/messages/codes, response bodies or keys.
  let httpStatus = null;
  try {
    const status = error?.status;
    if (Number.isInteger(status) && status >= 400 && status <= 599) httpStatus = status;
  } catch { /* Hostile accessors remain a constant failure. */ }
  const code = [401, 403].includes(httpStatus) ? 'AUTH_REJECTED'
    : httpStatus === 429 ? 'RATE_LIMITED' : 'PROVIDER_REQUEST_FAILED';
  return { requestSucceeded: false, httpStatus, error: code };
}

function invalidResponse() {
  return { requestSucceeded: false, httpStatus: 200, error: 'INVALID_RESPONSE' };
}

function balanceIsValid(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && value.currency === 'VND' && Number.isSafeInteger(value.balanceVnd) && value.balanceVnd >= 0;
}

function stockIsValid(products) {
  return Array.isArray(products) && products.length <= MAX_PRODUCTS && products.every(product =>
    product !== null && typeof product === 'object' && !Array.isArray(product)
    && typeof product.unlimited === 'boolean' && Number.isSafeInteger(product.stock)
    && (product.unlimited ? product.stock === -1 || product.stock >= 0 : product.stock >= 0));
}

/** Exactly two read methods; no balance amount, product field or paid operation is reported. */
export async function runDiagnostic(client, { now = Date.now } = {}) {
  const report = baseReport(Boolean(client), now);
  if (!client || typeof client.getBalance !== 'function' || typeof client.getStock !== 'function') {
    return { ...report, error: { stage: 'configuration', code: 'CLIENT_NOT_CONFIGURED' } };
  }
  const results = await Promise.allSettled([
    Promise.resolve().then(() => client.getBalance()),
    Promise.resolve().then(() => client.getStock()),
  ]);
  const checks = {};
  let productCount = null;
  let availableCount = null;
  for (const [index, name] of ['balance', 'stock'].entries()) {
    const result = results[index];
    if (result.status === 'rejected') {
      checks[name] = safeFailure(result.reason);
      continue;
    }
    try {
      const valid = name === 'balance' ? balanceIsValid(result.value) : stockIsValid(result.value);
      if (!valid) {
        checks[name] = invalidResponse();
        continue;
      }
      checks[name] = { requestSucceeded: true, httpStatus: 200, error: null };
      if (name === 'stock') {
        productCount = result.value.length;
        availableCount = result.value.filter(product => product.unlimited || product.stock > 0).length;
      }
    } catch {
      checks[name] = invalidResponse();
    }
  }
  const ok = Object.values(checks).every(check => check.requestSucceeded);
  return {
    ...report, authenticated: checks.balance.requestSucceeded,
    ok, schemaMapped: ok, checks,
    ...(checks.balance.requestSucceeded ? { currency: 'VND' } : {}),
    ...(productCount !== null ? { productCount, availableCount } : {}),
  };
}

export function formatDiagnosticReport(report, json = false) {
  if (json) return JSON.stringify(report, null, 2);
  const lines = [
    'Dopermind API — read-only diagnostic',
    `Configured: ${report.configured ? 'yes' : 'no'}`,
    `Authentication: ${report.authenticated ? 'confirmed' : 'not confirmed'}`,
    `Result: ${report.ok ? 'OK' : 'FAILED'}`,
    'Purchases: disabled',
  ];
  if (report.checkedAt) lines.push(`Checked: ${report.checkedAt}`);
  if (report.currency) lines.push('Currency: VND');
  if (Number.isInteger(report.productCount)) lines.push(`Products: ${report.productCount}; available: ${report.availableCount}`);
  for (const [name, check] of Object.entries(report.checks || {})) {
    lines.push(`${name}: ${check.requestSucceeded ? 'OK' : check.error}${check.httpStatus ? ` / HTTP ${check.httpStatus}` : ''}`);
  }
  if (report.error) lines.push(`Error: ${report.error.stage} / ${report.error.code}`);
  return lines.join('\n');
}

function configurationFailure(code) {
  return { ...baseReport(false), error: { stage: 'configuration', code } };
}

/** Secrets are accepted only through the process environment or protected dotenv file. */
export async function runCli({
  args = process.argv.slice(2), env = process.env,
  readEnvFile = path => readFileSync(path, 'utf8'), clientFactory = null,
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
      writeOutput('Usage: node scripts/check-dopermind.js [--env-file <protected path>] [--json]\nReads only /v1/balance and /v1/stock. Use DOPERMIND_API_KEY; never pass credentials as arguments.');
      return 0;
    } else return emit(configurationFailure('INVALID_ARGUMENTS'));
  }
  let fileEnv = {};
  try {
    fileEnv = dotenv.parse(readEnvFile(envPath));
  } catch (error) {
    if (explicitEnv || error?.code !== 'ENOENT') return emit(configurationFailure('ENV_FILE_READ_FAILED'));
  }
  const rawKey = env[ENV_NAME] ?? fileEnv[ENV_NAME];
  const apiKey = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!apiKey) return emit(configurationFailure('MISSING_API_KEY'));
  try {
    const createClient = clientFactory || (await import('../src/services/dopermindClient.js')).createDopermindClient;
    return emit(await runDiagnostic(createClient({ apiKey })));
  } catch {
    return emit(configurationFailure('CLIENT_CONFIGURATION_FAILED'));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runCli();
}

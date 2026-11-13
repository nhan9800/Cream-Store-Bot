import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { db } from '../database/db.js';
import { config } from '../config.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { createDopermindClient } from './dopermindClient.js';
import { createCdkVietnamClient } from './cdkVietnamClient.js';
import { getGuildConfig } from './guildConfigService.js';
import { isManager } from '../utils/permissions.js';
import { configuredSupplierProvider, isSupplierProvider, supplierProviderForProductKey } from '../utils/supplierProvider.js';

const MAX_TOTAL = 100_000_000;
const NO_PROFILE = 'Tài khoản hoặc mã kích hoạt theo mô tả sản phẩm';
export class SupplierCatalogError extends Error {
  constructor(code) { super('Sản phẩm hoặc báo giá chưa khả dụng. Vui lòng chọn lại hoặc liên hệ shop.'); this.name = 'SupplierCatalogError'; this.code = code; }
}
const fail = code => { throw new SupplierCatalogError(code); };
const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
const dateMs = value => typeof value === 'string' ? Date.parse(value) : NaN;
const validText = (s, max = 1000) => typeof s === 'string' && s.trim() && s.length <= max && !/[\u0000-\u001f\u007f]/.test(s);

export function supplierSalesConfigured(env = process.env, guildId = config.guildId, provider = configuredSupplierProvider(env)) {
  if (guildId !== STORE_ONE_GUILD_ID || env.ENV_FILE !== '.env' || env.SUPPLIER_AUTOBUY_ENABLED !== 'true') return false;
  if (provider === 'dopermind') return typeof env.DOPERMIND_API_KEY === 'string' && Boolean(env.DOPERMIND_API_KEY.trim());
  if (provider === 'cdkvietnam') return typeof env.CDKVIETNAM_API_KEY === 'string' && Boolean(env.CDKVIETNAM_API_KEY.trim());
  return false;
}

function activeProvider(env = process.env) {
  return configuredSupplierProvider(env) || 'dopermind';
}

function configuredClientFactory(env = process.env, provider = activeProvider(env)) {
  return provider === 'cdkvietnam'
    ? () => createCdkVietnamClient({ apiKey: env.CDKVIETNAM_API_KEY })
    : () => createDopermindClient({ apiKey: env.DOPERMIND_API_KEY });
}

function durationFromPolicy(policy) {
  if (integer(policy.durationDays, 1)) return { durationDays: policy.durationDays, durationMonths: 0 };
  if (integer(policy.durationMonths, 1)) return { durationMonths: policy.durationMonths, durationDays: null };
  const label = String(policy.termLabel || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const match = /^(\d+)\s*(ngay|tuan|thang|nam)\b/.exec(label);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!integer(amount, 1) || amount > 3650) return null;
  if (match[2] === 'ngay' || match[2] === 'tuan') return { durationDays: amount * (match[2] === 'tuan' ? 7 : 1), durationMonths: 0 };
  return { durationMonths: amount * (match[2] === 'nam' ? 12 : 1), durationDays: null };
}

/** Trusted reviewed policy + live integer VND cost. No invented official discount. */
export function priceSupplierProduct(product, policy, manifest, { nowMs = Date.now(), override = null } = {}) {
  const reject = reason => ({ ok: false, reason });
  if (product?.locked === true) return reject('SOURCE_LOCKED');
  if (policy?.enabled !== true) return reject(policy?.reason || 'NOT_REVIEWED');
  if (!validText(product?.productKey, 200) || product.productKey !== policy.productKey
    || product.name !== policy.expectedName || !integer(product.priceVnd, 1)
    || (policy.deliveryMode && product.delivery !== policy.deliveryMode)) return reject('SOURCE_CHANGED');
  const reference = manifest?.references?.[policy.referenceId];
  if (!reference || !['EXACT', 'BENCHMARK'].includes(reference.kind)) return reject('REFERENCE_UNVERIFIED');
  try { const url = new URL(reference.url); if (url.protocol !== 'https:' || url.username || url.password) return reject('REFERENCE_UNVERIFIED'); }
  catch { return reject('REFERENCE_UNVERIFIED'); }
  const checked = dateMs(reference.checkedAt);
  const maxAge = Number(manifest.referenceMaxAgeDays || 30) * 86400000;
  if (!Number.isFinite(checked) || checked > nowMs + 300000 || !Number.isFinite(maxAge)
    || maxAge < 86400000 || maxAge > 90 * 86400000 || nowMs - checked >= maxAge) return reject('REFERENCE_STALE');
  const cap = policy.referenceCapVnd ?? reference.referenceCapVnd;
  const defaults = manifest.pricingDefaults || {};
  const bps = defaults.feeReserveBps;
  const minimum = defaults.minProfitVnd;
  const step = defaults.roundToVnd;
  if (!integer(cap, 1) || !integer(bps) || bps >= 10000 || !integer(minimum, 1)
    || !integer(step, 1) || step > 10000 || !integer(policy.markupVnd, minimum) || !integer(policy.reserveVnd)) return reject('INVALID_PRICING_POLICY');
  const duration = durationFromPolicy(policy);
  if (!duration || !validText(policy.warrantyLabel) || !validText(policy.accountForm || NO_PROFILE)) return reject('TERMS_UNVERIFIED');
  const cost = BigInt(product.priceVnd), reserve = BigInt(policy.reserveVnd), rate = BigInt(bps), scale = 10000n;
  const raw = ((cost + BigInt(policy.markupVnd) + reserve) * scale + (scale - rate) - 1n) / (scale - rate);
  const round = BigInt(step);
  const calculated = ((raw + round - 1n) / round) * round;
  if (override && !integer(override.price_vnd, 1)) return reject('INVALID_OVERRIDE');
  const sale = override ? BigInt(override.price_vnd) : calculated;
  const feeReserve = (sale * rate + 9999n) / 10000n;
  const net = sale - cost - reserve - feeReserve;
  if (sale > BigInt(MAX_TOTAL) || sale <= 0n || sale >= BigInt(cap) || net < BigInt(minimum)) return reject('NO_PROFITABLE_PRICE');
  return {
    ok: true, priceVnd: Number(sale), unitPriceVnd: Number(sale), unitCostVnd: product.priceVnd,
    reserveVnd: policy.reserveVnd, feeReserveVnd: Number(feeReserve), netProfitVnd: Number(net), minProfitVnd: minimum,
    referenceKind: reference.kind, referenceUrl: reference.url, referenceCapVnd: cap,
    comparisonDisclosure: String(policy.comparisonDisclosure || reference.notes || 'Giá tham chiếu là gói chính hãng; thời hạn và hình thức có thể khác.'),
    termLabel: policy.termLabel, warrantyLabel: policy.warrantyLabel, accountForm: policy.accountForm || NO_PROFILE,
    category: policy.category || 'Công cụ khác', ...duration, overrideRevision: override?.revision || 'automatic',
  };
}

export function createSupplierAutobuyCatalog({
  policy, database = db, clientFactory = createDopermindClient, now = Date.now,
  enabled = () => supplierSalesConfigured(), ttlMs = 30000, minimumRefreshMs = 2000,
} = {}) {
  if (!policy || !Array.isArray(policy.products) || !validText(policy.version, 100)
    || typeof clientFactory !== 'function' || typeof now !== 'function' || typeof enabled !== 'function') throw new SupplierCatalogError('INVALID_CONFIGURATION');
  const policies = new Map();
  for (const item of policy.products) {
    if (!validText(item?.productKey, 200) || policies.has(item.productKey)) throw new SupplierCatalogError('INVALID_CONFIGURATION');
    policies.set(item.productKey, item);
  }
  let initialized = false, products = [], checkedAtMs = 0, flight = null, reviewedRows = [];
  let productsByKey = new Map(), sourceRevision = 0, readModel = null, readOverridesStatement;
  let status = 'NOT_STARTED', availableCount = 0, reviewedCount = 0;
  let coverage = { sourceCount: 0, blockedCount: 0, unreviewedCount: 0, outOfStockCount: 0,
    lockedCount: 0, manualDeliveryCount: 0, policyCount: policies.size, blockedReasons: {} };
  const safeReasons = new Set(['NOT_REVIEWED', 'SOURCE_LOCKED', 'SOURCE_CHANGED', 'REFERENCE_UNVERIFIED',
    'REFERENCE_STALE', 'INVALID_PRICING_POLICY', 'TERMS_UNVERIFIED', 'INVALID_OVERRIDE', 'NO_PROFITABLE_PRICE',
    'SUPPLIER_DURATION_UNCONFIRMED', 'SUPPLIER_ACTIVATION_UNCONFIRMED']);
  function initialize() {
    if (initialized) return;
    database.exec(`CREATE TABLE IF NOT EXISTS supplier_autobuy_price_overrides (
      product_key TEXT PRIMARY KEY, price_vnd INTEGER NOT NULL CHECK(price_vnd>0), revision TEXT NOT NULL,
      actor_id TEXT NOT NULL, updated_at TEXT NOT NULL
    ); CREATE TABLE IF NOT EXISTS supplier_autobuy_price_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_key TEXT NOT NULL, old_price_vnd INTEGER,
      new_price_vnd INTEGER NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL
    );`);
    readOverridesStatement = database.prepare('SELECT product_key,price_vnd,revision FROM supplier_autobuy_price_overrides ORDER BY product_key');
    initialized = true;
  }
  function guard() { if (!enabled()) fail('AUTOBUY_DISABLED'); }
  async function refresh(force = false) {
    guard();
    if (flight) return flight;
    const age = now() - checkedAtMs;
    if (status === 'READY' && checkedAtMs && age >= 0 && age < (force ? minimumRefreshMs : ttlMs)) return;
    flight = Promise.resolve().then(async () => {
      const rows = await clientFactory().getStock();
      if (!Array.isArray(rows)) fail('SUPPLIER_UNAVAILABLE');
      const indexed = new Map();
      for (const row of rows) {
        if (!validText(row?.productKey, 200) || indexed.has(row.productKey)) fail('SUPPLIER_UNAVAILABLE');
        indexed.set(row.productKey, Object.freeze({ ...row }));
      }
      productsByKey = indexed;
      products = [...indexed.values()];
      sourceRevision++; readModel = null;
      checkedAtMs = now();
      status = 'READY';
    }).catch(() => { status = 'UNAVAILABLE'; fail('SUPPLIER_UNAVAILABLE'); }).finally(() => { flight = null; });
    return flight;
  }
  function readOverrides() {
    initialize();
    // One live batch read also catches same-connection or external edits that
    // bypass this service, including a changed price with an unchanged revision.
    const rows = readOverridesStatement.all();
    return { byKey: new Map(rows.map(row => [row.product_key, row])), signature: JSON.stringify(rows) };
  }
  function nextReferenceBoundary(nowMs) {
    let boundary = Infinity;
    const maxAge = Number(policy.referenceMaxAgeDays || 30) * 86400000;
    for (const reference of Object.values(policy.references || {})) {
      const checked = dateMs(reference.checkedAt);
      for (const instant of [checked - 300000, checked + maxAge]) {
        if (Number.isFinite(instant) && instant > nowMs) boundary = Math.min(boundary, instant);
      }
    }
    return boundary;
  }
  function currentReadModel(overrides) {
    const nowMs = now();
    if (readModel && readModel.sourceRevision === sourceRevision && readModel.overrideSignature === overrides.signature
      && nowMs >= readModel.builtAt && nowMs < readModel.validUntil) return readModel;
    const rows = products.map(product => ({ product,
      price: priceSupplierProduct(product, policies.get(product.productKey), policy, { nowMs, override: overrides.byKey.get(product.productKey) }) }));
    reviewedRows = rows;
    const offers = rows.filter(row => row.price.ok).map(({ product, price }) => ({
      productKey: product.productKey, name: product.name, priceVnd: price.priceVnd, unitPriceVnd: price.priceVnd,
      available: product.unlimited || product.stock > 0, stock: product.stock, unlimited: product.unlimited,
      category: price.category, termLabel: price.termLabel, warrantyLabel: price.warrantyLabel, accountForm: price.accountForm,
      comparisonDisclosure: price.comparisonDisclosure, referenceKind: price.referenceKind, referenceUrl: price.referenceUrl,
    }));
    reviewedCount = offers.length;
    availableCount = offers.filter(offer => offer.available).length;
    const blockedReasons = {};
    for (const row of rows.filter(row => !row.price.ok)) {
      const reason = safeReasons.has(row.price.reason) ? row.price.reason : 'POLICY_EXCLUDED';
      blockedReasons[reason] = (blockedReasons[reason] || 0) + 1;
    }
    coverage = { sourceCount: rows.length, blockedCount: rows.length - offers.length,
      unreviewedCount: rows.filter(row => !policies.has(row.product.productKey)).length,
      outOfStockCount: offers.filter(offer => !offer.available).length,
      lockedCount: products.filter(product => product.locked === true).length,
      manualDeliveryCount: products.filter(product => product.delivery === 'manual').length,
      policyCount: policies.size, blockedReasons };
    readModel = { sourceRevision, overrideSignature: overrides.signature, builtAt: nowMs,
      validUntil: nextReferenceBoundary(nowMs), offers: offers.map(offer => Object.freeze(offer)) };
    return readModel;
  }
  async function getOffers({ force = false } = {}) {
    await refresh(force);
    const model = currentReadModel(readOverrides());
    return { status: 'READY', checkedAt: new Date(checkedAtMs).toISOString(), offers: model.offers.map(offer => ({ ...offer })),
      ...coverage, blockedReasons: { ...coverage.blockedReasons } };
  }
  async function getQuote(productKey, quantity = 1, { force = false } = {}) {
    if (!validText(productKey, 200) || !integer(quantity, 1) || quantity > 10) fail('INVALID_QUANTITY');
    await refresh(force);
    const product = productsByKey.get(productKey);
    if (!product) fail('PRODUCT_UNAVAILABLE');
    const price = priceSupplierProduct(product, policies.get(productKey), policy,
      { nowMs: now(), override: readOverrides().byKey.get(productKey) });
    if (!price.ok) fail(price.reason);
    if (!product.unlimited && product.stock < quantity) fail('OUT_OF_STOCK');
    if (price.priceVnd * quantity > MAX_TOTAL) fail('INVALID_AMOUNT');
    const terms = { productKey, productName: product.name, quantity, unitPriceVnd: price.priceVnd,
      totalPriceVnd: price.priceVnd * quantity, unitCostVnd: product.priceVnd, totalCostVnd: product.priceVnd * quantity,
      maxUnitCostVnd: product.priceVnd, pricingVersion: `${policy.version}:${price.overrideRevision}`,
      warrantyText: price.warrantyLabel, termText: price.termLabel, accountForm: price.accountForm,
      category: price.category, durationDays: price.durationDays, durationMonths: price.durationMonths,
      feeReserveVnd: price.feeReserveVnd, minProfitVnd: price.minProfitVnd,
      comparisonDisclosure: price.comparisonDisclosure };
    return { ok: true, ...terms, termsFingerprint: createHash('sha256').update(JSON.stringify(terms)).digest('hex'),
      createdAt: new Date(now()).toISOString(), checkedAt: new Date(checkedAtMs).toISOString(),
      expiresAt: new Date(Math.min(now() + 120000, checkedAtMs + 60000)).toISOString() };
  }
  async function setPriceOverride({ guildId, productKey, priceVnd, actorId, authorized = false } = {}) {
    guard();
    if (guildId !== STORE_ONE_GUILD_ID || !authorized || !/^\d{17,20}$/.test(String(actorId || ''))) fail('ACCESS_DENIED');
    if (!integer(priceVnd, 1) || priceVnd > MAX_TOTAL) fail('INVALID_AMOUNT');
    await refresh(true);
    const product = productsByKey.get(productKey);
    if (!product || !priceSupplierProduct(product, policies.get(productKey), policy, { nowMs: now() }).ok) fail('PRODUCT_UNAVAILABLE');
    const price = priceSupplierProduct(product, policies.get(productKey), policy, { nowMs: now(), override: { price_vnd: priceVnd } });
    if (!price.ok) fail(price.reason);
    initialize();
    const revision = randomUUID(), timestamp = new Date(now()).toISOString();
    database.transaction(() => {
      const old = database.prepare('SELECT price_vnd FROM supplier_autobuy_price_overrides WHERE product_key=?').get(productKey);
      database.prepare(`INSERT INTO supplier_autobuy_price_overrides (product_key,price_vnd,revision,actor_id,updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(product_key) DO UPDATE SET price_vnd=excluded.price_vnd,revision=excluded.revision,actor_id=excluded.actor_id,updated_at=excluded.updated_at`)
        .run(productKey, priceVnd, revision, actorId, timestamp);
      database.prepare('INSERT INTO supplier_autobuy_price_events (product_key,old_price_vnd,new_price_vnd,actor_id,created_at) VALUES (?,?,?,?,?)')
        .run(productKey, old?.price_vnd ?? null, priceVnd, actorId, timestamp);
    }).immediate();
    readModel = null;
    return { productKey, priceVnd, revision };
  }
  function getHealth() { return Object.freeze({ enabled: Boolean(enabled()), status, reviewedCount, availableCount,
    checkedAt: checkedAtMs ? new Date(checkedAtMs).toISOString() : null, pricingVersion: policy.version,
    reviewRevision: typeof policy.reviewRevision === 'string' ? policy.reviewRevision : null,
    ...coverage, blockedReasons: Object.freeze({ ...coverage.blockedReasons }) }); }
  // Operator-only cached source metadata. Never include this in public health.
  // It does not refresh the supplier, read credentials, expose costs or mutate DB.
  function getReviewSnapshot() {
    return { status, pricingVersion: policy.version, products: reviewedRows.map(({ product, price }) => ({
      productKey: product.productKey, name: product.name, delivery: product.delivery || null,
      nameEn: typeof product.nameEn === 'string' ? product.nameEn : null,
      type: typeof product.type === 'string' ? product.type : null,
      locked: product.locked === true, description: product.description || null,
      stock: product.stock, unlimited: product.unlimited === true,
      reviewReason: price.ok ? (product.unlimited || product.stock > 0 ? 'SELLABLE' : 'OUT_OF_STOCK')
        : safeReasons.has(price.reason) ? price.reason : 'POLICY_EXCLUDED',
    })) };
  }
  return Object.freeze({ getOffers, getQuote, setPriceOverride, getHealth, getReviewSnapshot });
}

const catalogs = new Map();
function catalog(provider = activeProvider()) {
  if (!isSupplierProvider(provider)) fail('INVALID_PROVIDER');
  if (!catalogs.has(provider)) {
    const policyFile = provider === 'cdkvietnam' ? 'cdkVietnamAutobuyPricingPolicy.json' : 'supplierAutobuyPricingPolicy.json';
    const policy = JSON.parse(readFileSync(new URL(`../data/${policyFile}`, import.meta.url), 'utf8'));
    catalogs.set(provider, createSupplierAutobuyCatalog({ policy, clientFactory: configuredClientFactory(process.env, provider),
      enabled: () => supplierSalesConfigured(process.env, config.guildId, provider) }));
  }
  return catalogs.get(provider);
}
export const getSupplierOffers = async (options = {}) => {
  const provider = options.provider ?? activeProvider();
  return { ...await catalog(provider).getOffers(options), provider };
};
export const getSupplierQuote = async (key, quantity, options = {}) => {
  const provider = options.provider ?? supplierProviderForProductKey(key);
  if (!provider || supplierProviderForProductKey(key) !== provider) fail('PROVIDER_MISMATCH');
  return { ...await catalog(provider).getQuote(key, quantity, options), provider };
};
export function getSupplierCatalogHealth(provider = activeProvider()) {
  if (!isSupplierProvider(provider)) fail('INVALID_PROVIDER');
  if (!catalogs.has(provider)) return { provider, enabled: supplierSalesConfigured(process.env, config.guildId, provider), status: 'NOT_STARTED', reviewedCount: 0, availableCount: 0, checkedAt: null };
  return { ...catalogs.get(provider).getHealth(), provider };
}
export function getSupplierCatalogReviewSnapshot(provider = activeProvider()) {
  if (!isSupplierProvider(provider)) fail('INVALID_PROVIDER');
  return { provider, ...(catalogs.has(provider) ? catalogs.get(provider).getReviewSnapshot() : { status: 'NOT_STARTED', products: [] }) };
}
export async function setSupplierPriceOverride({ guildId, productKey, priceVnd, actorId, client, provider } = {}) {
  const source = supplierProviderForProductKey(productKey);
  if (!source || (provider !== undefined && provider !== source)) fail('PROVIDER_MISMATCH');
  if (guildId !== STORE_ONE_GUILD_ID || !client?.guilds) fail('ACCESS_DENIED');
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const member = await guild?.members.fetch({ user: actorId, force: true }).catch(() => null);
  if (!isManager(member, getGuildConfig(guildId))) fail('ACCESS_DENIED');
  return catalog(source).setPriceOverride({ guildId, productKey, priceVnd, actorId, authorized: true });
}

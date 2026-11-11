import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { db } from '../database/db.js';
import { config } from '../config.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { createDopermindClient } from './dopermindClient.js';
import { createCdkVietnamClient } from './cdkVietnamClient.js';
import { getGuildConfig } from './guildConfigService.js';
import { isManager } from '../utils/permissions.js';

const MAX_TOTAL = 100_000_000;
const NO_PROFILE = 'Tài khoản hoặc mã kích hoạt theo mô tả sản phẩm';
export class SupplierCatalogError extends Error {
  constructor(code) { super('Sản phẩm hoặc báo giá chưa khả dụng. Vui lòng chọn lại hoặc liên hệ shop.'); this.name = 'SupplierCatalogError'; this.code = code; }
}
const fail = code => { throw new SupplierCatalogError(code); };
const integer = (n, min = 0) => Number.isSafeInteger(n) && n >= min;
const dateMs = value => typeof value === 'string' ? Date.parse(value) : NaN;
const validText = (s, max = 1000) => typeof s === 'string' && s.trim() && s.length <= max && !/[\u0000-\u001f\u007f]/.test(s);

export function supplierSalesConfigured(env = process.env, guildId = config.guildId) {
  if (guildId !== STORE_ONE_GUILD_ID || env.ENV_FILE !== '.env' || env.SUPPLIER_AUTOBUY_ENABLED !== 'true') return false;
  if (env.SUPPLIER_AUTOBUY_PROVIDER === 'dopermind') return typeof env.DOPERMIND_API_KEY === 'string' && Boolean(env.DOPERMIND_API_KEY.trim());
  if (env.SUPPLIER_AUTOBUY_PROVIDER === 'cdkvietnam') return typeof env.CDKVIETNAM_API_KEY === 'string' && Boolean(env.CDKVIETNAM_API_KEY.trim());
  return false;
}

function activeProvider(env = process.env) {
  return env.SUPPLIER_AUTOBUY_PROVIDER === 'cdkvietnam' ? 'cdkvietnam' : 'dopermind';
}

function configuredClientFactory(env = process.env) {
  return activeProvider(env) === 'cdkvietnam'
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
  let initialized = false, products = [], checkedAtMs = 0, flight = null;
  let status = 'NOT_STARTED', availableCount = 0, reviewedCount = 0;
  function initialize() {
    if (initialized) return;
    database.exec(`CREATE TABLE IF NOT EXISTS supplier_autobuy_price_overrides (
      product_key TEXT PRIMARY KEY, price_vnd INTEGER NOT NULL CHECK(price_vnd>0), revision TEXT NOT NULL,
      actor_id TEXT NOT NULL, updated_at TEXT NOT NULL
    ); CREATE TABLE IF NOT EXISTS supplier_autobuy_price_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, product_key TEXT NOT NULL, old_price_vnd INTEGER,
      new_price_vnd INTEGER NOT NULL, actor_id TEXT NOT NULL, created_at TEXT NOT NULL
    );`);
    initialized = true;
  }
  function guard() { if (!enabled()) fail('AUTOBUY_DISABLED'); }
  async function refresh(force = false) {
    guard();
    const age = now() - checkedAtMs;
    if (checkedAtMs && age >= 0 && age < (force ? minimumRefreshMs : ttlMs)) return;
    if (flight) return flight;
    flight = Promise.resolve().then(async () => {
      const rows = await clientFactory().getStock();
      if (!Array.isArray(rows)) fail('SUPPLIER_UNAVAILABLE');
      products = rows;
      checkedAtMs = now();
      status = 'READY';
    }).catch(() => { status = 'UNAVAILABLE'; fail('SUPPLIER_UNAVAILABLE'); }).finally(() => { flight = null; });
    return flight;
  }
  function evaluate(product) {
    initialize();
    const override = database.prepare('SELECT * FROM supplier_autobuy_price_overrides WHERE product_key=?').get(product.productKey);
    return priceSupplierProduct(product, policies.get(product.productKey), policy, { nowMs: now(), override });
  }
  function allEvaluated() { return products.map(product => ({ product, price: evaluate(product) })); }
  async function getOffers({ force = false } = {}) {
    await refresh(force);
    const rows = allEvaluated();
    const offers = rows.filter(row => row.price.ok).map(({ product, price }) => ({
      productKey: product.productKey, name: product.name, priceVnd: price.priceVnd, unitPriceVnd: price.priceVnd,
      available: product.unlimited || product.stock > 0, stock: product.stock, unlimited: product.unlimited,
      category: price.category, termLabel: price.termLabel, warrantyLabel: price.warrantyLabel, accountForm: price.accountForm,
      comparisonDisclosure: price.comparisonDisclosure, referenceKind: price.referenceKind, referenceUrl: price.referenceUrl,
    }));
    reviewedCount = offers.length;
    availableCount = offers.filter(offer => offer.available).length;
    return { status: 'READY', checkedAt: new Date(checkedAtMs).toISOString(), offers, blockedCount: rows.length - offers.length };
  }
  async function getQuote(productKey, quantity = 1, { force = false } = {}) {
    if (!validText(productKey, 200) || !integer(quantity, 1) || quantity > 10) fail('INVALID_QUANTITY');
    await refresh(force);
    const product = products.find(row => row.productKey === productKey);
    if (!product) fail('PRODUCT_UNAVAILABLE');
    const price = evaluate(product);
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
    const product = products.find(row => row.productKey === productKey);
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
    return { productKey, priceVnd, revision };
  }
  function getHealth() { return Object.freeze({ enabled: Boolean(enabled()), status, reviewedCount, availableCount,
    checkedAt: checkedAtMs ? new Date(checkedAtMs).toISOString() : null, pricingVersion: policy.version }); }
  return Object.freeze({ getOffers, getQuote, setPriceOverride, getHealth });
}

let singleton;
function catalog() {
  if (!singleton) {
    const provider = activeProvider();
    const policyFile = provider === 'cdkvietnam' ? 'cdkVietnamAutobuyPricingPolicy.json' : 'supplierAutobuyPricingPolicy.json';
    const policy = JSON.parse(readFileSync(new URL(`../data/${policyFile}`, import.meta.url), 'utf8'));
    singleton = createSupplierAutobuyCatalog({ policy, clientFactory: configuredClientFactory() });
  }
  return singleton;
}
export const getSupplierOffers = options => catalog().getOffers(options);
export const getSupplierQuote = (key, quantity, options) => catalog().getQuote(key, quantity, options);
export function getSupplierCatalogHealth() {
  if (!singleton) return { enabled: supplierSalesConfigured(), status: 'NOT_STARTED', reviewedCount: 0, availableCount: 0, checkedAt: null };
  return singleton.getHealth();
}
export async function setSupplierPriceOverride({ guildId, productKey, priceVnd, actorId, client } = {}) {
  if (guildId !== STORE_ONE_GUILD_ID || !client?.guilds) fail('ACCESS_DENIED');
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  const member = await guild?.members.fetch({ user: actorId, force: true }).catch(() => null);
  if (!isManager(member, getGuildConfig(guildId))) fail('ACCESS_DENIED');
  return catalog().setPriceOverride({ guildId, productKey, priceVnd, actorId, authorized: true });
}

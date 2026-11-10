import { createHash } from 'node:crypto';

export const SUPPLIER_MARKUP_TIERS_VND = Object.freeze([20000, 30000, 40000, 50000, 100000, 150000, 250000]);
const OFFER_FIELDS = ['plan', 'region', 'duration', 'accountForm', 'benefits'];
const SAFE_MAX = BigInt(Number.MAX_SAFE_INTEGER);

function unavailable(reason) {
  return { ok: false, reason };
}

function integer(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function timestamp(value) {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function normalizeOffer(offer) {
  if (!offer || typeof offer !== 'object' || Array.isArray(offer)) return null;
  const result = {};
  for (const field of OFFER_FIELDS) {
    const value = offer[field];
    if (typeof value !== 'string' || value.length > 200) return null;
    const normalized = value.trim().toLowerCase();
    if (!normalized || /^(unknown|unspecified|n\/?a|tbd|\?|chưa rõ|không rõ)$/.test(normalized)) return null;
    result[field] = normalized;
  }
  return result;
}

function referenceUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Computes a quote only from trusted server-side, normalized VND inputs.
 * The caller must verify supplier costs/fees and the official reference: this
 * function cannot establish that a supplied URL is official or an offer exists.
 * desiredMarkupVnd is a gross uplift ceiling; minimum profit is NET of all
 * declared fees/reserve. Smaller approved tiers may fit the official-price cap.
 * No catalog, environment, network, payment or order side effects occur here.
 */
export function createSupplierPriceQuote(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return unavailable('INVALID_INPUT');
  const {
    productId, supplier, offer, officialReference, fees, quantity = 1,
    desiredMarkupVnd, minProfitPerUnitVnd = 20000,
  } = input;
  const {
    nowMs = Date.now(), quoteTtlMs = 120000, supplierMaxAgeMs = 60000,
    referenceMaxAgeMs = 86400000,
  } = options;
  if (typeof productId !== 'string' || !productId.trim() || productId.length > 100) return unavailable('INVALID_PRODUCT');
  if (!integer(quantity, 1, 100)) return unavailable('INVALID_QUANTITY');
  if (!integer(nowMs) || !integer(quoteTtlMs, 1, 900000)
    || !integer(supplierMaxAgeMs, 1, 300000) || !integer(referenceMaxAgeMs, 1, 604800000)) {
    return unavailable('INVALID_FRESHNESS_POLICY');
  }
  if (supplier?.currency !== 'VND' || officialReference?.currency !== 'VND') return unavailable('UNSUPPORTED_CURRENCY');
  if (!integer(supplier?.unitCostVnd, 1) || !integer(officialReference?.unitPriceVnd, 1)) return unavailable('INVALID_AMOUNT');
  if (!SUPPLIER_MARKUP_TIERS_VND.includes(desiredMarkupVnd) || !integer(minProfitPerUnitVnd, 1)) {
    return unavailable('INVALID_MARGIN_POLICY');
  }
  // Require explicit zeroes when a fee is known to be zero; missing fees are
  // unknown, and must never silently become a zero-cost profitability claim.
  if (!integer(fees?.fixedPerOrderVnd) || !integer(fees?.rateBps, 0, 10000) || !integer(fees?.reservePerUnitVnd)) {
    return unavailable('INVALID_FEES');
  }
  const officialUrl = referenceUrl(officialReference?.sourceUrl);
  if (officialReference?.verified !== true || officialReference?.kind !== 'OFFICIAL'
    || officialReference?.comparable !== true || !officialUrl) return unavailable('REFERENCE_UNVERIFIED');
  const normalizedOffer = normalizeOffer(offer);
  const normalizedOfficialOffer = normalizeOffer(officialReference.offer);
  if (!normalizedOffer || !normalizedOfficialOffer
    || JSON.stringify(normalizedOffer) !== JSON.stringify(normalizedOfficialOffer)) return unavailable('OFFER_NOT_COMPARABLE');
  const supplierCheckedAt = timestamp(supplier.checkedAt);
  const referenceCheckedAt = timestamp(officialReference.checkedAt);
  if (supplierCheckedAt === null || supplierCheckedAt > nowMs || nowMs - supplierCheckedAt >= supplierMaxAgeMs) {
    return unavailable('SUPPLIER_PRICE_STALE');
  }
  if (referenceCheckedAt === null || referenceCheckedAt > nowMs || nowMs - referenceCheckedAt >= referenceMaxAgeMs) {
    return unavailable('REFERENCE_STALE');
  }
  const expiresAtMs = Math.min(nowMs + quoteTtlMs, supplierCheckedAt + supplierMaxAgeMs, referenceCheckedAt + referenceMaxAgeMs);
  if (!integer(expiresAtMs) || expiresAtMs <= nowMs || expiresAtMs > 8640000000000000) return unavailable('INVALID_FRESHNESS_POLICY');

  const quantityBig = BigInt(quantity);
  const cost = BigInt(supplier.unitCostVnd);
  const costTotal = cost * quantityBig;
  const referencePrice = BigInt(officialReference.unitPriceVnd);
  const requiredProfit = BigInt(minProfitPerUnitVnd) * quantityBig;
  if (costTotal > SAFE_MAX || requiredProfit > SAFE_MAX) return unavailable('AMOUNT_OVERFLOW');
  const candidates = SUPPLIER_MARKUP_TIERS_VND.filter(tier => tier <= desiredMarkupVnd).reverse();
  for (const markupVnd of candidates) {
    const unitPrice = cost + BigInt(markupVnd);
    if (unitPrice >= referencePrice) continue;
    const totalPrice = unitPrice * quantityBig;
    const variableFee = (totalPrice * BigInt(fees.rateBps) + 9999n) / 10000n;
    const reserve = BigInt(fees.reservePerUnitVnd) * quantityBig;
    const totalFees = variableFee + BigInt(fees.fixedPerOrderVnd);
    const profit = totalPrice - costTotal - totalFees - reserve;
    if (profit < requiredProfit) continue;
    if ([unitPrice, totalPrice, variableFee, reserve, totalFees, profit].some(value => value > SAFE_MAX)) {
      return unavailable('AMOUNT_OVERFLOW');
    }
    const terms = {
      version: 1, productId, currency: 'VND', quantity, offer: normalizedOffer,
      unitCostVnd: supplier.unitCostVnd, unitPriceVnd: Number(unitPrice),
      totalCostVnd: Number(costTotal), totalPriceVnd: Number(totalPrice),
      markupVnd, desiredMarkupVnd, minProfitPerUnitVnd,
      fees: { fixedPerOrderVnd: fees.fixedPerOrderVnd, rateBps: fees.rateBps, reservePerUnitVnd: fees.reservePerUnitVnd },
      totalFeesVnd: Number(totalFees), totalReserveVnd: Number(reserve), netProfitVnd: Number(profit),
      officialUnitPriceVnd: officialReference.unitPriceVnd, officialSourceUrl: officialUrl,
    };
    return {
      ok: true,
      ...terms,
      // A change detector, not a signature or authorization token. Persist the
      // trusted quote server-side and bind it to the customer/order separately.
      termsFingerprint: createHash('sha256').update(JSON.stringify(terms)).digest('hex'),
      createdAt: new Date(nowMs).toISOString(), expiresAt: new Date(expiresAtMs).toISOString(),
      supplierCheckedAt: supplier.checkedAt, referenceCheckedAt: officialReference.checkedAt,
    };
  }
  return unavailable('NO_PROFITABLE_BELOW_RETAIL_PRICE');
}

/** Compare persisted, trusted quotes before invoice creation/customer debit. */
export function assertSupplierPriceQuoteCurrent(previous, current, nowMs = Date.now()) {
  const fail = code => {
    const error = new Error('Báo giá đã thay đổi hoặc hết hạn. Vui lòng xem giá mới và xác nhận lại.');
    error.code = code;
    throw error;
  };
  if (!integer(nowMs) || previous?.ok !== true || current?.ok !== true) fail('SUPPLIER_QUOTE_UNAVAILABLE');
  for (const quote of [previous, current]) {
    const created = timestamp(quote.createdAt);
    const expires = timestamp(quote.expiresAt);
    if (created === null || expires === null || created > nowMs || expires <= nowMs) fail('SUPPLIER_QUOTE_EXPIRED');
  }
  if (typeof previous.termsFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(previous.termsFingerprint)
    || previous.termsFingerprint !== current.termsFingerprint) fail('SUPPLIER_QUOTE_CHANGED');
  return current;
}

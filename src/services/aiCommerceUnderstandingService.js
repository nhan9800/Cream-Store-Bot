import { getActiveProducts } from './productCatalogService.js';

const PRODUCT_GROUPS = Object.freeze([
  ['youtube', ['youtube', 'yt premium', 'premium youtube', 'ytb', 'yout', 'yt']],
  ['netflix', ['netflix']],
  ['spotify', ['spotify', 'spoti']],
  ['discord', ['discord', 'nitro', 'nichu', 'boost server', 'server boost']],
  ['chatgpt', ['chatgpt', 'chat gpt', 'gpt plus', 'gpt']],
  ['gemini', ['gemini', 'google one']],
  ['capcut', ['capcut']],
  ['canva', ['canva']],
  ['office', ['office', 'onedrive', 'microsoft 365']],
  ['claude', ['claude']],
  ['adobe', ['adobe']],
  ['gearup', ['gearup', 'booster']],
]);

const GENERIC_TOKENS = new Set([
  'anh', 'ban', 'bao', 'cai', 'can', 'cho', 'co', 'em', 'gia', 'giup', 'goi',
  'hang', 'lay', 'minh', 'mua', 'muon', 'nhe', 'nay', 'ok', 'shop', 'thang',
  'tu', 'van', 'voi', 'xin', 'xac', 'nhan', 'dat', 'don', 'luon', 'nhi',
]);

export function normalizeCommerceText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/<a?:[a-z0-9_]+:\d+>/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function signaledGroups(value) {
  const text = normalizeCommerceText(value);
  return PRODUCT_GROUPS
    .filter(([, aliases]) => aliases.some((alias) => ` ${text} `.includes(` ${normalizeCommerceText(alias)} `)))
    .map(([group]) => group);
}

function productMatchesGroup(product, group) {
  const text = normalizeCommerceText(`${product.name} ${product.description || ''} ${product.service_type || ''}`);
  const aliases = PRODUCT_GROUPS.find(([name]) => name === group)?.[1] || [group];
  return aliases.some((alias) => ` ${text} `.includes(` ${normalizeCommerceText(alias)} `));
}

function extractExplicitRequestedQuantity(content) {
  // Pro x5 is a catalog package name, not an instruction to buy five copies.
  // Explicit quantities elsewhere in the request still remain available.
  const text = normalizeCommerceText(content).replace(/\bpro\s+x\s*5\b/g, 'pro');
  const patterns = [
    /\bso luong\s*(\d{1,2})\b/,
    /\b(?:x|sl)\s*(\d{1,2})\b/,
    /\b(\d{1,2})\s*(?:goi|slot|tai khoan|suat|acc)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Math.min(10, Math.max(1, Number(match[1]) || 1));
  }
  return null;
}

export function extractRequestedQuantity(content) {
  return extractExplicitRequestedQuantity(content) || 1;
}

export function extractRequestedDuration(content) {
  // Warranty periods are independent of the subscription duration.
  const text = normalizeCommerceText(content)
    .replace(/\b(?:bh|bao hanh)\s+(?:trong\s+)?\d{1,3}\s*(?:ngay|day|days)\b/g, ' ');
  const day = text.match(/\b(\d{1,3})\s*(?:ngay|day|days)\b/);
  if (day) return { days: Number(day[1]), months: null };
  const year = text.match(/\b(\d{1,2})\s*(?:nam|year|years)\b/);
  if (year) return { days: null, months: Number(year[1]) * 12 };
  const month = text.match(/\b(\d{1,2})\s*(?:thang|month|months)\b/);
  if (month) return { days: null, months: Number(month[1]) };
  return { days: null, months: null };
}

export function isContextualPurchaseConfirmation(content) {
  const text = normalizeCommerceText(content);
  return /^(?:(?:ok|oke|okay)(?: chot| lay)?|duoc|dong y|chot|lay|lay goi nay|chot goi nay|mua luon|lam luon|len don|tao don)(?:(?: nha| nhe| a| di| luon))*$/.test(text)
    || /\b(?:chot|lay|mua luon|len don|tao don)\s+(?:goi|cai)?\s*(?:nay|do)\b/.test(text);
}

function usefulTokens(value) {
  return normalizeCommerceText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !GENERIC_TOKENS.has(token) && !/^\d+$/.test(token));
}

function productDurationMatches(product, duration) {
  if (duration.days) return Number(product.duration_days) === duration.days;
  if (duration.months) return !product.duration_days && Number(product.duration_months || 1) === duration.months;
  return false;
}

/**
 * Rank only catalog-backed products. Context is used solely when the current
 * message refers to a prior recommendation such as "ok, lấy gói này".
 */
export function rankCatalogProducts(products, { content, contextMessages = [], limit = 5 } = {}) {
  const current = normalizeCommerceText(content);
  const currentGroups = signaledGroups(current);
  const currentDuration = extractRequestedDuration(current);
  const canUseContext = currentGroups.length === 0 && (
    isContextualPurchaseConfirmation(current)
    || /\b(?:goi nay|cai nay|goi do|cai do|nhu tren)\b/.test(current)
  );

  let context = '';
  let contextGroups = [];
  let contextDuration = { days: null, months: null };
  let contextQuantity = null;
  if (canUseContext) {
    for (const item of [...contextMessages].reverse().slice(0, 8)) {
      const normalized = normalizeCommerceText(item);
      if (contextQuantity === null) contextQuantity = extractExplicitRequestedQuantity(normalized);
      const groups = signaledGroups(normalized);
      if (!groups.length) continue;
      context = normalized;
      contextGroups = groups;
      contextDuration = extractRequestedDuration(normalized);
      break;
    }
  }

  const groups = currentGroups.length ? currentGroups : contextGroups;
  const duration = currentDuration.days || currentDuration.months ? currentDuration : contextDuration;
  const tokenSource = [currentGroups.length ? current : '', context].filter(Boolean).join(' ');
  const tokens = usefulTokens(tokenSource);
  const normalizedCurrent = normalizeCommerceText(content);

  let ranked = (Array.isArray(products) ? products : []).map((product) => {
    const productText = normalizeCommerceText(`${product.name} ${product.description || ''} ${product.service_type || ''}`);
    const normalizedName = normalizeCommerceText(product.name);
    let score = 0;
    if (normalizedName && normalizedCurrent.includes(normalizedName)) score += 500;
    for (const group of groups) if (productMatchesGroup(product, group)) score += 140;
    if (duration.days || duration.months) {
      score += productDurationMatches(product, duration) ? 100 : -35;
    }
    score += tokens.filter((token) => productText.includes(token)).length * 12;
    if (Number(product.is_featured) === 1) score += 2;
    return { product, score };
  });

  if (groups.length) {
    ranked = ranked.filter(({ product }) => groups.some((group) => productMatchesGroup(product, group)));
  } else {
    ranked = ranked.filter(({ score }) => score > 2);
  }
  if (duration.days || duration.months) {
    const exactDuration = ranked.filter(({ product }) => productDurationMatches(product, duration));
    if (exactDuration.length) ranked = exactDuration;
  }
  ranked.sort((left, right) => right.score - left.score
    || Number(right.product.is_featured || 0) - Number(left.product.is_featured || 0)
    || Number(left.product.sort_order || 0) - Number(right.product.sort_order || 0)
    || Number(left.product.id || 0) - Number(right.product.id || 0));

  const selected = ranked.slice(0, Math.max(1, Math.min(10, Number(limit) || 5)));
  const first = selected[0];
  const second = selected[1];
  const confident = Boolean(first && first.score >= 100 && (!second || first.score - second.score >= 40));
  return {
    products: selected.map(({ product }) => product),
    confidentProduct: confident ? first.product : null,
    quantity: extractExplicitRequestedQuantity(content) || contextQuantity || 1,
    requestedDuration: duration,
    usedContext: Boolean(context),
    hasProductSignal: groups.length > 0,
  };
}

export function resolveCatalogProductsForRequest(guildId, input) {
  return rankCatalogProducts(getActiveProducts(guildId), input);
}

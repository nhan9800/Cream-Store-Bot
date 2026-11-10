import { getActiveProducts } from './productCatalogService.js';
import { isApiCreditProduct } from '../config/apiCreditCatalog.js';

const PRODUCT_GROUPS = Object.freeze([
  ['api_credit', ['codex', 'api claude', 'claude api', 'api credit', 'credit api', 'api codex']],
  ['youtube', ['youtube', 'yt premium', 'premium youtube', 'ytb', 'yout', 'yt']],
  ['netflix', ['netflix']],
  ['spotify', ['spotify', 'spoti']],
  ['discord', ['discord']],
  ['nitro', ['nitro', 'nichu']],
  ['boost', ['boost server', 'server boost', 'boost may chu', 'nang cap may chu']],
  ['decor', ['decor', 'trang tri ho so', 'avatar decoration', 'profile effect', 'nameplate']],
  ['development', ['setup discord', 'setup server', 'bot custom', 'bot booking', 'dev bot', 'lam bot', 'fix bot', 'thiet ke web', 'website', 'dev web']],
  ['chatgpt', ['chatgpt', 'chat gpt', 'gpt plus', 'gpt']],
  ['gemini', ['gemini', 'google one']],
  ['capcut', ['capcut']],
  ['canva', ['canva']],
  ['office', ['office', 'onedrive', 'microsoft 365']],
  ['claude', ['claude']],
  ['adobe', ['adobe']],
  ['gearup', ['gearup', 'booster']],
  ['locket', ['locket', 'locket gold']],
  ['windows', ['windows', 'win 10', 'win 11']],
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
  let groups = PRODUCT_GROUPS
    .filter(([, aliases]) => aliases.some((alias) => ` ${text} `.includes(` ${normalizeCommerceText(alias)} `)))
    .map(([group]) => group);
  // "Decor cho acc có Nitro" describes the decoration's eligibility, not a
  // request for a Nitro subscription. Generic Discord alone remains broad.
  if (groups.includes('decor') && /\b(?:acc|tai khoan)\s+(?:da\s+)?(?:co|khong|chua(?: co)?)\s+nitro\b/.test(text)) {
    groups = groups.filter((group) => group !== 'nitro');
  }
  if (groups.some((group) => ['nitro', 'boost', 'decor', 'development'].includes(group))) {
    groups = groups.filter((group) => group !== 'discord');
  }
  return groups;
}

function productMatchesGroup(product, group) {
  if (group === 'api_credit') return isApiCreditProduct(product);
  if (isApiCreditProduct(product)) return false;
  // Identity must come from the product itself. Benefits/descriptions can
  // mention other brands (Gemini includes Claude models or YouTube bonuses).
  const groups = signaledGroups(product.name);
  if (group === 'discord') return groups.some((name) => ['discord', 'nitro', 'boost', 'decor', 'development'].includes(name));
  if (groups.includes('decor')) return group === 'decor';
  return groups.includes(group);
}

function selectionText(value) {
  // A direct correction replaces the previous choice. Leave general
  // comparisons intact rather than guessing which half the customer prefers.
  return String(value || '').split(/(?:đổi sang|doi sang|chuyển sang|chuyen sang|thay bằng|thay bang)\s+/i).at(-1);
}

export function extractRequestedBudget(value) {
  const text = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
  const match = text.match(/\b(ngan sach(?: cua minh)?(?: la| chi co)?|toi da|khong qua|duoi)\s*[:=]?\s*(\d+(?:[.,]\d+)*)\s*(trieu|tr|k|nghin|ngan|vnd|dong|d)\b/);
  if (!match) return null;
  const [, qualifier, digits, unit] = match;
  const isMillion = ['trieu', 'tr'].includes(unit);
  const isThousand = ['k', 'nghin', 'ngan'].includes(unit);
  const numeric = Number(isMillion || isThousand ? digits.replace(',', '.') : digits.replace(/[.,]/g, ''));
  const amount = numeric * (isMillion ? 1_000_000 : isThousand ? 1_000 : 1);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) return null;
  return { amount, inclusive: qualifier !== 'duoi', scope: /\b(?:moi goi|moi acc|moi tai khoan|mot goi)\b/.test(text) ? 'UNIT' : 'TOTAL' };
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
  const text = durationText(content);
  const day = text.match(/\b(\d{1,3})\s*(?:ngay|day|days)\b/);
  if (day) return { days: Number(day[1]), months: null };
  const year = text.match(/\b(\d{1,2})\s*(?:nam|year|years)\b/);
  if (year) return { days: null, months: Number(year[1]) * 12 };
  const month = text.match(/\b(\d{1,2})\s*(?:thang|month|months)\b/);
  if (month) return { days: null, months: Number(month[1]) };
  return { days: null, months: null };
}

function extractRequestedDurations(content) {
  const text = durationText(content);
  const values = [];
  for (const match of text.matchAll(/\b(\d{1,3})\s*(ngay|day|days|thang|month|months|nam|year|years)\b/g)) {
    const amount = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(amount)) continue;
    if (/^(?:ngay|day|days)$/.test(unit)) values.push(`d:${amount}`);
    else if (/^(?:nam|year|years)$/.test(unit)) values.push(`m:${amount * 12}`);
    else values.push(`m:${amount}`);
  }
  return [...new Set(values)];
}

function durationText(content) {
  return normalizeCommerceText(content)
    .replace(/\b(\d{1,2})\s*t\b/g, '$1 thang')
    .replace(/\b(\d{1,2})\s*(?:y|yr)\b/g, '$1 nam')
    .replace(/\b(?:bh|bao hanh)\s+(?:trong\s+)?\d{1,3}\s*(?:ngay|day|days|thang|month|months|nam|year|years)\b/g, ' ')
    .replace(/\b(\d{1,3})\s+(?:hay|hoac)\s+(\d{1,3})\s+(ngay|thang|nam|months?|years?|days?)\b/g, '$1 $3 hay $2 $3');
}

export function isCommerceFollowup(content) {
  const text = normalizeCommerceText(content);
  return Boolean(extractRequestedDurations(text).length || extractExplicitRequestedQuantity(text) || extractRequestedBudget(content))
    || /\b(?:goi nay|goi do|cai nay|cai do|nhu tren|chinh chu|cap acc|cap tai khoan|bao hanh|bh|re nhat|re hon|gia sao|gia the nao|gia ra sao|gia nhieu|gia nhiu|bao nhieu|may tien|chinh sach the nao|chinh sach ra sao)\b/.test(text);
}

export function isContextualPurchaseConfirmation(content) {
  const text = normalizeCommerceText(content);
  if (hasPurchaseNegation(text)) return false;
  return /^(?:(?:ok|oke|okay)(?: chot| lay)?|duoc|dong y|chot|lay|lay goi nay|chot goi nay|mua luon|lam luon|len don|tao don)(?:(?: nha| nhe| a| di| luon))*$/.test(text)
    || /\b(?:chot|lay|mua luon|len don|tao don)\s+(?:goi|cai)?\s*(?:nay|do)\b/.test(text);
}

export function hasPurchaseNegation(content) {
  return /\b(?:khong|chua|dung|khoan|chua muon)\s+(?:voi\s+)?(?:chot|mua|lay|dat|xac nhan|dong y|len don|tao don)\b/.test(normalizeCommerceText(content))
    || /\b(?:huy don|huy mua|chi hoi|chi tham khao)\b/.test(normalizeCommerceText(content));
}

function usefulTokens(value) {
  return normalizeCommerceText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !GENERIC_TOKENS.has(token) && !/^\d+$/.test(token));
}

function productDurationMatches(product, duration) {
  if (duration.days) return Number(product.duration_days) === duration.days;
  if (duration.months) return !product.duration_days && Number(product.duration_months ?? 1) === duration.months;
  return false;
}

function requestedApiCredit(value) {
  const raw = String(value || '');
  const match = raw.match(/\$\s*(\d+)\b/)
    || normalizeCommerceText(raw).match(/\b(\d+)\s*(?:usd\s*)?credit\b/);
  return match ? Number(match[1]) : null;
}

/**
 * Rank only catalog-backed products. Context is used solely when the current
 * message refers to a prior recommendation such as "ok, lấy gói này".
 */
export function rankCatalogProducts(products, { content, contextMessages = [], limit = 5 } = {}) {
  const selectedContent = selectionText(content);
  const current = normalizeCommerceText(selectedContent);
  const currentGroups = signaledGroups(current);
  const currentDuration = extractRequestedDuration(current);
  const currentDurationOptions = extractRequestedDurations(current);
  const canUseContext = currentGroups.length === 0 && (
    isContextualPurchaseConfirmation(current)
    || isCommerceFollowup(content)
    || /\b(?:goi nay|cai nay|goi do|cai do|nhu tren)\b/.test(current)
  );

  let context = '';
  let contextGroups = [];
  let contextDuration = { days: null, months: null };
  let contextQuantity = null;
  let contextCredit = null;
  let contextDurationOptions = [];
  let contextBudget = null;
  if (canUseContext) {
    for (const item of [...contextMessages].reverse().slice(0, 8)) {
      const selectedText = selectionText(item);
      const normalized = normalizeCommerceText(selectedText);
      if (hasPurchaseNegation(normalized)) break;
      if (!contextBudget) contextBudget = extractRequestedBudget(selectedText);
      if (contextQuantity === null) contextQuantity = extractExplicitRequestedQuantity(normalized);
      if (!contextDurationOptions.length) {
        contextDurationOptions = extractRequestedDurations(normalized);
        contextDuration = extractRequestedDuration(normalized);
      }
      const groups = signaledGroups(normalized);
      if (!groups.length) continue;
      context = normalized;
      contextCredit = requestedApiCredit(selectedText);
      contextGroups = groups;
      break;
    }
  }

  const signaled = currentGroups.length ? currentGroups : contextGroups;
  const groups = signaled.includes('api_credit') ? ['api_credit'] : signaled;
  const credit = requestedApiCredit(selectedContent) ?? contextCredit;
  const duration = currentDuration.days || currentDuration.months ? currentDuration : contextDuration;
  const quantity = extractExplicitRequestedQuantity(selectedContent) || extractExplicitRequestedQuantity(content) || contextQuantity || 1;
  const budget = extractRequestedBudget(selectedContent) || extractRequestedBudget(content) || contextBudget;
  const tokenSource = [currentGroups.length ? current : '', context].filter(Boolean).join(' ');
  const tokens = usefulTokens(tokenSource);
  const normalizedCurrent = current;

  let ranked = (Array.isArray(products) ? products : []).filter((product) => Number(product.is_active ?? 1) === 1).map((product) => {
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
    return { product, score, identityMatched: Boolean(normalizedName && normalizedCurrent.includes(normalizedName))
      || tokens.some((token) => productText.includes(token)) };
  });

  if (groups.length) {
    ranked = ranked.filter(({ product }) => groups.some((group) => productMatchesGroup(product, group)));
  } else {
    ranked = ranked.filter(({ identityMatched }) => identityMatched);
  }
  // When a customer compares plans ("1 tháng hay 3 tháng"), retaining only
  // the first duration would make the assistant appear decisive while
  // silently choosing the wrong plan. Keep both candidates and require an
  // explicit selection instead.
  const hasConflictingDuration = currentDurationOptions.length > 1
    || (!currentDurationOptions.length && contextDurationOptions.length > 1);
  let requestedDurationAvailable = true;
  if (hasConflictingDuration) {
    const options = currentDurationOptions.length ? currentDurationOptions : contextDurationOptions;
    ranked = ranked.filter(({ product }) => options.includes(product.duration_days
      ? `d:${Number(product.duration_days)}` : `m:${Number(product.duration_months ?? 1)}`));
  }
  if ((duration.days || duration.months) && !hasConflictingDuration) {
    const exactDuration = ranked.filter(({ product }) => productDurationMatches(product, duration));
    if (exactDuration.length) ranked = exactDuration;
    else requestedDurationAvailable = false;
  }
  if (groups.includes('api_credit') && credit !== null) {
    ranked = ranked.filter(({ product }) => Number(product.quota_value) === credit);
    for (const item of ranked) item.score += 180;
  }
  const unmetConstraints = [];
  if (!requestedDurationAvailable) unmetConstraints.push('DURATION');
  if (budget) {
    const beforeBudget = ranked.length;
    ranked = ranked.filter(({ product }) => {
      const amount = Number(product.price) * (budget.scope === 'UNIT' ? 1 : quantity);
      return Number.isFinite(amount) && amount > 0 && (budget.inclusive ? amount <= budget.amount : amount < budget.amount);
    });
    if (beforeBudget && !ranked.length) unmetConstraints.push('BUDGET');
  }
  const cheapestRequested = /\b(?:re nhat|gia thap nhat)\b/.test(current);
  ranked.sort((left, right) => right.score - left.score
    || Number(right.product.is_featured || 0) - Number(left.product.is_featured || 0)
    || Number(left.product.sort_order || 0) - Number(right.product.sort_order || 0)
    || Number(left.product.id || 0) - Number(right.product.id || 0));
  if (cheapestRequested) ranked.sort((left, right) => Number(left.product.price) - Number(right.product.price));

  const selected = ranked.slice(0, Math.max(1, Math.min(10, Number(limit) || 5)));
  const first = selected[0];
  const second = ranked[1];
  const confident = groups.length <= 1 && !hasConflictingDuration && requestedDurationAvailable
    && Boolean(first && first.score >= 100 && (!second || first.score - second.score >= 40));
  return {
    products: selected.map(({ product }) => product),
    confidentProduct: confident ? first.product : null,
    quantity,
    requestedDuration: duration,
    requestedDurationAvailable,
    hasConflictingDuration,
    requestedBudget: budget,
    unmetConstraints,
    usedContext: Boolean(context),
    hasProductSignal: groups.length > 0,
  };
}

export function resolveCatalogProductsForRequest(guildId, input) {
  return rankCatalogProducts(getActiveProducts(guildId), input);
}

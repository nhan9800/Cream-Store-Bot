import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_CREDIT_PRODUCTS } from '../src/config/apiCreditCatalog.js';
import {
  PROMOTION_CATALOG_ROWS,
  PROMOTION_CATALOG_SECTIONS,
  PROMOTION_PRICE_SOURCE_LABELS,
  getPromotionCatalogGroups,
} from '../src/campaigns/promotionCatalog202610.js';

// Independent owner-price fixture: restoring the old board must not drop the
// five JSON/MoMo/Team tiers again when adding the ten newer AI offerings.
const ownerPrices = {
  'sale-nitro-boost-login-1-month': 85000,
  'sale-nitro-boost-login-2-months': 99000,
  'sale-nitro-boost-login-2-months-mail': 120000,
  'sale-nitro-boost-login-4-months': 250000,
  'sale-nitro-boost-login-6-months': 350000,
  'sale-nitro-boost-login-8-months': 450000,
  'sale-nitro-boost-login-12-months-auto': 680000,
  'sale-nitro-boost-login-1-year-direct': 830000,
  'sale-nitro-trial-3-months': 65000,
  'sale-server-boost-1-month': 110000,
  'sale-server-boost-3-months': 280000,
  'sale-netflix-premium-4k-private-1-month': 75000,
  'sale-gemini-pro-google-one-5tb-12-months': 120000,
  'sale-gemini-pro-google-one-5tb-18-months': 190000,
  'sale-office-365-onedrive-12-months': 200000,
  'sale-chatgpt-momo-pay-1-month': 130000,
  'sale-chatgpt-add-team-own-account-1-month': 390000,
  'sale-chatgpt-pro-5x-team-4-slots': 79000,
  'sale-chatgpt-pro-5x-team-2-slots': 150000,
  'sale-chatgpt-pro-5x-account-json': 250000,
  'sale-capcut-pro-1-month': 55000,
  'sale-capcut-pro-6-months': 290000,
  'sale-spotify-premium-3-months': 110000,
  'sale-spotify-premium-6-months': 180000,
  'sale-spotify-premium-12-months': 280000,
  'sale-youtube-premium-stable-1-month': 58000,
  'sale-youtube-premium-stable-3-months': 185000,
  'sale-youtube-premium-stable-6-months': 295000,
  'sale-youtube-premium-stable-12-months': 530000,
  'sale-chatgpt-plus-own-account-package-warranty': 485000,
  'sale-chatgpt-plus-own-account-full-warranty': 500000,
  'sale-chatgpt-pro-100-own-account': 2650000,
  'sale-chatgpt-pro-200-own-account': 4800000,
  'sale-chatgpt-pro-500-own-account': 12700000,
  'sale-chatgpt-pro-100-account-no-warranty': 1900000,
  'sale-chatgpt-pro-100-account-full-warranty': 2300000,
  'sale-chatgpt-account-2-day-warranty': 120000,
  'sale-claude-pro-x5-account-no-warranty': 1900000,
  'sale-claude-pro-x5-account-full-warranty': 2500000,
};

// Read only the static seed literal rather than importing a module that opens
// the operator's SQLite connection. No database, token or network is needed.
function seedProducts() {
  const source = fs.readFileSync(new URL('../src/database/db.js', import.meta.url), 'utf8');
  const literal = `${source.split('export const DEFAULT_PRODUCT_CATALOG = ')[1].split('\n];')[0]}\n]`;
  return Function('API_CREDIT_PRODUCTS', `return ${literal}`)(API_CREDIT_PRODUCTS);
}

function keyOf(product) {
  return String(product.product_key || product.name)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const byKey = (key) => PROMOTION_CATALOG_ROWS.find((row) => row.key === key);

describe('Complete October promotion data', () => {
  it('retains all 29 owner sale prices and all ten newer AI prices exactly', () => {
    expect(Object.fromEntries(PROMOTION_CATALOG_ROWS.filter((row) => row.source === 'SALE')
      .map((row) => [row.key, row.price]))).toEqual(ownerPrices);
  });

  it('covers every current seed SKU once without rewriting the 49 catalog prices', () => {
    const products = seedProducts();
    const byProductKey = new Map(products.map((product) => [keyOf(product), product]));
    const catalogRows = PROMOTION_CATALOG_ROWS.filter((row) => row.source === 'CATALOG');
    const linked = PROMOTION_CATALOG_ROWS.map((row) => row.catalogKey).filter(Boolean);
    expect(new Set(linked).size).toBe(linked.length);
    expect([...linked].sort()).toEqual([...byProductKey.keys()].sort());
    expect(catalogRows).toHaveLength(49);
    for (const row of catalogRows) {
      expect(row.price, row.key).toBe(byProductKey.get(row.catalogKey)?.price);
    }
  });

  it('keeps old MoMo 130k separate from the neutral 120k supplied-account tier', () => {
    const momo = byKey('sale-chatgpt-momo-pay-1-month');
    const supplied = byKey('sale-chatgpt-account-2-day-warranty');
    expect(momo.price).toBe(130000);
    expect(supplied.price).toBe(120000);
    expect(momo.warranty).toBe('BH 2 ngày');
    expect(supplied.warranty).toBe('BH 2 ngày');
    expect(supplied.label).not.toMatch(/Plus|Pro/);
    expect(supplied.duration).toContain('1 tháng');
  });

  it('preserves per-slot billing and never invents the JSON package duration', () => {
    for (const key of ['sale-chatgpt-pro-5x-team-4-slots', 'sale-chatgpt-pro-5x-team-2-slots']) {
      expect(byKey(key).priceUnit).toBe('slot');
      expect(byKey(key).formattedPresentation).toContain('/slot');
      expect(byKey(key).duration).toContain('Xác nhận');
    }
    expect(byKey('sale-chatgpt-pro-5x-account-json').warranty).toBe('BH 60 phút');
    expect(byKey('sale-chatgpt-pro-5x-account-json').duration).toContain('Xác nhận');
  });

  it('lists all six API credit packs with exact marked-up prices and no day charge', () => {
    const rows = PROMOTION_CATALOG_ROWS.filter((row) => row.key.startsWith('api-codex-claude-credit-'));
    expect(rows.map((row) => row.price)).toEqual([70000,90000,110000,155000,250000,530000]);
    for (const api of rows) {
      expect(api.duration).toBe('Không giới hạn ngày · Dùng đến hết credit');
      expect(api.additionalDayPrice).toBeUndefined();
      expect(api.formattedPresentation).not.toMatch(/ngày đầu|tháng/);
    }
    expect(byKey('claude-api-100m')).toBeUndefined();
  });

  it('does not invent warranty coverage for Pro 200/500 or short-warranty accounts', () => {
    for (const key of ['sale-chatgpt-pro-200-own-account', 'sale-chatgpt-pro-500-own-account']) {
      expect(byKey(key).warranty).toContain('Xác nhận');
      expect(byKey(key).warranty).not.toMatch(/full/i);
    }
    expect(byKey('sale-chatgpt-plus-own-account-package-warranty').warranty).toContain('Không BH acc');
    expect(byKey('sale-claude-pro-x5-account-full-warranty').warranty).toContain('1 tháng');
  });

  it('makes every Decor level and monthly-reset Adobe tier visible', () => {
    expect(PROMOTION_CATALOG_ROWS.filter((row) => row.key.startsWith('decor-'))).toHaveLength(23);
    for (const key of ['adobe-creative-cloud-4-months-4000-ai-credits', 'adobe-creative-cloud-12-months-4000-ai-credits']) {
      expect(byKey(key).notes.join(' ')).toContain('reset mỗi tháng');
    }
  });

  it('keeps catalog listings distinct from owner campaign prices with eight complete groups', () => {
    expect(PROMOTION_PRICE_SOURCE_LABELS.CATALOG).toBe('Giá niêm yết hiện hành');
    expect(PROMOTION_CATALOG_SECTIONS).toHaveLength(8);
    expect(getPromotionCatalogGroups().flatMap((group) => group.rows)).toHaveLength(88);
    expect(new Set(PROMOTION_CATALOG_ROWS.map((row) => row.key)).size).toBe(88);
    for (const row of PROMOTION_CATALOG_ROWS) {
      expect(Number.isSafeInteger(row.price)).toBe(true);
      expect(row.price).toBeGreaterThan(0);
      expect(Object.isFrozen(row)).toBe(true);
    }
    // These owner prices are above the current catalog: retain exact supplied
    // prices without inventing a strikethrough reference or a discount percent.
    expect(byKey('sale-nitro-trial-3-months').price).toBe(65000);
    expect(byKey('sale-spotify-premium-3-months').price).toBe(110000);
  });
});

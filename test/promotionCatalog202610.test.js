import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GEMINI_PRO_CDK_PRODUCT } from '../src/config/geminiProCdk202611.js';
import {
  PROMOTION_CATALOG_ROWS,
  PROMOTION_CATALOG_SECTIONS,
  PROMOTION_PRICE_SOURCE_LABELS,
  getPromotionCatalogGroups,
} from '../src/campaigns/promotionCatalog202610.js';

// Independent fixture for owner sale prices outside the November catalog changes.
const ownerPrices = {
  'sale-server-boost-1-month': 110000,
  'sale-server-boost-3-months': 280000,
  'sale-netflix-premium-4k-private-1-month': 75000,
  'sale-gemini-pro-google-one-5tb-12-months': 120000,
  'sale-office-365-onedrive-12-months': 200000,
  'sale-capcut-pro-1-month': 55000,
  'sale-capcut-pro-6-months': 290000,
  'sale-spotify-premium-6-months': 180000,
  'sale-spotify-premium-12-months': 280000,
};

// Read only the static seed literal rather than importing a module that opens
// the operator's SQLite connection. No database, token or network is needed.
function seedProducts() {
  const source = fs.readFileSync(new URL('../src/database/db.js', import.meta.url), 'utf8');
  const literal = `${source.split('export const DEFAULT_PRODUCT_CATALOG = ')[1].split('\n];')[0]}\n]`;
  return Function('GEMINI_PRO_CDK_PRODUCT', `return ${literal}`)(GEMINI_PRO_CDK_PRODUCT);
}

function keyOf(product) {
  return String(product.product_key || product.name)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const byKey = (key) => PROMOTION_CATALOG_ROWS.find((row) => row.key === key);

describe('Current promotion catalog data', () => {
  it('retains unaffected owner sale prices exactly', () => {
    expect(Object.fromEntries(PROMOTION_CATALOG_ROWS.filter((row) => row.source === 'SALE')
      .map((row) => [row.key, row.price]))).toEqual(ownerPrices);
  });

  it('covers every current seed SKU once at the correct catalog price', () => {
    const products = seedProducts();
    const byProductKey = new Map(products.map((product) => [keyOf(product), product]));
    const catalogRows = PROMOTION_CATALOG_ROWS.filter((row) => row.source === 'CATALOG');
    const linked = PROMOTION_CATALOG_ROWS.map((row) => row.catalogKey).filter(Boolean);
    expect(new Set(linked).size).toBe(linked.length);
    expect([...linked].sort()).toEqual([...byProductKey.keys()].sort());
    expect(catalogRows.length).toBeGreaterThan(0);
    for (const row of catalogRows) {
      expect(row.price, row.key).toBe(byProductKey.get(row.catalogKey)?.price);
    }
  });

  it('retains only the new ChatGPT offers and removes API credit from publication', () => {
    expect(PROMOTION_CATALOG_ROWS.filter((row) => row.label.startsWith('ChatGPT')).map((row) => row.price))
      .toEqual([530000, 2650000, 4500000, 12800000]);
    expect(PROMOTION_CATALOG_ROWS.filter((row) => row.label.startsWith('Claude')).map((row) => row.price)).toEqual([550000]);
    expect(PROMOTION_CATALOG_ROWS.some((row) => /api-codex|claude-api/.test(row.key))).toBe(false);
    for (const key of ['chatgpt-pro-200-own-account-1-month', 'chatgpt-pro-500-own-account-1-month']) {
      expect(byKey(key).warranty).toContain('Xác nhận');
    }
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
    expect(getPromotionCatalogGroups().flatMap((group) => group.rows)).toHaveLength(PROMOTION_CATALOG_ROWS.length);
    expect(new Set(PROMOTION_CATALOG_ROWS.map((row) => row.key)).size).toBe(PROMOTION_CATALOG_ROWS.length);
    for (const row of PROMOTION_CATALOG_ROWS) {
      expect(Number.isSafeInteger(row.price)).toBe(true);
      expect(row.price).toBeGreaterThan(0);
      expect(Object.isFrozen(row)).toBe(true);
    }
  });
});

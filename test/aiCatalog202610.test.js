import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testDatabasePath = vi.hoisted(() => {
  const relativePath = `./data/test-ai-catalog-202610-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.test-ai-catalog-not-present';
  process.env.DATABASE_PATH = relativePath;
  process.env.ENCRYPTION_KEY = 'test-ai-catalog-key';
  return relativePath;
});

import { db, initDatabase, seedProductCatalog } from '../src/database/db.js';
import { getActiveProducts } from '../src/services/productCatalogService.js';
import { buildPriceBoardPayloads, groupPriceProducts, PRICE_BOARD_VERSION } from '../src/services/autoSetupPriceBoardService.js';

const GUILD_ID = '1282637033340403754';
const REQUESTED_PRICES = new Map([
  ['chatgpt-plus-own-account-1-month-package-warranty', 485000],
  ['chatgpt-plus-direct-payment-1-month-full-warranty', 500000],
  ['chatgpt-pro-100-own-account-1-month-package-warranty', 2650000],
  ['chatgpt-pro-200-own-account-1-month', 4800000],
  ['chatgpt-pro-500-own-account-1-month', 12700000],
  ['chatgpt-pro-100-account-1-month-no-warranty', 1900000],
  ['chatgpt-pro-100-account-1-month-full-warranty', 2300000],
  ['chatgpt-account-1-month-2-day-warranty', 120000],
  ['claude-pro-x5-account-1-month-no-warranty', 1900000],
  ['claude-pro-x5-account-1-month-full-warranty', 2500000],
]);

beforeAll(() => initDatabase());
afterAll(() => {
  db.close();
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${path.resolve(process.cwd(), testDatabasePath)}${suffix}`, { force: true });
  }
});

function collectComponents(payload) {
  const components = [];
  const visit = (component) => {
    components.push(component);
    for (const child of component.components || []) visit(child);
  };
  for (const component of payload.components) visit(component.toJSON());
  return components;
}

describe('October 2026 AI catalog additions', () => {
  it('publishes all ten requested prices with the confirmed one-month terms', () => {
    const products = getActiveProducts(GUILD_ID);
    for (const [key, price] of REQUESTED_PRICES) {
      const product = products.find((row) => row.product_key === key);
      expect(product, key).toMatchObject({ price, duration_months: 1, is_active: 1, service_type: 'AI' });
      expect(product.quota_value, `${key} must not invent provider quotas`).toBeNull();
      expect(product.activation_method).toBe(key.includes('own-account') || key.includes('direct-payment') ? 'OWN_ACCOUNT' : 'ACCOUNT');
    }
    expect(products.filter((row) => /chat\s*gpt/i.test(row.name))).toHaveLength(11);
    expect(products.find((row) => row.product_key === 'claude-pro-1-month')?.price).toBe(530000);
  });

  it('separates package-only, full, absent and two-day warranty scopes', () => {
    const products = new Map(getActiveProducts(GUILD_ID).map((row) => [row.product_key, row]));
    for (const key of ['chatgpt-plus-own-account-1-month-package-warranty', 'chatgpt-pro-100-own-account-1-month-package-warranty']) {
      expect(products.get(key)?.warranty_policy).toContain('không bảo hành tài khoản');
      expect(products.get(key)?.warranty_policy).not.toContain('Full');
    }
    for (const key of ['chatgpt-pro-100-account-1-month-full-warranty', 'claude-pro-x5-account-1-month-full-warranty']) {
      expect(products.get(key)?.warranty_policy).toContain('Full 1 tháng');
    }
    for (const key of ['chatgpt-pro-100-account-1-month-no-warranty', 'claude-pro-x5-account-1-month-no-warranty']) {
      expect(products.get(key)?.warranty_policy).toContain('Không bảo hành');
    }
    for (const key of ['chatgpt-pro-200-own-account-1-month', 'chatgpt-pro-500-own-account-1-month']) {
      expect(products.get(key)?.warranty_policy).not.toMatch(/Full|BHF/);
      expect(products.get(key)?.warranty_policy).toContain('Xác nhận');
    }
    const shortWarranty = products.get('chatgpt-account-1-month-2-day-warranty');
    expect(shortWarranty?.warranty_policy).toContain('Bảo hành 2 ngày');
    expect(shortWarranty?.description).toContain('không cam kết tài khoản duy trì đủ tháng');
    expect(shortWarranty?.description).toContain('tùy cách sử dụng');
    expect(shortWarranty?.name).not.toMatch(/Plus|Pro/);
  });

  it('migrates the prior full Plus tier in place and preserves historical orders on repeated boots', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    try {
      database.exec(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'product_catalog'").get().sql);
      seedProductCatalog(database);
      const fullKey = 'chatgpt-plus-direct-payment-1-month-full-warranty';
      const original = database.prepare('SELECT * FROM product_catalog WHERE product_key = ?').get(fullKey);
      database.prepare("UPDATE product_catalog SET price = 530000, image_url = 'https://example.com/preserved.webp', virtual_purchase_count = 17 WHERE id = ?").run(original.id);
      const addedKeys = [...REQUESTED_PRICES.keys()].filter((key) => key !== fullKey);
      for (const key of addedKeys) database.prepare('DELETE FROM product_catalog WHERE product_key = ?').run(key);
      database.exec(`CREATE TABLE historical_orders (id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES product_catalog(id), product_name TEXT NOT NULL, total_amount INTEGER NOT NULL, warranty TEXT NOT NULL)`);
      database.prepare('INSERT INTO historical_orders VALUES (1, ?, ?, 530000, ?)').run(original.id, original.name, original.warranty_policy);
      const oldOrder = database.prepare('SELECT * FROM historical_orders').get();
      const previousProducts = database.prepare('SELECT id, product_key, price, is_active FROM product_catalog ORDER BY id').all();

      seedProductCatalog(database);
      const firstPass = database.prepare('SELECT id, product_key, price, is_active FROM product_catalog ORDER BY id').all();
      seedProductCatalog(database);
      expect(database.prepare('SELECT id, product_key, price, is_active FROM product_catalog ORDER BY id').all()).toEqual(firstPass);
      expect(database.prepare('SELECT * FROM historical_orders').get()).toEqual(oldOrder);
      expect(database.prepare('SELECT id, price, image_url, virtual_purchase_count FROM product_catalog WHERE product_key = ?').get(fullKey)).toEqual({
        id: original.id, price: 500000, image_url: 'https://example.com/preserved.webp', virtual_purchase_count: 17,
      });
      for (const product of previousProducts.filter((row) => row.product_key !== fullKey)) {
        expect(database.prepare('SELECT id, product_key, price, is_active FROM product_catalog WHERE id = ?').get(product.id)).toEqual(product);
      }
      for (const [key, price] of REQUESTED_PRICES) {
        expect(database.prepare('SELECT price, is_active FROM product_catalog WHERE product_key = ?').get(key)).toEqual({ price, is_active: 1 });
        expect(database.prepare('SELECT COUNT(*) AS count FROM product_catalog WHERE product_key = ?').get(key).count).toBe(1);
      }
      expect(database.pragma('foreign_key_check')).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('renders every added row and selector within Discord limits without confusing warranty with duration', () => {
    const products = getActiveProducts(GUILD_ID);
    const payloads = buildPriceBoardPayloads(GUILD_ID, {}, products);
    const panels = payloads.flatMap(collectComponents);
    const text = panels.filter((component) => component.type === 10).map((component) => component.content).join('\n');
    expect(text).toContain(PRICE_BOARD_VERSION);
    expect(text).toContain('ChatGPT Plus, Pro & Business');
    const options = panels.filter((component) => component.type === 3).flatMap((component) => component.options);
    for (const key of REQUESTED_PRICES.keys()) {
      const product = products.find((row) => row.product_key === key);
      expect(text).toContain(product.name);
      expect(options.filter((option) => option.value === String(product.id))).toHaveLength(1);
    }
    const shortWarrantyBlock = panels.find((component) => component.type === 10 && component.content.startsWith('### ') && component.content.includes('ChatGPT 1 Tháng (Cấp Tài Khoản · BH 2 Ngày)'));
    expect(shortWarrantyBlock.content).toContain('**Thời hạn:** `1 tháng`');
    expect(shortWarrantyBlock.content).toContain('Bảo hành 2 ngày');
    const groups = groupPriceProducts(products);
    expect(payloads.length).toBeGreaterThan(groups.length + 1);
    for (const payload of payloads) {
      const components = collectComponents(payload);
      expect(components.length).toBeLessThanOrEqual(38);
      expect(components.reduce((sum, component) => sum + (component.content?.length || 0), 0)).toBeLessThanOrEqual(3800);
      for (const selector of components.filter((component) => component.type === 3)) {
        expect(selector.options.length).toBeLessThanOrEqual(25);
      }
    }
  });

  it('keeps the same package distinctions and one-month duration in the international board', () => {
    const payloads = buildPriceBoardPayloads('1070676180103086132', {}, getActiveProducts(GUILD_ID));
    const components = payloads.flatMap(collectComponents);
    const text = components.filter((component) => component.type === 10).map((component) => component.content).join('\n');
    expect(text).toContain('ChatGPT Plus, Pro & Business');
    expect(text).toContain('Subscription coverage for 1 month; the account is excluded');
    expect(text).toContain('No warranty; a full month of account access is not guaranteed');
    expect(text).toContain('Confirm warranty coverage with the shop before buying');
    const shortWarrantyBlock = components.find((component) => component.type === 10 && component.content.startsWith('### ') && component.content.includes('2 Days of Warranty'));
    expect(shortWarrantyBlock.content).toContain('**Duration:** `1 month`');
    expect(shortWarrantyBlock.content).toContain('2 days of warranty; nominal subscription period is 1 month');
    for (const payload of payloads) {
      const panel = collectComponents(payload);
      expect(panel.reduce((sum, component) => sum + (component.content?.length || 0), 0)).toBeLessThanOrEqual(3800);
      expect(panel.length).toBeLessThanOrEqual(38);
    }
  });
});

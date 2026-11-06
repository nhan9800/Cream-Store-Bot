import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Collection } from 'discord.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testDatabasePath = vi.hoisted(() => {
  const relativePath = `./data/test-ai-catalog-202610-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.test-ai-catalog-not-present';
  process.env.DATABASE_PATH = relativePath;
  process.env.ENCRYPTION_KEY = 'test-ai-catalog-key';
  return relativePath;
});

import { db, initDatabase, seedProductCatalog } from '../src/database/db.js';
import { getActiveProducts, generateProductKnowledgeText } from '../src/services/productCatalogService.js';
import { rankCatalogProducts, extractRequestedDuration } from '../src/services/aiCommerceUnderstandingService.js';
import { buildPriceBoardPayloads, groupPriceProducts, PRICE_BOARD_VERSION } from '../src/services/autoSetupPriceBoardService.js';
import { CORE_UI_EMOJI_ASSETS } from '../src/config/coreEmojiPack2026.js';
import { GEMINI_PRO_CDK_KEY } from '../src/config/geminiProCdk202611.js';
import { AUTOMATIC_MARKETING_PAUSED, AUTOMATIC_PRICE_BOARD_PAUSED } from '../src/config/marketingAutomationPolicy.js';

const GUILD_ID = '1282637033340403754';
const previousClient = global.discordClient;
const liveNames = [...CORE_UI_EMOJI_ASSETS.map((asset) => asset.name),
  'cenar_spotify', 'cenar_chatgpt', 'cenar_nitro', 'cenar_boost', 'cenar_gemini',
  'cenar_claude', 'cenar_adobe', 'cenar_capcut', 'cenar_office', 'cenar_youtube',
  'cenar_netflix', 'cenar_gearup', 'cenar_locket', 'cenar_discord'];
const liveInventory = new Collection(liveNames.map((name, index) => {
  const id = String(1550000000000000300n + BigInt(index));
  return [id, { id, name, animated: false }];
}));
const REQUESTED_PRICES = new Map([
  ['chatgpt-plus-direct-payment-1-month-full-warranty', 530000],
  ['chatgpt-pro-100-own-account-1-month-package-warranty', 2650000],
  ['chatgpt-pro-200-own-account-1-month', 4500000],
  ['chatgpt-pro-500-own-account-1-month', 12800000],
  ['claude-pro-1-month', 550000],
]);

beforeAll(() => {
  initDatabase();
  global.discordClient = {
    guilds: { cache: new Collection([GUILD_ID, '1070676180103086132'].map((id) => (
      [id, { id, emojis: { cache: liveInventory } }]
    ))) },
    application: { emojis: { cache: liveInventory } },
  };
});
afterAll(() => {
  global.discordClient = previousClient;
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

describe('Gemini Pro CDK November 2026 launch', () => {
  it('keeps six-month duration distinct from activation-only coverage and optional YouTube Lite', () => {
    const product = getActiveProducts(GUILD_ID).find(p => p.product_key === GEMINI_PRO_CDK_KEY);
    expect(product).toMatchObject({ price: 190000, original_price: 0, duration_months: 6, activation_method: 'OWN_ACCOUNT', login_required: 0, is_active: 1 });
    expect(product.warranty_policy).toBe('Chỉ bảo hành kích hoạt thành công · không bảo hành sau kích hoạt');
    expect(product.description).toContain('lỗi CDK');
    expect(product.description).toContain('https://payments.google.com/');
    expect(product.description).toContain('rời nhóm gia đình Google');
    expect(product.description).toContain('không cam kết đi kèm');
    expect(product.description).toContain('vẫn có thể có quảng cáo');
    expect(product.description).toContain('không phải không giới hạn');
    for (const model of ['Gemini 4 Argon', 'Claude Opus 5.5', 'Claude Sonnet 5.5']) expect(product.description).toContain(model);
    expect(product.quota_value).toBeNull();
    expect(product.virtual_purchase_count).toBe(0);
    const knowledge = generateProductKnowledgeText(GUILD_ID);
    expect(knowledge).toContain(product.description);
    expect(extractRequestedDuration(product.name)).toEqual({ days: null, months: 6 });
    expect(AUTOMATIC_MARKETING_PAUSED).toBe(true);
    expect(AUTOMATIC_PRICE_BOARD_PAUSED).toBe(true);
  });

  it('adds one stable SKU on repeated migrations and preserves existing products and order snapshots', () => {
    const database = new Database(':memory:');
    try {
      database.exec(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'product_catalog'").get().sql);
      seedProductCatalog(database);
      database.prepare('DELETE FROM product_catalog WHERE product_key = ?').run(GEMINI_PRO_CDK_KEY);
      const before = database.prepare('SELECT id, product_key, name, price, description, duration_months, warranty_policy, is_active FROM product_catalog ORDER BY id').all();
      database.exec('CREATE TABLE order_snapshot (product_id INTEGER, duration_months INTEGER, warranty TEXT)');
      database.prepare('INSERT INTO order_snapshot VALUES (?, 12, ?)').run(before[0].id, 'Original warranty');
      const order = database.prepare('SELECT * FROM order_snapshot').get();
      seedProductCatalog(database);
      const product = database.prepare('SELECT * FROM product_catalog WHERE product_key = ?').get(GEMINI_PRO_CDK_KEY);
      seedProductCatalog(database);
      expect(database.prepare('SELECT id FROM product_catalog WHERE product_key = ?').all(GEMINI_PRO_CDK_KEY)).toEqual([{ id: product.id }]);
      expect(database.prepare('SELECT COUNT(*) AS n FROM product_catalog').get().n).toBe(before.length + 1);
      expect(database.prepare('SELECT id, product_key, name, price, description, duration_months, warranty_policy, is_active FROM product_catalog WHERE product_key != ? ORDER BY id').all(GEMINI_PRO_CDK_KEY)).toEqual(before);
      expect(database.prepare('SELECT * FROM order_snapshot').get()).toEqual(order);
      expect(database.prepare('SELECT is_active FROM product_catalog WHERE product_key = ?').get(GEMINI_PRO_CDK_KEY).is_active).toBe(1);
    } finally { database.close(); }
  });

  it('renders limited warranty and mandatory preparation in both locales within Discord limits', () => {
    const products = getActiveProducts(GUILD_ID);
    const product = products.find(p => p.product_key === GEMINI_PRO_CDK_KEY);
    for (const guildId of [GUILD_ID, '1070676180103086132']) {
      const payloads = buildPriceBoardPayloads(guildId, {}, products);
      const components = payloads.flatMap(collectComponents);
      const block = components.find(c => c.type === 10 && c.content.startsWith('### ') && c.content.includes('Gemini Pro 6'));
      expect(block.content).toMatch(/190[.,]000/);
      expect(block.content).toMatch(/kích hoạt thành công|Successful activation only/);
      expect(block.content).toMatch(/không bảo hành sau kích hoạt|no post-activation warranty/);
      expect(block.content).toContain('https://payments.google.com/');
      expect(block.content).toMatch(/không cam kết đi kèm|inclusion is not guaranteed/);
      expect(block.content).not.toMatch(/Full trong suốt thời gian sử dụng|Full coverage for the entire service period/);
      expect(components.filter(c => c.type === 3).flatMap(c => c.options).filter(o => o.value === String(product.id))).toHaveLength(1);
      for (const payload of payloads) {
        const panel = collectComponents(payload);
        expect(panel.reduce((sum, c) => sum + (c.content?.length || 0), 0)).toBeLessThanOrEqual(3800);
        expect(panel.length).toBeLessThanOrEqual(38);
        expect(payload.allowedMentions).toEqual({ parse: [] });
      }
    }
  });
});

describe('November 6 catalog refresh', () => {
  it('lists only the requested AI subscriptions with their existing account and warranty terms', () => {
    const products = getActiveProducts(GUILD_ID);
    const ai = products.filter((row) => /^(ChatGPT|Claude)/i.test(row.name));
    expect(new Map(ai.map(({ product_key, price }) => [product_key, price]))).toEqual(REQUESTED_PRICES);
    for (const product of ai) {
      expect(product).toMatchObject({ duration_months: 1, activation_method: 'OWN_ACCOUNT', quota_value: null });
    }
    const claude = ai.find((p) => p.product_key === 'claude-pro-1-month');
    expect(claude.warranty_policy).toBe('Full 1 tháng · không bảo hành nếu tài khoản bị khóa');
    for (const p of ai.filter((p) => /Pro (200|500)/.test(p.name))) {
      expect(p.warranty_policy).toContain('Xác nhận');
    }
    const gemini = products.find((p) => p.product_key === 'gemini-pro-antigravity-24-months');
    expect(gemini).toMatchObject({ price: 250000, duration_months: 24, warranty_policy: 'Bảo hành 12 tháng' });
    expect(gemini.description).toMatch(/Gemini 4 Argon.*Claude Opus 5.5.*Claude Sonnet 5.5/);
    expect(generateProductKnowledgeText(GUILD_ID)).toContain(gemini.description);
  });

  it('retires legacy offers without dropping rows, order references or retained product IDs', () => {
    const database = new Database(':memory:');
    try {
      database.pragma('foreign_keys = ON');
      database.exec(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'product_catalog'").get().sql);
      const insert = database.prepare("INSERT INTO product_catalog (guild_id, name, product_key, price, duration_months, service_type) VALUES ('WEB', ?, ?, ?, ?, ?)");
      const oldProducts = [
        ['Discord Nitro Boost 12 Tháng (Login)', 'discord-nitro-boost-12-thang-login', 680000, 12, 'GAME'],
        ['Gemini Pro + 5 TB Google One 18 Tháng (Full BH)', 'gemini-pro-google-one-5tb-18-months-full-warranty', 280000, 18, 'AI'],
        ['Spotify Premium 3 Tháng', 'spotify-premium-3-months', 100000, 3, 'spotify'],
        ['YouTube Premium 1 Tháng (Ổn Định Cao)', 'youtube-premium-continuous-1-month', 60000, 1, 'STREAMING'],
        ['YouTube Premium 3 Tháng (Ổn Định Cao)', 'youtube-premium-continuous-3-months', 195000, 3, 'STREAMING'],
        ['ChatGPT Plus UPI Pay 1 Tháng', 'chatgpt-plus-upi-account-1-month-12-hour-warranty', 130000, 1, 'AI'],
        ['Claude Pro x5 Chính Chủ 1 Tháng', 'claude-pro-x5-own-account-1-month-7-day-warranty', 2000000, 1, 'AI'],
      ];
      const oldIds = oldProducts.map((product) => insert.run(...product).lastInsertRowid);
      const youtube = ['YouTube Premium 6 Tháng (Ổn Định Cao)', 'youtube-premium-continuous-6-months', 320000, 6, 'STREAMING'];
      const retained = insert.run(...youtube).lastInsertRowid;
      const duplicate = insert.run(...youtube).lastInsertRowid;
      database.exec('CREATE TABLE historical_orders (product_id INTEGER REFERENCES product_catalog(id), amount INTEGER)');
      database.prepare('INSERT INTO historical_orders VALUES (?, 680000)').run(oldIds[0]);
      seedProductCatalog(database);
      seedProductCatalog(database);
      const find = database.prepare('SELECT price, is_active FROM product_catalog WHERE id = ?');
      oldIds.forEach((id, i) => expect(find.get(id)).toEqual({ price: oldProducts[i][2], is_active: 0 }));
      expect(find.get(retained)).toEqual({ price: 250000, is_active: 1 });
      expect(find.get(duplicate)).toEqual({ price: 320000, is_active: 0 });
      expect(database.prepare('SELECT * FROM historical_orders').get()).toEqual({ product_id: oldIds[0], amount: 680000 });
      expect(database.pragma('foreign_key_check')).toEqual([]);
    } finally {
      database.close();
    }
  });

  it('migrates the prior full Plus tier in place and preserves historical orders on repeated boots', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    try {
      database.exec(db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'product_catalog'").get().sql);
      seedProductCatalog(database);
      const fullKey = 'chatgpt-plus-direct-payment-1-month-full-warranty';
      const original = database.prepare('SELECT * FROM product_catalog WHERE product_key = ?').get(fullKey);
      database.prepare("UPDATE product_catalog SET price = 500000, image_url = 'https://example.com/preserved.webp', virtual_purchase_count = 17 WHERE id = ?").run(original.id);
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
        id: original.id, price: 530000, image_url: 'https://example.com/preserved.webp', virtual_purchase_count: 17,
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
    expect(text).toContain('ChatGPT Plus & Pro');
    const options = panels.filter((component) => component.type === 3).flatMap((component) => component.options);
    for (const key of REQUESTED_PRICES.keys()) {
      const product = products.find((row) => row.product_key === key);
      expect(text).toContain(product.name);
      expect(options.filter((option) => option.value === String(product.id))).toHaveLength(1);
    }
    expect(text).not.toMatch(/UPI Pay|Claude Pro x5|API Codex\/Claude|Spotify Premium 3 Tháng/);
    const groups = groupPriceProducts(products);
    expect(payloads.length).toBeGreaterThanOrEqual(groups.length + 1);
    for (const payload of payloads) {
      const components = collectComponents(payload);
      expect(components.length).toBeLessThanOrEqual(38);
      expect(components.reduce((sum, component) => sum + (component.content?.length || 0), 0)).toBeLessThanOrEqual(3800);
      for (const selector of components.filter((component) => component.type === 3)) {
        expect(selector.options.length).toBeLessThanOrEqual(25);
        expect(selector.options.every((option) => liveInventory.has(option.emoji?.id))).toBe(true);
      }
    }
  });

  it('keeps the same package distinctions and one-month duration in the international board', () => {
    const payloads = buildPriceBoardPayloads('1070676180103086132', {}, getActiveProducts(GUILD_ID));
    const components = payloads.flatMap(collectComponents);
    const text = components.filter((component) => component.type === 10).map((component) => component.content).join('\n');
    expect(text).toContain('ChatGPT Plus & Pro');
    expect(text).toContain('Subscription coverage for 1 month; the account is excluded');
    expect(text).toContain('Confirm warranty coverage with the shop before buying');
    expect(text).not.toMatch(/UPI Pay|Claude Pro x5|API Codex\/Claude/);
    for (const payload of payloads) {
      const panel = collectComponents(payload);
      expect(panel.reduce((sum, component) => sum + (component.content?.length || 0), 0)).toBeLessThanOrEqual(3800);
      expect(panel.length).toBeLessThanOrEqual(38);
    }
  });
});

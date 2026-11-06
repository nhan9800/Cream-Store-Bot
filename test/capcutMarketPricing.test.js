import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(process.env, {
  ENV_FILE: '.env.capcut-market-test-absent', DATABASE_PATH: `./data/test-capcut-market-${process.pid}-${Date.now()}.sqlite`,
}));
import { db, initDatabase } from '../src/database/db.js';
import { CAPCUT_PRODUCT_KEYS, capcutPriceSetting, parseCapcutPrice } from '../src/config/capcutCatalog.js';
import { assertCapcutPurchaseQuote, getCapcutPriceProduct, getEditableCapcutProducts, updateCapcutPrice } from '../src/services/capcutPricingService.js';
import { getActiveProducts } from '../src/services/productCatalogService.js';
import { createTicket } from '../src/services/ticketService.js';
import { createOrder, getOrderByCode } from '../src/services/orderService.js';

const guildId = '1282637033340403754', customerId = '1555555555555555555';
beforeAll(() => initDatabase());
beforeEach(() => {
  db.prepare("DELETE FROM system_settings WHERE key LIKE 'capcut:price:%'").run();
  initDatabase();
});
afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${process.env.DATABASE_PATH}${suffix}`, { force: true });
});

describe('CapCut persistent retail prices and Locket retail update', () => {
  it('retains exactly the three current CapCut offers and sets both Locket pricing fields to 80k', () => {
    const capcut = getEditableCapcutProducts();
    expect(capcut.map(product => product.product_key).sort()).toEqual([...CAPCUT_PRODUCT_KEYS].sort());
    expect(capcut.map(product => product.price)).toEqual([100000, 20000, 1250000]);
    expect(capcut.every(product => product.ctv_price === null)).toBe(true);
    const locket = getActiveProducts(guildId).find(product => product.product_key === 'locket-gold-1-nam');
    expect(locket).toMatchObject({ price: 80000, base_price: 80000, duration_months: 12, activation_method: 'USERNAME' });
  });

  it('rejects shorthand, invalid money, foreign products and inactive/forged product IDs without writes', () => {
    const capcut = getEditableCapcutProducts()[0];
    for (const value of ['100k', '100.000', '-1', '0', '999', '100.5', '1e6', '100000000', 'NaN']) {
      expect(() => parseCapcutPrice(value)).toThrow();
      expect(() => updateCapcutPrice(capcut.id, value, capcut.price, customerId)).toThrow();
    }
    for (const id of ['bad', 0, -1, '99999999999']) expect(() => getCapcutPriceProduct(id)).toThrow();
    const other = getActiveProducts(guildId).find(product => !CAPCUT_PRODUCT_KEYS.includes(product.product_key));
    expect(() => updateCapcutPrice(other.id, '120000', other.price, customerId)).toThrow(/CapCut/);
    db.prepare('UPDATE product_catalog SET is_active=0 WHERE id=?').run(capcut.id);
    expect(() => updateCapcutPrice(capcut.id, '120000', capcut.price, customerId)).toThrow(/CapCut/);
    expect(db.prepare("SELECT COUNT(*) AS count FROM system_settings WHERE key LIKE 'capcut:price:%'").get().count).toBe(0);
  });

  it('persists all three Admin edits through reseeding and changes no other product fields or offers', () => {
    const before = getActiveProducts(guildId);
    const products = getEditableCapcutProducts();
    const updatedPrices = [120000, 25000, 1300000];
    products.forEach((product, index) => {
      const updated = updateCapcutPrice(product.id, String(updatedPrices[index]), product.price, customerId);
      const { price: ignoredPrice, updated_at: ignoredTime, ...otherBefore } = product;
      const { price: newPrice, updated_at: newTime, ...otherAfter } = updated;
      expect(otherAfter).toEqual(otherBefore);
      expect(db.prepare('SELECT value FROM system_settings WHERE key=?').get(capcutPriceSetting(product.product_key)).value).toBe(String(newPrice));
    });
    initDatabase();
    expect(getEditableCapcutProducts().map(product => product.price)).toEqual(updatedPrices);
    const commercial = product => ({ id: product.id, name: product.name, price: product.price, ctv_price: product.ctv_price,
      base_price: product.base_price, duration_months: product.duration_months, is_active: product.is_active });
    expect(getActiveProducts(guildId).filter(product => !CAPCUT_PRODUCT_KEYS.includes(product.product_key)).map(commercial))
      .toEqual(before.filter(product => !CAPCUT_PRODUCT_KEYS.includes(product.product_key)).map(commercial));
  });

  it('rejects a stale Admin edit and purchase quote while preserving earlier order amounts', () => {
    const product = getEditableCapcutProducts()[0];
    const order = amount => {
      const ticket = createTicket({ guildId, channelId: `fixture-${Math.random()}`, customerId, openedById: customerId });
      return createOrder({ guildId, ticketId: ticket.id, ticketChannelId: ticket.channel_id, customerId,
        productId: product.id, productName: product.name, serviceType: product.service_type, quantity: 1,
        totalAmount: amount, durationMonths: product.duration_months, orderLogChannelId: 'fixture-log', createdById: customerId });
    };
    const old = order(100000);
    updateCapcutPrice(product.id, '120000', 100000, customerId);
    expect(() => updateCapcutPrice(product.id, '130000', 100000, customerId)).toThrow(/Admin khác/);
    expect(() => assertCapcutPurchaseQuote(product.id, 100000)).toThrow(/chưa tạo đơn hoặc trừ ví/);
    expect(() => assertCapcutPurchaseQuote(product.id, undefined)).toThrow();
    expect(assertCapcutPurchaseQuote(product.id, 120000)).toBe(120000);
    const current = order(120000);
    initDatabase();
    expect(getOrderByCode(old.order_code).total_amount).toBe(100000);
    expect(getOrderByCode(current.order_code).total_amount).toBe(120000);
  });

  it('keeps existing CTV prices separate and validates the effective quoted price', () => {
    const product = getEditableCapcutProducts()[0];
    db.prepare('UPDATE product_catalog SET ctv_price=75000 WHERE id=?').run(product.id);
    updateCapcutPrice(product.id, '120000', 100000, customerId);
    expect(getCapcutPriceProduct(product.id).ctv_price).toBe(75000);
    expect(assertCapcutPurchaseQuote(product.id, 75000, true)).toBe(75000);
    expect(() => assertCapcutPurchaseQuote(product.id, 100000, true)).toThrow();
  });
});

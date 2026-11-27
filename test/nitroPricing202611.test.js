import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PRODUCT_CATALOG } from '../src/database/db.js';
import {
  hasPriorNitroPurchase, isNitroRenewalProduct, NITRO_2M_KEY, NITRO_2M_PRODUCT, NITRO_2M_RENEWAL_KEY,
  NITRO_2M_RENEWAL_PRODUCT, NITRO_2M_RETIRED_KEY,
} from '../src/config/nitroPricing202611.js';

describe('Nitro 2-month pricing (2026-11-28)', () => {
  it('seeds one 115k plan, the 100k returning-customer renewal and retires the 136k plan', () => {
    const seed = (key) => DEFAULT_PRODUCT_CATALOG.find((product) => product.product_key === key);
    expect(seed(NITRO_2M_KEY)).toMatchObject({ price: 115000, name: NITRO_2M_PRODUCT.name, description: NITRO_2M_PRODUCT.description });
    expect(seed(NITRO_2M_RENEWAL_KEY)).toMatchObject({ price: 100000, name: NITRO_2M_RENEWAL_PRODUCT.name });
    expect(seed(NITRO_2M_RETIRED_KEY)).toBeUndefined();
    expect(NITRO_2M_PRODUCT.description).toContain('20–30 phút');
    expect(isNitroRenewalProduct({ product_key: NITRO_2M_RENEWAL_KEY })).toBe(true);
  });

  it('lets only customers with a paid, kept Nitro Boost order buy the renewal', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE orders(customer_id TEXT, product_name TEXT, payment_status TEXT, status TEXT)');
    const add = (customer, name, status = 'COMPLETED', payment = 'PAID') => db.prepare('INSERT INTO orders VALUES (?,?,?,?)').run(customer, name, payment, status);
    add('old', 'Discord Nitro Boost 2 Tháng (Login · Giữ Mail 7 Ngày)');
    add('refunded', 'Discord Nitro Boost 1 Tháng (Login)', 'REFUNDED');
    add('unpaid', 'Discord Nitro Boost 1 Tháng (Login)', 'PENDING_PAYMENT', 'UNPAID');
    add('decor', 'Decor Discord (Acc Có Nitro) - Gói 25k');
    add('warranty', 'Discord Nitro Boost 12 Tháng (Login · Chính Chủ)', 'WARRANTY_OPEN');
    expect(hasPriorNitroPurchase(db, 'old')).toBe(true);
    expect(hasPriorNitroPurchase(db, 'warranty')).toBe(true);
    for (const customer of ['refunded', 'unpaid', 'decor', 'nobody', 'WEB', null]) expect(hasPriorNitroPurchase(db, customer)).toBe(false);
    db.close();
  });
});

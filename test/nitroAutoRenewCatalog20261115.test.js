import fs from 'node:fs';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(process.env, {
  ENV_FILE: '.env.nitro-auto-renew-test-not-present',
  DATABASE_PATH: `./data/test-nitro-auto-renew-${process.pid}-${Date.now()}.sqlite`,
  ENCRYPTION_KEY: 'synthetic-nitro-auto-renew-key',
}));

import { db, initDatabase, seedProductCatalog } from '../src/database/db.js';
import { buildDeliverySubscriptionInput } from '../src/services/deliverySubscriptionService.js';
import { getSubscriptionProgress } from '../src/services/subscriptionService.js';

const key = 'discord-nitro-boost-12-months-auto-renew-2-months';
const oldYearKey = 'discord-nitro-boost-1-nam-login';

beforeAll(() => initDatabase());
afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(process.env.DATABASE_PATH + suffix, { force: true });
});

describe('Nitro annual package with two-month service cycles', () => {
  it('seeds the new 650k annual variant once while preserving the existing 850k package and retired 680k order history', () => {
    const database = new Database(':memory:');
    database.pragma('foreign_keys = ON');
    try {
      database.exec(db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='product_catalog'").get().sql);
      const insert = database.prepare(`INSERT INTO product_catalog
        (guild_id,name,price,duration_months,service_type,emoji,product_key,is_active,sort_order)
        VALUES('WEB',?,?,12,'GAME','brand_nitro',?,1,1)`);
      const oldYearId = Number(insert.run('Discord Nitro Boost 12 Tháng (Login · Chính Chủ)', 850000, oldYearKey).lastInsertRowid);
      const retiredId = Number(insert.run('Discord Nitro Boost 12 Tháng (Login)', 680000, 'discord-nitro-boost-12-thang-login').lastInsertRowid);
      database.exec('CREATE TABLE historical_orders(id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL REFERENCES product_catalog(id),total_amount INTEGER NOT NULL)');
      database.prepare('INSERT INTO historical_orders VALUES(1,?,680000)').run(retiredId);

      seedProductCatalog(database);
      const first = database.prepare('SELECT * FROM product_catalog WHERE product_key=?').get(key);
      seedProductCatalog(database);
      const rows = database.prepare('SELECT * FROM product_catalog WHERE product_key=?').all(key);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: first.id, price: 650000, duration_months: 12, service_type: 'GAME',
        is_active: 1, original_price: 0, activation_method: 'OWN_ACCOUNT', ctv_price: null, warranty_policy: null });
      expect(rows[0].name).toContain('12 Tháng'); expect(rows[0].name).toContain('2 Tháng/Lần');
      expect(rows[0].description).toContain('650.000đ cho toàn bộ 12 tháng');
      expect(rows[0].description).toContain('6 kỳ, mỗi kỳ 2 tháng');
      expect(database.prepare('SELECT id,price,is_active FROM product_catalog WHERE product_key=?').get(oldYearKey))
        .toEqual({ id: oldYearId, price: 850000, is_active: 1 });
      expect(database.prepare('SELECT id,price,is_active FROM product_catalog WHERE id=?').get(retiredId))
        .toEqual({ id: retiredId, price: 680000, is_active: 0 });
      expect(database.prepare('SELECT * FROM historical_orders').get()).toEqual({ id: 1, product_id: retiredId, total_amount: 680000 });
      expect(database.pragma('foreign_key_check')).toEqual([]);
    } finally { database.close(); }
  });

  it('builds twelve months of service as six two-month cycles from the actual catalog product', () => {
    const product = db.prepare('SELECT * FROM product_catalog WHERE product_key=?').get(key);
    const input = buildDeliverySubscriptionInput({ order: { guild_id: '1282637033340403754',
      order_code: 'CN_612650', customer_id: '1138315103821889566', product_name: product.name,
      service_type: product.service_type, duration_months: product.duration_months, total_amount: product.price,
      delivered_at: '2026-11-15T00:00:00.000Z' }, gmailEmail: 'synthetic@example.invalid', gmailPassword: 'synthetic-private-fixture' });
    expect(input).toMatchObject({ serviceType: 'nitro', renewalMode: 'auto_cycle', totalDurationMonths: 12,
      renewalCycleMonths: 2, purchaseDate: '2026-11-15T00:00:00.000Z' });
    const progress = getSubscriptionProgress({ total_duration_months: input.totalDurationMonths,
      renewal_mode: input.renewalMode, renewal_cycle_months: input.renewalCycleMonths, times_renewed: 0 });
    expect(progress).toMatchObject({ totalMonths: 12, cycleMonths: 2, totalCycles: 6, completedCycles: 1,
      fulfilledMonths: 2, remainingMonths: 10, nextCycleNumber: 2 });
  });
});

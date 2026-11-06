import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(process.env, {
  ENV_FILE: '.env.market-pricing-test-absent',
  DATABASE_PATH: `./data/test-boost-market-${process.pid}-${Date.now()}.sqlite`,
}));
import { db, initDatabase } from '../src/database/db.js';
import { getBoostPrice, updateBoostPrice } from '../src/services/boostPricingService.js';
import { getBoostPackage, createBoostOrder, getBoostOrderByCode } from '../src/services/boostServerService.js';
import { parseBoostPrice } from '../src/config/boostCatalog.js';

beforeAll(() => initDatabase());
afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${process.env.DATABASE_PATH}${suffix}`, { force: true });
});
const details = { guildId:'1282637033340403754', customerId:'1555555555555555555', serverId:'1666666666666666666', serverLink:'https://discord.gg/example', packageKey:'3m' };

describe('Boost market pricing', () => {
  it('rejects the retired one-month controls and invalid prices', () => {
    expect(getBoostPackage('1m')).toBeNull();
    expect(() => createBoostOrder({ ...details, packageKey:'1m' })).toThrow();
    for (const value of ['320k', '320.000', '-1', '100.5', '1e6', '0', '999', '100000000', 'NaN']) expect(() => parseBoostPrice(value)).toThrow();
    expect(parseBoostPrice(' 320000 ')).toBe(320000);
  });

  it('shares a durable price with catalog/order creation and preserves earlier invoices through reseeding', () => {
    const old = createBoostOrder({ ...details, expectedPrice:320000 });
    expect(updateBoostPrice('350000', 320000, '1555555555555555555')).toBe(350000);
    expect(getBoostPackage('3m').price).toBe(350000);
    expect(() => updateBoostPrice('360000', 320000, '1555555555555555555')).toThrow(/Admin khác/);
    expect(() => createBoostOrder({ ...details, expectedPrice:320000 })).toThrow(/Giá đã thay đổi/);
    const current = createBoostOrder({ ...details, expectedPrice:350000 });
    expect(current.amount).toBe(350000);
    initDatabase();
    expect(getBoostPrice()).toBe(350000);
    expect(getBoostOrderByCode(old.order_code).amount).toBe(320000);
    expect(getBoostOrderByCode(current.order_code).amount).toBe(350000);
    expect(db.prepare("SELECT COUNT(*) AS count FROM product_catalog WHERE is_active=1 AND product_key='discord-server-boost-14-1-month'").get().count).toBe(0);
  });
});

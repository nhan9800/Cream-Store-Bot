import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Run the production aggregation against real SQLite, without loading any
// configured bot database or copying customer/order data.
vi.mock('../src/database/db.js', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE orders (
    guild_id TEXT, customer_id TEXT, payment_status TEXT, status TEXT,
    amount_paid INTEGER, paid_at TEXT, created_at TEXT
  )`);
  return { db };
});

import { db } from '../src/database/db.js';
import { getLeaderboardRows } from '../src/services/leaderboardService.js';

const guildId = 'calendar-test-store';
function order(customerId, paidAt, overrides = {}) {
  const row = {
    guild_id: guildId, customer_id: customerId, payment_status: 'PAID',
    status: 'COMPLETED', amount_paid: 100000,
    paid_at: paidAt, created_at: '2026-01-01T00:00:00.000Z', ...overrides,
  };
  db.prepare(`INSERT INTO orders
    (guild_id, customer_id, payment_status, status, amount_paid, paid_at, created_at)
    VALUES (@guild_id, @customer_id, @payment_status, @status, @amount_paid, @paid_at, @created_at)`)
    .run(row);
}
const monthly = now => getLeaderboardRows(guildId, 'monthly', new Date(now), 50);

beforeEach(() => db.prepare('DELETE FROM orders').run());
afterAll(() => db.close());

describe('monthly paid rankings on the Vietnam calendar', () => {
  it('switches exactly at Vietnam midnight on the last day of a month', () => {
    order('october', '2026-10-31T16:59:59.999Z');
    order('november', '2026-10-31T17:00:00.000Z');

    const before = monthly('2026-10-31T16:59:59.999Z');
    const after = monthly('2026-10-31T17:00:00.000Z');
    expect(before.bounds.label).toBe('10/2026');
    expect(before.rows.map(row => row.customer_id)).toEqual(['october']);
    expect(after.bounds.label).toBe('11/2026');
    expect(after.bounds.start).toBe('2026-10-31T17:00:00.000Z');
    expect(after.rows.map(row => row.customer_id)).toEqual(['november']);
  });

  it('switches from December to January without retaining last year totals', () => {
    order('december', '2026-12-31T16:59:59.999Z', { amount_paid: 800000 });
    order('january', '2026-12-31T17:00:00.000Z', { amount_paid: 200000 });

    const before = monthly('2026-12-31T16:59:59.999Z');
    const after = monthly('2026-12-31T17:00:00.000Z');
    expect(before.bounds.label).toBe('12/2026');
    expect(before.rows).toMatchObject([{ customer_id: 'december', total_spent: 800000 }]);
    expect(after.bounds).toMatchObject({
      label: '01/2027', start: '2026-12-31T17:00:00.000Z', end: '2027-01-31T17:00:00.000Z',
    });
    expect(after.rows).toMatchObject([{ customer_id: 'january', total_spent: 200000 }]);
  });

  it('attributes totals to payment time and falls back to creation only for legacy missing payment time', () => {
    order('returning', '2026-11-05T08:00:00.000Z', { amount_paid: 200000 });
    order('returning', '2026-11-06T08:00:00.000Z', { amount_paid: 300000 });
    order('legacy', null, { created_at: '2026-11-02 10:00:00', amount_paid: 120000 });
    order('paid-in-october', '2026-10-20T08:00:00.000Z', { created_at: '2026-11-01T08:00:00.000Z' });

    expect(monthly('2026-11-15T08:00:00.000Z').rows).toMatchObject([
      { customer_id: 'returning', orders: 2, total_spent: 500000 },
      { customer_id: 'legacy', orders: 1, total_spent: 120000 },
    ]);
    expect(monthly('2026-11-15T08:00:00.000Z').rows).toHaveLength(2);
  });

  it('excludes other stores, cancelled/refunded, unpaid and nonpositive rows while keeping paid processing orders', () => {
    const paidAt = '2026-11-05T08:00:00.000Z';
    order('valid', paidAt, { status: 'PROCESSING', amount_paid: 400000 });
    order('other-store', paidAt, { guild_id: 'other-test-store' });
    order('cancelled', paidAt, { status: 'CANCELLED' });
    order('refunded', paidAt, { status: 'REFUNDED' });
    order('unpaid', paidAt, { payment_status: 'UNPAID' });
    order('zero', paidAt, { amount_paid: 0 });
    order('negative', paidAt, { amount_paid: -100000 });

    expect(monthly('2026-11-15T08:00:00.000Z').rows).toEqual([
      { customer_id: 'valid', orders: 1, total_spent: 400000, last_order_at: paidAt },
    ]);
  });
});

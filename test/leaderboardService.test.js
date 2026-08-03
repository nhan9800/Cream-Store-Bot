import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ sql: '', params: [], rows: [] }));

vi.mock('../src/database/db.js', () => ({
  db: {
    prepare: vi.fn((sql) => {
      state.sql = sql.replace(/\s+/g, ' ').trim();
      return {
        all: (...params) => {
          state.params = params;
          return state.rows;
        },
      };
    }),
  },
}));

const {
  getLeaderboardPeriodBounds,
  getLeaderboardRows,
} = await import('../src/services/leaderboardService.js');

describe('leaderboard periods and paid order query', () => {
  beforeEach(() => {
    state.sql = '';
    state.params = [];
    state.rows = [];
  });

  it('uses the August calendar month in Vietnam time', () => {
    const bounds = getLeaderboardPeriodBounds('monthly', new Date('2026-08-03T12:00:00.000Z'));

    expect(bounds).toEqual({
      period: 'monthly',
      start: '2026-07-31T17:00:00.000Z',
      end: '2026-08-31T17:00:00.000Z',
      label: '08/2026',
    });
  });

  it('ranks by payment time and scopes results to the store guild', () => {
    state.rows = [{ customer_id: 'customer-1', orders: 1, total_spent: 460_000 }];
    const result = getLeaderboardRows(
      'guild-cenar',
      'monthly',
      new Date('2026-08-03T12:00:00.000Z'),
      50,
    );

    expect(state.sql).toContain('guild_id = ?');
    expect(state.sql).toContain("payment_status = 'PAID'");
    expect(state.sql).toContain('COALESCE(paid_at, created_at)');
    expect(state.sql).toContain('amount_paid > 0');
    expect(state.params).toEqual([
      'guild-cenar',
      '2026-07-31T17:00:00.000Z',
      '2026-08-31T17:00:00.000Z',
      50,
    ]);
    expect(result.rows).toEqual(state.rows);
  });
});

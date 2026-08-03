import { db } from '../database/db.js';

// Payment timestamps are stored as UTC ISO strings. The shop reports calendar
// periods in Vietnam time so a payment near midnight is attributed correctly.
export const LEADERBOARD_TIME_ZONE = 'Asia/Ho_Chi_Minh';

function zonedParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LEADERBOARD_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return Object.fromEntries(parts
    .filter(({ type }) => type !== 'literal')
    .map(({ type, value }) => [type, Number(value)]));
}

function localMidnightUtc(year, month, day) {
  // Asia/Ho_Chi_Minh is UTC+07:00 and has no DST transitions.
  return new Date(Date.UTC(year, month - 1, day) - 7 * 60 * 60 * 1000).toISOString();
}

/**
 * Resolve a ranking period to an inclusive start and exclusive end.
 * Monthly periods are calendar months (not a rolling 30-day window).
 */
export function getLeaderboardPeriodBounds(period = 'monthly', now = new Date()) {
  const local = zonedParts(now);

  if (period === 'monthly') {
    const start = localMidnightUtc(local.year, local.month, 1);
    const end = local.month === 12
      ? localMidnightUtc(local.year + 1, 1, 1)
      : localMidnightUtc(local.year, local.month + 1, 1);
    return { period, start, end, label: `${String(local.month).padStart(2, '0')}/${local.year}` };
  }

  if (period === 'weekly') {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return { period, start, end: null, label: '7 ngày gần nhất' };
  }

  return { period: 'all', start: null, end: null, label: 'mọi thời đại' };
}

/**
 * Return paid customer totals for one guild and one period.
 * `paid_at` is authoritative; legacy rows without it fall back to created_at.
 */
export function getLeaderboardRows(guildId, period = 'monthly', now = new Date(), limit = 50) {
  const safeLimit = Math.min(50, Math.max(1, Number.parseInt(limit, 10) || 10));
  const bounds = getLeaderboardPeriodBounds(period, now);
  const predicates = [
    'guild_id = ?',
    "payment_status = 'PAID'",
    "status <> 'CANCELLED'",
    'amount_paid > 0',
  ];
  const params = [guildId];

  if (bounds.start) {
    predicates.push("datetime(COALESCE(paid_at, created_at)) >= datetime(?)");
    params.push(bounds.start);
  }
  if (bounds.end) {
    predicates.push("datetime(COALESCE(paid_at, created_at)) < datetime(?)");
    params.push(bounds.end);
  }

  const rows = db.prepare(`
    SELECT customer_id,
           COUNT(*) AS orders,
           COALESCE(SUM(amount_paid), 0) AS total_spent,
           MAX(COALESCE(paid_at, created_at)) AS last_order_at
    FROM orders
    WHERE ${predicates.join(' AND ')}
    GROUP BY customer_id
    ORDER BY total_spent DESC, last_order_at DESC, customer_id ASC
    LIMIT ?
  `).all(...params, safeLimit);

  return { rows, bounds };
}

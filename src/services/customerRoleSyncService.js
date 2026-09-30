import { db, nowIso } from '../database/db.js';
import { config } from '../config.js';
import { listActivityCustomers } from './customerActivityService.js';

const inFlight = new Map();
const snowflake = (value) => /^\d{15,22}$/.test(String(value || ''));
let lastBackfill = null;
let lastRun = null;

// Operational evidence only: never expose order/customer IDs in public health.
export function getCustomerRoleSyncState() {
  let queue = null;
  try {
    queue = db.prepare(`SELECT
      COALESCE(SUM(status = 'PENDING'), 0) AS pending,
      COALESCE(SUM(status = 'SYNCED'), 0) AS synced,
      COALESCE(SUM(status = 'PENDING' AND last_error = 'MEMBER_NOT_FOUND'), 0) AS awaitingMember,
      COALESCE(SUM(status = 'PENDING' AND last_error IS NOT NULL AND last_error != 'MEMBER_NOT_FOUND'), 0) AS failed
      FROM customer_role_sync_jobs WHERE guild_id = ?`).get(config.guildId);
    queue.errors = db.prepare(`SELECT last_error AS code, COUNT(*) AS count FROM customer_role_sync_jobs
      WHERE guild_id = ? AND status = 'PENDING' AND last_error IS NOT NULL
      GROUP BY last_error ORDER BY count DESC LIMIT 5`).all(config.guildId);
  } catch { /* Readiness can be probed before database initialization. */ }
  return { lastBackfill, lastRun, queue };
}

export function queueCustomerRoleSync(guildId, customerId, { preservePending = false } = {}) {
  if (!snowflake(guildId) || !snowflake(customerId)) return false;
  const now = nowIso();
  db.prepare(`INSERT INTO customer_role_sync_jobs (guild_id, customer_id, retry_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, customer_id) DO UPDATE SET status = 'PENDING',
      revision = revision + 1, attempts = 0, retry_at = excluded.retry_at, updated_at = excluded.updated_at
    ${preservePending ? "WHERE customer_role_sync_jobs.status != 'PENDING'" : ''}`)
    .run(String(guildId), String(customerId), now, now);
  return true;
}

export function backfillCustomerRoleSync(guildId = config.guildId) {
  const purchases = db.prepare(`SELECT DISTINCT guild_id, customer_id FROM orders
    WHERE guild_id = ? AND payment_status = 'PAID'
      AND status NOT IN ('CANCELLED', 'REFUNDED') AND total_amount > 0 AND amount_paid >= total_amount`)
    .all(guildId);
  const customers = new Map([...purchases, ...listActivityCustomers().filter((row) => row.guild_id === guildId)]
    .map((row) => [`${row.guild_id}:${row.customer_id}`, row]));
  let queued = 0;
  db.transaction(() => {
    for (const row of customers.values()) {
      if (queueCustomerRoleSync(row.guild_id, row.customer_id, { preservePending: true })) queued++;
    }
  })();
  lastBackfill = { scanned: customers.size, queued, at: nowIso() };
  return lastBackfill;
}

export async function syncCustomerRolesNow(client, guildId, customerId) {
  const key = `${guildId}:${customerId}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const run = async () => {
    const job = db.prepare('SELECT * FROM customer_role_sync_jobs WHERE guild_id = ? AND customer_id = ?')
      .get(guildId, customerId);
    if (!job || job.status !== 'PENDING') return { synced: false, skipped: true };
    let result;
    try {
      const guild = client?.guilds?.cache?.get(guildId) || await client?.guilds?.fetch?.(guildId);
      if (!guild) throw Object.assign(new Error('Guild unavailable'), { code: 'GUILD_UNAVAILABLE' });
      const { applyCustomerRoles } = await import('./roleService.js');
      result = await applyCustomerRoles(guild, customerId, { retryOnFailure: false });
    } catch (error) {
      result = { synced: false, error: String(error.code || 'DISCORD_UNAVAILABLE') };
    }
    const error = result.error || result.failed?.[0]?.error || 'ROLE_SYNC_FAILED';
    const attempts = job.attempts + 1;
    const delayMinutes = error === 'MEMBER_NOT_FOUND' ? 60 : Math.min(60, 2 ** Math.min(attempts, 6));
    const now = nowIso();
    const saved = db.prepare(`UPDATE customer_role_sync_jobs SET status = ?, attempts = ?,
      retry_at = ?, last_error = ?, updated_at = ? WHERE guild_id = ? AND customer_id = ? AND revision = ?`)
      .run(result.synced ? 'SYNCED' : 'PENDING', attempts,
        result.synced ? now : new Date(Date.now() + delayMinutes * 60_000).toISOString(),
        result.synced ? null : String(error).slice(0, 80), now, guildId, customerId, job.revision);
    // An order changed while Discord was responding. Keep the newer job pending.
    return { ...result, synced: Boolean(result.synced && saved.changes), pending: !result.synced || !saved.changes };
  };
  const promise = run().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export async function processPendingCustomerRoles(client, { guildId = config.guildId, limit = 25 } = {}) {
  const jobs = db.prepare(`SELECT guild_id, customer_id FROM customer_role_sync_jobs
    WHERE guild_id = ? AND status = 'PENDING' AND retry_at <= ? ORDER BY retry_at, customer_id LIMIT ?`)
    .all(guildId, nowIso(), Math.min(100, Math.max(1, Number(limit) || 25)));
  const report = { scanned: jobs.length, synced: 0, pending: 0 };
  for (const job of jobs) {
    const result = await syncCustomerRolesNow(client, job.guild_id, job.customer_id);
    if (result.synced) report.synced++;
    else report.pending++;
  }
  lastRun = { ...report, at: nowIso() };
  return report;
}

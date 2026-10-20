import { createHash } from 'node:crypto';
import { db, nowIso } from '../database/db.js';
import { config } from '../config.js';
import { BUYER_TIERS } from '../config/membershipProgram.js';

const inFlight = new Map();
const snowflake = (value) => /^\d{15,22}$/.test(String(value || ''));
const RECONCILE_AFTER_MS = 24 * 60 * 60_000;
let lastBackfill = null;
let lastRun = null;

function rolePolicySignature(guildId) {
  const settings = db.prepare(`SELECT customer_role_id, vip_role_id, blacklist_role_id
    FROM guild_settings WHERE guild_id = ?`).get(guildId) || {};
  return createHash('sha256').update(JSON.stringify({
    // Bump when eligibility rules change without changing tier/config values.
    version: 1,
    settings,
    tiers: BUYER_TIERS.map(({ id, minSpent, requireActivity }) => ({ id, minSpent, requireActivity })),
  })).digest('hex');
}

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
  const saved = db.prepare(`INSERT INTO customer_role_sync_jobs (guild_id, customer_id, retry_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, customer_id) DO UPDATE SET status = 'PENDING',
      revision = revision + 1, attempts = 0, retry_at = excluded.retry_at, updated_at = excluded.updated_at
    ${preservePending ? "WHERE customer_role_sync_jobs.status != 'PENDING'" : ''}`)
    .run(String(guildId), String(customerId), now, now);
  return saved.changes > 0;
}

export function backfillCustomerRoleSync(guildId = config.guildId, { force = false } = {}) {
  // Include former purchasers as well as current ones. Filtering eligibility
  // here would miss stale roles after a historical refund/cancellation. The
  // role service alone decides which roles each customer's live data earns.
  const selectHistory = db.prepare(`SELECT history.customer_id, jobs.status, jobs.updated_at FROM (
    SELECT customer_id FROM orders WHERE guild_id = @guildId
    UNION SELECT customer_id FROM viotp_orders WHERE guild_id = @guildId
    UNION SELECT customer_id FROM card_charging_orders WHERE guild_id = @guildId
    UNION SELECT customer_id FROM card_buy_orders WHERE guild_id = @guildId
    UNION SELECT customer_id FROM customer_role_sync_jobs WHERE guild_id = @guildId
    ) AS history LEFT JOIN customer_role_sync_jobs AS jobs
      ON jobs.guild_id = @guildId AND jobs.customer_id = history.customer_id`);
  let history;
  let customers;
  let queued = 0;
  let unchanged = 0;
  let pending = 0;
  let policyChanged = false;
  const now = nowIso();
  const cutoff = Date.parse(now) - RECONCILE_AFTER_MS;
  db.transaction(() => {
    history = selectHistory.all({ guildId });
    customers = history.filter((row) => snowflake(guildId) && snowflake(row.customer_id));
    const policyKey = `customer-role-sync-policy:${guildId}`;
    const signature = rolePolicySignature(guildId);
    policyChanged = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(policyKey)?.value !== signature;
    const invalidatePending = db.prepare(`UPDATE customer_role_sync_jobs SET revision = revision + 1
      WHERE guild_id = ? AND customer_id = ? AND status = 'PENDING'`);
    for (const row of customers) {
      if (row.status === 'PENDING') {
        // Never restart an absent member's backoff. Invalidate an in-flight
        // result only when the policy changes, retaining attempts and due time.
        if (policyChanged) {
          invalidatePending.run(guildId, row.customer_id);
        }
        pending++;
        continue;
      }
      // SYNCED.updated_at is the successful Discord check, not the last scan.
      // Read SQLite on every invocation: restarts cannot reset this window.
      if (!force && !policyChanged && row.status === 'SYNCED' && Date.parse(row.updated_at) > cutoff) {
        unchanged++;
        continue;
      }
      if (queueCustomerRoleSync(guildId, row.customer_id, { preservePending: true })) queued++;
    }
    db.prepare(`INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      WHERE system_settings.value IS NOT excluded.value`).run(policyKey, signature, now);
  }).immediate();
  lastBackfill = { scanned: customers.length, queued, unchanged, pending,
    skipped: history.length - customers.length, policyChanged, at: now };
  return lastBackfill;
}

export async function syncCustomerRolesNow(client, guildId, customerId, { notify = true } = {}) {
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
      result = await applyCustomerRoles(guild, customerId, { retryOnFailure: false, notify });
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
    const result = await syncCustomerRolesNow(client, job.guild_id, job.customer_id, { notify: false });
    if (result.synced) report.synced++;
    else report.pending++;
  }
  lastRun = { ...report, at: nowIso() };
  return report;
}

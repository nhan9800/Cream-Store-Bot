import { createHash, randomUUID } from 'node:crypto';

const MAX_RETRY_AT = Number.MAX_SAFE_INTEGER;
const DEFAULT_WAIT_MS = 60_000;
const hash = value => createHash('sha256').update(String(value)).digest('hex');
export class DiscordOAuthRequestError extends Error {
  constructor(code, { status = null, retryAfterMs = null } = {}) {
    super(code === 'RATE_LIMITED' ? 'Discord OAuth rate limited' : 'Discord OAuth request incomplete');
    this.name = 'DiscordOAuthRequestError'; this.code = code; this.status = status; this.retryAfterMs = retryAfterMs;
  }
}
function boundedWait(value) {
  const seconds = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  if (seconds === Infinity) return Infinity;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const milliseconds = Math.ceil(seconds * 1000);
  // Unrepresentable provider waits fail closed rather than becoming a short
  // fallback or silently retrying before Discord's stated deadline.
  return Number.isSafeInteger(milliseconds) ? Math.max(1000, milliseconds) : Infinity;
}
function headerWait(response, now) {
  const raw = response.headers?.get?.('retry-after');
  const seconds = boundedWait(raw);
  if (seconds !== null) return seconds;
  const time = typeof raw === 'string' ? Date.parse(raw) : NaN;
  return Number.isFinite(time) && time >= now ? Math.max(1000, time - now) : null;
}
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}
async function boundedJson(response, signal, maximum) {
  const reader = response.body?.getReader?.();
  if (!reader) throw new DiscordOAuthRequestError('INVALID_RESPONSE', { status: response.status });
  const declared = Number(response.headers?.get?.('content-length'));
  let size = 0, complete = false;
  const chunks = [];
  try {
    if (Number.isFinite(declared) && declared > maximum) throw new DiscordOAuthRequestError('INVALID_RESPONSE', { status: response.status });
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      size += value?.byteLength || 0;
      if (size > maximum) throw new DiscordOAuthRequestError('INVALID_RESPONSE', { status: response.status });
      if (value?.byteLength) chunks.push(Buffer.from(value));
    }
    complete = true;
    try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
    catch { throw new DiscordOAuthRequestError('INVALID_RESPONSE', { status: response.status }); }
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Fixed Discord calls, one attempt only, with bounded bodies and safe errors. */
export async function fetchDiscordOAuthJson(url, options = {}, { fetchImpl = fetch, now = Date.now,
  onRateLimit = () => {}, timeoutMs = 12000 } = {}) {
  if (!['https://discord.com/api/oauth2/token', 'https://discord.com/api/users/@me'].includes(url)) throw new DiscordOAuthRequestError('INVALID_REQUEST');
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await abortable(fetchImpl(url, { ...options, redirect: 'error', signal }), signal);
  if (response.status === 429) {
    const firstWait = headerWait(response, now());
    const provisional = firstWait === null ? onRateLimit(DEFAULT_WAIT_MS, true) : null;
    if (firstWait !== null) onRateLimit(firstWait, true);
    let body;
    try { body = await boundedJson(response, signal, 4096); } catch { /* Never reflect or retain rate-limit payloads. */ }
    const wait = Math.max(firstWait ?? 0, boundedWait(body?.retry_after) ?? (firstWait === null ? DEFAULT_WAIT_MS : 0));
    if (firstWait === null) onRateLimit(wait, false, { finalize: provisional });
    else if (wait > firstWait) onRateLimit(wait, false);
    throw new DiscordOAuthRequestError('RATE_LIMITED', { status: 429, retryAfterMs: wait });
  }
  if (!response.ok) {
    void response.body?.cancel?.().catch(() => {});
    throw new DiscordOAuthRequestError('HTTP_ERROR', { status: response.status });
  }
  return boundedJson(response, signal, 65536);
}

/** Durable claims/cooldowns contain hashes and status metadata, never credentials. */
export function createOAuthRequestGuard({ database, now = Date.now, maxEntries = 10000 } = {}) {
  const buckets = new Map();
  let initialized = false;
  const counts = { providerRateLimits: 0, localRequestsLimited: 0, callbackReplaysBlocked: 0 };
  function init() {
    if (initialized) return;
    database.exec(`CREATE TABLE IF NOT EXISTS oauth_callback_claims (
      state_hash TEXT PRIMARY KEY,client_id TEXT NOT NULL,store TEXT NOT NULL,guild_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,claimed_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_oauth_claim_expiry ON oauth_callback_claims(expires_at);
      CREATE TABLE IF NOT EXISTS oauth_provider_cooldowns (
      client_id TEXT NOT NULL,store TEXT NOT NULL,retry_at INTEGER NOT NULL,revision TEXT,PRIMARY KEY(client_id,store));`);
    if (!database.prepare('PRAGMA table_info(oauth_provider_cooldowns)').all().some(column => column.name === 'revision')) {
      database.exec('ALTER TABLE oauth_provider_cooldowns ADD COLUMN revision TEXT');
    }
    initialized = true;
  }
  function retryAfter({ clientId, store }) {
    init();
    const row = database.prepare('SELECT retry_at FROM oauth_provider_cooldowns WHERE client_id=? AND store=?').get(clientId, store);
    return Math.max(0, (row?.retry_at ?? 0) - now());
  }
  function setCooldown({ clientId, store }, waitMs, count = true) {
    init();
    const wait = Number.isFinite(waitMs) ? Math.max(1000, Math.ceil(waitMs)) : waitMs === Infinity ? Infinity : DEFAULT_WAIT_MS;
    const observedAt = now(), revision = randomUUID();
    const retryAt = Number.isSafeInteger(observedAt + wait) ? observedAt + wait : MAX_RETRY_AT;
    const previousRetryAt = database.transaction(() => {
      const previous = database.prepare('SELECT retry_at FROM oauth_provider_cooldowns WHERE client_id=? AND store=?').get(clientId, store)?.retry_at ?? 0;
      database.prepare(`INSERT INTO oauth_provider_cooldowns(client_id,store,retry_at,revision) VALUES(?,?,?,?)
        ON CONFLICT(client_id,store) DO UPDATE SET retry_at=MAX(retry_at,excluded.retry_at),revision=excluded.revision`).run(clientId, store, retryAt, revision);
      return previous;
    }).immediate();
    if (count) counts.providerRateLimits++;
    return { revision, previousRetryAt, observedAt };
  }
  function finalizeCooldown({ clientId, store }, observation, waitMs) {
    if (!observation?.revision || !Number.isFinite(observation.observedAt)) return;
    init();
    const candidate = observation.observedAt + waitMs;
    const retryAt = Math.max(observation.previousRetryAt, Number.isSafeInteger(candidate) ? candidate : MAX_RETRY_AT);
    // Only this exact provisional response may resolve its fallback. Another
    // in-flight 429 changes revision and can never be shortened by an older one.
    database.prepare('UPDATE oauth_provider_cooldowns SET retry_at=?,revision=? WHERE client_id=? AND store=? AND revision=?')
      .run(retryAt, randomUUID(), clientId, store, observation.revision);
  }
  function claim({ state, clientId, store, guildId, expiresAt }) {
    init();
    database.prepare('DELETE FROM oauth_callback_claims WHERE expires_at<?').run(now() - 60000);
    const claimed = database.prepare(`INSERT INTO oauth_callback_claims(state_hash,client_id,store,guild_id,expires_at,claimed_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(state_hash) DO NOTHING`)
      .run(hash(`${clientId}:${store}:${state}`), clientId, store, guildId, expiresAt, now()).changes === 1;
    if (!claimed) counts.callbackReplaysBlocked++;
    return claimed;
  }
  function wasClaimed({ state, clientId, store }) {
    init();
    return Boolean(database.prepare('SELECT 1 FROM oauth_callback_claims WHERE state_hash=?').get(hash(`${clientId}:${store}:${state}`)));
  }
  function limit(req, { kind, clientId, store, validState } = {}) {
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown').slice(0, 160);
    // A validated browser flow gets its own budget. The generous pre-session
    // bucket still bounds anonymous work when a proxy shares one loopback IP.
    // Untrusted forwarded headers never define a trusted client identity.
    const identity = validState ? `flow:${hash(validState)}` : `ip:${hash(ip)}`;
    const key = `${clientId}:${store}:${kind}:${identity}`;
    const maximum = validState ? (kind === 'login' ? 10 : 8) : 120;
    const current = now();
    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= current) {
      if (buckets.size >= maxEntries) {
        for (const [old, value] of buckets) if (value.resetAt <= current) buckets.delete(old);
        if (buckets.size >= maxEntries) buckets.delete(buckets.keys().next().value);
      }
      entry = { count: 0, resetAt: current + 60000 }; buckets.set(key, entry);
    }
    if (++entry.count <= maximum) return 0;
    counts.localRequestsLimited++;
    return Math.max(1000, entry.resetAt - current);
  }
  function getHealth(scope) {
    let wait = 0;
    if (initialized) wait = retryAfter(scope);
    return Object.freeze({ status: wait ? 'COOLDOWN' : initialized ? 'READY' : 'NOT_STARTED',
      retryAfterSeconds: Math.ceil(wait / 1000), ...counts });
  }
  return Object.freeze({ retryAfter, setCooldown, finalizeCooldown, claim, wasClaimed, limit, getHealth });
}

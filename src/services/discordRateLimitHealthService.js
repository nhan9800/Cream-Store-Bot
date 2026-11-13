import { RESTEvents } from 'discord.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';

const installations = new WeakMap();
const LOG_WINDOW_MS = 60_000;
let installedClients = 0;
let lastLog = null;
let health = snapshot('NOT_INSTALLED');

function snapshot(status, eventCount = 0, globalCount = 0, retryAfterSeconds = null, observedAt = null) {
  return Object.freeze({ status, eventCount, globalCount, retryAfterSeconds, observedAt });
}

// Read only the documented primitive fields. Never inspect or stringify the
// event's URL, route, headers, identifiers, body, or arbitrary accessors.
function ownValue(event, name) {
  try {
    const field = event && Object.getOwnPropertyDescriptor(event, name);
    return field && Object.prototype.hasOwnProperty.call(field, 'value') ? field.value : undefined;
  } catch { return undefined; }
}
function retrySeconds(event) {
  const waits = ['retryAfter', 'timeToReset', 'sublimitTimeout'].map(name => ownValue(event, name))
    .filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER);
  return waits.length ? Math.ceil(Math.max(...waits) / 1000) : null;
}
const increment = value => Math.min(Number.MAX_SAFE_INTEGER, value + 1);

function observe(event) {
  const global = ownValue(event, 'global') === true;
  const retryAfterSeconds = retrySeconds(event);
  const now = Date.now();
  health = snapshot('RATE_LIMIT_OBSERVED', increment(health.eventCount),
    global ? increment(health.globalCount) : health.globalCount, retryAfterSeconds, new Date(now).toISOString());
  // Repeated bucket events can be frequent while discord.js queues requests.
  // Log the first observation, material escalation, or one aggregate per minute.
  const escalated = lastLog && (global && !lastLog.global
    || (retryAfterSeconds !== null && lastLog.retryAfterSeconds !== null
      && retryAfterSeconds >= Math.max(1, lastLog.retryAfterSeconds * 2)));
  if (!lastLog || escalated || now - lastLog.at >= LOG_WINDOW_MS) {
    lastLog = { at: now, global, retryAfterSeconds };
    try { console.warn('[DISCORD-RATE-LIMIT]', health); } catch { /* Telemetry never disrupts REST's own retry handling. */ }
  }
}

/** Passive Store1 diagnostics. discord.js retains ownership of queues/retries. */
export function installDiscordRateLimitHealth(client, { guildId, envFile } = {}) {
  if (guildId !== STORE_ONE_GUILD_ID || envFile !== '.env') {
    if (!installedClients) health = snapshot('DISABLED_OTHER_STORE');
    return health;
  }
  if (!client || (typeof client !== 'object' && typeof client !== 'function')) {
    if (!installedClients) health = snapshot('UNAVAILABLE');
    return health;
  }
  if (installations.has(client)) return health;
  let rest;
  try { rest = client.rest; } catch { /* Keep diagnostic failure inert. */ }
  if (typeof rest?.on !== 'function') {
    if (!installedClients) health = snapshot('UNAVAILABLE');
    return health;
  }
  try {
    rest.on(RESTEvents.RateLimited, observe);
    installations.set(client, rest);
    installedClients++;
    if (health.status !== 'RATE_LIMIT_OBSERVED') health = snapshot('MONITORING');
  } catch {
    if (!installedClients) health = snapshot('UNAVAILABLE');
  }
  return health;
}

// Status records whether a limit was observed, not whether Discord has imposed
// an anti-spam restriction. This getter performs no network work or mutations.
export const getDiscordRateLimitHealth = () => health;

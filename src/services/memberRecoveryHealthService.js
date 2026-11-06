import { db } from '../database/db.js';
import { config } from '../config.js';
import { isEncrypted } from '../utils/crypto.js';

function utcTimestamp(value) {
  const text = String(value || '').trim();
  // SQLite CURRENT_TIMESTAMP is UTC without a timezone suffix. Reading it
  // through Date.parse directly would make health depend on the host timezone.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text;
  const milliseconds = Date.parse(normalized);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

// Public health reports aggregate readiness only. It never returns identities,
// credentials, role snapshots, OAuth grant bodies or filesystem locations.
export function getMemberRecoveryHealth(guildId = config.guildId, now = Date.now()) {
  const rows = db.prepare(`SELECT access_token, refresh_token, scopes, recovery_consent_at, token_expires_at, verified_at
    FROM oauth_backups WHERE guild_id = ?`).all(guildId);
  const counts = { stored: rows.length, consented: 0, completeScope: 0, encryptedCredentials: 0, accessUnexpired: 0, refreshNeeded: 0 };
  let latestConsentAt = null;
  let latestConsentTime = null;
  for (const row of rows) {
    if (!row.recovery_consent_at) continue;
    counts.consented++;
    const consentTime = utcTimestamp(row.recovery_consent_at);
    if (consentTime !== null && (latestConsentTime === null || consentTime > latestConsentTime)) {
      latestConsentTime = consentTime;
      latestConsentAt = new Date(consentTime).toISOString();
    }
    const scopes = new Set(String(row.scopes || '').split(/\s+/));
    if (!scopes.has('identify') || !scopes.has('guilds.join')) continue;
    counts.completeScope++;
    if (!isEncrypted(row.access_token) || !isEncrypted(row.refresh_token)) continue;
    counts.encryptedCredentials++;
    const expiresAt = utcTimestamp(row.token_expires_at);
    if (expiresAt !== null && expiresAt > now) counts.accessUnexpired++;
    else counts.refreshNeeded++;
  }
  const snapshot = db.prepare(`SELECT captured_at, member_count, authorized_member_count FROM guild_recovery_snapshots WHERE guild_id = ?`).get(guildId);
  return {
    configured: [config.clientId, process.env.CLIENT_SECRET, process.env.ENCRYPTION_KEY, config.publicBaseUrl]
      .every(value => Boolean(String(value || '').trim())),
    authorizationValidity: 'requires_live_discord_check',
    counts, latestConsentAt,
    snapshot: snapshot ? { capturedAt: snapshot.captured_at, members: snapshot.member_count, authorizedMembers: snapshot.authorized_member_count } : null,
    recoveryMode: 'explicit_admin_action_with_member_consent',
  };
}

import { db } from '../database/db.js';

const DISCORD_INVITE_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:discord\.(?:gg|io|me|li)|discord(?:app)?\.com\/invite)\/([a-zA-Z0-9-]+)/i;

export function normalizeDiscordInviteUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(DISCORD_INVITE_PATTERN);
  const code = match?.[1] || (/^[a-zA-Z0-9-]+$/.test(raw) ? raw : null);
  return code ? `https://discord.gg/${code}` : null;
}

export function getPartnerSettings(guildId) {
  let row = db.prepare('SELECT * FROM partner_settings WHERE guild_id = ?').get(guildId);
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO partner_settings (guild_id) VALUES (?)').run(guildId);
    row = db.prepare('SELECT * FROM partner_settings WHERE guild_id = ?').get(guildId);
  }
  return row;
}

export function upsertPartnerSettings({ guild_id, recruit_channel_id, approve_channel_id, partner_role_id, directory_channel_id, partner_channel_id }) {
  db.prepare(`
    INSERT INTO partner_settings (guild_id, recruit_channel_id, approve_channel_id, partner_role_id, directory_channel_id, partner_channel_id, updated_at)
    VALUES (@guild_id, @recruit_channel_id, @approve_channel_id, @partner_role_id, @directory_channel_id, @partner_channel_id, CURRENT_TIMESTAMP)
    ON CONFLICT(guild_id) DO UPDATE SET
      recruit_channel_id = COALESCE(excluded.recruit_channel_id, recruit_channel_id),
      approve_channel_id = COALESCE(excluded.approve_channel_id, approve_channel_id),
      partner_role_id = COALESCE(excluded.partner_role_id, partner_role_id),
      directory_channel_id = COALESCE(excluded.directory_channel_id, directory_channel_id),
      partner_channel_id = COALESCE(excluded.partner_channel_id, partner_channel_id),
      updated_at = CURRENT_TIMESTAMP
  `).run({
    guild_id,
    recruit_channel_id: recruit_channel_id ?? null,
    approve_channel_id: approve_channel_id ?? null,
    partner_role_id: partner_role_id ?? null,
    directory_channel_id: directory_channel_id ?? null,
    partner_channel_id: partner_channel_id ?? null,
  });
  return getPartnerSettings(guild_id);
}

export function addPartnerApplication(guildId, partnerGuildId, partnerName, inviteLink, memberCount, ownerId, applicantId, reviewMode = 'STANDARD') {
  const info = db.prepare(`
    INSERT INTO partners (guild_id, partner_guild_id, partner_name, invite_link, member_count, owner_id, applicant_id, status, review_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
  `).run(guildId, partnerGuildId, partnerName, inviteLink, memberCount, ownerId, applicantId, reviewMode);
  return info.lastInsertRowid;
}

const PARTNER_MENTION_LIMIT = 2;
const EVERYONE_MENTION_LIMIT = 1;
const WINDOW_MS = 24 * 60 * 60 * 1000;

function quotaSnapshot(row, now = Date.now()) {
  const windowStart = row ? Date.parse(row.window_started_at) : Number.NaN;
  const expired = !Number.isFinite(windowStart) || now - windowStart >= WINDOW_MS;
  const partnerMentions = expired ? 0 : Number(row.partner_mentions || 0);
  const everyoneMentions = expired ? 0 : Number(row.everyone_mentions || 0);
  const resetAt = expired ? now + WINDOW_MS : windowStart + WINDOW_MS;
  return {
    partnerMentions,
    everyoneMentions,
    partnerRemaining: Math.max(0, PARTNER_MENTION_LIMIT - partnerMentions),
    everyoneRemaining: Math.max(0, EVERYONE_MENTION_LIMIT - everyoneMentions),
    resetAt,
    expired,
    windowStart,
  };
}

export function getPartnerMentionQuota(guildId, userId) {
  const row = db.prepare('SELECT * FROM partner_mention_usage WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  return quotaSnapshot(row);
}

export function consumePartnerMentionQuota(guildId, userId, { partnerMentions = 0, everyoneMentions = 0 } = {}) {
  const now = Date.now();
  const requestedPartner = Math.max(0, Number(partnerMentions || 0));
  const requestedEveryone = Math.max(0, Number(everyoneMentions || 0));
  const row = db.prepare('SELECT * FROM partner_mention_usage WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  const current = quotaSnapshot(row, now);
  const nextPartner = current.partnerMentions + requestedPartner;
  const nextEveryone = current.everyoneMentions + requestedEveryone;

  if (nextPartner > PARTNER_MENTION_LIMIT || nextEveryone > EVERYONE_MENTION_LIMIT) {
    return {
      allowed: false,
      ...current,
    };
  }

  const startedAt = new Date(current.expired ? now : current.windowStart).toISOString();
  db.prepare(`
    INSERT INTO partner_mention_usage (guild_id, user_id, window_started_at, partner_mentions, everyone_mentions, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      window_started_at = excluded.window_started_at,
      partner_mentions = excluded.partner_mentions,
      everyone_mentions = excluded.everyone_mentions,
      updated_at = CURRENT_TIMESTAMP
  `).run(guildId, userId, startedAt, nextPartner, nextEveryone);

  return {
    allowed: true,
    partnerMentions: nextPartner,
    everyoneMentions: nextEveryone,
    partnerRemaining: PARTNER_MENTION_LIMIT - nextPartner,
    everyoneRemaining: EVERYONE_MENTION_LIMIT - nextEveryone,
    resetAt: current.resetAt,
  };
}

export function rollbackPartnerMentionQuota(guildId, userId, { partnerMentions = 0, everyoneMentions = 0 } = {}) {
  db.prepare(`
    UPDATE partner_mention_usage
    SET partner_mentions = MAX(0, partner_mentions - ?),
        everyone_mentions = MAX(0, everyone_mentions - ?),
        updated_at = CURRENT_TIMESTAMP
    WHERE guild_id = ? AND user_id = ?
  `).run(
    Math.max(0, Number(partnerMentions || 0)),
    Math.max(0, Number(everyoneMentions || 0)),
    guildId,
    userId,
  );
  return getPartnerMentionQuota(guildId, userId);
}

export const PARTNER_QUOTA = Object.freeze({
  partner: PARTNER_MENTION_LIMIT,
  everyone: EVERYONE_MENTION_LIMIT,
  windowMs: WINDOW_MS,
});

export function updatePartnerStatus(id, status) {
  db.prepare('UPDATE partners SET status = ? WHERE id = ?').run(status, id);
}

export function getPartnerById(id) {
  return db.prepare('SELECT * FROM partners WHERE id = ?').get(id);
}

export function getPartnerList(guildId) {
  return db.prepare("SELECT * FROM partners WHERE guild_id = ? AND status = 'ACTIVE' ORDER BY joined_at DESC").all(guildId);
}

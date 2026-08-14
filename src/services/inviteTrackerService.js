import { db } from '../database/db.js';
import {
  ensureInviteCampaignDiscordSetup,
  processInviteDecorCampaign,
  registerInviteCampaignJoin,
} from './inviteCampaignService.js';

// guildId -> Collection<inviteCode, Invite>
const invitesCache = new Map();
const guildInviteLocks = new Map();
const recentlyDeletedInvites = new Map();
const RECENTLY_DELETED_TTL_MS = 30_000;

function snapshotInvite(invite) {
  if (!invite?.code) return null;
  return {
    code: invite.code,
    uses: Number(invite.uses || 0),
    maxUses: Number(invite.maxUses || 0),
    inviter: invite.inviter || null,
    temporary: Boolean(invite.temporary),
    createdTimestamp: invite.createdTimestamp || null,
  };
}

function snapshotInviteCollection(invites) {
  const snapshot = new Map();
  for (const invite of invites?.values?.() || []) {
    const entry = snapshotInvite(invite);
    if (entry) snapshot.set(entry.code, entry);
  }
  return snapshot;
}

async function withGuildInviteLock(guildId, task) {
  const previous = guildInviteLocks.get(guildId) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  guildInviteLocks.set(guildId, queued);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (guildInviteLocks.get(guildId) === queued) guildInviteLocks.delete(guildId);
  }
}

function detectUsedInvite(cachedInvites, newInvites) {
  const candidates = [];
  for (const invite of newInvites.values()) {
    const cached = cachedInvites?.get(invite.code);
    const delta = Number(invite.uses || 0) - Number(cached?.uses || 0);
    if (cached && delta > 0) candidates.push({ invite, delta });
  }
  candidates.sort((a, b) => b.delta - a.delta);
  if (candidates[0]) return candidates[0].invite;

  // Invite một lần thường biến mất ngay khi được dùng. Cache cũ vẫn giữ đủ
  // inviter/code để quy lượt chính xác thay vì đánh dấu không xác định.
  for (const cached of cachedInvites?.values?.() || []) {
    if (newInvites.has(cached.code)) continue;
    const maxUses = Number(cached.maxUses || 0);
    if (maxUses > 0 && Number(cached.uses || 0) + 1 >= maxUses) return cached;
  }
  return null;
}

export async function initInviteCache(client) {
  const results = [];
  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch().catch(() => null);
      if (invites) invitesCache.set(guild.id, snapshotInviteCollection(invites));
      const setup = await ensureInviteCampaignDiscordSetup(guild).catch((error) => {
        console.error(`[INVITE-EVENT] Setup ${guild.id} failed:`, error.message);
        return null;
      });
      results.push({ guildId: guild.id, cached: Boolean(invites), campaignReady: Boolean(setup) });
    } catch (error) {
      console.error(`[INVITE-TRACKER] Could not initialize guild ${guild.id}:`, error.message);
      results.push({ guildId: guild.id, cached: false, campaignReady: false });
    }
  }
  return results;
}

export async function handleMemberAdd(member) {
  if (!member?.guild) return null;
  return withGuildInviteLock(member.guild.id, async () => {
    const guild = member.guild;
    const cachedInvites = invitesCache.get(guild.id);
    const priorInviteRecord = db.prepare(`
      SELECT * FROM user_invites WHERE invited_id = ? AND guild_id = ?
    `).get(member.id, guild.id) || null;
    let usedInvite = null;

    try {
      const newInvites = await guild.invites.fetch().catch(() => null);
      if (newInvites) {
        usedInvite = detectUsedInvite(cachedInvites, newInvites);
        if (!usedInvite) {
          const deleted = recentlyDeletedInvites.get(guild.id);
          const recent = deleted
            ? [...deleted.values()]
              .filter((entry) => Date.now() - entry.deletedAt <= RECENTLY_DELETED_TTL_MS)
              .sort((a, b) => b.deletedAt - a.deletedAt)[0]
            : null;
          if (recent && Number(recent.invite.maxUses || 0) > 0) usedInvite = recent.invite;
        }
        invitesCache.set(guild.id, snapshotInviteCollection(newInvites));
      }
    } catch (error) {
      console.error(`[INVITE-TRACKER] Fetch on join failed for ${guild.id}:`, error.message);
    }

    const inviterId = usedInvite?.inviter?.id || null;
    if (inviterId && inviterId !== member.id && !member.user.bot) {
      db.prepare(`
        INSERT OR IGNORE INTO user_invites (invited_id, inviter_id, guild_id, has_purchased)
        VALUES (?, ?, ?, 0)
      `).run(member.id, inviterId, guild.id);
      console.log(`[INVITE-TRACKER] ${member.user.tag} joined with ${usedInvite.code} from ${usedInvite.inviter.tag}.`);
    }

    const eventEntry = await registerInviteCampaignJoin({
      member,
      inviterId,
      inviteCode: usedInvite?.code || null,
      priorInviteRecord,
    }).catch((error) => {
      console.error(`[INVITE-EVENT] Could not record ${member.id}:`, error.message);
      return null;
    });
    return { inviterId, inviteCode: usedInvite?.code || null, eventEntry };
  });
}

export async function handleInviteCreate(invite) {
  const guild = invite.guild;
  if (!guild) return;
  const cachedInvites = invitesCache.get(guild.id);
  const snapshot = snapshotInvite(invite);
  if (cachedInvites && snapshot) cachedInvites.set(invite.code, snapshot);
}

export async function handleInviteDelete(invite) {
  const guild = invite.guild;
  if (!guild) return;
  const cachedInvites = invitesCache.get(guild.id);
  if (cachedInvites) cachedInvites.delete(invite.code);
  let deleted = recentlyDeletedInvites.get(guild.id);
  if (!deleted) {
    deleted = new Map();
    recentlyDeletedInvites.set(guild.id, deleted);
  }
  deleted.set(invite.code, { invite, deletedAt: Date.now() });
  for (const [code, entry] of deleted) {
    if (Date.now() - entry.deletedAt > RECENTLY_DELETED_TTL_MS) deleted.delete(code);
  }
}

export async function processPendingInviteRewards(client) {
  return processInviteDecorCampaign(client);
}

export const inviteTrackerInternals = {
  detectUsedInvite,
  invitesCache,
  recentlyDeletedInvites,
  snapshotInvite,
  snapshotInviteCollection,
};

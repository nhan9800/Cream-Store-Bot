import crypto from 'node:crypto';
import { ChannelType, OverwriteType } from 'discord.js';
import { db } from '../database/db.js';

const MAX_EMOJI_BYTES = 256 * 1024;
const SNAPSHOT_MIN_AGE_MS = 30 * 60 * 1000;
const snapshotLocks = new Map();

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function roleSnapshot(role) {
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    managed: role.managed,
    position: role.position,
    permissions: role.permissions.bitfield.toString(),
    icon: role.icon || null,
    unicodeEmoji: role.unicodeEmoji || null,
  };
}

function channelSnapshot(channel) {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    position: channel.rawPosition ?? channel.position ?? 0,
    parentId: channel.parentId || null,
    topic: 'topic' in channel ? channel.topic || null : null,
    nsfw: 'nsfw' in channel ? Boolean(channel.nsfw) : false,
    rateLimitPerUser: 'rateLimitPerUser' in channel ? channel.rateLimitPerUser || 0 : 0,
    bitrate: 'bitrate' in channel ? channel.bitrate || null : null,
    userLimit: 'userLimit' in channel ? channel.userLimit || 0 : 0,
    permissionOverwrites: channel.permissionOverwrites?.cache
      ? [...channel.permissionOverwrites.cache.values()].map((overwrite) => ({
          id: overwrite.id,
          type: overwrite.type,
          allow: overwrite.allow.bitfield.toString(),
          deny: overwrite.deny.bitfield.toString(),
        }))
      : [],
  };
}

async function emojiSnapshot(emoji) {
  const extension = emoji.animated ? 'gif' : 'png';
  const url = emoji.imageURL({ extension, size: 128 });
  let assetData = null;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length <= MAX_EMOJI_BYTES) assetData = bytes.toString('base64');
    }
  } catch (error) {
    console.warn(`[RECOVERY] Không tải được asset emoji ${emoji.name}: ${error.message}`);
  }

  return {
    id: emoji.id,
    name: emoji.name,
    animated: emoji.animated,
    available: emoji.available,
    url,
    assetData,
  };
}

export async function buildGuildRecoverySnapshot(guild) {
  await Promise.allSettled([
    guild.roles.fetch(),
    guild.channels.fetch(),
    guild.emojis.fetch(),
  ]);

  const roles = [...guild.roles.cache.values()]
    .sort((left, right) => left.position - right.position)
    .map(roleSnapshot);
  const channels = [...guild.channels.cache.values()]
    .filter((channel) => !channel.isThread?.())
    .sort((left, right) => (left.rawPosition ?? 0) - (right.rawPosition ?? 0))
    .map(channelSnapshot);
  const emojis = await Promise.all([...guild.emojis.cache.values()].map(emojiSnapshot));

  const structure = {
    version: 1,
    sourceGuildId: guild.id,
    guild: {
      name: guild.name,
      description: guild.description || null,
      icon: guild.icon || null,
      banner: guild.banner || null,
      verificationLevel: guild.verificationLevel,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      explicitContentFilter: guild.explicitContentFilter,
      preferredLocale: guild.preferredLocale,
      afkTimeout: guild.afkTimeout,
    },
    roles,
    channels,
    emojis,
  };

  return {
    ...structure,
    capturedAt: new Date().toISOString(),
    structureHash: stableHash(structure),
  };
}

function recoveryCounts(guildId) {
  const authorized = db.prepare(`
    SELECT COUNT(*) AS total
    FROM oauth_backups
    WHERE guild_id = ? AND recovery_consent_at IS NOT NULL
  `).get(guildId)?.total || 0;
  const customers = db.prepare(`
    SELECT COUNT(DISTINCT customer_id) AS total
    FROM orders
    WHERE guild_id = ?
  `).get(guildId)?.total || 0;
  return { authorized, customers };
}

export async function snapshotGuildForRecovery(guild, { force = false } = {}) {
  if (!guild?.id) throw new Error('Guild không hợp lệ để tạo recovery snapshot.');

  const latest = db.prepare(`
    SELECT captured_at FROM guild_recovery_snapshots WHERE guild_id = ?
  `).get(guild.id);
  if (!force && latest?.captured_at) {
    const age = Date.now() - new Date(latest.captured_at).getTime();
    if (Number.isFinite(age) && age >= 0 && age < SNAPSHOT_MIN_AGE_MS) {
      return { skipped: true, reason: 'fresh', capturedAt: latest.captured_at };
    }
  }

  if (snapshotLocks.has(guild.id)) return snapshotLocks.get(guild.id);

  const task = (async () => {
    const authorizedUsers = db.prepare(`
      SELECT discord_id
      FROM oauth_backups
      WHERE guild_id = ? AND recovery_consent_at IS NOT NULL
    `).all(guild.id);
    for (const user of authorizedUsers) {
      const member = guild.members.cache.get(user.discord_id)
        || await guild.members.fetch(user.discord_id).catch(() => null);
      if (member) updateOauthMemberSnapshot(guild.id, member);
    }
    const snapshot = await buildGuildRecoverySnapshot(guild);
    const counts = recoveryCounts(guild.id);
    db.prepare(`
      INSERT INTO guild_recovery_snapshots (
        guild_id, captured_at, structure_hash, snapshot_json,
        member_count, authorized_member_count, customer_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        captured_at = excluded.captured_at,
        structure_hash = excluded.structure_hash,
        snapshot_json = excluded.snapshot_json,
        member_count = excluded.member_count,
        authorized_member_count = excluded.authorized_member_count,
        customer_count = excluded.customer_count
    `).run(
      guild.id,
      snapshot.capturedAt,
      snapshot.structureHash,
      JSON.stringify(snapshot),
      guild.memberCount || 0,
      counts.authorized,
      counts.customers,
    );
    console.log(`[RECOVERY] Snapshot ${guild.name}: ${snapshot.roles.length} roles, ${snapshot.channels.length} channels, ${snapshot.emojis.length} emojis.`);
    return snapshot;
  })().finally(() => snapshotLocks.delete(guild.id));

  snapshotLocks.set(guild.id, task);
  return task;
}

export async function snapshotAllGuilds(client = global.discordClient) {
  if (!client?.isReady?.()) return [];
  const results = [];
  for (const guild of client.guilds.cache.values()) {
    try {
      results.push(await snapshotGuildForRecovery(guild, { force: true }));
    } catch (error) {
      console.error(`[RECOVERY] Snapshot guild ${guild.id} thất bại:`, error.message);
    }
  }
  return results;
}

export function updateOauthMemberSnapshot(guildId, member) {
  const roles = [...member.roles.cache.values()]
    .filter((role) => role.id !== member.guild.id && !role.managed)
    .sort((left, right) => right.position - left.position)
    .map((role) => ({ id: role.id, name: role.name }));
  db.prepare(`
    UPDATE oauth_backups
    SET member_roles_json = ?, recovery_consent_at = COALESCE(recovery_consent_at, CURRENT_TIMESTAMP)
    WHERE guild_id = ? AND discord_id = ?
  `).run(JSON.stringify(roles), guildId, member.id);
  return roles;
}

export function getRecoveryStatus(guildId, discordId) {
  return db.prepare(`
    SELECT verified_at, recovery_consent_at, scopes, token_expires_at
    FROM oauth_backups
    WHERE guild_id = ? AND discord_id = ?
  `).get(guildId, discordId) || null;
}

function manageablePermissionBits(targetGuild, rawPermissions) {
  const requested = BigInt(rawPermissions || '0');
  const botPermissions = targetGuild.members.me?.permissions?.bitfield;
  return botPermissions == null ? requested : requested & botPermissions;
}

function buildOverwriteSnapshot(overwrites, sourceGuildId, targetGuildId, roleMap) {
  return (overwrites || []).flatMap((overwrite) => {
    if (overwrite.type === OverwriteType.Member) return [];
    const targetId = overwrite.id === sourceGuildId
      ? targetGuildId
      : roleMap.get(overwrite.id);
    if (!targetId) return [];
    return [{
      id: targetId,
      type: OverwriteType.Role,
      allow: BigInt(overwrite.allow || '0'),
      deny: BigInt(overwrite.deny || '0'),
    }];
  });
}

export async function restoreGuildStructure(sourceGuildId, targetGuild) {
  const row = db.prepare(`
    SELECT snapshot_json, captured_at
    FROM guild_recovery_snapshots
    WHERE guild_id = ?
  `).get(sourceGuildId);
  if (!row) throw new Error('Chưa có recovery snapshot cho server nguồn.');

  const snapshot = JSON.parse(row.snapshot_json);
  await Promise.all([
    targetGuild.roles.fetch(),
    targetGuild.channels.fetch(),
    targetGuild.emojis.fetch(),
  ]);

  const roleMap = new Map([[sourceGuildId, targetGuild.id]]);
  const created = { roles: 0, channels: 0, emojis: 0 };
  const reused = { roles: 0, channels: 0, emojis: 0 };
  const failures = [];

  for (const role of snapshot.roles.filter((item) => !item.managed && item.id !== sourceGuildId)) {
    try {
      let targetRole = targetGuild.roles.cache.find((item) => item.name === role.name && !item.managed);
      if (!targetRole) {
        targetRole = await targetGuild.roles.create({
          name: role.name,
          color: role.color,
          hoist: role.hoist,
          mentionable: role.mentionable,
          permissions: manageablePermissionBits(targetGuild, role.permissions),
          reason: `Cenar recovery từ guild ${sourceGuildId}`,
        });
        created.roles++;
      } else {
        reused.roles++;
      }
      roleMap.set(role.id, targetRole.id);
    } catch (error) {
      failures.push(`Role ${role.name}: ${error.message}`);
    }
  }

  const categoryMap = new Map();
  const sourceCategories = snapshot.channels.filter((channel) => channel.type === ChannelType.GuildCategory);
  for (const category of sourceCategories) {
    try {
      let targetCategory = targetGuild.channels.cache.find(
        (channel) => channel.type === ChannelType.GuildCategory && channel.name === category.name,
      );
      if (!targetCategory) {
        targetCategory = await targetGuild.channels.create({
          name: category.name,
          type: ChannelType.GuildCategory,
          permissionOverwrites: buildOverwriteSnapshot(
            category.permissionOverwrites,
            sourceGuildId,
            targetGuild.id,
            roleMap,
          ),
          reason: `Cenar recovery từ guild ${sourceGuildId}`,
        });
        created.channels++;
      } else {
        reused.channels++;
      }
      categoryMap.set(category.id, targetCategory.id);
    } catch (error) {
      failures.push(`Danh mục ${category.name}: ${error.message}`);
    }
  }

  const supportedChannelTypes = new Set([
    ChannelType.GuildText,
    ChannelType.GuildVoice,
    ChannelType.GuildAnnouncement,
    ChannelType.GuildStageVoice,
    ChannelType.GuildForum,
  ]);
  for (const channel of snapshot.channels.filter((item) => supportedChannelTypes.has(item.type))) {
    try {
      const parentId = channel.parentId ? categoryMap.get(channel.parentId) || null : null;
      let targetChannel = targetGuild.channels.cache.find((item) => (
        item.type === channel.type
        && item.name === channel.name
        && (item.parentId || null) === parentId
      ));
      if (!targetChannel) {
        const options = {
          name: channel.name,
          type: channel.type,
          parent: parentId,
          permissionOverwrites: buildOverwriteSnapshot(
            channel.permissionOverwrites,
            sourceGuildId,
            targetGuild.id,
            roleMap,
          ),
          reason: `Cenar recovery từ guild ${sourceGuildId}`,
        };
        if ([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(channel.type)) {
          options.topic = channel.topic;
          options.nsfw = channel.nsfw;
          options.rateLimitPerUser = channel.rateLimitPerUser;
        }
        if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) {
          if (channel.bitrate) options.bitrate = channel.bitrate;
          options.userLimit = channel.userLimit;
        }
        targetChannel = await targetGuild.channels.create(options);
        created.channels++;
      } else {
        reused.channels++;
      }
    } catch (error) {
      failures.push(`Kênh ${channel.name}: ${error.message}`);
    }
  }

  for (const emoji of snapshot.emojis || []) {
    try {
      const existing = targetGuild.emojis.cache.find((item) => item.name === emoji.name);
      if (existing) {
        reused.emojis++;
        continue;
      }
      const attachment = emoji.assetData ? Buffer.from(emoji.assetData, 'base64') : emoji.url;
      await targetGuild.emojis.create({
        attachment,
        name: emoji.name,
        reason: `Cenar recovery từ guild ${sourceGuildId}`,
      });
      created.emojis++;
    } catch (error) {
      failures.push(`Emoji ${emoji.name}: ${error.message}`);
    }
  }

  return { capturedAt: row.captured_at, created, reused, failures };
}

export function mapRecoveryRoleIds(memberRolesJson, targetGuild) {
  let sourceRoles = [];
  try {
    sourceRoles = JSON.parse(memberRolesJson || '[]');
  } catch {
    return [];
  }
  const names = new Set(sourceRoles.map((role) => role?.name).filter(Boolean));
  return [...targetGuild.roles.cache.values()]
    .filter((role) => !role.managed && names.has(role.name) && role.editable)
    .map((role) => role.id);
}

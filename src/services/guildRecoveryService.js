import crypto from 'node:crypto';
import { ChannelType, OverwriteType } from 'discord.js';
import { db } from '../database/db.js';

const MAX_EMOJI_BYTES = 256 * 1024;
const MAX_ROLE_ICON_BYTES = 512 * 1024;
const MAX_STICKER_BYTES = 512 * 1024;
const MAX_GUILD_ASSET_BYTES = 8 * 1024 * 1024;
const SNAPSHOT_MIN_AGE_MS = 30 * 60 * 1000;
const snapshotLocks = new Map();

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function downloadAsset(url, maxBytes, label) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declaredLength = Number(response.headers?.get?.('content-length') || 0);
    if (declaredLength > maxBytes) throw new Error(`asset exceeds ${maxBytes} bytes`);
    let bytes;
    // Read the response in bounded chunks. Discord CDN responses normally
    // include Content-Length, but a missing header must not allow an
    // unexpectedly large asset to be buffered in memory before we reject it.
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value?.byteLength || 0;
          if (total > maxBytes) throw new Error(`asset exceeds ${maxBytes} bytes`);
          if (value?.byteLength) chunks.push(Buffer.from(value));
        }
      } finally {
        reader.releaseLock?.();
      }
      bytes = Buffer.concat(chunks, total);
    } else {
      bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxBytes) throw new Error(`asset exceeds ${maxBytes} bytes`);
    }
    return bytes.toString('base64');
  } catch (error) {
    console.warn(`[RECOVERY] Không tải được ${label}: ${error.message}`);
    return null;
  }
}

async function roleSnapshot(role) {
  const iconUrl = role.iconURL?.({ extension: 'png', size: 128 }) || null;
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
    iconAssetData: await downloadAsset(iconUrl, MAX_ROLE_ICON_BYTES, `role icon ${role.name}`),
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
  const url = emoji.imageURL?.({ extension, size: 128 }) || null;
  const assetData = await downloadAsset(url, MAX_EMOJI_BYTES, `emoji ${emoji.name}`);

  return {
    id: emoji.id,
    name: emoji.name,
    animated: emoji.animated,
    available: emoji.available,
    url,
    assetData,
  };
}

async function stickerSnapshot(sticker) {
  const url = sticker.url || null;
  return {
    id: sticker.id,
    name: sticker.name,
    description: sticker.description || null,
    tags: sticker.tags || 'sparkles',
    format: sticker.format,
    url,
    assetData: await downloadAsset(url, MAX_STICKER_BYTES, `sticker ${sticker.name}`),
  };
}

export async function buildGuildRecoverySnapshot(guild) {
  await Promise.allSettled([
    guild.roles.fetch(),
    guild.channels.fetch(),
    guild.emojis.fetch(),
    guild.stickers?.fetch?.(),
  ]);

  const roles = await Promise.all([...guild.roles.cache.values()]
    .sort((left, right) => left.position - right.position)
    .map(roleSnapshot));
  const channels = [...guild.channels.cache.values()]
    .filter((channel) => !channel.isThread?.())
    .sort((left, right) => (left.rawPosition ?? 0) - (right.rawPosition ?? 0))
    .map(channelSnapshot);
  const emojis = await Promise.all([...guild.emojis.cache.values()].map(emojiSnapshot));
  const stickers = guild.stickers?.cache
    ? await Promise.all([...guild.stickers.cache.values()].map(stickerSnapshot))
    : [];
  const iconUrl = guild.iconURL?.({ extension: 'png', size: 512 }) || null;
  const bannerUrl = guild.bannerURL?.({ extension: 'png', size: 1024 }) || null;
  const [iconAssetData, bannerAssetData] = await Promise.all([
    downloadAsset(iconUrl, MAX_GUILD_ASSET_BYTES, `server icon ${guild.name}`),
    downloadAsset(bannerUrl, MAX_GUILD_ASSET_BYTES, `server banner ${guild.name}`),
  ]);

  const structure = {
    version: 2,
    sourceGuildId: guild.id,
    guild: {
      name: guild.name,
      description: guild.description || null,
      icon: guild.icon || null,
      iconAssetData,
      banner: guild.banner || null,
      bannerAssetData,
      verificationLevel: guild.verificationLevel,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      explicitContentFilter: guild.explicitContentFilter,
      preferredLocale: guild.preferredLocale,
      afkTimeout: guild.afkTimeout,
      systemChannelId: guild.systemChannelId || null,
      systemChannelFlags: guild.systemChannelFlags?.bitfield?.toString?.() || null,
      rulesChannelId: guild.rulesChannelId || null,
      publicUpdatesChannelId: guild.publicUpdatesChannelId || null,
      safetyAlertsChannelId: guild.safetyAlertsChannelId || null,
      premiumProgressBarEnabled: Boolean(guild.premiumProgressBarEnabled),
    },
    roles,
    channels,
    emojis,
    stickers,
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
    console.log(`[RECOVERY] Snapshot ${guild.name}: ${snapshot.roles.length} roles, ${snapshot.channels.length} channels, ${snapshot.emojis.length} emojis, ${snapshot.stickers.length} stickers.`);
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
  // Role permission bits are independent from the bot's own permission bits.
  // Clipping them to the bot permissions silently changes the recovered role.
  // ManageRoles and the role hierarchy are checked by the command before this
  // function is called, so preserve the source role permissions exactly.
  void targetGuild;
  return safeBigInt(rawPermissions);
}

function cacheValues(cache) {
  return cache?.values ? [...cache.values()] : [];
}

function cacheFind(cache, predicate) {
  if (cache?.find) return cache.find(predicate);
  return cacheValues(cache).find(predicate);
}

function normalizedName(value) {
  return String(value || '').trim().toLocaleLowerCase('vi-VN');
}

function assetBuffer(assetData) {
  return assetData ? Buffer.from(assetData, 'base64') : null;
}

function safeBigInt(value, fallback = 0n) {
  try {
    return BigInt(value ?? fallback);
  } catch {
    return fallback;
  }
}

function stickerFile(sticker) {
  const attachment = assetBuffer(sticker.assetData);
  if (!attachment) return sticker.url || null;

  // Discord infers the sticker format from the uploaded filename. A raw
  // Buffer is fine for PNG/APNG, but Lottie and GIF stickers need an explicit
  // extension so the API does not misclassify the payload.
  const extensionByFormat = {
    1: 'png',
    2: 'png',
    3: 'json',
    4: 'gif',
  };
  const extension = extensionByFormat[Number(sticker.format)] || 'png';
  const safeName = String(sticker.name || 'sticker').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80) || 'sticker';
  if (Number(sticker.format) === 1 || Number(sticker.format) === 2) return attachment;
  return { attachment, name: `${safeName}.${extension}` };
}

function roleIconOptions(role) {
  if (role.iconAssetData) return { icon: assetBuffer(role.iconAssetData) };
  if (role.unicodeEmoji) return { unicodeEmoji: role.unicodeEmoji };
  return {};
}

function roleBasicOptions(role, targetGuild, sourceGuildId) {
  return {
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    permissions: manageablePermissionBits(targetGuild, role.permissions),
    reason: `Cenar recovery từ guild ${sourceGuildId}`,
  };
}

function channelEditOptions(channel, parentId, roleOverwrites) {
  const options = { name: channel.name, parent: parentId, reason: 'Cenar recovery: đồng bộ cấu trúc' };
  if ([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(channel.type)) {
    options.topic = channel.topic;
    options.nsfw = channel.nsfw;
    options.rateLimitPerUser = channel.rateLimitPerUser;
  }
  if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) {
    if (channel.bitrate) options.bitrate = channel.bitrate;
    options.userLimit = channel.userLimit;
  }
  if (roleOverwrites.length) options.permissionOverwrites = roleOverwrites;
  return options;
}

async function syncPermissionOverwrites(channel, roleOverwrites) {
  if (!channel.permissionOverwrites?.set) return;
  await channel.permissionOverwrites.set(roleOverwrites, 'Cenar recovery: đồng bộ quyền');
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
      allow: safeBigInt(overwrite.allow),
      deny: safeBigInt(overwrite.deny),
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
  await Promise.allSettled([
    targetGuild.roles?.fetch?.(),
    targetGuild.channels?.fetch?.(),
    targetGuild.emojis?.fetch?.(),
    targetGuild.stickers?.fetch?.(),
  ]);

  const roleMap = new Map([[sourceGuildId, targetGuild.id]]);
  const channelMap = new Map();
  const created = { roles: 0, channels: 0, emojis: 0, stickers: 0 };
  const reused = { roles: 0, channels: 0, emojis: 0, stickers: 0 };
  const failures = [];

  const sourceGuild = snapshot.guild || {};
  const guildOptions = { reason: `Cenar recovery từ guild ${sourceGuildId}` };
  for (const field of [
    'name',
    'description',
    'verificationLevel',
    'defaultMessageNotifications',
    'explicitContentFilter',
    'preferredLocale',
    'afkTimeout',
    'premiumProgressBarEnabled',
  ]) {
    if (Object.prototype.hasOwnProperty.call(sourceGuild, field)) {
      guildOptions[field] = sourceGuild[field];
    }
  }
  if (sourceGuild.iconAssetData) guildOptions.icon = assetBuffer(sourceGuild.iconAssetData);
  else if (Object.prototype.hasOwnProperty.call(sourceGuild, 'icon') && sourceGuild.icon === null) guildOptions.icon = null;
  if (sourceGuild.bannerAssetData) guildOptions.banner = assetBuffer(sourceGuild.bannerAssetData);
  else if (Object.prototype.hasOwnProperty.call(sourceGuild, 'banner') && sourceGuild.banner === null) guildOptions.banner = null;
  if (Object.prototype.hasOwnProperty.call(sourceGuild, 'systemChannelFlags') && sourceGuild.systemChannelFlags != null) {
    try {
      guildOptions.systemChannelFlags = BigInt(sourceGuild.systemChannelFlags);
    } catch {
      failures.push('Cờ kênh hệ thống không hợp lệ trong snapshot.');
    }
  }
  if (targetGuild.edit && Object.keys(guildOptions).length > 1) {
    try {
      await targetGuild.edit(guildOptions);
    } catch (error) {
      // Icon/banner có thể bị Discord từ chối nếu server đích chưa đủ
      // feature/boost. Vẫn khôi phục tên và các setting cơ bản trong lần thử
      // thứ hai để một asset không làm hỏng toàn bộ migration.
      const { icon, banner, ...basicGuildOptions } = guildOptions;
      try {
        await targetGuild.edit(basicGuildOptions);
        failures.push(`Asset nhận diện server chưa áp dụng: ${error.message}`);
      } catch (basicError) {
        failures.push(`Thiết lập server: ${basicError.message}`);
      }
    }
  }

  const snapshotRoles = Array.isArray(snapshot.roles) ? snapshot.roles : [];
  const snapshotChannels = Array.isArray(snapshot.channels) ? snapshot.channels : [];
  const snapshotEmojis = Array.isArray(snapshot.emojis) ? snapshot.emojis : [];
  const snapshotStickers = Array.isArray(snapshot.stickers) ? snapshot.stickers : [];

  for (const role of snapshotRoles.filter((item) => !item.managed && item.id !== sourceGuildId)) {
    try {
      const roleName = normalizedName(role.name);
      const targetRole = cacheFind(targetGuild.roles.cache, (item) => (
        normalizedName(item.name) === roleName && !item.managed
      ));
      let resolvedRole = targetRole;
      if (!resolvedRole) {
        const basicOptions = roleBasicOptions(role, targetGuild, sourceGuildId);
        try {
          resolvedRole = await targetGuild.roles.create({ ...basicOptions, ...roleIconOptions(role) });
        } catch (assetError) {
          // Role icon/unicode emoji is optional on lower boost tiers. Retry
          // the role itself so members can still receive its permissions.
          if (!role.iconAssetData && !role.unicodeEmoji) throw assetError;
          resolvedRole = await targetGuild.roles.create(basicOptions);
        }
        created.roles++;
      } else {
        reused.roles++;
        if (resolvedRole.edit && resolvedRole.editable) {
          const basicOptions = roleBasicOptions(role, targetGuild, sourceGuildId);
          try {
            await resolvedRole.edit({ ...basicOptions, ...roleIconOptions(role) });
          } catch (assetError) {
            if (!role.iconAssetData && !role.unicodeEmoji) throw assetError;
            await resolvedRole.edit(basicOptions);
          }
        }
      }
      roleMap.set(role.id, resolvedRole.id);
    } catch (error) {
      failures.push(`Role ${role.name}: ${error.message}`);
    }
  }

  const rawRolePositions = snapshotRoles
    .filter((role) => !role.managed && role.id !== sourceGuildId && roleMap.has(role.id))
    .map((role) => ({
      role: roleMap.get(role.id),
      position: Number(role.position) || 0,
      targetRole: cacheFind(targetGuild.roles.cache, (item) => item.id === roleMap.get(role.id)),
    }))
    .filter((position) => position.targetRole?.editable !== false)
    .map(({ targetRole, ...position }) => position)
    .filter((position) => position.position > 0);
  const botHighestPosition = Number(targetGuild.members?.me?.roles?.highest?.position);
  let rolePositions = rawRolePositions;
  if (Number.isFinite(botHighestPosition) && botHighestPosition > 1 && rawRolePositions.length) {
    const maxPosition = botHighestPosition - 1;
    const sourceHighestPosition = Math.max(...rawRolePositions.map((item) => item.position));
    const shift = Math.max(0, sourceHighestPosition - maxPosition);
    rolePositions = rawRolePositions.map((item) => ({
      ...item,
      position: Math.max(1, Math.min(maxPosition, item.position - shift)),
    }));
  }
  if (rolePositions.length && targetGuild.roles.setPositions) {
    try {
      await targetGuild.roles.setPositions(rolePositions);
    } catch (error) {
      failures.push(`Thứ tự role: ${error.message}`);
      // Discord rejects the whole batch when even one role cannot be moved.
      // Retry independently so one hierarchy conflict does not discard every
      // recoverable role position.
      for (const rolePosition of rolePositions) {
        const targetRole = cacheFind(targetGuild.roles.cache, (item) => item.id === rolePosition.role);
        if (!targetRole?.setPosition) continue;
        try {
          await targetRole.setPosition(rolePosition.position, 'Cenar recovery: đồng bộ thứ tự role');
        } catch (positionError) {
          failures.push(`Thứ tự role ${targetRole.name}: ${positionError.message}`);
        }
      }
    }
  }

  const categoryMap = new Map();
  const sourceCategories = snapshotChannels.filter((channel) => channel.type === ChannelType.GuildCategory);
  for (const category of sourceCategories) {
    try {
      let targetCategory = cacheFind(
        targetGuild.channels.cache,
        (channel) => channel.type === ChannelType.GuildCategory
          && normalizedName(channel.name) === normalizedName(category.name),
      );
      const overwrites = buildOverwriteSnapshot(
        category.permissionOverwrites,
        sourceGuildId,
        targetGuild.id,
        roleMap,
      );
      if (!targetCategory) {
        targetCategory = await targetGuild.channels.create({
          name: category.name,
          type: ChannelType.GuildCategory,
          position: category.position,
          permissionOverwrites: overwrites,
          reason: `Cenar recovery từ guild ${sourceGuildId}`,
        });
        created.channels++;
      } else {
        reused.channels++;
        await syncPermissionOverwrites(targetCategory, overwrites);
      }
      categoryMap.set(category.id, targetCategory.id);
      channelMap.set(category.id, targetCategory.id);
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
  for (const channel of snapshotChannels.filter((item) => supportedChannelTypes.has(item.type))) {
    try {
      const parentId = channel.parentId ? categoryMap.get(channel.parentId) || null : null;
      let targetChannel = cacheFind(targetGuild.channels.cache, (item) => (
        item.type === channel.type
        && normalizedName(item.name) === normalizedName(channel.name)
        && (item.parentId || null) === parentId
      ));
      const overwrites = buildOverwriteSnapshot(
        channel.permissionOverwrites,
        sourceGuildId,
        targetGuild.id,
        roleMap,
      );
      if (!targetChannel) {
        const options = channelEditOptions(channel, parentId, overwrites);
        options.type = channel.type;
        options.position = channel.position;
        targetChannel = await targetGuild.channels.create(options);
        created.channels++;
      } else {
        reused.channels++;
        if (targetChannel.edit) await targetChannel.edit(channelEditOptions(channel, parentId, overwrites));
        await syncPermissionOverwrites(targetChannel, overwrites);
      }
      channelMap.set(channel.id, targetChannel.id);
    } catch (error) {
      failures.push(`Kênh ${channel.name}: ${error.message}`);
    }
  }

  const channelPositions = snapshotChannels
    .filter((channel) => channelMap.has(channel.id))
    .map((channel) => ({
      channel: channelMap.get(channel.id),
      position: Number(channel.position) || 0,
      ...(channel.parentId ? { parent: categoryMap.get(channel.parentId) || null } : {}),
    }));
  if (channelPositions.length && targetGuild.channels.setPositions) {
    try {
      await targetGuild.channels.setPositions(channelPositions);
    } catch (error) {
      failures.push(`Thứ tự kênh: ${error.message}`);
    }
  }

  if (targetGuild.edit) {
    const linkedChannelFields = [
      ['systemChannel', 'systemChannelId'],
      ['rulesChannel', 'rulesChannelId'],
      ['publicUpdatesChannel', 'publicUpdatesChannelId'],
      ['safetyAlertsChannel', 'safetyAlertsChannelId'],
    ];
    const mappedLinkedChannels = {};
    for (const [editKey, snapshotKey] of linkedChannelFields) {
      if (!Object.prototype.hasOwnProperty.call(sourceGuild, snapshotKey)) continue;
      const sourceChannelId = sourceGuild[snapshotKey];
      const targetChannelId = sourceChannelId ? channelMap.get(sourceChannelId) : null;
      if (sourceChannelId && !targetChannelId) continue;
      mappedLinkedChannels[editKey] = targetChannelId || null;
    }
    if (Object.keys(mappedLinkedChannels).length) {
      try {
        await targetGuild.edit({ ...mappedLinkedChannels, reason: `Cenar recovery từ guild ${sourceGuildId}` });
      } catch (error) {
        failures.push(`Kênh hệ thống: ${error.message}`);
      }
    }
  }

  for (const emoji of snapshotEmojis) {
    try {
      const existing = cacheFind(targetGuild.emojis.cache, (item) => item.name === emoji.name);
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

  for (const sticker of snapshotStickers) {
    try {
      if (!targetGuild.stickers?.create) throw new Error('Bot/Discord.js chưa hỗ trợ quản lý sticker');
      const existing = cacheFind(targetGuild.stickers.cache, (item) => item.name === sticker.name);
      if (existing) {
        reused.stickers++;
        continue;
      }
      const file = stickerFile(sticker);
      if (!file) throw new Error('Không có asset sticker để tải lên');
      await targetGuild.stickers.create({
        file,
        name: sticker.name,
        tags: sticker.tags || 'sparkles',
        description: sticker.description,
        reason: `Cenar recovery từ guild ${sourceGuildId}`,
      });
      created.stickers++;
    } catch (error) {
      failures.push(`Sticker ${sticker.name}: ${error.message}`);
    }
  }

  return { capturedAt: row.captured_at, created, reused, failures };
}

export function getRecoveryRoleMapping(memberRolesJson, targetGuild) {
  let sourceRoles = [];
  try {
    sourceRoles = JSON.parse(memberRolesJson || '[]');
  } catch {
    return { ids: [], skipped: [] };
  }
  if (!Array.isArray(sourceRoles)) return { ids: [], skipped: [] };
  const roles = cacheValues(targetGuild.roles.cache);
  const ids = new Set();
  const skipped = [];
  for (const sourceRole of sourceRoles) {
    const name = normalizedName(sourceRole?.name);
    if (!name) continue;
    const targetRole = roles.find((role) => !role.managed && normalizedName(role.name) === name);
    if (!targetRole) {
      skipped.push(sourceRole.name);
    } else if (targetRole.editable === false) {
      skipped.push(`${sourceRole.name} (vượt role cao nhất của bot)`);
    } else {
      ids.add(targetRole.id);
    }
  }
  return { ids: [...ids], skipped };
}

export function mapRecoveryRoleIds(memberRolesJson, targetGuild) {
  return getRecoveryRoleMapping(memberRolesJson, targetGuild).ids;
}

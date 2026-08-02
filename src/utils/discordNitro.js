const NITRO_ROLE_NAME = /(?:^|\s)(?:nitro|server\s*booster?|booster)(?:\s|$)/i;

export function getMemberNitroEligibility(member, configuredRoleIds = []) {
  const premiumSince = member?.premiumSince || member?.premiumSinceTimestamp || null;
  if (premiumSince) return { hasNitroBoost: true, source: 'premium-since' };

  const roleCache = member?.roles?.cache;
  if (!roleCache) return { hasNitroBoost: false, source: 'none' };

  const configuredMatch = configuredRoleIds.some((roleId) => roleCache.has(String(roleId)));
  if (configuredMatch) return { hasNitroBoost: true, source: 'configured-role' };

  const namedMatch = [...roleCache.values()].some((role) => NITRO_ROLE_NAME.test(String(role?.name || '')));
  return namedMatch
    ? { hasNitroBoost: true, source: 'named-role' }
    : { hasNitroBoost: false, source: 'none' };
}

export function getDiscordNitroEligibility({
  member,
  userId,
  configuredRoleIds = [],
  configuredUserIds = [],
}) {
  if (configuredUserIds.includes(String(userId))) {
    return { hasNitroBoost: true, source: 'configured-user' };
  }
  return getMemberNitroEligibility(member, configuredRoleIds);
}

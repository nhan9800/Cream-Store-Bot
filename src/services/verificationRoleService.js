function normalizeRoleName(value) {
  return String(value || '').trim().toLocaleLowerCase('vi-VN');
}

function isVerificationRoleName(name) {
  const normalized = normalizeRoleName(name);
  if (!normalized || normalized.includes('bot') || normalized.includes('patron')) return false;

  return normalized === 'cenar member'
    || normalized === 'explorer'
    || normalized === 'active customer'
    || normalized.includes('verified')
    || normalized.includes('xác minh')
    || normalized.includes('xac minh')
    || normalized.includes('member');
}

/**
 * Resolve the role that is granted only after a successful Discord OAuth callback.
 * Customer/VIP roles are intentionally excluded so purchase activity cannot be
 * mistaken for account verification.
 */
export function resolveVerificationRole(guild) {
  const cache = guild?.roles?.cache;
  if (!cache) return null;

  const configuredRoleId = String(process.env.VERIFIED_ROLE_ID || '').trim();
  if (configuredRoleId) {
    const configuredRole = cache.get(configuredRoleId);
    if (configuredRole && !configuredRole.managed) return configuredRole;
  }

  const exactNames = ['cenar member', 'explorer', 'active customer'];
  for (const exactName of exactNames) {
    const exactRole = cache.find((role) => (
      !role.managed && normalizeRoleName(role.name) === exactName
    ));
    if (exactRole) return exactRole;
  }

  return cache.find((role) => !role.managed && isVerificationRoleName(role.name)) || null;
}

export function memberHasVerificationRole(member, role) {
  return Boolean(member && role?.id && member.roles.cache.has(role.id));
}


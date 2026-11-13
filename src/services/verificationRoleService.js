import { PermissionFlagsBits } from 'discord.js';
import { BUYER_TIERS, MEMBER_ROLES } from '../config/membershipProgram.js';

const EXPLORER_ROLE_ID = MEMBER_ROLES.find((role) => role.key === 'explorer')?.id;
const BUYER_ROLE_IDS = new Set(BUYER_TIERS.map((role) => role.id));
const DANGEROUS_PERMISSIONS = [
  'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels',
  'KickMembers', 'BanMembers', 'ModerateMembers', 'ManageMessages',
  'ManageWebhooks', 'ManageEvents', 'ManageGuildExpressions', 'ManageThreads',
  'MuteMembers', 'DeafenMembers', 'MoveMembers', 'ManageNicknames',
  'ViewAuditLog', 'MentionEveryone',
].reduce((mask, permission) => mask | PermissionFlagsBits[permission], 0n);

// Strip decoration around a known alias; never match arbitrary role-name substrings.
function normalizeRoleName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('vi-VN')
    .replace(/<a?:\w+:\d+>/g, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/[\s｜|•・·_-]+/g, ' ')
    .trim();
}

const VERIFICATION_ALIASES = new Set([
  'cenar member', 'cenar explorer', 'explorer', 'member',
  'verified', 'verified member', 'cenar verified', 'cenar verified member',
  'xác minh', 'xac minh', 'đã xác minh', 'da xac minh',
  'thành viên', 'thanh vien', 'cenar thành viên', 'cenar thanh vien',
]);

function isSafeVerificationRole(guild, role, botMember = guild.members?.me) {
  if (!role || !role.id || role.id === guild.id || role.managed || BUYER_ROLE_IDS.has(role.id)) return false;
  const name = normalizeRoleName(role.name);
  // Active Customer is a historical purchaser alias, not proof of verification.
  if (/\b(?:buyer|customer|patron|vip|elite|diamond|ruby|sovereign|prestige|signature)\b/u.test(name)
    || name === 'cenar select' || /khách hàng|khach hang/u.test(name)) return false;

  try {
    if ((BigInt(role.permissions?.bitfield ?? role.permissions ?? 0n) & DANGEROUS_PERMISSIONS) !== 0n) return false;
  } catch {
    return false;
  }

  // Real Discord Role.editable checks ManageRoles and role hierarchy. The
  // explicit checks also cover cached/mock roles without that getter.
  try { if (role.editable === false) return false; } catch { return false; }
  if (botMember?.permissions?.has && !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return false;
  const highest = botMember?.roles?.highest;
  if (typeof highest?.comparePositionTo === 'function') {
    if (highest.comparePositionTo(role) <= 0) return false;
  } else if (Number.isFinite(highest?.position) && Number.isFinite(role.position) && highest.position <= role.position) {
    return false;
  }
  return true;
}

/**
 * Resolve the role that is granted only after a successful Discord OAuth callback.
 * Customer/VIP roles are intentionally excluded so purchase activity cannot be
 * mistaken for account verification.
 */
export function resolveVerificationRole(guild, { roles: cache = guild?.roles?.cache, botMember = guild?.members?.me } = {}) {
  if (!cache) return null;

  const configuredRoleId = String(process.env.VERIFIED_ROLE_ID || '').trim();
  if (configuredRoleId) {
    const configuredRole = cache.get(configuredRoleId);
    return isSafeVerificationRole(guild, configuredRole, botMember) ? configuredRole : null;
  }

  // Cenar Circle renamed the original member role; its stable ID is unchanged.
  const explorerRole = cache.get(EXPLORER_ROLE_ID);
  if (explorerRole) return isSafeVerificationRole(guild, explorerRole, botMember) ? explorerRole : null;

  for (const exactName of VERIFICATION_ALIASES) {
    const exactRole = cache.find((role) => (
      normalizeRoleName(role.name) === exactName && isSafeVerificationRole(guild, role, botMember)
    ));
    if (exactRole) return exactRole;
  }

  return null;
}

/** Refresh once after member awaits; never grant from an old cached alias. */
export async function resolveFreshVerificationRole(guild, { botId } = {}) {
  const guildId = guild?.id;
  const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
  const unavailable = () => new Error('Verification role metadata unavailable');
  if (!snowflake(guildId) || !snowflake(botId) || guild.client?.user?.id !== botId
    || typeof guild.roles?.fetch !== 'function' || typeof guild.members?.fetchMe !== 'function') throw unavailable();
  const [roles, botMember] = await Promise.all([guild.roles.fetch(), guild.members.fetchMe({ force: true })]);
  if (guild.id !== guildId || guild.client?.user?.id !== botId || botMember?.id !== botId
    || botMember.guild?.id !== guildId || botMember.partial === true
    || typeof roles?.get !== 'function' || typeof roles?.find !== 'function' || typeof roles?.has !== 'function' || !roles.has(guildId)
    || typeof botMember.permissions?.has !== 'function' || !botMember.roles?.highest) throw unavailable();
  const role = resolveVerificationRole(guild, { roles, botMember });
  if (!role) return null;
  if (role.guild?.id !== guildId || !snowflake(role.id) || typeof role.managed !== 'boolean'
    || !Number.isFinite(role.position) || typeof role.permissions?.bitfield !== 'bigint') throw unavailable();
  return role;
}

export function memberHasVerificationRole(member, role) {
  return Boolean(member && role?.id && member.roles.cache.has(role.id));
}


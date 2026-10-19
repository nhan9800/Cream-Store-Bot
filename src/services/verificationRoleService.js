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

function isSafeVerificationRole(guild, role) {
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
  if (role.editable === false) return false;
  const botMember = guild.members?.me;
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
export function resolveVerificationRole(guild) {
  const cache = guild?.roles?.cache;
  if (!cache) return null;

  const configuredRoleId = String(process.env.VERIFIED_ROLE_ID || '').trim();
  if (configuredRoleId) {
    const configuredRole = cache.get(configuredRoleId);
    return isSafeVerificationRole(guild, configuredRole) ? configuredRole : null;
  }

  // Cenar Circle renamed the original member role; its stable ID is unchanged.
  const explorerRole = cache.get(EXPLORER_ROLE_ID);
  if (explorerRole) return isSafeVerificationRole(guild, explorerRole) ? explorerRole : null;

  for (const exactName of VERIFICATION_ALIASES) {
    const exactRole = cache.find((role) => (
      normalizeRoleName(role.name) === exactName && isSafeVerificationRole(guild, role)
    ));
    if (exactRole) return exactRole;
  }

  return null;
}

export function memberHasVerificationRole(member, role) {
  return Boolean(member && role?.id && member.roles.cache.has(role.id));
}


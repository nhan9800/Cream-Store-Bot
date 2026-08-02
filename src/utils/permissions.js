import { PermissionFlagsBits } from 'discord.js';

export const TICKET_MEMBER_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AddReactions,
];

export const STAFF_DEFAULT_PERMISSIONS = PermissionFlagsBits.ManageGuild;

export function isManager(member, guildConfig) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return Boolean(guildConfig?.manager_role_id && member.roles.cache.has(guildConfig.manager_role_id));
}

export function isShipper(member, guildConfig) {
  if (!member) return false;
  if (isManager(member, guildConfig)) return true;
  return Boolean(guildConfig?.shipper_role_id && member.roles.cache.has(guildConfig.shipper_role_id));
}

export function isSupport(member, guildConfig) {
  if (!member) return false;
  if (isManager(member, guildConfig)) return true;
  return Boolean(guildConfig?.support_role_id && member.roles.cache.has(guildConfig.support_role_id));
}

export function isStaffMember(member, guildConfig) {
  return isSupport(member, guildConfig) || isShipper(member, guildConfig) || isManager(member, guildConfig);
}

export function assertStaffCapability(member, guildConfig, capability) {
  switch (capability) {
    case 'SHIP':
      return isShipper(member, guildConfig);
    case 'MANAGE':
      return isManager(member, guildConfig);
    case 'SUPPORT':
    default:
      return isSupport(member, guildConfig);
  }
}

import { config } from '../config.js';

export function isBotDeveloper(userId) {
  return config.adminDiscordIds.includes(String(userId));
}

export function hasConfiguredOwnerRole(member) {
  if (!member?.roles?.cache) return false;
  return config.ownerRoleIds.some((roleId) => member.roles.cache.has(String(roleId)));
}

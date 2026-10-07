import { getGuildConfig } from './guildConfigService.js';
import { config } from '../config.js';
import { getCustomerFlag } from './blacklistService.js';
import { getCustomerActivitySummary, getCustomerPurchaseSummary } from './customerActivityService.js';
import { backfillCustomerRoleSync, processPendingCustomerRoles, queueCustomerRoleSync } from './customerRoleSyncService.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { BUYER_TIERS, MEMBER_ROLES, PROGRESS_TIERS } from '../config/membershipProgram.js';

const VIP_TIERS = BUYER_TIERS.map(tier => ({...tier, name:tier.label}));

const CENAR_PROGRAM_ROLE_IDS = new Set([
  ...VIP_TIERS.map((tier) => tier.id),
  '1522844528237740066', // Partner
  '1522844530242748446', // CTV
]);

function colorHex(value) {
  const number = Number(value) || 0;
  return number ? `#${number.toString(16).padStart(6, '0')}` : null;
}

export async function getCustomerDiscordRoleSnapshot(client, customerId) {
  const guild = client?.guilds?.cache?.get(config.guildId)
    || await client?.guilds?.fetch?.(config.guildId).catch(() => null);
  if (!guild) return { guildId: config.guildId, guildName: null, memberFound: false, roles: [], syncedAt: new Date().toISOString() };
  const member = await guild.members.fetch(String(customerId)).catch(() => null);
  if (!member) return { guildId: guild.id, guildName: guild.name, memberFound: false, roles: [], syncedAt: new Date().toISOString() };

  const roles = [...member.roles.cache.values()]
    .filter((role) => role.id !== guild.id && !role.managed)
    .sort((left, right) => right.position - left.position)
    .slice(0, 40)
    .map((role) => ({
      id: role.id,
      name: role.name,
      position: role.position,
      color: colorHex(role.color),
      colors: {
        primary: colorHex(role.colors?.primaryColor ?? role.color),
        secondary: colorHex(role.colors?.secondaryColor),
        tertiary: colorHex(role.colors?.tertiaryColor),
      },
      iconUrl: role.iconURL?.({ size: 64 }) || null,
      cenarManaged: CENAR_PROGRAM_ROLE_IDS.has(role.id),
    }));

  return {
    guildId: guild.id,
    guildName: guild.name,
    memberFound: true,
    roles,
    syncedAt: new Date().toISOString(),
  };
}

export const CUSTOMER_MEMBERSHIP_TIERS = PROGRESS_TIERS;

export function getCustomerMembershipProgress(profile = {}) {
  const orderSpent = Math.max(0, Number(profile.total_spent || 0));
  const serviceSpent = Math.max(0, Number(profile.service_spent || 0));
  const spent = orderSpent + serviceSpent;
  const completedOrders = Math.max(0, Number(profile.total_completed_orders || 0));
  const serviceActivityCount = Math.max(0, Number(profile.service_activity_count || 0));
  const achieved = CUSTOMER_MEMBERSHIP_TIERS.filter((tier) => (
    tier.requireOrder ? completedOrders > 0 || serviceActivityCount > 0 || spent > 0 : spent >= tier.minSpent
  ));
  const current = achieved[achieved.length - 1] || MEMBER_ROLES.at(-1);
  const next = CUSTOMER_MEMBERSHIP_TIERS.find((tier) => !achieved.some((entry) => entry.key === tier.key)) || null;
  const currentFloor = Number(current.minSpent || 0);
  const nextTarget = Number(next?.minSpent || 0);
  const progressPercent = next
    ? next.requireOrder
      ? 0
      : Math.max(0, Math.min(100, Math.round(((spent - currentFloor) / Math.max(1, nextTarget - currentFloor)) * 100)))
    : 100;

  return {
    totalSpent: spent,
    orderSpent,
    serviceSpent,
    completedOrders,
    serviceActivityCount,
    current: { key: current.key, label: current.label, minSpent: currentFloor },
    next: next ? { key: next.key, label: next.label, minSpent: nextTarget, requireOrder: Boolean(next.requireOrder) } : null,
    remaining: next ? Math.max(0, nextTarget - spent) : 0,
    progressPercent,
    achievedCount: achieved.length,
    tiers: CUSTOMER_MEMBERSHIP_TIERS.map((tier) => ({
      key: tier.key,
      label: tier.label,
      minSpent: tier.minSpent,
      requireOrder: Boolean(tier.requireOrder),
      achieved: achieved.some((entry) => entry.key === tier.key),
    })),
  };
}

export function resolveCustomerRoleTiers(guild, guildConfig = {}) {
  const roles = guild.roles?.cache;
  const patronId = guildConfig.customer_role_id
    || (guild.id === STORE_ONE_GUILD_ID ? VIP_TIERS.at(-1).id : null)
    || roles?.find?.((role) => !role.managed && /^(?:Cenar Patron|(?:🛒\s*[｜|]\s*)?Active Customer)$/i.test(role.name))?.id;
  // Role IDs belong to their guild. Configured IDs take precedence; other
  // fixed tiers are used only when present in this guild's role cache.
  const tiers = VIP_TIERS.filter((tier) => tier.minSpent > 0).map((tier) => ({
    ...tier,
    id: tier.minSpent === 1_000_000 && guildConfig.vip_role_id ? guildConfig.vip_role_id : tier.id,
  })).filter((tier) => roles?.has(tier.id) || tier.id === guildConfig.vip_role_id);
  if (patronId) tiers.push({ ...VIP_TIERS.at(-1), id: patronId });
  return tiers;
}

export async function applyCustomerRoles(guild, customerId, { retryOnFailure = true } = {}) {
  const fail = (error) => {
    if (retryOnFailure) queueCustomerRoleSync(guild.id, customerId, { preservePending: true });
    return { synced: false, applied: [], removed: [], error };
  };
  const guildConfig = getGuildConfig(guild.id) || {};
  let member;
  try {
    // Force a REST refresh so repeated payment/rejoin events see actual roles.
    member = await guild.members.fetch({ user: customerId, force: true });
  } catch (error) {
    return fail(Number(error.code) === 10007 ? 'MEMBER_NOT_FOUND' : String(error.code || 'MEMBER_FETCH_FAILED'));
  }
  if (!member) return fail('MEMBER_NOT_FOUND');

  const purchases = getCustomerPurchaseSummary(guild.id, customerId);
  const activity = getCustomerActivitySummary(guild.id, customerId);
  const flags = getCustomerFlag(guild.id, customerId);
  const completed = purchases.completed;
  const spent = purchases.spent + activity.serviceSpent;

  const isBlacklist = Number(flags?.is_blacklisted ?? 0) === 1;

  const shouldHave = new Set();
  
  if (guildConfig.blacklist_role_id && isBlacklist) shouldHave.add(guildConfig.blacklist_role_id);

  const tiers = resolveCustomerRoleTiers(guild, guildConfig);
  if ((purchases.paidOrders > 0 || activity.activityCount > 0) && !tiers.some((tier) => tier.requireActivity)) {
    return fail('CUSTOMER_ROLE_NOT_CONFIGURED');
  }

  // Evaluate VIP Tiers (Additive stacking)
  for (const tier of tiers) {
    let qualified = false;
    if (tier.minSpent > 0 && spent >= tier.minSpent) {
        qualified = true;
    } else if (tier.requireActivity && (purchases.paidOrders > 0 || activity.activityCount > 0)) {
        qualified = true;
    }

    if (qualified) {
        shouldHave.add(tier.id);
    }
  }

  // Quản lý Role (Blacklist + VIP)
  const managed = [
    guildConfig.blacklist_role_id,
    ...tiers.map(t => t.id)
  ].filter(Boolean);

  const toAdd = managed.filter((roleId) => shouldHave.has(roleId) && !member.roles.cache.has(roleId));
  const toRemove = managed.filter((roleId) => !shouldHave.has(roleId) && member.roles.cache.has(roleId));

  const applied = [];
  const removed = [];
  const failed = [];
  for (const [action, roleIds, successes] of [['add', toAdd, applied], ['remove', toRemove, removed]]) {
    for (const roleId of roleIds) {
      try {
        await member.roles[action](roleId, 'Cenar: synchronize confirmed customer purchases');
        successes.push(roleId);
      } catch (error) {
        failed.push({ roleId, action, error: String(error.code || 'ROLE_UPDATE_FAILED') });
      }
    }
  }
  if (failed.length) {
    console.warn(`[CUSTOMER-ROLES] guild=${guild.id} failed=${failed.length} code=${failed[0].error}`);
    if (retryOnFailure) queueCustomerRoleSync(guild.id, customerId, { preservePending: true });
  }
  const newlyAssignedRoles = tiers.filter((tier) => applied.includes(tier.id));

  // Trigger Notification to Customer
  if (newlyAssignedRoles.length > 0 && !isBlacklist) {
      // Find the highest tier they just qualified for (since arrays are highest->lowest)
      const highestTier = newlyAssignedRoles.find(r => r.minSpent > 0) || newlyAssignedRoles[0];
      
      try {
          const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = await import('discord.js');
          const { createEmojiResolver } = await import('../utils/emojiHelper.js');
          const E = createEmojiResolver(guild.id);
          const container = new ContainerBuilder().setAccentColor(0xa855f7);
          container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent([
              `## ${E('customer_patron')} Đã Mở Khóa Vai Trò Khách Hàng`,
              `> Hệ thống Cenar đã ghi nhận hoạt động dịch vụ của **${member.user.username}**.`,
              '',
              `${E('status_check')} **Vai trò mới** — ${highestTier.name}`,
              `${E('icon_sparkle')} Quyền lợi đã được đồng bộ tự động tại **${guild.name}**.`,
            ].join('\n')),
          );
          await member.send({ components: [container], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
      } catch (error) {
          console.error("Failed to send VIP role DM:", error);
      }
  }

  return { synced: failed.length === 0, applied, removed, failed, completed, spent, activity };
}

export async function syncCustomerActivityRoles(client) {
  const backfill = backfillCustomerRoleSync();
  const result = await processPendingCustomerRoles(client, { limit: 100 });
  return { scanned: backfill.scanned, queued: backfill.queued, synced: result.synced, skipped: result.pending };
}

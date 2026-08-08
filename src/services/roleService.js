import { getGuildConfig } from './guildConfigService.js';
import { getCustomerProfile } from './customerService.js';
import { getCustomerFlag } from './blacklistService.js';
import { getCustomerActivitySummary, listActivityCustomers } from './customerActivityService.js';

const VIP_TIERS = [
  { id: '1282637775291551776', name: 'Ruby Client', minSpent: 8000000 },
  { id: '1282637814571466808', name: 'Diamond Client', minSpent: 5000000 },
  { id: '1282637470139420694', name: 'Elite VIP', minSpent: 3000000 },
  { id: '1282637168149532724', name: 'VIP Client', minSpent: 1000000 },
  { id: '1282637103045279820', name: 'Cenar Patron', minSpent: 0, requireActivity: true },
];

export const CUSTOMER_MEMBERSHIP_TIERS = [
  { key: 'active', label: 'Active Customer', minSpent: 0, requireOrder: true },
  { key: 'vip', label: 'VIP Client', minSpent: 1_000_000 },
  { key: 'elite', label: 'Elite VIP', minSpent: 3_000_000 },
  { key: 'diamond', label: 'Diamond Client', minSpent: 5_000_000 },
  { key: 'ruby', label: 'Ruby Client', minSpent: 8_000_000 },
];

export function getCustomerMembershipProgress(profile = {}) {
  const orderSpent = Math.max(0, Number(profile.total_spent || 0));
  const serviceSpent = Math.max(0, Number(profile.service_spent || 0));
  const spent = orderSpent + serviceSpent;
  const completedOrders = Math.max(0, Number(profile.total_completed_orders || 0));
  const serviceActivityCount = Math.max(0, Number(profile.service_activity_count || 0));
  const achieved = CUSTOMER_MEMBERSHIP_TIERS.filter((tier) => (
    tier.requireOrder ? completedOrders > 0 || serviceActivityCount > 0 || spent > 0 : spent >= tier.minSpent
  ));
  const current = achieved[achieved.length - 1] || { key: 'explorer', label: 'Explorer', minSpent: 0 };
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

export async function applyCustomerRoles(guild, customerId) {
  const guildConfig = getGuildConfig(guild.id);
  if (!guildConfig) return { applied: [] };

  const member = await guild.members.fetch(customerId).catch(() => null);
  if (!member) return { applied: [] };

  const profile = getCustomerProfile(guild.id, customerId);
  const activity = getCustomerActivitySummary(guild.id, customerId);
  const flags = getCustomerFlag(guild.id, customerId);
  const completed = Number(profile?.total_completed_orders ?? 0);
  const spent = Number(profile?.total_spent ?? 0) + activity.serviceSpent;

  const isBlacklist = Number(flags?.is_blacklisted ?? 0) === 1;

  const shouldHave = new Set();
  
  if (guildConfig.blacklist_role_id && isBlacklist) shouldHave.add(guildConfig.blacklist_role_id);

  const newlyAssignedRoles = [];

  // Evaluate VIP Tiers (Additive stacking)
  for (const tier of VIP_TIERS) {
    let qualified = false;
    if (tier.minSpent > 0 && spent >= tier.minSpent) {
        qualified = true;
    } else if (tier.requireActivity && (completed > 0 || activity.activityCount > 0 || spent > 0)) {
        qualified = true;
    }

    if (qualified) {
        shouldHave.add(tier.id);
        if (!member.roles.cache.has(tier.id)) {
            newlyAssignedRoles.push(tier);
        }
    }
  }

  // Quản lý Role (Blacklist + VIP)
  const managed = [
    guildConfig.blacklist_role_id,
    ...VIP_TIERS.map(t => t.id)
  ].filter(Boolean);

  const toAdd = managed.filter((roleId) => shouldHave.has(roleId) && !member.roles.cache.has(roleId));
  const toRemove = managed.filter((roleId) => !shouldHave.has(roleId) && member.roles.cache.has(roleId));

  for (const roleId of toAdd) {
    await member.roles.add(roleId).catch(() => null);
  }
  for (const roleId of toRemove) {
    await member.roles.remove(roleId).catch(() => null);
  }

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

  return { applied: toAdd, removed: toRemove, completed, spent, activity };
}

export async function syncCustomerActivityRoles(client) {
  const rows = listActivityCustomers();
  const result = { scanned: rows.length, synced: 0, skipped: 0 };
  for (const row of rows) {
    const guild = client.guilds.cache.get(row.guild_id)
      || await client.guilds.fetch(row.guild_id).catch(() => null);
    if (!guild) {
      result.skipped++;
      continue;
    }
    const applied = await applyCustomerRoles(guild, row.customer_id).catch(() => null);
    if (applied) result.synced++;
    else result.skipped++;
  }
  return result;
}

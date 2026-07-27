import { db } from '../database/db.js';
import { ChannelType, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { createTicket } from './ticketService.js';

// ─── Emoji custom của Cenar Store ────────────
const E = (key) => {
  const map = {
    icon_sparkle: '<a:tsm_fire:1327553120842158111>',
    icon_gift:    '🎁',
    icon_star:    '<:star:1327549089704837142>',
    icon_arrow_right: '<:muiten:1481124261501337601>',
    icon_lock:    '🔒',
  };
  return map[key] || '⭐';
};

// Cache to store invites: guildId -> Collection of invites
const invitesCache = new Map();

/**
 * Initialize invite cache for all guilds
 */
export async function initInviteCache(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const invites = await guild.invites.fetch().catch(() => null);
      if (invites) {
        invitesCache.set(guild.id, invites);
      }
    } catch (err) {
      console.error(`[INVITE-TRACKER] Could not fetch invites for guild ${guild.id}:`, err.message);
    }
  }
}

/**
 * Handle new member joining
 */
export async function handleMemberAdd(member) {
  const guild = member.guild;
  const cachedInvites = invitesCache.get(guild.id);
  
  if (!cachedInvites) return; // No cache available

  try {
    const newInvites = await guild.invites.fetch().catch(() => null);
    if (!newInvites) return;

    // Find the invite that was used
    const usedInvite = newInvites.find(inv => {
      const cachedInv = cachedInvites.get(inv.code);
      if (!cachedInv) return false;
      return inv.uses > cachedInv.uses;
    });

    // Update cache
    invitesCache.set(guild.id, newInvites);

    if (usedInvite && usedInvite.inviter) {
      const inviterId = usedInvite.inviter.id;
      const invitedId = member.id;

      // Don't count self-invites or bots
      if (inviterId !== invitedId && !member.user.bot) {
        db.prepare(
          'INSERT OR IGNORE INTO user_invites (invited_id, inviter_id, guild_id, has_purchased) VALUES (?, ?, ?, 0)'
        ).run(invitedId, inviterId, guild.id);
        
        console.log(`[INVITE-TRACKER] ${member.user.tag} joined using ${usedInvite.inviter.tag}'s invite.`);
      }
    }
  } catch (err) {
    console.error(`[INVITE-TRACKER] Error in handleMemberAdd:`, err);
  }
}

/**
 * Update cache when an invite is created
 */
export async function handleInviteCreate(invite) {
  const guild = invite.guild;
  if (!guild) return;
  const cachedInvites = invitesCache.get(guild.id);
  if (cachedInvites) {
    cachedInvites.set(invite.code, invite);
  }
}

/**
 * Update cache when an invite is deleted
 */
export async function handleInviteDelete(invite) {
  const guild = invite.guild;
  if (!guild) return;
  const cachedInvites = invitesCache.get(guild.id);
  if (cachedInvites) {
    cachedInvites.delete(invite.code);
  }
}

/**
 * Process pending invite rewards (called from scheduler)
 */
export async function processPendingInviteRewards(client) {
  // Find users who have at least 5 invites and 1 purchased, but haven't claimed yet
  const eligibleUsers = db.prepare(`
    SELECT inviter_id, guild_id
    FROM user_invites
    WHERE guild_id IN (SELECT guild_id FROM guild_settings)
    GROUP BY inviter_id, guild_id
    HAVING COUNT(invited_id) >= 5 
       AND SUM(has_purchased) >= 1
  `).all();

  for (const { inviter_id, guild_id } of eligibleUsers) {
    const claimed = db.prepare('SELECT id FROM invite_rewards_claimed WHERE user_id = ? AND guild_id = ? LIMIT 1').get(inviter_id, guild_id);
    if (claimed) continue; // Already claimed

    console.log(`[INVITE-TRACKER] User ${inviter_id} is eligible for the Decor Reward!`);

    // Record the claim
    db.prepare('INSERT INTO invite_rewards_claimed (user_id, guild_id) VALUES (?, ?)').run(inviter_id, guild_id);

    // Create a reward ticket for the user
    const guild = client.guilds.cache.get(guild_id);
    if (!guild) continue;

    try {
      const inviter = await guild.members.fetch(inviter_id).catch(() => null);
      if (!inviter) continue;

      const ticketResult = await createTicket(
        client,
        guild,
        inviter.user,
        'claim-decor',
        'Tự động tạo ticket nhận thưởng Decor từ Sự kiện Invite.'
      );

      if (ticketResult && ticketResult.channel) {
        const ticketChannel = ticketResult.channel;

        const container = new ContainerBuilder()
          .setBackgroundColor('#ff69b4')
          .setBorderColor('#ffffff');

        const title = new TextDisplayBuilder()
          .setText(`🎉 CHÚC MỪNG BẠN ĐÃ TRÚNG THƯỞNG! 🎉`)
          .setStyle('header1')
          .setColor('#ffffff');
          
        const desc = new TextDisplayBuilder()
          .setText(`${E('icon_sparkle')} Chào mừng <@${inviter_id}>!\n\n${E('icon_gift')} **Thành tích của bạn:**\n- Đã mời thành công: **5+** khách.\n- Đã có **1+** khách phát sinh đơn hàng!\n\n> ${E('icon_star')} **Phần thưởng của bạn:** 1 x **Hiệu ứng Hồ sơ Discord (Decor Free)**\n\n${E('icon_arrow_right')} Vui lòng nhắn tin tại đây và đợi Admin vào xử lý để nhận Decor nhé!`)
          .setStyle('paragraph')
          .setColor('#ffffff');

        container.addText(title).addText(desc);

        const closeBtn = new ButtonBuilder()
          .setCustomId('ticket:close')
          .setLabel('Khóa Ticket')
          .setStyle(ButtonStyle.Danger)
          .setEmoji(E('icon_lock'));

        const actionRow = new ActionRowBuilder().addComponents(closeBtn);

        await ticketChannel.send({
          content: `||<@${inviter_id}>|| Admin đã được thông báo!`,
          components: [container, actionRow],
          flags: MessageFlags.IsComponentsV2
        });
      }
    } catch (err) {
      console.error(`[INVITE-TRACKER] Failed to create reward ticket:`, err);
    }
  }
}

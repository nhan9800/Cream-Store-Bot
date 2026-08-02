import { 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ContainerBuilder, 
  TextDisplayBuilder, 
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize
} from 'discord.js';
import { db } from '../database/db.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getWalletBalance, addWalletBalance } from './walletService.js'; // To be used for Wallet rewards

function transitionGiveawayStatus(messageId, fromStatus, toStatus) {
  const result = db.prepare(`
    UPDATE giveaways
    SET status = ?
    WHERE message_id = ? AND status = ?
  `).run(toStatus, messageId, fromStatus);
  return result.changes === 1;
}

/**
 * Tạo một Giveaway mới
 */
export async function createGiveaway(client, channel, hostUser, prize, winnersCount, durationMs) {
  const endTime = new Date(Date.now() + durationMs);
  const endTimeUnix = Math.floor(endTime.getTime() / 1000);
  const E = createEmojiResolver(channel.guildId);

  const container = new ContainerBuilder().setAccentColor(0xFF0055); // Red/Pink accent
  
  // Header
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${E('icon_sparkle', '<a:Dotyellow:1481134440725090315>')} **GIVEAWAY TRÚNG THƯỞNG** ${E('icon_gift', '<:gift:1392749981332541501>')}`
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  // Body
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `> ${E('icon_gift', '<:gift:1392749981332541501>')} **Phần thưởng:** **${prize}**\n` +
      `> ${E('icon_member', '<:user:1348625535512870965>')} **Số lượng giải:** ${winnersCount}\n` +
      `> ${E('icon_clock', '<a:Time:1481134440725090315>')} **Kết thúc lúc:** <t:${endTimeUnix}:R> (<t:${endTimeUnix}:f>)\n` +
      `> ${E('icon_crown', '<:crown:1392749981332541501>')} **Người tổ chức:** <@${hostUser.id}>`
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));

  // Footer
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `${E('icon_shop', '<:shop:1392749981332541501>')} *Hãy ấn nút **"Tham Gia"** bên dưới để thử vận may của bạn nhé!*`
    )
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('giveaway:join')
      .setLabel('Tham Gia Ngay')
      .setEmoji({ id: '1481134440725090315' }) 
      .setStyle(ButtonStyle.Success)
  );

  const sparkleEmojiMatch = E('icon_sparkle', '<a:Dotyellow:1481134440725090315>').match(/:(\d+)>/);
  if (sparkleEmojiMatch) {
    row.components[0].setEmoji({ id: sparkleEmojiMatch[1] });
  }

  const message = await channel.send({
    components: [container, row],
    flags: MessageFlags.IsComponentsV2
  });

  db.prepare(`
    INSERT INTO giveaways (message_id, channel_id, guild_id, host_id, prize, winners_count, end_time, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
  `).run(
    message.id,
    channel.id,
    channel.guildId,
    hostUser.id,
    prize,
    winnersCount,
    endTime.toISOString()
  );

  return message;
}

/**
 * Tham gia Giveaway
 */
export async function joinGiveaway(interaction, messageId) {
  const userId = interaction.user.id;
  const giveaway = db.prepare('SELECT status FROM giveaways WHERE message_id = ?').get(messageId);
  const E = createEmojiResolver(interaction.guildId);

  if (!giveaway) {
    return interaction.reply({ content: `${E('icon_warn', '<a:warn:1481134440725090315>')} Giveaway này không tồn tại trong hệ thống.`, ephemeral: true });
  }

  if (giveaway.status !== 'ACTIVE') {
    return interaction.reply({ content: `${E('icon_warn', '<a:warn:1481134440725090315>')} Giveaway này đã kết thúc!`, ephemeral: true });
  }

  try {
    db.prepare('INSERT INTO giveaway_entries (message_id, user_id) VALUES (?, ?)').run(messageId, userId);
    
    // Đếm số người tham gia
    const count = db.prepare('SELECT COUNT(*) as c FROM giveaway_entries WHERE message_id = ?').get(messageId).c;
    
    return interaction.reply({ 
      content: `${E('icon_sparkle', '<a:Dotyellow:1481134440725090315>')} Bạn đã tham gia thành công! Hiện tại đang có **${count} người** cùng tranh giải. Chúc bạn may mắn!`, 
      ephemeral: true 
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.message.includes('UNIQUE constraint failed')) {
      // Bỏ tham gia
      db.prepare('DELETE FROM giveaway_entries WHERE message_id = ? AND user_id = ?').run(messageId, userId);
      return interaction.reply({ content: `${E('icon_warn', '<a:warn:1481134440725090315>')} Bạn đã HỦY tham gia giveaway này.`, ephemeral: true });
    }
    console.error('[GIVEAWAY] Join error:', error);
    return interaction.reply({ content: 'Có lỗi xảy ra khi tham gia.', ephemeral: true });
  }
}

/**
 * Kết thúc một Giveaway (tính toán người thắng)
 */
export async function endGiveaway(client, messageId) {
  const giveaway = db.prepare('SELECT * FROM giveaways WHERE message_id = ? AND status = ?').get(messageId, 'ACTIVE');
  if (!giveaway) return null;

  // Only one process may claim this transition. Other workers stop here.
  if (!transitionGiveawayStatus(messageId, 'ACTIVE', 'ENDED')) return null;

  const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
  if (!channel) return null;

  const message = await channel.messages.fetch(messageId).catch(() => null);
  
  const entries = db.prepare('SELECT user_id FROM giveaway_entries WHERE message_id = ?').all(messageId);
  const E = createEmojiResolver(giveaway.guild_id);

  let winnersText = '';
  let winnersList = [];

  if (entries.length === 0) {
    winnersText = 'Không có ai tham gia hợp lệ';
  } else {
    // Pick winners
    const shuffled = entries.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, giveaway.winners_count);
    winnersList = winners.map(w => w.user_id);
    winnersText = winnersList.map(id => `<@${id}>`).join(', ');
  }

  const endTimeUnix = Math.floor(new Date(giveaway.end_time).getTime() / 1000);

  const container = new ContainerBuilder().setAccentColor(0x2B2D31); // Dark grey for ended
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${E('icon_star', '<a:Dotyellow:1481134440725090315>')} **GIVEAWAY ĐÃ KẾT THÚC** ${E('icon_gift', '<:gift:1392749981332541501>')}`
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `> ${E('icon_gift', '<:gift:1392749981332541501>')} **Phần thưởng:** **${giveaway.prize}**\n` +
      `> ${E('icon_clock', '<a:Time:1481134440725090315>')} **Kết thúc lúc:** <t:${endTimeUnix}:f>\n` +
      `> ${E('icon_crown', '<:crown:1392749981332541501>')} **Người tổ chức:** <@${giveaway.host_id}>\n\n` +
      `> ${E('icon_sparkle', '<a:Dotyellow:1481134440725090315>')} **NGƯỜI TRÚNG GIẢI:** ${winnersText}`
    )
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('giveaway:ended')
      .setLabel(`Đã Kết Thúc (${entries.length} người tham gia)`)
      .setEmoji({ id: '1392749981332541501' }) // Fallback icon ID
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  const lockEmojiMatch = E('icon_warn', '<a:warn:1481134440725090315>').match(/:(\d+)>/);
  if (lockEmojiMatch) {
    row.components[0].setEmoji({ id: lockEmojiMatch[1] });
  }

  if (message) {
    await message.edit({
      components: [container, row],
      flags: MessageFlags.IsComponentsV2
    }).catch(console.error);
  }

  if (winnersList.length > 0) {
    // Ping them
    await channel.send({
      content: `${E('icon_sparkle', '<a:Dotyellow:1481134440725090315>')} Chúc mừng ${winnersText} đã trúng giải **${giveaway.prize}**! Hãy liên hệ người tổ chức (<@${giveaway.host_id}>) hoặc mở Ticket để nhận thưởng!`
    }).catch(console.error);
  } else {
    await channel.send({
      content: `${E('icon_warn', '<a:warn:1481134440725090315>')} Không có ai trúng giải **${giveaway.prize}** do không có người tham gia.`
    }).catch(console.error);
  }

  return winnersList;
}

/**
 * Reroll (Bốc thăm lại)
 */
export async function rerollGiveaway(client, messageId) {
  const giveaway = db.prepare('SELECT * FROM giveaways WHERE message_id = ? AND status = ?').get(messageId, 'ENDED');
  const E = createEmojiResolver(giveaway ? giveaway.guild_id : '');

  if (!giveaway) {
    return 'Giveaway không tồn tại hoặc chưa kết thúc!';
  }

  const entries = db.prepare('SELECT user_id FROM giveaway_entries WHERE message_id = ?').all(messageId);
  if (entries.length === 0) {
    return 'Không có ai tham gia hợp lệ để reroll!';
  }

  const winner = entries[Math.floor(Math.random() * entries.length)];
  
  const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
  if (channel) {
    await channel.send(`${E('icon_sparkle', '<a:Dotyellow:1481134440725090315>')} **BỐC THĂM LẠI:** Chúc mừng <@${winner.user_id}> đã may mắn trúng giải **${giveaway.prize}**!`);
  }

  return true;
}

/**
 * Cancel and remove giveaways that were created automatically by the bot.
 * Manually-created giveaways use a human host ID and are left untouched.
 */
export async function cancelBotHostedGiveaways(client) {
  const botId = String(client.user?.id || '').trim();
  if (!botId) return { cancelled: 0, deleted: 0 };

  const active = db.prepare(`
    SELECT message_id, channel_id
    FROM giveaways
    WHERE status = 'ACTIVE' AND host_id = ?
  `).all(botId);

  let cancelled = 0;
  let deleted = 0;
  for (const giveaway of active) {
    if (!transitionGiveawayStatus(giveaway.message_id, 'ACTIVE', 'CANCELLED')) continue;
    cancelled += 1;

    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
    const message = channel
      ? await channel.messages.fetch(giveaway.message_id).catch(() => null)
      : null;
    if (message && await message.delete().then(() => true).catch(() => false)) deleted += 1;
  }

  if (cancelled > 0) {
    console.log(`[GIVEAWAY] Cancelled ${cancelled} bot-hosted giveaway(s); deleted ${deleted} message(s).`);
  }
  return { cancelled, deleted };
}

/**
 * Check & end expired giveaways
 */
export async function checkExpiredGiveaways(client) {
  const now = new Date().toISOString();
  const expired = db.prepare(`SELECT message_id FROM giveaways WHERE status = 'ACTIVE' AND end_time <= ?`).all(now);

  for (const row of expired) {
    try {
      await endGiveaway(client, row.message_id);
    } catch (e) {
      console.error('[GIVEAWAY] Error ending expired giveaway:', e);
    }
  }
}

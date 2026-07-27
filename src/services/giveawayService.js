import { 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ContainerBuilder, 
  TextDisplayBuilder, 
  MessageFlags 
} from 'discord.js';
import { db } from '../database/db.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getWalletBalance, addWalletBalance } from './walletService.js'; // To be used for Wallet rewards

/**
 * Tạo một Giveaway mới
 */
export async function createGiveaway(client, channel, hostUser, prize, winnersCount, durationMs) {
  const endTime = new Date(Date.now() + durationMs);
  const endTimeUnix = Math.floor(endTime.getTime() / 1000);
  const E = createEmojiResolver(channel.guildId);

  const container = new ContainerBuilder().setAccentColor(0xFF0055); // Red/Pink accent
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `### ${E('icon_sparkle') || '✨'} GIVEAWAY TRÚNG THƯỞNG ${E('icon_gift') || '🎁'}\n` +
      `**Phần thưởng:** **${prize}**\n` +
      `**Số lượng giải:** ${winnersCount}\n` +
      `**Kết thúc lúc:** <t:${endTimeUnix}:R> (<t:${endTimeUnix}:f>)\n` +
      `**Người tổ chức:** <@${hostUser.id}>\n\n` +
      `> Hãy ấn nút **"🎉 Tham Gia"** bên dưới để thử vận may của bạn nhé!`
    )
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('giveaway:join')
      .setLabel('Tham Gia Ngay')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Success)
  );

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

  if (!giveaway) {
    return interaction.reply({ content: 'Giveaway này không tồn tại trong hệ thống.', ephemeral: true });
  }

  if (giveaway.status !== 'ACTIVE') {
    return interaction.reply({ content: 'Giveaway này đã kết thúc!', ephemeral: true });
  }

  try {
    db.prepare('INSERT INTO giveaway_entries (message_id, user_id) VALUES (?, ?)').run(messageId, userId);
    
    // Đếm số người tham gia
    const count = db.prepare('SELECT COUNT(*) as c FROM giveaway_entries WHERE message_id = ?').get(messageId).c;
    
    return interaction.reply({ 
      content: `🎉 Bạn đã tham gia thành công! Hiện tại đang có **${count} người** cùng tranh giải. Chúc bạn may mắn!`, 
      ephemeral: true 
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.message.includes('UNIQUE constraint failed')) {
      // Bỏ tham gia
      db.prepare('DELETE FROM giveaway_entries WHERE message_id = ? AND user_id = ?').run(messageId, userId);
      return interaction.reply({ content: 'Bạn đã HỦY tham gia giveaway này.', ephemeral: true });
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

  // Mark as ended
  db.prepare('UPDATE giveaways SET status = ? WHERE message_id = ?').run('ENDED', messageId);

  const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
  if (!channel) return null;

  const message = await channel.messages.fetch(messageId).catch(() => null);
  
  const entries = db.prepare('SELECT user_id FROM giveaway_entries WHERE message_id = ?').all(messageId);
  const E = createEmojiResolver(giveaway.guild_id);

  let winnersText = '';
  let winnersList = [];

  if (entries.length === 0) {
    winnersText = 'Không có ai tham gia hợp lệ 😢';
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
      `### ${E('icon_star') || '🎊'} GIVEAWAY ĐÃ KẾT THÚC ${E('icon_gift') || '🎁'}\n` +
      `**Phần thưởng:** **${giveaway.prize}**\n` +
      `**Kết thúc lúc:** <t:${endTimeUnix}:f>\n` +
      `**Người tổ chức:** <@${giveaway.host_id}>\n\n` +
      `🏆 **NGƯỜI TRÚNG GIẢI:** ${winnersText}`
    )
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('giveaway:ended')
      .setLabel(`Đã Kết Thúc (${entries.length} người tham gia)`)
      .setEmoji('⛔')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true)
  );

  if (message) {
    await message.edit({
      components: [container, row],
      flags: MessageFlags.IsComponentsV2
    }).catch(console.error);
  }

  if (winnersList.length > 0) {
    // Ping them
    await channel.send({
      content: `🎉 Chúc mừng ${winnersText} đã trúng giải **${giveaway.prize}**! Hãy liên hệ người tổ chức (<@${giveaway.host_id}>) hoặc mở Ticket để nhận thưởng!`
    }).catch(console.error);
  } else {
    await channel.send({
      content: `😭 Không có ai trúng giải **${giveaway.prize}** do không có người tham gia.`
    }).catch(console.error);
  }

  return winnersList;
}

/**
 * Reroll (Bốc thăm lại)
 */
export async function rerollGiveaway(client, messageId) {
  const giveaway = db.prepare('SELECT * FROM giveaways WHERE message_id = ? AND status = ?').get(messageId, 'ENDED');
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
    await channel.send(`🎉 BỐC THĂM LẠI: Chúc mừng <@${winner.user_id}> đã may mắn trúng giải **${giveaway.prize}**!`);
  }

  return true;
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

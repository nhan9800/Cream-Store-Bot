import { ChannelType } from 'discord.js';
import { db } from '../database/db.js';
import { buildDiscountBoardComponents } from './cardSwapService.js';
import { STORE_SERVICE_FORUM } from '../config/storeServiceForum202611.js';

export async function autoSetupDiscountBoard(client) {
  try {
    const guilds = client.guilds.cache;
    if (guilds.size === 0) return;
    
    // We run it for the first available guild
    const guild = guilds.first();
    const guildId = guild.id;
    if (guildId === STORE_SERVICE_FORUM.guildId) {
      const channel = await guild.channels.fetch(STORE_SERVICE_FORUM.posts.cards);
      const messageId = STORE_SERVICE_FORUM.messageTargets['1530830079788060763'];
      const message = await channel.messages.fetch(messageId);
      if (message.author.id !== client.user.id) throw new Error('DISCOUNT_FORUM_MESSAGE_NOT_OWNED');
      db.prepare('UPDATE guild_settings SET discount_board_channel_id = ?, discount_board_message_id = ? WHERE guild_id = ?')
        .run(channel.id, message.id, guildId);
      return;
    }
    
    // Check if it's already set up
    const row = db.prepare('SELECT discount_board_channel_id, discount_board_message_id FROM guild_settings WHERE guild_id = ?').get(guildId);
    
    if (row && row.discount_board_channel_id && row.discount_board_message_id) {
      // Already set up
      return;
    }
    
    console.log('[AUTO-SETUP] Bắt đầu tự tạo kênh bảng chiết khấu...');
    
    // Find or create channel
    let channel = guild.channels.cache.find(c => c.name.includes('bang-chiet-khau'));
    if (!channel) {
      channel = await guild.channels.create({
        name: '💸・bang-chiet-khau',
        type: ChannelType.GuildText
      });
      console.log('[AUTO-SETUP] Đã tạo kênh mới:', channel.name);
    }
    
    const payload = await buildDiscountBoardComponents(guildId);
    const msg = await channel.send(payload);
    
    db.prepare(`
      UPDATE guild_settings
      SET discount_board_channel_id = ?, discount_board_message_id = ?
      WHERE guild_id = ?
    `).run(channel.id, msg.id, guildId);
    
    console.log('[AUTO-SETUP] Khởi tạo Bảng Chiết Khấu tự động thành công tại kênh:', channel.name);
  } catch (error) {
    console.error('[AUTO-SETUP] Lỗi khi tạo bảng chiết khấu tự động:', error);
  }
}

import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { db } from '../database/db.js';
import { buildDiscountBoardComponents } from '../services/cardSwapService.js';

export const data = new SlashCommandBuilder()
  .setName('setup-discount-board')
  .setDescription('Cài đặt bảng chiết khấu đổi thẻ tự động cập nhật')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption(opt =>
    opt.setName('kenh')
      .setDescription('Kênh hiển thị bảng (mặc định kênh hiện tại)')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false)
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const targetChannel = interaction.options.getChannel('kenh') || interaction.channel;
  
  try {
    const payload = await buildDiscountBoardComponents(interaction.guildId);
    
    // Gửi tin nhắn vào kênh đích
    const msg = await targetChannel.send(payload);
    
    // Lưu vào database
    db.prepare(`
      UPDATE guild_settings
      SET discount_board_channel_id = ?, discount_board_message_id = ?
      WHERE guild_id = ?
    `).run(targetChannel.id, msg.id, interaction.guildId);

    await interaction.editReply(`✅ Đã thiết lập bảng chiết khấu tự động tại <#${targetChannel.id}>. Bảng sẽ tự động cập nhật mỗi giờ.`);
  } catch (error) {
    console.error('Lỗi setup-discount-board:', error);
    await interaction.editReply(`❌ Có lỗi xảy ra: ${error.message}`);
  }
}

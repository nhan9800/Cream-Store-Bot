import { createEmojiResolver } from '../utils/emojiHelper.js';
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { db } from '../database/db.js';

export const data = new SlashCommandBuilder()
  .setName('setadmin')
  .setDescription('Cấp quyền Admin/Staff cho một người dùng trên Website')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName('email')
      .setDescription('Email của người dùng trên website (hoặc email Discord)')
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('role')
      .setDescription('Quyền muốn cấp (admin hoặc staff)')
      .setRequired(true)
      .addChoices(
        { name: 'Admin (Toàn quyền)', value: 'admin' },
        { name: 'Staff (Nhân viên)', value: 'staff' },
        { name: 'Member (Hủy quyền)', value: 'member' }
      )
  );

import { hasConfiguredOwnerRole, isBotDeveloper } from '../utils/permissions.js';

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  try {
    const isGuildOwner = interaction.guild?.ownerId === interaction.user.id;
    const hasOwnerRole = hasConfiguredOwnerRole(interaction.member);
    if (!isBotDeveloper(interaction.user.id) && !isGuildOwner && !hasOwnerRole) {
      return interaction.reply({ content: '❌ Lệnh này chỉ dành cho chủ server, role Owner hoặc Bot Developer.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const email = interaction.options.getString('email').toLowerCase();
    const role = interaction.options.getString('role');

    // Kiểm tra xem user có tồn tại không
    const user = db.prepare('SELECT * FROM web_users WHERE email = ?').get(email);
    
    if (!user) {
      const embed = new EmbedBuilder()
        .setColor('#ef4444')
        .setTitle(`${E('status_cross')} Lỗi: Không tìm thấy người dùng`)
        .setDescription(`Không có tài khoản website nào đăng ký với email: **${email}**\nVui lòng bảo người đó đăng nhập website ít nhất 1 lần để tạo tài khoản.`);
      return interaction.editReply({ embeds: [embed] });
    }

    // Cập nhật role
    db.prepare('UPDATE web_users SET role = ? WHERE id = ?').run(role, user.id);

    const embed = new EmbedBuilder()
      .setColor('#22c55e')
      .setTitle(`${E('status_check')} Cập nhật quyền thành công`)
      .setDescription(`Tài khoản **${email}** đã được cập nhật thành **${role.toUpperCase()}**.\nNgười dùng có thể tải lại trang web để nhận quyền.`);
      
    return interaction.editReply({ embeds: [embed] });

  } catch (error) {
    console.error('[SETADMIN] Lỗi:', error);
    return interaction.editReply({ content: 'Đã xảy ra lỗi khi cấp quyền.' });
  }
}

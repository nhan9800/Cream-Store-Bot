import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { buildCardPanelPayload } from '../services/cardPanelService.js';

export const data = new SlashCommandBuilder()
  .setName('setup-card-panel')
  .setDescription('Tạo bảng Đổi Thẻ Cào & Mua Thẻ Cào')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  await interaction.channel.send(buildCardPanelPayload(interaction.guild.id, { accentColor: 0x3498DB }));
  await interaction.reply({ content: 'Đã tạo bảng dịch vụ thẻ cào thành công.', ephemeral: true });
}

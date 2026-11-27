import { SlashCommandBuilder } from 'discord.js';
import { db } from '../database/db.js';
import { requireRefundOwner, GeminiRefundError } from '../services/geminiRefundService.js';
import { buildRefundOffer } from '../services/refundPresentation.js';

export const data = new SlashCommandBuilder().setName('hoan-tien')
  .setDescription('Xem bảng tính và gửi tài khoản nhận hoàn tiền riêng tư.')
  .addStringOption(o => o.setName('ma_don').setDescription('Mã đơn được shop mở hồ sơ hoàn tiền').setRequired(true));
export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  try {
    const row = requireRefundOwner(db, interaction.options.getString('ma_don', true).trim().toUpperCase(), interaction.user.id);
    if (row.guild_id !== interaction.guildId) throw new GeminiRefundError('Không tìm thấy hồ sơ trong shop này.');
    await interaction.editReply(buildRefundOffer(row));
  } catch (error) {
    if (!(error instanceof GeminiRefundError)) throw error;
    await interaction.editReply(error.message);
  }
}

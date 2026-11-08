import { createEmojiResolver } from '../utils/emojiHelper.js';
import { buildLegacyFeatureCard } from '../utils/featureCard.js';
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getRevenueStatsRaw } from '../services/v11DbHelpers.js';

export const data = new SlashCommandBuilder()
  .setName('thongke')
  .setDescription('Báo cáo thống kê tổng quan doanh thu và đơn hàng.')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o
      .setName('thoi_gian')
      .setDescription('Chọn mốc thời gian muốn xem báo cáo')
      .setRequired(true)
      .addChoices(
        { name: 'Hôm nay', value: 'today' },
        { name: '7 Ngày qua', value: 'week' },
        { name: 'Tháng này', value: 'month' },
        { name: 'Toàn bộ thời gian', value: 'all' }
      )
  );

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  await interaction.deferReply({ ephemeral: false });

  try {
    const timeRange = interaction.options.getString('thoi_gian', true);
    
    let startDateIso = null;
    let endDateIso = null;
    const now = new Date();
    
    if (timeRange === 'today') {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      startDateIso = today.toISOString();
      endDateIso = now.toISOString();
    } else if (timeRange === 'week') {
      const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      startDateIso = lastWeek.toISOString();
      endDateIso = now.toISOString();
    } else if (timeRange === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      startDateIso = firstDay.toISOString();
      endDateIso = now.toISOString();
    }

    const stats = getRevenueStatsRaw(startDateIso, endDateIso);

    const embed = new EmbedBuilder()
      .setTitle(`${E('icon_chart')} Báo Cáo Doanh Thu & Đơn Hàng`)
      .setColor(0x00ff00)
      .setTimestamp();

    if (timeRange === 'today') embed.setDescription('Số liệu thống kê trong **Hôm Nay**.');
    if (timeRange === 'week') embed.setDescription('Số liệu thống kê trong **7 Ngày Qua**.');
    if (timeRange === 'month') embed.setDescription('Số liệu thống kê trong **Tháng Này**.');
    if (timeRange === 'all') embed.setDescription('Số liệu thống kê **Toàn Bộ Thời Gian**.');

    const formatter = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });

    embed.addFields(
      { name: `${E('payment_money')} Tổng Doanh Thu`, value: `**${formatter.format(stats.total_revenue || 0)}**`, inline: false },
      { name: `${E('order_product')} Tổng Đơn Hàng`, value: `${stats.total_orders || 0} đơn`, inline: true },
      { name: `${E('status_check')} Đã Hoàn Thành`, value: `${stats.completed_orders || 0} đơn`, inline: true },
      { name: `${E('order_pending')} Chưa Thanh Toán`, value: `${stats.unpaid_orders || 0} đơn`, inline: true }
    );

    await interaction.editReply(buildLegacyFeatureCard({ embeds: [embed] }));
  } catch (error) {
    console.error('[THONGKE] Error:', error);
    await interaction.editReply(`${E('status_cross')} Đã xảy ra lỗi khi tính toán thống kê.`);
  }
}

import { createEmojiResolver } from '../utils/emojiHelper.js';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getDashboardData } from '../services/dashboardService.js';
import { buildDashboardV2 } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('dashboard')
  .setDescription('Xem dashboard thống kê nhanh của Cenar Store.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  const data = getDashboardData(interaction.guildId);
  await interaction.reply({ ...buildDashboardV2(data.summary, data.topProducts, data.recentLogs, interaction.guildId), ephemeral: true });
}

import { createEmojiResolver } from '../utils/emojiHelper.js';
import { buildLegacyFeatureCard } from '../utils/featureCard.js';
import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getStaffKpis } from '../services/orderService.js';
import { config } from '../config.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { assertStaffCapability } from '../utils/permissions.js';

export const data = new SlashCommandBuilder().setName('kpi').setDescription('Xem KPI staff: claim, hoàn thành, giao hàng, thời gian xử lý trung bình.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!assertStaffCapability(member, guildConfig, 'MANAGE')) { await interaction.reply({ content: `${E('status_warn')} Chỉ manager mới được dùng lệnh này.`, ephemeral: true }); return; }
  const rows = getStaffKpis(interaction.guildId, 10);
  const embed = new EmbedBuilder().setColor(config.accentColorInfo).setTitle(`${E('icon_chart')} KPI staff`).setDescription(rows.length ? rows.map((row, i) => `${i + 1}. <@${row.actor_id}> • hoàn thành: **${row.completed_orders ?? 0}** • giao: **${row.deliveries ?? 0}** • claim: **${row.claims ?? 0}** • TB xử lý: **${Math.round((row.avg_completion_seconds ?? 0) / 60)} phút**`).join('\n') : 'Chưa có dữ liệu KPI.').setTimestamp();
  await interaction.reply(buildLegacyFeatureCard({ embeds: [embed], ephemeral: true }));
}

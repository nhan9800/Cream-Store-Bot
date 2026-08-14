import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { config } from '../config.js';
import { buildInviteCheckPayload, getInviteCampaignStats } from '../services/inviteCampaignService.js';

export const data = new SlashCommandBuilder()
  .setName('invcheck')
  .setDescription('Kiểm tra tiến độ event mời 5 bạn nhận Decor Discord 66K');

export async function executeInviteCheck(interaction) {
  if (!interaction.inGuild() || String(interaction.guildId) !== String(config.storeOneGuildId)) {
    await interaction.reply({
      content: 'Event mời bạn nhận Decor hiện chỉ áp dụng tại Cenar Store 1.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  try {
    const stats = getInviteCampaignStats(interaction.guildId, interaction.user.id);
    const payload = buildInviteCheckPayload(stats, {
      userId: interaction.user.id,
      username: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
    });
    await interaction.reply({
      ...payload,
      flags: Number(payload.flags || 0) | MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error('[INVCHECK] Error:', error);
    await interaction.reply({
      content: 'Không thể tải tiến độ event lúc này. Vui lòng thử lại sau.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => null);
  }
}

export const execute = executeInviteCheck;

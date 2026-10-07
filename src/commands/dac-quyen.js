import { SlashCommandBuilder } from 'discord.js';
import { buildMembershipBenefitsPayload } from '../services/membershipPresentationService.js';
export const data = new SlashCommandBuilder().setName('dac-quyen').setDescription('Xem hạng thành viên và đặc quyền Cenar Circle');
export async function execute(interaction) {
  await interaction.deferReply();
  await interaction.editReply(buildMembershipBenefitsPayload(interaction.client,interaction.guildId));
}

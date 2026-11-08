import { createEmojiResolver } from '../utils/emojiHelper.js';
import { SlashCommandBuilder } from 'discord.js';
import { buildAutomationGuideV2 } from '../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('cochebot')
  .setDescription('Giải thích cơ chế bot mua hàng tự động của Cenar Store.')
  .setDMPermission(false);

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  await interaction.reply({
    ...buildAutomationGuideV2(interaction.guildId),
    ephemeral: true,
  });
}

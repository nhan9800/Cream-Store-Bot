import { SlashCommandBuilder } from 'discord.js';
import {
  buildMusicPanelPayload,
  playYoutube,
  registerMusicPanelMessage,
} from '../services/musicPlayerService.js';

export const data = new SlashCommandBuilder()
  .setName('music')
  .setDescription('Mở Cenar Music hoặc phát một link YouTube')
  .addStringOption((option) => option
    .setName('link')
    .setDescription('Link video hoặc playlist YouTube')
    .setRequired(false)
    .setMaxLength(500));

export async function execute(interaction) {
  const link = interaction.options.getString('link');
  await interaction.deferReply();
  try {
    if (link) {
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) throw new Error('Bạn cần vào một phòng thoại trước khi phát nhạc.');
      await playYoutube({
        guild: interaction.guild,
        voiceChannel,
        url: link,
        requestedBy: interaction.user,
        textChannelId: interaction.channelId,
      });
    }
    await interaction.editReply(buildMusicPanelPayload(interaction.guildId));
    const message = await interaction.fetchReply();
    await registerMusicPanelMessage(interaction.guildId, message);
  } catch (error) {
    await interaction.editReply(`Không thể mở Cenar Music: ${error.message}`);
  }
}

import { SlashCommandBuilder } from 'discord.js';
import {
  buildMusicPanelPayload,
  buildMusicAddedMessage,
  playYoutube,
  registerMusicPanelMessage,
} from '../services/musicPlayerService.js';

export const data = new SlashCommandBuilder()
  .setName('music')
  .setDescription('Mở Cenar Music, phát video hoặc thêm playlist YouTube vào hàng đợi')
  .addStringOption((option) => option
    .setName('link')
    .setDescription('Link video hoặc playlist YouTube')
    .setRequired(false)
    .setMaxLength(500));

export async function execute(interaction) {
  const link = interaction.options.getString('link');
  await interaction.deferReply();
  try {
    let added = null;
    if (link) {
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) throw new Error('Bạn cần vào một phòng thoại trước khi phát nhạc.');
      added = await playYoutube({
        guild: interaction.guild,
        voiceChannel,
        url: link,
        requestedBy: interaction.user,
        textChannelId: interaction.channelId,
      });
    }
    await interaction.editReply(buildMusicPanelPayload(interaction.guildId, {
      notice: added ? buildMusicAddedMessage(added) : null,
    }));
    const message = await interaction.fetchReply();
    await registerMusicPanelMessage(interaction.guildId, message);
  } catch (error) {
    await interaction.editReply(`Không thể mở Cenar Music: ${error.message}`);
  }
}

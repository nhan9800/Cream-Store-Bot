import { SlashCommandBuilder } from 'discord.js';
import {
  buildMusicPanelPayload,
  buildMusicAddedMessage,
  playMusicAttachment,
  playYoutube,
  registerMusicPanelMessage,
} from '../services/musicPlayerService.js';

export const data = new SlashCommandBuilder()
  .setName('music')
  .setDescription('Mở Cenar Music, phát YouTube hoặc tệp âm thanh MP3/OGG')
  .addStringOption((option) => option
    .setName('link')
    .setDescription('Link video, playlist hoặc Mix/Radio YouTube')
    .setRequired(false)
    .setMaxLength(500))
  .addAttachmentOption((option) => option
    .setName('file')
    .setDescription('Tệp âm thanh MP3 hoặc OGG, tối đa 8 MiB')
    .setRequired(false));

export async function execute(interaction) {
  const link = interaction.options.getString('link');
  const attachment = interaction.options.getAttachment('file');
  await interaction.deferReply();
  try {
    if (link && attachment) throw new Error('Chỉ chọn một nguồn phát: link YouTube hoặc tệp MP3/OGG.');
    let added = null;
    if (link || attachment) {
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) throw new Error('Bạn cần vào một phòng thoại trước khi phát nhạc.');
      const request = {
        guild: interaction.guild,
        voiceChannel,
        requestedBy: interaction.user,
        textChannelId: interaction.channelId,
      };
      added = attachment
        ? await playMusicAttachment({ ...request, attachment })
        : await playYoutube({ ...request, url: link });
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

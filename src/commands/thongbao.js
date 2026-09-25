import { createEmojiResolver } from '../utils/emojiHelper.js';
import {
  clearAnnouncementDraftImage,
  setAnnouncementDraftImage,
} from '../services/announcementService.js';
import {
  ActionRowBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('thongbao')
  .setDescription('Gửi thông báo và tag các role tùy chọn.')
  .addAttachmentOption((option) => option
    .setName('anh')
    .setDescription('Ảnh đính kèm thông báo (PNG, JPG, WEBP hoặc GIF).')
    .setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  const image = interaction.options.getAttachment('anh');

  try {
    if (image) setAnnouncementDraftImage(interaction, image);
    else clearAnnouncementDraftImage(interaction);
  } catch (error) {
    await interaction.reply({
      content: `${E('status_cross')} ${error.message}`,
      ephemeral: true,
    });
    return;
  }

  // Show a Modal to get the announcement content
  const modal = new ModalBuilder()
    .setCustomId('announcement:modal')
    .setTitle('Nội dung thông báo');

  const contentInput = new TextInputBuilder()
    .setCustomId('announcement_content')
    .setLabel('Nội dung bạn muốn thông báo')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setPlaceholder('Nhập nội dung vào đây. Hỗ trợ nhiều dòng...')
    .setMaxLength(3000);

  modal.addComponents(new ActionRowBuilder().addComponents(contentInput));

  await interaction.showModal(modal);
}

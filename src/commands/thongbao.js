import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { buildAnnouncementModal, createAnnouncementDraft } from '../services/announcementDraftService.js';

export const data = new SlashCommandBuilder()
  .setName('thongbao')
  .setDescription('Gửi thông báo và tag các role tùy chọn.')
  .addAttachmentOption(option => option.setName('anh')
    .setDescription('Ảnh đính kèm thông báo (PNG, JPG, WEBP hoặc GIF).').setRequired(false))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

export async function execute(interaction) {
  let draft;
  try { draft = createAnnouncementDraft(interaction, interaction.options.getAttachment('anh')); }
  catch (error) {
    await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  await interaction.showModal(buildAnnouncementModal(draft));
}

import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { buildVerificationPanelV2 } from '../services/verificationPanelService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';

export const data = new SlashCommandBuilder()
  .setName('setup-verify')
  .setDescription('Gửi hoặc cập nhật panel xác minh và recovery backup')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((option) => option
    .setName('kenh')
    .setDescription('Kênh xác minh; để trống để bot tự tìm')
    .addChannelTypes(ChannelType.GuildText)
    .setRequired(false));

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const E = createEmojiResolver(interaction.guildId);

  let verifyChannel = interaction.options.getChannel('kenh');
  if (!verifyChannel) {
    verifyChannel = interaction.guild.channels.cache.find((channel) => (
      channel.type === ChannelType.GuildText
      && (channel.name.includes('xac-minh') || channel.name.includes('xác-minh'))
    ));
  }

  if (!verifyChannel) {
    await interaction.editReply({
      content: `${E('status_cross')} Không tìm thấy kênh xác minh. Hãy dùng tùy chọn \`kenh\` để chỉ rõ.`,
    });
    return;
  }

  try {
    const messages = await verifyChannel.messages.fetch({ limit: 50 });
    const oldPanels = messages.filter((message) => (
      message.author.id === interaction.client.user.id
      && message.components?.length > 0
      && message.components.some((component) => JSON.stringify(component.toJSON()).includes('oauth:verify:button'))
    ));
    for (const message of oldPanels.values()) {
      await message.delete().catch(() => null);
    }

    await verifyChannel.send(buildVerificationPanelV2(interaction.guildId));
    await interaction.editReply({
      content: `${E('status_check')} Đã cập nhật panel xác minh và recovery backup tại ${verifyChannel}.`,
    });
  } catch (error) {
    console.error('[SETUP-VERIFY] Không thể cập nhật panel:', error);
    await interaction.editReply({
      content: `${E('status_cross')} Không thể cập nhật panel: ${error.message}`,
    });
  }
}

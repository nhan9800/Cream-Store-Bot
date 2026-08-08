import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ContainerBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { upsertPartnerSettings } from '../services/partnerService.js';

export const data = new SlashCommandBuilder()
  .setName('setup-partner')
  .setDescription('[Admin] Cấu hình hệ thống đối tác liên kết server.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption(o => o.setName('kenh_dang_tuyen').setDescription('Kênh hiển thị panel tuyển đối tác').addChannelTypes(ChannelType.GuildText).setRequired(false))
  .addChannelOption(o => o.setName('kenh_duyet').setDescription('Kênh staff nhận đơn duyệt đối tác').addChannelTypes(ChannelType.GuildText).setRequired(false))
  .addChannelOption(o => o.setName('kenh_danh_sach').setDescription('Kênh hiển thị danh sách đối tác liên kết').addChannelTypes(ChannelType.GuildText).setRequired(false))
  .addChannelOption(o => o.setName('kenh_partner').setDescription('Kênh truyền thông riêng của Partner').addChannelTypes(ChannelType.GuildText).setRequired(false))
  .addRoleOption(o => o.setName('role_doi_tac').setDescription('Role cấp cho người đại diện đối tác khi duyệt').setRequired(false));

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  
  const recruitChannel = interaction.options.getChannel('kenh_dang_tuyen');
  const approveChannel = interaction.options.getChannel('kenh_duyet');
  const directoryChannel = interaction.options.getChannel('kenh_danh_sach');
  const partnerChannel = interaction.options.getChannel('kenh_partner');
  const partnerRole = interaction.options.getRole('role_doi_tac');

  const settings = upsertPartnerSettings({
    guild_id: interaction.guildId,
    recruit_channel_id: recruitChannel?.id ?? null,
    approve_channel_id: approveChannel?.id ?? null,
    partner_role_id: partnerRole?.id ?? null,
    directory_channel_id: directoryChannel?.id ?? null,
    partner_channel_id: partnerChannel?.id ?? null,
  });

  const lines = [
    `${E('cenar_verified')} **Đã cập nhật cấu hình Đối tác (Partner):**`,
    settings.recruit_channel_id ? `• Kênh tuyển dụng: <#${settings.recruit_channel_id}>` : '• Kênh tuyển dụng: *Chưa cấu hình*',
    settings.approve_channel_id ? `• Kênh duyệt đơn: <#${settings.approve_channel_id}>` : '• Kênh duyệt đơn: *Chưa cấu hình*',
    settings.directory_channel_id ? `• Kênh danh sách đối tác: <#${settings.directory_channel_id}>` : '• Kênh danh sách đối tác: *Chưa cấu hình*',
    settings.partner_channel_id ? `• Kênh truyền thông Partner: <#${settings.partner_channel_id}>` : '• Kênh truyền thông Partner: *Chưa cấu hình*',
    settings.partner_role_id ? `• Role đối tác: <@&${settings.partner_role_id}>` : '• Role đối tác: *Chưa cấu hình*',
  ];

  const container = new ContainerBuilder().setAccentColor(0x7C5CFC)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

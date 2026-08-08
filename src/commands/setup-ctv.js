import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ContainerBuilder, MessageFlags, TextDisplayBuilder } from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { upsertCtvSettings } from '../services/ctvService.js';

export const data = new SlashCommandBuilder()
  .setName('setup-ctv')
  .setDescription('[Admin] Cấu hình hệ thống Cộng Tác Viên (CTV).')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption(o => o.setName('kenh_tuyen_ctv').setDescription('Kênh hiển thị panel tuyển CTV').addChannelTypes(ChannelType.GuildText).setRequired(false))
  .addChannelOption(o => o.setName('kenh_duyet_ctv').setDescription('Kênh staff nhận đơn duyệt CTV').addChannelTypes(ChannelType.GuildText).setRequired(false))
  .addChannelOption(o => o.setName('kenh_chat_ctv').setDescription('Kênh chat nội bộ CTV').addChannelTypes(ChannelType.GuildText).setRequired(false))
  .addChannelOption(o => o.setName('kenh_log_ctv').setDescription('Kênh log mua hàng CTV').addChannelTypes(ChannelType.GuildText).setRequired(false))
  .addChannelOption(o => o.setName('kenh_gia_ctv').setDescription('Kênh bảng giá CTV').addChannelTypes(ChannelType.GuildText).setRequired(false))
  .addRoleOption(o => o.setName('role_ctv').setDescription('Role cấp cho Cộng Tác Viên khi duyệt').setRequired(false));

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  
  const recruitChannel = interaction.options.getChannel('kenh_tuyen_ctv');
  const approveChannel = interaction.options.getChannel('kenh_duyet_ctv');
  const chatChannel = interaction.options.getChannel('kenh_chat_ctv');
  const orderLogChannel = interaction.options.getChannel('kenh_log_ctv');
  const priceChannel = interaction.options.getChannel('kenh_gia_ctv');
  const ctvRole = interaction.options.getRole('role_ctv');

  const settings = upsertCtvSettings({
    guild_id: interaction.guildId,
    recruit_channel_id: recruitChannel?.id ?? null,
    approve_channel_id: approveChannel?.id ?? null,
    ctv_role_id: ctvRole?.id ?? null,
    chat_channel_id: chatChannel?.id ?? null,
    order_log_channel_id: orderLogChannel?.id ?? null,
    price_channel_id: priceChannel?.id ?? null,
  });

  const lines = [
    `${E('cenar_verified')} **Đã cập nhật cấu hình Cộng Tác Viên (CTV):**`,
    settings.recruit_channel_id ? `• Kênh tuyển dụng: <#${settings.recruit_channel_id}>` : '• Kênh tuyển dụng: *Chưa cấu hình*',
    settings.approve_channel_id ? `• Kênh duyệt đơn: <#${settings.approve_channel_id}>` : '• Kênh duyệt đơn: *Chưa cấu hình*',
    settings.ctv_role_id ? `• Role CTV: <@&${settings.ctv_role_id}>` : '• Role CTV: *Chưa cấu hình*',
    settings.chat_channel_id ? `• Kênh chat CTV: <#${settings.chat_channel_id}>` : '• Kênh chat CTV: *Chưa cấu hình*',
    settings.order_log_channel_id ? `• Log mua hàng CTV: <#${settings.order_log_channel_id}>` : '• Log mua hàng CTV: *Chưa cấu hình*',
    settings.price_channel_id ? `• Bảng giá CTV: <#${settings.price_channel_id}>` : '• Bảng giá CTV: *Chưa cấu hình*',
  ];

  const container = new ContainerBuilder().setAccentColor(0xF59E72)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

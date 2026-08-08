import { ContainerBuilder, MessageFlags, SlashCommandBuilder, PermissionFlagsBits, TextDisplayBuilder } from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { setCustomerCtvStatus, isCustomerCtv } from '../services/ctvService.js';

export const data = new SlashCommandBuilder()
  .setName('ctv-manage')
  .setDescription('[Admin] Thêm hoặc xóa trạng thái Cộng Tác Viên (CTV) của khách hàng.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addUserOption(o => o.setName('user').setDescription('Khách hàng cần quản lý').setRequired(true))
  .addStringOption(o => 
    o.setName('action')
     .setDescription('Hành động')
     .setRequired(true)
     .addChoices(
       { name: 'Cấp quyền CTV (Grant)', value: 'grant' },
       { name: 'Gỡ quyền CTV (Revoke)', value: 'revoke' }
     )
  );

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const targetUser = interaction.options.getUser('user');
  const action = interaction.options.getString('action');

  const isGrant = action === 'grant';
  
  // Update status in DB
  setCustomerCtvStatus(interaction.guildId, targetUser.id, isGrant);

  // Attempt to assign role if configured
  const { getCtvSettings } = await import('../services/ctvService.js');
  const settings = getCtvSettings(interaction.guildId);
  let roleStatusText = '';

  if (settings.ctv_role_id) {
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (member) {
      if (isGrant) {
        await member.roles.add(settings.ctv_role_id)
          .then(() => { roleStatusText = ` và cấp role <@&${settings.ctv_role_id}>`; })
          .catch(e => { roleStatusText = ` (Lỗi cấp role: ${e.message})`; });
      } else {
        await member.roles.remove(settings.ctv_role_id)
          .then(() => { roleStatusText = ` và thu hồi role <@&${settings.ctv_role_id}>`; })
          .catch(e => { roleStatusText = ` (Lỗi thu hồi role: ${e.message})`; });
      }
    }
  }

  const container = new ContainerBuilder().setAccentColor(isGrant ? 0x57F287 : 0xED4245)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `## ${isGrant ? E('cenar_verified') : E('status_cross')} ${isGrant ? 'Đã cấp quyền CTV' : 'Đã thu hồi quyền CTV'}`,
      `${E('cenar_ctv')} Khách hàng: <@${targetUser.id}>${roleStatusText}.`,
    ].join('\n')));
  await interaction.reply({
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

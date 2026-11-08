import { createEmojiResolver } from '../utils/emojiHelper.js';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { buildBlacklistV2 } from '../utils/embeds.js';
import { clearWarnings, getCustomerFlag, setBlacklistStatus, warnCustomer } from '../services/blacklistService.js';
import { applyCustomerRoles } from '../services/roleService.js';
import { emitStaffLog } from '../services/staffLogService.js';
import { getGuildConfig } from '../services/guildConfigService.js';
import { assertStaffCapability } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('blacklist')
  .setDescription('Cảnh báo hoặc blacklist khách hàng.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) => sub.setName('xem').setDescription('Xem hồ sơ cảnh báo của khách').addUserOption((opt) => opt.setName('khach').setDescription('Khách hàng').setRequired(true)))
  .addSubcommand((sub) => sub.setName('canhbao').setDescription('Tăng 1 cảnh báo cho khách').addUserOption((opt) => opt.setName('khach').setDescription('Khách hàng').setRequired(true)).addStringOption((opt) => opt.setName('ly_do').setDescription('Lý do cảnh báo').setRequired(false)))
  .addSubcommand((sub) => sub.setName('them').setDescription('Thêm khách vào blacklist').addUserOption((opt) => opt.setName('khach').setDescription('Khách hàng').setRequired(true)).addStringOption((opt) => opt.setName('ly_do').setDescription('Lý do blacklist').setRequired(true)))
  .addSubcommand((sub) => sub.setName('go').setDescription('Gỡ blacklist').addUserOption((opt) => opt.setName('khach').setDescription('Khách hàng').setRequired(true)))
  .addSubcommand((sub) => sub.setName('xoacanhbao').setDescription('Xóa cảnh báo của khách').addUserOption((opt) => opt.setName('khach').setDescription('Khách hàng').setRequired(true)));

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!assertStaffCapability(member, guildConfig, 'MANAGE')) {
    await interaction.reply({ content: `${E('status_warn')} Chỉ manager mới được dùng lệnh này.`, ephemeral: true });
    return;
  }
  const action = interaction.options.getSubcommand(true);
  const user = interaction.options.getUser('khach', true);
  let flag;
  if (action === 'canhbao') { flag = warnCustomer(interaction.guildId, user.id, interaction.user.id, interaction.options.getString('ly_do')); await emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: user.id, action: 'CUSTOMER_WARN', detail: interaction.options.getString('ly_do') ?? 'Không ghi rõ lý do' }); }
  else if (action === 'them') { flag = setBlacklistStatus(interaction.guildId, user.id, true, interaction.user.id, interaction.options.getString('ly_do', true)); await applyCustomerRoles(interaction.guild, user.id); await emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: user.id, action: 'BLACKLIST_ADD', detail: flag.blacklist_reason }); }
  else if (action === 'go') { flag = setBlacklistStatus(interaction.guildId, user.id, false, interaction.user.id, null); await applyCustomerRoles(interaction.guild, user.id); await emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: user.id, action: 'BLACKLIST_REMOVE', detail: 'Gỡ blacklist' }); }
  else if (action === 'xoacanhbao') { flag = clearWarnings(interaction.guildId, user.id, interaction.user.id); await emitStaffLog(interaction.client, { guildId: interaction.guildId, actorId: interaction.user.id, targetId: user.id, action: 'WARNINGS_CLEAR', detail: 'Xóa cảnh báo' }); }
  else { flag = getCustomerFlag(interaction.guildId, user.id); }
  await interaction.reply({ ...buildBlacklistV2(user, flag, interaction.guildId), ephemeral: true });
}

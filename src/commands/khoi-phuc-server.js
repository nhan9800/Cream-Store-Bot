import {
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { restoreGuildStructure, snapshotGuildForRecovery } from '../services/guildRecoveryService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { hasConfiguredOwnerRole, isBotDeveloper } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('khoi-phuc-server')
  .setDescription('[Owner] Sao lưu hoặc khôi phục cấu trúc server từ recovery snapshot')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) => option
    .setName('hanh_dong')
    .setDescription('Chọn thao tác recovery')
    .setRequired(true)
    .addChoices(
      { name: 'Tạo snapshot ngay', value: 'SNAPSHOT' },
      { name: 'Khôi phục sang server dự phòng', value: 'RESTORE' },
    ))
  .addStringOption((option) => option
    .setName('guild_dich')
    .setDescription('ID server dự phòng; bắt buộc khi khôi phục')
    .setRequired(false))
  .addBooleanOption((option) => option
    .setName('xac_nhan')
    .setDescription('Xác nhận tạo vai trò, kênh, quyền và custom emoji ở server đích')
    .setRequired(false));

function authorized(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
    || hasConfiguredOwnerRole(interaction.member)
    || isBotDeveloper(interaction.user.id);
}

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  if (!authorized(interaction)) {
    return interaction.reply({
      content: `${E('status_cross')} Chỉ Owner hoặc quản trị viên cấp cao được dùng recovery server.`,
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });
  const action = interaction.options.getString('hanh_dong', true);

  if (action === 'SNAPSHOT') {
    const snapshot = await snapshotGuildForRecovery(interaction.guild, { force: true });
    const container = new ContainerBuilder()
      .setAccentColor(0x10B981)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `## ${E('recovery_backup')} RECOVERY SNAPSHOT ĐÃ SẴN SÀNG`,
        `> ${E('icon_group')} **Vai trò:** ${snapshot.roles.length}`,
        `> ${E('icon_folder')} **Kênh & danh mục:** ${snapshot.channels.length}`,
        `> ${E('icon_sparkle')} **Custom emoji:** ${snapshot.emojis.length}`,
        `> ${E('icon_clock')} **Thời điểm:** <t:${Math.floor(new Date(snapshot.capturedAt).getTime() / 1000)}:F>`,
        '',
        `-# ${E('icon_lock')} Snapshot nằm trong SQLite và đi cùng backup cục bộ, Telegram hoặc Google Drive đã cấu hình.`,
      ].join('\n')));
    return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  }

  const targetGuildId = String(interaction.options.getString('guild_dich') || '').trim();
  const confirmed = interaction.options.getBoolean('xac_nhan') === true;
  if (!/^\d{17,20}$/.test(targetGuildId) || !confirmed) {
    return interaction.editReply(`${E('status_warn')} Hãy nhập \`guild_dich\` hợp lệ và đặt \`xac_nhan: True\` để bắt đầu khôi phục.`);
  }
  const targetGuild = await interaction.client.guilds.fetch(targetGuildId).catch(() => null);
  if (!targetGuild) {
    return interaction.editReply(`${E('status_cross')} Bot chưa có mặt trong server dự phòng.`);
  }
  const botPermissions = targetGuild.members.me?.permissions;
  if (
    !botPermissions?.has(PermissionFlagsBits.ManageRoles)
    || !botPermissions?.has(PermissionFlagsBits.ManageChannels)
    || !botPermissions?.has(PermissionFlagsBits.ManageGuildExpressions)
  ) {
    return interaction.editReply(`${E('status_cross')} Bot cần quyền quản lý vai trò, kênh và emoji tại server dự phòng.`);
  }

  const result = await restoreGuildStructure(interaction.guildId, targetGuild);
  const container = new ContainerBuilder()
    .setAccentColor(result.failures.length ? 0xF59E0B : 0x10B981)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `## ${result.failures.length ? E('status_warn') : E('status_check')} KHÔI PHỤC CẤU TRÚC HOÀN TẤT`,
      `> ${E('recovery_restore')} Server đích: **${targetGuild.name}**`,
      `> ${E('icon_clock')} Snapshot: <t:${Math.floor(new Date(result.capturedAt).getTime() / 1000)}:F>`,
      '',
      `${E('icon_group')} **Vai trò:** ${result.created.roles} mới • ${result.reused.roles} có sẵn`,
      `${E('icon_folder')} **Kênh:** ${result.created.channels} mới • ${result.reused.channels} có sẵn`,
      `${E('icon_sparkle')} **Emoji:** ${result.created.emojis} mới • ${result.reused.emojis} có sẵn`,
      `${E('status_cross')} **Lỗi:** ${result.failures.length}`,
      ...(result.failures.length
        ? ['', ...result.failures.slice(0, 6).map((failure) => `> ${failure}`)]
        : []),
      '',
      `-# ${E('status_info')} Chạy /chuyen-server sau bước này để đưa thành viên đã cấp OAuth vào server dự phòng và gán lại vai trò theo tên.`,
    ].join('\n')));
  return interaction.editReply({ components: [container], flags: MessageFlags.IsComponentsV2 });
}

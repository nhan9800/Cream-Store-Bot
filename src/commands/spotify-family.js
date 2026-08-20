import {
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { config, getPublicUrl } from '../config.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { accentFor } from '../utils/uiKit.js';
import {
  getSpotifyFamily,
  getSpotifyFamilyStats,
  listSpotifyFamilies,
  markSpotifyFamilyRenewed,
} from '../services/spotifyFamilyService.js';
import { buildSpotifyFamilyPanel } from '../services/spotifyFamilyReminderService.js';

export const data = new SlashCommandBuilder()
  .setName('spotify-family')
  .setDescription('Quản lý Family Spotify, slot thành viên và lịch gia hạn')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) => subcommand
    .setName('overview')
    .setDescription('Xem tổng quan toàn bộ Spotify Family'))
  .addSubcommand((subcommand) => subcommand
    .setName('view')
    .setDescription('Xem chi tiết một Spotify Family')
    .addIntegerOption((option) => option.setName('id').setDescription('ID Family').setRequired(true).setMinValue(1)))
  .addSubcommand((subcommand) => subcommand
    .setName('renew')
    .setDescription('Xác nhận Family đã được gia hạn thêm 1 tháng')
    .addIntegerOption((option) => option.setName('id').setDescription('ID Family').setRequired(true).setMinValue(1)));

function unix(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? Math.floor(parsed.getTime() / 1000) : null;
}

function overviewPayload(guildId) {
  const E = createEmojiResolver(guildId);
  const families = listSpotifyFamilies({ guildId, includeSecrets: false });
  const stats = getSpotifyFamilyStats(guildId);
  const lines = families.slice(0, 12).map((family) => {
    const due = family.overdueDays > 0
      ? `quá hạn ${family.overdueDays} ngày`
      : `còn ${family.daysRemaining} ngày`;
    return [
      `${E('icon_home')} **#${family.id} · ${family.name}** — ${family.slotsUsed}/${family.totalSlots} slot`,
      `> ${E('icon_calendar')} <t:${unix(family.nextRenewalAt)}:D> · **${due}** · ${Number(family.renewalCost || 0).toLocaleString('vi-VN')}đ`,
    ].join('\n');
  });
  if (families.length > 12) lines.push(`_...và ${families.length - 12} Family khác trên website._`);
  if (!lines.length) lines.push('_Chưa có Spotify Family nào. Hãy tạo Family đầu tiên trên website._');

  const portal = getPublicUrl('/web#spotify-families') || `${String(config.storeWebsiteUrl || 'https://cenarstore.xyz').replace(/\/$/, '')}/web#spotify-families`;
  const container = new ContainerBuilder().setAccentColor(accentFor('success'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('brand_spotify')} SPOTIFY FAMILY CONTROL CENTER`,
    `> ${E('cenar_verified')} Bot và website đang dùng chung một nguồn dữ liệu thời gian thực.`,
    '',
    `### ${E('icon_chart')} TỔNG QUAN`,
    `${E('icon_home')} **Family hoạt động:** ${stats.activeFamilies}`,
    `${E('ticket_user')} **Thành viên:** ${stats.activeMembers}/${stats.totalSlots} slot`,
    `${E('icon_clock')} **Cần xử lý trong 7 ngày:** ${stats.dueIn7Days}`,
    `${E('payment_money')} **Chi phí kỳ tháng:** ${stats.monthlyRenewalCost.toLocaleString('vi-VN')}đ`,
    '',
    `### ${E('icon_history')} DANH SÁCH FAMILY`,
    ...lines,
    '',
    `${E('icon_web')} **Family Center:** ${portal}`,
    `-# Dùng /spotify-family view để xem từng Family · mọi thông tin nhạy cảm chỉ hiển thị riêng cho Admin`,
  ].join('\n').slice(0, 4000)));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const subcommand = interaction.options.getSubcommand();
  try {
    if (subcommand === 'overview') {
      return interaction.editReply(overviewPayload(interaction.guildId));
    }

    const id = interaction.options.getInteger('id', true);
    const existing = getSpotifyFamily(id, { includeSecrets: false });
    if (!existing || ![interaction.guildId, 'WEB'].includes(existing.guildId)) {
      return interaction.editReply('Không tìm thấy Spotify Family với ID này.');
    }

    if (subcommand === 'renew') {
      const renewed = markSpotifyFamilyRenewed(id);
      return interaction.editReply(buildSpotifyFamilyPanel(renewed, { ping: false }));
    }

    return interaction.editReply(buildSpotifyFamilyPanel(existing, { ping: false }));
  } catch (error) {
    console.error('[SPOTIFY-FAMILY-COMMAND]', error);
    return interaction.editReply(`Không thể xử lý Spotify Family: ${error.message}`);
  }
}

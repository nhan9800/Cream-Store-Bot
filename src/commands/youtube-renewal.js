import {
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { accentFor } from '../utils/uiKit.js';
import {
  getYoutubeMembership,
  getYoutubeRenewalHistory,
  getYoutubeRenewalStats,
  listYoutubeMemberships,
  markYoutubeCyclePaid,
} from '../services/youtubeRenewalService.js';
import { buildYoutubeRenewalPanel } from '../services/youtubeRenewalReminderService.js';

export const data = new SlashCommandBuilder()
  .setName('youtube-renewal')
  .setDescription('Quản lý khách YouTube và các kỳ thanh toán nguồn')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((subcommand) => subcommand
    .setName('overview')
    .setDescription('Xem tổng quan toàn bộ hồ sơ gia hạn YouTube'))
  .addSubcommand((subcommand) => subcommand
    .setName('view')
    .setDescription('Xem chi tiết một hồ sơ YouTube')
    .addIntegerOption((option) => option.setName('id').setDescription('ID hồ sơ').setRequired(true).setMinValue(1)))
  .addSubcommand((subcommand) => subcommand
    .setName('paid')
    .setDescription('Xác nhận đã thanh toán thêm một kỳ cho nguồn')
    .addIntegerOption((option) => option.setName('id').setDescription('ID hồ sơ').setRequired(true).setMinValue(1))
    .addIntegerOption((option) => option.setName('so_tien').setDescription('Số tiền thực tế đã thanh toán').setMinValue(0))
    .addStringOption((option) => option.setName('ma_giao_dich').setDescription('Mã/nội dung giao dịch').setMaxLength(180))
    .addStringOption((option) => option.setName('family').setDescription('Tên hoặc mã Family sau khi nguồn xử lý').setMaxLength(160)))
  .addSubcommand((subcommand) => subcommand
    .setName('history')
    .setDescription('Xem lịch sử thanh toán nguồn của một Gmail')
    .addIntegerOption((option) => option.setName('id').setDescription('ID hồ sơ').setRequired(true).setMinValue(1)));

function unix(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? Math.floor(parsed.getTime() / 1000) : null;
}

function money(value) {
  return `${Math.max(0, Number(value || 0)).toLocaleString('vi-VN')}đ`;
}

function overviewPayload(guildId) {
  const E = createEmojiResolver(guildId);
  const memberships = listYoutubeMemberships({ guildId, status: 'ACTIVE', includeSecrets: false });
  const stats = getYoutubeRenewalStats(guildId);
  const lines = memberships.slice(0, 12).map((membership) => {
    const due = membership.remainingCycles === 0
      ? 'đã trả đủ nguồn'
      : membership.overdueDays > 0
        ? `quá hạn ${membership.overdueDays} ngày`
        : `còn ${membership.daysUntilPayment} ngày`;
    return [
      `${E('icon_id')} **#${membership.id} · ${membership.customerGmailMasked}** — ${membership.paidCycles}/${membership.totalCycles} kỳ`,
      `> ${E('icon_store')} ${membership.sourceName} · **${due}** · ${money(membership.sourceCostPerCycle)}`,
    ].join('\n');
  });
  if (memberships.length > 12) lines.push(`_...và ${memberships.length - 12} hồ sơ khác trên website._`);
  if (!lines.length) lines.push('_Chưa có hồ sơ YouTube. Hãy nhập lại danh sách khách trên website._');
  const portal = new URL('/admin/youtube-renewals', config.storeWebsiteUrl || 'https://cenarstore.xyz').toString();
  const container = new ContainerBuilder().setAccentColor(accentFor('danger'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('brand_youtube')} YOUTUBE RENEWAL CONTROL CENTER`,
    `> ${E('cenar_verified')} Theo dõi từng Gmail khách và từng lần shop thanh toán cho nguồn.` ,
    '',
    `### ${E('icon_chart')} TỔNG QUAN NGHĨA VỤ NGUỒN`,
    `${E('ticket_user')} **Hồ sơ hoạt động:** ${stats.activeMemberships}`,
    `${E('icon_clock')} **Cần xử lý trong 7 ngày:** ${stats.dueIn7Days}`,
    `${E('status_warn')} **Đang quá hạn:** ${stats.overdueMemberships}`,
    `${E('payment_money')} **Chi phí các kỳ kế tiếp:** ${money(stats.nextCycleCost)}`,
    `${E('payment_payos')} **Tổng nghĩa vụ còn lại:** ${money(stats.remainingLiability)}`,
    '',
    `### ${E('icon_history')} DANH SÁCH KHÁCH`,
    ...lines,
    '',
    `${E('icon_web')} **YouTube Center:** ${portal}`,
    `-# Dùng /youtube-renewal view để xem từng hồ sơ · Gmail đầy đủ chỉ hiện riêng cho Admin`,
  ].join('\n').slice(0, 4000)));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

function historyPayload(membership, history) {
  const E = createEmojiResolver(membership.guildId || config.guildId);
  const lines = history.slice(0, 15).map((event) => {
    const paidTs = unix(event.paidAt || event.createdAt);
    const label = event.eventType === 'PAYMENT' ? 'Thanh toán nguồn' : event.eventType === 'ADJUSTMENT' ? 'Điều chỉnh dữ liệu' : 'Mốc nhập ban đầu';
    return `${E(event.eventType === 'PAYMENT' ? 'status_check' : 'icon_history')} **${label}** · kỳ ${event.cycleNumber ?? '-'} · ${money(event.amountPaid)}\n> <t:${paidTs}:f> · ${event.paymentReference || event.note || 'Không có ghi chú'}`;
  });
  if (!lines.length) lines.push('_Chưa có lịch sử thanh toán._');
  const container = new ContainerBuilder().setAccentColor(accentFor('info'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('icon_history')} LỊCH SỬ NGUỒN · HỒ SƠ #${membership.id}`,
    `> ${E('icon_id')} \`${membership.customerGmailMasked}\` · ${membership.sourceName}`,
    '',
    ...lines,
  ].join('\n').slice(0, 4000)));
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const subcommand = interaction.options.getSubcommand();
  try {
    if (subcommand === 'overview') return interaction.editReply(overviewPayload(interaction.guildId));
    const id = interaction.options.getInteger('id', true);
    const existing = getYoutubeMembership(id, { includeSecrets: false, includeHistory: false });
    if (!existing || ![interaction.guildId, 'WEB'].includes(existing.guildId)) {
      return interaction.editReply('Không tìm thấy hồ sơ YouTube với ID này.');
    }
    if (subcommand === 'paid') {
      const amount = interaction.options.getInteger('so_tien');
      const updated = markYoutubeCyclePaid(id, {
        amountPaid: amount == null ? undefined : amount,
        paymentReference: interaction.options.getString('ma_giao_dich'),
        familyLabel: interaction.options.getString('family'),
        actorId: interaction.user.id,
        note: 'Xác nhận qua lệnh /youtube-renewal paid.',
      });
      return interaction.editReply(buildYoutubeRenewalPanel(updated, { ping: false }));
    }
    if (subcommand === 'history') {
      return interaction.editReply(historyPayload(existing, getYoutubeRenewalHistory(id)));
    }
    return interaction.editReply(buildYoutubeRenewalPanel(existing, { ping: false }));
  } catch (error) {
    console.error('[YOUTUBE-RENEWAL-COMMAND]', error);
    return interaction.editReply(`Không thể xử lý gia hạn YouTube: ${error.message}`);
  }
}

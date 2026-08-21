import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getQuestStats, listCustomerQuestRequests, listQuestRequests } from '../services/questService.js';

const STATUS_LABELS = {
  PENDING_REVIEW: 'Chờ duyệt',
  APPROVED: 'Đã duyệt',
  IN_PROGRESS: 'Đang tiến hành',
  WAITING_CUSTOMER: 'Cần bổ sung',
  COMPLETED: 'Hoàn tất',
  REJECTED: 'Từ chối',
};

export const data = new SlashCommandBuilder()
  .setName('quest')
  .setDescription('Theo dõi yêu cầu hỗ trợ Discord Quest an toàn')
  .addSubcommand((subcommand) => subcommand
    .setName('trang-thai')
    .setDescription('Xem tiến độ các yêu cầu Quest của bạn'))
  .addSubcommand((subcommand) => subcommand
    .setName('hang-doi')
    .setDescription('Xem tổng quan hàng đợi Quest dành cho quản trị viên'));

function websiteUrl(admin = false) {
  return `${String(config.storeWebsiteUrl || 'https://cenarstore.xyz').replace(/\/$/, '')}${admin ? '/admin/quest-service' : '/quest'}`;
}

function progressBar(percent) {
  const filled = Math.max(0, Math.min(10, Math.round(Number(percent || 0) / 10)));
  return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)}`;
}

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'hang-doi' && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: `${E('status_cross')} Bạn không có quyền xem hàng đợi quản trị.`, flags: MessageFlags.Ephemeral });
  }

  try {
    const panel = new ContainerBuilder().setAccentColor(0x7C5CFF);
    if (subcommand === 'hang-doi') {
      const stats = getQuestStats();
      const pending = listQuestRequests({ status: 'PENDING_REVIEW', limit: 5 });
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `# ${E('cenar_verified')} CENAR QUEST · HÀNG ĐỢI`,
        `> ${E('status_info')} Trung tâm duyệt và cập nhật tiến độ Quest đồng bộ với website.`,
      ].join('\n')));
      panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `### ${E('icon_clock')} TỔNG QUAN`,
        `**${stats.byStatus.PENDING_REVIEW}** chờ duyệt · **${stats.active}** đang hoạt động · **${stats.completed}** hoàn tất`,
        '',
        pending.length
          ? pending.map((item) => `- \`${item.requestCode}\` · **${item.questName}** · <@${item.discordId}>`).join('\n')
          : `${E('status_check')} Không có yêu cầu mới đang chờ.`,
      ].join('\n')));
    } else {
      const requests = listCustomerQuestRequests(interaction.user.id).slice(0, 5);
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent([
        `# ${E('cenar_verified')} CENAR QUEST · TIẾN ĐỘ`,
        `> ${E('verify_shield')} Theo dõi yêu cầu bằng tài khoản Discord đã liên kết. **Cenar không yêu cầu token hoặc mật khẩu.**`,
      ].join('\n')));
      panel.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
      panel.addTextDisplayComponents(new TextDisplayBuilder().setContent(requests.length
        ? requests.map((item) => [
            `### ${E(item.status === 'COMPLETED' ? 'status_check' : 'icon_clock')} ${item.requestCode} · ${STATUS_LABELS[item.status] || item.status}`,
            `**${item.questName}** · ${Number(item.quotedPrice).toLocaleString('vi-VN')}đ`,
            `\`${progressBar(item.progressPercent)}\` **${item.progressPercent}%**`,
            `-# ${item.currentStep}`,
          ].join('\n')).join('\n\n')
        : `${E('status_info')} Bạn chưa có yêu cầu Quest nào. Mở website để gửi yêu cầu đầu tiên.`));
    }

    const openButton = new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setURL(websiteUrl(subcommand === 'hang-doi'))
      .setLabel(subcommand === 'hang-doi' ? 'Mở trang quản trị' : 'Mở Cenar Quest');
    const buttonEmoji = E.component('cenar_verified');
    if (buttonEmoji) openButton.setEmoji(buttonEmoji);
    const actions = new ActionRowBuilder().addComponents(openButton);
    return interaction.reply({
      components: [panel, actions],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    });
  } catch (error) {
    console.error('[QUEST-COMMAND]', error);
    return interaction.reply({ content: `${E('status_cross')} Không thể tải dữ liệu Quest lúc này.`, flags: MessageFlags.Ephemeral });
  }
}

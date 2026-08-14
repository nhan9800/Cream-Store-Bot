import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import {
  ensureCtvRecruitmentCampaign,
  getCtvSettings,
  startCtvRecruitmentCampaign,
} from '../services/ctvService.js';
import { publishCtvRecruitmentPanel } from '../services/ctvRecruitmentPanelService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';

export const data = new SlashCommandBuilder()
  .setName('ctv-recruit')
  .setDescription('[Admin] Đăng hoặc mở đợt tuyển CTV với bộ đếm slot tự động.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addIntegerOption((option) => option
    .setName('so_luong')
    .setDescription('Mở đợt tuyển mới và đặt lại số slot (bỏ trống để chỉ cập nhật panel)')
    .setMinValue(1)
    .setMaxValue(50)
    .setRequired(false));

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const settings = getCtvSettings(interaction.guildId);
  if (!settings.recruit_channel_id) {
    return interaction.reply({
      content: `${E('status_cross')} Hãy cấu hình kênh tuyển dụng bằng lệnh \`/setup-ctv\` trước.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  const requestedCapacity = interaction.options.getInteger('so_luong');
  const snapshot = requestedCapacity
    ? startCtvRecruitmentCampaign(interaction.guildId, requestedCapacity)
    : ensureCtvRecruitmentCampaign(interaction.guildId, 3);
  const message = await publishCtvRecruitmentPanel(interaction.guild, getCtvSettings(interaction.guildId));
  if (!message) {
    return interaction.reply({
      content: `${E('status_cross')} Không tìm thấy kênh tuyển CTV hoặc bot chưa có quyền gửi tin nhắn.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  return interaction.reply({
    content: [
      `${E('cenar_verified')} ${requestedCapacity ? `Đã mở đợt tuyển mới với **${snapshot.capacity} slot**.` : 'Đã cập nhật panel tuyển CTV.'}`,
      `${E('cenar_announce')} [Mở panel tuyển dụng](${message.url})`,
    ].join('\n'),
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

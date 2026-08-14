import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { buildPartnerRecruitmentPayload } from '../services/autoSetupService.js';
import { getPartnerSettings } from '../services/partnerService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';

export const data = new SlashCommandBuilder()
  .setName('partner-recruit')
  .setDescription('[Admin] Đăng bảng tuyển Cenar Partner dành cho cộng đồng từ 3.000 thành viên.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const settings = getPartnerSettings(interaction.guildId);

  if (!settings.recruit_channel_id) {
    return interaction.reply({
      content: `${E('status_cross')} Hãy cấu hình kênh tuyển Partner bằng lệnh \`/setup-partner\` trước.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  const channel = await interaction.guild.channels.fetch(settings.recruit_channel_id).catch(() => null);
  if (!channel?.isTextBased()) {
    return interaction.reply({
      content: `${E('status_cross')} Kênh tuyển Partner không tồn tại hoặc bot không có quyền truy cập.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  const message = await channel.send(buildPartnerRecruitmentPayload(interaction.guildId, {
    partnerBroadcast: settings.partner_channel_id,
    partnerDirectory: settings.directory_channel_id,
  }));

  return interaction.reply({
    content: `${E('cenar_verified')} Đã đăng chương trình Partner 3K+ tại <#${channel.id}> · [Mở thông báo](${message.url})`,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

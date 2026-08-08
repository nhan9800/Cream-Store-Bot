import { SlashCommandBuilder, PermissionFlagsBits, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ButtonBuilder, ButtonStyle, ActionRowBuilder, MessageFlags } from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getCtvSettings } from '../services/ctvService.js';
import { brandName, accentFor } from '../utils/uiKit.js';

export const data = new SlashCommandBuilder()
  .setName('ctv-recruit')
  .setDescription('[Admin] Gửi bảng đăng ký tuyển Cộng Tác Viên (CTV) vào kênh cấu hình.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const settings = getCtvSettings(interaction.guildId);

  if (!settings.recruit_channel_id) {
    return interaction.reply({
      content: `${E('status_cross')} Bạn cần cấu hình kênh tuyển dụng bằng lệnh \`/setup-ctv\` trước.`,
      ephemeral: true
    });
  }

  const channel = await interaction.guild.channels.fetch(settings.recruit_channel_id).catch(() => null);
  if (!channel) {
    return interaction.reply({
      content: `${E('status_cross')} Kênh tuyển dụng đã cấu hình không tồn tại hoặc bot không có quyền truy cập.`,
      ephemeral: true
    });
  }

  const storeName = brandName();

  const headerLine = [E('icon_sparkle'), `TUYỂN DỤNG CỘNG TÁC VIÊN — ${storeName.toUpperCase()}`]
    .filter(Boolean).join(' ');

  const bodyLines = [
    `### ${E('icon_group')} Trở thành Cộng Tác Viên (Reseller) của Cenar Store!`,
    `Bạn muốn kinh doanh các sản phẩm giải trí & học tập bản quyền nhưng không có vốn, không có nguồn hàng?`,
    `Hãy gia nhập đội ngũ CTV của Cenar Store để nhận được nguồn hàng giá tốt nhất thị trường cùng hệ thống tự động hóa hoàn toàn.`,
    '',
    `#### ${E('icon_gift')} **QUYỀN LỢI CTV:**`,
    `* ${E('icon_price')} **Mua hàng giá sỉ siêu rẻ:** Chiết khấu 10% - 30% trực tiếp trên hóa đơn so với giá bán lẻ.`,
    `* ${E('icon_duration')} **Giao hàng ưu tiên:** Đơn hàng của CTV được hệ thống tự động đẩy lên đầu hàng đợi để Staff xử lý nhanh nhất.`,
    `* ${E('icon_trophy')} **Hỗ trợ VIP 24/7:** Ticket của CTV được ưu tiên hiển thị và xử lý.`,
    `* ${E('icon_location')} Không ép doanh số tháng đầu, tự do làm chủ thời gian.`,
    '',
    `#### ${E('status_warn')} **YÊU CẦU ỨNG TUYỂN:**`,
    `* Có kênh bán hàng riêng (Profile cá nhân, Group, Page, Tiktok, Telegram...).`,
    `* Tuyệt đối nghiêm túc trong bán hàng, không scam/lừa đảo khách hàng của bạn.`,
    '',
    `**Bấm nút bên dưới để điền thông tin đăng ký (Duyệt nhanh trong 24h):**`,
  ].join('\n');

  const container = new ContainerBuilder().setAccentColor(accentFor('primary'));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`# ${headerLine}`));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(bodyLines));

  const applyBtn = new ButtonBuilder()
    .setCustomId('ctv:apply:start')
    .setLabel('Ứng Tuyển CTV')
    .setStyle(ButtonStyle.Success);

  const btnEmoji = E.component('icon_group');
  if (btnEmoji) applyBtn.setEmoji(btnEmoji);

  const row = new ActionRowBuilder().addComponents(applyBtn);

  await channel.send({
    components: [container, row],
    flags: MessageFlags.IsComponentsV2
  });

  await interaction.reply({
    content: `${E('status_check')} Đã gửi Panel tuyển CTV vào kênh <#${settings.recruit_channel_id}>.`,
    ephemeral: true
  });
}

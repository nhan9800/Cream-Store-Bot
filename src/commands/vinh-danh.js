import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { getLeaderboardPeriodBounds, getLeaderboardRows } from '../services/leaderboardService.js';
import { buildLeaderboardV2, findLeaderboardChannel, runAutoVinhDanh } from '../services/vinhDanhService.js';

export const data = new SlashCommandBuilder()
  .setName('vinh-danh')
  .setDescription('Bảng vinh danh khách hàng tiêu biểu')
  .addSubcommand(sub => sub.setName('thang-nay').setDescription('Top khách hàng chi tiêu nhiều nhất tháng này'))
  .addSubcommand(sub => sub.setName('tat-ca').setDescription('Top khách hàng chi tiêu nhiều nhất mọi thời đại'))
  .addSubcommand(sub => sub.setName('dang-len-kenh')
    .setDescription('Cập nhật bảng vinh danh lên kênh của shop (Admin)')
    .addStringOption(opt => opt.setName('loai').setDescription('Loại bảng').setRequired(true)
      .addChoices({ name: 'Tháng này', value: 'month' }, { name: 'Toàn thời đại', value: 'all' })));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const adminPost = sub === 'dang-len-kenh';
  const isMonth = adminPost ? interaction.options.getString('loai') === 'month' : sub === 'thang-nay';
  const E = createEmojiResolver(interaction.guildId);
  // Acknowledge before member/Discord fetches so a slow request cannot expire.
  await interaction.deferReply({ ephemeral: adminPost });
  try {
    if (adminPost) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      const hasAdmin = member.permissions?.has(PermissionFlagsBits.Administrator)
        || member.roles?.cache?.some(role => ['Admin', 'Quản Trị', 'Owner', 'Sáng Lập'].some(name => role.name.includes(name)));
      if (!hasAdmin) return interaction.editReply(`${E('status_cross')} Chỉ Admin mới có thể đăng bảng vinh danh.`);
      if (isMonth) {
        const result = await runAutoVinhDanh(interaction.client);
        if (!['READY', 'PENDING'].includes(result.status)) {
          return interaction.editReply(`${E('status_warn')} Chưa cập nhật được bảng vinh danh. Bot sẽ thử lại tự động; vui lòng kiểm tra quyền xem/gửi/sửa tin nhắn của bot.`);
        }
        const channel = await findLeaderboardChannel(interaction.guild, interaction.client);
        return interaction.editReply(`${E('status_check')} Đã cập nhật bảng tháng ${result.period} vào <#${channel.id}>.${result.status === 'PENDING' ? ' Bản chốt tháng trước đang chờ xác nhận.' : ''}`);
      }
    }
    const now = new Date();
    const period = getLeaderboardPeriodBounds('monthly', now);
    const [month, year] = period.label.split('/');
    const title = isMonth ? `VINH DANH THÁNG ${month}/${year}` : 'VINH DANH MỌI THỜI ĐẠI';
    const subtitle = isMonth
      ? `Top khách hàng chi tiêu nhiều nhất trong **tháng ${month}/${year}**`
      : 'Top khách hàng chi tiêu nhiều nhất từ trước đến nay';
    const rows = getLeaderboardRows(interaction.guildId, isMonth ? 'monthly' : 'all', now, 10).rows;
    const payload = buildLeaderboardV2(title, subtitle, rows, interaction.guildId);
    if (!adminPost) return interaction.editReply(payload);
    const channel = await findLeaderboardChannel(interaction.guild, interaction.client);
    if (channel.archived) await channel.setArchived(false, 'Đăng bảng vinh danh theo lệnh quản trị');
    await channel.send(payload);
    return interaction.editReply(`${E('status_check')} Đã đăng bảng vinh danh vào <#${channel.id}>!`);
  } catch {
    return interaction.editReply(`${E('status_warn')} Chưa cập nhật được bảng vinh danh. Vui lòng thử lại sau; dữ liệu đơn hàng được giữ nguyên.`);
  }
}

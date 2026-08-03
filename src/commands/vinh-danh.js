import {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
  ContainerBuilder, TextDisplayBuilder, MessageFlags,
  SeparatorBuilder, SeparatorSpacingSize,
} from 'discord.js';
import { db } from '../database/db.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import {
  getLeaderboardPeriodBounds,
  getLeaderboardRows,
} from '../services/leaderboardService.js';

export const data = new SlashCommandBuilder()
  .setName('vinh-danh')
  .setDescription('Bảng vinh danh khách hàng tiêu biểu')
  .addSubcommand(sub =>
    sub.setName('thang-nay')
       .setDescription('Top khách hàng chi tiêu nhiều nhất tháng này')
  )
  .addSubcommand(sub =>
    sub.setName('tat-ca')
       .setDescription('Top khách hàng chi tiêu nhiều nhất mọi thời đại')
  )
  .addSubcommand(sub =>
    sub.setName('dang-len-kenh')
       .setDescription('Đăng bảng vinh danh lên kênh #bảng-vinh-danh (Admin)')
       .addStringOption(opt =>
         opt.setName('loai').setDescription('Loại bảng').setRequired(true)
            .addChoices(
              { name: 'Tháng này', value: 'month' },
              { name: 'Toàn thời đại', value: 'all' }
            )
       )
  );

// ─── Huy hiệu top ────────────────────────────────────────
const MEDAL_SLOTS = ['icon_gold', 'icon_silver', 'icon_bronze', 'icon_num4', 'icon_num5', 'icon_num6', 'icon_num7', 'icon_num8', 'icon_num9', 'icon_num10'];
const VIP_TIERS = [
  { min: 8_000_000, label: 'Diamond', emojiSlot: 'icon_gem', color: 0x60A5FA },
  { min: 5_000_000, label: 'Ruby',    emojiSlot: 'icon_heart', color: 0xF87171 },
  { min: 3_000_000, label: 'Elite',   emojiSlot: 'icon_crown', color: 0xFBBF24 },
  { min: 1_000_000, label: 'VIP',     emojiSlot: 'icon_star',  color: 0xA78BFA },
  { min: 0,         label: 'Khách',   emojiSlot: 'icon_cart', color: 0x6B7280 },
];

function getTier(spent) {
  return VIP_TIERS.find(t => spent >= t.min) || VIP_TIERS[VIP_TIERS.length - 1];
}

function fmt(n) { return new Intl.NumberFormat('vi-VN').format(Number(n||0)); }

// Trả về { components, flags } — V2 để custom emoji hiển thị ở mọi vị trí
function buildLeaderboardV2(title, subtitle, rows, guildId) {
  const E = createEmojiResolver(guildId);
  const topTier = rows.length ? getTier(rows[0]?.total_spent || 0) : VIP_TIERS[VIP_TIERS.length - 1];
  const container = new ContainerBuilder().setAccentColor(topTier.color);

  if (!rows.length) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `## ${E('icon_trophy')} ${title}\n> *Chưa có dữ liệu đơn hàng hoàn thành.*`
    ));
    return { components: [container], flags: MessageFlags.IsComponentsV2 };
  }

  const lines = rows.map((r, i) => {
    const medal = MEDAL_SLOTS[i] ? E(MEDAL_SLOTS[i]) : `${i + 1}.`;
    const tier  = getTier(r.total_spent || 0);
    const spent = fmt(r.total_spent || 0);
    return `${medal} <@${r.customer_id}> ${E(tier.emojiSlot)} **${tier.label}**\n` +
           `> ${E('payment_payos')} ${r.orders} đơn | ${E('payment_money')} **${spent}đ**`;
  });

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${E('icon_trophy')} ${title}\n> ${subtitle}`
  ));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n\n')));
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small)
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# ${E('icon_heart_purple')} Cenar Store — Cảm ơn quý khách đã ủng hộ`
  ));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  const E = createEmojiResolver(guildId);

  const now = new Date();
  if (sub === 'thang-nay' || sub === 'tat-ca' || sub === 'dang-len-kenh') {
    const loai = sub === 'dang-len-kenh'
      ? interaction.options.getString('loai')
      : (sub === 'thang-nay' ? 'month' : 'all');

    const isMonth = loai === 'month';
    const period = getLeaderboardPeriodBounds('monthly', now);
    const [monthLabel, yearLabel] = period.label.split('/');
    const title = isMonth
      ? `VINH DANH THÁNG ${monthLabel}/${yearLabel}`
      : 'VINH DANH MỌI THỜI ĐẠI';
    const subtitle = isMonth
      ? `Top khách hàng chi tiêu nhiều nhất trong **tháng ${monthLabel}/${yearLabel}**`
      : 'Top khách hàng chi tiêu nhiều nhất từ trước đến nay';

    const rows = getLeaderboardRows(guildId, isMonth ? 'monthly' : 'all', now, 10).rows;

    const payload = buildLeaderboardV2(title, subtitle, rows, guildId);

    if (sub === 'dang-len-kenh') {
      // Chỉ Admin/Manager
      const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const hasAdmin = member?.permissions?.has(PermissionFlagsBits.Administrator) ||
                       member?.roles?.cache?.some(r => r.name.includes('Admin') || r.name.includes('Quản Trị') || r.name.includes('Owner') || r.name.includes('Sáng Lập'));
      if (!hasAdmin) {
        return interaction.reply({ content: `${E('status_cross')} Chỉ Admin mới có thể đăng bảng vinh danh.`, ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      // Tìm kênh bảng-vinh-danh
      const vinhdanhChan = interaction.guild.channels.cache.find(
        c => c.type === ChannelType.GuildText && c.name.includes('vinh-danh')
      );
      if (!vinhdanhChan) {
        return interaction.editReply(`${E('status_warn')} Không tìm thấy kênh #bảng-vinh-danh!`);
      }

      // Xóa tin cũ của bot trong kênh
      const old = await vinhdanhChan.messages.fetch({ limit: 20 }).catch(() => null);
      if (old) {
        for (const m of old.filter(m => m.author.id === interaction.client.user.id).values()) {
          await m.delete().catch(() => null);
          await new Promise(r => setTimeout(r, 300));
        }
      }

      await vinhdanhChan.send(payload).catch(() => null);
      await interaction.editReply(`${E('status_check')} Đã đăng bảng vinh danh vào <#${vinhdanhChan.id}>!`);

    } else {
      await interaction.reply(payload);
    }
  }
}

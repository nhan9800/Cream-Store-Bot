import {
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import {
  getPoints,
  getPointHistory,
  redeemForCredit,
  getLoyaltyLeaderboard,
} from '../services/loyaltyService.js';

export const data = new SlashCommandBuilder()
  .setName('loyalty')
  .setDescription('Hệ thống điểm tích luỹ')
  .addSubcommand((sub) => sub.setName('points').setDescription('Xem điểm tích luỹ của bạn'))
  .addSubcommand((sub) => sub
    .setName('redeem')
    .setDescription('Đổi điểm lấy tiền vào ví')
    .addIntegerOption((opt) => opt
      .setName('points')
      .setDescription('Số điểm muốn đổi')
      .setRequired(true)
      .setMinValue(1)))
  .addSubcommand((sub) => sub.setName('history').setDescription('Xem lịch sử điểm'))
  .addSubcommand((sub) => sub.setName('leaderboard').setDescription('Bảng xếp hạng điểm tích luỹ'));

function buildPanel({ color, title, content, footer }) {
  const container = new ContainerBuilder().setAccentColor(color);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${title}`),
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(content),
  );
  if (footer) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small),
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${footer}`),
    );
  }
  return container;
}

function v2Payload(container, ephemeral = false) {
  return {
    components: [container],
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
  };
}

function notice(E, message, tone = 'info') {
  const slot = tone === 'error' ? 'status_cross' : tone === 'success' ? 'status_check' : 'status_info';
  const color = tone === 'error' ? 0xED4245 : tone === 'success' ? 0x22C55E : 0x6366F1;
  return buildPanel({
    color,
    title: `${E(slot)} Thông báo Loyalty`,
    content: `> ${message}`,
    footer: `${E('icon_heart_purple')} Cenar Store · Điểm thưởng đồng bộ theo đơn đã thanh toán`,
  });
}

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guildId);
  const sub = interaction.options.getSubcommand();

  if (sub === 'points') {
    const points = getPoints(interaction.guildId, interaction.user.id);
    const container = buildPanel({
      color: 0x6366F1,
      title: `${E('icon_star')} Điểm Tích Luỹ`,
      content: [
        `> ${E('icon_target')} **Điểm khả dụng:** \`${points.points}\``,
        `> ${E('icon_chart')} **Tổng điểm đã tích:** \`${points.lifetime_points}\``,
      ].join('\n'),
      footer: `${E('icon_tip')} Mỗi 10.000đ mua hàng = 1 điểm · 1 điểm = 100đ khi đổi`,
    });
    await interaction.reply(v2Payload(container));
    return;
  }

  if (sub === 'redeem') {
    const points = interaction.options.getInteger('points');
    const result = redeemForCredit(interaction.guildId, interaction.user.id, points);
    if (!result.success) {
      await interaction.reply(v2Payload(notice(E, result.error, 'error'), true));
      return;
    }

    const container = buildPanel({
      color: 0x22C55E,
      title: `${E('icon_gift')} Đổi Điểm Thành Công`,
      content: [
        `> ${E('icon_star')} **Đã đổi:** ${points} điểm`,
        `> ${E('payment_money')} **Đã cộng ví:** ${result.creditAmount.toLocaleString('vi-VN')}đ`,
        `> ${E('icon_chart')} **Điểm còn lại:** ${result.remaining}`,
      ].join('\n'),
      footer: `${E('status_check')} Số dư ví đã được cập nhật ngay lập tức`,
    });
    await interaction.reply(v2Payload(container));
    return;
  }

  if (sub === 'history') {
    const history = getPointHistory(interaction.guildId, interaction.user.id, 10);
    if (!history.length) {
      await interaction.reply(v2Payload(notice(E, 'Bạn chưa có lịch sử điểm.', 'info'), true));
      return;
    }

    const rows = history.map((entry) => {
      const sign = entry.points > 0 ? '+' : '';
      const marker = entry.points > 0 ? E('icon_green') : E('icon_red');
      const timestamp = Math.floor(new Date(entry.created_at).getTime() / 1000);
      return `${marker} **${sign}${entry.points} điểm**\n> ${entry.description || entry.type} · <t:${timestamp}:R>`;
    });
    const container = buildPanel({
      color: 0x6366F1,
      title: `${E('icon_clipboard')} Lịch Sử Điểm Tích Luỹ`,
      content: rows.join('\n\n'),
      footer: `${E('icon_history')} Hiển thị 10 giao dịch gần nhất`,
    });
    await interaction.reply(v2Payload(container, true));
    return;
  }

  if (sub === 'leaderboard') {
    const top = getLoyaltyLeaderboard(interaction.guildId, 10);
    if (!top.length) {
      await interaction.reply(v2Payload(notice(E, 'Chưa có dữ liệu tích điểm để xếp hạng.', 'info'), true));
      return;
    }

    const medals = [E('icon_gold'), E('icon_silver'), E('icon_bronze')];
    const rows = top.map((entry, index) => {
      const rank = medals[index] || `**#${index + 1}**`;
      return `${rank} <@${entry.customer_id}>\n> ${E('icon_star')} **${entry.lifetime_points.toLocaleString('vi-VN')} điểm**`;
    });
    const container = buildPanel({
      color: 0xF59E0B,
      title: `${E('icon_trophy')} Top Tích Điểm Cenar Store`,
      content: rows.join('\n\n'),
      footer: `${E('icon_heart_purple')} Cảm ơn khách hàng đã đồng hành cùng Cenar Store`,
    });
    await interaction.reply(v2Payload(container));
  }
}

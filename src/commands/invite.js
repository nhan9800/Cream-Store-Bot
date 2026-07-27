import { 
  SlashCommandBuilder, 
  ContainerBuilder, 
  TextDisplayBuilder, 
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { db } from '../database/db.js';

// ─── Emoji custom của Cenar Store ────────────
const E = (key) => {
  const map = {
    icon_sparkle: '<a:tsm_fire:1327553120842158111>',
    icon_gift:    '🎁',
    icon_star:    '<:star:1327549089704837142>',
    icon_arrow_right: '<:muiten:1481124261501337601>',
    icon_cart:    '<:cr_carttt:1348626032747614268>',
    icon_check:   '<a:tickgreen:1384069022831874169>',
    icon_error:   '❌',
  };
  return map[key] || '⭐';
};

export const data = new SlashCommandBuilder()
  .setName('invites')
  .setDescription('Kiểm tra số lượt mời khách & tiến độ nhận Decor Free!');

export async function execute(interaction) {
  try {
    const userId = interaction.user.id;
    const guildId = interaction.guildId;

    // Check stats
    const totalRow = db.prepare('SELECT COUNT(*) as count FROM user_invites WHERE inviter_id = ? AND guild_id = ?').get(userId, guildId);
    const purchasedRow = db.prepare('SELECT COUNT(*) as count FROM user_invites WHERE inviter_id = ? AND guild_id = ? AND has_purchased = 1').get(userId, guildId);
    const claimedRow = db.prepare('SELECT COUNT(*) as count FROM invite_rewards_claimed WHERE user_id = ? AND guild_id = ?').get(userId, guildId);

    const totalInvites = totalRow.count;
    const purchasedInvites = purchasedRow.count;
    const hasClaimed = claimedRow.count > 0;

    let progressStr = '';
    if (hasClaimed) {
      progressStr = `> ${E('icon_sparkle')} **Đã Nhận Thưởng!** (Bạn đã nhận 1 Decor Free)`;
    } else {
      const neededInvites = Math.max(0, 5 - totalInvites);
      const neededPurchases = Math.max(0, 1 - purchasedInvites);
      
      if (neededInvites === 0 && neededPurchases === 0) {
        progressStr = `> ${E('icon_gift')} **Đủ điều kiện nhận thưởng!** Hệ thống đang duyệt để gửi Ticket cho bạn...`;
      } else {
        progressStr = `> ${E('icon_arrow_right')} **Tiến độ:** Cần thêm **${neededInvites}** lượt mời & **${neededPurchases}** đơn hàng.`;
      }
    }

    const container = new ContainerBuilder()
      .setBackgroundColor('#1E1E2E')
      .setBorderColor('#A6E3A1');

    const title = new TextDisplayBuilder()
      .setText(`${E('icon_star')} TIẾN ĐỘ SỰ KIỆN MỜI KHÁCH ${E('icon_star')}`)
      .setStyle('header1')
      .setColor('#A6E3A1');

    const info = new TextDisplayBuilder()
      .setText(
        `Thân chào <@${userId}>,\n` +
        `Dưới đây là thống kê lượt mời khách vào Server của bạn:\n\n` +
        `${E('icon_cart')} **Số người đã tham gia:** \`${totalInvites}\` người\n` +
        `${E('icon_check')} **Số người phát sinh đơn hàng:** \`${purchasedInvites}\` người\n\n` +
        `${progressStr}\n\n` +
        `💡 *Lưu ý: Bạn phải tự tạo Link Mời (Vĩnh viễn) và gửi cho bạn bè để hệ thống ghi nhận.*`
      )
      .setStyle('paragraph')
      .setColor('#CDD6F4');

    container.addText(title).addText(info);

    await interaction.reply({
      components: [container],
      flags: MessageFlags.IsComponentsV2
    });

  } catch (error) {
    console.error('[INVITES COMMAND] Error:', error);
    await interaction.reply({
      content: `${E('icon_error')} Đã xảy ra lỗi khi tải dữ liệu!`,
      ephemeral: true
    });
  }
}

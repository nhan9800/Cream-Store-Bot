import { createEmojiResolver } from '../utils/emojiHelper.js';
import { buildLegacyFeatureCard } from '../utils/featureCard.js';
import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import { STAFF_DEFAULT_PERMISSIONS } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('dsbaohanh')
  .setDescription('Liệt kê danh sách các đơn hàng đang chờ bảo hành')
  .setDefaultMemberPermissions(STAFF_DEFAULT_PERMISSIONS);

export async function execute(interaction) {
  const E = createEmojiResolver(interaction?.guildId);
  if (!interaction.member.permissions.has(STAFF_DEFAULT_PERMISSIONS)) {
    return interaction.reply({ content: 'Bạn không có quyền sử dụng lệnh này.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const db = new Database(config.databasePath);
    
    // Tìm các ticket loại WARRANTY đang OPEN
    const warranties = db.prepare(`
      SELECT t.*, o.product_name, o.discord_customer_id, o.created_at as order_date
      FROM tickets t
      LEFT JOIN orders o ON t.related_order_code = o.order_code
      WHERE t.guild_id = ? AND t.ticket_type = 'WARRANTY' AND t.status = 'OPEN'
      ORDER BY t.created_at DESC
    `).all(interaction.guildId);
    
    db.close();

    if (!warranties || warranties.length === 0) {
      return interaction.editReply(`${E('order_complete')} Tuyệt vời! Hiện tại không có yêu cầu bảo hành nào đang chờ xử lý.`);
    }

    const embed = new EmbedBuilder()
      .setTitle(`${E('panel_warranty')} DANH SÁCH BẢO HÀNH ĐANG XỬ LÝ`)
      .setColor(config.accentColorWarning)
      .setDescription(`Hiện có **${warranties.length}** yêu cầu bảo hành đang mở:`)
      .setTimestamp();

    let count = 1;
    for (const w of warranties) {
      if (count > 25) break; // Giới hạn số lượng field của embed
      const customerInfo = w.customer_id ? `<@${w.customer_id}>` : 'Unknown';
      const orderInfo = w.related_order_code || 'Không rõ';
      const productName = w.product_name || 'Sản phẩm không rõ';
      
      embed.addFields({
        name: `#${count} - Đơn: ${orderInfo}`,
        value: `${E('ticket_user')} Khách hàng: ${customerInfo}\n${E('order_product')} Sản phẩm: ${productName}\n${E('icon_link')} Kênh: <#${w.channel_id}>`,
        inline: false
      });
      count++;
    }

    if (warranties.length > 25) {
      embed.setFooter({ text: `Và ${warranties.length - 25} yêu cầu khác...` });
    }

    await interaction.editReply(buildLegacyFeatureCard({ embeds: [embed] }));
  } catch (error) {
    console.error('[dsbaohanh] Error:', error);
    await interaction.editReply(`${E('status_cross')} Đã xảy ra lỗi khi tải danh sách bảo hành.`);
  }
}

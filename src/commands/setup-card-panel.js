import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';

export const data = new SlashCommandBuilder()
  .setName('setup-card-panel')
  .setDescription('Tạo bảng Đổi Thẻ Cào & Mua Thẻ Cào')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guild.id);
  
  const embed = new EmbedBuilder()
    .setTitle(`${E('star') || '✨'} DỊCH VỤ THẺ CÀO (GẠCH & MUA THẺ)`)
    .setDescription(`> Hệ thống hỗ trợ xử lý thẻ cào tự động 24/7.\n> Phí gạch thẻ siêu rẻ, chiết khấu mua thẻ siêu tốt!\n\n**HƯỚNG DẪN:**\n- 💳 **Đổi Thẻ (Gạch Thẻ):** Đổi thẻ cào (Viettel, Vina, Mobi, Zing...) lấy số dư Ví tiền.\n- 🛒 **Mua Thẻ Cào:** Dùng số dư Ví tiền để mua mã thẻ cào mới.`)
    .setColor(0x3498DB);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cardswap:btn_charge')
      .setLabel('Đổi Thẻ Cào')
      .setEmoji(E('card') || '💳')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('cardswap:btn_buy')
      .setLabel('Mua Thẻ Cào')
      .setEmoji(E('cart') || '🛒')
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.reply({ content: 'Đã tạo bảng dịch vụ thẻ cào thành công.', ephemeral: true });
}

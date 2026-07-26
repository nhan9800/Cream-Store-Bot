import { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags } from 'discord.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';

export const data = new SlashCommandBuilder()
  .setName('setup-card-panel')
  .setDescription('Tạo bảng Đổi Thẻ Cào & Mua Thẻ Cào')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  const E = createEmojiResolver(interaction.guild.id);
  
  const container = new ContainerBuilder().setAccentColor(0x3498DB);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`### ${E('star') || '✨'} DỊCH VỤ THẺ CÀO (GẠCH & MUA THẺ)\n> Hệ thống hỗ trợ xử lý thẻ cào tự động 24/7.\n> Phí gạch thẻ siêu rẻ, chiết khấu mua thẻ siêu tốt!\n\n**HƯỚNG DẪN:**\n- ${E('card') || '💳'} **Đổi Thẻ (Gạch Thẻ):** Đổi thẻ cào (Viettel, Vina, Mobi, Zing...) lấy số dư Ví tiền.\n- ${E('cart') || '🛒'} **Mua Thẻ Cào:** Dùng số dư Ví tiền để mua mã thẻ cào mới.`)
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cardswap:btn_charge')
      .setLabel('Đổi Thẻ Cào')
      .setEmoji(E.component('card') || '💳')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('cardswap:btn_buy')
      .setLabel('Mua Thẻ Cào')
      .setEmoji(E.component('cart') || '🛒')
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.channel.send({ components: [container, row], flags: MessageFlags.IsComponentsV2 });
  await interaction.reply({ content: 'Đã tạo bảng dịch vụ thẻ cào thành công.', ephemeral: true });
}

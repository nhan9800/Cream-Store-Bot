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
    new TextDisplayBuilder().setContent(`### ${E('panel_support')} DỊCH VỤ THẺ CÀO (GẠCH & MUA THẺ)\n> Hệ thống hỗ trợ xử lý thẻ cào tự động 24/7.\n> Phí gạch thẻ rõ ràng, mua mã thẻ riêng tư bằng Ví Cenar.\n\n**HƯỚNG DẪN:**\n- ${E('icon_wallet')} **Đổi Thẻ (Gạch Thẻ):** Đổi thẻ cào (Viettel, Vina, Mobi, Zing...) lấy số dư Ví tiền.\n- ${E('card_success')} **Mua Thẻ Cào:** Dùng số dư Ví Cenar để mua mã thẻ mới.`)
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cardswap:btn_charge')
      .setLabel('Đổi Thẻ Cào')
      .setEmoji(E.component('icon_wallet'))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('cardswap:btn_buy')
      .setLabel('Mua Thẻ Cào')
      .setEmoji(E.component('card_success') || E.component('panel_order'))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('cardswap:btn_fees')
      .setLabel('Xem Bảng Phí')
      .setEmoji(E.component('payment_money'))
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('cardswap:btn_balance')
      .setLabel('Kiểm Tra Số Dư')
      .setEmoji(E.component('icon_wallet'))
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.channel.send({ components: [container, row], flags: MessageFlags.IsComponentsV2 });
  await interaction.reply({ content: 'Đã tạo bảng dịch vụ thẻ cào thành công.', ephemeral: true });
}

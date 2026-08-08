import { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags, SeparatorBuilder, SeparatorSpacingSize } from 'discord.js';
import { db } from '../database/db.js';

export async function autoSetupCardChannel(client) {
  // Get the single guild config
  const guildRow = db.prepare('SELECT guild_id FROM guild_settings LIMIT 1').get();
  if (!guildRow) return;

  const guildId = guildRow.guild_id;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  // Check if channel already exists
  let channel = guild.channels.cache.find(c => c.name === '💳・nap-the-tu-dong' || c.name === 'nap-the-tu-dong' || c.name.includes('nap-the'));
  
  if (!channel) {
    // Create channel
    channel = await guild.channels.create({
      name: '💳・nap-the-tu-dong',
      type: ChannelType.GuildText,
      reason: 'Tự động tạo kênh Gạch thẻ / Mua thẻ theo yêu cầu',
    }).catch(err => {
      console.error('[AUTO-SETUP-CARD] Failed to create channel:', err.message);
      return null;
    });
  }

  if (!channel) return;

  const { createEmojiResolver } = await import('../utils/emojiHelper.js');
  const E = createEmojiResolver(guildId);

  const container = new ContainerBuilder().setAccentColor(0x5865F2);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent([
      `## ${E('payment_payos')} CENAR CARD CENTER`,
      `> Gạch thẻ và mua thẻ tự động, theo dõi trạng thái rõ ràng từ lúc gửi tới khi cộng ví.`,
      '',
      `### ${E('icon_wallet')} Gạch thẻ lấy số dư`,
      `${E('status_loading')} Chọn nhà mạng, nhập đúng mệnh giá, serial và mã thẻ.`,
      `${E('card_success') || E('payment_success')} Card2K xác nhận thành công rồi hệ thống mới cộng ví.`,
      `${E('status_warn')} Thẻ sai mệnh giá được tính theo giá trị thực tế nhà cung cấp trả về.`,
      '',
      `### ${E('card_success')} Mua mã thẻ mới`,
      `${E('cenar_verified')} Thanh toán trực tiếp từ ví Cenar, mã thẻ chỉ hiển thị riêng cho bạn.`,
      `${E('customer_patron')} Giao dịch hợp lệ tự động đồng bộ quyền Cenar Patron với website.`,
    ].join('\n'))
  );
  container.addSeparatorComponents(
    new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${E('cenar_support')} Không gửi mã thẻ cho người khác · Mỗi thẻ chỉ gửi một lần`),
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

  // Xóa các tin nhắn cũ của bot trong kênh
  const oldMessages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (oldMessages) {
    for (const m of oldMessages.filter(m => m.author.id === client.user.id).values()) {
      await m.delete().catch(() => null);
    }
  }

  await channel.send({ 
    components: [container, row], 
    flags: MessageFlags.IsComponentsV2 
  }).catch(err => {
    console.error('[AUTO-SETUP-CARD] Failed to send panel:', err.message);
  });

  console.log('[AUTO-SETUP-CARD] Đã thả lại Card Panel vào kênh #' + channel.name);
}

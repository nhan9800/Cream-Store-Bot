import { ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, MessageFlags } from 'discord.js';
import { db } from '../database/db.js';

export async function autoSetupCardChannel(client) {
  // Get the single guild config
  const guildRow = db.prepare('SELECT guild_id FROM guild_settings LIMIT 1').get();
  if (!guildRow) return;

  const guildId = guildRow.guild_id;

  // Set the 15% margin
  db.prepare(`UPDATE guild_settings SET cardswap_charging_fee_add = 15 WHERE guild_id = ?`).run(guildId);
  console.log('[AUTO-SETUP-CARD] Updated cardswap_charging_fee_add to 15%.');

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  // Check if channel already exists
  let channel = guild.channels.cache.find(c => c.name === '💳・nap-the-tu-dong' || c.name === 'nap-the-tu-dong');
  if (channel) {
    console.log('[AUTO-SETUP-CARD] Channel already exists. Skipping creation.');
    return;
  }

  // Create channel
  channel = await guild.channels.create({
    name: '💳・nap-the-tu-dong',
    type: ChannelType.GuildText,
    reason: 'Tự động tạo kênh Gạch thẻ / Mua thẻ theo yêu cầu',
  }).catch(err => {
    console.error('[AUTO-SETUP-CARD] Failed to create channel:', err.message);
    return null;
  });

  if (!channel) return;

  const { createEmojiResolver } = await import('../utils/emojiHelper.js');
  const E = createEmojiResolver(guildId);

  const container = new ContainerBuilder().setAccentColor(0x3498DB);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`### ${E('panel_support') || '✨'} DỊCH VỤ THẺ CÀO (GẠCH & MUA THẺ)\n> Hệ thống hỗ trợ xử lý thẻ cào tự động 24/7.\n> Phí gạch thẻ siêu rẻ, chiết khấu mua thẻ siêu tốt!\n\n**HƯỚNG DẪN:**\n- ${E('icon_wallet') || '💳'} **Đổi Thẻ (Gạch Thẻ):** Đổi thẻ cào (Viettel, Vina, Mobi, Zing...) lấy số dư Ví tiền.\n- ${E('icon_cart') || '🛒'} **Mua Thẻ Cào:** Dùng số dư Ví tiền để mua mã thẻ cào mới.`)
  );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cardswap:btn_charge')
      .setLabel('Đổi Thẻ Cào')
      .setEmoji(E.component('icon_wallet') || '💳')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('cardswap:btn_buy')
      .setLabel('Mua Thẻ Cào')
      .setEmoji(E.component('icon_cart') || '🛒')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('cardswap:btn_fees')
      .setLabel('Xem Bảng Phí')
      .setEmoji(E.component('payment_money') || '💸')
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({ components: [container, row], flags: MessageFlags.IsComponentsV2 }).catch(err => {
    console.error('[AUTO-SETUP-CARD] Failed to send panel:', err.message);
  });

  console.log('[AUTO-SETUP-CARD] Successfully created #nap-the-tu-dong and sent the panel!');
}

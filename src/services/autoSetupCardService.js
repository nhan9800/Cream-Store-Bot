import { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
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
  let channel = guild.channels.cache.find(c => c.name === 'nap-the-tu-dong');
  if (channel) {
    console.log('[AUTO-SETUP-CARD] Channel #nap-the-tu-dong already exists. Skipping creation.');
    return;
  }

  // Create channel
  channel = await guild.channels.create({
    name: 'nap-the-tu-dong',
    type: ChannelType.GuildText,
    reason: 'Tự động tạo kênh Gạch thẻ / Mua thẻ theo yêu cầu',
  }).catch(err => {
    console.error('[AUTO-SETUP-CARD] Failed to create channel:', err.message);
    return null;
  });

  if (!channel) return;

  // Send panel
  const embed = new EmbedBuilder()
    .setTitle(`✨ DỊCH VỤ THẺ CÀO (GẠCH & MUA THẺ)`)
    .setDescription(`> Hệ thống hỗ trợ xử lý thẻ cào tự động 24/7.\n> Phí gạch thẻ siêu rẻ, chiết khấu mua thẻ siêu tốt!\n\n**HƯỚNG DẪN:**\n- 💳 **Đổi Thẻ (Gạch Thẻ):** Đổi thẻ cào (Viettel, Vina, Mobi, Zing...) lấy số dư Ví tiền.\n- 🛒 **Mua Thẻ Cào:** Dùng số dư Ví tiền để mua mã thẻ cào mới.`)
    .setColor(0x3498DB);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cardswap:btn_charge')
      .setLabel('Đổi Thẻ Cào')
      .setEmoji('💳')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('cardswap:btn_buy')
      .setLabel('Mua Thẻ Cào')
      .setEmoji('🛒')
      .setStyle(ButtonStyle.Primary)
  );

  await channel.send({ embeds: [embed], components: [row] }).catch(err => {
    console.error('[AUTO-SETUP-CARD] Failed to send panel:', err.message);
  });

  console.log('[AUTO-SETUP-CARD] Successfully created #nap-the-tu-dong and sent the panel!');
}

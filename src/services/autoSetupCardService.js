import { ChannelType } from 'discord.js';
import { db } from '../database/db.js';
import { buildCardPanelPayload } from './cardPanelService.js';

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

  // Build and validate before deleting the currently working panel.
  const panelPayload = buildCardPanelPayload(guildId);

  // Xóa các tin nhắn cũ của bot trong kênh
  const oldMessages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  if (oldMessages) {
    for (const m of oldMessages.filter(m => m.author.id === client.user.id).values()) {
      await m.delete().catch(() => null);
    }
  }

  await channel.send(panelPayload).catch(err => {
    console.error('[AUTO-SETUP-CARD] Failed to send panel:', err.message);
  });

  console.log('[AUTO-SETUP-CARD] Đã thả lại Card Panel vào kênh #' + channel.name);
}

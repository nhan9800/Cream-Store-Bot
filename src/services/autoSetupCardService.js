import { ChannelType } from 'discord.js';
import { db } from '../database/db.js';
import { buildCardPanelPayload } from './cardPanelService.js';
import { isInternationalGuild } from '../utils/locale.js';
import { STORE_SERVICE_FORUM } from '../config/storeServiceForum202611.js';

export async function autoSetupCardChannel(client) {
  // Get the single guild config
  const guildRow = db.prepare('SELECT guild_id FROM guild_settings LIMIT 1').get();
  if (!guildRow) return;

  const guildId = guildRow.guild_id;

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  // Check if channel already exists
  const international = isInternationalGuild(guildId);
  const usesForum = guild.id === STORE_SERVICE_FORUM.guildId;
  let channel = usesForum
    ? await guild.channels.fetch(STORE_SERVICE_FORUM.posts.cards).catch(() => null)
    : guild.channels.cache.find(c => c.name === 'gift-card-exchange' || c.name === '💳・nap-the-tu-dong' || c.name === 'nap-the-tu-dong' || c.name.includes('nap-the'));
  if (usesForum && !channel) throw new Error('STORE_CARD_FORUM_POST_UNAVAILABLE');
  
  if (!channel) {
    // Create channel
    channel = await guild.channels.create({
      name: international ? 'gift-card-exchange' : '💳・nap-the-tu-dong',
      type: ChannelType.GuildText,
      reason: international ? 'Create Cenar Global gift card exchange channel' : 'Tự động tạo kênh Gạch thẻ / Mua thẻ theo yêu cầu',
    }).catch(err => {
      console.error('[AUTO-SETUP-CARD] Failed to create channel:', err.message);
      return null;
    });
  }

  if (!channel) return;

  // Build and validate before deleting the currently working panel.
  const panelPayload = buildCardPanelPayload(guildId);

  // The forum post also contains the discount board. Update only the card
  // panel, preserving every other bot message and all historical replies.
  const oldMessages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  const existing = oldMessages?.find(message => message.author.id === client.user.id
    && /CENAR (?:GLOBAL.*GIFT CARD|CARD) CENTER/.test(JSON.stringify(message.toJSON())));
  await (existing ? existing.edit(panelPayload) : channel.send(panelPayload)).catch(err => {
    console.error('[AUTO-SETUP-CARD] Failed to send panel:', err.message);
  });

  console.log('[AUTO-SETUP-CARD] Đã thả lại Card Panel vào kênh #' + channel.name);
}

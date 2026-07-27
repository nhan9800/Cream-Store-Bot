import { ChannelType } from 'discord.js';
import { db } from '../database/db.js';
import { createGiveaway } from './giveawayService.js';

export async function autoSetupGiveawayChannel(client) {
  const guildRow = db.prepare('SELECT guild_id FROM guild_settings LIMIT 1').get();
  if (!guildRow) return;

  const guildId = guildRow.guild_id;
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return;

  // Check if channel already exists
  let channel = guild.channels.cache.find(c => c.name.includes('giveaway'));
  if (channel) {
    console.log('[AUTO-SETUP-GIVEAWAY] Channel already exists. Skipping creation.');
    return;
  }

  // Create channel
  channel = await guild.channels.create({
    name: '🎁・giveaway',
    type: ChannelType.GuildText,
    reason: 'Tự động tạo kênh Giveaway theo yêu cầu',
  }).catch(err => {
    console.error('[AUTO-SETUP-GIVEAWAY] Failed to create channel:', err.message);
    return null;
  });

  if (!channel) return;

  console.log('[AUTO-SETUP-GIVEAWAY] Created channel, starting the first giveaway...');

  // Start the first giveaway: 24h duration, 3 winners, 50k balance
  const durationMs = 24 * 60 * 60 * 1000; // 24 hours
  const prize = '50.000đ Số Dư Ví (Tặng thẳng vào Ví)';
  const winnersCount = 3;

  try {
    // We pass client.user as the host
    await createGiveaway(client, channel, client.user, prize, winnersCount, durationMs);
    console.log('[AUTO-SETUP-GIVEAWAY] Successfully dropped the first giveaway!');
  } catch (error) {
    console.error('[AUTO-SETUP-GIVEAWAY] Failed to start first giveaway:', error);
  }
}

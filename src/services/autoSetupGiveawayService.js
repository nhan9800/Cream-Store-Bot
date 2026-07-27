import { ChannelType } from 'discord.js';
import { db } from '../database/db.js';
import { createGiveaway } from './giveawayService.js';

export async function autoSetupGiveawayChannel(client) {
  const SERVER1_GUILD_ID = '1282637033340403754';
  
  const guild = await client.guilds.fetch(SERVER1_GUILD_ID).catch(() => null);
  if (!guild) {
    console.log('[AUTO-SETUP-GIVEAWAY] Bot is not in Server 1 (or it is Store 2). Skipping setup.');
    return;
  }

  // Check if channel already exists
  let channel = guild.channels.cache.find(c => c.name === '🎁・su-kien' || c.name === 'su-kien');
  
  if (!channel) {
    // Create channel
    channel = await guild.channels.create({
      name: '🎁・su-kien',
      type: ChannelType.GuildText,
      reason: 'Tự động tạo kênh Sự kiện (Giveaway) theo yêu cầu',
    }).catch(err => {
      console.error('[AUTO-SETUP-GIVEAWAY] Failed to create channel:', err.message);
      return null;
    });
    console.log('[AUTO-SETUP-GIVEAWAY] Created new giveaway/event channel.');
  }

  if (!channel) {
    console.error('[AUTO-SETUP-GIVEAWAY] Could not find or create channel.');
    return;
  }

  // Check if there's already an ACTIVE giveaway in the DB to avoid spamming
  const activeGA = db.prepare(`SELECT message_id FROM giveaways WHERE status = 'ACTIVE' LIMIT 1`).get();
  if (activeGA) {
    console.log('[AUTO-SETUP-GIVEAWAY] An active giveaway already exists. Skipping drop.');
    return;
  }

  console.log('[AUTO-SETUP-GIVEAWAY] Starting the first giveaway...');

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

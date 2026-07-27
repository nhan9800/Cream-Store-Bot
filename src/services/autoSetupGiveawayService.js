import { ChannelType } from 'discord.js';
import { db } from '../database/db.js';
import { createGiveaway } from './giveawayService.js';

export async function autoSetupGiveawayChannel(client) {
  // Loop through all guilds this bot instance is in
  for (const guild of client.guilds.cache.values()) {
    try {
      // Check if channel already exists
      let channel = guild.channels.cache.find(c => c.name === '🎁・su-kien' || c.name === 'su-kien');
      
      if (!channel) {
        // Create channel
        channel = await guild.channels.create({
          name: '🎁・su-kien',
          type: ChannelType.GuildText,
          reason: 'Tự động tạo kênh Sự kiện (Giveaway) theo yêu cầu',
        }).catch(err => {
          console.error(`[AUTO-SETUP-GIVEAWAY] Failed to create channel in guild ${guild.id}:`, err.message);
          return null;
        });
        if (channel) {
          console.log(`[AUTO-SETUP-GIVEAWAY] Created new giveaway/event channel in guild ${guild.id}.`);
        }
      }

      if (!channel) continue;

      // Check if there's already an ACTIVE giveaway in this guild to avoid spamming
      const activeGA = db.prepare(`SELECT message_id FROM giveaways WHERE status = 'ACTIVE' AND guild_id = ? LIMIT 1`).get(guild.id);
      if (activeGA) {
        console.log(`[AUTO-SETUP-GIVEAWAY] An active giveaway already exists in guild ${guild.id}. Skipping drop.`);
        continue;
      }

      console.log(`[AUTO-SETUP-GIVEAWAY] Starting the first giveaway in guild ${guild.id}...`);

      // Start the first giveaway: 24h duration, 3 winners, 50k balance
      const durationMs = 24 * 60 * 60 * 1000; // 24 hours
      const prize = '50.000đ Số Dư Ví (Tặng thẳng vào Ví)';
      const winnersCount = 3;

      // We pass client.user as the host
      await createGiveaway(client, channel, client.user, prize, winnersCount, durationMs);
      console.log(`[AUTO-SETUP-GIVEAWAY] Successfully dropped the first giveaway in guild ${guild.id}!`);
    } catch (error) {
      console.error(`[AUTO-SETUP-GIVEAWAY] Failed to setup giveaway for guild ${guild.id}:`, error);
    }
  }
}

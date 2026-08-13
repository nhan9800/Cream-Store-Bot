import { Client, GatewayIntentBits } from 'discord.js';
import { assertRuntimeConfig, config } from '../src/config.js';
import { initDatabase } from '../src/database/db.js';
import { refreshAdminOrderCenter } from '../src/services/adminOrderCenterService.js';

assertRuntimeConfig();
initDatabase();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

try {
  const ready = new Promise((resolve) => client.once('clientReady', resolve));
  await client.login(config.botToken);
  await ready;
  global.discordClient = client;
  const guild = await client.guilds.fetch(config.storeOneGuildId);
  const result = await refreshAdminOrderCenter(guild, { force: true });
  if (!result) throw new Error('Không thể tạo Trung tâm đơn; hãy kiểm tra guild_settings và quyền bot.');
  console.log(JSON.stringify({
    ok: true,
    guildId: guild.id,
    categoryId: result.category.id,
    channelId: result.channel.id,
    panelMessageId: result.panelMessage.id,
    createdEmojis: result.emojiResult.created,
    existingEmojis: result.emojiResult.existing,
  }, null, 2));
} finally {
  client.destroy();
}

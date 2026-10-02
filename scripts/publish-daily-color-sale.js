import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { initDatabase } from '../src/database/db.js';
import { publishDailyColorSale, publishDailyFlashSale } from '../src/campaigns/dailyColorSale2026.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

initDatabase();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

try {
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(process.env.BOT_TOKEN);
  await ready;
  const board = await publishDailyColorSale(client, { tagEveryone: false, tagMember: false });
  const daily = await publishDailyFlashSale(client, { force: true, tagEveryone: true, tagMember: false });
  console.log(JSON.stringify({ board, daily }, null, 2));
} finally {
  client.destroy();
}

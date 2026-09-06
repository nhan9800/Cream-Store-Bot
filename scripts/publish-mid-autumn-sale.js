import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { initDatabase } from '../src/database/db.js';
import { publishMidAutumnSale } from '../src/campaigns/midAutumnSale2026.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

initDatabase();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

try {
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(process.env.BOT_TOKEN);
  await ready;
  const result = await publishMidAutumnSale(client, { tagEveryone: true });
  console.log(JSON.stringify(result, null, 2));
} finally {
  client.destroy();
}

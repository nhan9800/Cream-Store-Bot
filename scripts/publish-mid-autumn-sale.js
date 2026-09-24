import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { initDatabase } from '../src/database/db.js';
import { publishPubgDramaSale } from '../src/campaigns/pubgDramaSale2026.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

initDatabase();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

try {
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(process.env.BOT_TOKEN);
  await ready;
  // Legacy command name kept for operators who already have it in their runbook.
  // The active promotion is now the PUBG Trend Sale.
  const result = await publishPubgDramaSale(client, { tagEveryone: true, tagMember: true });
  console.log(JSON.stringify(result, null, 2));
} finally {
  client.destroy();
}

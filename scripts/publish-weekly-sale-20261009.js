import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { Client, Events, GatewayIntentBits } from 'discord.js';

// Explicit operator invocation only. This process never starts HTTP, commerce,
// schedulers or the production bootstrap, and uses its own local ledger.
const args = process.argv.slice(2);
const envIndex = args.indexOf('--env-file');
if (!args.includes('--publish') || envIndex < 0 || !args[envIndex + 1]) {
  throw new Error('Use --publish --env-file <protected local env path>.');
}
dotenv.config({ path: path.resolve(args[envIndex + 1]) });
if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');
process.env.ENV_FILE = '.env.manual-weekly-sale-not-present';
process.env.DATABASE_PATH = path.resolve('data/manual-weekly-sale-20261009.sqlite');
const { db, initDatabase } = await import('../src/database/db.js');
const { publishWeeklySale, WEEKLY_SALE_20261009 } = await import('../src/campaigns/weeklySale20261009.js');
const { promotionRebuildInternals } = await import('../src/services/promotionRebuildService.js');
initDatabase();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
global.discordClient = client;
try {
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(process.env.BOT_TOKEN);
  await ready;
  const result = await publishWeeklySale(client, { dbInstance: db });
  const channel = await client.channels.fetch(WEEKLY_SALE_20261009.channelId);
  const messages = await Promise.all(result.boardMessageIds.map((id) => channel.messages.fetch(id)));
  if (messages.length !== 3 || result.dailyMessageId || messages.some((message) =>
    message.mentions.everyone || message.mentions.roles.size || message.mentions.users.size
    || !promotionRebuildInternals.publicMessageText(message).includes(WEEKLY_SALE_20261009.marker))) {
    throw new Error('WEEKLY_SALE_PUBLICATION_VERIFICATION_FAILED');
  }
  const evidence = { ...result, verifiedAt: new Date().toISOString(),
    silent: true, parts: messages.map((message) => ({ id: message.id, url: message.url,
      text: promotionRebuildInternals.publicMessageText(message) })) };
  fs.mkdirSync('scratch', { recursive: true });
  fs.writeFileSync('scratch/weekly-sale-20261009-evidence.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ...result, silent: true, links: messages.map((message) => message.url) }, null, 2));
} finally {
  client.destroy();
  db.close();
  delete global.discordClient;
}

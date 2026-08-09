import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { autoSetupPriceBoard } from '../src/services/autoSetupPriceBoardService.js';

const dryRun = process.argv.includes('--dry');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
global.discordClient = client;

client.once(Events.ClientReady, async () => {
  try {
    if (dryRun) {
      const { buildPriceBoardPayloads } = await import('../src/services/autoSetupPriceBoardService.js');
      const { getGuildConfig } = await import('../src/services/guildConfigService.js');
      const payloads = buildPriceBoardPayloads(process.env.GUILD_ID, getGuildConfig(process.env.GUILD_ID));
      console.log(JSON.stringify({ dryRun: true, guildId: process.env.GUILD_ID, payloads: payloads.length }, null, 2));
      return;
    }

    const results = await autoSetupPriceBoard(client, {
      force: true,
      targetGuildId: process.env.GUILD_ID,
    });
    console.log(JSON.stringify(results, null, 2));
  } catch (error) {
    console.error('[SEND PRICE PANEL]', error);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(process.env.BOT_TOKEN);

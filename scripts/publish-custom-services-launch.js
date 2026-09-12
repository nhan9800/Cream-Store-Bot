import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import { CUSTOM_SERVICES_LAUNCH, publishCustomServicesLaunch } from '../src/campaigns/customServicesLaunch2026.js';

const repost = process.argv.includes('--repost');
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once('clientReady', async () => {
  try {
    const result = await publishCustomServicesLaunch(client, {
      repost,
      tagEveryone: repost,
      tagRoles: repost,
    });
    console.log(JSON.stringify({
      ...result,
      channelId: CUSTOM_SERVICES_LAUNCH.channelId,
      url: `https://discord.com/channels/${CUSTOM_SERVICES_LAUNCH.guildId}/${CUSTOM_SERVICES_LAUNCH.channelId}/${result.messageId}`,
    }, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

await client.login(process.env.BOT_TOKEN);

import dotenv from 'dotenv';
import { Client, Events, GatewayIntentBits } from 'discord.js';

dotenv.config({ path: process.env.ENV_FILE || '.env' });

const [{ initDatabase }, { buildVerificationPanelV2 }] = await Promise.all([
  import('../src/database/db.js'),
  import('../src/services/verificationPanelService.js'),
]);
initDatabase();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, async () => {
  try {
    global.discordClient = client;
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    const channels = await guild.channels.fetch();
    const explicitId = process.env.VERIFY_CHANNEL_ID || process.argv[2];
    const channel = explicitId
      ? channels.get(explicitId)
      : channels.find((item) => item?.isTextBased?.() && (
          item.name.includes('xac-minh') || item.name.includes('xác-minh')
        ));
    if (!channel?.isTextBased?.()) throw new Error('Không tìm thấy kênh xác minh dạng text.');

    const messages = await channel.messages.fetch({ limit: 50 });
    const oldPanels = messages.filter((message) => (
      message.author.id === client.user.id
      && message.components?.some((component) => JSON.stringify(component.toJSON()).includes('oauth:verify:button'))
    ));
    for (const message of oldPanels.values()) await message.delete().catch(() => null);

    const message = await channel.send(buildVerificationPanelV2(guild.id));
    console.log(JSON.stringify({
      guild: guild.name,
      channelId: channel.id,
      channelName: channel.name,
      messageId: message.id,
      replaced: oldPanels.size,
    }, null, 2));
  } finally {
    client.destroy();
  }
});

client.login(process.env.BOT_TOKEN);

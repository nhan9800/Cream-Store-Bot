import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { initDatabase } from '../src/database/db.js';
import {
  PARTNER_NATIONAL_DAY_UPDATE,
  buildPartnerNationalDayAnnouncement,
  isPartnerNationalDayAnnouncement,
} from '../src/campaigns/partnerNationalDayUpdate2026.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

initDatabase();
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

try {
  const ready = new Promise((resolve) => client.once(Events.ClientReady, resolve));
  await client.login(process.env.BOT_TOKEN);
  await ready;
  const guild = client.guilds.cache.get(PARTNER_NATIONAL_DAY_UPDATE.guildId)
    || await client.guilds.fetch(PARTNER_NATIONAL_DAY_UPDATE.guildId);
  await guild.channels.fetch();
  await guild.emojis.fetch().catch(() => null);
  global.discordClient = client;

  const channel = await guild.channels.fetch(PARTNER_NATIONAL_DAY_UPDATE.announcementChannelId);
  if (!channel?.isTextBased() || channel.isThread?.()) throw new Error('Kênh thông báo không hợp lệ.');

  const payload = buildPartnerNationalDayAnnouncement(guild.id);
  const recentMessages = await channel.messages.fetch({ limit: 100 });
  const existing = recentMessages.find((message) => isPartnerNationalDayAnnouncement(message, client.user.id));
  const message = existing ? await existing.edit(payload) : await channel.send(payload);

  console.log(JSON.stringify({
    action: existing ? 'updated' : 'created',
    messageId: message.id,
    channelId: channel.id,
    url: `https://discord.com/channels/${guild.id}/${channel.id}/${message.id}`,
  }, null, 2));
} finally {
  client.destroy();
}

import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import {
  BIRTHDAY_SALE,
  buildBirthdaySaleComponents,
  isBirthdaySaleMessage,
} from '../src/campaigns/birthdaySale2026.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
const bot = await rest.get(Routes.user('@me'));
const messages = await rest.get(Routes.channelMessages(BIRTHDAY_SALE.channelId), {
  query: new URLSearchParams({ limit: '100' }),
});
const existing = messages.find((message) => isBirthdaySaleMessage(message, bot.id));
const body = {
  components: buildBirthdaySaleComponents().map((component) => component.toJSON()),
  flags: BIRTHDAY_SALE.flags,
  allowed_mentions: { parse: [] },
};

const message = existing
  ? await rest.patch(Routes.channelMessage(BIRTHDAY_SALE.channelId, existing.id), { body })
  : await rest.post(Routes.channelMessages(BIRTHDAY_SALE.channelId), { body });

await rest.put(Routes.channelPin(BIRTHDAY_SALE.channelId, message.id)).catch((error) => {
  console.warn(`[BIRTHDAY_SALE] Could not pin ${message.id}: ${error.message}`);
});

console.log(JSON.stringify({
  action: existing ? 'updated' : 'created',
  messageId: message.id,
  url: `https://discord.com/channels/${BIRTHDAY_SALE.guildId}/${BIRTHDAY_SALE.channelId}/${message.id}`,
}, null, 2));


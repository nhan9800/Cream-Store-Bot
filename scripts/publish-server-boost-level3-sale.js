import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import {
  SERVER_BOOST_LEVEL3_SALE,
  buildServerBoostLevel3SalePayload,
  isServerBoostLevel3SaleMessage,
} from '../src/campaigns/serverBoostLevel3Sale.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

const campaign = SERVER_BOOST_LEVEL3_SALE;
const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
const bot = await rest.get(Routes.user('@me'));
const messages = await rest.get(Routes.channelMessages(campaign.channelId), {
  query: new URLSearchParams({ limit: '100' }),
});
const existing = messages.find((message) => isServerBoostLevel3SaleMessage(message, bot.id));
const payload = buildServerBoostLevel3SalePayload();
const body = {
  components: payload.components.map((component) => component.toJSON()),
  flags: payload.flags,
  allowed_mentions: {
    parse: payload.allowedMentions.parse,
    roles: payload.allowedMentions.roles,
    users: payload.allowedMentions.users,
    replied_user: false,
  },
};

const message = existing
  ? await rest.patch(Routes.channelMessage(campaign.channelId, existing.id), { body })
  : await rest.post(Routes.channelMessages(campaign.channelId), { body });

console.log(JSON.stringify({
  action: existing ? 'updated' : 'created',
  messageId: message.id,
  channelId: campaign.channelId,
  url: `https://discord.com/channels/${campaign.guildId}/${campaign.channelId}/${message.id}`,
  mentions: { everyone: true, roles: [campaign.audienceRoleId] },
}, null, 2));

import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { PROMOTION_BOARD } from '../src/campaigns/promotionBoard2026.js';

if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is required.');

const rest = new REST({ version: '10' }).setToken(process.env.BOT_TOKEN);
const bot = await rest.get(Routes.user('@me'));
const channel = await rest.get(Routes.channel(PROMOTION_BOARD.channelId));
if (String(channel.guild_id || '') !== PROMOTION_BOARD.guildId
  || !/khuyến-mãi|khuyen-mai/i.test(String(channel.name || ''))) {
  throw new Error('Kênh đích không khớp cấu hình khuyến mãi; đã dừng để tránh xoá nhầm.');
}

const messages = [];
let before;
while (messages.length < 5000) {
  const page = await rest.get(Routes.channelMessages(channel.id), {
    query: new URLSearchParams({
      limit: '100',
      ...(before ? { before } : {}),
    }),
  });
  if (!page.length) break;
  messages.push(...page);
  before = page.at(-1)?.id;
  if (page.length < 100) break;
}

const botMessages = messages.filter((message) => String(message.author?.id || '') === String(bot.id));
let deleted = 0;
let failed = 0;
for (const message of botMessages) {
  try {
    await rest.delete(Routes.channelMessage(channel.id, message.id), {
      reason: 'Kết thúc toàn bộ chương trình khuyến mãi hiện tại',
    });
    deleted += 1;
  } catch {
    failed += 1;
  }
}

console.log(JSON.stringify({
  channelId: channel.id,
  scanned: messages.length,
  deleted,
  failed,
  preservedNonBotMessages: messages.length - botMessages.length,
}, null, 2));
if (failed > 0) process.exitCode = 1;

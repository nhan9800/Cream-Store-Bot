import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REST } from 'discord.js';
import dotenv from 'dotenv';
import { REVIEW_EMOJI_ASSETS } from '../src/config/reviewEmojiPack20261108.js';

const args = process.argv.slice(2);
const envFile = args[args.indexOf('--env-file') + 1];
if (!args.includes('--env-file') || !envFile) throw Error('Use --env-file <protected path> [--apply].');
const env = dotenv.parse(fs.readFileSync(envFile));
const guildId = '1282637033340403754';
const botId = '1382729296724099132';
const rest = new REST({ version: '10', timeout: 30000, retries: 0 }).setToken(env.BOT_TOKEN);
const me = await rest.get('/users/@me');
if (me.id !== botId) throw Error('Unexpected bot identity.');
const guild = await rest.get(`/guilds/${guildId}`);
if (guild.id !== guildId) throw Error('Unexpected guild.');
const emojis = await rest.get(`/guilds/${guildId}/emojis`);
const result = [];
for (const asset of REVIEW_EMOJI_ASSETS) {
  let emoji = emojis.find(item => item.name === asset.name && item.available !== false);
  let action = emoji ? 'reused' : 'planned';
  if (!emoji && args.includes('--apply')) {
    const file = fileURLToPath(new URL(`../assets/emojis/review26/${asset.file}`, import.meta.url));
    const buffer = fs.readFileSync(file);
    if (buffer.length > 256 * 1024) throw Error(`Oversized asset: ${path.basename(file)}`);
    emoji = await rest.post(`/guilds/${guildId}/emojis`, { body: {
      name: asset.name,
      image: `data:image/${asset.file.endsWith('.gif') ? 'gif' : 'png'};base64,${buffer.toString('base64')}`,
    }, reason: `Review UI refresh · Emoji.gg Basic License · ${asset.source}` });
    action = 'created';
  }
  result.push({ slot: asset.slot, name: asset.name, id: emoji?.id || null, action });
}
console.log(JSON.stringify({ guildId, apply: args.includes('--apply'), emojis: result }, null, 2));

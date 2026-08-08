import 'dotenv/config';
import crypto from 'node:crypto';
import { Client, GatewayIntentBits } from 'discord.js';

const APPLY = process.argv.includes('--apply');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function canonicalFirst(items) {
  return [...items].sort((a, b) => {
    const aCenar = a.name.startsWith('cenar_') ? 0 : 1;
    const bCenar = b.name.startsWith('cenar_') ? 0 : 1;
    return aCenar - bCenar || a.id.localeCompare(b.id);
  })[0];
}

client.once('ready', async () => {
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  await guild.emojis.fetch();
  const groups = new Map();

  for (const emoji of guild.emojis.cache.values()) {
    const url = emoji.imageURL({ extension: emoji.animated ? 'gif' : 'png', size: 128 });
    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    const group = groups.get(hash) || [];
    group.push(emoji);
    groups.set(hash, group);
  }

  const duplicates = [...groups.values()].filter(group => group.length > 1);
  console.log(JSON.stringify({ guild: guild.name, total: guild.emojis.cache.size, duplicateGroups: duplicates.length, apply: APPLY }, null, 2));
  for (const group of duplicates) {
    const keep = canonicalFirst(group);
    const remove = group.filter(emoji => emoji.id !== keep.id && !emoji.managed);
    console.log(`hash duplicate: keep ${keep.name}:${keep.id}; remove ${remove.map(e => `${e.name}:${e.id}`).join(', ') || 'none'}`);
    if (APPLY) {
      for (const emoji of remove) await guild.emojis.delete(emoji.id, 'Remove byte-identical duplicate; keep canonical Cenar asset');
    }
  }

  if (!duplicates.length) console.log('No byte-identical custom emoji found; no deletion was performed.');
  client.destroy();
});

client.login(process.env.BOT_TOKEN);

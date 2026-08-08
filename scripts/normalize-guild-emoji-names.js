import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';

const APPLY = process.argv.includes('--apply');
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function slug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^cenar_/, '')
    .replace(/^cr_/, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'emoji';
}

function canonicalName(emoji, reserved) {
  const base = slug(emoji.name).slice(0, 26);
  let candidate = `cenar_${base}`.slice(0, 32);
  if (!reserved.has(candidate) || reserved.get(candidate) === emoji.id) return candidate;
  const suffix = `_${emoji.id.slice(-4)}`;
  candidate = `cenar_${base.slice(0, 26 - suffix.length)}${suffix}`.slice(0, 32);
  return candidate;
}

client.once(Events.ClientReady, async () => {
  try {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await guild.emojis.fetch();
    const emojis = [...guild.emojis.cache.values()].sort((a, b) => a.id.localeCompare(b.id));
    const reserved = new Map();
    for (const emoji of emojis) {
      if (emoji.managed) continue;
      const existing = String(emoji.name || '').toLowerCase();
      if (existing.startsWith('cenar_')) reserved.set(existing, emoji.id);
    }

    const changes = [];
    for (const emoji of emojis) {
      if (emoji.managed) continue;
      const next = canonicalName(emoji, reserved);
      reserved.set(next, emoji.id);
      if (emoji.name === next) continue;
      changes.push({ id: emoji.id, animated: emoji.animated, from: emoji.name, to: next });
    }

    if (APPLY) {
      for (const item of changes) {
        const emoji = guild.emojis.cache.get(item.id);
        await emoji.setName(item.to, 'Chuẩn hóa tên emoji theo định dạng cenar_<ten>');
      }
    }

    console.log(JSON.stringify({
      guild: guild.name,
      total: emojis.length,
      animated: emojis.filter((emoji) => emoji.animated).length,
      static: emojis.filter((emoji) => !emoji.animated).length,
      managed: emojis.filter((emoji) => emoji.managed).length,
      changes,
      apply: APPLY,
    }, null, 2));
  } finally {
    client.destroy();
  }
});

client.login(process.env.BOT_TOKEN);

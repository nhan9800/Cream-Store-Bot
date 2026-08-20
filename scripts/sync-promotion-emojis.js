import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { pathToFileURL } from 'node:url';
import { PROMOTION_BOARD } from '../src/campaigns/promotionBoard2026.js';

export const PROMOTION_EMOJIS = Object.freeze([
  Object.freeze({
    name: 'cenar_promo_discount',
    url: 'https://cdn3.emoji.gg/emojis/98685-discount.png',
    source: 'https://emoji.gg/emoji/98685-discount',
  }),
  Object.freeze({
    name: 'cenar_promo_nitro',
    url: 'https://cdn3.emoji.gg/emojis/679771-nitrobooster.gif',
    source: 'https://emoji.gg/emoji/679771-nitrobooster',
  }),
  Object.freeze({
    name: 'cenar_promo_boost',
    url: 'https://cdn3.emoji.gg/emojis/44336-serverboostings.gif',
    source: 'https://emoji.gg/emoji/44336-serverboostings',
  }),
  Object.freeze({
    name: 'cenar_promo_netflix',
    url: 'https://cdn3.emoji.gg/emojis/724632-watchingnetflix.gif',
    source: 'https://emoji.gg/emoji/724632-watchingnetflix',
  }),
  Object.freeze({
    name: 'cenar_promo_decor',
    url: 'https://cdn3.emoji.gg/emojis/843879-makeupeyeshadowpalette.gif',
    source: 'https://emoji.gg/emoji/843879-makeupeyeshadowpalette',
  }),
  Object.freeze({
    name: 'cenar_promo_legend',
    url: 'https://cdn3.emoji.gg/emojis/493187-gifting-legend.png',
    source: 'https://emoji.gg/emoji/493187-gifting-legend',
  }),
]);

function asDiscordEmoji(emoji) {
  return emoji.animated
    ? `<a:${emoji.name}:${emoji.id}>`
    : `<:${emoji.name}:${emoji.id}>`;
}

async function fetchEmojiBuffer(asset) {
  const response = await fetch(asset.url, {
    headers: { 'User-Agent': 'CenarStoreBot/1.11 emoji-sync' },
  });
  if (!response.ok) {
    throw new Error(`Không tải được ${asset.name}: HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!/^image\/(png|gif)(?:;|$)/i.test(contentType)) {
    throw new Error(`${asset.name} trả về content-type không hợp lệ: ${contentType || 'trống'}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > 256 * 1024) {
    throw new Error(`${asset.name} có kích thước ${buffer.length} bytes, vượt giới hạn emoji Discord`);
  }
  return buffer;
}

export async function syncPromotionEmojis(guild) {
  await guild.emojis.fetch();
  const synced = [];

  for (const asset of PROMOTION_EMOJIS) {
    let emoji = guild.emojis.cache.find((item) => item.name === asset.name);
    let status = 'reused';
    if (!emoji) {
      const attachment = await fetchEmojiBuffer(asset);
      emoji = await guild.emojis.create({
        attachment,
        name: asset.name,
        reason: `Cenar promotion board · Basic License · ${asset.source}`,
      });
      status = 'created';
    }
    synced.push({ slot: asset.name.replace('cenar_', ''), status, emoji: asDiscordEmoji(emoji) });
  }

  return synced;
}

async function main() {
  const token = process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
  if (!token) throw new Error('Thiếu DISCORD_TOKEN/BOT_TOKEN trong môi trường chạy.');

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);
  if (!client.isReady()) await new Promise((resolve) => client.once(Events.ClientReady, resolve));

  try {
    const guild = await client.guilds.fetch(PROMOTION_BOARD.guildId);
    const synced = await syncPromotionEmojis(guild);
    for (const item of synced) console.log(`${item.status.padEnd(7)} ${item.slot.padEnd(16)} ${item.emoji}`);
  } finally {
    client.destroy();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

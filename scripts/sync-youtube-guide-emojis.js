import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { pathToFileURL } from 'node:url';
import { YOUTUBE_JOIN_FAM_GUIDE } from '../src/campaigns/youtubeJoinFamGuide2026.js';

// Emoji custom cho bảng hướng dẫn Join Fam YouTube · Emoji.gg Basic License.
// Tên emoji trong server phải khớp một trong các tên của trường `name`
// (autoSyncGuildEmojis sẽ tự map vào slot guide_* tương ứng trong database).
export const YOUTUBE_GUIDE_EMOJIS = Object.freeze([
  Object.freeze({
    name: 'cenar_yt_logo',
    url: 'https://cdn3.emoji.gg/emojis/5429-hd-youtube-logo.png',
    source: 'https://emoji.gg/emoji/5429-hd-youtube-logo',
  }),
  Object.freeze({
    name: 'cenar_yt_play',
    url: 'https://cdn3.emoji.gg/emojis/6226-grey-google-play-store-logo.png',
    source: 'https://emoji.gg/emoji/6226-grey-google-play-store-logo',
  }),
  Object.freeze({
    name: 'cenar_yt_wallet',
    url: 'https://cdn3.emoji.gg/emojis/9961-money-wallet.png',
    source: 'https://emoji.gg/emoji/9961-money-wallet',
  }),
  Object.freeze({
    name: 'cenar_yt_family',
    url: 'https://cdn3.emoji.gg/emojis/24024-family.png',
    source: 'https://emoji.gg/emoji/24024-family',
  }),
  Object.freeze({
    name: 'cenar_yt_warning',
    url: 'https://cdn3.emoji.gg/emojis/2109-warning.png',
    source: 'https://emoji.gg/emoji/2109-warning',
  }),
  Object.freeze({
    name: 'cenar_yt_card',
    url: 'https://cdn3.emoji.gg/emojis/91003-creditcard.png',
    source: 'https://emoji.gg/emoji/91003-creditcard',
  }),
]);

function asDiscordEmoji(emoji) {
  return emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`;
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

export async function syncYoutubeGuideEmojis(guild) {
  await guild.emojis.fetch();
  const synced = [];
  for (const asset of YOUTUBE_GUIDE_EMOJIS) {
    let emoji = guild.emojis.cache.find((item) => item.name === asset.name);
    let status = 'reused';
    if (!emoji) {
      const attachment = await fetchEmojiBuffer(asset);
      emoji = await guild.emojis.create({
        attachment,
        name: asset.name,
        reason: `Cenar YouTube join-fam guide · Basic License · ${asset.source}`,
      });
      status = 'created';
    }
    synced.push({ name: asset.name, status, emoji: asDiscordEmoji(emoji) });
  }
  return synced;
}

async function main() {
  const token = process.env.DISCORD_TOKEN || process.env.BOT_TOKEN;
  if (!token) {
    throw new Error('Thiếu DISCORD_TOKEN/BOT_TOKEN trong môi trường chạy.');
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(token);
  if (!client.isReady()) {
    await new Promise((resolve) => client.once(Events.ClientReady, resolve));
  }

  try {
    const guild = await client.guilds.fetch(YOUTUBE_JOIN_FAM_GUIDE.guildId);
    const synced = await syncYoutubeGuideEmojis(guild);
    for (const item of synced) {
      console.log(`${item.status.padEnd(7)} ${item.name.padEnd(18)} ${item.emoji}`);
    }
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

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import { ChannelType, REST, Routes } from 'discord.js';
import { STORE_ONE_GUILD_ID } from '../src/utils/locale.js';
import {
  buildLienQuanAccountCard, buildLienQuanGuide, lienQuanImageName, lienQuanImageUrl, readLienQuanImage, LIEN_QUAN_ACCOUNTS,
  LIEN_QUAN_ATTACHMENT_LIMIT, LIEN_QUAN_BUTTON_PREFIX, LIEN_QUAN_CATEGORY_ID,
  LIEN_QUAN_CHANNEL, LIEN_QUAN_CHANNEL_NAMES, LIEN_QUAN_TOPIC,
} from '../src/utils/lienQuanCatalog.js';
import { storefrontComponentEmoji } from '../src/utils/storefrontEmoji.js';

const BOT_ID = '1382729296724099132';
const SALES_CHANNEL_ID = '1515008584549797979';
const hash = buffer => createHash('sha256').update(buffer).digest('hex');
const flatten = components => (components || []).flatMap(component => [component, ...flatten(component.components)]);
const permissions = channel => [...(channel.permission_overwrites || [])]
  .sort((left, right) => left.id.localeCompare(right.id));

async function publish() {
  const { values } = parseArgs({ options: {
    publish: { type: 'boolean' }, 'env-file': { type: 'string' }, images: { type: 'string' },
  } });
  assert(values.publish && values['env-file'] && values.images, 'Use --publish --env-file PATH --images DIRECTORY.');
  const images = await Promise.all(LIEN_QUAN_ACCOUNTS.map(async account => {
    const name = lienQuanImageName(account);
    const data = await readFile(join(values.images, name));
    assert(data.length <= LIEN_QUAN_ATTACHMENT_LIMIT && data[0] === 0xff && data[1] === 0xd8, `Invalid JPEG: ${name}`);
    return { account, name, data, sha256: hash(data) };
  }));
  const { BOT_TOKEN: token } = dotenv.parse(await readFile(values['env-file']));
  const rest = new REST({ version: '10', timeout: 20_000, retries: 0 }).setToken(token);
  const me = await rest.get(Routes.user('@me'));
  assert.equal(me.id, BOT_ID);
  const [channels, icons] = await Promise.all([
    rest.get(Routes.guildChannels(STORE_ONE_GUILD_ID)),
    rest.get(Routes.applicationEmojis(BOT_ID)),
  ]);
  assert(channels.some(c => c.id === LIEN_QUAN_CATEGORY_ID && c.type === ChannelType.GuildCategory));
  const reference = channels.find(c => c.id === SALES_CHANNEL_ID && c.parent_id === LIEN_QUAN_CATEGORY_ID);
  assert(reference?.permission_overwrites?.length);
  const matches = channels.filter(c => LIEN_QUAN_CHANNEL_NAMES.includes(c.name) || c.topic === LIEN_QUAN_TOPIC);
  assert(matches.length <= 1, 'Duplicate catalog channels need review.');
  const channel = matches[0] ?? await rest.post(Routes.guildChannels(STORE_ONE_GUILD_ID), { body: {
    name: LIEN_QUAN_CHANNEL, type: ChannelType.GuildText, topic: LIEN_QUAN_TOPIC, parent_id: LIEN_QUAN_CATEGORY_ID,
    permission_overwrites: reference.permission_overwrites,
  }, reason: 'Cenar Store Liên Quân quote catalog' });
  assert(LIEN_QUAN_CHANNEL_NAMES.includes(channel.name));
  assert.equal(channel.topic, LIEN_QUAN_TOPIC);
  assert.equal(channel.parent_id, LIEN_QUAN_CATEGORY_ID);
  assert.deepEqual(permissions(channel), permissions(reference));

  assert(icons.items.some(emoji => emoji.id === storefrontComponentEmoji('cart').id && emoji.available !== false));
  const route = Routes.channelMessages(channel.id);
  const options = { query: new URLSearchParams({ limit: '100' }) };
  const existing = await rest.get(route, options);
  assert(existing.length < 100, 'Readback window must cover the whole catalog.');
  function findOwned(messages, predicate) {
    const matching = messages.filter(message => message.author.id === BOT_ID && predicate(flatten(message.components)));
    assert(matching.length <= 1, 'Duplicate card requires review.');
    return matching[0];
  }
  const guideSelector = parts => parts.some(c => c.content?.includes('## ') && c.content.includes('Acc Liên Quân Mobile'));
  const guide = findOwned(existing, guideSelector) ?? await rest.post(route, {
    body: { ...buildLienQuanGuide(), nonce: 'cenar-lienquan-guide-v1', enforce_nonce: true },
  });
  for (const { account, name, data } of images) {
    const selector = parts => parts.some(c => c.custom_id === LIEN_QUAN_BUTTON_PREFIX + account.code);
    if (!findOwned(existing, selector)) await rest.post(route, {
      body: { ...buildLienQuanAccountCard(account), nonce: `cenar-lienquan-${account.code}-v1`, enforce_nonce: true,
        attachments: [{ id: 0, filename: name, description: `Bộ tướng và trang phục của ${account.code}` }] },
      files: [{ name, data, contentType: 'image/jpeg' }],
    });
  }
  if (!guide.pinned) await rest.put(Routes.channelMessagesPin(channel.id, guide.id));
  const posted = await rest.get(route, options);
  assert(findOwned(posted, guideSelector)?.pinned, 'Catalog guide is not pinned.');
  const verified = await Promise.all(images.map(async ({ account, name, sha256 }) => {
    const message = findOwned(posted, parts => parts.some(c => c.custom_id === LIEN_QUAN_BUTTON_PREFIX + account.code));
    assert(message && !message.mention_everyone);
    const url = lienQuanImageUrl(message.components, channel.id, account);
    assert(url, `No gallery photo found for ${account.code}`);
    assert.equal(hash(await readLienQuanImage(url)), sha256);
    return { code: account.code, messageId: message.id, image: name, sha256 };
  }));
  console.log(JSON.stringify({ guild: STORE_ONE_GUILD_ID, channel: channel.id, guide: guide.id,
    permissionsMatchSalesChannel: true, cards: verified }, null, 2));
}

publish().catch(error => {
  console.error('[LIEN_QUAN_CATALOG]', error.code || error.name, error.message);
  process.exitCode = 1;
});

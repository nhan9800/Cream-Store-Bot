import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { REST, Routes } from 'discord.js';
import { WOMENS_DAY as C, WOMENS_DAY_EMOJIS, WOMENS_DAY_GROUPS,
  buildWomensDayCampaign, campaignText, campaignMessageUrl, validateWomensDayPayload } from '../src/campaigns/womensDay20261020.js';

// REST only: no Gateway login, timers, commerce database, or runtime bootstrap.
const args = process.argv.slice(2);
const envIndex = args.indexOf('--env-file');
const publishing = args.includes('--publish');
if (envIndex < 0 || !args[envIndex + 1] || (!publishing && !args.includes('--preview'))) {
  throw new Error('Use --preview|--publish --env-file <protected local env path>.');
}
const env = dotenv.parse(fs.readFileSync(path.resolve(args[envIndex + 1])));
if (!env.BOT_TOKEN) throw new Error('CAMPAIGN_BOT_TOKEN_MISSING');
const rest = new REST({ version: '10', timeout: 15000, retries: 0 }).setToken(env.BOT_TOKEN);
const output = path.resolve('scratch/womens-day-20261020');
const recovery = path.resolve('../recovery-backups/womens-day-20261020');
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(recovery, { recursive: true });
const write = (name, data, dir = output) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function history(channelId) {
  const found = [], seen = new Set();
  let before;
  for (let page = 0; page < 200; page++) {
    const query = new URLSearchParams({ limit: '100', ...(before ? { before } : {}) });
    const rows = await rest.get(Routes.channelMessages(channelId), { query });
    for (const row of rows) {
      if (seen.has(row.id)) throw new Error('CAMPAIGN_HISTORY_STALLED');
      seen.add(row.id); found.push(row);
    }
    if (rows.length < 100) return found;
    before = rows.at(-1).id;
  }
  throw new Error('CAMPAIGN_HISTORY_BOUND_EXCEEDED');
}
function publicSnapshot(message) {
  return { id: message.id, channel_id: message.channel_id, author: { id: message.author.id },
    content: message.content, components: message.components, embeds: message.embeds,
    flags: message.flags, timestamp: message.timestamp, edited_timestamp: message.edited_timestamp };
}
function assertTarget(message, channelId, marker) {
  if (message.author?.id !== C.botId || message.channel_id !== channelId || !campaignText(message).includes(marker)) {
    throw new Error('CAMPAIGN_MESSAGE_TARGET_MISMATCH');
  }
}
function textParts(message) {
  const texts = [];
  const visit = (c) => { if (typeof c.content === 'string') texts.push(c.content); for (const child of c.components || []) visit(child); };
  (message.components || []).forEach(visit);
  return texts;
}
function verifyPublished(message, payload) {
  assertTarget(message, message.channel_id, C.marker);
  if (message.mention_everyone || message.mentions?.length || message.mention_roles?.length
    || JSON.stringify(textParts(message)) !== JSON.stringify(textParts(payload))) {
    throw new Error('CAMPAIGN_MESSAGE_VERIFICATION_FAILED');
  }
}
async function editIfNeeded(channelId, message, payload) {
  const same = JSON.stringify(textParts(message)) === JSON.stringify(textParts(payload))
    && JSON.stringify(message.components) === JSON.stringify(payload.components);
  // Discord adds component ids, so a repeat PATCH is harmless; it never sends
  // another message or pings members. A marker reconciles interrupted edits.
  if (same) return message;
  return rest.patch(Routes.channelMessage(channelId, message.id), { body: { ...payload, content: '', embeds: [] } });
}

const lockPath = path.join(output, 'publication.lock');
let lock;
try {
  lock = fs.openSync(lockPath, 'wx');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  if (publishing && today !== '2026-10-20') throw new Error('CAMPAIGN_PUBLICATION_DATE_MISMATCH');
  const identity = await rest.get(Routes.user('@me'));
  if (identity.id !== C.botId) throw new Error('CAMPAIGN_BOT_ID_MISMATCH');
  const targets = [
    [C.promotionChannelId, /khuyến-mãi|khuyen-mai/iu],
    [C.announcementChannelId, /thông-báo|thong-bao/iu],
    [C.supportChannelId, /hỗ-trợ|ho-tro/iu],
  ];
  for (const [id, name] of targets) {
    const channel = await rest.get(Routes.channel(id));
    if (channel.guild_id !== C.guildId || !name.test(channel.name) || ![0, 5].includes(channel.type)) {
      throw new Error('CAMPAIGN_CHANNEL_MISMATCH');
    }
  }
  const originals = [];
  for (const id of [...C.boardIds, C.noticeId]) originals.push(await rest.get(Routes.channelMessage(C.promotionChannelId, id)));
  originals.slice(0, 3).forEach((m) => {
    const marker = campaignText(m).includes(C.marker) ? C.marker : 'CENAR-WEEKLY-DROP-2026-10-09';
    assertTarget(m, C.promotionChannelId, marker);
  });
  assertTarget(originals[3], C.promotionChannelId,
    campaignText(originals[3]).includes(C.marker) ? C.marker : 'BẢNG SALE TUẦN MỚI ĐÃ LÊN');
  const announcements = await history(C.announcementChannelId);
  const existingGreetings = announcements.filter((m) => m.author?.id === C.botId && campaignText(m).includes(C.marker));
  if (existingGreetings.length > 1) throw new Error('CAMPAIGN_DUPLICATE_GREETING');
  const inventory = await rest.get(Routes.guildEmojis(C.guildId));
  const appInventory = await rest.get(Routes.applicationEmojis(C.botId));
  const emojis = Object.fromEntries(inventory.map((e) => [e.name, e]));
  const created = [];
  for (const asset of WOMENS_DAY_EMOJIS) {
    let emoji = appInventory.items.find((e) => e.name === asset.name);
    if (!emoji && publishing) {
      const bytes = fs.readFileSync(asset.path);
      if (bytes.length === 0 || bytes.length > 256 * 1024) throw new Error('CAMPAIGN_EMOJI_FILE_INVALID');
      const mime = asset.file.endsWith('.gif') ? 'image/gif' : 'image/png';
      emoji = await rest.post(Routes.applicationEmojis(C.botId), {
        body: { name: asset.name, image: `data:${mime};base64,${bytes.toString('base64')}` },
      });
      created.push(emoji.id);
      await sleep(300);
    }
    // Preview placeholders are only for local text review and cannot publish.
    emojis[asset.name] = emoji || { id: String(1550000000000000000n + BigInt(Object.keys(emojis).length)), name: asset.name,
      animated: asset.file.endsWith('.gif') };
  }
  const prepared = buildWomensDayCampaign({ emojis });
  const payloads = [...prepared.boards, prepared.notice, prepared.greeting];
  const limits = payloads.map(validateWomensDayPayload);
  if (prepared.offerCount !== 29) throw new Error('CAMPAIGN_PRICE_COUNT_MISMATCH');
  write('prepared.json', { preview: !publishing, limits, ...prepared });
  if (!publishing) {
    console.log(JSON.stringify({ mode: 'preview', offerCount: prepared.offerCount, limits,
      existingGreeting: existingGreetings[0]?.id || null, output }, null, 2));
  } else {
    const snapshotPath = path.join(recovery, 'before.json');
    if (!fs.existsSync(snapshotPath)) write('before.json', { capturedAt: new Date().toISOString(),
      messages: originals.map(publicSnapshot) }, recovery);
    // Save public intent before writing. Never open or modify the live SQLite.
    write('intent.json', { marker: C.marker, offerCount: prepared.offerCount,
      groups: WOMENS_DAY_GROUPS, limits }, recovery);
    for (let i = 0; i < C.boardIds.length; i++) {
      const edited = await editIfNeeded(C.promotionChannelId, originals[i], prepared.boards[i]);
      verifyPublished(edited, prepared.boards[i]);
    }
    const notice = await editIfNeeded(C.promotionChannelId, originals[3], prepared.notice);
    verifyPublished(notice, prepared.notice);
    const greeting = existingGreetings[0]
      ? await editIfNeeded(C.announcementChannelId, existingGreetings[0], prepared.greeting)
      : await rest.post(Routes.channelMessages(C.announcementChannelId), { body: {
        ...prepared.greeting, nonce: 'cenar-2010-20261020', enforce_nonce: true,
      } });
    verifyPublished(greeting, prepared.greeting);
    const verifiedEmojis = await rest.get(Routes.applicationEmojis(C.botId));
    const allLiveEmojiIds = new Set([...inventory, ...verifiedEmojis.items].map((e) => e.id));
    const verified = [];
    for (const [index, id] of [...C.boardIds, C.noticeId, greeting.id].entries()) {
      const channelId = index === 4 ? C.announcementChannelId : C.promotionChannelId;
      const m = await rest.get(Routes.channelMessage(channelId, id));
      verifyPublished(m, payloads[index]);
      for (const token of campaignText(m).matchAll(/<a?:\w+:(\d+)>/g)) {
        if (!allLiveEmojiIds.has(token[1])) throw new Error('CAMPAIGN_EMOJI_NOT_LIVE');
      }
      verified.push({ id, channelId, url: campaignMessageUrl(channelId, id), text: campaignText(m), silent: true });
    }
    const result = { status: 'DONE', marker: C.marker, offerCount: 29,
      verifiedAt: new Date().toISOString(), createdEmojis: created,
      action: 'updated 3 sale panels and 1 notice in place; one greeting', messages: verified };
    write('publication.json', result); write('publication.json', result, recovery);
    console.log(JSON.stringify({ ...result, messages: result.messages.map(({ text, ...m }) => m) }, null, 2));
  }
} catch (error) {
  // Do not print REST request bodies, credentials, or upstream payloads.
  console.error(JSON.stringify({ status: 'FAILED', code: error.code || error.status || null,
    reason: /^CAMPAIGN_[A-Z_:]+$/.test(error.message || '') ? error.message : 'CAMPAIGN_OPERATOR_FAILED' }));
  process.exitCode = 1;
} finally {
  if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

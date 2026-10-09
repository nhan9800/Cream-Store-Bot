import { MessageFlags, PermissionFlagsBits } from 'discord.js';

// This operation replaces public promotions only. It must never call the
// legacy clearPromotionChannel(), which also restores commerce prices.
export const PROMOTION_REBUILD_TARGET = Object.freeze({
  guildId: '1282637033340403754',
  channelId: '1515008584549797979',
});

const SILENT_MENTIONS = Object.freeze({ parse: [], users: [], roles: [], repliedUser: false });
const SALE_MARKERS = [
  'CENAR-STORY-FLASH-SALE', 'CENAR-DAILY-FLASH-SALE',
  'CENAR-DAILY-COLOR-SALE', 'CENAR-PUBG-TREND-SALE',
  'CENAR-NATIONAL-DAY-SALE', 'CENAR-MID-AUTUMN-SALE',
  'CENAR BIRTHDAY SALE', 'CENAR SERVER BOOST LEVEL 3',
  'CENAR-PROMOTION-CUTOVER:',
];

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function publicMessageText(message) {
  const json = message?.toJSON?.() || message || {};
  const parts = [json.content || ''];
  const visit = (component) => {
    if (typeof component.content === 'string') parts.push(component.content);
    for (const child of component.components || []) visit(child);
  };
  for (const component of json.components || []) visit(component);
  for (const embed of json.embeds || []) {
    parts.push(embed.title || '', embed.description || '', embed.footer?.text || '');
    for (const field of embed.fields || []) parts.push(field.name || '', field.value || '');
  }
  return parts.filter(Boolean).join('\n');
}

export function isPromotionSaleMessage(message, botId) {
  if (!botId || String(message?.author?.id || '') !== String(botId)) return false;
  const text = publicMessageText(message);
  if (SALE_MARKERS.some((marker) => text.includes(marker))) return true;
  // Old /sale panels did not have a marker. Require an explicit promotion
  // heading rather than a incidental mention of sale in a different notice.
  return text.split('\n').some((line) => {
    let heading = line.trim().replace(/^#{1,3}\s*/, '').replace(/^[*_~`]+/, '');
    // Historical posts used both guild emoji and ordinary Unicode emoji.
    // Remove only decorative prefixes, retaining the actual title words.
    let previous;
    do {
      previous = heading;
      heading = heading.replace(/^(?:<a?:\w+:\d+>|\p{Extended_Pictographic}[\uFE0F\u200D]*)\s*/u, '')
        .replace(/^[*_~`]+/, '').trim();
    } while (heading !== previous);
    return /^(?:CENAR\s*(?:STUDIO)?\s*[·—-]\s*)?(?:FLASH\s*SALE|SIÊU\s*SALE|BẢNG\s*GIÁ\s*(?:SALE|KHUYẾN\s*MÃI))/iu.test(heading)
      || /^(?:Cream|Cenar)\s*Store\s*[·—-]\s*Khuyến\s*Mãi/iu.test(heading)
      || /^(?:CENAR\s+BIRTHDAY\s+SALE|ĐẠI\s+TIỆC\s+SALE\s+QUỐC\s+KHÁNH|SALE\s+2\/9\s*[·—-]|HỘI\s+TRĂNG\s+CENAR|PUBG\s+(?:TREND|MEME)\s+SALE|CENAR\s+STUDIO\s*[·—-]\s*SALE\s+09:00)/iu.test(heading);
  });
}

function ensureStore(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS promotion_rebuild_jobs (
    revision TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    status TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    board_ids_json TEXT NOT NULL DEFAULT '[]',
    daily_message_id TEXT,
    deleted_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_error TEXT
  )`);
}

async function databaseFor(database) {
  return database || (await import('../database/db.js')).db;
}

function loadJob(database, revision) {
  return database.prepare('SELECT * FROM promotion_rebuild_jobs WHERE revision = ?').get(revision);
}

function updateJob(database, revision, values) {
  const allowed = new Set(['status', 'snapshot_json', 'board_ids_json', 'daily_message_id', 'deleted_ids_json', 'last_error']);
  const entries = Object.entries(values).filter(([key]) => allowed.has(key));
  if (!entries.length) return;
  database.prepare(`UPDATE promotion_rebuild_jobs SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE revision = ?`)
    .run(...entries.map(([, value]) => value), new Date().toISOString(), revision);
}

export async function getPromotionRebuildStatus(revision, { dbInstance } = {}) {
  const database = await databaseFor(dbInstance);
  const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'promotion_rebuild_jobs'").get();
  if (!exists) return { status: 'not_started', revision };
  const job = loadJob(database, revision);
  if (!job) return { status: 'not_started', revision };
  return jobResult(job);
}

function jobResult(job) {
  const snapshot = JSON.parse(job.snapshot_json);
  return {
    revision: job.revision, status: job.status,
    guildId: job.guild_id, channelId: job.channel_id,
    archivedSaleMessages: snapshot.messages.length,
    deletedSaleMessages: JSON.parse(job.deleted_ids_json).length,
    boardMessageIds: JSON.parse(job.board_ids_json), dailyMessageId: job.daily_message_id,
    createdAt: job.created_at, updatedAt: job.updated_at, lastError: job.last_error,
  };
}

async function fetchHistory(channel, maxMessages = 20000) {
  const messages = [];
  const seen = new Set();
  let before;
  while (true) {
    const page = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    const values = [...page.values()];
    if (!values.length) return messages;
    const fresh = values.filter((message) => !seen.has(String(message.id)));
    if (!fresh.length) throw fail('PROMOTION_HISTORY_CURSOR_STALLED');
    for (const message of fresh) {
      seen.add(String(message.id));
      messages.push(message);
    }
    if (messages.length > maxMessages) throw fail('PROMOTION_HISTORY_LIMIT_EXCEEDED');
    before = values.at(-1).id;
    if (values.length < 100) return messages;
  }
}

function payloadWithMarker(payload, marker) {
  const components = (payload.components || []).map((component) => component.toJSON?.() || component);
  const result = JSON.parse(JSON.stringify({
    components, flags: Number(payload.flags?.bitfield ?? payload.flags ?? MessageFlags.IsComponentsV2),
    allowedMentions: SILENT_MENTIONS,
  }));
  // Append an operation marker to the container so a process crash between
  // Discord accepting a send and SQLite recording its ID can be recovered.
  if (result.components[0]?.type !== 17) throw fail('PROMOTION_PAYLOAD_CONTAINER_REQUIRED');
  result.components[0].components.push({ type: 10, content: `-# ${marker}` });
  let count = 0;
  let textLength = 0;
  const visit = (component) => {
    count += 1;
    if (typeof component.content === 'string') {
      textLength += component.content.length;
      if (component.content.length > 4000) throw fail('PROMOTION_PAYLOAD_TEXT_LIMIT');
    }
    for (const child of component.components || []) visit(child);
  };
  result.components.forEach(visit);
  if (count > 40 || textLength > 4000) throw fail('PROMOTION_PAYLOAD_DISCORD_LIMIT');
  if (!(result.flags & Number(MessageFlags.IsComponentsV2))) throw fail('PROMOTION_PAYLOAD_V2_REQUIRED');
  // Keep upload inputs in their original form (a Buffer or file stream is
  // not a serializable Discord component). The campaign's attachment://
  // media references must be uploaded together with the first board part.
  if (payload.files) result.files = payload.files;
  if (payload.attachments) result.attachments = payload.attachments;
  return result;
}

async function resolveTarget(client) {
  if (!client?.user?.id || !client?.isReady?.()) throw fail('DISCORD_NOT_READY');
  const guild = client.guilds.cache.get(PROMOTION_REBUILD_TARGET.guildId)
    || await client.guilds.fetch(PROMOTION_REBUILD_TARGET.guildId);
  if (String(guild?.id) !== PROMOTION_REBUILD_TARGET.guildId) throw fail('PROMOTION_GUILD_MISMATCH');
  const channel = await guild.channels.fetch(PROMOTION_REBUILD_TARGET.channelId);
  if (String(channel?.id) !== PROMOTION_REBUILD_TARGET.channelId
    || !channel.isTextBased?.() || channel.isThread?.() || !channel.messages
    || !/khuyến-mãi|khuyen-mai/i.test(channel.name || '')) throw fail('PROMOTION_CHANNEL_MISMATCH');
  const member = guild.members.me || await guild.members.fetchMe();
  if (!channel.permissionsFor(member)?.has([
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages,
    PermissionFlagsBits.ManageGuildExpressions,
  ])) throw fail('PROMOTION_REBUILD_PERMISSIONS');
  return { guild, channel };
}

let activeRebuild = null;

export async function waitForPromotionRebuild() {
  if (activeRebuild) await activeRebuild.promise;
}

async function rebuildInternal(client, { revision, prepare, dbInstance, now = new Date() }) {
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(String(revision || ''))) throw fail('PROMOTION_REVISION_INVALID');
  if (typeof prepare !== 'function') throw fail('PROMOTION_PREPARATION_REQUIRED');
  const database = await databaseFor(dbInstance);
  ensureStore(database);
  let job = loadJob(database, revision);
  if (job?.status === 'DONE') return jobResult(job);
  const { guild, channel } = await resolveTarget(client);
  let history = await fetchHistory(channel);
  const oldSaleMessages = history.filter((message) => isPromotionSaleMessage(message, client.user.id));
  const snapshot = {
    capturedAt: now.toISOString(),
    messages: oldSaleMessages.map((message) => ({ id: String(message.id), text: publicMessageText(message) })),
  };
  // Preparation may add new campaign emoji, but must not remove old artwork
  // or messages. The caller supplies an original, already-reviewed price set.
  const prepared = await prepare(guild);
  const boardOnly = prepared?.boardOnly === true;
  if (!prepared?.boardPayloads?.length || (!boardOnly && typeof prepared.buildDailyPayload !== 'function')) {
    throw fail('PROMOTION_PREPARATION_INVALID');
  }
  const prefix = `CENAR-PROMOTION-CUTOVER:${revision}:`;
  const boardPayloads = prepared.boardPayloads.map((payload, index) => payloadWithMarker(payload, `${prefix}PART-${index + 1}`));
  if (!boardOnly) payloadWithMarker(prepared.buildDailyPayload('100000000000000001'), `${prefix}DAILY`);
  if (!job) {
    snapshot.saleData = prepared.saleData || [];
    snapshot.emojiNames = prepared.emojiNames || [];
    const timestamp = now.toISOString();
    database.prepare(`INSERT INTO promotion_rebuild_jobs
      (revision, guild_id, channel_id, status, snapshot_json, created_at, updated_at)
      VALUES (?, ?, ?, 'ARCHIVED', ?, ?, ?)`)
      .run(revision, guild.id, channel.id, JSON.stringify(snapshot), timestamp, timestamp);
    job = loadJob(database, revision);
  }
  try {
    const ids = JSON.parse(job.board_ids_json).slice(0, boardPayloads.length);
    updateJob(database, revision, { status: 'PUBLISHING', last_error: null });
    // Fetch again after preparation. No mutation has occurred yet, and another
    // Discord request may have completed immediately before this job acquired
    // the application lock.
    history = await fetchHistory(channel);
    for (let index = 0; index < boardPayloads.length; index += 1) {
      const marker = `${prefix}PART-${index + 1}`;
      const existing = history.find((message) => String(message.author?.id) === String(client.user.id)
        && (String(message.id) === ids[index] || publicMessageText(message).includes(marker)));
      const message = existing ? await existing.edit(boardPayloads[index]) : await channel.send(boardPayloads[index]);
      ids[index] = String(message.id);
      updateJob(database, revision, { board_ids_json: JSON.stringify(ids) });
    }
    let dailyMessageId = null;
    if (!boardOnly) {
      const dailyPayload = payloadWithMarker(prepared.buildDailyPayload(ids[0]), `${prefix}DAILY`);
      const oldDaily = history.find((message) => String(message.author?.id) === String(client.user.id)
        && (String(message.id) === job.daily_message_id || publicMessageText(message).includes(`${prefix}DAILY`)));
      const daily = oldDaily ? await oldDaily.edit(dailyPayload) : await channel.send(dailyPayload);
      dailyMessageId = String(daily.id);
    }
    updateJob(database, revision, { daily_message_id: dailyMessageId, status: 'CLEANUP' });
    const keep = new Set([...ids, ...(dailyMessageId ? [dailyMessageId] : [])]);
    const deleted = new Set(JSON.parse(loadJob(database, revision).deleted_ids_json));
    history = await fetchHistory(channel);
    const archived = JSON.parse(loadJob(database, revision).snapshot_json);
    const captured = new Set(archived.messages.map((message) => message.id));
    // Persist every additional obsolete sale before deleting it. This includes
    // a send that finished during the transition to the application lock.
    for (const message of history) {
      if (keep.has(String(message.id)) || !isPromotionSaleMessage(message, client.user.id) || captured.has(String(message.id))) continue;
      archived.messages.push({ id: String(message.id), text: publicMessageText(message) });
      captured.add(String(message.id));
    }
    updateJob(database, revision, { snapshot_json: JSON.stringify(archived) });
    for (const message of history) {
      if (keep.has(String(message.id)) || !isPromotionSaleMessage(message, client.user.id)) continue;
      try { await message.delete(); } catch (error) {
        if (Number(error?.code) !== 10008) throw fail('PROMOTION_OLD_SALE_DELETE_FAILED');
      }
      deleted.add(String(message.id));
      updateJob(database, revision, { deleted_ids_json: JSON.stringify([...deleted]) });
    }
    const remaining = await fetchHistory(channel);
    if (remaining.some((message) => !keep.has(String(message.id)) && isPromotionSaleMessage(message, client.user.id))) {
      throw fail('PROMOTION_OLD_SALE_REMAINS');
    }
    if ([...keep].some((id) => !remaining.some((message) => String(message.id) === id))) {
      throw fail('PROMOTION_NEW_BOARD_INCOMPLETE');
    }
    updateJob(database, revision, { status: 'DONE', last_error: null });
    return jobResult(loadJob(database, revision));
  } catch (error) {
    updateJob(database, revision, { last_error: /^PROMOTION_[A-Z_]+$/.test(error.code || '') ? error.code : 'PROMOTION_REBUILD_RETRY_REQUIRED' });
    throw error;
  }
}

export function rebuildPromotionCampaign(client, options) {
  if (activeRebuild) {
    if (activeRebuild.revision !== options?.revision) return Promise.reject(fail('PROMOTION_OTHER_REBUILD_ACTIVE'));
    return activeRebuild.promise;
  }
  const promise = rebuildInternal(client, options).finally(() => { activeRebuild = null; });
  activeRebuild = { revision: options?.revision, promise };
  return promise;
}

export const promotionRebuildInternals = Object.freeze({ publicMessageText, fetchHistory, payloadWithMarker });

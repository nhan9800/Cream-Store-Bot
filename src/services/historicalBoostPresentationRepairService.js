import { db } from '../database/db.js';
import { getGuildConfig } from './guildConfigService.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { getCanonicalEmojiSlot, resolveVerifiedCustomEmoji, sanitizeCustomEmojiText } from './emojiService.js';
import { buildHistoricalBoostLogPayload } from './boostPresentationService.js';
import { PermissionFlagsBits } from 'discord.js';

export const HISTORICAL_BOOST_PRESENTATION_REPAIR_VERSION = 'BOOST-LOG-UI-20261002-V2';
const PRIOR_REPAIR_VERSION = 'BOOST-LOG-UI-20261002-V1';
const STORE_ONE_LOG_CHANNEL_ID = '1524232964928438455';
const controllers = new Map();

const LEGACY_BOOST_ICON_SLOTS = Object.freeze({
  '1392749981332541501': 'icon_store', cr_shop: 'icon_store',
  '1481127479702847646': 'ticket_user', verifybadge: 'ticket_user',
  '1348626032747614268': 'order_product', cr_carttt: 'order_product',
  '1392750857329705000': 'payment_money', cr_pay: 'payment_money',
  '1348622828152426528': 'icon_store', cr_muahang: 'icon_store',
  '1481141954346483845': 'status_info', starxoay: 'status_info',
  '1481124261501337601': 'ticket_staff', muiten: 'ticket_staff',
  '1392749775794737286': 'icon_doc', cr_voucher: 'icon_doc',
  '1327553120842158111': 'brand_boost', tsm_fire: 'brand_boost',
  '1366636325352116225': 'warranty_shield', cr_tim: 'warranty_shield',
  '1384069022831874169': 'status_check', tickgreen: 'status_check',
  '1384069065626222632': 'status_cross', tick_red51: 'status_cross',
  '1481134440725090315': 'status_warn', Dotyellow: 'status_warn',
  '1366636327415713832': 'status_check', cr_green: 'status_check',
});

function plain(value) {
  return String(value || '').replace(/<a?:[a-zA-Z0-9_]+:\d+>/g, '')
    .replace(/:([a-zA-Z0-9_]+):/g, (match, name) => LEGACY_BOOST_ICON_SLOTS[name] ? '' : match).trim();
}

function labelKey(value) {
  return plain(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function serverIdentityFromDedicatedField(value) {
  const text = plain(value);
  const ids = new Set(text.match(/\b\d{17,20}\b/g) || []);
  if (ids.size > 1) return { reason: 'SERVER_ID_AMBIGUOUS' };
  if (!ids.size) return { reason: 'SERVER_ID_MISSING' };
  const explicit = text.match(/\bID:\s*`?(\d{17,20})`?/i)?.[1];
  // Some original bot logs contain a lone `server_id` without an ID: label.
  // Accept that exact historical shape only within the dedicated Server field.
  const inlineIds = new Set([...text.matchAll(/`(\d{17,20})`/g)].map((match) => match[1]));
  const id = explicit || (inlineIds.size === 1 ? [...inlineIds][0] : null);
  return id === [...ids][0] ? { id } : { reason: 'SERVER_ID_MISSING' };
}

const json = (value) => value?.toJSON ? value.toJSON() : JSON.parse(JSON.stringify(value));
const messageEmbeds = (message) => (message.embeds || []).map(json);
const messageComponents = (message) => (message.components || []).map(json);
const values = (collection) => Array.isArray(collection) ? collection : [...collection.values()];

function safeFailureCode(error) {
  const code = Number(error?.code);
  if (code === 10008) return 'UNKNOWN_MESSAGE';
  if ([50001, 50013].includes(code)) return 'MISSING_ACCESS';
  if (code === 50035) return 'INVALID_PRESENTATION';
  if (Number(error?.status) === 429) return 'RATE_LIMITED';
  return 'DISCORD_REPAIR_FAILED';
}

function ensureJournal(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS boost_log_presentation_repairs (
      guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, revision TEXT NOT NULL,
      cursor TEXT, status TEXT NOT NULL DEFAULT 'IN_PROGRESS', scanned INTEGER NOT NULL DEFAULT 0,
      last_error TEXT, updated_at TEXT NOT NULL, finished_at TEXT,
      PRIMARY KEY (guild_id, channel_id, revision)
    );
    CREATE TABLE IF NOT EXISTS boost_log_presentation_repair_messages (
      guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, revision TEXT NOT NULL, message_id TEXT NOT NULL,
      state TEXT NOT NULL, legacy_emoji_count INTEGER NOT NULL DEFAULT 0,
      failure_attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY (guild_id, channel_id, revision, message_id)
    );
  `);
}

function journalExists(database) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'boost_log_presentation_repairs'").get());
}

function channelIdFor(guildId, configProvider) {
  return configProvider(guildId)?.boost_log_channel_id
    || (String(guildId) === STORE_ONE_GUILD_ID ? STORE_ONE_LOG_CHANNEL_ID : null);
}

function inspectStoredIdentity(database, code, guildId, diagnose = false) {
  const order = database.prepare(`
    SELECT order_code, guild_id, customer_id, server_id FROM boost_server_orders
    WHERE order_code = ? AND guild_id = ?
  `).get(code, guildId);
  if (order && String(order.guild_id) === String(guildId)) return { order };
  // This extra lookup is read-only diagnostic evidence, never permission to
  // repair a message against another guild's record.
  const elsewhere = diagnose && database.prepare('SELECT 1 FROM boost_server_orders WHERE order_code = ?').get(code);
  return { reason: elsewhere || order ? 'ORDER_GUILD_MISMATCH' : 'NO_DB_ORDER' };
}

function inspectLegacyBoostLog(message, { guildId, botId, database }, diagnose = false) {
  if (String(message.author?.id || '') !== String(botId || '') || !botId) return { reason: 'BOT_AUTHOR_MISMATCH' };
  const embeds = messageEmbeds(message);
  const logs = embeds.map((embed, index) => ({ embed, index }))
    .filter(({ embed }) => /\[BOOST LOG\]/.test(plain(embed.title)));
  if (logs.length !== 1) return { reason: logs.length ? 'MULTIPLE_BOOST_EMBEDS' : 'BOOST_EMBED_MISSING' };
  const { embed, index } = logs[0];
  const fields = embed.fields || [];
  const codes = new Set(JSON.stringify(embed).match(/\bBST_\d{6}\b/g) || []);
  if (codes.size !== 1) return { reason: codes.size ? 'AMBIGUOUS_ORDER_CODE' : 'ORDER_CODE_MISSING' };
  const codeField = fields.find((field) => labelKey(field.name) === 'madon');
  const code = [...codes][0];
  if (!codeField) return { reason: 'ORDER_FIELD_MISSING' };
  if (!String(codeField.value).includes(code)) return { reason: 'ORDER_FIELD_MISMATCH' };
  const identity = inspectStoredIdentity(database, code, guildId, diagnose);
  if (!identity.order) return identity;
  const { order } = identity;
  const customer = fields.find((field) => labelKey(field.name) === 'khach');
  if (!customer) return { reason: 'CUSTOMER_FIELD_MISSING' };
  const customers = [...String(customer?.value || '').matchAll(/<@!?(\d{17,20})>/g)].map((match) => match[1]);
  if (customers.length !== 1) return { reason: customers.length ? 'CUSTOMER_ID_AMBIGUOUS' : 'CUSTOMER_ID_MISSING' };
  if (customers[0] !== String(order.customer_id)) return { reason: 'CUSTOMER_MISMATCH' };
  const server = fields.find((field) => labelKey(field.name) === 'server');
  if (!server) return { reason: 'SERVER_FIELD_MISSING' };
  const serverIdentity = serverIdentityFromDedicatedField(server.value);
  if (!serverIdentity.id) return serverIdentity;
  if (serverIdentity.id !== String(order.server_id)) return { reason: 'SERVER_MISMATCH' };
  return { trustedLog: { embeds, embedIndex: index, embed, code } };
}

function findTrustedLog(message, context) {
  return inspectLegacyBoostLog(message, context).trustedLog || null;
}

function presentationText(message) {
  const texts = [message.content || ''];
  const visit = (item) => {
    if (!item || typeof item !== 'object') return;
    for (const [name, value] of Object.entries(item)) {
      if (['content', 'title', 'description', 'name', 'value', 'text', 'label'].includes(name) && typeof value === 'string') texts.push(value);
      else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  messageEmbeds(message).forEach(visit);
  messageComponents(message).forEach(visit);
  return texts.filter(Boolean).join('\n');
}

function v2IdentitySections(components) {
  const textDisplays = [];
  const visit = (item) => {
    if (item.type === 10 && typeof item.content === 'string') textDisplays.push(plain(item.content));
    (item.components || []).forEach(visit);
  };
  components.forEach(visit);
  const servers = [];
  const customers = [];
  for (const text of textDisplays) {
    const firstLine = text.split('\n')[0].replace(/[*`#]/g, '').trim();
    const heading = labelKey(firstLine);
    if (['server', 'maychunhanboost'].includes(heading)) servers.push(text.split('\n').slice(1).join('\n'));
    if (['khach', 'khachhang'].includes(heading)) customers.push(text.split('\n').slice(1).join('\n'));
    else if (/^Khách(?:\s+hàng)?\s*:/i.test(firstLine)) customers.push(firstLine.replace(/^Khách(?:\s+hàng)?\s*:/i, ''));
  }
  return { servers, customers };
}

function auditTrustedBoostLog(message, context, body) {
  const classic = inspectLegacyBoostLog(message, context, true);
  if (classic.trustedLog) return { code: classic.trustedLog.code, nativeV2: false };
  if (String(message.author?.id || '') !== String(context.botId || '') || !context.botId) return { reason: 'BOT_AUTHOR_MISMATCH' };
  const components = messageComponents(message);
  const isV2 = Boolean(Number(message.flags?.bitfield || message.flags || 0) & 32768)
    || components.some((component) => component.type === 17);
  if (!isV2) return { reason: classic.reason };
  if (!/\[BOOST LOG\]/.test(plain(body))) return { reason: 'BOOST_HEADER_MISSING' };
  const codes = new Set(body.match(/\bBST_\d{6}\b/g) || []);
  if (codes.size !== 1) return { reason: codes.size ? 'AMBIGUOUS_ORDER_CODE' : 'ORDER_CODE_MISSING' };
  const code = [...codes][0];
  const readable = plain(body).replace(/[*`#]/g, '');
  if (!new RegExp(`Mã\\s*đơn\\s*:?\\s*${code}`, 'i').test(readable)) return { reason: 'ORDER_FIELD_MISSING' };
  const identity = inspectStoredIdentity(context.database, code, context.guildId, true);
  if (!identity.order) return identity;
  const { order } = identity;
  const sections = v2IdentitySections(components);
  if (sections.customers.length !== 1) return { reason: sections.customers.length ? 'CUSTOMER_ID_AMBIGUOUS' : 'CUSTOMER_FIELD_MISSING' };
  const customers = [...sections.customers[0].matchAll(/<@!?(\d{17,20})>/g)].map((match) => match[1]);
  if (customers.length !== 1) return { reason: customers.length ? 'CUSTOMER_ID_AMBIGUOUS' : 'CUSTOMER_ID_MISSING' };
  if (customers[0] !== String(order.customer_id)) return { reason: 'CUSTOMER_MISMATCH' };
  if (sections.servers.length !== 1) return { reason: sections.servers.length ? 'SERVER_ID_AMBIGUOUS' : 'SERVER_FIELD_MISSING' };
  const serverIdentity = serverIdentityFromDedicatedField(sections.servers[0]);
  if (!serverIdentity.id) return serverIdentity;
  if (serverIdentity.id !== String(order.server_id)) return { reason: 'SERVER_MISMATCH' };
  return { code, nativeV2: true };
}

function countStalePresentationEmoji(message, guildId, client, verifyEmoji, canonicalSlot) {
  let stale = 0;
  const text = presentationText(message).split(/(```[\s\S]*?(?:```|$))/g)
    .filter((part) => !part.startsWith('```')).join('\n')
    .replace(/https?:\/\/[^\s)]+/g, '');
  for (const match of text.matchAll(/<a?:([a-zA-Z0-9_]+):(\d+)>|:([a-zA-Z_][a-zA-Z0-9_]*):/g)) {
    if (match[2]) {
      if (!verifyEmoji(guildId, match[0], { client })) stale += 1;
    } else if (LEGACY_BOOST_ICON_SLOTS[match[3]] || canonicalSlot(match[3])) {
      // A bare :known_name: is still literal text even when inventory contains
      // that name. It needs a verified custom-emoji mention to render.
      stale += 1;
    }
  }
  const visit = (item) => {
    if (item.emoji && !verifyEmoji(guildId, item.emoji, { client })) stale += 1;
    (item.components || []).forEach(visit);
  };
  messageComponents(message).forEach(visit);
  return stale;
}

/** Read Discord history and database identity only; return aggregate evidence. */
export async function auditHistoricalBoostPresentation(client, {
  guildId,
  focusOrderCode,
  dbInstance = db,
  configProvider = getGuildConfig,
  verifyEmoji = resolveVerifiedCustomEmoji,
  canonicalSlot = getCanonicalEmojiSlot,
  maxMessages = 20000,
  pageSize = 100,
} = {}) {
  const focus = /^BST_\d{6}$/.test(String(focusOrderCode || '')) ? String(focusOrderCode) : null;
  const report = {
    status: 'INCOMPLETE', historyComplete: false, scannedMessages: 0,
    matchedLogMessages: 0, nativeV2Logs: 0, legacyEmbedLogs: 0,
    staleEmojiReferences: 0, malformedOrUnknownSkipped: 0, journalConfirmedRepairs: 0,
    unmatchedReasons: {}, unmatchedStaleEmojiReferencesByReason: {},
    limitReached: false, failures: 0,
    focusOrder: focus ? { matchedMessages: 0, nativeV2Logs: 0, legacyEmbedLogs: 0, repairedMessages: 0, staleEmojiReferences: 0 } : null,
  };
  if (!/^\d{17,20}$/.test(String(guildId || ''))) return { ...report, failures: 1, errorCode: 'GUILD_REQUIRED' };
  const channelId = channelIdFor(guildId, configProvider);
  if (!channelId) return { ...report, status: 'NOT_CONFIGURED', errorCode: 'LOG_CHANNEL_NOT_CONFIGURED' };
  const limitTotal = Math.min(20000, Math.max(1, Math.floor(Number(maxMessages) || 20000)));
  const pageLimit = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 100)));
  try {
    const guild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId));
    const channel = await guild.channels.fetch(String(channelId));
    if (!channel?.isTextBased?.() || channel.isThread?.()
      || String(channel.guildId || channel.guild?.id || '') !== String(guildId)
      || String(channel.id) !== String(channelId)) throw Object.assign(new Error('Invalid configured Boost log channel'), { code: 50001 });
    if (channel.permissionsFor) {
      const member = guild.members?.me || await guild.members?.fetchMe?.();
      if (!channel.permissionsFor(member || client.user?.id)?.has([
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory,
      ])) throw Object.assign(new Error('Boost history is not readable'), { code: 50013 });
    }
    const context = { guildId: String(guildId), botId: client.user?.id, database: dbInstance };
    const hasJournal = journalExists(dbInstance);
    let cursor;
    while (report.scannedMessages < limitTotal) {
      const limit = Math.min(pageLimit, limitTotal - report.scannedMessages);
      const page = values(await channel.messages.fetch({ limit, ...(cursor ? { before: cursor } : {}) }));
      for (const message of page) {
        if (String(message.author?.id || '') !== String(client.user?.id || '')) continue;
        try {
          const body = presentationText(message);
          if (!/\[BOOST LOG\]/.test(plain(body))) continue;
          const stale = countStalePresentationEmoji(message, String(guildId), client, verifyEmoji, canonicalSlot);
          report.staleEmojiReferences += stale;
          const matched = auditTrustedBoostLog(message, context, body);
          if (matched.reason) {
            report.malformedOrUnknownSkipped += 1;
            report.unmatchedReasons[matched.reason] = (report.unmatchedReasons[matched.reason] || 0) + 1;
            report.unmatchedStaleEmojiReferencesByReason[matched.reason] = (report.unmatchedStaleEmojiReferencesByReason[matched.reason] || 0) + stale;
            continue;
          }
          report.matchedLogMessages += 1;
          report[matched.nativeV2 ? 'nativeV2Logs' : 'legacyEmbedLogs'] += 1;
          const repaired = hasJournal && dbInstance.prepare(`
            SELECT 1 FROM boost_log_presentation_repair_messages
            WHERE guild_id = ? AND channel_id = ? AND revision IN (?, ?) AND message_id = ? AND state = 'DONE'
          `).get(String(guildId), String(channelId), HISTORICAL_BOOST_PRESENTATION_REPAIR_VERSION, PRIOR_REPAIR_VERSION, String(message.id));
          if (repaired) report.journalConfirmedRepairs += 1;
          if (focus && matched.code === focus) {
            report.focusOrder.matchedMessages += 1;
            report.focusOrder[matched.nativeV2 ? 'nativeV2Logs' : 'legacyEmbedLogs'] += 1;
            report.focusOrder.staleEmojiReferences += stale;
            if (repaired) report.focusOrder.repairedMessages += 1;
          }
        } catch {
          report.malformedOrUnknownSkipped += 1;
          report.unmatchedReasons.UNSUPPORTED_SHAPE = (report.unmatchedReasons.UNSUPPORTED_SHAPE || 0) + 1;
        }
      }
      report.scannedMessages += page.length;
      cursor = page.at(-1)?.id || cursor;
      if (page.length < limit) {
        report.historyComplete = true;
        break;
      }
    }
    report.limitReached = !report.historyComplete && report.scannedMessages >= limitTotal;
    report.status = report.historyComplete ? report.malformedOrUnknownSkipped ? 'PARTIAL' : 'COMPLETE' : 'INCOMPLETE';
  } catch (error) {
    report.failures += 1;
    report.errorCode = safeFailureCode(error);
  }
  return report;
}

function sanitizeButtons(guildId, components, normalizeText, verifyEmoji) {
  const result = JSON.parse(JSON.stringify(components));
  const visit = (item) => {
    if (item.emoji) {
      const raw = `<${item.emoji.animated ? 'a' : ''}:${item.emoji.name || 'legacy'}:${item.emoji.id}>`;
      const normalized = normalizeText(guildId, raw, { legacySlots: LEGACY_BOOST_ICON_SLOTS });
      const verified = verifyEmoji(guildId, normalized);
      const match = verified?.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
      if (match) item.emoji = { id: match[3], name: match[2], animated: match[1] === 'a' };
      else delete item.emoji;
    }
    for (const child of item.components || []) visit(child);
  };
  result.forEach(visit);
  return result;
}

function gatherText(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  const serialized = value.toJSON ? value.toJSON() : value;
  for (const [key, entry] of Object.entries(serialized)) {
    if (['content', 'title', 'description', 'value', 'text'].includes(key) && typeof entry === 'string') result.push(entry);
    else if (Array.isArray(entry)) entry.forEach((child) => gatherText(child, result));
    else if (entry && typeof entry === 'object') gatherText(entry, result);
  }
  return result;
}

function withoutEmoji(value) {
  const result = json(value);
  const visit = (item) => {
    delete item.emoji;
    (item.components || []).forEach(visit);
  };
  visit(result);
  return result;
}

function preservesHistoricalValues(payload, embed, originalComponents) {
  const body = gatherText(payload).join('\n');
  // Server/customer/package/note values must be retained byte-for-byte. Only
  // generated status/payment icon prefixes are allowed to change.
  for (const field of embed.fields || []) {
    const generated = ['trangthai', 'thanhtoan'].includes(labelKey(field.name));
    if (generated ? !plain(body).includes(plain(field.value)) : !body.includes(String(field.value))) return false;
    if (!plain(body).includes(plain(field.name))) return false;
  }
  if (!plain(body).includes(plain(embed.title))) return false;
  if (embed.description && !body.includes(embed.description)) return false;
  if (embed.footer?.text && !plain(body).includes(plain(embed.footer.text))) return false;
  if (embed.timestamp) {
    const unix = Math.floor(new Date(embed.timestamp).getTime() / 1000);
    if (!body.includes(embed.timestamp) && (!Number.isFinite(unix) || !body.includes(`<t:${unix}:`))) return false;
  }
  const candidateComponents = (payload.components || []).map(json);
  const candidateRows = candidateComponents.filter((component) => component.type === 1);
  return JSON.stringify(candidateRows.map(withoutEmoji)) === JSON.stringify(originalComponents.map(withoutEmoji));
}

export function buildHistoricalBoostRepairPayload(message, {
  guildId,
  trustedLog,
  normalizeText = sanitizeCustomEmojiText,
  verifyEmoji = resolveVerifiedCustomEmoji,
  legacyBuilder = buildHistoricalBoostLogPayload,
} = {}) {
  if (!trustedLog) return null;
  const original = trustedLog.embed;
  const clean = JSON.parse(JSON.stringify(original));
  const normalize = (text, overrides = {}) => normalizeText(guildId, text, {
    legacySlots: { ...LEGACY_BOOST_ICON_SLOTS, ...overrides },
  });
  clean.title = normalize(clean.title);
  if (clean.footer?.text) clean.footer.text = normalize(clean.footer.text);
  clean.fields = (clean.fields || []).map((field) => {
    const label = labelKey(field.name);
    const overrides = label === 'madon' ? { '1392749981332541501': 'order_id', cr_shop: 'order_id' } : {};
    return {
      ...field,
      name: normalize(field.name, overrides),
      value: ['trangthai', 'thanhtoan'].includes(label) ? normalize(field.value) : field.value,
    };
  });
  const originalComponents = messageComponents(message);
  const components = sanitizeButtons(guildId, originalComponents, normalizeText, verifyEmoji);
  const attachments = message.attachments?.size ?? message.attachments?.length ?? 0;
  if (trustedLog.embeds.length === 1 && !message.content && attachments === 0) {
    try {
      const payload = legacyBuilder(clean, { guildId, components, normalizeText: (text) => text });
      if (payload && preservesHistoricalValues(payload, clean, components)) return payload;
    } catch {
      // A historical embed outside the V2 budget remains an embed. It must
      // never lose fields merely to adopt the newer layout.
    }
  }
  const embeds = trustedLog.embeds.map((embed, index) => index === trustedLog.embedIndex ? clean : embed);
  if (JSON.stringify(embeds) === JSON.stringify(trustedLog.embeds)
    && JSON.stringify(components) === JSON.stringify(originalComponents)) return null;
  return { embeds, components, allowedMentions: { parse: [], roles: [], users: [], repliedUser: false } };
}

function legacyEmojiCount(embed, components, guildId, normalizeText) {
  const generatedText = [embed.title, embed.footer?.text, ...(embed.fields || []).flatMap((field) => [
    field.name, ...(['trangthai', 'thanhtoan'].includes(labelKey(field.name)) ? [field.value] : []),
  ])].filter(Boolean).join('\n');
  let count = 0;
  for (const match of generatedText.matchAll(/<a?:[a-zA-Z0-9_]+:\d+>|:[a-zA-Z0-9_]+:/g)) {
    if (normalizeText(guildId, match[0], { legacySlots: LEGACY_BOOST_ICON_SLOTS }) !== match[0]) count += 1;
  }
  const visit = (item) => {
    if (item.emoji) {
      const raw = `<${item.emoji.animated ? 'a' : ''}:${item.emoji.name || 'legacy'}:${item.emoji.id}>`;
      if (normalizeText(guildId, raw, { legacySlots: LEGACY_BOOST_ICON_SLOTS }) !== raw) count += 1;
    }
    (item.components || []).forEach(visit);
  };
  components.forEach(visit);
  return count;
}

function messageState(database, scope, messageId, state, error = null) {
  database.prepare(`
    UPDATE boost_log_presentation_repair_messages SET state = ?,
      failure_attempts = failure_attempts + ?, last_error = ?, updated_at = ?
    WHERE guild_id = ? AND channel_id = ? AND revision = ? AND message_id = ?
  `).run(state, state === 'FAILED' ? 1 : 0, error, new Date().toISOString(), ...scope, messageId);
}

async function repairMessage(message, context) {
  const { database, scope, guildId, botId, normalizeText, verifyEmoji, legacyBuilder } = context;
  const existing = database.prepare(`
    SELECT state FROM boost_log_presentation_repair_messages
    WHERE guild_id = ? AND channel_id = ? AND revision = ? AND message_id = ?
  `).get(...scope, String(message.id));
  if (['DONE', 'SKIPPED'].includes(existing?.state)) return;
  const trustedLog = findTrustedLog(message, { guildId, botId, database });
  if (!trustedLog) {
    if (existing) messageState(database, scope, String(message.id), 'SKIPPED', 'NO_LONGER_MATCHED');
    return;
  }
  database.prepare(`
    INSERT OR IGNORE INTO boost_log_presentation_repair_messages
      (guild_id, channel_id, revision, message_id, state, legacy_emoji_count, updated_at)
    VALUES (?, ?, ?, ?, 'PENDING', ?, ?)
  `).run(...scope, String(message.id), legacyEmojiCount(trustedLog.embed, messageComponents(message), guildId, normalizeText), new Date().toISOString());
  const payload = buildHistoricalBoostRepairPayload(message, { guildId, trustedLog, normalizeText, verifyEmoji, legacyBuilder });
  if (!payload) {
    messageState(database, scope, String(message.id), 'SKIPPED');
    return;
  }
  try {
    await message.edit(payload);
    messageState(database, scope, String(message.id), 'DONE');
  } catch (error) {
    const failure = safeFailureCode(error);
    messageState(database, scope, String(message.id), failure === 'UNKNOWN_MESSAGE' ? 'SKIPPED' : 'FAILED', failure);
  }
}

export async function runHistoricalBoostPresentationRepairPass(client, {
  guildId,
  dbInstance = db,
  configProvider = getGuildConfig,
  normalizeText = sanitizeCustomEmojiText,
  verifyEmoji = resolveVerifiedCustomEmoji,
  legacyBuilder = buildHistoricalBoostLogPayload,
  maxMessages = 20000,
  maxPagesPerPass = 3,
  pageSize = 100,
  revision = HISTORICAL_BOOST_PRESENTATION_REPAIR_VERSION,
} = {}) {
  if (!/^\d{17,20}$/.test(String(guildId || ''))) throw new Error('A configured guild ID is required for Boost presentation repair.');
  const channelId = channelIdFor(guildId, configProvider);
  if (!channelId) return { revision, status: 'NOT_CONFIGURED', scanned: 0, matched: 0, updated: 0, failures: 0 };
  ensureJournal(dbInstance);
  const scope = [String(guildId), String(channelId), revision];
  dbInstance.prepare(`
    INSERT OR IGNORE INTO boost_log_presentation_repairs (guild_id, channel_id, revision, updated_at)
    VALUES (?, ?, ?, ?)
  `).run(...scope, new Date().toISOString());
  const getJob = () => dbInstance.prepare(`
    SELECT * FROM boost_log_presentation_repairs WHERE guild_id = ? AND channel_id = ? AND revision = ?
  `).get(...scope);
  const report = () => getHistoricalBoostPresentationRepairStatus({ guildId, dbInstance, revision });
  const updateJob = (cursor, scanned, status, error = null) => dbInstance.prepare(`
    UPDATE boost_log_presentation_repairs SET cursor = ?, scanned = ?, status = ?, last_error = ?, updated_at = ?,
      finished_at = CASE WHEN ? = 'DONE' THEN ? ELSE NULL END
    WHERE guild_id = ? AND channel_id = ? AND revision = ?
  `).run(cursor || null, scanned, status, error, new Date().toISOString(), status, new Date().toISOString(), ...scope);
  const context = { database: dbInstance, scope, guildId: String(guildId), botId: client.user?.id, normalizeText, verifyEmoji, legacyBuilder };
  try {
    const guild = client.guilds.cache.get(String(guildId)) || await client.guilds.fetch(String(guildId));
    const channel = await guild.channels.fetch(String(channelId));
    if (!channel?.isTextBased?.() || channel.isThread?.()
      || String(channel.guildId || channel.guild?.id || '') !== String(guildId)
      || String(channel.id) !== String(channelId)) throw new Error('Configured Boost log channel is unavailable.');
    if (channel.permissionsFor) {
      const member = guild.members?.me || await guild.members?.fetchMe?.();
      if (!channel.permissionsFor(member || client.user?.id)?.has([
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory,
      ])) throw Object.assign(new Error('Boost history is not readable.'), { code: 50013 });
    }
    const queued = dbInstance.prepare(`
      SELECT message_id FROM boost_log_presentation_repair_messages
      WHERE guild_id = ? AND channel_id = ? AND revision = ? AND state IN ('PENDING', 'FAILED')
      ORDER BY updated_at ASC LIMIT 25
    `).all(...scope);
    for (const item of queued) {
      try {
        const message = await channel.messages.fetch(item.message_id);
        await repairMessage(message, context);
      } catch (error) {
        const failure = safeFailureCode(error);
        messageState(dbInstance, scope, item.message_id, failure === 'UNKNOWN_MESSAGE' ? 'SKIPPED' : 'FAILED', failure);
      }
    }
    for (let pageIndex = 0; pageIndex < Math.max(1, maxPagesPerPass); pageIndex += 1) {
      const job = getJob();
      if (['DONE', 'LIMIT_REACHED'].includes(job.status)) break;
      const remaining = Math.min(20000, Math.max(1, maxMessages)) - job.scanned;
      if (remaining <= 0) {
        updateJob(job.cursor, job.scanned, 'LIMIT_REACHED');
        break;
      }
      const limit = Math.min(100, Math.max(1, pageSize), remaining);
      const page = values(await channel.messages.fetch({ limit, ...(job.cursor ? { before: job.cursor } : {}) }));
      for (const message of page) await repairMessage(message, context);
      const scanned = job.scanned + page.length;
      const cursor = page.at(-1)?.id || job.cursor;
      const status = page.length < limit ? 'DONE' : scanned >= Math.min(20000, Math.max(1, maxMessages)) ? 'LIMIT_REACHED' : 'IN_PROGRESS';
      updateJob(cursor, scanned, status);
      if (status !== 'IN_PROGRESS') break;
    }
    const final = getJob();
    if (final.last_error) updateJob(final.cursor, final.scanned, final.status);
  } catch (error) {
    const job = getJob();
    updateJob(job.cursor, job.scanned, job.status, safeFailureCode(error));
  }
  return report();
}

export function getHistoricalBoostPresentationRepairStatus({
  guildId,
  dbInstance = db,
  revision = HISTORICAL_BOOST_PRESENTATION_REPAIR_VERSION,
} = {}) {
  if (!journalExists(dbInstance)) return { revision, status: 'NOT_STARTED', scanned: 0, matched: 0, updated: 0, legacyEmojiCount: 0, failures: 0, pendingRetries: 0, limitReached: false };
  const suffix = guildId ? ' AND guild_id = ?' : '';
  const params = guildId ? [revision, String(guildId)] : [revision];
  const jobs = dbInstance.prepare(`SELECT status, scanned, last_error FROM boost_log_presentation_repairs WHERE revision = ?${suffix}`).all(...params);
  const totals = dbInstance.prepare(`
    SELECT COUNT(*) AS matched, SUM(CASE WHEN state = 'DONE' THEN 1 ELSE 0 END) AS updated,
      SUM(legacy_emoji_count) AS legacyEmojiCount,
      SUM(CASE WHEN state = 'FAILED' THEN 1 ELSE 0 END) AS failures,
      SUM(CASE WHEN state IN ('PENDING', 'FAILED') THEN 1 ELSE 0 END) AS pendingRetries,
      SUM(failure_attempts) AS failureAttempts
    FROM boost_log_presentation_repair_messages WHERE revision = ?${suffix}
  `).get(...params);
  const pendingRetries = Number(totals.pendingRetries || 0);
  const limitReached = jobs.some((job) => job.status === 'LIMIT_REACHED');
  const channelFailures = jobs.filter((job) => job.last_error).length;
  return {
    revision,
    status: !jobs.length ? 'NOT_STARTED' : channelFailures ? 'RETRYING' : pendingRetries ? 'RETRYING'
      : jobs.some((job) => job.status === 'IN_PROGRESS') ? 'IN_PROGRESS' : limitReached ? 'LIMIT_REACHED' : 'DONE',
    scanned: jobs.reduce((sum, job) => sum + job.scanned, 0),
    matched: Number(totals.matched || 0),
    updated: Number(totals.updated || 0),
    legacyEmojiCount: Number(totals.legacyEmojiCount || 0),
    failures: Number(totals.failures || 0) + channelFailures,
    pendingRetries,
    failureAttempts: Number(totals.failureAttempts || 0),
    limitReached,
  };
}

export function startHistoricalBoostPresentationRepair(client, options = {}) {
  const guildId = String(options.guildId || '');
  if (!/^\d{17,20}$/.test(guildId)) throw new Error('A configured guild ID is required for Boost presentation repair.');
  if (controllers.has(guildId)) return { revision: HISTORICAL_BOOST_PRESENTATION_REPAIR_VERSION, status: 'ALREADY_RUNNING' };
  const controller = { busy: false, timer: null };
  const pass = async () => {
    if (controller.busy) return;
    controller.busy = true;
    try {
      const result = await runHistoricalBoostPresentationRepairPass(client, options);
      if (['DONE', 'NOT_CONFIGURED', 'LIMIT_REACHED'].includes(result.status) && !result.pendingRetries && !result.failures) {
        clearInterval(controller.timer);
        controllers.delete(guildId);
      }
    } catch {
      // Keep a retry timer alive; no raw Discord error or customer data enters
      // operational logs. Aggregate journal status is available to the audit.
    } finally {
      controller.busy = false;
    }
  };
  controller.timer = setInterval(pass, 60000);
  controller.timer.unref?.();
  controllers.set(guildId, controller);
  queueMicrotask(pass);
  return { revision: HISTORICAL_BOOST_PRESENTATION_REPAIR_VERSION, status: 'STARTED' };
}

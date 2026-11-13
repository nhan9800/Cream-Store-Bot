import { PermissionFlagsBits } from 'discord.js';
import { COMPACT_SALE, prepareCompactSale, compactSaleInternals } from '../campaigns/compactSale20261113.js';
import { SHOP_RELAUNCH } from '../campaigns/shopRelaunch20261113.js';

const active = new WeakMap();
const fail = code => Object.assign(new Error(code), { code });
const json = value => value?.toJSON?.() || value;
const noMentions = { parse: [], roles: [], users: [], repliedUser: false };
const url = id => `https://discord.com/channels/${COMPACT_SALE.guildId}/${COMPACT_SALE.channelId}/${id}`;

function presentation(value) {
  const body = json(value);
  const node = value => {
    const item = json(value), result = {};
    for (const key of ['type', 'content', 'accent_color', 'divider', 'spacing', 'style', 'label', 'url', 'disabled']) {
      if (item[key] !== undefined) result[key] = item[key];
    }
    if (item.type === 2) result.disabled = Boolean(item.disabled);
    if (item.emoji?.id) result.emoji = { id: String(item.emoji.id), name: item.emoji.name || '', animated: Boolean(item.emoji.animated) };
    if (item.components) result.components = item.components.map(node);
    return result;
  };
  return { components: (body.components || []).map(node) };
}
function textOf(value) {
  const result = [];
  const walk = item => { if (item.content) result.push(item.content); for (const child of item.components || []) walk(child); };
  presentation(value).components.forEach(walk);
  return result.join('\n');
}
const same = (a, b) => JSON.stringify(presentation(a)) === JSON.stringify(presentation(b));
function owned(message, botId, index) {
  if (!message || String(message.id) !== COMPACT_SALE.messageIds[index]
    || String(message.author?.id) !== String(botId) || message.webhookId
    || String(message.channelId || message.channel?.id) !== COMPACT_SALE.channelId) return false;
  const marker = `${SHOP_RELAUNCH.revision}:PART-${index + 1}`;
  return textOf(message).split('\n').some(line => {
    const value = line.replace(/^-#\s*/, '');
    return value === marker || value.startsWith(`${marker} · `);
  });
}
function verified(message, payload, botId, index) {
  if (!owned(message, botId, index) || !same(message, payload)) throw fail('COMPACT_EDIT_VERIFICATION_FAILED');
  const flags = Number(message.flags?.bitfield ?? message.flags ?? 0);
  if (!(flags & 32768)) throw fail('COMPACT_COMPONENTS_REQUIRED');
  if (message.mentions?.everyone || [...(message.mentions?.roles?.keys?.() || [])].length
    || [...(message.mentions?.users?.keys?.() || [])].length) throw fail('COMPACT_EDIT_MENTION_MISMATCH');
  return { status: 'VERIFIED', messageId: String(message.id), url: url(message.id),
    exactPresentationHash: compactSaleInternals.hash(presentation(message)),
    verifiedAt: new Date().toISOString() };
}

function ensureLedger(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS compact_sale_revisions (
    revision TEXT PRIMARY KEY, status TEXT NOT NULL, snapshot_json TEXT NOT NULL,
    last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS compact_sale_parts (
    revision TEXT NOT NULL, part INTEGER NOT NULL, message_id TEXT NOT NULL,
    before_json TEXT NOT NULL, desired_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
    verification_json TEXT, PRIMARY KEY(revision,part)
  )`);
}

export function getCompactSalePublicationHealth({ dbInstance } = {}) {
  const exists = dbInstance.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='compact_sale_revisions'").get();
  if (!exists) return { revision: COMPACT_SALE.revision, status: 'NOT_STARTED', links: [] };
  const job = dbInstance.prepare('SELECT * FROM compact_sale_revisions WHERE revision=?').get(COMPACT_SALE.revision);
  if (!job) return { revision: COMPACT_SALE.revision, status: 'NOT_STARTED', links: [] };
  const snapshot = JSON.parse(job.snapshot_json);
  const parts = dbInstance.prepare('SELECT part,message_id,status,verification_json FROM compact_sale_parts WHERE revision=? ORDER BY part').all(COMPACT_SALE.revision)
    .map(({ verification_json, ...part }) => ({ ...part, verification: verification_json ? JSON.parse(verification_json) : null }));
  return { revision: COMPACT_SALE.revision, status: job.status, previewHash: snapshot.previewHash,
    priceHash: snapshot.priceHash, selectedProducts: snapshot.selectedProducts, selection: snapshot.selection,
    emojiAudit: snapshot.emojiAudit, parts, links: parts.map(part => url(part.message_id)),
    lastError: job.last_error, updatedAt: job.updated_at };
}

async function updateInternal(client, { dbInstance, E, selection, expectedPreviewHash,
  editMessage = (message, payload) => message.edit(payload) } = {}) {
  if (!dbInstance) throw fail('COMPACT_DATABASE_REQUIRED');
  if (!client?.isReady?.() || !client.user?.id) throw fail('COMPACT_CLIENT_NOT_READY');
  const prepared = prepareCompactSale({ dbInstance, E, selection });
  if (!expectedPreviewHash || expectedPreviewHash !== prepared.previewHash) throw fail('COMPACT_PREVIEW_CHANGED');
  const guild = await client.guilds.fetch(COMPACT_SALE.guildId);
  if (String(guild?.id) !== COMPACT_SALE.guildId) throw fail('COMPACT_GUILD_MISMATCH');
  const channel = await guild.channels.fetch(COMPACT_SALE.channelId);
  if (!channel?.isTextBased?.() || String(channel.id) !== COMPACT_SALE.channelId
    || String(channel.guildId || channel.guild?.id) !== COMPACT_SALE.guildId) throw fail('COMPACT_CHANNEL_MISMATCH');
  const bot = guild.members.me || await guild.members.fetchMe();
  const permissions = channel.permissionsFor(bot);
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory])) throw fail('COMPACT_CHANNEL_PERMISSION_MISSING');
  const read = id => channel.messages.fetch({ message: id, force: true });
  const current = await Promise.all(COMPACT_SALE.messageIds.map(read));
  if (current.some((message, index) => !owned(message, client.user.id, index))) throw fail('COMPACT_OWNED_MESSAGE_REQUIRED');

  ensureLedger(dbInstance);
  const now = new Date().toISOString();
  const existing = dbInstance.prepare('SELECT * FROM compact_sale_revisions WHERE revision=?').get(COMPACT_SALE.revision);
  if (!existing) {
    dbInstance.transaction(() => {
      dbInstance.prepare('INSERT OR IGNORE INTO compact_sale_revisions VALUES(?,?,?,?,?,?)')
        .run(COMPACT_SALE.revision, 'PREPARED', JSON.stringify(prepared), null, now, now);
      const insert = dbInstance.prepare('INSERT OR IGNORE INTO compact_sale_parts(revision,part,message_id,before_json,desired_json) VALUES(?,?,?,?,?)');
      prepared.payloads.forEach((payload, index) => insert.run(COMPACT_SALE.revision, index + 1,
        COMPACT_SALE.messageIds[index], JSON.stringify(presentation(current[index])), JSON.stringify(payload)));
    })();
  }
  const job = dbInstance.prepare('SELECT * FROM compact_sale_revisions WHERE revision=?').get(COMPACT_SALE.revision);
  if (JSON.parse(job.snapshot_json).previewHash !== prepared.previewHash) throw fail('COMPACT_FROZEN_PREVIEW_CHANGED');
  const rows = dbInstance.prepare('SELECT * FROM compact_sale_parts WHERE revision=? ORDER BY part').all(COMPACT_SALE.revision);
  const updateJob = (status, error = null) => dbInstance.prepare('UPDATE compact_sale_revisions SET status=?,last_error=?,updated_at=? WHERE revision=?')
    .run(status, error, new Date().toISOString(), COMPACT_SALE.revision);
  updateJob('EDITING');
  const accepted = [];
  try {
    for (const row of rows) {
      const index = row.part - 1;
      const desired = JSON.parse(row.desired_json);
      let message = await read(row.message_id);
      if (!owned(message, client.user.id, index)) throw fail('COMPACT_OWNED_MESSAGE_REQUIRED');
      if (!same(message, desired)) {
        if (!same(message, JSON.parse(row.before_json))) throw fail('COMPACT_EXTERNAL_EDIT_CONFLICT');
        dbInstance.prepare("UPDATE compact_sale_parts SET status='EDITING' WHERE revision=? AND part=?").run(COMPACT_SALE.revision, row.part);
        // PATCH of the same owned message is idempotent. An accepted edit with a
        // lost receipt is recovered from the fetched desired presentation.
        await editMessage(message, { ...desired, allowedMentions: { ...noMentions } });
        message = await read(row.message_id);
      }
      const evidence = verified(message, desired, client.user.id, index);
      dbInstance.prepare("UPDATE compact_sale_parts SET status='DONE',verification_json=? WHERE revision=? AND part=?")
        .run(JSON.stringify(evidence), COMPACT_SALE.revision, row.part);
      accepted.push(presentation(message));
    }
    compactSaleInternals.emojiAudit(accepted);
    updateJob('DONE');
    return getCompactSalePublicationHealth({ dbInstance });
  } catch (error) {
    updateJob('RETRY_REQUIRED', /^COMPACT_[A-Z_]+$/.test(error?.code || '') ? error.code : 'COMPACT_EDIT_RETRY_REQUIRED');
    throw error;
  }
}

export function updateCompactSale(client, options) {
  const database = options?.dbInstance;
  if (database && active.has(database)) return active.get(database);
  const operation = updateInternal(client, options).finally(() => { if (database) active.delete(database); });
  if (database) active.set(database, operation);
  return operation;
}

export const compactSalePublicationInternals = Object.freeze({ presentation, same, textOf, owned, verified });

import { SHOP_RELAUNCH, buildShopRelaunchNotice, prepareShopRelaunch, shopRelaunchHash } from '../campaigns/shopRelaunch20261113.js';
import { PermissionFlagsBits } from 'discord.js';

const fail = code => Object.assign(new Error(code), { code });
const active = new WeakMap();
const json = value => value?.toJSON?.() || value;
function textOf(message) {
  const body = json(message);
  const texts = [body?.content || ''];
  const visit = component => {
    const node = json(component);
    if (node?.content) texts.push(node.content);
    for (const child of node?.components || []) visit(child);
  };
  for (const component of body?.components || []) visit(component);
  return texts.filter(Boolean).join('\n');
}
const markerOf = part => `${SHOP_RELAUNCH.revision}:${part === 'NOTICE' ? 'NOTICE' : `PART-${part}`}`;
const hasMarker = (message, part) => textOf(message).split('\n').some(line => {
  const label = line.replace(/^-#\s*/, '');
  return label === markerOf(part) || label.startsWith(`${markerOf(part)} · `);
});
const linkOf = (channel, id) => `https://discord.com/channels/${SHOP_RELAUNCH.guildId}/${channel}/${id}`;

function ensureLedger(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS shop_relaunch_jobs (
    revision TEXT PRIMARY KEY, status TEXT NOT NULL, snapshot_json TEXT NOT NULL, last_error TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ); CREATE TABLE IF NOT EXISTS shop_relaunch_parts (
    revision TEXT NOT NULL, part TEXT NOT NULL, channel_id TEXT NOT NULL, payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', message_id TEXT, started_at TEXT, verification_json TEXT,
    PRIMARY KEY(revision, part)
  )`);
}

export function getShopRelaunchPublicationHealth({ dbInstance }) {
  const exists = dbInstance.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='shop_relaunch_jobs'").get();
  if (!exists) return { revision: SHOP_RELAUNCH.revision, status: 'not_started', links: [] };
  const job = dbInstance.prepare('SELECT * FROM shop_relaunch_jobs WHERE revision=?').get(SHOP_RELAUNCH.revision);
  if (!job) return { revision: SHOP_RELAUNCH.revision, status: 'not_started', links: [] };
  const snapshot = JSON.parse(job.snapshot_json);
  const parts = dbInstance.prepare('SELECT part,channel_id,status,message_id,verification_json FROM shop_relaunch_parts WHERE revision=? ORDER BY rowid').all(SHOP_RELAUNCH.revision)
    .map(({ verification_json, ...part }) => ({ ...part, verification: verification_json ? JSON.parse(verification_json) : null }));
  return { revision: job.revision, status: job.status, priceManifest: snapshot.priceManifest,
    priceHash: snapshot.priceHash, payloadHash: snapshot.payloadHash, updatedAt: job.updated_at,
    lastError: job.last_error, links: parts.filter(p => p.message_id).map(p => linkOf(p.channel_id, p.message_id)), parts };
}

function updateJob(db, status, error = null) {
  db.prepare('UPDATE shop_relaunch_jobs SET status=?,last_error=?,updated_at=? WHERE revision=?')
    .run(status, error, new Date().toISOString(), SHOP_RELAUNCH.revision);
}

async function history(channel) {
  const result = [];
  let before;
  for (let page = 0; page < 200; page++) {
    const batch = [...(await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) })).values()];
    result.push(...batch);
    if (batch.length < 100) return result;
    if (before === batch.at(-1).id) throw fail('RELAUNCH_HISTORY_STALLED');
    before = batch.at(-1).id;
  }
  throw fail('RELAUNCH_HISTORY_LIMIT');
}

function verify(message, payload, expectedChannel, botId, part) {
  if (!message?.id || String(message.author?.id) !== String(botId)
    || String(message.channelId || message.channel?.id) !== String(expectedChannel)
    || textOf(message) !== textOf(payload) || !hasMarker(message, part)) throw fail('RELAUNCH_PUBLICATION_CONTENT_MISMATCH');
  const roles = [...(message.mentions?.roles?.keys?.() || [])].map(String).sort();
  const users = [...(message.mentions?.users?.keys?.() || [])];
  if (message.mentions?.everyone || users.length
    || JSON.stringify(roles) !== JSON.stringify(payload.allowedMentions.roles.slice().sort())) throw fail('RELAUNCH_PUBLICATION_MENTION_MISMATCH');
  // The fetched content must retain every custom token; no Unicode decoration is allowed.
  if (/\p{Extended_Pictographic}/u.test(textOf(message))) throw fail('RELAUNCH_PUBLICATION_UNICODE_EMOJI');
  const flags = Number(message.flags?.bitfield ?? message.flags ?? json(message)?.flags ?? 0);
  if (!(flags & 32768)) throw fail('RELAUNCH_PUBLICATION_COMPONENTS_REQUIRED');
  return message;
}

async function publishInternal(client, { dbInstance, E, sendMessage = (channel, payload) => channel.send(payload), expectedPriceHash } = {}) {
  if (!dbInstance) throw fail('RELAUNCH_DATABASE_REQUIRED');
  if (!client?.isReady?.() || !client.user?.id) throw fail('RELAUNCH_CLIENT_NOT_READY');
  const guild = await client.guilds.fetch(SHOP_RELAUNCH.guildId);
  if (String(guild?.id) !== SHOP_RELAUNCH.guildId) throw fail('RELAUNCH_GUILD_MISMATCH');
  const role = await guild.roles.fetch(SHOP_RELAUNCH.memberRoleId);
  if (!role || String(role.id) !== SHOP_RELAUNCH.memberRoleId || role.managed || role.id === guild.id) throw fail('RELAUNCH_MEMBER_ROLE_INVALID');
  const channels = new Map();
  const botMember = guild.members.me || await guild.members.fetchMe();
  for (const id of [SHOP_RELAUNCH.channelId, SHOP_RELAUNCH.announcementChannelId]) {
    const channel = await guild.channels.fetch(id);
    if (!channel?.isTextBased?.() || String(channel.id) !== id || String(channel.guildId || channel.guild?.id) !== guild.id
      || typeof channel.send !== 'function') throw fail('RELAUNCH_CHANNEL_MISMATCH');
    const permissions = channel.permissionsFor(botMember);
    const sendPermission = channel.isThread?.() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
    if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(sendPermission)
      || !permissions.has(PermissionFlagsBits.ReadMessageHistory)) throw fail('RELAUNCH_CHANNEL_PERMISSION_MISSING');
    if (id === SHOP_RELAUNCH.channelId && !role.mentionable && !permissions.has(PermissionFlagsBits.MentionEveryone)) throw fail('RELAUNCH_MEMBER_MENTION_PERMISSION_MISSING');
    channels.set(id, channel);
  }
  // Validate prices and every custom icon before creating a ledger or sending any part.
  const prepared = prepareShopRelaunch({ dbInstance, E });
  buildShopRelaunchNotice({ boardIds: ['100000000000000001'], E });
  if (!expectedPriceHash || expectedPriceHash !== prepared.priceHash) throw fail('RELAUNCH_CATALOG_CHANGED');
  ensureLedger(dbInstance);
  const now = new Date().toISOString();
  const prior = dbInstance.prepare('SELECT * FROM shop_relaunch_jobs WHERE revision=?').get(SHOP_RELAUNCH.revision);
  if (!prior) {
    dbInstance.transaction(() => {
      dbInstance.prepare('INSERT OR IGNORE INTO shop_relaunch_jobs VALUES(?,?,?,?,?,?)')
        .run(SHOP_RELAUNCH.revision, 'READY', JSON.stringify(prepared), null, now, now);
      const insert = dbInstance.prepare('INSERT OR IGNORE INTO shop_relaunch_parts(revision,part,channel_id,payload_json) VALUES(?,?,?,?)');
      prepared.payloads.forEach((payload, index) => insert.run(SHOP_RELAUNCH.revision, String(index + 1), SHOP_RELAUNCH.channelId, JSON.stringify(payload)));
    })();
  }
  const job = dbInstance.prepare('SELECT * FROM shop_relaunch_jobs WHERE revision=?').get(SHOP_RELAUNCH.revision);
  const frozen = JSON.parse(job.snapshot_json);
  if (frozen.priceHash !== prepared.priceHash) throw fail('RELAUNCH_CATALOG_CHANGED_DURING_RELEASE');
  const historyCache = new Map();
  function recordVerified(row, message, payload) {
    const text = textOf(message);
    const verification = { status: 'VERIFIED', verifiedAt: new Date().toISOString(),
      exactTextHash: shopRelaunchHash(text), customEmojiCount: (text.match(/<a?:\w+:\d+>/g) || []).length,
      nativeEmojiCount: (text.match(/\p{Extended_Pictographic}/gu) || []).length,
      allowedRoles: payload.allowedMentions.roles, everyone: Boolean(message.mentions?.everyone),
      channelId: row.channel_id, messageId: String(message.id), url: linkOf(row.channel_id, message.id) };
    dbInstance.prepare("UPDATE shop_relaunch_parts SET status='SENT',message_id=?,verification_json=? WHERE revision=? AND part=?")
      .run(String(message.id), JSON.stringify(verification), SHOP_RELAUNCH.revision, row.part);
  }
  async function publishPart(row) {
    const channel = channels.get(row.channel_id);
    const payload = JSON.parse(row.payload_json);
    if (!historyCache.has(row.channel_id)) historyCache.set(row.channel_id, await history(channel));
    const matches = historyCache.get(row.channel_id).filter(message => String(message.author?.id) === String(client.user.id)
      && hasMarker(message, row.part));
    if (matches.length > 1) throw fail('RELAUNCH_DUPLICATE_MARKER');
    if (matches.length === 1) {
      const message = verify(matches[0], payload, row.channel_id, client.user.id, row.part);
      recordVerified(row, message, payload);
      return String(message.id);
    }
    if (row.status === 'SENT') throw fail('RELAUNCH_PUBLISHED_MESSAGE_MISSING');
    if (row.status === 'SENDING') throw fail('RELAUNCH_SEND_UNCERTAIN');
    const claim = dbInstance.prepare("UPDATE shop_relaunch_parts SET status='SENDING',started_at=? WHERE revision=? AND part=? AND status='PENDING'")
      .run(new Date().toISOString(), SHOP_RELAUNCH.revision, row.part);
    if (!claim.changes) throw fail('RELAUNCH_SEND_IN_PROGRESS');
    let sent;
    try {
      sent = await sendMessage(channel, payload);
    } catch (error) {
      if (error?.requestNotSent === true || (Number(error?.status) >= 400 && Number(error?.status) < 500)) {
        dbInstance.prepare("UPDATE shop_relaunch_parts SET status='PENDING' WHERE revision=? AND part=?")
          .run(SHOP_RELAUNCH.revision, row.part);
        throw fail('RELAUNCH_SEND_REJECTED');
      }
      throw fail('RELAUNCH_SEND_UNCERTAIN');
    }
    // Fetch the accepted message: a send response alone is not publication evidence.
    const fetched = await channel.messages.fetch(String(sent.id));
    verify(fetched, payload, row.channel_id, client.user.id, row.part);
    recordVerified(row, fetched, payload);
    historyCache.get(row.channel_id).push(fetched);
    return String(fetched.id);
  }
  updateJob(dbInstance, 'PUBLISHING');
  try {
    const boardRows = dbInstance.prepare("SELECT * FROM shop_relaunch_parts WHERE revision=? AND part!='NOTICE' ORDER BY rowid").all(SHOP_RELAUNCH.revision);
    const boardIds = [];
    for (const row of boardRows) boardIds.push(await publishPart(row));
    const notice = buildShopRelaunchNotice({ boardIds, E });
    dbInstance.prepare('INSERT OR IGNORE INTO shop_relaunch_parts(revision,part,channel_id,payload_json) VALUES(?,?,?,?)')
      .run(SHOP_RELAUNCH.revision, 'NOTICE', SHOP_RELAUNCH.announcementChannelId, JSON.stringify(notice));
    await publishPart(dbInstance.prepare("SELECT * FROM shop_relaunch_parts WHERE revision=? AND part='NOTICE'").get(SHOP_RELAUNCH.revision));
    updateJob(dbInstance, 'DONE');
    return getShopRelaunchPublicationHealth({ dbInstance });
  } catch (error) {
    updateJob(dbInstance, error?.code === 'RELAUNCH_SEND_UNCERTAIN' ? 'UNCERTAIN' : 'RETRY_REQUIRED',
      /^RELAUNCH_[A-Z_]+$/.test(error?.code || '') ? error.code : 'RELAUNCH_VERIFICATION_REQUIRED');
    throw error;
  }
}

export function publishShopRelaunch(client, options) {
  const database = options?.dbInstance;
  if (database && active.has(database)) return active.get(database);
  const operation = publishInternal(client, options).finally(() => { if (database) active.delete(database); });
  if (database) active.set(database, operation);
  return operation;
}

export const shopRelaunchPublicationInternals = Object.freeze({ textOf, verify, markerOf });

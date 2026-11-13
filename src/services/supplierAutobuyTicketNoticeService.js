import { createHash } from 'node:crypto';
import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { db } from '../database/db.js';
import { config } from '../config.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { supplierProviderForProductKey } from '../utils/supplierProvider.js';
import { getGuildConfig } from './guildConfigService.js';
import { buildSupplierOrderView } from './supplierAutobuyPanelService.js';

const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const orderCodeValid = value => typeof value === 'string' && /^CN_\d{6,20}$/.test(value);
const NO_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false };
const safeFailure = error => Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 && error.status !== 408;
const values = collection => collection && typeof collection.values === 'function' ? [...collection.values()] : [];

/** Ticket messages are receipts for existing orders, never payment/purchase work. */
export function createSupplierAutobuyTicketNoticeService({ database = db, guildConfig = getGuildConfig,
  scopeEnabled = ({ guildId, envFile }) => config.guildId === STORE_ONE_GUILD_ID && guildId === STORE_ONE_GUILD_ID
    && envFile === '.env' && process.env.ENV_FILE === '.env',
  readCustomerOrder = async input => (await import('./supplierAutobuyOrderService.js')).getSupplierOrderForCustomer(input),
  buildCard = buildSupplierOrderView, now = Date.now,
} = {}) {
  let initialized = false;
  const flights = new Map();
  const maintenance = new WeakMap();
  let health = Object.freeze({ status: 'NOT_STARTED', checkedAt: null, scanned: 0, sent: 0, recovered: 0, pending: 0, failed: 0 });
  function init() {
    if (initialized) return;
    database.exec(`CREATE TABLE IF NOT EXISTS supplier_autobuy_ticket_notices (
      order_code TEXT PRIMARY KEY,channel_id TEXT NOT NULL,message_id TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',attempts INTEGER NOT NULL DEFAULT 0,
      attempted_at TEXT,updated_at TEXT NOT NULL,last_error TEXT,history_after_message_id TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_ticket_notice_message ON supplier_autobuy_ticket_notices(message_id) WHERE message_id IS NOT NULL;`);
    if (!database.prepare('PRAGMA table_info(supplier_autobuy_ticket_notices)').all().some(column => column.name === 'history_after_message_id')) {
      database.exec('ALTER TABLE supplier_autobuy_ticket_notices ADD COLUMN history_after_message_id TEXT');
    }
    initialized = true;
  }
  function linkedOrder(code) {
    if (!orderCodeValid(code)) return null;
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('orders','tickets','supplier_autobuy_intents')").all();
    if (tables.length !== 3) return null;
    const row = database.prepare(`SELECT o.*,i.provider,i.product_key,t.id AS linked_ticket_id,
      t.guild_id AS ticket_guild_id,t.customer_id AS ticket_customer_id,t.channel_id AS linked_channel_id,
      t.status AS ticket_status,t.ticket_type,t.support_source AS ticket_source
      FROM orders o JOIN supplier_autobuy_intents i ON i.order_code=o.order_code
      AND i.guild_id=o.guild_id AND i.customer_id=o.customer_id
      JOIN tickets t ON t.id=o.ticket_id AND t.channel_id=o.ticket_channel_id WHERE o.order_code=?`).get(code);
    if (!row || row.guild_id !== STORE_ONE_GUILD_ID || row.ticket_guild_id !== row.guild_id
      || row.ticket_customer_id !== row.customer_id || row.fulfillment_mode !== 'SUPPLIER'
      || row.ticket_status !== 'OPEN' || row.ticket_type !== 'ORDER'
      || !['DISCORD_AUTOBUY', 'DISCORD_ORDER'].includes(row.ticket_source)
      || !snowflake(row.customer_id) || !snowflake(row.linked_channel_id)
      || row.provider !== supplierProviderForProductKey(row.product_key)) return null;
    return row;
  }
  function context(row) {
    return { guildId: row.guild_id, customerId: row.customer_id, orderCode: row.order_code,
      channelId: row.linked_channel_id, ticketId: row.linked_ticket_id, ticketSource: row.ticket_source, provider: row.provider,
      categoryId: guildConfig(row.guild_id)?.ticket_category_id ?? null,
      expectedTopic: row.ticket_source === 'DISCORD_AUTOBUY'
        ? `Cenar AutoBuy · customer:${row.customer_id} · ticket:${row.linked_ticket_id}` : null };
  }
  function getContext({ guildId, channelId, messageId, customerId, orderCode, ephemeral = false } = {}) {
    if (!scopeEnabled({ guildId, envFile: process.env.ENV_FILE }) || !snowflake(channelId) || !snowflake(customerId)
      || (ephemeral ? !orderCodeValid(orderCode) : !snowflake(messageId))) return null;
    init();
    const notice = ephemeral
      ? database.prepare("SELECT * FROM supplier_autobuy_ticket_notices WHERE order_code=? AND channel_id=? AND status='SENT'").get(orderCode, channelId)
      : database.prepare("SELECT * FROM supplier_autobuy_ticket_notices WHERE message_id=? AND channel_id=? AND status='SENT'").get(messageId, channelId);
    if (!notice || (orderCode !== undefined && notice.order_code !== orderCode)) return null;
    const row = linkedOrder(notice.order_code);
    return row && row.customer_id === customerId && row.guild_id === guildId && row.linked_channel_id === channelId ? context(row) : null;
  }
  function registerOrigin({ guildId, channelId, customerId, orderCode, ticketId, provider, historyAfterMessageId,
    envFile = process.env.ENV_FILE } = {}) {
    if (!scopeEnabled({ guildId, envFile })) return { status: 'DISABLED_OTHER_STORE' };
    if (!snowflake(historyAfterMessageId) || !snowflake(channelId) || !snowflake(customerId)
      || !Number.isSafeInteger(ticketId) || ticketId < 1) return { status: 'NOT_ELIGIBLE' };
    init();
    const row = linkedOrder(orderCode);
    if (!row || row.guild_id !== guildId || row.customer_id !== customerId || row.linked_channel_id !== channelId
      || row.linked_ticket_id !== ticketId || row.provider !== provider) return { status: 'NOT_ELIGIBLE' };
    // Only the confirmation facade may supply a snapshot captured before a new
    // order existed. Never attach/advance a floor on an existing journal row:
    // a restored or uncertain receipt must retain its original search window.
    const inserted = database.prepare(`INSERT INTO supplier_autobuy_ticket_notices
      (order_code,channel_id,updated_at,history_after_message_id) VALUES(?,?,?,?) ON CONFLICT(order_code) DO NOTHING`)
      .run(orderCode, channelId, new Date(now()).toISOString(), historyAfterMessageId);
    return { status: inserted.changes ? 'REGISTERED' : 'EXISTS' };
  }
  function privateChannel(channel, bound, botId) {
    return channel?.type === ChannelType.GuildText && channel.guildId === bound.guildId && channel.id === bound.channelId
      && snowflake(bound.categoryId) && channel.parentId === bound.categoryId
      && (!bound.expectedTopic || channel.topic === bound.expectedTopic)
      && channel.permissionOverwrites?.cache?.get(bound.guildId)?.deny?.has(PermissionFlagsBits.ViewChannel)
      && channel.permissionOverwrites?.cache?.get(bound.customerId)?.allow?.has(PermissionFlagsBits.ViewChannel)
      && channel.permissionsFor?.(botId)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]);
  }
  function ownedMessage(message, bound, botId) {
    if (!snowflake(message?.id) || message.author?.id !== botId || message.webhookId || message.channelId !== bound.channelId) return false;
    let components;
    try { components = JSON.parse(JSON.stringify(message.components)); } catch { return false; }
    // The exact order/customer control is the stable marker, including after
    // a process dies between Discord accepting a send and saving its receipt.
    const expected = `supplier-autobuy:order:${bound.customerId}:${bound.orderCode}`;
    const matches = items => Array.isArray(items) && items.some(item => item?.custom_id === expected || matches(item?.components));
    return matches(components);
  }
  async function findExisting(channel, bound, botId, fullScan, historyAfterMessageId) {
    let before;
    for (let page = 0; page < (fullScan ? 10 : 1); page++) {
      const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
      const messages = values(batch), matches = messages.filter(message => ownedMessage(message, bound, botId));
      if (matches.length > 1) return { ambiguous: true };
      if (matches.length === 1) return { message: matches[0] };
      // Check every marker on this page before stopping. Use an exact message
      // boundary, not clock-derived age or assumed cross-worker Snowflake order.
      if (snowflake(historyAfterMessageId) && messages.some(message => message.id === historyAfterMessageId)) return {};
      if (messages.length < 100) return {};
      const next = messages.at(-1)?.id;
      if (!snowflake(next) || next === before) return { incomplete: true };
      before = next;
    }
    return { incomplete: true };
  }
  async function sendInternal({ client, orderCode, guildId = config.guildId, envFile = process.env.ENV_FILE } = {}) {
    if (!scopeEnabled({ guildId, envFile })) return { status: 'DISABLED_OTHER_STORE' };
    init();
    const row = linkedOrder(orderCode);
    if (!row || row.guild_id !== guildId) return { status: 'NOT_ELIGIBLE' };
    const bound = context(row), botId = client?.user?.id;
    if (!snowflake(botId) || (typeof client.isReady === 'function' && !client.isReady())) return { status: 'CHANNEL_UNVERIFIED' };
    let channel, guild;
    try {
      guild = await client.guilds.fetch(guildId);
      if (guild?.id !== guildId) return { status: 'CHANNEL_UNVERIFIED' };
      channel = await guild.channels.fetch(bound.channelId);
    } catch { return { status: 'CHANNEL_UNVERIFIED' }; }
    if (!privateChannel(channel, bound, botId)) return { status: 'CHANNEL_UNVERIFIED' };
    const timestamp = () => new Date(now()).toISOString();
    database.prepare(`INSERT INTO supplier_autobuy_ticket_notices(order_code,channel_id,updated_at) VALUES(?,?,?)
      ON CONFLICT(order_code) DO NOTHING`).run(orderCode, bound.channelId, timestamp());
    let notice = database.prepare('SELECT * FROM supplier_autobuy_ticket_notices WHERE order_code=?').get(orderCode);
    if (notice.channel_id !== bound.channelId) return { status: 'REVIEW' };
    const receipt = (message, recovered = false) => {
      database.prepare("UPDATE supplier_autobuy_ticket_notices SET status='SENT',message_id=?,last_error=NULL,updated_at=? WHERE order_code=?")
        .run(message.id, timestamp(), orderCode);
      return { status: 'SENT', orderCode, provider: row.provider, channelId: bound.channelId, messageId: message.id, recovered };
    };
    if (notice.message_id) {
      try {
        const message = await channel.messages.fetch(notice.message_id);
        return ownedMessage(message, bound, botId) ? receipt(message, true) : { status: 'REVIEW' };
      } catch (error) {
        if (error?.status !== 404) return { status: 'UNKNOWN' };
        // A definite missing receipt permits replacement; uncertain reads do not.
        database.prepare("UPDATE supplier_autobuy_ticket_notices SET status='RETRY',message_id=NULL,last_error='MESSAGE_MISSING',updated_at=? WHERE order_code=?")
          .run(timestamp(), orderCode);
        notice = { ...notice, status: 'RETRY', message_id: null };
      }
    }
    try {
      const found = await findExisting(channel, bound, botId, true, notice.history_after_message_id);
      if (found.ambiguous) return { status: 'REVIEW' };
      if (found.message) return receipt(found.message, true);
      if (found.incomplete) return { status: 'UNKNOWN' };
      if (['UNKNOWN', 'SENDING'].includes(notice.status)) return { status: 'UNKNOWN' };
    } catch { return { status: 'UNKNOWN' }; }
    // Build entirely from the server-owned order. This read creates no invoice,
    // customer debit, supplier quote or purchase, even during startup repair.
    let payload;
    try {
      const order = await readCustomerOrder({ guildId, customerId: row.customer_id, orderCode, provider: row.provider });
      if (order?.provider !== row.provider || order?.orderCode !== orderCode) return { status: 'REVIEW' };
      const card = await buildCard({ order, customerId: row.customer_id, ticketContext: true });
      payload = JSON.parse(JSON.stringify(card));
      payload.flags = MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications;
      payload.allowedMentions = { ...NO_MENTIONS };
    } catch {
      database.prepare("UPDATE supplier_autobuy_ticket_notices SET status='RETRY',last_error='CARD_UNAVAILABLE',updated_at=? WHERE order_code=? AND status IN ('PENDING','RETRY')")
        .run(timestamp(), orderCode);
      return { status: 'RETRY' };
    }
    // History discovery and card rendering await other services. A ticket can
    // close or change owners during those waits; never publish the old owner's
    // card using a channel/permission snapshot from the start of the request.
    const validateCurrentBinding = () => {
      if (!scopeEnabled({ guildId, envFile })) return 'DISABLED_OTHER_STORE';
      const current = linkedOrder(orderCode);
      if (!current || current.guild_id !== guildId) return 'NOT_ELIGIBLE';
      const currentBound = context(current);
      if (current.product_key !== row.product_key || Object.keys(bound).some(key => bound[key] !== currentBound[key])) return 'REVIEW';
      return null;
    };
    let changed = validateCurrentBinding();
    if (changed) return { status: changed };
    try { channel = await guild.channels.fetch(bound.channelId, { force: true }); }
    catch { return { status: 'CHANNEL_UNVERIFIED' }; }
    changed = validateCurrentBinding();
    if (changed) return { status: changed };
    if (!privateChannel(channel, bound, botId) || (typeof client.isReady === 'function' && !client.isReady())) return { status: 'CHANNEL_UNVERIFIED' };
    const claimed = database.prepare(`UPDATE supplier_autobuy_ticket_notices SET status='SENDING',attempts=attempts+1,
      attempted_at=?,updated_at=?,last_error=NULL WHERE order_code=? AND status IN ('PENDING','RETRY')`)
      .run(timestamp(), timestamp(), orderCode);
    if (!claimed.changes) return { status: 'UNKNOWN' };
    const attempt = database.prepare('SELECT attempts FROM supplier_autobuy_ticket_notices WHERE order_code=?').get(orderCode).attempts;
    try {
      const message = await channel.send({ ...payload,
        nonce: createHash('sha256').update(`supplier-ticket:${orderCode}:${attempt}`).digest('hex').slice(0, 24), enforceNonce: true });
      if (!ownedMessage(message, bound, botId)) throw new Error('NOTICE_RECEIPT_UNVERIFIED');
      return receipt(message);
    } catch (error) {
      const status = safeFailure(error) ? 'RETRY' : 'UNKNOWN';
      database.prepare('UPDATE supplier_autobuy_ticket_notices SET status=?,last_error=?,updated_at=? WHERE order_code=? AND status=\'SENDING\'')
        .run(status, status === 'RETRY' ? 'SEND_REJECTED' : 'SEND_UNCERTAIN', timestamp(), orderCode);
      return { status };
    }
  }
  function send(input = {}) {
    if (!scopeEnabled({ guildId: input.guildId ?? config.guildId, envFile: input.envFile ?? process.env.ENV_FILE })) {
      return Promise.resolve({ status: 'DISABLED_OTHER_STORE' });
    }
    const key = `${input.guildId ?? config.guildId}:${input.orderCode}`;
    if (flights.has(key)) return flights.get(key);
    const task = sendInternal(input).then(result => {
      if (initialized && result.status !== 'SENT') {
        // Rotate outstanding rows between bounded maintenance passes, including
        // unknown sends that may only reconcile and must never be resubmitted.
        database.prepare('UPDATE supplier_autobuy_ticket_notices SET updated_at=? WHERE order_code=?')
          .run(new Date(now()).toISOString(), input.orderCode ?? null);
      }
      return result;
    }).finally(() => flights.delete(key));
    flights.set(key, task); return task;
  }
  async function repair(client, { guildId = config.guildId, envFile = process.env.ENV_FILE, limit = 25, orderCode } = {}) {
    if (!scopeEnabled({ guildId, envFile })) return { status: 'DISABLED_OTHER_STORE', scanned: 0, sent: 0, pending: 0 };
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (orderCode !== undefined && !orderCodeValid(orderCode))) return { status: 'INVALID_REQUEST', scanned: 0, sent: 0, pending: 0 };
    init();
    if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='supplier_autobuy_intents'").get()) return { status: 'READY', scanned: 0, sent: 0, pending: 0 };
    const rows = database.prepare(`SELECT o.order_code FROM orders o JOIN supplier_autobuy_intents i ON i.order_code=o.order_code
      JOIN tickets t ON t.id=o.ticket_id AND t.channel_id=o.ticket_channel_id
      LEFT JOIN supplier_autobuy_ticket_notices n ON n.order_code=o.order_code
      WHERE o.guild_id=? AND o.fulfillment_mode='SUPPLIER' AND t.status='OPEN' AND t.ticket_type='ORDER'
      AND t.support_source IN ('DISCORD_AUTOBUY','DISCORD_ORDER') AND o.status IN ('PENDING_PAYMENT','PROCESSING')
      ${orderCode ? 'AND o.order_code=?' : "AND (n.order_code IS NULL OR n.status!='SENT')"}
      ORDER BY COALESCE(n.updated_at,o.created_at),o.order_code LIMIT ?`)
      .all(...(orderCode ? [guildId, orderCode, limit] : [guildId, limit]));
    let sent = 0, recovered = 0, pending = 0, failed = 0;
    const repaired = [];
    for (const row of rows) {
      try {
        const result = await send({ client, guildId, envFile, orderCode: row.order_code });
        if (result.status === 'SENT') {
          if (result.recovered) recovered++; else sent++;
          repaired.push({ orderCode: result.orderCode, channelId: result.channelId, messageId: result.messageId });
        } else if (result.status === 'UNKNOWN') pending++; else failed++;
      } catch { failed++; }
    }
    health = Object.freeze({ status: failed || pending ? 'PENDING' : 'READY', checkedAt: new Date(now()).toISOString(),
      scanned: rows.length, sent, recovered, pending, failed });
    return { ...health, repaired };
  }
  function stopMaintenance(client) {
    maintenance.get(client)?.stop();
    return { status: 'STOPPED', workerRunning: false };
  }
  function startMaintenance(client, { guildId = config.guildId, envFile = process.env.ENV_FILE, limit = 25, intervalMs = 60000 } = {}) {
    if (!scopeEnabled({ guildId, envFile })) return { status: 'DISABLED_OTHER_STORE', workerRunning: false };
    if (!client || typeof client !== 'object' || typeof client.isReady !== 'function') return { status: 'NOT_READY', workerRunning: false };
    if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 300000
      || !Number.isInteger(limit) || limit < 1 || limit > 50) return { status: 'INVALID_REQUEST', workerRunning: false };
    if (maintenance.has(client)) return { status: 'RUNNING', workerRunning: true };
    let timer, stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true; clearTimeout(timer);
      client.off?.('invalidated', stop);
      maintenance.delete(client);
    };
    const schedule = () => { timer = setTimeout(tick, intervalMs); timer.unref?.(); };
    const tick = async () => {
      if (stopped) return;
      if (!scopeEnabled({ guildId, envFile })) { stop(); return; }
      // Discord can reconnect without another once(ClientReady) callback.
      // Pause sends while disconnected and retain the bounded unref monitor.
      if (!client.isReady()) { schedule(); return; }
      try { await repair(client, { guildId, envFile, limit }); } catch { /* Durable notice rows remain retryable. */ }
      if (!stopped) schedule();
    };
    maintenance.set(client, { stop });
    client.once?.('invalidated', stop);
    schedule();
    return { status: 'RUNNING', workerRunning: true };
  }
  return Object.freeze({ send, repair, getContext, registerOrigin, getHealth: () => health, startMaintenance, stopMaintenance });
}

const singleton = createSupplierAutobuyTicketNoticeService();
export const sendSupplierTicketOrderNotice = input => singleton.send(input);
export const registerSupplierTicketOrderOrigin = input => singleton.registerOrigin(input);
export const repairSupplierTicketOrderNotices = (client, options) => singleton.repair(client, options);
export const getSupplierTicketOrderNoticeContext = input => singleton.getContext(input);
export const getSupplierTicketOrderNoticeHealth = () => singleton.getHealth();
export const startSupplierTicketNoticeMaintenance = (client, options) => singleton.startMaintenance(client, options);
export const stopSupplierTicketNoticeMaintenance = client => singleton.stopMaintenance(client);

import { createHash, randomUUID } from 'node:crypto';
import { ChannelType, PermissionFlagsBits, escapeMarkdown } from 'discord.js';
import { db } from '../database/db.js';
import { config } from '../config.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { supplierProviderForProductKey } from '../utils/supplierProvider.js';
import { getGuildConfig } from './guildConfigService.js';
import { syncCustomerRolesNow } from './customerRoleSyncService.js';
import { recordStaffLog } from './staffLogService.js';
import { updateOrderLogMessage } from './notificationService.js';
import { buildPaymentSuccessEmbed, buildPaymentSuccessDmEmbed } from '../utils/embeds.js';
import { formatCurrency } from '../utils/formatters.js';
import { buildLegacyFeatureCard } from '../utils/featureCard.js';
import { stripPresentationEmoji, withUniqueCustomEmoji } from '../utils/uniqueCustomEmoji.js';

const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const noMentions = Object.freeze({ parse: [], users: [], roles: [], repliedUser: false });
const displayText = value => escapeMarkdown(stripPresentationEmoji(value).replace(/@/g, '＠')
  .replace(/</g, '‹').replace(/>/g, '›').replace(/\s+/g, ' ').trim().slice(0, 500));
const presentationOrder = ({ order, intent }) => ({ ...order,
  product_name: displayText(intent.product_name || order.product_name) || 'Gói AutoBuy', payment_confirmed_at: order.paid_at });
const changed = () => Object.assign(new Error('Supplier payment notice unavailable'), { code: 'NOTICE_IDENTITY_CHANGED' });
const orderFields = ['order_code', 'guild_id', 'customer_id', 'fulfillment_mode', 'quantity', 'total_amount', 'amount_paid',
  'ticket_id', 'ticket_channel_id', 'order_log_channel_id'];
const intentFields = ['provider', 'product_key', 'request_id', 'request_hash', 'quote_id', 'quantity', 'sale_amount'];
const confirmationActions = ['PAYMENT_CONFIRMED_PENDING_DELIVERY', 'PAYMENT_CONFIRMED_RECOVERED', 'PAYMENT_RECEIVED_AFTER_CANCEL', 'PAYMENT_CONFIRMED_MANUAL', 'ORDER_DELIVERED'];
const emptyHealth = () => ({ status: 'UNINITIALIZED', checkedAt: null, pending: 0, sending: 0, sent: 0, unknown: 0, review: 0 });
let paymentNoticeHealth = Object.freeze(emptyHealth());
export const getSupplierPaymentNoticeHealth = () => paymentNoticeHealth;

/** Optional paid notices never own a purchase or delivery/completed notification. */
export function createSupplierPaymentNoticeService({ database = db, now = Date.now,
  scopeEnabled = ({ guildId, client }) => guildId === STORE_ONE_GUILD_ID && config.guildId === guildId
    && process.env.ENV_FILE === '.env' && client?.user?.id === config.clientId,
  settings = getGuildConfig, fulfill = async (client, code) => (await import('./supplierAutobuyOrderService.js')).fulfillSupplierOrder(client, code),
  syncRoles = syncCustomerRolesNow, sendNotice, recordLog = recordStaffLog,
} = {}) {
  let initialized = false;
  const sourceFlights = new Map(), roleFlights = new Map(), noticeFlights = new Map(), maintenance = new WeakMap();
  const stamp = () => new Date(now()).toISOString();
  function publishHealth() {
    try {
      const value = { ...emptyHealth(), status: 'READY', checkedAt: stamp() };
      for (const row of database.prepare('SELECT status,COUNT(*) AS n FROM supplier_autobuy_payment_notices GROUP BY status').all()) {
        const key = String(row.status).toLowerCase(); if (['pending', 'sending', 'sent', 'unknown', 'review'].includes(key)) value[key] = row.n;
      }
      paymentNoticeHealth = Object.freeze(value);
    } catch { paymentNoticeHealth = Object.freeze({ ...emptyHealth(), status: 'UNAVAILABLE', checkedAt: stamp() }); }
  }
  function init() {
    if (initialized) return;
    database.exec(`CREATE TABLE IF NOT EXISTS supplier_autobuy_payment_notices (
      order_code TEXT PRIMARY KEY,guild_id TEXT NOT NULL,customer_id TEXT NOT NULL,provider TEXT NOT NULL,request_id TEXT NOT NULL,
      sale_amount INTEGER NOT NULL,paid_amount INTEGER NOT NULL,identity_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',
      attempt_id TEXT,attempted_at TEXT,updated_at TEXT NOT NULL,ticket_message_id TEXT,dm_message_id TEXT,dm_channel_id TEXT,last_error TEXT);
      UPDATE supplier_autobuy_payment_notices SET status='UNKNOWN',last_error='NOTICE_INTERRUPTED' WHERE status='SENDING';`);
    database.exec('CREATE TABLE IF NOT EXISTS supplier_autobuy_payment_notice_boundary(id INTEGER PRIMARY KEY CHECK(id=1),after_event_id INTEGER NOT NULL)');
    const hasEvents = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='payment_events'").get();
    if (hasEvents) database.prepare(`INSERT INTO supplier_autobuy_payment_notice_boundary(id,after_event_id)
      SELECT 1,COALESCE(MAX(id),0) FROM payment_events WHERE 1=1 ON CONFLICT(id) DO NOTHING`).run();
    initialized = true;
    publishHealth();
  }
  const get = code => { init(); return database.prepare('SELECT * FROM supplier_autobuy_payment_notices WHERE order_code=?').get(code); };
  function capture(code) {
    const order = database.prepare('SELECT * FROM orders WHERE order_code=?').get(code);
    const table = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='supplier_autobuy_intents'").get();
    const intent = table && database.prepare('SELECT * FROM supplier_autobuy_intents WHERE order_code=?').get(code);
    if (!order || order.fulfillment_mode !== 'SUPPLIER' || order.payment_status !== 'PAID'
      || !positive(order.total_amount) || !positive(order.amount_paid) || order.amount_paid < order.total_amount
      || !intent || intent.guild_id !== order.guild_id || intent.customer_id !== order.customer_id
      || !['cdkvietnam', 'dopermind'].includes(intent.provider) || supplierProviderForProductKey(intent.product_key) !== intent.provider
      || intent.sale_amount !== order.total_amount || intent.quantity !== order.quantity
      || typeof intent.request_id !== 'string' || !intent.request_id.trim()) throw changed();
    const identity = { order: Object.fromEntries(orderFields.map(key => [key, order[key]])),
      intent: Object.fromEntries(intentFields.map(key => [key, intent[key]])) };
    return { order, intent, identityJson: JSON.stringify(identity) };
  }
  function current(expected) {
    const value = capture(expected.order_code);
    if (value.identityJson !== expected.identity_json) throw changed();
    return value;
  }
  function ticketFor(order) {
    const ticket = database.prepare('SELECT * FROM tickets WHERE id=?').get(order.ticket_id);
    if (!ticket || ticket.guild_id !== order.guild_id || ticket.customer_id !== order.customer_id
      || ticket.channel_id !== order.ticket_channel_id || ticket.status !== 'OPEN' || ticket.ticket_type !== 'ORDER'
      || !['DISCORD_AUTOBUY', 'DISCORD_ORDER'].includes(ticket.support_source)) throw changed();
    return ticket;
  }
  function hasConfirmation(code) {
    return Boolean(database.prepare(`SELECT 1 FROM staff_logs WHERE related_order_code=? AND action IN (${confirmationActions.map(() => '?').join(',')}) LIMIT 1`)
      .get(code, ...confirmationActions));
  }
  function newReceiptProof(order) {
    const boundary = database.prepare('SELECT after_event_id FROM supplier_autobuy_payment_notice_boundary WHERE id=1').get();
    if (!boundary) return false;
    return Boolean(database.prepare(`SELECT 1 FROM payment_events WHERE order_code=? AND provider='PAYOS'
      AND transaction_id=? AND id>? AND amount>=? LIMIT 1`).get(order.order_code, order.paid_transaction_id, boundary.after_event_id, order.total_amount));
  }
  function enqueue(value, freshReceipt = false) {
    init();
    const result = database.transaction(() => {
      const fresh = capture(value.order.order_code);
      if (fresh.identityJson !== value.identityJson) throw changed();
      const historical = hasConfirmation(fresh.order.order_code) || !freshReceipt && !newReceiptProof(fresh.order);
      const inserted = database.prepare(`INSERT INTO supplier_autobuy_payment_notices
        (order_code,guild_id,customer_id,provider,request_id,sale_amount,paid_amount,identity_json,updated_at,status,last_error)
        VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(order_code) DO NOTHING`).run(fresh.order.order_code, fresh.order.guild_id,
        fresh.order.customer_id, fresh.intent.provider, fresh.intent.request_id, fresh.order.total_amount,
        fresh.order.amount_paid, fresh.identityJson, stamp(), historical ? 'UNKNOWN' : 'PENDING', historical ? 'NOTICE_LEGACY_UNCERTAIN' : null);
      const row = get(fresh.order.order_code);
      if (row.identity_json !== fresh.identityJson) {
        database.prepare("UPDATE supplier_autobuy_payment_notices SET status='REVIEW',last_error='NOTICE_IDENTITY_CHANGED',updated_at=? WHERE order_code=?")
          .run(stamp(), fresh.order.order_code);
        return { mismatch: true };
      }
      if (inserted.changes && !historical) recordLog({ guildId: fresh.order.guild_id, targetId: fresh.order.customer_id,
        action: fresh.order.status === 'CANCELLED' ? 'PAYMENT_RECEIVED_AFTER_CANCEL' : 'PAYMENT_CONFIRMED_PENDING_DELIVERY',
        detail: 'Đã ghi nhận thanh toán AutoBuy; thông báo riêng được xử lý độc lập.', relatedOrderCode: fresh.order.order_code });
      return row;
    }).immediate();
    publishHealth();
    if (result.mismatch) throw changed();
    return result;
  }
  function launch(flights, key, operation) {
    if (flights.has(key)) return flights.get(key);
    const task = Promise.resolve().then(operation).catch(() => {}).finally(() => { if (flights.get(key) === task) flights.delete(key); });
    flights.set(key, task); return task;
  }
  const ready = client => typeof client?.isReady !== 'function' || client.isReady();
  async function defaultSend({ client, expected, assertCurrent, recordReceipt, nonceFor }) {
    let live = assertCurrent();
    const guild = await client.guilds.fetch(live.order.guild_id);
    live = assertCurrent();
    if (guild?.id !== live.order.guild_id || guild.client?.user?.id !== client.user?.id) throw changed();
    const channel = await guild.channels.fetch(live.order.ticket_channel_id, { force: true });
    const privateTicket = () => {
      const value = assertCurrent(); const ticket = ticketFor(value.order);
      const category = settings(value.order.guild_id)?.ticket_category_id;
      if (!snowflake(category) || channel?.id !== value.order.ticket_channel_id || channel.guildId !== value.order.guild_id
        || channel.type !== ChannelType.GuildText || channel.parentId !== category
        || !channel.permissionOverwrites?.cache?.get(value.order.guild_id)?.deny?.has(PermissionFlagsBits.ViewChannel)
        || !channel.permissionOverwrites?.cache?.get(value.order.customer_id)?.allow?.has(PermissionFlagsBits.ViewChannel)
        || !channel.permissionsFor?.(client.user.id)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory])) throw changed();
      if (ticket.support_source === 'DISCORD_AUTOBUY'
        && channel.topic !== `Cenar AutoBuy · customer:${value.order.customer_id} · ticket:${ticket.id}`) throw changed();
      return value;
    };
    live = privateTicket();
    // Staff message edits are idempotent and independent of private receipts.
    void Promise.resolve().then(() => updateOrderLogMessage(guild, assertCurrent().order)).catch(() => {});
    try {
      const payload = withUniqueCustomEmoji(buildPaymentSuccessEmbed(presentationOrder(live), formatCurrency(live.order.amount_paid)),
        { guildId: live.order.guild_id, seed: `supplier-payment:${live.order.order_code}:ticket` });
      const receipt = await channel.send({ ...payload,
        allowedMentions: noMentions, nonce: nonceFor('ticket'), enforceNonce: true });
      if (receipt?.channelId !== undefined && receipt.channelId !== channel.id
        || receipt?.author?.id !== undefined && receipt.author.id !== client.user.id) throw changed();
      recordReceipt('ticket', { messageId: receipt?.id, channelId: channel.id });
    } catch (error) { if (error?.code === 'NOTICE_IDENTITY_CHANGED') throw error; }
    live = privateTicket();
    const customer = await client.users.fetch(live.order.customer_id);
    live = privateTicket();
    if (customer?.id !== live.order.customer_id) throw changed();
    const dm = await customer.createDM();
    live = privateTicket();
    if (dm?.type !== ChannelType.DM || !snowflake(dm.id)
      || (dm.recipientId ?? dm.recipient?.id) !== live.order.customer_id) throw changed();
    try {
      const payload = withUniqueCustomEmoji(buildLegacyFeatureCard({ embeds: [buildPaymentSuccessDmEmbed(presentationOrder(live))], allowedMentions: noMentions }),
        { guildId: live.order.guild_id, seed: `supplier-payment:${live.order.order_code}:dm` });
      const receipt = await dm.send({ ...payload, allowedMentions: noMentions,
        nonce: nonceFor('dm'), enforceNonce: true });
      if (receipt?.channelId !== undefined && receipt.channelId !== dm.id
        || receipt?.author?.id !== undefined && receipt.author.id !== client.user.id) throw changed();
      recordReceipt('dm', { messageId: receipt?.id, channelId: dm.id });
    } catch (error) { if (error?.code === 'NOTICE_IDENTITY_CHANGED') throw error; }
  }
  function process(client, code) {
    return launch(noticeFlights, code, async () => {
      if (!ready(client)) return;
      const row = get(code);
      if (!row || row.status !== 'PENDING' || !scopeEnabled({ guildId: row.guild_id, client })) return;
      let value;
      try { value = current(row); ticketFor(value.order); if (value.order.status === 'CANCELLED') throw changed(); }
      catch { database.prepare("UPDATE supplier_autobuy_payment_notices SET status='REVIEW',last_error='NOTICE_IDENTITY_CHANGED',updated_at=? WHERE order_code=? AND status='PENDING'").run(stamp(), code); publishHealth(); return; }
      const attempt = randomUUID();
      const claim = database.prepare("UPDATE supplier_autobuy_payment_notices SET status='SENDING',attempt_id=?,attempted_at=?,updated_at=? WHERE order_code=? AND status='PENDING'")
        .run(attempt, stamp(), stamp(), code);
      if (!claim.changes) return;
      publishHealth();
      const assertCurrent = () => {
        if (!scopeEnabled({ guildId: row.guild_id, client }) || !ready(client)) throw changed();
        const fresh = current(row); ticketFor(fresh.order);
        if (['CANCELLED', 'REFUNDED'].includes(fresh.order.status)) throw changed();
        return fresh;
      };
      const recordReceipt = (kind, receipt) => {
        if (!['ticket', 'dm'].includes(kind) || !snowflake(receipt?.messageId) || !snowflake(receipt?.channelId)
          || kind === 'ticket' && receipt.channelId !== value.order.ticket_channel_id) return false;
        database.prepare(`UPDATE supplier_autobuy_payment_notices SET ${kind === 'ticket' ? 'ticket_message_id=?' : 'dm_message_id=?,dm_channel_id=?'},updated_at=?
          WHERE order_code=? AND attempt_id=? AND status IN ('SENDING','UNKNOWN')`).run(receipt.messageId,
          ...(kind === 'dm' ? [receipt.channelId] : []), stamp(), code, attempt);
        publishHealth();
        return true;
      };
      let status = 'UNKNOWN', error = 'NOTICE_OUTCOME_UNKNOWN';
      try {
        await (sendNotice || defaultSend)({ client, order: value.order, expected: row, assertCurrent, recordReceipt,
          nonceFor: kind => createHash('sha256').update(`supplier-payment:${code}:${kind}`).digest('hex').slice(0, 24) });
        assertCurrent();
        const receipt = get(code);
        if (snowflake(receipt.ticket_message_id) && snowflake(receipt.dm_message_id) && snowflake(receipt.dm_channel_id)) { status = 'SENT'; error = null; }
      } catch (caught) { if (caught?.code === 'NOTICE_IDENTITY_CHANGED') { status = 'REVIEW'; error = 'NOTICE_IDENTITY_CHANGED'; } }
      database.prepare("UPDATE supplier_autobuy_payment_notices SET status=?,last_error=?,updated_at=? WHERE order_code=? AND attempt_id=? AND status IN ('SENDING','UNKNOWN')")
        .run(status, error, stamp(), code, attempt);
      publishHealth();
    });
  }
  function start({ client, order, freshReceipt = false }) {
    let value;
    try { value = capture(order?.order_code); if (!scopeEnabled({ guildId: value.order.guild_id, client })) return { status: 'DISABLED' }; }
    catch { return { status: 'NOT_ELIGIBLE' }; }
    if (orderFields.some(key => value.order[key] !== order[key])) return { status: 'NOT_ELIGIBLE' };
    const expected = { order_code: value.order.order_code, identity_json: value.identityJson };
    // These tasks are deliberately independent: Discord roles/notices must
    // never hold the supplier's already-paid purchase queue or the response.
    launch(sourceFlights, value.order.order_code, () => { const fresh = current(expected);
      if (['PROCESSING', 'COMPLETED'].includes(fresh.order.status)) return fulfill(client, value.order.order_code); });
    launch(roleFlights, `${value.order.guild_id}:${value.order.customer_id}`, () => { current(expected); return syncRoles(client, value.order.guild_id, value.order.customer_id); });
    try { enqueue(value, freshReceipt); process(client, value.order.order_code); return { status: 'QUEUED' }; }
    catch { return { status: 'NOTICE_ENQUEUE_PENDING' }; }
  }
  function repair(client, { limit = 3 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 5) return { scanned: 0, queued: 0 };
    if (!scopeEnabled({ guildId: STORE_ONE_GUILD_ID, client }) || !ready(client)) return { scanned: 0, queued: 0 };
    init(); let queued = 0;
    const existing = database.prepare("SELECT order_code FROM supplier_autobuy_payment_notices WHERE status='PENDING' ORDER BY updated_at,order_code LIMIT ?").all(limit);
    for (const row of existing) { process(client, row.order_code); queued++; }
    const boundary = database.prepare('SELECT after_event_id FROM supplier_autobuy_payment_notice_boundary WHERE id=1').get();
    if (!boundary) return { scanned: existing.length, queued };
    const missing = database.prepare(`SELECT o.order_code FROM orders o JOIN supplier_autobuy_intents i ON i.order_code=o.order_code
      AND i.guild_id=o.guild_id AND i.customer_id=o.customer_id LEFT JOIN supplier_autobuy_payment_notices n ON n.order_code=o.order_code
      WHERE o.fulfillment_mode='SUPPLIER' AND o.guild_id=? AND o.payment_status='PAID' AND n.order_code IS NULL
      AND o.total_amount=i.sale_amount AND o.quantity=i.quantity AND o.amount_paid>=o.total_amount
      AND EXISTS (SELECT 1 FROM payment_events e WHERE e.order_code=o.order_code AND e.provider='PAYOS'
        AND e.transaction_id=o.paid_transaction_id AND e.id>? AND e.amount>=o.total_amount)
      AND NOT EXISTS (SELECT 1 FROM staff_logs l WHERE l.related_order_code=o.order_code AND l.action IN (${confirmationActions.map(() => '?').join(',')}))
      ORDER BY o.created_at,o.order_code LIMIT ?`).all(STORE_ONE_GUILD_ID, boundary.after_event_id, ...confirmationActions, Math.max(0, limit - existing.length));
    for (const row of missing) { try { enqueue(capture(row.order_code)); process(client, row.order_code); queued++; } catch { /* Paid receipt remains authoritative. */ } }
    return { scanned: existing.length + missing.length, queued };
  }
  function stopMaintenance(client) { maintenance.get(client)?.(); return { status: 'STOPPED' }; }
  function startMaintenance(client, { intervalMs = 60000, limit = 3 } = {}) {
    if (!client || !scopeEnabled({ guildId: STORE_ONE_GUILD_ID, client }) || typeof client.isReady !== 'function') return { status: 'DISABLED' };
    if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 300000 || !Number.isInteger(limit) || limit < 1 || limit > 5) return { status: 'INVALID_REQUEST' };
    if (maintenance.has(client)) return { status: 'RUNNING' };
    init();
    let timer, stopped = false;
    const schedule = () => { timer = setTimeout(tick, intervalMs); timer.unref?.(); };
    const stop = () => { stopped = true; clearTimeout(timer); client.off?.('invalidated', stop); maintenance.delete(client); };
    const tick = () => { if (stopped) return; if (client.token === null || !scopeEnabled({ guildId: STORE_ONE_GUILD_ID, client })) { stop(); return; }
      try { if (ready(client)) repair(client, { limit }); } catch { /* Local pending rows remain repairable. */ } schedule(); };
    maintenance.set(client, stop); client.once?.('invalidated', stop); schedule(); return { status: 'RUNNING' };
  }
  return { start, repair, startMaintenance, stopMaintenance, get, prepare: init };
}
const singleton = createSupplierPaymentNoticeService();
export const startSupplierPaymentEffects = input => singleton.start(input);
export const repairSupplierPaymentNotices = (client, options) => singleton.repair(client, options);
export const startSupplierPaymentNoticeMaintenance = (client, options) => singleton.startMaintenance(client, options);
export const stopSupplierPaymentNoticeMaintenance = client => singleton.stopMaintenance(client);

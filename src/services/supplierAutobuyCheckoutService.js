import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { db } from '../database/db.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { TICKET_MEMBER_PERMISSIONS } from '../utils/permissions.js';
import { getGuildConfig } from './guildConfigService.js';
import { getCustomerFlag, getTicketMuteStatus } from './blacklistService.js';
import { createTicket, getOpenTicketByCustomer } from './ticketService.js';
import { getOrderByCode, payOrderWithWallet, saveOrderLogMessage } from './orderService.js';
import { createOrLoadPayOSLink, syncPaymentStatusFromPayOS } from './paymentService.js';
import { supplierSalesConfigured } from './supplierAutobuyCatalogService.js';
import { buildOrderLogV2Update } from '../utils/embeds.js';

export class SupplierCheckoutError extends Error {
  constructor(code) { super('Chưa thể tiếp tục thanh toán. Vui lòng kiểm tra trạng thái đơn hoặc tạo ticket hỗ trợ.'); this.name = 'SupplierCheckoutError'; this.code = code; }
}
const deny = code => { throw new SupplierCheckoutError(code); };
const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);

async function publishSupplierOrderLog(client, order) {
  const guild = await client?.guilds.fetch(order.guild_id).catch(() => null);
  const channel = await guild?.channels.fetch(order.order_log_channel_id).catch(() => null);
  if (!channel?.isTextBased()) throw new Error('ORDER_LOG_UNAVAILABLE');
  const sent = await channel.send({ ...buildOrderLogV2Update(order), allowedMentions: { parse: [] },
    nonce: `autobuy-${order.order_code}`, enforceNonce: true });
  saveOrderLogMessage(order.order_code, sent.id);
}

/** Existing payment/ledger boundaries; provider purchases remain in its own worker. */
export function createSupplierAutobuyCheckout({
  database = db, enabled = () => supplierSalesConfigured(), engine = () => import('./supplierAutobuyOrderService.js'),
  guildConfig = getGuildConfig, customerFlag = getCustomerFlag, ticketMute = getTicketMuteStatus,
  findOpenTicket = getOpenTicketByCustomer, insertTicket = createTicket,
  readOrder = getOrderByCode, debitWallet = payOrderWithWallet, payosLink = createOrLoadPayOSLink,
  syncPayos = syncPaymentStatusFromPayOS, publishOrder = publishSupplierOrderLog,
} = {}) {
  const ticketFlights = new Map(), paymentFlights = new Map();
  let paymentTurn = Promise.resolve();
  let initialized = false;
  function initialize() {
    if (initialized) return;
    database.exec(`CREATE TABLE IF NOT EXISTS supplier_autobuy_payment_methods (
      order_code TEXT PRIMARY KEY, method TEXT NOT NULL CHECK(method IN ('PAYOS','WALLET')), created_at TEXT NOT NULL
    ); CREATE TABLE IF NOT EXISTS supplier_autobuy_ticket_creates (
      ticket_id INTEGER PRIMARY KEY, attempted INTEGER NOT NULL DEFAULT 0
    ); CREATE TABLE IF NOT EXISTS supplier_autobuy_order_notices (
      order_code TEXT PRIMARY KEY, attempted_at TEXT NOT NULL
    );`);
    initialized = true;
  }
  async function notifyCreated(client, code) {
    const order = readOrder(code);
    if (!order || order.fulfillment_mode !== 'SUPPLIER' || order.order_log_message_id) return;
    // Claim before sending. Unknown Discord outcomes never cause a second post;
    // the normal staff repair flow can recreate a missing processing card.
    const claim = database.prepare('INSERT INTO supplier_autobuy_order_notices VALUES (?,?) ON CONFLICT(order_code) DO NOTHING')
      .run(code, new Date().toISOString());
    if (!claim.changes) return;
    await publishOrder(client, order).catch(() => {});
  }
  const service = async () => typeof engine === 'function' ? engine() : engine;
  function guard(guildId, customerId, newSale = true) {
    if ((newSale && !enabled()) || guildId !== STORE_ONE_GUILD_ID || !snowflake(customerId)) deny('AUTOBUY_DISABLED');
    if (Number(customerFlag(guildId, customerId)?.is_blacklisted) === 1 || ticketMute(guildId, customerId)?.is_ticket_muted) deny('CUSTOMER_RESTRICTED');
    initialize();
  }
  function privateChannel(channel, customerId) {
    return channel?.type === ChannelType.GuildText && channel.guildId === STORE_ONE_GUILD_ID
      && channel.permissionOverwrites?.cache?.get(STORE_ONE_GUILD_ID)?.deny?.has(PermissionFlagsBits.ViewChannel)
      && channel.permissionOverwrites?.cache?.get(customerId)?.allow?.has(PermissionFlagsBits.ViewChannel);
  }
  async function ensureTicket(client, guildId, customerId, quoteId) {
    const key = `${guildId}:${customerId}`;
    if (ticketFlights.has(key)) return ticketFlights.get(key);
    const task = Promise.resolve().then(async () => {
      const settings = guildConfig(guildId);
      if (!settings?.ticket_category_id || !settings?.order_log_channel_id) deny('TICKET_NOT_CONFIGURED');
      const guild = await client?.guilds.fetch(guildId).catch(() => null);
      if (!guild || guild.id !== guildId || !snowflake(client.user?.id)) deny('GUILD_UNAVAILABLE');
      const member = await guild.members.fetch({ user: customerId, force: true }).catch(() => null);
      if (!member) deny('MEMBER_UNAVAILABLE');
      const ticket = database.transaction(() => findOpenTicket(guildId, customerId, 'ORDER') || insertTicket({
        guildId, customerId, channelId: `autobuy-pending-${customerId}`, openedById: customerId,
        ticketType: 'ORDER', supportSource: 'DISCORD_AUTOBUY', clientRequestId: `autobuy-ticket:${quoteId}`,
      })).immediate();
      if (/^\d{17,20}$/.test(String(ticket.channel_id))) {
        const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
        if (!privateChannel(channel, customerId)) deny('TICKET_ACCESS_UNVERIFIED');
        return { ticket, guild, settings };
      }
      if (ticket.channel_id !== `autobuy-pending-${customerId}`) deny('TICKET_SETUP_PENDING');
      const inventory = await guild.channels.fetch();
      const parent = inventory.get(settings.ticket_category_id);
      if (parent?.type !== ChannelType.GuildCategory) deny('TICKET_NOT_CONFIGURED');
      const topic = `Cenar AutoBuy · customer:${customerId} · ticket:${ticket.id}`;
      const matches = [...inventory.values()].filter(channel => channel.type === ChannelType.GuildText && channel.topic === topic);
      if (matches.length > 1) deny('TICKET_SETUP_AMBIGUOUS');
      let channel = matches[0];
      if (channel && (!privateChannel(channel, customerId) || channel.parentId !== parent.id)) deny('TICKET_ACCESS_UNVERIFIED');
      if (!channel) {
        const attempt = database.prepare('SELECT attempted FROM supplier_autobuy_ticket_creates WHERE ticket_id=?').get(ticket.id);
        if (attempt?.attempted) deny('TICKET_CREATION_UNCERTAIN');
        const overwrites = [
          { id: guildId, deny: [PermissionFlagsBits.ViewChannel] },
          { id: customerId, allow: TICKET_MEMBER_PERMISSIONS },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageChannels] },
        ];
        if (snowflake(settings.support_role_id)) overwrites.push({ id: settings.support_role_id, allow: TICKET_MEMBER_PERMISSIONS });
        const createClaim = database.prepare('INSERT INTO supplier_autobuy_ticket_creates (ticket_id,attempted) VALUES (?,1) ON CONFLICT(ticket_id) DO NOTHING').run(ticket.id);
        if (!createClaim.changes) deny('TICKET_CREATION_UNCERTAIN');
        try {
          channel = await guild.channels.create({ name: `autobuy-${ticket.ticket_code.toLowerCase()}`, type: ChannelType.GuildText,
            parent: parent.id, topic, permissionOverwrites: overwrites, reason: 'Customer confirmed an AutoBuy quote' });
        } catch { deny('TICKET_CREATION_UNCERTAIN'); }
        if (!privateChannel(channel, customerId)) deny('TICKET_ACCESS_UNVERIFIED');
      }
      const saved = database.prepare('UPDATE tickets SET channel_id=? WHERE id=? AND channel_id=?').run(channel.id, ticket.id, ticket.channel_id);
      if (saved.changes !== 1) deny('TICKET_SETUP_PENDING');
      return { ticket: { ...ticket, channel_id: channel.id }, guild, settings };
    }).finally(() => ticketFlights.delete(key));
    ticketFlights.set(key, task);
    return task;
  }
  async function confirm({ client, guildId, customerId, quoteId }) {
    guard(guildId, customerId);
    const orders = await service();
    const quote = await orders.getSupplierQuoteForCustomer({ guildId, customerId, quoteId });
    if (quote?.orderCode) {
      await notifyCreated(client, quote.orderCode);
      return orders.getSupplierOrderForCustomer({ guildId, customerId, orderCode: quote.orderCode });
    }
    const { ticket, settings } = await ensureTicket(client, guildId, customerId, quoteId);
    guard(guildId, customerId);
    const confirmed = await orders.confirmSupplierCheckout({ guildId, customerId, quoteId, ticketId: ticket.id,
      ticketChannelId: ticket.channel_id, orderLogChannelId: settings.order_log_channel_id, createdById: client.user.id });
    await notifyCreated(client, confirmed.orderCode);
    return confirmed;
  }
  async function payment({ client, guildId, customerId, orderCode, method }) {
    guard(guildId, customerId);
    method = typeof method === 'string' ? method.toUpperCase() : '';
    if (!['PAYOS', 'WALLET'].includes(method)) deny('INVALID_PAYMENT_METHOD');
    const key = `${guildId}:${customerId}:${orderCode}`;
    if (paymentFlights.has(key)) return paymentFlights.get(key);
    const task = paymentTurn.then(async () => {
      const orders = await service();
      const own = await orders.getSupplierOrderForCustomer({ guildId, customerId, orderCode });
      let order = readOrder(orderCode);
      if (!own || !order || order.guild_id !== guildId || order.customer_id !== customerId || order.fulfillment_mode !== 'SUPPLIER') deny('ORDER_NOT_FOUND');
      if (order.payment_status === 'PAID') return { orderCode, method, paid: true, status: own.status || order.status };
      if (order.status !== 'PENDING_PAYMENT' || order.payment_status !== 'UNPAID') deny('ORDER_NOT_PAYABLE');
      const insertedChoice = database.transaction(() => {
        const current = readOrder(orderCode);
        if (current.payment_status === 'PAID') return false;
        const chosen = database.prepare('SELECT method FROM supplier_autobuy_payment_methods WHERE order_code=?').get(orderCode);
        if (chosen && chosen.method !== method) deny('PAYMENT_METHOD_LOCKED');
        return database.prepare('INSERT INTO supplier_autobuy_payment_methods (order_code,method,created_at) VALUES (?,?,?) ON CONFLICT(order_code) DO NOTHING')
          .run(orderCode, method, new Date().toISOString()).changes === 1;
      }).immediate();
      order = readOrder(orderCode);
      if (order.payment_status === 'PAID') return { orderCode, method, paid: true, status: order.status };
      try { await orders.validateSupplierOrderForPayment({ guildId, customerId, orderCode }); }
      catch (error) {
        // No invoice/debit was attempted by this new method claim. A previous
        // uncertain PayOS claim is retained so another method cannot race it.
        if (insertedChoice) database.prepare(`DELETE FROM supplier_autobuy_payment_methods WHERE order_code=?
          AND EXISTS (SELECT 1 FROM orders WHERE order_code=? AND payment_status='UNPAID' AND payment_link_id IS NULL)`).run(orderCode, orderCode);
        throw error;
      }
      if (method === 'WALLET') {
        try { order = debitWallet({ orderCode, guildId, customerId, amount: order.total_amount }).order; }
        catch (error) {
          if (error?.code === 'INSUFFICIENT_BALANCE') database.prepare(`DELETE FROM supplier_autobuy_payment_methods
            WHERE order_code=? AND method='WALLET' AND EXISTS (SELECT 1 FROM orders WHERE order_code=? AND payment_status='UNPAID')`).run(orderCode, orderCode);
          throw error;
        }
        const result = await orders.fulfillSupplierOrder(client, orderCode);
        return { orderCode, method, paid: true, status: result.updated?.status || order.status };
      }
      const linked = await payosLink(order);
      return { orderCode, method, paid: false, status: 'PENDING_PAYMENT', checkoutUrl: linked.payment_checkout_url, qrCode: linked.payment_qr_code || linked.payment_qr_text };
    }).finally(() => paymentFlights.delete(key));
    paymentTurn = task.catch(() => {});
    paymentFlights.set(key, task);
    return task;
  }
  async function status({ client, guildId, customerId, orderCode }) {
    guard(guildId, customerId, false);
    const orders = await service();
    await orders.getSupplierOrderForCustomer({ guildId, customerId, orderCode });
    const current = readOrder(orderCode);
    if (client && current?.status === 'PENDING_PAYMENT' && current.payment_link_id) {
      await syncPayos({ client, orderCode }).catch(() => null);
    }
    return orders.getSupplierOrderForCustomer({ guildId, customerId, orderCode });
  }
  return { confirm, payment, status };
}
const singleton = createSupplierAutobuyCheckout();
export const confirmSupplierCheckoutWithTicket = args => singleton.confirm(args);
export const createSupplierPayment = args => singleton.payment(args);
export const getSupplierCheckoutStatus = args => singleton.status(args);

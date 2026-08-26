import { db, nowIso } from '../database/db.js';
import { randomDigits } from '../utils/id.js';
import { addMinutes } from '../utils/time.js';

function createTicketStmt(){return db.prepare(`INSERT INTO tickets (ticket_code,guild_id,channel_id,customer_id,opened_by_id,ticket_type,related_order_code,ticket_subject,support_source,client_request_id,last_activity_at,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'OPEN',?)`);}
function ticketCodeExistsStmt(){return db.prepare('SELECT 1 FROM tickets WHERE ticket_code=? LIMIT 1');}
function getTicketByChannelStmt(){return db.prepare('SELECT * FROM tickets WHERE channel_id=?');}
function getOpenTicketByCustomerStmt(){return db.prepare(`SELECT * FROM tickets WHERE guild_id=? AND customer_id=? AND ticket_type=? AND status='OPEN' ORDER BY id DESC LIMIT 1`);}
function getOpenWarrantyTicketStmt(){return db.prepare(`SELECT * FROM tickets WHERE guild_id=? AND customer_id=? AND ticket_type='WARRANTY' AND related_order_code=? AND status='OPEN' ORDER BY id DESC LIMIT 1`);}
function closeTicketStmt(){return db.prepare(`UPDATE tickets SET status='CLOSED', closed_at=?, closed_by_id=? WHERE id=?`);}
function closeOpenTicketStmt(){return db.prepare(`UPDATE tickets SET status='CLOSED', closed_at=?, closed_by_id=? WHERE id=? AND status!='CLOSED'`);}
function reopenTicketStmt(){return db.prepare(`UPDATE tickets SET status='OPEN', closed_at=NULL, closed_by_id=NULL WHERE id=?`);}
function getTicketByIdStmt(){return db.prepare('SELECT * FROM tickets WHERE id=?');}
function scheduleAutoCloseStmt(){return db.prepare(`UPDATE tickets SET auto_close_at=?, keep_open_requested=0 WHERE id=?`);}
function clearAutoCloseStmt(){return db.prepare(`UPDATE tickets SET auto_close_at=NULL, keep_open_requested=1 WHERE id=?`);}
function dueAutoCloseTicketsStmt(){return db.prepare(`SELECT * FROM tickets WHERE guild_id=? AND status='OPEN' AND auto_close_at IS NOT NULL AND keep_open_requested=0 AND datetime(auto_close_at) <= datetime(?) ORDER BY auto_close_at ASC LIMIT ?`);}
function updateTicketAiStatusStmt(){return db.prepare(`UPDATE tickets SET ai_status=? WHERE id=?`);}
function getTicketByClientRequestIdStmt(){return db.prepare('SELECT * FROM tickets WHERE client_request_id=? LIMIT 1');}
function getOpenWebsiteSupportStmt(){return db.prepare(`SELECT * FROM tickets WHERE guild_id=? AND customer_id=? AND ticket_type='SUPPORT' AND support_source='WEBSITE_AI' AND status='OPEN' ORDER BY id DESC LIMIT 1`);}
function touchTicketStmt(){return db.prepare('UPDATE tickets SET last_activity_at=? WHERE id=?');}
function getOpenTicketForOrderStmt(){return db.prepare(`
  SELECT * FROM tickets
  WHERE guild_id=@guildId AND status='OPEN' AND (
    (@ticketId IS NOT NULL AND id=@ticketId)
    OR (@channelId != '' AND channel_id=@channelId)
    OR (@orderCode != '' AND related_order_code=@orderCode)
  )
  ORDER BY CASE
    WHEN @ticketId IS NOT NULL AND id=@ticketId THEN 0
    WHEN @channelId != '' AND channel_id=@channelId THEN 1
    ELSE 2
  END, id DESC
  LIMIT 1
`);}
function getFeedbackedTicketsMissingAutoCloseStmt(){return db.prepare(`
  SELECT t.* FROM tickets t
  WHERE t.guild_id=?
    AND t.status='OPEN'
    AND t.auto_close_at IS NULL
    AND COALESCE(t.keep_open_requested, 0)=0
    AND EXISTS (
      SELECT 1 FROM orders o
      WHERE o.guild_id=t.guild_id
        AND o.status='COMPLETED'
        AND o.feedback_submitted_at IS NOT NULL
        AND (
          o.ticket_id=t.id
          OR o.ticket_channel_id=t.channel_id
          OR (t.related_order_code IS NOT NULL AND t.related_order_code=o.order_code)
        )
    )
  ORDER BY t.id ASC
  LIMIT ?
`);}


function generateTicketCode(){while(true){const c=`TKT_${randomDigits(6)}`; if(!ticketCodeExistsStmt().get(c)) return c;}}

export function createTicket({
  guildId,
  channelId,
  customerId,
  openedById,
  ticketType='ORDER',
  relatedOrderCode=null,
  ticketSubject=null,
  supportSource=(['ORDER', 'WARRANTY'].includes(ticketType) ? 'DISCORD_ORDER' : 'DISCORD_SUPPORT'),
  clientRequestId=null,
}) {
  const createdAt = nowIso(); const ticketCode = generateTicketCode();
  const result = createTicketStmt().run(
    ticketCode,
    guildId,
    channelId,
    customerId,
    openedById,
    ticketType,
    relatedOrderCode,
    ticketSubject,
    supportSource,
    clientRequestId,
    createdAt,
    createdAt,
  );
  return getTicketById(Number(result.lastInsertRowid));
}

const reserveWebsiteSupportTransaction = db.transaction(({ guildId, customerId, contact, clientRequestId }) => {
  if (clientRequestId) {
    const requested = getTicketByClientRequestIdStmt().get(clientRequestId);
    if (requested) return { ticket: requested, reused: true };
  }

  const openTicket = getOpenWebsiteSupportStmt().get(guildId, customerId);
  if (openTicket) return { ticket: openTicket, reused: true };

  const placeholder = `web-pending-${customerId}-${randomDigits(6)}`;
  return {
    ticket: createTicket({
      guildId,
      channelId: placeholder,
      customerId,
      openedById: customerId,
      ticketType: 'SUPPORT',
      ticketSubject: contact,
      supportSource: 'WEBSITE_AI',
      clientRequestId,
    }),
    reused: false,
  };
});

export function reserveWebsiteSupportTicket(input) {
  return reserveWebsiteSupportTransaction(input);
}
export const getTicketByChannelId = (channelId) => getTicketByChannelStmt().get(channelId) ?? null;
export const getOpenTicketByCustomer = (guildId, customerId, ticketType='ORDER') => getOpenTicketByCustomerStmt().get(guildId, customerId, ticketType) ?? null;
export const getOpenWarrantyTicket = (guildId, customerId, orderCode) => getOpenWarrantyTicketStmt().get(guildId, customerId, orderCode) ?? null;
export function closeTicket(ticketId, closedById){closeTicketStmt().run(nowIso(), closedById, ticketId); return getTicketById(ticketId);}
export function closeTicketIfOpen(ticketId, closedById){
  const result = closeOpenTicketStmt().run(nowIso(), closedById, ticketId);
  return { closed: result.changes > 0, ticket: getTicketById(ticketId) };
}
export function reopenTicket(ticketId){reopenTicketStmt().run(ticketId); return getTicketById(ticketId);}
export const getTicketById = (ticketId) => getTicketByIdStmt().get(ticketId) ?? null;
export function scheduleTicketAutoClose(ticketId, minutes=5){const at=addMinutes(new Date(), minutes).toISOString(); scheduleAutoCloseStmt().run(at, ticketId); return getTicketById(ticketId);}
export function keepTicketOpen(ticketId){clearAutoCloseStmt().run(ticketId); return getTicketById(ticketId);}
export const getDueAutoCloseTickets = (guildId, limit=20) => dueAutoCloseTicketsStmt().all(guildId, nowIso(), limit);
export function getOpenTicketForOrder(order) {
  if (!order?.guild_id) return null;
  return getOpenTicketForOrderStmt().get({
    guildId: String(order.guild_id),
    ticketId: Number.isInteger(Number(order.ticket_id)) && Number(order.ticket_id) > 0
      ? Number(order.ticket_id)
      : null,
    channelId: String(order.ticket_channel_id || ''),
    orderCode: String(order.order_code || ''),
  }) ?? null;
}
export function scheduleOrderTicketAutoClose(order, minutes=5) {
  const ticket = getOpenTicketForOrder(order);
  return ticket ? scheduleTicketAutoClose(ticket.id, minutes) : null;
}
export function scheduleMissingFeedbackTicketAutoCloses(guildId, limit=100) {
  const tickets = getFeedbackedTicketsMissingAutoCloseStmt().all(String(guildId), Number(limit));
  return tickets.map((ticket) => scheduleTicketAutoClose(ticket.id, 0));
}
export function updateTicketAiStatus(ticketId, status){updateTicketAiStatusStmt().run(status, ticketId); return getTicketById(ticketId);}
export function touchTicket(ticketId){touchTicketStmt().run(nowIso(), ticketId); return getTicketById(ticketId);}

export function isTicketChannel(channel, guildConfig) {
  if (!channel) return false;
  const name = channel.name || '';
  
  // 1. Check if registered in database
  const ticket = getTicketByChannelId(channel.id);
  if (ticket) return true;

  // 2. Check if inside ticket categories
  const parentId = channel.parentId;
  if (parentId && guildConfig) {
    const ticketCategories = [
      guildConfig.ticket_category_id,
      guildConfig.support_category_id,
      guildConfig.complaint_category_id,
      guildConfig.partnership_category_id,
      guildConfig.warranty_category_id
    ].filter(Boolean);
    if (ticketCategories.includes(parentId)) return true;
  }

  // 3. Fallback check for common prefixes
  const prefixes = ['ticket-', 'bao-hanh-', 'closed-', 'nitro-', 'netflix-', 'spotify-', 'ai-', 'game-', 'gearup-', 'capcut-', 'adobe-', 'office-', 'gemini-', 'gpt-'];
  if (prefixes.some(prefix => name.startsWith(prefix))) return true;

  return false;
}


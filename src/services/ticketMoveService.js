// /chuyen-ticket: staff re-file a ticket the customer opened under the wrong section
// (typically a "Hỗ trợ" ticket for an order that needs warranty). Planning is pure and
// validated against the database; the command applies the Discord side effects.
import { buildTicketChannelName, buildWarrantyChannelName } from '../utils/formatters.js';

export class TicketMoveError extends Error {}
const fail = (message) => { throw new TicketMoveError(message); };

export const TICKET_MOVE_TYPES = Object.freeze({
  WARRANTY: { label: 'Bảo hành', needsOrder: true },
  ORDER: { label: 'Đơn hàng', needsOrder: false },
  SUPPORT: { label: 'Hỗ trợ', needsOrder: false },
  COMPLAINT: { label: 'Khiếu nại', needsOrder: false },
  PARTNERSHIP: { label: 'Hợp tác', needsOrder: false },
});

const WARRANTY_STATUSES = new Set(['COMPLETED', 'WARRANTY_OPEN']);

/** Order codes written in messages: "CN_123456", "cn-123456", "CN 123456" → CN_123456. */
export function findOrderCodes(text) {
  const codes = new Set();
  for (const match of String(text ?? '').matchAll(/\b(CN|CR)[\s_-]?(\d{6})\b/gi)) codes.add(`${match[1].toUpperCase()}_${match[2]}`);
  return [...codes];
}

export function normalizeOrderCode(value) {
  return findOrderCodes(value)[0] ?? null;
}

/** Channel name after the move. Product-prefixed order tickets (nitro-…, gpt-…) keep their name. */
export function movedChannelName({ ticket, channelName, targetType, orderCode }) {
  if (targetType === 'WARRANTY') return buildWarrantyChannelName(orderCode);
  const name = String(channelName ?? '');
  if (/^bao-hanh-/.test(name) || /^ticket-/.test(name) || !name) return buildTicketChannelName(ticket.ticket_code, 'ticket');
  return name;
}

export const supportSourceFor = (type) => (['ORDER', 'WARRANTY'].includes(type) ? 'DISCORD_ORDER' : 'DISCORD_SUPPORT');

/**
 * Validate a move and work out the order to link. `messageCodes` are order codes found in the
 * ticket history; only codes that belong to this customer in this shop are considered.
 */
export function planTicketMove(db, { ticket, guildId, targetType, orderCode = null, messageCodes = [] }) {
  const target = TICKET_MOVE_TYPES[targetType];
  if (!target) fail('Loại ticket không hợp lệ.');
  if (!ticket || ticket.guild_id !== guildId) fail('Kênh này không phải ticket của shop.');
  if (ticket.status !== 'OPEN') fail('Ticket đã đóng. Mở lại ticket trước khi chuyển.');
  if (/^(web|live)-/.test(ticket.channel_id) || /^WEBSITE/.test(ticket.support_source ?? '')) fail('Ticket từ website không chuyển mục trên Discord được.');
  if (['BOOKING', 'HOST_APPLICATION', 'APPEAL'].includes(ticket.ticket_type)) fail('Ticket Booking/kháng nghị có luồng riêng, không chuyển được.');

  const ownOrder = (code) => db.prepare('SELECT * FROM orders WHERE order_code = ? AND guild_id = ?').get(code, guildId);
  let code = null;
  let detected = false;
  if (orderCode) {
    code = normalizeOrderCode(orderCode);
    if (!code) fail(`Mã đơn \`${String(orderCode).slice(0, 20)}\` không đúng dạng CN_123456.`);
  } else if (target.needsOrder || targetType === 'ORDER') {
    const mine = messageCodes.filter((c) => ownOrder(c)?.customer_id === ticket.customer_id);
    if (mine.length === 1) { [code] = mine; detected = true; }
    else if (mine.length > 1) fail(`Khách nhắc nhiều đơn trong ticket: ${mine.map((c) => `\`${c}\``).join(', ')}. Chọn một đơn bằng tùy chọn \`ma_don\`.`);
    else if (target.needsOrder) fail('Chưa tìm thấy mã đơn của khách trong ticket. Nhập mã bằng tùy chọn `ma_don`.');
  }

  const order = code ? ownOrder(code) : null;
  if (code && !order) fail(`Không tìm thấy đơn \`${code}\` trong shop này.`);
  if (order && order.customer_id !== ticket.customer_id) fail(`Đơn \`${code}\` không thuộc khách của ticket này.`);
  if (targetType === 'WARRANTY') {
    if (!WARRANTY_STATUSES.has(order.status)) fail(`Đơn \`${code}\` đang ở trạng thái \`${order.status}\`. Chỉ mở bảo hành cho đơn đã hoàn thành.`);
    const other = db.prepare(`SELECT channel_id FROM tickets WHERE guild_id=? AND ticket_type='WARRANTY' AND related_order_code=?
      AND status='OPEN' AND id != ?`).get(guildId, code, ticket.id);
    if (other) fail(`Đơn \`${code}\` đã có ticket bảo hành đang mở: <#${other.channel_id}>.`);
  }
  // Without a new code the ticket keeps the order it was already linked to (context for staff).
  const linked = code ?? ticket.related_order_code ?? null;
  const unchanged = ticket.ticket_type === targetType && (ticket.related_order_code ?? null) === (linked ?? null);
  // Leaving a warranty ticket hands the order back, exactly like closing it does.
  const releaseWarranty = ticket.ticket_type === 'WARRANTY' && ticket.related_order_code
    && (targetType !== 'WARRANTY' || ticket.related_order_code !== code) ? ticket.related_order_code : null;
  return { targetType, label: target.label, order, orderCode: linked, detected, unchanged, releaseWarranty,
    fromType: ticket.ticket_type, fromLabel: TICKET_MOVE_TYPES[ticket.ticket_type]?.label ?? ticket.ticket_type };
}

export function applyTicketMove(db, { ticket, plan }) {
  db.prepare(`UPDATE tickets SET ticket_type = ?, related_order_code = ?, support_source = ? WHERE id = ? AND status = 'OPEN'`)
    .run(plan.targetType, plan.orderCode ?? null, supportSourceFor(plan.targetType), ticket.id);
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticket.id);
}

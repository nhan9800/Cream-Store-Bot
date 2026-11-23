import { STORE_TWO_GUILD_ID } from '../utils/locale.js';
import { isBoundBookingOrder, isPaidBookingInvoice } from './bookingPaymentEvidence.js';

const receiptPreviews = {
  BOOKING: { code: 'MAU-BOOKING', amount: 89_000, description: 'Mẫu hóa đơn đặt lịch', service: 'voice', durationMinutes: 60 },
  DEPOSIT: { code: 'MAU-NAP', amount: 150_000, description: 'Mẫu chứng từ nạp tiền' },
  DONATION: { code: 'MAU-UNG-HO', amount: 50_000, description: 'Mẫu chứng từ ủng hộ' },
  REFUND: { code: 'MAU-HOAN', amount: 89_000, description: 'Mẫu chứng từ hoàn tiền' },
};
const stoppedOrderStates = new Set(['CANCELLED', 'FAILED']);
const unavailableBookingStates = new Set(['DECLINED', 'COMPLETED', 'NEEDS_REVIEW']);

export function bookingReceiptPreview(kind) {
  if (typeof kind !== 'string' || !Object.hasOwn(receiptPreviews, kind)) return null;
  return { ...receiptPreviews[kind], kind, status: 'PREVIEW', issuedAt: null, paidAt: null, preview: true };
}

function receiptStatus(db, order, invoice, session, at) {
  if (invoice.status === 'FREE') {
    return invoice.amount === 0 && invoice.order_id === null ? 'FREE' : 'NEEDS_REVIEW';
  }
  if (!isBoundBookingOrder(order, invoice, session)) return 'NEEDS_REVIEW';
  if (invoice.status === 'PAID') return isPaidBookingInvoice(db, order, invoice, session) ? 'PAID' : 'NEEDS_REVIEW';
  if (invoice.status !== 'PENDING' || order.payment_status === 'REFUNDED' || order.status === 'REFUNDED'
    || order.payment_status === 'PAID') return 'NEEDS_REVIEW';
  const expiresAt = Number.isSafeInteger(invoice.checkout_expires_at) ? invoice.checkout_expires_at : session.ends_at;
  if (session.ticket_status !== 'OPEN' || unavailableBookingStates.has(session.status)
    || stoppedOrderStates.has(order.status) || at >= expiresAt || at >= session.ends_at) return 'EXPIRED';
  return 'PENDING';
}

export function createBookingReceiptService(db, { now = Date.now } = {}) {
  const getScope = db.prepare(`SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table'
    AND name IN ('booking_sessions', 'booking_invoices')`);

  // Resolve the caller, ticket, invoice and settlement against one read snapshot.
  const readReceipt = db.transaction(({ guildId, ticketId, viewerId, canManage, invoiceId }) => {
    if (getScope.get().count !== 2) return null;
    const session = db.prepare(`SELECT s.*, t.status AS ticket_status FROM booking_sessions s
      JOIN tickets t ON t.id = s.ticket_id AND t.guild_id = s.guild_id
        AND t.customer_id = s.customer_id AND t.channel_id = s.ticket_channel_id
      WHERE s.guild_id = @guildId AND s.ticket_id = @ticketId AND t.ticket_type = 'BOOKING'
        AND (s.customer_id = @viewerId OR @canManage = 1)`)
      .get({ guildId, ticketId, viewerId, canManage: canManage === true ? 1 : 0 });
    if (!session) return null;

    const invoice = db.prepare(`SELECT * FROM booking_invoices WHERE ticket_id = @ticketId
      AND (@invoiceId IS NULL OR id = @invoiceId) ORDER BY id DESC LIMIT 1`)
      .get({ ticketId, invoiceId: invoiceId ?? null });
    if (!invoice) return null;

    const order = invoice.order_id === null ? null : db.prepare(`SELECT id, guild_id, ticket_id, ticket_channel_id,
      customer_id, total_amount, payment_provider, payos_order_code, order_code, status, payment_status,
      amount_paid, payment_link_id, paid_transaction_id FROM orders WHERE id = ?`).get(invoice.order_id);
    const status = receiptStatus(db, order, invoice, session, now());
    const bound = isBoundBookingOrder(order, invoice, session);
    return {
      kind: 'BOOKING', status, code: bound && /^[A-Za-z0-9_-]{1,60}$/u.test(order.order_code) ? order.order_code : `BK-${invoice.id}`,
      amount: invoice.amount, issuedAt: invoice.created_at, paidAt: status === 'PAID' ? invoice.paid_at : null,
      description: invoice.kind === 'BASE' ? 'Đặt lịch Cenar Booking' : 'Gia hạn phiên Cenar Booking',
      service: session.service, startsAt: invoice.kind === 'BASE' ? session.starts_at : null,
      durationMinutes: invoice.minutes, paymentMethod: bound ? 'PayOS' : null, preview: false,
    };
  });

  return {
    // Without an invoice ID, reopen the latest invoice, including an extension.
    getForTicket({ guildId, ticketId, viewerId, canManage = false, invoiceId }) {
      if (guildId !== STORE_TWO_GUILD_ID || !Number.isSafeInteger(ticketId) || ticketId <= 0
        || typeof viewerId !== 'string' || !/^\d{17,20}$/u.test(viewerId)
        || (invoiceId !== undefined && (!Number.isSafeInteger(invoiceId) || invoiceId <= 0))) return null;
      return readReceipt({ guildId, ticketId, viewerId, canManage, invoiceId });
    },
  };
}

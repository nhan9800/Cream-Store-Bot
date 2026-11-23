import { getStoredPayOSReceivedAmount } from '../utils/payosReceipt.js';

export const SETTLED_BOOKING_ORDER_STATES = new Set(['PROCESSING', 'COMPLETED']);

export function isBookingOrderForSession(order, session, amount) {
  return order?.guild_id === session.guild_id && order.ticket_id === session.ticket_id
    && order.ticket_channel_id === session.ticket_channel_id && order.customer_id === session.customer_id
    && order.total_amount === amount && order.payment_provider === 'PAYOS'
    && Number.isSafeInteger(order.payos_order_code) && order.payos_order_code > 0
    && typeof order.order_code === 'string' && Boolean(order.order_code);
}

export function isBoundBookingOrder(order, invoice, session) {
  return isBookingOrderForSession(order, session, invoice.amount) && order.id === invoice.order_id
    && order.order_code === invoice.order_code && order.payos_order_code === invoice.provider_order_code;
}

export function getVerifiedBookingPaymentEvent(db, order, invoice, session) {
  if (!(isBoundBookingOrder(order, invoice, session) && order.payment_status === 'PAID'
    && Number.isSafeInteger(order.amount_paid) && order.amount_paid >= invoice.amount
    && order.payment_link_id && order.paid_transaction_id)) return null;

  const receipt = db.prepare(`SELECT id, amount, raw_payload FROM payment_events
    WHERE order_code = ? AND provider = 'PAYOS' AND transaction_id = ?`)
    .get(invoice.order_code, order.paid_transaction_id);
  if (!receipt || receipt.amount !== order.amount_paid
    || Number(getStoredPayOSReceivedAmount(receipt.raw_payload)) !== order.amount_paid) return null;
  const data = JSON.parse(receipt.raw_payload);
  return Number(data.orderCode) === invoice.provider_order_code
    && (data.paymentLinkId ?? data.id) === order.payment_link_id ? receipt : null;
}

export function isPaidBookingInvoice(db, order, invoice, session) {
  return invoice.status === 'PAID' && invoice.amount > 0 && Number.isSafeInteger(invoice.payment_event_id)
    && SETTLED_BOOKING_ORDER_STATES.has(order?.status) && order.amount_paid === invoice.amount
    && getVerifiedBookingPaymentEvent(db, order, invoice, session)?.id === invoice.payment_event_id;
}

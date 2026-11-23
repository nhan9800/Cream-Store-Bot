import { assertPaymentConfig, config } from '../config.js';
import { createOrder } from './orderService.js';
import { sendOrRefreshPaymentQr, syncPaymentStatusFromPayOS } from './paymentService.js';

const disabled = () => Object.assign(new Error('Booking PayOS is disabled'), { code: 'BOOKING_PAYMENTS_DISABLED' });

export async function quoteBooking({ interaction, ledger, ticketId, hourlyPrice, hourlyWage, durationMinutes }) {
  const guildId = interaction.guildId;
  const actorId = interaction.user.id;
  if (hourlyPrice > 0) {
    if (process.env.BOOKING_PAYOS_ENABLED !== 'true' || config.paymentProvider !== 'PAYOS') throw disabled();
    try { assertPaymentConfig(); } catch { throw disabled(); }
  }
  const createPaymentOrder = ({ customerId, ticketChannelId, amount, invoiceId }) => createOrder({
    guildId, ticketId, ticketChannelId, customerId, quantity: 1,
    productName: `Phiên Cenar Booking #${ticketId}`, serviceType: 'service', note: `BOOKING_INVOICE:${invoiceId}`,
    totalAmount: amount, createdById: actorId,
  });
  const input = { guildId, actorId, ticketId, hourlyPrice, hourlyWage, createPaymentOrder };
  const invoice = durationMinutes == null ? ledger.createInvoice(input)
    : ledger.extendSession({ ...input, durationMinutes, requestKey: interaction.id });
  if (invoice.status === 'PENDING') {
    // The canonical order and invoice are committed first so the same invoice can be recovered after a timeout.
    await sendOrRefreshPaymentQr({ guild: interaction.guild, orderCode: invoice.order_code });
  }
  return invoice;
}

export async function syncBookingBills({ interaction, ledger, ticketId }) {
  for (const invoice of ledger.listInvoices(interaction.guildId, ticketId)) {
    if (invoice.status !== 'PENDING' || !invoice.order_code) continue;
    const settled = ledger.syncInvoicePayment(interaction.guildId, invoice.id);
    if (settled?.status !== 'PENDING' || process.env.BOOKING_PAYOS_ENABLED !== 'true') continue;
    await syncPaymentStatusFromPayOS({ client: interaction.client, orderCode: invoice.order_code });
    ledger.syncInvoicePayment(interaction.guildId, invoice.id);
  }
  return ledger.listInvoices(interaction.guildId, ticketId);
}

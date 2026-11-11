/** Pure predicates shared by unpaid cleanup and feedback closure. */
export function isUnpaidRetentionOrder(order) {
  if (!['UNPAID', 'CANCELLED'].includes(order.payment_status)) return false;
  if (order.status === 'PENDING_PAYMENT') return true;
  return order.status === 'CANCELLED' && Boolean(
    order.payment_link_id && !order.payment_cancel_reason
    || /^(Thanh toán (?:PayOS )?bị hủy|Thanh toán.*hết hạn|Tự động hủy.*(thanh toán|phản hồi)|Tự động đóng ticket chưa thanh toán)/i.test(order.payment_cancel_reason || '')
  );
}

export function getUnpaidOrderTicketRetention(ticket, orders, idleHours, now = Date.now()) {
  if (ticket?.ticket_type !== 'ORDER') return null;
  const pending = orders.filter(isUnpaidRetentionOrder);
  if (!pending.length) return null;
  const anchors = [ticket.created_at, ticket.last_activity_at, ...pending.map(order => order.created_at)]
    .filter(Boolean).map(value => Date.parse(value));
  // An invalid persisted date cannot authorize automatic deletion.
  const deadline = anchors.length && anchors.every(Number.isFinite)
    ? Math.max(...anchors) + idleHours * 3600000 : null;
  return { pending, deadline, due: deadline !== null && now >= deadline };
}

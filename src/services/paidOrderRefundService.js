import { getBookingInvoiceForOrder } from './bookingLedgerService.js';
import { ensureStatusHistoryTable, normalizeStatus, recordStatusChange } from './orderStateMachine.js';

const REVIEWABLE = new Set(['PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAID', 'PROCESSING',
  'WAITING_STAFF', 'DELIVERING', 'COMPLETED', 'WARRANTY', 'WARRANTY_OPEN', 'CANCELLED', 'FAILED']);

export const REFUND_HOLD_MESSAGE = 'Đơn đang chờ hoàn tiền. Hãy xử lý qua /quanly-don.';

export class PaidOrderRefundError extends Error {}

export function recordPaidOrderRefund(db, { orderCode, guildId, actorId, action, amount, reason }) {
  if (!['REFUND_PENDING', 'REFUNDED', 'WITHDRAW_REFUND'].includes(action)) {
    throw new PaidOrderRefundError('Hành động hoàn tiền không hợp lệ.');
  }
  return db.transaction(() => {
    const readOrder = db.prepare('SELECT * FROM orders WHERE order_code = ? AND guild_id = ?');
    const order = readOrder.get(orderCode, guildId);
    if (!order) throw new PaidOrderRefundError('Không tìm thấy mã đơn trong shop hiện tại.');
    if (order.fulfillment_mode === 'SUPPLIER' || getBookingInvoiceForOrder(db, order)) {
      throw new PaidOrderRefundError('Đơn AutoBuy hoặc Booking cần đối soát theo luồng riêng của dịch vụ.');
    }
    const status = normalizeStatus(order.status);
    if (status === 'REFUNDED') return { order, updated: order, changed: false };
    const received = Number(order.amount_paid);
    if (order.payment_status !== 'PAID' || !Number.isSafeInteger(received) || received < 1) {
      throw new PaidOrderRefundError('Đơn chưa có số tiền đã nhận để ghi nhận hoàn tiền.');
    }

    let next = 'REFUND_PENDING';
    let metadata = null;
    if (action === 'REFUND_PENDING') {
      if (status === next) return { order, updated: order, changed: false };
      if (!REVIEWABLE.has(status)) throw new PaidOrderRefundError('Trạng thái hiện tại chưa hỗ trợ ghi nhận hoàn tiền.');
      const sending = db.prepare(`SELECT 1 FROM order_fulfillments
        WHERE order_code = ? AND status = 'SENDING' AND lease_until > ?`).get(orderCode, new Date().toISOString());
      if (sending) throw new PaidOrderRefundError('Bot đang có lượt giao hàng đang chạy. Kiểm tra kết quả giao trước khi ghi nhận hoàn tiền.');
    } else if (status !== 'REFUND_PENDING') {
      throw new PaidOrderRefundError('Hãy chọn “Ghi nhận yêu cầu hoàn tiền” trước.');
    } else if (action === 'REFUNDED') {
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > received) {
        throw new PaidOrderRefundError('Nhập đúng số VND đã hoàn thực tế, từ 1đ đến số đã nhận.');
      }
      next = 'REFUNDED';
      metadata = { amount, currency: 'VND' };
    } else {
      ensureStatusHistoryTable(db);
      const request = db.prepare(`SELECT old_status FROM order_status_history
        WHERE order_code = ? AND new_status = 'REFUND_PENDING' ORDER BY id DESC LIMIT 1`).get(orderCode);
      if (!REVIEWABLE.has(request?.old_status)) throw new PaidOrderRefundError('Chưa tìm được trạng thái trước yêu cầu. Cần kiểm tra lịch sử đơn.');
      next = request.old_status;
    }

    const now = new Date().toISOString();
    db.prepare(`UPDATE orders SET status = ?, status_changed_at = ?, updated_at = ?
      WHERE order_code = ? AND guild_id = ?`).run(next, now, now, orderCode, guildId);
    const reasonByAction = {
      REFUND_PENDING: 'Ghi nhận yêu cầu hoàn tiền',
      REFUNDED: 'Quản lý xác nhận đã hoàn bên ngoài bot',
      WITHDRAW_REFUND: 'Rút yêu cầu hoàn tiền',
    };
    recordStatusChange(db, { orderCode, previousStatus: status, newStatus: next, actor: actorId,
      reason: reason ? `${reasonByAction[action]} · ${reason}` : reasonByAction[action], metadata });
    return { order, updated: readOrder.get(orderCode, guildId), changed: true };
  }).immediate();
}

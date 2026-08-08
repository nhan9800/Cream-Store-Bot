import { db } from '../database/db.js';
import { addWalletBalance } from './walletService.js';

function transition(requestId, targetStatus, { otpCode = null, refundReason = null } = {}) {
  return db.transaction(() => {
    const order = db.prepare('SELECT * FROM viotp_orders WHERE request_id = ?').get(requestId);
    if (!order || order.status !== 'PENDING') return { transitioned: false, order };

    const changed = db.prepare(`
      UPDATE viotp_orders
      SET status = ?, otp_code = COALESCE(?, otp_code)
      WHERE request_id = ? AND status = 'PENDING'
    `).run(targetStatus, otpCode, requestId);
    if (changed.changes !== 1) return { transitioned: false, order };

    if (refundReason) {
      addWalletBalance(
        order.guild_id,
        order.customer_id,
        Number(order.price) || 0,
        'REFUND',
        refundReason,
        requestId,
      );
    }

    return {
      transitioned: true,
      order: { ...order, status: targetStatus, otp_code: otpCode ?? order.otp_code },
      refunded: Boolean(refundReason),
    };
  })();
}

export function completeOtpOrder(requestId, otpCode) {
  return transition(requestId, 'COMPLETED', { otpCode: String(otpCode || '').trim() });
}

export function expireOtpOrder(requestId, reason = 'Phiên OTP đã hết hạn') {
  return transition(requestId, 'EXPIRED', { refundReason: reason });
}

export function failOtpOrder(requestId, reason = 'Nhà cung cấp OTP báo lỗi phiên') {
  return transition(requestId, 'FAILED', { refundReason: reason });
}

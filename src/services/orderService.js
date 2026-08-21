import { db, nowIso } from '../database/db.js';
import { addHours } from '../utils/time.js';
import { config } from '../config.js';
import { randomDigits } from '../utils/id.js';
import { syncCustomerStats, getCustomerProfile } from './customerService.js';
import { addOrderDuration, normalizeOrderDurationStorage, normalizeQueueGroup } from '../utils/formatters.js';
import { broadcastDashboardEvent } from './dashboardMiniServer.js';
import { encrypt } from '../utils/crypto.js';
import { awardOrderPoints, refundOrderPoints } from './loyaltyService.js';
import { recordStatusChange } from './orderStateMachine.js';
import { syncCtvOrderLog } from './ctvOrderLogService.js';
import { scheduleAdminOrderCenterRefresh } from './adminOrderCenterService.js';

function createOrderStmt() {
  return db.prepare(`
    INSERT INTO orders (
      order_code, guild_id, ticket_id, ticket_channel_id, customer_id,
      product_name, quantity, note, total_amount, amount_paid, payment_provider,
      payment_code, payos_order_code, payment_status, status, status_changed_at,
      queue_group, priority_rank, duration_months, duration_days, order_log_channel_id, created_by_id, created_at, updated_at, service_type,
      discord_sku_id, discord_product_url, discord_original_price, discord_nitro_eligible
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
}
function orderCodeExistsStmt(){return db.prepare('SELECT 1 FROM orders WHERE order_code=? LIMIT 1');}
function getOrderByIdStmt(){return db.prepare('SELECT * FROM orders WHERE id=?');}
function getOrderByCodeStmt(){return db.prepare('SELECT * FROM orders WHERE order_code=?');}
function getOrderByPayOSCodeStmt(){return db.prepare('SELECT * FROM orders WHERE payos_order_code=? LIMIT 1');}
function getOrderByPaymentCodeStmt(){return db.prepare('SELECT * FROM orders WHERE payment_code=? OR order_code=? LIMIT 1');}
function getLatestOrderByTicketChannelStmt(){return db.prepare('SELECT * FROM orders WHERE ticket_channel_id=? ORDER BY id DESC LIMIT 1');}
function updateOrderLogStmt(){return db.prepare('UPDATE orders SET order_log_message_id=?, updated_at=? WHERE order_code=?');}
function attachPaymentMessageStmt(){return db.prepare('UPDATE orders SET payment_message_id=?, updated_at=? WHERE order_code=?');}
function savePaymentLinkStmt(){return db.prepare('UPDATE orders SET payment_link_id=?, payment_checkout_url=?, payment_qr_code=?, payment_qr_url=?, payment_qr_text=?, payment_expired_at=?, updated_at=? WHERE order_code=?');}
function resetPaymentLinkStmt(){return db.prepare('UPDATE orders SET payment_link_id=NULL, payment_checkout_url=NULL, payment_qr_code=NULL, payment_qr_url=NULL, payment_qr_text=NULL, payment_expired_at=NULL, payment_message_id=NULL, payos_order_code=?, updated_at=? WHERE order_code=?');}
function completeOrderStmt(){return db.prepare(`UPDATE orders SET status='COMPLETED', status_changed_at=?, completed_by_id=?, completed_at=?, feedback_requested_at=?, feedback_due_at=?, updated_at=? WHERE order_code=?`);}
function cancelOrderStmt(){return db.prepare(`UPDATE orders SET status='CANCELLED', status_changed_at=?, payment_status = CASE WHEN payment_status IN ('PAID','FREE') THEN payment_status ELSE 'CANCELLED' END, payment_cancel_reason=COALESCE(?, payment_cancel_reason), updated_at=? WHERE order_code=?`);}
function saveDeliveryStmt(){return db.prepare(`UPDATE orders SET delivered_by_id=?, delivered_at=?, credential_email=?, credential_password=?, credential_profile=?, credential_pin=?, delivery_login_url=?, claim_notes=?, delivery_dm_channel_id=?, delivery_dm_message_id=?, updated_at=? WHERE order_code=?`);}
function markFeedbackSubmittedStmt(){return db.prepare(`UPDATE orders SET feedback_submitted_at=?, updated_at=? WHERE order_code=?`);}
function insertFeedbackStmt(){return db.prepare(`INSERT INTO feedbacks (guild_id,order_id,order_code,ticket_id,ticket_code,customer_id,stars,content,feedback_channel_id,feedback_message_id,product_id,product_name,is_visible,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`);}
function findLatestPendingFeedbackOrderStmt(){return db.prepare(`SELECT * FROM orders WHERE guild_id=? AND customer_id=? AND status='COMPLETED' AND feedback_submitted_at IS NULL ORDER BY completed_at DESC, id DESC LIMIT 1`);}
function getOverdueOrdersStmt(){return db.prepare(`SELECT * FROM orders WHERE status='COMPLETED' AND feedback_due_at IS NOT NULL AND feedback_submitted_at IS NULL AND non_legit_assigned_at IS NULL AND feedback_due_at <= ? ORDER BY id ASC LIMIT ?`);}
function markNonLegitAssignedStmt(){return db.prepare('UPDATE orders SET non_legit_assigned_at=?, updated_at=? WHERE order_code=?');}
function clearNonLegitAssignedStmt(){return db.prepare('UPDATE orders SET non_legit_assigned_at=NULL, updated_at=? WHERE order_code=?');}
function countQueueStmt(){return db.prepare(`SELECT COUNT(*) AS total FROM orders WHERE guild_id=? AND status IN ('PENDING_PAYMENT','PROCESSING','WARRANTY_OPEN') AND queue_group=?`);}
function countQueueAheadStmt(){return db.prepare(`SELECT COUNT(*) AS total FROM orders WHERE guild_id=? AND status IN ('PENDING_PAYMENT','PROCESSING','WARRANTY_OPEN') AND queue_group=? AND (priority_rank > ? OR (priority_rank = ? AND id <= ?))`);}
function markOrderPaidStmt(){return db.prepare(`UPDATE orders SET payment_status='PAID', amount_paid=?, paid_at=?, paid_transaction_id=?, paid_transaction_content=?, status=CASE WHEN status='PENDING_PAYMENT' THEN 'PROCESSING' ELSE status END, status_changed_at=?, updated_at=? WHERE order_code=?`);}
function markWalletOrderPaidStmt(){return db.prepare(`UPDATE orders SET payment_provider='WALLET', payment_status='PAID', amount_paid=?, paid_at=?, paid_transaction_id=?, paid_transaction_content=?, payment_cancel_reason=NULL, status='PROCESSING', status_changed_at=?, updated_at=? WHERE order_code=?`);}
function setOrderStatusStmt(){return db.prepare('UPDATE orders SET status=?, status_changed_at=?, updated_at=? WHERE order_code=?');}
function completeWarrantyStmt(){return db.prepare(`UPDATE orders SET status='COMPLETED', status_changed_at=?, warranty_completed_at=?, warranty_completed_by_id=?, warranty_count=COALESCE(warranty_count,0)+1, updated_at=? WHERE order_code=? AND status='WARRANTY_OPEN'`);}
function getOutstandingOrdersStmt(){return db.prepare(`SELECT * FROM orders WHERE guild_id=? AND status IN ('PENDING_PAYMENT','PROCESSING','WARRANTY_OPEN') AND (? IS NULL OR customer_id=?) ORDER BY priority_rank DESC, created_at ASC LIMIT ? OFFSET ?`);}
function getOutstandingSummaryStmt(){return db.prepare(`SELECT COUNT(*) total_orders, SUM(CASE WHEN status='PENDING_PAYMENT' THEN 1 ELSE 0 END) waiting_payment, SUM(CASE WHEN status='PROCESSING' THEN 1 ELSE 0 END) processing, SUM(CASE WHEN status='WARRANTY_OPEN' THEN 1 ELSE 0 END) warranty_open FROM orders WHERE guild_id=? AND status IN ('PENDING_PAYMENT','PROCESSING','WARRANTY_OPEN') AND (? IS NULL OR customer_id=?)`);}
function insertPaymentEventStmt(){return db.prepare(`INSERT OR IGNORE INTO payment_events (order_code,provider,transaction_id,amount,content,raw_payload,created_at) VALUES (?,?,?,?,?,?,?)`);}
function getPaymentEventByTxStmt(){return db.prepare('SELECT * FROM payment_events WHERE provider=? AND transaction_id=? LIMIT 1');}
function getPendingPaymentReminderStmt(){return db.prepare(`SELECT * FROM orders WHERE status='PENDING_PAYMENT' AND payment_status='UNPAID' AND payment_reminder_sent_at IS NULL AND datetime(created_at) <= datetime(?) ORDER BY created_at ASC LIMIT ?`);}
function getProcessingReminderStmt(){return db.prepare(`SELECT * FROM orders WHERE status='PROCESSING' AND processing_reminder_sent_at IS NULL AND datetime(updated_at) <= datetime(?) ORDER BY updated_at ASC LIMIT ?`);}
function markPaymentReminderSentStmt(){return db.prepare('UPDATE orders SET payment_reminder_sent_at=?, updated_at=? WHERE order_code=?');}
function markProcessingReminderSentStmt(){return db.prepare('UPDATE orders SET processing_reminder_sent_at=?, updated_at=? WHERE order_code=?');}
function setOrderExpiryStmt(){return db.prepare(`UPDATE orders SET expiry_at=?, updated_at=? WHERE order_code=?`);}
function markExpiryNotice2dStmt(){return db.prepare('UPDATE orders SET expiry_notice_2d_sent_at=?, updated_at=? WHERE order_code=?');}
function markExpiryNotice1dStmt(){return db.prepare('UPDATE orders SET expiry_notice_1d_sent_at=?, updated_at=? WHERE order_code=?');}
function getOrdersExpiringBetweenStmt(){return db.prepare(`SELECT * FROM orders WHERE status IN ('COMPLETED','WARRANTY_OPEN') AND expiry_at IS NOT NULL AND datetime(expiry_at) > datetime(?) AND datetime(expiry_at) <= datetime(?) ORDER BY expiry_at ASC LIMIT ?`);}
function topProductsSalesStmt(){return db.prepare(`SELECT product_name, COUNT(*) AS total_orders FROM orders WHERE guild_id=? GROUP BY product_name ORDER BY total_orders DESC, product_name ASC LIMIT ?`);}
function claimOrderStmt(){return db.prepare('UPDATE orders SET claimed_by_id=?, claimed_at=?, updated_at=? WHERE order_code=?');}
function clearClaimStmt(){return db.prepare('UPDATE orders SET claimed_by_id=NULL, claimed_at=NULL, updated_at=? WHERE order_code=?');}
function updateOrderFieldsStmt(){return db.prepare(`UPDATE orders SET product_name=?, quantity=?, total_amount=?, queue_group=?, priority_rank=?, updated_at=? WHERE order_code=?`);}
function getStaffKpiStmt(){return db.prepare(`SELECT actor_id, COUNT(*) total_actions, SUM(CASE WHEN action IN ('ORDER_COMPLETE_MANUAL','ORDER_COMPLETE_AUTO','ORDER_COMPLETED') THEN 1 ELSE 0 END) completed_orders, SUM(CASE WHEN action IN ('DELIVERY_SENT','ORDER_DELIVERED') THEN 1 ELSE 0 END) deliveries, SUM(CASE WHEN action IN ('ORDER_CLAIM','ORDER_CLAIMED') THEN 1 ELSE 0 END) claims FROM staff_logs WHERE guild_id=? AND actor_id IS NOT NULL GROUP BY actor_id ORDER BY completed_orders DESC, deliveries DESC, total_actions DESC LIMIT ?`);}
function averageCompletionTimeStmt(){return db.prepare(`SELECT AVG((julianday(completed_at)-julianday(created_at))*86400.0) avg_seconds FROM orders WHERE guild_id=? AND completed_by_id=? AND completed_at IS NOT NULL`);}

export function generateUniqueOrderCode(){while(true){const c=`CN_${randomDigits(6)}`; if(!orderCodeExistsStmt().get(c)) return c;}}
function ensureAmountValue(v){const a=Number(v ?? 0); return Number.isFinite(a)&&a>0?Math.trunc(a):0;}
function computePriority(guildId, customerId, productName){const profile=getCustomerProfile(guildId, customerId); const completed=Number(profile?.total_completed_orders ?? 0); let rank=0; if (completed >= config.vipRoleThreshold) rank += 100; if ((productName||'').toLowerCase().includes('vip')) rank += 20; return rank;}

function detectServiceType(name) {
  if (!name) return 'netflix';
  const l = name.toLowerCase();
  if (l.includes('setup') || l.includes('bot custom') || l.includes('website custom') || l.includes('duy trì bot')) return 'service';
  if (l.includes('spotify') || l.includes('spot')) return 'spotify';
  if (l.includes('discord') || l.includes('nitro') || l.includes('boost')) return 'discord';
  if (l.includes('youtube') || l.includes('yt') || l.includes('yout') || l.includes('pre')) return 'youtube';
  if (l.includes('netflix') || l.includes('net')) return 'netflix';
  if (l.includes('chatgpt') || l.includes('gemini') || l.includes('claude') || l.includes('capcut') || l.includes('adobe') || l.includes('office')) return 'ai';
  if (l.includes('gearup') || l.includes('gear')) return 'gearup';
  if (l.includes('decor')) return 'decor';
  return 'other';
}

function scheduleCtvOrderLogSync(order) {
  if (!order?.order_code) return;
  queueMicrotask(() => {
    syncCtvOrderLog(order).catch((error) => {
      console.error(`[CTV-ORDER-LOG] ${order.order_code}: ${error.message}`);
    });
  });
}

export function createOrder({ guildId, ticketId, ticketChannelId, customerId, productName, quantity, note, totalAmount = 0, durationMonths = config.defaultOrderDurationMonths, durationDays = null, orderLogChannelId, createdById, orderCode, discordSkuId = null, discordProductUrl = null, discordOriginalPrice = null, discordNitroEligible = false }) {
  const timestamp = nowIso();
  const safeAmount = ensureAmountValue(totalAmount);
  const finalOrderCode = orderCode || generateUniqueOrderCode();
  const payosOrderCode = Number(finalOrderCode.replace('CN_', ''));
  const paymentCode = safeAmount > 0 ? finalOrderCode : null;
  const paymentStatus = safeAmount > 0 ? 'UNPAID' : 'FREE';
  const status = safeAmount > 0 ? 'PENDING_PAYMENT' : 'PROCESSING';
  const queueGroup = normalizeQueueGroup(productName) || 'mac-dinh';
  const priorityRank = computePriority(guildId, customerId, productName);
  const normalizedDuration = normalizeOrderDurationStorage(
    { durationMonths, durationDays },
    config.defaultOrderDurationMonths,
  );
  const safeDurationDays = normalizedDuration.durationDays;
  const safeDurationMonths = normalizedDuration.durationMonths;
  const serviceType = detectServiceType(productName);

  let resultId;
  const transaction = db.transaction(() => {
    const result = createOrderStmt().run(finalOrderCode,guildId,ticketId,ticketChannelId,customerId,productName,quantity,note ?? null,safeAmount,safeAmount > 0 ? 0 : safeAmount,config.paymentProvider,paymentCode,payosOrderCode,paymentStatus,status,timestamp,queueGroup,priorityRank,safeDurationMonths,safeDurationDays,orderLogChannelId,createdById,timestamp,timestamp,serviceType,discordSkuId,discordProductUrl,discordOriginalPrice,discordNitroEligible ? 1 : 0);
    resultId = result.lastInsertRowid;
    syncCustomerStats(guildId, customerId);
  });
  
  transaction();
  broadcastDashboardEvent('order_update', `Đơn hàng mới: ${finalOrderCode}`);
  const createdOrder = getOrderById(Number(resultId));
  scheduleCtvOrderLogSync(createdOrder);
  scheduleAdminOrderCenterRefresh(createdOrder.guild_id);
  return createdOrder;
}

export const getOrderByCode = (orderCode) => getOrderByCodeStmt().get(orderCode) ?? null;
export const getOrderByPayOSCode = (payosOrderCode) => getOrderByPayOSCodeStmt().get(Number(payosOrderCode)) ?? null;
export const getOrderByPaymentCode = (code) => getOrderByPaymentCodeStmt().get(code, code) ?? null;
export const getOrderById = (orderId) => getOrderByIdStmt().get(orderId) ?? null;
export const getLatestOrderByTicketChannel = (ticketChannelId) => getLatestOrderByTicketChannelStmt().get(ticketChannelId) ?? null;

export function saveOrderLogMessage(orderCode, messageId){updateOrderLogStmt().run(messageId, nowIso(), orderCode); return getOrderByCode(orderCode);}
export function savePaymentMessage(orderCode, messageId){attachPaymentMessageStmt().run(messageId ?? null, nowIso(), orderCode); return getOrderByCode(orderCode);}
export function savePaymentLinkData(orderCode,{paymentLinkId,checkoutUrl,qrCode,qrUrl=null,qrText=null,expiredAt=null}){savePaymentLinkStmt().run(paymentLinkId ?? null, checkoutUrl ?? null, qrCode ?? null, qrUrl ?? null, qrText ?? null, expiredAt ?? null, nowIso(), orderCode); return getOrderByCode(orderCode);}

function generateUniquePayosCode(){while(true){const c=Number(randomDigits(6)); if(c>0 && !getOrderByPayOSCodeStmt().get(c)) return c;}}
// Xoá link PayOS cũ + cấp payos_order_code MỚI để tạo lại hoá đơn (QR đổi theo). Dùng khi đơn hết hạn.
export function resetPaymentLinkForRegen(orderCode){const order=getOrderByCode(orderCode); if(!order) return null; const newPayosCode=generateUniquePayosCode(); resetPaymentLinkStmt().run(newPayosCode, nowIso(), orderCode); return getOrderByCode(orderCode);}

export function setOrderExpiry(orderCode, expiryAt){ setOrderExpiryStmt().run(expiryAt, nowIso(), orderCode); return getOrderByCode(orderCode); }
export function ensureOrderExpiry(orderCode, baseDate = new Date()) { const order = getOrderByCode(orderCode); if (!order) return null; if (order.expiry_at) return order; const expiryDate = addOrderDuration(baseDate, order, config.defaultOrderDurationMonths); if (!expiryDate) return order; return setOrderExpiry(orderCode, expiryDate.toISOString()); }

export function markOrderCompleted(orderCode, completedById, timeoutHours = config.feedbackTimeoutHours) {
  const order = getOrderByCode(orderCode); if (!order) return null;
  const completedAt = nowIso(); const dueAt = addHours(new Date(completedAt), timeoutHours).toISOString();
  completeOrderStmt().run(completedAt, completedById, completedAt, completedAt, dueAt, completedAt, orderCode);
  clearClaimStmt().run(completedAt, orderCode);
  ensureOrderExpiry(orderCode, new Date(completedAt));
  const updated = getOrderByCode(orderCode);
  if (order.status !== updated.status) {
    recordStatusChange(db, { orderCode, previousStatus: order.status, newStatus: updated.status, changedBy: completedById || 'SYSTEM', reason: 'Order completed and delivered' });
  }
  syncCustomerStats(updated.guild_id, updated.customer_id);
  scheduleCtvOrderLogSync(updated);

  // Tích lũy điểm khi đơn hàng hoàn thành
  if (updated && updated.guild_id !== 'WEB' && updated.customer_id !== 'WEB') {
    try {
      awardOrderPoints(updated.guild_id, updated.customer_id, updated.order_code, updated.total_amount);
    } catch (e) {
      console.error('[LOYALTY] Lỗi awardOrderPoints trong markOrderCompleted:', e);
    }

    try {
      // Invite Referral System: Đánh dấu người này đã mua hàng nếu họ được mời
      db.prepare('UPDATE user_invites SET has_purchased = 1 WHERE invited_id = ? AND guild_id = ?')
        .run(updated.customer_id, updated.guild_id);
    } catch (e) {
      console.error('[INVITE-TRACKER] Lỗi cập nhật has_purchased:', e);
    }
  }

  scheduleAdminOrderCenterRefresh(updated.guild_id);
  broadcastDashboardEvent('order_update');
  return updated;
}
export function cancelOrder(orderCode, reason = null){
  const order=getOrderByCode(orderCode); if(!order) return null; 
  cancelOrderStmt().run(nowIso(), reason ?? null, nowIso(), orderCode); 
  clearClaimStmt().run(nowIso(), orderCode); 
  if (order.status !== 'CANCELLED') {
    recordStatusChange(db, { orderCode, previousStatus: order.status, newStatus: 'CANCELLED', changedBy: 'SYSTEM', reason: reason || 'Order cancelled' });
  } 
  
  if (order.guild_id !== 'WEB' && order.customer_id !== 'WEB') {
    try {
      refundOrderPoints(order.guild_id, order.customer_id, order.order_code);
    } catch (e) {
      console.error('[LOYALTY] Lỗi refundOrderPoints trong cancelOrder:', e);
    }
  }

  const updated=getOrderByCode(orderCode); 
  syncCustomerStats(updated.guild_id, updated.customer_id); 
  scheduleCtvOrderLogSync(updated);
  scheduleAdminOrderCenterRefresh(updated.guild_id);
  return updated;
}
export function saveDelivery(orderCode,deliveredById,credentialEmail,credentialPassword,credentialProfile,credentialPin,deliveryLoginUrl,claimNotes,dmChannelId,dmMessageId){const timestamp=nowIso(); saveDeliveryStmt().run(deliveredById,timestamp,credentialEmail!=null?encrypt(credentialEmail):null,credentialPassword!=null?encrypt(credentialPassword):null,credentialProfile!=null?encrypt(credentialProfile):null,credentialPin!=null?encrypt(credentialPin):null,deliveryLoginUrl ?? null,claimNotes ?? null,dmChannelId ?? null,dmMessageId ?? null,timestamp,orderCode); return getOrderByCode(orderCode);}

export function submitFeedback({ orderCode, customerId, stars, content, feedbackChannelId, feedbackMessageId }) {
  const order = getOrderByCode(orderCode); if (!order) throw new Error('Không tìm thấy đơn hàng để liên kết feedback.');
  if (order.customer_id !== customerId) throw new Error('Bạn không phải chủ đơn hàng này.');
  if (order.status !== 'COMPLETED') throw new Error('Chỉ có thể feedback cho đơn đã hoàn thành.');
  if (order.feedback_submitted_at) throw new Error('Đơn này đã feedback rồi.');
  const timestamp = nowIso();
  const product = db.prepare(`
    SELECT id, name FROM product_catalog
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
    ORDER BY CASE WHEN guild_id = ? THEN 0 WHEN guild_id = 'WEB' THEN 1 ELSE 2 END, id
    LIMIT 1
  `).get(order.product_name, order.guild_id);
  insertFeedbackStmt().run(
    order.guild_id, order.id, order.order_code, order.ticket_id, null, customerId,
    stars, content, feedbackChannelId, feedbackMessageId,
    product?.id || null, product?.name || order.product_name, timestamp, timestamp
  );
  markFeedbackSubmittedStmt().run(timestamp, timestamp, orderCode); clearNonLegitAssignedStmt().run(timestamp, orderCode);
  syncCustomerStats(order.guild_id, order.customer_id); return getOrderByCode(orderCode);
}
export const findLatestPendingFeedbackOrder = (guildId, customerId) => findLatestPendingFeedbackOrderStmt().get(guildId, customerId) ?? null;
export const getOverdueFeedbackOrders = (limit = 20) => getOverdueOrdersStmt().all(nowIso(), limit);
export function markNonLegitAssigned(orderCode){const order=getOrderByCode(orderCode); if(!order) return null; const t=nowIso(); markNonLegitAssignedStmt().run(t,t,orderCode); return getOrderByCode(orderCode);}

export function getQueuePosition(order) {
  const group = order.queue_group || normalizeQueueGroup(order.product_name) || 'mac-dinh';
  const total = countQueueStmt().get(order.guild_id, group)?.total ?? 0;
  const position = countQueueAheadStmt().get(order.guild_id, group, Number(order.priority_rank ?? 0), Number(order.priority_rank ?? 0), order.id)?.total ?? 0;
  return { position: Math.max(position, 1), total: Math.max(total, 1), group };
}

export function claimOrder(orderCode, actorId) {
  claimOrderStmt().run(actorId, nowIso(), nowIso(), orderCode);
  const updated = getOrderByCode(orderCode);
  if (updated) scheduleAdminOrderCenterRefresh(updated.guild_id);
  return updated;
}
export function releaseOrderClaim(orderCode) {
  clearClaimStmt().run(nowIso(), orderCode);
  const updated = getOrderByCode(orderCode);
  if (updated) scheduleAdminOrderCenterRefresh(updated.guild_id);
  return updated;
}

export function markOrderPaid(orderCode,{amountPaid,transactionId,transactionContent}){
  const order=getOrderByCode(orderCode);
  if(!order) return null;

  // Nếu đơn đã bị CANCELLED, vẫn ghi nhận thanh toán nhưng GIỮ status='CANCELLED'
  // (admin sẽ phải refund thủ công hoặc xóa giao dịch)
  if (order.status === 'CANCELLED') {
    console.warn(`[ORDER] markOrderPaid: đơn ${orderCode} đã bị CANCELLED nhưng nhận tiền — giữ status, cần refund.`);
  }

  const amount=Math.max(ensureAmountValue(amountPaid), ensureAmountValue(order.total_amount));
  const paidAt=nowIso();
  markOrderPaidStmt().run(amount,paidAt,transactionId ?? null,transactionContent ?? null, paidAt, paidAt, orderCode);
  const updated=getOrderByCode(orderCode);
  if (order.status !== updated.status) {
    recordStatusChange(db, { orderCode, previousStatus: order.status, newStatus: updated.status, changedBy: 'SYSTEM_PAYOS', reason: transactionContent || 'Payment confirmed' });
  }
  syncCustomerStats(updated.guild_id, updated.customer_id);
  scheduleCtvOrderLogSync(updated);
  scheduleAdminOrderCenterRefresh(updated.guild_id);
  broadcastDashboardEvent('order_update');
  return updated;
}

export class WalletPaymentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WalletPaymentError';
    this.code = code;
  }
}

/**
 * Trừ ví và xác nhận đơn trong CÙNG một SQLite transaction.
 * Nếu bất kỳ câu lệnh nào lỗi, cả số dư, ledger và trạng thái đơn đều rollback.
 */
export function payOrderWithWallet({ orderCode, guildId, customerId, amount }) {
  const safeAmount = ensureAmountValue(amount);
  if (!safeAmount) {
    throw new WalletPaymentError('INVALID_AMOUNT', 'Tổng thanh toán không hợp lệ.');
  }

  const timestamp = nowIso();
  const transactionId = `WALLET_${Date.now()}_${randomDigits(4)}`;
  const result = db.transaction(() => {
    const order = getOrderByCodeStmt().get(orderCode);
    if (!order) throw new WalletPaymentError('ORDER_NOT_FOUND', 'Không tìm thấy đơn hàng.');
    if (String(order.guild_id) !== String(guildId) || String(order.customer_id) !== String(customerId)) {
      throw new WalletPaymentError('ORDER_OWNER_MISMATCH', 'Đơn hàng không thuộc ví này.');
    }
    if (ensureAmountValue(order.total_amount) !== safeAmount) {
      throw new WalletPaymentError('AMOUNT_MISMATCH', 'Giá đơn hàng đã thay đổi. Vui lòng thử lại.');
    }

    const existingPayment = db.prepare(`
      SELECT * FROM wallet_transactions
      WHERE guild_id = ? AND customer_id = ? AND type IN ('PAYMENT', 'PAY_ORDER') AND related_code = ?
      ORDER BY id ASC LIMIT 1
    `).get(guildId, customerId, orderCode);

    if (existingPayment) {
      if (order.payment_status === 'PAID' && order.status !== 'CANCELLED') {
        return { order, walletTransaction: existingPayment, reused: true };
      }
      throw new WalletPaymentError(
        'WALLET_LEDGER_CONFLICT',
        'Giao dịch ví đã tồn tại nhưng đơn chưa đồng bộ. Hệ thống sẽ tự đối soát, vui lòng không thanh toán lại.',
      );
    }

    if (order.status !== 'PENDING_PAYMENT' || order.payment_status !== 'UNPAID') {
      throw new WalletPaymentError('ORDER_NOT_PAYABLE', 'Đơn hàng không còn ở trạng thái chờ thanh toán.');
    }

    db.prepare(`
      INSERT INTO customer_profiles (guild_id, customer_id, wallet_balance)
      VALUES (?, ?, 0)
      ON CONFLICT(guild_id, customer_id) DO NOTHING
    `).run(guildId, customerId);

    const debit = db.prepare(`
      UPDATE customer_profiles
      SET wallet_balance = wallet_balance - ?
      WHERE guild_id = ? AND customer_id = ? AND wallet_balance >= ?
    `).run(safeAmount, guildId, customerId, safeAmount);
    if (debit.changes !== 1) {
      throw new WalletPaymentError('INSUFFICIENT_BALANCE', 'Số dư ví không đủ.');
    }

    const ledger = db.prepare(`
      INSERT INTO wallet_transactions (
        guild_id, customer_id, amount, type, description, related_code, created_at
      ) VALUES (?, ?, ?, 'PAYMENT', ?, ?, ?)
    `).run(
      guildId,
      customerId,
      -safeAmount,
      `Thanh toán đơn ${orderCode}`,
      orderCode,
      timestamp,
    );

    markWalletOrderPaidStmt().run(
      safeAmount,
      timestamp,
      transactionId,
      'Thanh toán bằng số dư Ví Cenar',
      timestamp,
      timestamp,
      orderCode,
    );
    recordStatusChange(db, {
      orderCode,
      previousStatus: order.status,
      newStatus: 'PROCESSING',
      changedBy: 'SYSTEM_WALLET',
      reason: 'Wallet debit and order confirmation committed atomically',
      metadata: { walletTransactionId: Number(ledger.lastInsertRowid) },
    });

    return {
      order: getOrderByCodeStmt().get(orderCode),
      walletTransaction: db.prepare('SELECT * FROM wallet_transactions WHERE id = ?').get(Number(ledger.lastInsertRowid)),
      reused: false,
    };
  })();

  syncCustomerStats(guildId, customerId);
  scheduleCtvOrderLogSync(result.order);
  scheduleAdminOrderCenterRefresh(guildId);
  broadcastDashboardEvent('order_update', `Đã thanh toán ví: ${orderCode}`);
  return result;
}

/**
 * Sửa dữ liệu legacy do phiên bản cũ trừ ví trước rồi mới xác nhận đơn.
 * Chỉ khôi phục khi có đúng 1 PAYMENT bằng đúng tổng đơn và chưa từng REFUND.
 */
export function reconcileWalletPaidOrders() {
  const candidates = db.prepare(`
    SELECT
      o.order_code,
      o.guild_id,
      o.customer_id,
      o.status,
      o.total_amount,
      wt.id AS wallet_transaction_id,
      wt.created_at AS wallet_paid_at
    FROM orders o
    JOIN wallet_transactions wt
      ON wt.guild_id = o.guild_id
     AND wt.customer_id = o.customer_id
     AND wt.related_code = o.order_code
     AND wt.type IN ('PAYMENT', 'PAY_ORDER')
    WHERE o.payment_status != 'PAID'
      AND o.status IN ('PENDING_PAYMENT', 'CANCELLED')
      AND wt.amount = -o.total_amount
      AND NOT EXISTS (
        SELECT 1 FROM wallet_transactions refund
        WHERE refund.guild_id = o.guild_id
          AND refund.customer_id = o.customer_id
          AND refund.related_code = o.order_code
          AND refund.type = 'REFUND'
      )
      AND 1 = (
        SELECT COUNT(*) FROM wallet_transactions payment
        WHERE payment.guild_id = o.guild_id
          AND payment.customer_id = o.customer_id
          AND payment.related_code = o.order_code
          AND payment.type IN ('PAYMENT', 'PAY_ORDER')
      )
    ORDER BY o.id ASC
  `).all();

  const repaired = db.transaction(() => {
    const rows = [];
    for (const candidate of candidates) {
      const timestamp = nowIso();
      const update = db.prepare(`
        UPDATE orders
        SET payment_provider = 'WALLET',
            payment_status = 'PAID',
            amount_paid = total_amount,
            paid_at = COALESCE(paid_at, ?),
            paid_transaction_id = COALESCE(paid_transaction_id, ?),
            paid_transaction_content = COALESCE(paid_transaction_content, 'Đối soát thanh toán Ví Cenar'),
            payment_cancel_reason = NULL,
            status = 'PROCESSING',
            status_changed_at = ?,
            updated_at = ?
        WHERE order_code = ?
          AND payment_status != 'PAID'
          AND status IN ('PENDING_PAYMENT', 'CANCELLED')
      `).run(
        candidate.wallet_paid_at || timestamp,
        `WALLET_RECON_${candidate.wallet_transaction_id}`,
        timestamp,
        timestamp,
        candidate.order_code,
      );
      if (update.changes !== 1) continue;

      recordStatusChange(db, {
        orderCode: candidate.order_code,
        previousStatus: candidate.status,
        newStatus: 'PROCESSING',
        changedBy: 'SYSTEM_WALLET_RECONCILIATION',
        reason: 'Khôi phục đơn đã trừ ví nhưng phiên bản cũ chưa xác nhận thanh toán',
        metadata: { walletTransactionId: candidate.wallet_transaction_id },
      });
      rows.push({
        orderCode: candidate.order_code,
        guildId: candidate.guild_id,
        customerId: candidate.customer_id,
        walletTransactionId: candidate.wallet_transaction_id,
      });
    }
    return rows;
  })();

  for (const item of repaired) {
    syncCustomerStats(item.guildId, item.customerId);
    scheduleAdminOrderCenterRefresh(item.guildId);
  }
  if (repaired.length > 0) {
    broadcastDashboardEvent('order_update', `Đối soát ${repaired.length} đơn thanh toán ví`);
  }
  return { scanned: candidates.length, repaired };
}
export function setOrderStatus(orderCode,status){
  const order=getOrderByCode(orderCode); if(!order) return null; 
  setOrderStatusStmt().run(status, nowIso(), nowIso(), orderCode); 
  const updated=getOrderByCode(orderCode);
  if (order.status !== updated.status) {
    recordStatusChange(db, { orderCode, previousStatus: order.status, newStatus: updated.status, changedBy: 'SYSTEM', reason: 'setOrderStatus' });
  }
  syncCustomerStats(updated.guild_id, updated.customer_id); 
  scheduleCtvOrderLogSync(updated);
  scheduleAdminOrderCenterRefresh(updated.guild_id);
  
  // Tích luỹ điểm thưởng khi đơn hàng chuyển sang trạng thái COMPLETED
  if (status === 'COMPLETED' && updated && updated.guild_id !== 'WEB' && updated.customer_id !== 'WEB') {
    try {
      awardOrderPoints(updated.guild_id, updated.customer_id, updated.order_code, updated.total_amount);
    } catch (e) {
      console.error('[LOYALTY] Lỗi awardOrderPoints trong setOrderStatus:', e);
    }
  }

  broadcastDashboardEvent('order_update'); 
  return updated;
}
export function completeWarranty(orderCode, completedById){
  const order = getOrderByCode(orderCode);
  if (!order) return { completed: false, order: null };
  const completedAt = nowIso();
  const result = db.transaction(() => {
    const update = completeWarrantyStmt().run(completedAt, completedAt, completedById, completedAt, orderCode);
    if (update.changes > 0) {
      recordStatusChange(db, {
        orderCode,
        previousStatus: order.status,
        newStatus: 'COMPLETED',
        actor: completedById || 'SYSTEM',
        reason: 'Warranty approved and completed',
      });
    }
    return update;
  })();
  const updated = getOrderByCode(orderCode);
  if (result.changes > 0) {
    scheduleCtvOrderLogSync(updated);
    try { syncCustomerStats(updated.guild_id, updated.customer_id); }
    catch (error) { console.error('[WARRANTY] Customer stats sync failed:', error.message); }
    try { broadcastDashboardEvent('order_update', `Warranty completed: ${orderCode}`); }
    catch (error) { console.error('[WARRANTY] Dashboard event failed:', error.message); }
  }
  return { completed: result.changes > 0, order: updated };
}
export function updateOrderEditableFields(orderCode,{productName,quantity,totalAmount,priorityRank}){const order=getOrderByCode(orderCode); if(!order) return null; const nextName=productName ?? order.product_name; const nextQty=quantity ?? order.quantity; const nextAmount=totalAmount === undefined ? order.total_amount : ensureAmountValue(totalAmount); const nextPriority=priorityRank === undefined ? Number(order.priority_rank ?? 0) : Number(priorityRank); updateOrderFieldsStmt().run(nextName, nextQty, nextAmount, normalizeQueueGroup(nextName) || 'mac-dinh', nextPriority, nowIso(), orderCode); return getOrderByCode(orderCode);}

export const getOutstandingOrders = (guildId, customerId=null, limit=20, offset=0) => getOutstandingOrdersStmt().all(guildId, customerId, customerId, limit, offset);
export const getOutstandingSummary = (guildId, customerId=null) => getOutstandingSummaryStmt().get(guildId, customerId, customerId) ?? { total_orders:0, waiting_payment:0, processing:0, warranty_open:0 };

export function recordPaymentEvent({ orderCode, provider, transactionId, amount, content, rawPayload }){if(!transactionId) return {duplicate:false,event:null}; const existing=getPaymentEventByTxStmt().get(provider, transactionId); if(existing) return {duplicate:true,event:existing}; insertPaymentEventStmt().run(orderCode ?? null, provider, transactionId, ensureAmountValue(amount), content ?? null, rawPayload ? JSON.stringify(rawPayload) : null, nowIso()); return {duplicate:false,event:getPaymentEventByTxStmt().get(provider, transactionId)};}
export const getOrdersNeedingPaymentReminder = (cutoffIso, limit=20) => getPendingPaymentReminderStmt().all(cutoffIso, limit);
export const getOrdersNeedingProcessingReminder = (cutoffIso, limit=20) => getProcessingReminderStmt().all(cutoffIso, limit);
export function markPaymentReminderSent(orderCode){const t=nowIso(); markPaymentReminderSentStmt().run(t,t,orderCode); return getOrderByCode(orderCode);}
export function markProcessingReminderSent(orderCode){const t=nowIso(); markProcessingReminderSentStmt().run(t,t,orderCode); return getOrderByCode(orderCode);}
export const getTopProducts = (guildId, limit=5) => topProductsSalesStmt().all(guildId, limit);
export function getStaffKpis(guildId, limit=10){return getStaffKpiStmt().all(guildId, limit).map((row)=>({ ...row, avg_completion_seconds: Number(averageCompletionTimeStmt().get(guildId, row.actor_id)?.avg_seconds ?? 0) }));}

export const getOrdersExpiringBetween = (fromIso, toIso, limit=20) => getOrdersExpiringBetweenStmt().all(fromIso, toIso, limit);
export function markExpiryReminderSent(orderCode, daysBefore){ const t = nowIso(); if (Number(daysBefore) >= 2) markExpiryNotice2dStmt().run(t, t, orderCode); else markExpiryNotice1dStmt().run(t, t, orderCode); return getOrderByCode(orderCode); }

// Lấy đơn đã hoàn thành của khách (cho warranty select menu)
export function getCompletedOrdersByCustomer(guildId, customerId, limit = 25) {
  return db.prepare(`
    SELECT * FROM orders
    WHERE guild_id = ? AND customer_id = ?
      AND status IN ('COMPLETED', 'WARRANTY_OPEN')
    ORDER BY completed_at DESC, id DESC
    LIMIT ?
  `).all(guildId, customerId, limit);
}


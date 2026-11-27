import { db, nowIso } from '../database/db.js';
import { addHours } from '../utils/time.js';
import { config } from '../config.js';
import { randomDigits } from '../utils/id.js';
import { syncCustomerStats, getCustomerProfile } from './customerService.js';
import { addOrderDuration, normalizeOrderDurationStorage, normalizeQueueGroup } from '../utils/formatters.js';
import { isSpotifyProductName, normalizeServiceSearch } from '../utils/serviceDetection.js';
import { broadcastDashboardEvent } from './dashboardMiniServer.js';
import { encrypt } from '../utils/crypto.js';
import { awardOrderPoints, refundOrderPoints } from './loyaltyService.js';
import { canCancelUnpaidOrder, ensureStatusHistoryTable, recordStatusChange } from './orderStateMachine.js';
import { syncCtvOrderLog } from './ctvOrderLogService.js';
import {
  markAdminOrderReminderLifecycleChanged,
  scheduleAdminOrderCenterRefresh,
} from './adminOrderCenterService.js';
import { unscheduleOrderTicketAutoClose } from './ticketService.js';
import { getCustomerPurchaseSummary, getCustomerActivitySummary } from './customerActivityService.js';
import { membershipPriorityForSpend } from '../config/membershipProgram.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import { getBookingInvoiceForOrder, isBookingPayOSReceipt } from './bookingLedgerService.js';
import { getStoredPayOSReceivedAmount } from '../utils/payosReceipt.js';
import { PaidOrderRefundError, recordPaidOrderRefund, REFUND_HOLD_MESSAGE } from './paidOrderRefundService.js';
import { voidRefundLedgerRow } from './refundLedgerService.js';
import { hasPriorNitroPurchase, isNitroRenewalProduct, NITRO_RENEWAL_NOT_ELIGIBLE } from '../config/nitroPricing202611.js';

function createOrderStmt() {
  return db.prepare(`
    INSERT INTO orders (
      order_code, guild_id, ticket_id, ticket_channel_id, customer_id,
      product_id, product_name, quantity, note, total_amount, amount_paid, payment_provider,
      payment_code, payos_order_code, payment_status, status, status_changed_at,
      queue_group, priority_rank, duration_months, duration_days, order_log_channel_id, created_by_id, created_at, updated_at, service_type,
      discord_sku_id, discord_product_url, discord_original_price, discord_nitro_eligible
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
}
function orderCodeExistsStmt(){return db.prepare('SELECT 1 FROM orders WHERE order_code=? LIMIT 1');}
function getOrderByIdStmt(){return db.prepare('SELECT * FROM orders WHERE id=?');}
function getOrderByCodeStmt(){return db.prepare('SELECT * FROM orders WHERE order_code=?');}
function getOrderByPayOSCodeStmt(){return db.prepare('SELECT * FROM orders WHERE payos_order_code=? LIMIT 1');}
function getOrderByPaymentCodeStmt(){return db.prepare('SELECT * FROM orders WHERE payment_code=? OR order_code=? LIMIT 1');}
function getLatestOrderByTicketChannelStmt(){return db.prepare('SELECT * FROM orders WHERE ticket_channel_id=? ORDER BY id DESC LIMIT 1');}
function updateOrderLogStmt(){return db.prepare('UPDATE orders SET order_log_message_id=?, updated_at=? WHERE order_code=?');}
function saveCompletionMessageStmt(){return db.prepare(`UPDATE orders SET completion_channel_id=?, completion_message_id=?, completion_staff_id=?, completion_support_id=?, updated_at=? WHERE order_code=?`);}
function attachPaymentMessageStmt(){return db.prepare('UPDATE orders SET payment_message_id=?, updated_at=? WHERE order_code=?');}
function savePaymentLinkStmt(){return db.prepare('UPDATE orders SET payment_link_id=?, payment_checkout_url=?, payment_qr_code=?, payment_qr_url=?, payment_qr_text=?, payment_expired_at=?, updated_at=? WHERE order_code=?');}
function resetPaymentLinkStmt(){return db.prepare('UPDATE orders SET payment_link_id=NULL, payment_checkout_url=NULL, payment_qr_code=NULL, payment_qr_url=NULL, payment_qr_text=NULL, payment_expired_at=NULL, payment_message_id=NULL, payos_order_code=?, updated_at=? WHERE order_code=?');}
function completeOrderStmt(){return db.prepare(`UPDATE orders SET status='COMPLETED', status_changed_at=?, completed_by_id=?, completed_at=?, feedback_requested_at=?, feedback_due_at=?, updated_at=? WHERE order_code=? AND status=? AND payment_status=? AND customer_id=? AND guild_id=? AND total_amount=? AND updated_at=? AND status NOT IN ('CANCELLED','REFUND_PENDING','REFUNDED','FAILED') AND payment_status NOT IN ('CANCELLED','REFUNDED')`);}
function cancelOrderStmt(){return db.prepare(`UPDATE orders SET status='CANCELLED', status_changed_at=?, payment_status='CANCELLED', payment_cancel_reason=COALESCE(?, payment_cancel_reason), updated_at=? WHERE order_code=?`);}
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
function listWarrantyOrdersStmt(){return db.prepare(`SELECT * FROM orders WHERE guild_id=? AND customer_id=? AND status IN ('COMPLETED','WARRANTY_OPEN') ORDER BY CASE status WHEN 'WARRANTY_OPEN' THEN 0 ELSE 1 END, COALESCE(completed_at, updated_at, created_at) DESC, id DESC LIMIT ?`);}
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
function updateOrderFieldsStmt(){return db.prepare(`UPDATE orders SET product_name=?, service_type=?, quantity=?, total_amount=?, queue_group=?, priority_rank=?, updated_at=? WHERE order_code=?`);}
function getStaffKpiStmt(){return db.prepare(`SELECT actor_id, COUNT(*) total_actions, SUM(CASE WHEN action IN ('ORDER_COMPLETE_MANUAL','ORDER_COMPLETE_AUTO','ORDER_COMPLETED') THEN 1 ELSE 0 END) completed_orders, SUM(CASE WHEN action IN ('DELIVERY_SENT','ORDER_DELIVERED') THEN 1 ELSE 0 END) deliveries, SUM(CASE WHEN action IN ('ORDER_CLAIM','ORDER_CLAIMED') THEN 1 ELSE 0 END) claims FROM staff_logs WHERE guild_id=? AND actor_id IS NOT NULL GROUP BY actor_id ORDER BY completed_orders DESC, deliveries DESC, total_actions DESC LIMIT ?`);}
function averageCompletionTimeStmt(){return db.prepare(`SELECT AVG((julianday(completed_at)-julianday(created_at))*86400.0) avg_seconds FROM orders WHERE guild_id=? AND completed_by_id=? AND completed_at IS NOT NULL`);}

export function generateUniqueOrderCode(){while(true){const c=`CN_${randomDigits(6)}`; if(!orderCodeExistsStmt().get(c)) return c;}}
function ensureAmountValue(v){const a=Number(v ?? 0); return Number.isFinite(a)&&a>0?Math.trunc(a):0;}
function computePriority(guildId, customerId, productName) {
  const profile=getCustomerProfile(guildId,customerId);
  const legacy=Number(profile?.total_completed_orders || 0)>=config.vipRoleThreshold ? 100 : 0;
  const rank=guildId===STORE_ONE_GUILD_ID
    ? membershipPriorityForSpend(getCustomerPurchaseSummary(guildId,customerId).spent + getCustomerActivitySummary(guildId,customerId).serviceSpent)
    : legacy;
  return rank + (/vip/i.test(productName || '') ? 20 : 0);
}

function normalizeCatalogServiceType(value) {
  const normalized = normalizeServiceSearch(value);
  if (!normalized || normalized === 'other') return null;
  if (normalized === 'spotify') return 'spotify';
  if (normalized === 'youtube') return 'youtube';
  if (normalized === 'netflix') return 'netflix';
  if (['discord', 'nitro', 'boost', 'game'].includes(normalized)) return 'discord';
  if (normalized === 'service') return 'service';
  if (normalized === 'ai') return 'ai';
  if (normalized === 'gearup' || normalized === 'gear') return 'gearup';
  if (normalized === 'decor') return 'decor';
  return null;
}

export function detectServiceType(name, explicitServiceType = null) {
  const explicit = normalizeCatalogServiceType(explicitServiceType);
  if (explicit) return explicit;
  if (!name) return 'netflix';
  const l = normalizeServiceSearch(name);
  if (l.includes('setup') || l.includes('bot custom') || l.includes('website custom') || l.includes('duy trì bot')) return 'service';
  if (isSpotifyProductName(name) || l.includes('spot')) return 'spotify';
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

export function createOrder({ guildId, ticketId, ticketChannelId, customerId, productId = null, productName, serviceType = null, quantity, note, totalAmount = 0, durationMonths = config.defaultOrderDurationMonths, durationDays = null, orderLogChannelId, createdById, orderCode, discordSkuId = null, discordProductUrl = null, discordOriginalPrice = null, discordNitroEligible = false }) {
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
  const normalizedServiceType = detectServiceType(productName, serviceType);
  // Prefer the explicitly selected catalog row. For legacy/manual commands,
  // recover the WEB catalog row from the immutable name + duration snapshot.
  // Discord collectibles use discord_sku_id and intentionally have no catalog
  // row, so they remain null here.
  const explicitProductId = Number(productId);
  let linkedProductId = Number.isSafeInteger(explicitProductId) && explicitProductId > 0
    ? db.prepare(`SELECT id FROM product_catalog WHERE id = ? AND guild_id IN ('WEB', ?)
        ORDER BY CASE WHEN guild_id = 'WEB' THEN 0 ELSE 1 END, id LIMIT 1`).get(explicitProductId, guildId)?.id ?? null
    : null;
  if (!linkedProductId && productName) {
    linkedProductId = db.prepare(`SELECT pc.id FROM product_catalog pc
      WHERE pc.guild_id = 'WEB'
        AND LOWER(TRIM(pc.name)) = LOWER(TRIM(?))
        AND (COALESCE(pc.duration_months, 0) = COALESCE(?, 0)
          OR (SELECT COUNT(*) FROM product_catalog same_name
              WHERE same_name.guild_id = 'WEB'
                AND LOWER(TRIM(same_name.name)) = LOWER(TRIM(?))) = 1)
      ORDER BY CASE WHEN COALESCE(pc.duration_months, 0) = COALESCE(?, 0) THEN 0 ELSE 1 END, pc.id
      LIMIT 1`).get(productName, safeDurationMonths, productName, safeDurationMonths)?.id ?? null;
  }

  // Backstop for every creation path: the returning-customer Nitro price needs a prior Nitro order.
  if (linkedProductId) {
    const linked = db.prepare('SELECT product_key FROM product_catalog WHERE id = ?').get(linkedProductId);
    if (isNitroRenewalProduct(linked) && !hasPriorNitroPurchase(db, customerId)) {
      throw new OrderPaymentError('NOT_ELIGIBLE', NITRO_RENEWAL_NOT_ELIGIBLE);
    }
  }

  let resultId;
  const transaction = db.transaction(() => {
    const result = createOrderStmt().run(finalOrderCode,guildId,ticketId,ticketChannelId,customerId,linkedProductId,productName,quantity,note ?? null,safeAmount,safeAmount > 0 ? 0 : safeAmount,config.paymentProvider,paymentCode,payosOrderCode,paymentStatus,status,timestamp,queueGroup,priorityRank,safeDurationMonths,safeDurationDays,orderLogChannelId,createdById,timestamp,timestamp,normalizedServiceType,discordSkuId,discordProductUrl,discordOriginalPrice,discordNitroEligible ? 1 : 0);
    resultId = result.lastInsertRowid;
    syncCustomerStats(guildId, customerId);
  });
  
  transaction();
  broadcastDashboardEvent('order_update', `Đơn hàng mới: ${finalOrderCode}`);
  const createdOrder = getOrderById(Number(resultId));
  // A customer can create another order in the same ticket while a previous
  // feedback close timer is still pending. Keep the shared ticket alive.
  unscheduleOrderTicketAutoClose(createdOrder);
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
export function saveCompletionMessageReference(orderCode,{channelId,messageId,staffId,supportId}){saveCompletionMessageStmt().run(channelId ?? null,messageId ?? null,staffId ?? null,supportId ?? staffId ?? null,nowIso(),orderCode); return getOrderByCode(orderCode);}
export function saveCompletionUpdateDmReference(orderCode, { channelId, messageId }) {
  db.prepare('UPDATE orders SET completion_update_dm_channel_id=?, completion_update_dm_message_id=? WHERE order_code=?')
    .run(channelId, messageId, orderCode);
}
export function savePaymentMessage(orderCode, messageId){attachPaymentMessageStmt().run(messageId ?? null, nowIso(), orderCode); return getOrderByCode(orderCode);}
export function savePaymentLinkData(orderCode,{paymentLinkId,checkoutUrl,qrCode,qrUrl=null,qrText=null,expiredAt=null}){savePaymentLinkStmt().run(paymentLinkId ?? null, checkoutUrl ?? null, qrCode ?? null, qrUrl ?? null, qrText ?? null, expiredAt ?? null, nowIso(), orderCode); return getOrderByCode(orderCode);}

function generateUniquePayosCode(){while(true){const c=Number(randomDigits(6)); if(c>0 && !getOrderByPayOSCodeStmt().get(c)) return c;}}
// Xoá link PayOS cũ + cấp payos_order_code MỚI để tạo lại hoá đơn (QR đổi theo). Dùng khi đơn hết hạn.
export function resetPaymentLinkForRegen(orderCode){const order=getOrderByCode(orderCode); if(!order) return null; const newPayosCode=generateUniquePayosCode(); resetPaymentLinkStmt().run(newPayosCode, nowIso(), orderCode); return getOrderByCode(orderCode);}

/** Completed or under-warranty orders the customer owns in this guild, newest first (Discord select limit 25). */
export function listWarrantyEligibleOrders(guildId, customerId, limit = 25){return listWarrantyOrdersStmt().all(guildId, customerId, Math.min(25, Math.max(1, Number(limit) || 25)));}
export function setOrderExpiry(orderCode, expiryAt){ setOrderExpiryStmt().run(expiryAt, nowIso(), orderCode); return getOrderByCode(orderCode); }
export function ensureOrderExpiry(orderCode, baseDate = new Date()) { const order = getOrderByCode(orderCode); if (!order) return null; if (order.expiry_at) return order; const expiryDate = addOrderDuration(baseDate, order, config.defaultOrderDurationMonths); if (!expiryDate) return order; return setOrderExpiry(orderCode, expiryDate.toISOString()); }

export function markOrderCompleted(orderCode, completedById, timeoutHours = config.feedbackTimeoutHours, expectedOrder = null) {
  const order = getOrderByCode(orderCode); if (!order) return null;
  if (order.status === 'REFUND_PENDING') throw new PaidOrderRefundError(REFUND_HOLD_MESSAGE);
  if (['CANCELLED', 'REFUNDED', 'FAILED'].includes(order.status) || ['CANCELLED', 'REFUNDED'].includes(order.payment_status)) {
    throw Object.assign(new Error('Đơn đã dừng xử lý nên không thể hoàn thành.'), { code: 'ORDER_NOT_COMPLETABLE' });
  }
  const expected = expectedOrder || order;
  const completedAt = nowIso(); const dueAt = addHours(new Date(completedAt), timeoutHours).toISOString();
  const completed = completeOrderStmt().run(completedAt, completedById, completedAt, completedAt, dueAt, completedAt, orderCode,
    expected.status, expected.payment_status, expected.customer_id, expected.guild_id, expected.total_amount, expected.updated_at);
  if (completed.changes !== 1) {
    throw Object.assign(new Error('Đơn vừa thay đổi. Vui lòng kiểm tra lại trước khi hoàn thành.'), { code: 'ORDER_COMPLETION_CONFLICT' });
  }
  clearClaimStmt().run(completedAt, orderCode);
  ensureOrderExpiry(orderCode, new Date(completedAt));
  const updated = getOrderByCode(orderCode);
  markAdminOrderReminderLifecycleChanged(order, updated);
  if (order.status !== updated.status) {
    recordStatusChange(db, { orderCode, previousStatus: order.status, newStatus: updated.status, actor: completedById || 'SYSTEM', reason: 'Order marked completed' });
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
export function cancelOrder(orderCode, reason = null, { actorId = 'SYSTEM', expectedOrder = null } = {}) {
  const result = db.transaction(() => {
    const order = getOrderByCode(orderCode);
    if (!canCancelUnpaidOrder(order)) return null;
    if (expectedOrder && ['guild_id', 'customer_id', 'ticket_channel_id', 'payment_provider', 'payment_link_id',
      'payos_order_code', 'total_amount'].some(field => order[field] !== expectedOrder[field])) return null;
    const timestamp = nowIso();
    cancelOrderStmt().run(timestamp, reason, timestamp, orderCode);
    clearClaimStmt().run(timestamp, orderCode);
    recordStatusChange(db, { orderCode, previousStatus: order.status, newStatus: 'CANCELLED', actor: actorId, reason: reason || 'Order cancelled' });
    return { order, updated: getOrderByCode(orderCode) };
  }).immediate();
  if (!result) return null;
  const { order, updated } = result;
  
  if (order.guild_id !== 'WEB' && order.customer_id !== 'WEB') {
    try {
      refundOrderPoints(order.guild_id, order.customer_id, order.order_code);
    } catch (e) {
      console.error('[LOYALTY] Lỗi refundOrderPoints trong cancelOrder:', e);
    }
  }

  markAdminOrderReminderLifecycleChanged(order, updated);
  syncCustomerStats(updated.guild_id, updated.customer_id); 
  scheduleCtvOrderLogSync(updated);
  scheduleAdminOrderCenterRefresh(updated.guild_id);
  return updated;
}

export function updatePaidOrderRefund(options) {
  const result = recordPaidOrderRefund(db, options);
  if (!result.changed) return result;
  const { order, updated } = result;
  try {
    if (updated.status === 'REFUNDED' && order.guild_id !== 'WEB' && order.customer_id !== 'WEB') {
      refundOrderPoints(order.guild_id, order.customer_id, order.order_code);
    }
    markAdminOrderReminderLifecycleChanged(order, updated);
    syncCustomerStats(updated.guild_id, updated.customer_id);
    scheduleAdminOrderCenterRefresh(updated.guild_id);
    broadcastDashboardEvent('order_update');
  } catch (error) {
    console.error('[ORDER_REFUND] Could not refresh derived order data:', error.code || error.name);
  }
  return result;
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

  const amount = validateOrderPaymentAmount(order, amountPaid);

  // Record a late receipt without reactivating a cancelled order automatically.
  if (order.status === 'CANCELLED') {
    console.warn(`[ORDER] markOrderPaid: đơn ${orderCode} đã bị CANCELLED nhưng nhận tiền, cần staff đối soát.`);
  }

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

export function restoreCancelledPayOSOrder({ orderCode, guildId, actorId, complete = false }) {
  const { order, updated } = db.transaction(() => {
    const order = getOrderByCode(orderCode);
    if (!order || order.guild_id !== guildId || order.status !== 'CANCELLED') {
      throw new OrderPaymentError('CANCELLED_ORDER_NOT_FOUND', 'Không tìm thấy đơn đã hủy trong máy chủ này.');
    }
    if (order.fulfillment_mode === 'SUPPLIER') {
      throw new OrderPaymentError('SUPPLIER_ORDER', 'Đơn AutoBuy cần được xử lý trong bảng quản trị AutoBuy.');
    }
    if (order.payment_status !== 'PAID' || order.payment_provider !== 'PAYOS') {
      throw new OrderPaymentError('NO_PAYOS_PAYMENT', 'Chỉ có thể khôi phục đơn đã hủy khi bot đã xác nhận thanh toán PayOS.');
    }
    ensureStatusHistoryTable(db);
    const hadRefund = db.prepare(`SELECT 1 FROM wallet_transactions
      WHERE related_code = ? AND customer_id = ? AND guild_id = ? AND amount > 0
        AND type IN ('REFUND', 'ORDER_REFUND', 'REFUND_ORDER')`).get(orderCode, order.customer_id, guildId)
      || db.prepare("SELECT 1 FROM order_status_history WHERE order_code = ? AND new_status = 'REFUNDED'").get(orderCode);
    const hadDelivery = order.delivered_at || order.completed_at
      || db.prepare('SELECT 1 FROM order_delivery_items WHERE order_code = ? LIMIT 1').get(orderCode);
    if (hadRefund || hadDelivery) {
      throw new OrderPaymentError('ORDER_ALREADY_HANDLED', 'Đơn có dấu vết hoàn tiền hoặc giao hàng. Kiểm tra lịch sử đơn trước khi xử lý.');
    }
    const receipt = db.prepare(`SELECT id, amount, raw_payload FROM payment_events
      WHERE order_code = ? AND provider = 'PAYOS' AND transaction_id = ?`).get(orderCode, order.paid_transaction_id);
    if (!receipt) {
      throw new OrderPaymentError('MISSING_PAYOS_RECEIPT', 'Chưa tìm thấy giao dịch PayOS gốc. Vui lòng đối soát đơn.');
    }
    validateOrderPaymentAmount(order, order.amount_paid);
    validateOrderPaymentAmount(order, receipt.amount);
    validateOrderPaymentAmount(order, getStoredPayOSReceivedAmount(receipt.raw_payload));

    const timestamp = nowIso();
    db.prepare(`UPDATE orders SET status = 'PROCESSING', status_changed_at = ?, updated_at = ?
      WHERE order_code = ?`).run(timestamp, timestamp, orderCode);
    recordStatusChange(db, {
      orderCode,
      previousStatus: order.status,
      newStatus: 'PROCESSING',
      actor: actorId,
      reason: 'Khôi phục đơn đã hủy bằng giao dịch PayOS đã xác nhận',
      metadata: { paymentEventId: receipt.id },
    });
    const updated = complete ? markOrderCompleted(orderCode, actorId) : getOrderByCode(orderCode);
    return { order, updated };
  }).immediate();

  if (complete) return updated;
  markAdminOrderReminderLifecycleChanged(order, updated);
  syncCustomerStats(updated.guild_id, updated.customer_id);
  scheduleCtvOrderLogSync(updated);
  scheduleAdminOrderCenterRefresh(updated.guild_id);
  broadcastDashboardEvent('order_update');
  return updated;
}

// ── Manager override for Discord /quanly-don ──
// Managers can move any order of their guild (including auto-cancelled,
// refunded or long-finished orders). The guards below only stop unsafe
// concurrency (a running delivery) and AutoBuy orders, whose supplier workflow
// may spend real money. Every change is written to order_status_history.
const MANAGER_STOPPED_STATUSES = new Set(['CANCELLED', 'FAILED', 'REFUNDED', 'REFUND_PENDING']);

function assertManagerCanChange(order, guildId, { blockSupplier = true } = {}) {
  if (!order || order.guild_id !== guildId) {
    throw new OrderPaymentError('ORDER_NOT_FOUND', 'Không tìm thấy mã đơn trong máy chủ này.');
  }
  if (blockSupplier && order.fulfillment_mode === 'SUPPLIER') {
    throw new OrderPaymentError('SUPPLIER_ORDER', 'Đơn AutoBuy cần được xử lý trong bảng quản trị AutoBuy.');
  }
  const sending = db.prepare(`SELECT 1 FROM order_fulfillments
    WHERE order_code = ? AND status = 'SENDING' AND lease_until > ?`).get(order.order_code, nowIso());
  if (sending) {
    throw new OrderPaymentError('DELIVERY_RUNNING', 'Bot đang giao hàng cho đơn này. Chờ lượt giao xong rồi thử lại.');
  }
}

function managerOrderWarnings(order) {
  ensureStatusHistoryTable(db);
  const warnings = [];
  const refunded = order.status === 'REFUNDED' || order.payment_status === 'REFUNDED'
    || db.prepare(`SELECT 1 FROM wallet_transactions
      WHERE related_code = ? AND customer_id = ? AND guild_id = ? AND amount > 0
        AND type IN ('REFUND', 'ORDER_REFUND', 'REFUND_ORDER')`).get(order.order_code, order.customer_id, order.guild_id)
    || db.prepare("SELECT 1 FROM order_status_history WHERE order_code = ? AND new_status = 'REFUNDED'").get(order.order_code);
  if (refunded) warnings.push('Đơn từng được ghi nhận hoàn tiền. Kiểm tra để không trả tiền hai lần.');
  if (order.delivered_at || db.prepare('SELECT 1 FROM order_delivery_items WHERE order_code = ? LIMIT 1').get(order.order_code)) {
    warnings.push('Đơn đã có dữ liệu giao hàng từ trước.');
  }
  return warnings;
}

function afterManagerChange(order, updated) {
  markAdminOrderReminderLifecycleChanged(order, updated);
  syncCustomerStats(updated.guild_id, updated.customer_id);
  scheduleCtvOrderLogSync(updated);
  scheduleAdminOrderCenterRefresh(updated.guild_id);
  broadcastDashboardEvent('order_update');
}

/**
 * Reopen a stopped order (cancelled, failed, refunded or awaiting refund) to
 * PROCESSING. Existing payment evidence is kept. With markPaid and no money on
 * record, the manager's confirmation is stored as a MANUAL payment. With
 * complete, the reopened order is completed in the same transaction.
 */
export function reopenOrderForManager({ orderCode, guildId, actorId, markPaid = false, complete = false }) {
  const result = db.transaction(() => {
    const order = getOrderByCode(orderCode);
    assertManagerCanChange(order, guildId);
    if (!MANAGER_STOPPED_STATUSES.has(order.status)) {
      throw new OrderPaymentError('ORDER_ACTIVE', 'Đơn đang hoạt động nên không cần mở lại.');
    }
    const warnings = managerOrderWarnings(order);
    const timestamp = nowIso();
    const settled = ['PAID', 'FREE'].includes(order.payment_status);
    const hasMoney = Number(order.amount_paid ?? 0) > 0 || Boolean(order.paid_at);
    const payment = {
      status: order.payment_status, amount: order.amount_paid, paidAt: order.paid_at,
      transactionId: order.paid_transaction_id, content: order.paid_transaction_content,
    };
    let manualPayment = false;
    if (!settled) {
      if (hasMoney) {
        payment.status = 'PAID';
      } else if (markPaid) {
        Object.assign(payment, {
          status: 'PAID', amount: validateOrderPaymentAmount(order, order.total_amount), paidAt: timestamp,
          transactionId: 'MANUAL', content: 'Quản lý xác nhận thủ công qua /quanly-don',
        });
        manualPayment = true;
      } else {
        payment.status = 'UNPAID';
      }
    }
    db.prepare(`UPDATE orders SET status = 'PROCESSING', status_changed_at = ?, payment_status = ?, amount_paid = ?,
      paid_at = ?, paid_transaction_id = ?, paid_transaction_content = ?, updated_at = ? WHERE order_code = ?`)
      .run(timestamp, payment.status, payment.amount ?? 0, payment.paidAt ?? null, payment.transactionId ?? null,
        payment.content ?? null, timestamp, orderCode);
    if (order.status === 'REFUNDED') {
      voidRefundLedgerRow(db, { orderCode, actorId, reason: 'Quản lý mở lại đơn đã hoàn qua /quanly-don' });
    }
    recordStatusChange(db, {
      orderCode, previousStatus: order.status, newStatus: 'PROCESSING', actor: actorId,
      reason: 'Quản lý mở lại đơn qua /quanly-don',
      metadata: { previousPaymentStatus: order.payment_status, paymentStatus: payment.status, manualPayment, warnings },
    });
    const updated = complete ? markOrderCompleted(orderCode, actorId, 24) : getOrderByCode(orderCode);
    return { order, updated, warnings, manualPayment };
  }).immediate();
  if (!complete) afterManagerChange(result.order, result.updated);
  return result;
}

/**
 * Cancel any order. Unpaid orders keep the normal cancellation (payment marked
 * CANCELLED). Paid or finished orders keep their payment evidence so the refund
 * actions and reports still see the money received.
 */
export function cancelOrderForManager({ orderCode, guildId, actorId, reason = null }) {
  const result = db.transaction(() => {
    const order = getOrderByCode(orderCode);
    const unpaid = canCancelUnpaidOrder(order);
    assertManagerCanChange(order, guildId, { blockSupplier: !unpaid });
    if (order.status === 'CANCELLED') return { order, updated: order, changed: false, warnings: [], keptPayment: false };
    const warnings = managerOrderWarnings(order);
    const timestamp = nowIso();
    if (unpaid) {
      cancelOrderStmt().run(timestamp, reason, timestamp, orderCode);
    } else {
      db.prepare(`UPDATE orders SET status = 'CANCELLED', status_changed_at = ?,
        payment_cancel_reason = COALESCE(?, payment_cancel_reason), updated_at = ? WHERE order_code = ?`)
        .run(timestamp, reason, timestamp, orderCode);
    }
    clearClaimStmt().run(timestamp, orderCode);
    recordStatusChange(db, {
      orderCode, previousStatus: order.status, newStatus: 'CANCELLED', actor: actorId,
      reason: reason || 'Quản lý hủy đơn qua /quanly-don', metadata: { keptPayment: !unpaid, warnings },
    });
    return { order, updated: getOrderByCode(orderCode), changed: true, warnings, keptPayment: !unpaid };
  }).immediate();
  if (!result.changed) return result;
  const { order, updated } = result;
  if (order.guild_id !== 'WEB' && order.customer_id !== 'WEB') {
    try {
      refundOrderPoints(order.guild_id, order.customer_id, order.order_code);
    } catch (error) {
      console.error('[LOYALTY] Lỗi refundOrderPoints trong cancelOrderForManager:', error);
    }
  }
  afterManagerChange(order, updated);
  return result;
}

// The durable queue is committed with the payment; Discord may be unavailable.
export function queueOrderDelivery(orderCode) {
  const timestamp = nowIso();
  db.prepare(`INSERT INTO order_fulfillments (order_code, retry_at, updated_at)
    SELECT order_code, ?, ? FROM orders
    WHERE order_code = ? AND payment_status = 'PAID' AND status = 'PROCESSING'
      AND COALESCE(fulfillment_mode,'LEGACY') != 'SUPPLIER'
      AND delivered_at IS NULL
    ON CONFLICT(order_code) DO NOTHING`).run(timestamp, timestamp, orderCode);
}

export function recordOrderPayment({ orderCode, provider, transactionId, amount, content, rawPayload }) {
  return db.transaction(() => {
    const order = getOrderByCode(orderCode);
    if (!order) throw new Error('Không tìm thấy đơn hàng.');
    const booking = getBookingInvoiceForOrder(db, order);
    if (booking && (provider !== 'PAYOS' || !isBookingPayOSReceipt(order, booking, rawPayload))) {
      throw new OrderPaymentError('BOOKING_PAYMENT_IDENTITY_MISMATCH', 'Chứng từ PayOS không khớp hóa đơn booking.');
    }
    // Validate even on a replay, before creating financial/delivery side effects.
    validateOrderPaymentAmount(order, amount);
    const event = recordPaymentEvent({ orderCode, provider, transactionId, amount, content, rawPayload });
    if (event.event && event.event.order_code !== orderCode) {
      throw new Error('Giao dịch thanh toán đã thuộc một đơn hàng khác.');
    }
    // Recover legacy events inserted before a failed order update as well.
    const duplicate = order.payment_status === 'PAID';
    const updated = duplicate ? order : markOrderPaid(orderCode, {
      amountPaid: amount, transactionId, transactionContent: content,
    });
    if (!booking) queueOrderDelivery(orderCode);
    return { updated, duplicate };
  }).immediate();
}

export class OrderPaymentError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OrderPaymentError';
    this.code = code;
  }
}

export function validateOrderPaymentAmount(order, value) {
  const amount = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
  const expected = Number(order?.total_amount);
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(expected) || expected <= 0) {
    throw new OrderPaymentError('INVALID_PAYMENT_AMOUNT', 'Số tiền thực nhận không hợp lệ; chưa xác nhận thanh toán.');
  }
  if (amount < expected) {
    throw new OrderPaymentError('INSUFFICIENT_PAYMENT', 'Số tiền thực nhận chưa đủ tổng đơn; chưa xác nhận thanh toán.');
  }
  return amount;
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
    if (getBookingInvoiceForOrder(db, order)) {
      throw new WalletPaymentError('PAYMENT_METHOD_LOCKED', 'Vui lòng dùng QR PayOS trong phiếu booking.');
    }
    if (order.fulfillment_mode === 'SUPPLIER') {
      // A PayOS invoice and a wallet debit must not race for the same supplier
      // order. The dedicated checkout chooses one method durably first.
      const method = db.prepare('SELECT method FROM supplier_autobuy_payment_methods WHERE order_code=?').get(orderCode);
      if (method?.method !== 'WALLET') throw new WalletPaymentError('PAYMENT_METHOD_LOCKED', 'Vui lòng thanh toán từ bảng AutoBuy của đơn này.');
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

    queueOrderDelivery(orderCode);

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
  if (['REFUND_PENDING', 'REFUNDED'].includes(order.status)) return null;
  setOrderStatusStmt().run(status, nowIso(), nowIso(), orderCode); 
  const updated=getOrderByCode(orderCode);
  markAdminOrderReminderLifecycleChanged(order, updated);
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
    markAdminOrderReminderLifecycleChanged(order, updated);
    scheduleCtvOrderLogSync(updated);
    try { syncCustomerStats(updated.guild_id, updated.customer_id); }
    catch (error) { console.error('[WARRANTY] Customer stats sync failed:', error.message); }
    try { broadcastDashboardEvent('order_update', `Warranty completed: ${orderCode}`); }
    catch (error) { console.error('[WARRANTY] Dashboard event failed:', error.message); }
  }
  return { completed: result.changes > 0, order: updated };
}
export function updateOrderEditableFields(orderCode,{productName,quantity,totalAmount,priorityRank}){const order=getOrderByCode(orderCode); if(!order) return null; const nextName=productName ?? order.product_name; const nextQty=quantity ?? order.quantity; const nextAmount=totalAmount === undefined ? order.total_amount : ensureAmountValue(totalAmount); const nextPriority=priorityRank === undefined ? Number(order.priority_rank ?? 0) : Number(priorityRank); const nextServiceType=productName === undefined ? detectServiceType(nextName, order.service_type) : detectServiceType(nextName); updateOrderFieldsStmt().run(nextName, nextServiceType, nextQty, nextAmount, normalizeQueueGroup(nextName) || 'mac-dinh', nextPriority, nowIso(), orderCode); return getOrderByCode(orderCode);}

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


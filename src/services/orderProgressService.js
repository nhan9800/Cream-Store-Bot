import { db, nowIso } from '../database/db.js';

export const ORDER_PROGRESS_STAGES = {
  QUEUED: 'Đã thanh toán · chờ xử lý',
  PREPARING: 'Đang chuẩn bị hàng',
  WAITING_CUSTOMER: 'Cần khách bổ sung thông tin',
  DELIVERING: 'Đang bàn giao',
};

export class OrderProgressError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

function ticketStatus(order, database) {
  return database.prepare('SELECT status FROM tickets WHERE id=? AND guild_id=? AND customer_id=?')
    .get(order.ticket_id, order.guild_id, order.customer_id)?.status || null;
}

function writable(order, database) {
  return ['PAID', 'FREE'].includes(order.payment_status)
    && ['PAID', 'PROCESSING', 'WAITING_STAFF', 'DELIVERING'].includes(order.status)
    && ticketStatus(order, database) === 'OPEN';
}

export function getOrderProgress(order, database = db) {
  const events = database.prepare('SELECT id,stage,note,created_at FROM order_progress_events WHERE order_code=? ORDER BY id DESC LIMIT 30')
    .all(order.order_code).reverse();
  const last = events.at(-1);
  let stage = ['PAID', 'FREE'].includes(order.payment_status) ? last?.stage || 'QUEUED' : 'WAITING_PAYMENT';
  if (order.status === 'COMPLETED') stage = 'COMPLETED';
  else if (['WARRANTY', 'WARRANTY_OPEN'].includes(order.status)) stage = 'WARRANTY';
  else if (['CANCELLED', 'REFUNDED', 'FAILED'].includes(order.status)) stage = order.status;
  const labels = { ...ORDER_PROGRESS_STAGES, WAITING_PAYMENT: 'Chờ thanh toán', COMPLETED: 'Đã hoàn thành',
    WARRANTY: 'Đang hỗ trợ bảo hành', CANCELLED: 'Đã huỷ', REFUNDED: 'Đã hoàn tiền', FAILED: 'Cần hỗ trợ' };
  const timeline = [
    { id: 'created', stage: 'CREATED', label: 'Đã tạo đơn', note: '', timestamp: order.created_at },
    ...(order.paid_at ? [{ id: 'paid', stage: 'PAID', label: 'Đã xác nhận thanh toán', note: '', timestamp: order.paid_at }] : []),
    ...events.map(e => ({ id: `progress-${e.id}`, stage: e.stage, label: labels[e.stage], note: e.note, timestamp: e.created_at })),
    ...(order.completed_at ? [{ id: 'completed', stage: 'COMPLETED', label: 'Đã hoàn thành', note: '', timestamp: order.completed_at }] : []),
    ...(['CANCELLED', 'REFUNDED', 'FAILED', 'WARRANTY', 'WARRANTY_OPEN'].includes(order.status) && order.status_changed_at
      ? [{ id: 'state', stage, label: labels[stage], note: '', timestamp: order.status_changed_at }] : []),
  ].filter(e => e.timestamp).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return { stage, label: labels[stage], note: last?.note || '', version: last?.id || 0,
    updatedAt: ['COMPLETED', 'CANCELLED', 'REFUNDED', 'FAILED', 'WARRANTY', 'WARRANTY_OPEN'].includes(order.status)
      ? order.status_changed_at || order.completed_at || order.created_at : last?.created_at || order.paid_at || order.created_at,
    writable: writable(order, database), ticketClosed: ticketStatus(order, database) === 'CLOSED', timeline };
}

export function updateOrderProgress({ orderCode, guildId, actorId, stage, note, requestId, expectedVersion }, database = db) {
  if (!Object.hasOwn(ORDER_PROGRESS_STAGES, stage) || typeof note !== 'string' || note.length > 500
    || !/^[A-Za-z0-9_-]{16,100}$/.test(String(requestId || ''))
    || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || !actorId) {
    throw new OrderProgressError('Thông tin cập nhật tiến độ không hợp lệ.', 400);
  }
  const text = note.trim();
  return database.transaction(() => {
    const order = database.prepare('SELECT * FROM orders WHERE order_code=? AND guild_id=?').get(orderCode, guildId);
    if (!order) throw new OrderProgressError('Không tìm thấy đơn trong shop hiện tại.', 404);
    const prior = database.prepare('SELECT stage,note,actor_id FROM order_progress_events WHERE order_code=? AND request_id=?')
      .get(orderCode, requestId);
    if (prior) {
      if (prior.stage !== stage || prior.note !== text || prior.actor_id !== actorId) {
        throw new OrderProgressError('Mã cập nhật đã được dùng cho nội dung khác.');
      }
      return { progress: getOrderProgress(order, database), duplicate: true };
    }
    const current = getOrderProgress(order, database);
    if (!current.writable) throw new OrderProgressError('Chỉ cập nhật đơn đã thanh toán, đang xử lý và có ticket còn mở.');
    if (current.version !== expectedVersion) throw new OrderProgressError('Tiến độ đã được người khác cập nhật. Hãy tải lại trước khi gửi.');
    const timestamp = nowIso();
    database.prepare('INSERT INTO order_progress_events(order_code,stage,note,actor_id,request_id,created_at) VALUES (?,?,?,?,?,?)')
      .run(orderCode, stage, text, actorId, requestId, timestamp);
    database.prepare('UPDATE tickets SET last_activity_at=? WHERE id=? AND guild_id=? AND status != ?')
      .run(timestamp, order.ticket_id, guildId, 'CLOSED');
    return { progress: getOrderProgress(order, database), duplicate: false };
  }).immediate();
}

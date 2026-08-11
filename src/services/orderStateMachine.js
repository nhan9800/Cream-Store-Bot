export const ORDER_STATUSES = {
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  PAYMENT_PROCESSING: 'PAYMENT_PROCESSING',
  PAID: 'PAID',
  PROCESSING: 'PROCESSING',
  WAITING_STAFF: 'WAITING_STAFF',
  DELIVERING: 'DELIVERING',
  COMPLETED: 'COMPLETED',
  WARRANTY: 'WARRANTY',
  WARRANTY_OPEN: 'WARRANTY_OPEN',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
};

export const VALID_TRANSITIONS = {
  [ORDER_STATUSES.PENDING_PAYMENT]: [
    ORDER_STATUSES.PAYMENT_PROCESSING,
    ORDER_STATUSES.PAID,
    ORDER_STATUSES.CANCELLED,
    ORDER_STATUSES.FAILED,
  ],
  [ORDER_STATUSES.PAYMENT_PROCESSING]: [
    ORDER_STATUSES.PAID,
    ORDER_STATUSES.CANCELLED,
    ORDER_STATUSES.FAILED,
  ],
  [ORDER_STATUSES.PAID]: [
    ORDER_STATUSES.PROCESSING,
    ORDER_STATUSES.WAITING_STAFF,
    ORDER_STATUSES.DELIVERING,
    ORDER_STATUSES.COMPLETED,
    ORDER_STATUSES.REFUNDED,
  ],
  [ORDER_STATUSES.PROCESSING]: [
    ORDER_STATUSES.DELIVERING,
    ORDER_STATUSES.WAITING_STAFF,
    ORDER_STATUSES.COMPLETED,
    ORDER_STATUSES.FAILED,
    ORDER_STATUSES.REFUNDED,
  ],
  [ORDER_STATUSES.WAITING_STAFF]: [
    ORDER_STATUSES.PROCESSING,
    ORDER_STATUSES.DELIVERING,
    ORDER_STATUSES.COMPLETED,
    ORDER_STATUSES.CANCELLED,
    ORDER_STATUSES.REFUNDED,
  ],
  [ORDER_STATUSES.DELIVERING]: [
    ORDER_STATUSES.COMPLETED,
    ORDER_STATUSES.WAITING_STAFF,
    ORDER_STATUSES.FAILED,
    ORDER_STATUSES.REFUNDED,
  ],
  [ORDER_STATUSES.COMPLETED]: [
    ORDER_STATUSES.WARRANTY,
    ORDER_STATUSES.WARRANTY_OPEN,
    ORDER_STATUSES.REFUNDED,
  ],
  [ORDER_STATUSES.WARRANTY]: [
    ORDER_STATUSES.COMPLETED,
    ORDER_STATUSES.REFUNDED,
  ],
  [ORDER_STATUSES.WARRANTY_OPEN]: [
    ORDER_STATUSES.COMPLETED,
    ORDER_STATUSES.REFUNDED,
  ],
  [ORDER_STATUSES.REFUNDED]: [],
  [ORDER_STATUSES.CANCELLED]: [],
  [ORDER_STATUSES.FAILED]: [
    ORDER_STATUSES.PENDING_PAYMENT,
    ORDER_STATUSES.WAITING_STAFF,
  ],
};

const LEGACY_STATUS_MAP = {
  pending: ORDER_STATUSES.PENDING_PAYMENT,
  processing: ORDER_STATUSES.PROCESSING,
  paid: ORDER_STATUSES.PAID,
  completed: ORDER_STATUSES.COMPLETED,
  cancelled: ORDER_STATUSES.CANCELLED,
  failed: ORDER_STATUSES.FAILED,
  refunded: ORDER_STATUSES.REFUNDED,
};

export function normalizeStatus(status) {
  if (!status) return ORDER_STATUSES.PENDING_PAYMENT;
  const upper = String(status).trim().toUpperCase();
  if (ORDER_STATUSES[upper]) return ORDER_STATUSES[upper];
  const lower = String(status).trim().toLowerCase();
  if (LEGACY_STATUS_MAP[lower]) return LEGACY_STATUS_MAP[lower];
  return upper;
}

export function canTransition(oldStatusRaw, newStatusRaw) {
  const oldStatus = normalizeStatus(oldStatusRaw);
  const newStatus = normalizeStatus(newStatusRaw);
  if (oldStatus === newStatus) return true; // Idempotent same-state transition
  const allowed = VALID_TRANSITIONS[oldStatus];
  if (!allowed) return false;
  return allowed.includes(newStatus);
}

export function ensureStatusHistoryTable(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS order_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_code TEXT NOT NULL,
      old_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      actor TEXT NOT NULL DEFAULT 'system',
      reason TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_order_status_history_code ON order_status_history(order_code)
  `).run();
}

export function recordStatusHistory(db, { orderCode, oldStatus, previousStatus, newStatus, actor = 'system', changedBy, reason = '', metadata = null }) {
  ensureStatusHistoryTable(db);
  const normOld = normalizeStatus(oldStatus || previousStatus);
  const normNew = normalizeStatus(newStatus);
  const actorName = String(actor || changedBy || 'system');
  const metaStr = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;

  db.prepare(`
    INSERT INTO order_status_history (order_code, old_status, new_status, actor, reason, metadata)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(String(orderCode).toUpperCase(), normOld, normNew, actorName, String(reason), metaStr);
}

export const recordStatusChange = recordStatusHistory;

export function transitionOrder(db, orderCode, newStatusRaw, actor = 'system', reason = '', metadata = null) {
  const codeUpper = String(orderCode).toUpperCase();
  const order = db.prepare('SELECT order_code, status FROM orders WHERE UPPER(order_code) = ?').get(codeUpper);
  if (!order) {
    throw new Error(`Order not found: ${orderCode}`);
  }

  const normOld = normalizeStatus(order.status);
  const normNew = normalizeStatus(newStatusRaw);

  if (!canTransition(normOld, normNew)) {
    const errorMsg = `Invalid order transition for ${orderCode} from ${normOld} to ${normNew}`;
    throw new Error(errorMsg);
  }

  // If status actually changes, update order & log history
  if (normOld !== normNew) {
    db.prepare('UPDATE orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE UPPER(order_code) = ?')
      .run(normNew, codeUpper);

    recordStatusHistory(db, {
      orderCode: codeUpper,
      oldStatus: normOld,
      newStatus: normNew,
      actor,
      reason,
      metadata,
    });
  }

  return {
    order_code: codeUpper,
    old_status: normOld,
    new_status: normNew,
    changed: normOld !== normNew,
  };
}

export function getOrderTimeline(db, orderCode) {
  ensureStatusHistoryTable(db);
  const codeUpper = String(orderCode).toUpperCase();
  const rows = db.prepare(`
    SELECT old_status, new_status, actor, reason, metadata, created_at
    FROM order_status_history
    WHERE UPPER(order_code) = ?
    ORDER BY id ASC
  `).all(codeUpper);

  return rows;
}

export function transitionOrderStatus(orderCode, status, options = {}) {
  const dbInst = options.dbInstance || options.db;
  if (!dbInst) {
    return { success: false, error: 'Database instance required' };
  }
  try {
    const actor = options.changedBy || options.actor || 'ADMIN';
    const reason = options.reason || 'Manual status update';
    const trans = transitionOrder(dbInst, orderCode, status, actor, reason);
    const order = dbInst.prepare('SELECT * FROM orders WHERE UPPER(order_code) = ?').get(String(orderCode).toUpperCase());
    return { success: true, order, changed: trans.changed };
  } catch (err) {
    return { success: false, error: err.message || 'Transition failed' };
  }
}

import { createHash, randomUUID } from 'node:crypto';
import { encrypt, decrypt, isEncrypted } from '../utils/crypto.js';
import { recordPaidOrderRefund, PaidOrderRefundError } from './paidOrderRefundService.js';
import { ensureStatusHistoryTable } from './orderStateMachine.js';

export class GeminiRefundError extends PaidOrderRefundError {}
const WARRANTY = new Set(['WARRANTY', 'WARRANTY_OPEN']);
const fail = message => { throw new GeminiRefundError(message); };
const instant = value => {
  if (!value) return NaN;
  return Date.parse(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
};
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function ensureRefundCases(db) {
  ensureStatusHistoryTable(db);
  db.exec(`CREATE TABLE IF NOT EXISTS order_refund_cases (
    id TEXT PRIMARY KEY, order_code TEXT NOT NULL UNIQUE, guild_id TEXT NOT NULL,
    customer_id TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'AWAITING_DETAILS',
    quote_json TEXT NOT NULL, pending_status_at TEXT NOT NULL,
    bank_encrypted TEXT, accepted_at TEXT, notice_state TEXT NOT NULL DEFAULT 'UNSENT',
    notice_message_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`);
}

/** Fixed, auditable quote. Warranty downtime is never billed as service. */
export function quoteGeminiRefund(order, history, receipts, walletEntries = []) {
  const paid = Number(order.amount_paid);
  if (!WARRANTY.has(order.status) || !/gemini/i.test(order.product_name || '')) fail('Đơn không phải Gemini đang bảo hành.');
  if (order.fulfillment_mode === 'SUPPLIER' || order.payment_status !== 'PAID'
    || !Number.isSafeInteger(paid) || paid <= 0 || paid !== order.total_amount) fail('Cần đối soát lại tiền đã nhận.');
  // A partial refund or a previously recorded refund needs individual reconciliation.
  if (history.some(h => h.new_status === 'REFUNDED') || walletEntries.some(w => w.amount !== 0 && /REFUND/i.test(w.type))) {
    fail('Đơn có lịch sử hoàn tiền, cần đối soát riêng để tránh hoàn hai lần.');
  }
  const receiptTotal = receipts.reduce((sum, r) => sum + Number(r.amount), 0);
  if (receiptTotal !== paid || receipts.some(r => !Number.isSafeInteger(Number(r.amount)) || r.amount <= 0)) {
    fail('Giao dịch gốc chưa khớp số tiền đơn.');
  }
  const start = instant(order.completed_at);
  const end = instant(order.expiry_at);
  const cutoff = instant(order.status_changed_at);
  const latest = history.at(-1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(cutoff)
    || end <= start || cutoff < start || cutoff > end
    || !WARRANTY.has(latest?.new_status) || Math.abs(instant(latest.created_at) - cutoff) > 1500) {
    fail('Thiếu hoặc không khớp mốc giao hàng, hết hạn và mở bảo hành.');
  }
  let opened = null;
  let downtimeMs = 0;
  for (const event of history) {
    const at = instant(event.created_at);
    if (!Number.isFinite(at)) fail('Lịch sử bảo hành có mốc thời gian không hợp lệ.');
    if (at > cutoff) break;
    if (WARRANTY.has(event.new_status)) opened ??= Math.max(start, at);
    else if (opened !== null) {
      downtimeMs += Math.max(0, Math.min(cutoff, at) - opened);
      opened = null;
    }
  }
  if (opened !== null) downtimeMs += Math.max(0, cutoff - opened);
  const usedMs = Math.max(0, cutoff - start - downtimeMs);
  const totalMs = end - start;
  // Integer VND, round deductions down; never charge more than actual receipt.
  const usageDeduction = Number(BigInt(paid) * BigInt(usedMs) / BigInt(totalMs));
  const fee = Number(BigInt(paid) * 1000n / 10000n);
  const refund = Math.max(0, paid - usageDeduction - fee);
  if (!refund) fail('Không còn số dư hoàn, cần quản lý xem riêng.');
  return { version: 1, paid, start: new Date(start).toISOString(), end: new Date(end).toISOString(),
    cutoff: new Date(cutoff).toISOString(), totalMs, usedMs, downtimeMs,
    usageDeduction, feeBps: 1000, fee, refund };
}

export function previewGeminiRefunds(db, guildId) {
  ensureRefundCases(db);
  const candidates = db.prepare(`SELECT * FROM orders WHERE guild_id = ?
    AND status IN ('WARRANTY', 'WARRANTY_OPEN') AND lower(product_name) LIKE '%gemini%'
    ORDER BY order_code`).all(guildId);
  const ready = [], blocked = [];
  for (const order of candidates) {
    try {
      if (db.prepare('SELECT 1 FROM order_refund_cases WHERE order_code=?').get(order.order_code)) fail('Đã có hồ sơ hoàn tiền, cần xem hồ sơ cũ.');
      const history = db.prepare('SELECT * FROM order_status_history WHERE order_code=? ORDER BY id').all(order.order_code);
      const receipts = db.prepare('SELECT provider, transaction_id, amount FROM payment_events WHERE order_code=? ORDER BY id').all(order.order_code);
      const wallet = db.prepare('SELECT type,amount FROM wallet_transactions WHERE related_code=? ORDER BY id').all(order.order_code);
      const quote = quoteGeminiRefund(order, history, receipts, wallet);
      ready.push({ orderCode: order.order_code, quote,
        fingerprint: hash({ order, history, receipts, wallet }) });
    } catch (error) {
      if (!(error instanceof GeminiRefundError)) throw error;
      blocked.push({ orderCode: order.order_code, reason: error.message });
    }
  }
  return { ready, blocked, fingerprint: hash({ ready, blocked }).slice(0, 20) };
}

export function applyGeminiRefunds(db, { guildId, actorId, fingerprint }) {
  ensureRefundCases(db);
  return db.transaction(() => {
    const preview = previewGeminiRefunds(db, guildId);
    if (!preview.ready.length || preview.fingerprint !== fingerprint) fail('Dữ liệu đã đổi hoặc không còn đơn phù hợp. Hãy xem lại bảng đối soát.');
    const created = [];
    for (const row of preview.ready) {
      const { updated } = recordPaidOrderRefund(db, { guildId, actorId, orderCode: row.orderCode,
        action: 'REFUND_PENDING', reason: 'Gemini: trừ thời gian dùng thực tế và phí xử lý 10% giá gốc; chờ khách xác nhận' });
      const now = new Date().toISOString();
      const id = randomUUID();
      db.prepare(`INSERT INTO order_refund_cases
        (id,order_code,guild_id,customer_id,quote_json,pending_status_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?)`).run(id, row.orderCode, guildId, updated.customer_id,
        JSON.stringify(row.quote), updated.status_changed_at, now, now);
      created.push(getRefundCase(db, id));
    }
    return created;
  }).immediate();
}

export function getRefundCase(db, id) {
  ensureRefundCases(db);
  const row = db.prepare('SELECT * FROM order_refund_cases WHERE id=? OR order_code=?').get(id, id);
  if (!row) return null;
  const order = db.prepare('SELECT status,status_changed_at FROM orders WHERE order_code=? AND guild_id=?').get(row.order_code, row.guild_id);
  return { ...row, quote: JSON.parse(row.quote_json), active: order?.status === 'REFUND_PENDING'
    && order.status_changed_at === row.pending_status_at, orderStatus: order?.status };
}

export function requireRefundOwner(db, id, customerId) {
  const row = getRefundCase(db, id);
  if (!row || row.customer_id !== customerId) fail('Không tìm thấy hồ sơ hoàn tiền của bạn.');
  if (!row.active) fail('Hồ sơ này đã đóng hoặc đơn đã đổi trạng thái. Vui lòng liên hệ shop.');
  return row;
}

export function submitRefundBank(db, { id, customerId, bank, account, name, accepted }) {
  return db.transaction(() => {
    const row = requireRefundOwner(db, id, customerId);
    if (row.stage !== 'AWAITING_DETAILS') fail('Đã nhận thông tin. Muốn sửa, hãy liên hệ shop trước khi chuyển tiền.');
    if (accepted?.trim().toUpperCase() !== 'ĐỒNG Ý') fail('Cần nhập ĐỒNG Ý để xác nhận bảng tính. Nếu chưa đồng ý, hãy trao đổi với shop.');
    if (!bank || !/^\d{6}$/.test(bank.bin) || !/^[A-Za-z0-9]{1,19}$/.test(account)
      || !/^[\p{L} .'-]{3,80}$/u.test(name)) fail('Thông tin ngân hàng chưa hợp lệ. Không nhập số thẻ, mật khẩu hoặc OTP.');
    const encrypted = encrypt(JSON.stringify({ bankBin: bank.bin, bankName: bank.shortName, account, name }));
    if (!isEncrypted(encrypted)) fail('Chưa thể lưu thông tin an toàn.');
    const now = new Date().toISOString();
    db.prepare(`UPDATE order_refund_cases SET bank_encrypted=?, stage='READY_TO_PAY', accepted_at=?, updated_at=? WHERE id=?`)
      .run(encrypted, now, now, row.id);
    return getRefundCase(db, row.id);
  }).immediate();
}

export function readRefundBank(row) {
  if (!row?.active || row.stage !== 'READY_TO_PAY' || !isEncrypted(row.bank_encrypted)) fail('Khách chưa xác nhận hoặc hồ sơ đã đóng.');
  const raw = decrypt(row.bank_encrypted);
  if (isEncrypted(raw)) fail('Không giải mã được thông tin nhận tiền.');
  return JSON.parse(raw);
}

/** Claim before sending, so a network timeout is never blindly retried. */
export function claimRefundNotice(db, id) {
  return db.prepare(`UPDATE order_refund_cases SET notice_state='SENDING', updated_at=?
    WHERE id=? AND notice_state='UNSENT'`).run(new Date().toISOString(), id).changes === 1;
}
export function finishRefundNotice(db, id, messageId, definiteFailure = false) {
  db.prepare(`UPDATE order_refund_cases SET notice_state=?,notice_message_id=?,updated_at=? WHERE id=?`)
    .run(messageId ? 'SENT' : definiteFailure ? 'BLOCKED' : 'UNCERTAIN', messageId || null, new Date().toISOString(), id);
}

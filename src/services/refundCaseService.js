// Generic refund cases (any product): manager opens a quote, the customer reviews it,
// enters their bank account, previews the exact transfer (bank, account, name, amount
// and the QR the shop will scan) and only then confirms. Builds on order_refund_cases
// so the Gemini desk, QR payout and REFUNDED ledger checks keep working unchanged.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { encrypt, decrypt, isEncrypted } from '../utils/crypto.js';
import { ensureRefundCases, getRefundCase, GeminiRefundError, refundReview, requireRefundOwner, submitRefundBank } from './geminiRefundService.js';
import { recordPaidOrderRefund } from './paidOrderRefundService.js';
import { previewOrderRefund, REFUND_REASONS } from './refundLedgerService.js';
import { buildVerifiedRefundVietQR } from '../utils/refundVietQR.js';

export const REFUND_DRAFT_TTL_MS = 30 * 60_000;
const fail = (message) => { throw new GeminiRefundError(message); };

const banks = JSON.parse(readFileSync(new URL('../config/refundBanks.json', import.meta.url), 'utf8'));
const fold = (value) => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd')
  .toLowerCase().replace(/^(ngan hang|nh)\s+/, '').replace(/[^a-z0-9]/g, '');

/** Resolve a bank from BIN, code or name; only a single unambiguous match is accepted. */
export function resolveRefundBank(value) {
  const needle = fold(value);
  if (needle.length < 2) return null;
  const exact = banks.filter((b) => [b.bin, b.code, b.shortName].some((v) => fold(v) === needle)
    || fold(b.shortName).replace(/bank$/, '') === needle.replace(/bank$/, ''));
  if (exact.length === 1) return exact[0];
  if (needle.length < 4) return null;
  const partial = banks.filter((b) => fold(b.shortName).startsWith(needle) || fold(b.name).includes(needle));
  return partial.length === 1 ? partial[0] : null;
}

/** Account holder names are compared in upper case without diacritics, like banking apps show them. */
export function normalizeHolderName(value) {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đ]/g, 'd').replace(/[Đ]/g, 'D')
    .toUpperCase().replace(/\s+/g, ' ').trim();
}

export function ensureRefundDrafts(db) {
  ensureRefundCases(db);
  const columns = new Set(db.prepare('PRAGMA table_info(order_refund_cases)').all().map((c) => c.name));
  for (const [name, type] of [['draft_bank_encrypted', 'TEXT'], ['draft_revision', 'INTEGER'], ['draft_at', 'TEXT'],
    ['kind', "TEXT NOT NULL DEFAULT 'GEMINI'"], ['opened_by', 'TEXT']]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE order_refund_cases ADD COLUMN ${name} ${type}`);
  }
}

/** Convert the standard ledger quote into the case quote shape shared with the Gemini desk. */
export function toCaseQuote(quote) {
  const ms = (days) => Math.round(days * 86_400_000);
  return {
    version: 2, kind: 'STANDARD', reasonCode: quote.reasonCode, paid: quote.paid,
    start: quote.start, end: quote.end, cutoff: quote.cutoff,
    usedMs: ms(quote.usedDays), totalMs: ms(quote.totalDays), downtimeMs: 0,
    usageDeduction: quote.usageDeduction, feeBps: Math.round(quote.feePercent * 100), fee: quote.feeAmount,
    otherDeduction: quote.otherDeduction, refund: quote.refund,
  };
}

/**
 * Open (or re-quote, while the customer has not accepted yet) a refund case for any
 * regular paid order. Moves the order to REFUND_PENDING when needed.
 */
export function openStandardRefundCase(db, { orderCode, guildId, actorId, reasonCode, feePercent, otherDeduction = 0, note = null }) {
  ensureRefundDrafts(db);
  return db.transaction(() => {
    let order = db.prepare('SELECT * FROM orders WHERE order_code = ? AND guild_id = ?').get(orderCode, guildId);
    if (!order) fail('Không tìm thấy mã đơn trong shop hiện tại.');
    if (order.status !== 'REFUND_PENDING') {
      const reason = `Mở hồ sơ hoàn tiền · ${REFUND_REASONS[reasonCode]?.label ?? 'Lý do khác'}${note ? ` · ${note}` : ''}`;
      order = recordPaidOrderRefund(db, { orderCode, guildId, actorId, action: 'REFUND_PENDING', reason }).updated;
    }
    if (order.status !== 'REFUND_PENDING') fail('Đơn này không thể mở hồ sơ hoàn (đã hoàn hoặc trạng thái không hỗ trợ).');
    const quote = toCaseQuote(previewOrderRefund(db, order, { reasonCode, feePercent, otherDeduction }));
    if (quote.refund < 1) fail('Theo bảng tính không còn số tiền hoàn. Kiểm tra lại phí hoặc thời gian đã dùng.');
    const existing = getRefundCase(db, orderCode);
    const now = new Date().toISOString();
    if (existing?.active && existing.accepted_at) {
      fail('Khách đã xác nhận bảng tính hiện tại. Liên hệ khách trước khi đổi số tiền.');
    }
    let id = existing?.id;
    if (existing) {
      const revision = db.prepare('SELECT COALESCE(MAX(revision),0)+1 AS next FROM order_refund_quote_history WHERE case_id=?').get(existing.id).next;
      db.prepare(`UPDATE order_refund_quote_history SET state='SUPERSEDED' WHERE case_id=? AND state IN ('OFFERED','PROPOSED')`).run(existing.id);
      db.prepare(`INSERT INTO order_refund_quote_history(case_id,revision,quote_json,state,actor_id,created_at) VALUES (?,?,?,'OFFERED',?,?)`)
        .run(existing.id, revision, JSON.stringify(quote), actorId, now);
      db.prepare(`UPDATE order_refund_cases SET quote_json=?, quote_revision=?, pending_quote_json=NULL, pending_quote_revision=NULL,
          stage='AWAITING_DETAILS', bank_encrypted=NULL, accepted_at=NULL, accepted_quote_revision=NULL,
          draft_bank_encrypted=NULL, draft_revision=NULL, draft_at=NULL, pending_status_at=?, customer_id=?,
          kind='STANDARD', opened_by=?, updated_at=? WHERE id=?`)
        .run(JSON.stringify(quote), revision, order.status_changed_at, order.customer_id, actorId, now, existing.id);
    } else {
      id = randomUUID();
      db.prepare(`INSERT INTO order_refund_cases (id,order_code,guild_id,customer_id,quote_json,pending_status_at,created_at,updated_at,kind,opened_by)
        VALUES (?,?,?,?,?,?,?,?,'STANDARD',?)`).run(id, orderCode, guildId, order.customer_id, JSON.stringify(quote),
        order.status_changed_at, now, now, actorId);
      db.prepare(`INSERT INTO order_refund_quote_history(case_id,revision,quote_json,state,actor_id,created_at) VALUES (?,1,?,'OFFERED',?,?)`)
        .run(id, JSON.stringify(quote), actorId, now);
    }
    return getRefundCase(db, id);
  }).immediate();
}

/** Validate what the customer typed and keep it as an encrypted draft until they confirm the preview. */
export function saveRefundDraft(db, { id, customerId, revision, bankInput, account, name }) {
  ensureRefundDrafts(db);
  return db.transaction(() => {
    const row = requireRefundOwner(db, id, customerId);
    const review = refundReview(row);
    if (revision !== review.revision) fail('Bảng tính vừa được cập nhật. Vui lòng mở lại hồ sơ để đọc số tiền mới.');
    if (row.stage !== 'AWAITING_DETAILS' && !row.pendingQuote) fail('Shop đã nhận thông tin của bạn. Muốn sửa, hãy nhắn shop trong ticket trước khi shop chuyển tiền.');
    const bank = resolveRefundBank(bankInput);
    if (!bank) fail('Chưa nhận ra ngân hàng. Nhập tên viết tắt như VCB, MB, ACB, BIDV, TCB, VPB, TPB hoặc mã BIN 6 số.');
    const cleanAccount = String(account || '').replace(/[\s.-]/g, '');
    if (!/^[A-Za-z0-9]{6,19}$/.test(cleanAccount)) fail('Số tài khoản cần 6–19 ký tự chữ/số, không dấu cách. Không nhập số thẻ.');
    if (/^\d{16}$/.test(cleanAccount) && /^(4|5|9704)/.test(cleanAccount)) fail('Dãy số này giống số thẻ. Vui lòng nhập số tài khoản ngân hàng.');
    const holder = normalizeHolderName(name);
    if (!/^[A-Z .'-]{3,80}$/.test(holder) || !/[A-Z]{2}/.test(holder)) fail('Tên chủ tài khoản chỉ gồm chữ cái, đúng như trong ứng dụng ngân hàng.');
    // Build once now so an invalid combination is rejected before the customer confirms.
    buildVerifiedRefundVietQR({ bankBin: bank.bin, account: cleanAccount, amount: review.quote.refund, orderCode: row.order_code });
    const draft = { bankBin: bank.bin, bankCode: bank.code, bankName: bank.shortName, bankFullName: bank.name, account: cleanAccount, name: holder };
    const encrypted = encrypt(JSON.stringify(draft));
    if (!isEncrypted(encrypted)) fail('Chưa thể lưu thông tin an toàn.');
    const now = new Date().toISOString();
    db.prepare('UPDATE order_refund_cases SET draft_bank_encrypted=?, draft_revision=?, draft_at=?, updated_at=? WHERE id=?')
      .run(encrypted, revision, now, now, row.id);
    return { row: getRefundCase(db, row.id), draft, quote: review.quote, revision };
  }).immediate();
}

export function readRefundDraft(row) {
  if (!row?.draft_bank_encrypted || !isEncrypted(row.draft_bank_encrypted)) fail('Phiên xem trước đã hết. Vui lòng nhập lại thông tin.');
  if (Date.now() - Date.parse(row.draft_at) > REFUND_DRAFT_TTL_MS) fail('Phiên xem trước đã quá 30 phút. Vui lòng nhập lại thông tin.');
  return JSON.parse(decrypt(row.draft_bank_encrypted));
}

/** The customer confirmed the preview: accept the quote and store the bank details. */
export function confirmRefundDraft(db, { id, customerId, revision }) {
  ensureRefundDrafts(db);
  return db.transaction(() => {
    const row = requireRefundOwner(db, id, customerId);
    if (row.draft_revision !== revision) fail('Bảng tính đã đổi sau khi bạn xem trước. Vui lòng nhập lại để xem số tiền mới.');
    const draft = readRefundDraft(row);
    const saved = submitRefundBank(db, { id, customerId, revision, accepted: 'ĐỒNG Ý',
      bank: { bin: draft.bankBin, shortName: draft.bankName }, account: draft.account, name: draft.name });
    db.prepare('UPDATE order_refund_cases SET draft_bank_encrypted=NULL, draft_revision=NULL, draft_at=NULL WHERE id=?').run(row.id);
    return getRefundCase(db, saved.id);
  }).immediate();
}

export function discardRefundDraft(db, { id, customerId }) {
  ensureRefundDrafts(db);
  const row = requireRefundOwner(db, id, customerId);
  db.prepare('UPDATE order_refund_cases SET draft_bank_encrypted=NULL, draft_revision=NULL, draft_at=NULL WHERE id=?').run(row.id);
}

/** Open cases for the website: no bank details, only what staff need to follow up. */
export function listOpenRefundCases(db, { guildId } = {}) {
  ensureRefundDrafts(db);
  const rows = db.prepare(`SELECT c.id, c.order_code, c.guild_id, c.customer_id, c.stage, c.kind, c.quote_json, c.quote_revision,
      c.accepted_at, c.created_at, c.updated_at, c.pending_status_at, o.product_name, o.status AS order_status, o.status_changed_at
    FROM order_refund_cases c JOIN orders o ON o.order_code = c.order_code AND o.guild_id = c.guild_id
    WHERE o.status = 'REFUND_PENDING' AND o.status_changed_at = c.pending_status_at ${guildId ? 'AND c.guild_id = ?' : ''}
    ORDER BY CASE c.stage WHEN 'READY_TO_PAY' THEN 0 ELSE 1 END, c.updated_at DESC`).all(...(guildId ? [guildId] : []));
  return rows.map(({ quote_json: quoteJson, ...row }) => ({ ...row, quote: JSON.parse(quoteJson) }));
}

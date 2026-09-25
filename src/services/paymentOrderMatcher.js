import { db, nowIso } from '../database/db.js';

function upper(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function normalizeOrderCode(value) {
  return upper(value)
    .replace(/\s+/g, '')
    .replace(/-/g, '_')
    .replace(/^(CN|CR|VB)([0-9]{4,8})$/, '$1_$2');
}

export function extractOrderCodesFromText(text) {
  const input = upper(text);
  const matches = input.match(/(?:CN|CR|VB)[_ -]?[0-9]{4,8}/g) ?? [];
  return [...new Set(matches.map(normalizeOrderCode))];
}

function safeGet(sql, ...params) {
  try {
    return db.prepare(sql).get(...params) ?? null;
  } catch {
    return null;
  }
}

function safeAll(sql, ...params) {
  try {
    return db.prepare(sql).all(...params) ?? [];
  } catch {
    return [];
  }
}

function hasPaymentCodeColumn() {
  try {
    const cols = db.prepare('PRAGMA table_info(orders)').all();
    return cols.some((c) => c.name === 'payment_code');
  } catch {
    return false;
  }
}

function exactCandidates(code) {
  const results = [];

  if (hasPaymentCodeColumn()) {
    const byPayment = safeGet('SELECT * FROM orders WHERE payment_code = ? LIMIT 1', code);
    if (byPayment) results.push(byPayment);
  }

  const byOrder = safeGet('SELECT * FROM orders WHERE order_code = ? LIMIT 1', code);
  if (byOrder) results.push(byOrder);

  return results;
}

function legacySwapCandidates(code) {
  const list = [];
  if (code.startsWith('CN_')) list.push(code.replace(/^CN_/, 'VB_'));
  if (code.startsWith('CR_')) list.push(code.replace(/^CR_/, 'VB_'));
  if (code.startsWith('VB_')) { list.push(code.replace(/^VB_/, 'CN_')); list.push(code.replace(/^VB_/, 'CR_')); }
  return list;
}

function looseCandidates(code) {
  const digits = code.match(/[0-9]{4,8}$/)?.[0];
  if (!digits) return [];
  const rows = hasPaymentCodeColumn()
    ? safeAll(`
      SELECT *
      FROM orders
      WHERE order_code LIKE ? OR payment_code LIKE ?
      ORDER BY id DESC
      LIMIT 10
    `, `%${digits}`, `%${digits}`)
    : safeAll(`
      SELECT *
      FROM orders
      WHERE order_code LIKE ?
      ORDER BY id DESC
      LIMIT 10
    `, `%${digits}`);

  return rows.filter((row) => [row.order_code, row.payment_code].some((value) => normalizeOrderCode(value).endsWith(digits)));
}

export function findOrderByIncomingPaymentCode({ orderCode, description, reference }) {
  const candidates = [
    normalizeOrderCode(orderCode),
    ...extractOrderCodesFromText(description),
    ...extractOrderCodesFromText(reference),
  ].filter(Boolean);

  const tried = new Set();

  for (const code of candidates) {
    if (tried.has(code)) continue;
    tried.add(code);

    for (const row of exactCandidates(code)) {
      if (row) return { order: row, matchedBy: `exact:${code}`, matchedCode: code };
    }

    for (const legacyCode of legacySwapCandidates(code)) {
      if (tried.has(legacyCode)) continue;
      tried.add(legacyCode);
      for (const row of exactCandidates(legacyCode)) {
        if (row) return { order: row, matchedBy: `legacy-swap:${legacyCode}`, matchedCode: legacyCode };
      }
    }

    const loose = looseCandidates(code);
    if (loose.length === 1) {
      return { order: loose[0], matchedBy: `loose-digits:${code}`, matchedCode: normalizeOrderCode(loose[0].payment_code || loose[0].order_code) };
    }
  }

  return { order: null, matchedBy: null, matchedCode: null };

}

export function syncPaymentCodeIfPossible(order, incomingCode) {
  const code = normalizeOrderCode(incomingCode);
  if (!order || !code || !hasPaymentCodeColumn()) return;

  try {
    db.prepare(`
      UPDATE orders
      SET payment_code = COALESCE(NULLIF(payment_code, ''), ?),
          updated_at = ?
      WHERE id = ?
    `).run(code, nowIso(), order.id);
  } catch {}
}

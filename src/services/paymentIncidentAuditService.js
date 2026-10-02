import { db } from '../database/db.js';
import { getPayOSPaymentInfo, getPayOSReceivedAmount } from './paymentService.js';

function receiptEvidence(event) {
  let payload;
  try { payload = JSON.parse(event.raw_payload || '{}'); } catch { payload = {}; }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) payload = {};
  const snapshot = 'amountPaid' in payload || Array.isArray(payload.transactions);
  const received = snapshot ? getPayOSReceivedAmount(payload) : payload.amount ?? event.amount;
  const number = Number(received);
  return {
    provider: event.provider,
    recordedAmount: event.amount,
    receivedAmount: received !== null && Number.isSafeInteger(number) && number > 0 ? number : null,
    source: snapshot ? 'PAYOS_SNAPSHOT' : 'TRANSACTION',
    createdAt: event.created_at,
  };
}

function priceEditEvidence(detail) {
  const match = String(detail || '').match(/before=(\{.*?\}) \| after=(\{.*?\})/);
  if (!match) return null;
  try {
    const before = JSON.parse(match[1]);
    const after = JSON.parse(match[2]);
    return { beforeTotal: before.total_amount, afterTotal: after.total_amount,
      beforeQuantity: before.quantity, afterQuantity: after.quantity };
  } catch { return null; }
}

async function walletReceiptEvidence(order) {
  if (order.payment_provider !== 'WALLET') return null;
  const parameters = [order.guild_id, order.customer_id];
  const debits = db.prepare(`SELECT id, amount, created_at FROM wallet_transactions
    WHERE guild_id = ? AND customer_id = ? AND related_code = ? AND type IN ('PAYMENT', 'PAY_ORDER')
    ORDER BY id`).all(...parameters, order.order_code);
  const firstDebit = debits[0];
  const ledgerTotal = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS amount FROM wallet_transactions
    WHERE guild_id = ? AND customer_id = ?`).get(...parameters).amount;
  const storedBalance = db.prepare('SELECT wallet_balance FROM customer_profiles WHERE guild_id = ? AND customer_id = ?')
    .get(...parameters)?.wallet_balance ?? 0;
  if (!firstDebit) return { debitFound: false, storedBalance, ledgerMatchesStoredBalance: ledgerTotal === storedBalance };
  const before = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS amount FROM wallet_transactions
    WHERE guild_id = ? AND customer_id = ? AND id < ?`).get(...parameters, firstDebit.id).amount;
  const recent = db.prepare(`SELECT type, amount, created_at, related_code FROM wallet_transactions
    WHERE guild_id = ? AND customer_id = ? AND id <= ? ORDER BY id DESC LIMIT 12`)
    .all(...parameters, firstDebit.id);
  const topups = recent.filter((entry) => entry.type === 'TOPUP' && entry.amount > 0).slice(0, 3);
  const topupEvidence = await Promise.all(topups.map(async (entry) => {
    const topup = db.prepare(`SELECT * FROM wallet_topup_orders
      WHERE guild_id = ? AND customer_id = ? AND topup_code = ?`).get(...parameters, entry.related_code);
    const evidence = { creditedAmount: entry.amount, creditedAt: entry.created_at,
      declaredAmount: topup?.amount ?? null, status: topup?.status ?? null, providerReceipt: null };
    if (topup?.payment_link_id || topup?.payos_order_code) {
      try {
        const info = await getPayOSPaymentInfo(topup.payment_link_id || topup.payos_order_code);
        evidence.providerReceipt = {
          identityMatches: Number(info.orderCode) === Number(topup.payos_order_code)
            && (!topup.payment_link_id || String(info.id) === String(topup.payment_link_id)),
          state: info.status, invoiceAmount: info.amount, receivedAmount: getPayOSReceivedAmount(info),
        };
      } catch { evidence.providerReceipt = { error: 'PROVIDER_LOOKUP_UNAVAILABLE' }; }
    }
    return evidence;
  }));
  return { debitFound: true, debitCount: debits.length,
    deductedAmount: -debits.reduce((sum, debit) => sum + debit.amount, 0),
    ledgerBalanceBefore: before, ledgerBalanceAfter: before + firstDebit.amount,
    storedBalance, ledgerMatchesStoredBalance: ledgerTotal === storedBalance,
    recentActivity: recent.map((entry) => ({ type: entry.type, amount: entry.amount, createdAt: entry.created_at,
      selectedOrder: entry.related_code === order.order_code })), topups: topupEvidence };
}

// Service-to-service, read only, strict projection: no customer IDs, account
// credentials, bank details, transaction IDs, raw payloads or staff identities.
export async function auditOrderPayment(orderCode) {
  const order = db.prepare('SELECT * FROM orders WHERE order_code = ?').get(orderCode);
  if (!order) return null;
  const events = db.prepare('SELECT * FROM payment_events WHERE order_code = ? ORDER BY id LIMIT 100')
    .all(orderCode).map(receiptEvidence);
  const actions = db.prepare(`SELECT action, actor_id, created_at, detail FROM staff_logs
    WHERE related_order_code = ? AND (action LIKE 'PAYMENT_%' OR action LIKE 'ORDER_%' OR action = 'PAYOS_WEBHOOK_RECEIVED')
    ORDER BY id LIMIT 100`).all(orderCode).map((row) => ({
      action: row.action, actor: row.actor_id ? 'STAFF' : 'SYSTEM', createdAt: row.created_at,
      priceEdit: row.action === 'ORDER_EDITED' ? priceEditEvidence(row.detail) : null,
    }));
  const catalog = db.prepare(`SELECT price, base_price, is_active FROM product_catalog
    WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) ORDER BY is_active DESC, id DESC LIMIT 1`).get(order.product_name);
  let payos = null;
  if (order.payment_provider === 'PAYOS' && (order.payment_link_id || order.payos_order_code)) {
    try {
      const info = await getPayOSPaymentInfo(order.payment_link_id || order.payos_order_code);
      const matches = Number(info.orderCode) === Number(order.payos_order_code)
        && (!order.payment_link_id || String(info.id) === String(order.payment_link_id));
      payos = { identityMatches: matches, state: info.status, invoiceAmount: info.amount,
        receivedAmount: getPayOSReceivedAmount(info), remainingAmount: info.amountRemaining };
    } catch { payos = { error: 'PROVIDER_LOOKUP_UNAVAILABLE' }; }
  }
  const hasFullReceipt = events.some((event) => Number(event.receivedAmount) >= order.total_amount);
  const wallet = await walletReceiptEvidence(order);
  const similar = db.prepare(`SELECT o.total_amount, e.* FROM orders o JOIN payment_events e ON e.order_code = o.order_code
    WHERE o.payment_status = 'PAID' AND o.status NOT IN ('CANCELLED', 'REFUNDED')
    AND e.provider = 'PAYOS' ORDER BY e.id DESC LIMIT 1000`).all();
  const suspectOrders = new Set(similar.filter((row) => {
    const evidence = receiptEvidence(row);
    return evidence.receivedAmount !== null && evidence.receivedAmount < row.total_amount;
  }).map((row) => row.order_code));
  return {
    order: { productName: order.product_name, quantity: order.quantity, totalAmount: order.total_amount,
      recordedPaidAmount: order.amount_paid, paymentStatus: order.payment_status, status: order.status,
      provider: order.payment_provider, createdAt: order.created_at, paidAt: order.paid_at,
      delivered: Boolean(order.delivered_at), completed: Boolean(order.completed_at) },
    currentCatalog: catalog ? { price: catalog.price, basePrice: catalog.base_price, active: Boolean(catalog.is_active) } : null,
    events, actions, payos, wallet,
    findings: {
      confirmedWithoutFullRecordedReceipt: order.payment_status === 'PAID' && events.length > 0 && !hasFullReceipt,
      providerShowsShortfall: payos?.identityMatches === true && payos.receivedAmount != null
        && Number(payos.receivedAmount) < order.total_amount,
      currentCatalogPriceDiffers: Boolean(catalog && catalog.price * order.quantity !== order.total_amount),
      recentPayosOrdersWithShortReceiptEvidence: suspectOrders.size,
      walletDebitMatchesTotal: wallet ? wallet.debitFound && wallet.debitCount === 1 && wallet.deductedAmount === order.total_amount : null,
    },
  };
}

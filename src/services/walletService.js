import { db, nowIso } from '../database/db.js';
import { config, getPayOSCancelUrl, getPayOSReturnUrl } from '../config.js';
import crypto from 'node:crypto';

const PAYOS_API_BASE = 'https://api-merchant.payos.vn';

function createHmacHex(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function buildPayOSSignature({ amount, cancelUrl, description, orderCode, returnUrl }) {
  const data = `amount=${amount}&cancelUrl=${cancelUrl}&description=${description}&orderCode=${orderCode}&returnUrl=${returnUrl}`;
  return createHmacHex(config.payosChecksumKey, data);
}

async function callPayOSApi(method, path, body = undefined) {
  const response = await fetch(`${PAYOS_API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': config.payosClientId,
      'x-api-key': config.payosApiKey,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.code && payload.code !== '00') {
    throw new Error(payload?.desc || `PayOS API error HTTP ${response.status}`);
  }
  return payload?.data ?? payload;
}

export function getWalletBalance(guildId, customerId) {
  const stmt = db.prepare('SELECT wallet_balance FROM customer_profiles WHERE guild_id = ? AND customer_id = ?');
  const row = stmt.get(guildId, customerId);
  return row ? row.wallet_balance : 0;
}

export function getWalletTransactions(guildId, customerId, limit = 20) {
  const stmt = db.prepare('SELECT * FROM wallet_transactions WHERE guild_id = ? AND customer_id = ? ORDER BY created_at DESC LIMIT ?');
  return stmt.all(guildId, customerId, limit);
}

export function addWalletBalance(guildId, customerId, amount, type, description, relatedCode = null) {
  if (amount === 0) return getWalletBalance(guildId, customerId);
  
  const ensureProfile = db.prepare(`
    INSERT INTO customer_profiles (guild_id, customer_id, wallet_balance)
    VALUES (?, ?, 0)
    ON CONFLICT(guild_id, customer_id) DO NOTHING
  `);
  
  const updateBalance = db.prepare(`
    UPDATE customer_profiles 
    SET wallet_balance = wallet_balance + ? 
    WHERE guild_id = ? AND customer_id = ?
  `);
  
  const insertTx = db.prepare(`
    INSERT INTO wallet_transactions (guild_id, customer_id, amount, type, description, related_code, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    ensureProfile.run(guildId, customerId);
    updateBalance.run(amount, guildId, customerId);
    insertTx.run(guildId, customerId, amount, type, description, relatedCode, nowIso());
  });

  transaction();
  return getWalletBalance(guildId, customerId);
}

// Tạo mã PayOS để nạp tiền
export async function createTopupCheckout(guildId, customerId, amount) {
  const topupCode = `NAP${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000)}`;
  const payosOrderCode = Number(Date.now().toString().slice(-9)) + Math.floor(Math.random() * 1000); // Max 9007199254740991
  
  // Insert into DB first
  const stmt = db.prepare(`
    INSERT INTO wallet_topup_orders (topup_code, guild_id, customer_id, amount, payos_order_code, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(topupCode, guildId, customerId, amount, payosOrderCode, nowIso());

  const returnUrl = getPayOSReturnUrl();
  const cancelUrl = getPayOSCancelUrl();
  const description = `Nap ${topupCode}`;

  const payload = {
    orderCode: payosOrderCode,
    amount,
    description,
    items: [{ name: 'Nap tien vao vi Cenar', quantity: 1, price: amount }],
    cancelUrl,
    returnUrl,
    expiredAt: Math.floor(Date.now() / 1000) + (15 * 60), // 15 mins
    signature: buildPayOSSignature({ amount, cancelUrl, description, orderCode: payosOrderCode, returnUrl }),
  };

  try {
    const created = await callPayOSApi('POST', '/v2/payment-requests', payload);
    const checkoutUrl = created.checkoutUrl || `https://pay.payos.vn/web/${created.paymentLinkId}`;
    
    // Update DB with links
    const updateStmt = db.prepare(`
      UPDATE wallet_topup_orders 
      SET payment_link_id = ?, payment_checkout_url = ?, payment_qr_code = ?
      WHERE topup_code = ?
    `);
    updateStmt.run(created.paymentLinkId, checkoutUrl, created.qrCode, topupCode);

    return {
      topupCode,
      checkoutUrl,
      qrCode: created.qrCode,
    };
  } catch (error) {
    throw error;
  }
}

export function getTopupByPayOSCode(payosOrderCode) {
  const stmt = db.prepare('SELECT * FROM wallet_topup_orders WHERE payos_order_code = ?');
  return stmt.get(payosOrderCode);
}

export function finalizeTopup(topupCode) {
  const topup = db.prepare('SELECT * FROM wallet_topup_orders WHERE topup_code = ?').get(topupCode);
  if (!topup || topup.status === 'PAID') return null;

  const updateStmt = db.prepare('UPDATE wallet_topup_orders SET status = ?, paid_at = ? WHERE topup_code = ?');
  
  const transaction = db.transaction(() => {
    updateStmt.run('PAID', nowIso(), topupCode);
    addWalletBalance(
      topup.guild_id, 
      topup.customer_id, 
      topup.amount, 
      'TOPUP', 
      'Nạp tiền qua PayOS', 
      topup.topup_code
    );
  });
  
  transaction();
  return topup;
}

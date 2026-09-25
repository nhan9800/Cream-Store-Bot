import { createHash, randomUUID } from 'node:crypto';
import { db, nowIso } from '../database/db.js';
import { config } from '../config.js';
import { decrypt, encrypt, isEncrypted } from '../utils/crypto.js';
import { getOrderByCode, markOrderCompleted, saveDelivery } from './orderService.js';
import { buildDeliveryCredentialEmbeds, buildDeliveryLoginComponents } from '../utils/embeds.js';

const LEASE_MS = 5 * 60_000;
const MAX_AUTO_DELIVERY_QUANTITY = 50;

function stockName(name) {
  return String(name || '').replace(/<a?:[a-zA-Z0-9_]+:[0-9]+>/g, '')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim().toLowerCase();
}

function eligible(order) {
  return order?.payment_status === 'PAID' && order.status === 'PROCESSING';
}

function deliveryItems(orderCode) {
  return db.prepare('SELECT * FROM order_delivery_items WHERE order_code = ? ORDER BY id').all(orderCode);
}

function credentialsOrder(order, credentials) {
  const plaintext = decrypt(credentials);
  if (isEncrypted(plaintext)) throw new Error('STOCK_CREDENTIALS_DECRYPT_FAILED');
  const [email = '', password = '', profile = '', pin = ''] = String(plaintext).split('|').map((part) => part.trim());
  if (!email || !password) throw new Error('INVALID_STOCK_CREDENTIALS');
  return {
    ...order,
    credential_email: encrypt(email), credential_password: encrypt(password),
    credential_profile: encrypt(profile), credential_pin: encrypt(pin),
    delivery_login_url: config.defaultLoginUrl,
    claim_notes: config.defaultDeliveryTerms,
  };
}

// Reserve the entire quantity or nothing. Snapshots stay encrypted across retries.
function reserveItems(order) {
  const quantity = Number(order.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_AUTO_DELIVERY_QUANTITY) {
    throw new Error('INVALID_QUANTITY');
  }
  const existing = deliveryItems(order.order_code);
  if (existing.length) {
    if (existing.length !== quantity) throw new Error('DELIVERY_QUANTITY_CONFLICT');
    return existing;
  }
  const exactName = stockName(order.product_name);
  const exactCount = Number(db.prepare(`SELECT COUNT(*) AS total FROM account_stock
    WHERE status = 'AVAILABLE' AND LOWER(service_type) = ?`).get(exactName)?.total || 0);
  const type = exactCount >= quantity ? exactName : String(order.service_type || '').toLowerCase();
  const stock = db.prepare(`SELECT * FROM account_stock WHERE status = 'AVAILABLE'
    AND LOWER(service_type) = ? ORDER BY id LIMIT ?`).all(type, quantity);
  if (stock.length !== quantity) return [];
  // Validate before consuming any stock, including credentials damaged in storage.
  for (const item of stock) credentialsOrder(order, item.credentials);
  const soldAt = nowIso();
  for (const item of stock) {
    const claimed = db.prepare(`UPDATE account_stock SET status = 'SOLD', order_code = ?, sold_at = ?
      WHERE id = ? AND status = 'AVAILABLE'`).run(order.order_code, soldAt, item.id);
    if (claimed.changes !== 1) throw new Error('STOCK_CLAIM_CONFLICT');
    db.prepare('INSERT INTO order_delivery_items (order_code, stock_id, credentials) VALUES (?, ?, ?)')
      .run(order.order_code, item.id, item.credentials);
  }
  return deliveryItems(order.order_code);
}

export async function deliverPaidOrder(client, orderCode) {
  if (!client?.users) return { delivered: false };
  const lease = randomUUID();
  let reservation;
  try {
    reservation = db.transaction(() => {
      const order = getOrderByCode(orderCode);
      if (!eligible(order)) return null;
      const now = nowIso();
      const claimed = db.prepare(`UPDATE order_fulfillments
        SET status = 'SENDING', lease_token = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
        WHERE order_code = ? AND status IN ('PENDING', 'FAILED', 'WAITING_STOCK', 'SENDING')
          AND retry_at <= ? AND (lease_until IS NULL OR lease_until <= ?)`)
        .run(lease, new Date(Date.now() + LEASE_MS).toISOString(), now, orderCode, now, now);
      if (!claimed.changes) return null;
      const items = reserveItems(order);
      if (!items.length) {
        db.prepare(`UPDATE order_fulfillments SET status = 'WAITING_STOCK', lease_token = NULL,
          lease_until = NULL, last_error = 'INSUFFICIENT_STOCK', retry_at = ? WHERE order_code = ?`)
          .run(new Date(Date.now() + 5 * 60_000).toISOString(), orderCode);
        return null;
      }
      return { order, items };
    }).immediate();
  } catch (error) {
    const attempts = db.prepare('SELECT attempts FROM order_fulfillments WHERE order_code = ?').get(orderCode)?.attempts || 1;
    const retryAt = new Date(Date.now() + Math.min(60, 2 ** Math.min(attempts, 6)) * 60_000).toISOString();
    db.prepare(`UPDATE order_fulfillments SET status = ?, last_error = ?, lease_token = NULL,
      lease_until = NULL, retry_at = ?, updated_at = ? WHERE order_code = ?`)
      .run(eligible(getOrderByCode(orderCode)) ? 'FAILED' : 'BLOCKED',
        String(error.code || error.message || error.name || 'DELIVERY_FAILED').slice(0, 80),
        retryAt, nowIso(), orderCode);
    console.error(`[AUTO-DELIVERY] ${orderCode}: reservation pending retry (${error.code || error.message || error.name || 'failed'})`);
    return { delivered: false };
  }
  if (!reservation) return { delivered: false };

  const renewLease = () => {
    const order = getOrderByCode(orderCode);
    if (!eligible(order)) throw new Error('ORDER_NOT_DELIVERABLE');
    const result = db.prepare(`UPDATE order_fulfillments SET lease_until = ?, updated_at = ?
      WHERE order_code = ? AND lease_token = ? AND status = 'SENDING'`)
      .run(new Date(Date.now() + LEASE_MS).toISOString(), nowIso(), orderCode, lease);
    if (!result.changes) throw new Error('DELIVERY_LEASE_LOST');
  };

  try {
    const customer = await client.users.fetch(reservation.order.customer_id);
    const channel = await customer.createDM();
    for (const [index, item] of reservation.items.entries()) {
      if (item.dm_message_id) continue;
      renewLease();
      const order = credentialsOrder(reservation.order, item.credentials);
      const message = await channel.send({
        content: `Đơn ${orderCode} — tài khoản ${index + 1}/${reservation.items.length}`,
        embeds: buildDeliveryCredentialEmbeds(order),
        components: buildDeliveryLoginComponents(order),
        allowedMentions: { parse: [] },
        // Discord deduplicates recent sends if a response was lost.
        nonce: createHash('sha256').update(`${orderCode}:${item.id}`).digest('hex').slice(0, 24),
        enforceNonce: true,
      });
      if (!message?.id) throw new Error('DELIVERY_NOT_CONFIRMED');
      renewLease();
      db.prepare(`UPDATE order_delivery_items SET dm_channel_id = ?, dm_message_id = ?, sent_at = ?
        WHERE id = ?`).run(channel.id, message.id, nowIso(), item.id);
    }
    const updated = db.transaction(() => {
      renewLease();
      const items = deliveryItems(orderCode);
      if (items.some((item) => !item.dm_message_id)) throw new Error('DELIVERY_INCOMPLETE');
      const [email = '', password = '', profile = '', pin = ''] = decrypt(items[0].credentials).split('|').map((part) => part.trim());
      saveDelivery(orderCode, 'SYSTEM_AUTO', email, password, profile, pin,
        config.defaultLoginUrl, config.defaultDeliveryTerms, items[0].dm_channel_id, items[0].dm_message_id);
      const completed = markOrderCompleted(orderCode, 'SYSTEM_AUTO', config.feedbackTimeoutHours);
      db.prepare(`UPDATE order_fulfillments SET status = 'DELIVERED', lease_token = NULL,
        lease_until = NULL, last_error = NULL, updated_at = ? WHERE order_code = ? AND lease_token = ?`)
        .run(nowIso(), orderCode, lease);
      return completed;
    }).immediate();
    return { delivered: true, updated };
  } catch (error) {
    const attempts = db.prepare('SELECT attempts FROM order_fulfillments WHERE order_code = ?').get(orderCode)?.attempts || 1;
    const retryAt = new Date(Date.now() + Math.min(60, 2 ** Math.min(attempts, 6)) * 60_000).toISOString();
    db.prepare(`UPDATE order_fulfillments SET status = ?, last_error = ?, lease_token = NULL,
      lease_until = NULL, retry_at = ?, updated_at = ? WHERE order_code = ? AND lease_token = ?`)
      .run(eligible(getOrderByCode(orderCode)) ? 'FAILED' : 'BLOCKED',
        String(error.code || error.name || 'DELIVERY_FAILED').slice(0, 80), retryAt, nowIso(), orderCode, lease);
    console.error(`[AUTO-DELIVERY] ${orderCode}: delivery pending retry (${error.code || error.name || 'failed'})`);
    return { delivered: false };
  }
}

export async function processPendingDeliveries(client, limit = 10) {
  const now = nowIso();
  const pending = db.prepare(`SELECT f.order_code FROM order_fulfillments f
    JOIN orders o ON o.order_code = f.order_code
    WHERE f.status IN ('PENDING', 'WAITING_STOCK', 'FAILED', 'SENDING')
      AND f.retry_at <= ? AND (f.lease_until IS NULL OR f.lease_until <= ?)
      AND o.payment_status = 'PAID' AND o.status = 'PROCESSING'
    ORDER BY f.retry_at LIMIT ?`).all(now, now, limit);
  for (const { order_code: orderCode } of pending) {
    try {
      const result = await deliverPaidOrder(client, orderCode);
      if (result.delivered) {
        const { updateOrderLogMessage } = await import('./notificationService.js');
        const guild = await client.guilds.fetch(result.updated.guild_id);
        if (guild) {
          await updateOrderLogMessage(guild, result.updated);
          const { emitStaffLog } = await import('./staffLogService.js');
          await emitStaffLog(client, {
            guildId: result.updated.guild_id,
            targetId: result.updated.customer_id,
            action: 'ORDER_DELIVERED',
            detail: 'Hệ thống giao lại thành công sau khi chờ retry',
            relatedOrderCode: result.updated.order_code,
          });
          const ticketChannel = await guild.channels.fetch(result.updated.ticket_channel_id).catch(() => null);
          if (ticketChannel?.isTextBased()) {
            const { buildDeliveryLogText } = await import('../utils/embeds.js');
            await ticketChannel.send(buildDeliveryLogText(result.updated)).catch(() => null);
          }
        }
      }
    } catch (error) {
      console.error(`[AUTO-DELIVERY] ${orderCode}: retry failed (${error.code || error.name || 'failed'})`);
    }
  }
}

import crypto from 'node:crypto';
import { AttachmentBuilder, EmbedBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import QRCode from 'qrcode';
import { assertPaymentConfig, config, getPayOSCancelUrl, getPayOSReturnUrl, getWebhookUrl } from '../config.js';
import { db, nowIso } from '../database/db.js';
import {
  getLatestOrderByTicketChannel,
  getOrderByCode,
  getOrderByPayOSCode,
  getOrderByPaymentCode,
  markOrderPaid,
  recordPaymentEvent,
  savePaymentLinkData,
  savePaymentMessage,
  setOrderStatus,
  markOrderCompleted,
  saveDelivery,
  resetPaymentLinkForRegen,
} from './orderService.js';
import { findOrderByIncomingPaymentCode, syncPaymentCodeIfPossible } from './paymentOrderMatcher.js';
import { getTopupByPayOSCode, finalizeTopup } from './walletService.js';
import { syncCustomerStats } from './customerService.js';
import { applyCustomerRoles } from './roleService.js';
import { emitStaffLog } from './staffLogService.js';
import { sendPaymentConfirmedFlow, updateOrderLogMessage } from './notificationService.js';
import {
  buildPaymentQrV2,
} from '../utils/embeds.js';
import { formatCurrency } from '../utils/formatters.js';
import { decrypt } from '../utils/crypto.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';

const PAYOS_API_BASE = 'https://api-merchant.payos.vn';

function createHmacHex(secret, data) {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

function truncateText(input, maxLength) {
  const value = String(input ?? '').trim();
  if (!value) return '';
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

function buildPayOSSignature({ amount, cancelUrl, description, orderCode, returnUrl }) {
  const data = `amount=${amount}&cancelUrl=${cancelUrl}&description=${description}&orderCode=${orderCode}&returnUrl=${returnUrl}`;
  return createHmacHex(config.payosChecksumKey, data);
}

function sortObjDataByKey(object) {
  return Object.keys(object)
    .sort()
    .reduce((acc, key) => {
      acc[key] = object[key];
      return acc;
    }, {});
}

function convertObjToQueryStr(object) {
  return Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .map((key) => {
      let value = object[key];
      if (value && Array.isArray(value)) {
        value = JSON.stringify(value.map((item) => sortObjDataByKey(item)));
      }
      if ([null, undefined, 'undefined', 'null'].includes(value)) {
        value = '';
      }
      return `${key}=${value}`;
    })
    .join('&');
}

function verifyPayOSWebhookSignature(data, signature) {
  if (!config.payosChecksumKey || !signature || !data) {
    console.warn('[PAYOS-SIGNATURE] Thiếu checksum key, signature hoặc data:', {
      hasChecksumKey: !!config.payosChecksumKey,
      hasSignature: !!signature,
      hasData: !!data
    });
    return false;
  }
  const sortedData = sortObjDataByKey(data);
  const queryString = convertObjToQueryStr(sortedData);
  const expected = createHmacHex(config.payosChecksumKey, queryString);
  const matched = expected.toLowerCase() === String(signature).toLowerCase();
  if (!matched) {
    console.error('[PAYOS-SIGNATURE] Sai chữ ký PayOS!', {
      queryString,
      expectedSignature: expected.toLowerCase(),
      receivedSignature: String(signature).toLowerCase(),
      checksumKeyUsed: config.payosChecksumKey ? `${config.payosChecksumKey.slice(0, 4)}...${config.payosChecksumKey.slice(-4)}` : 'empty'
    });
  } else {
    console.log('[PAYOS-SIGNATURE] Xác thực chữ ký PayOS thành công cho đơn:', data.orderCode);
  }
  return matched;
}

function buildPayOSRequestPayload(order) {
  const returnUrl = getPayOSReturnUrl();
  const cancelUrl = getPayOSCancelUrl();
  if (!returnUrl || !cancelUrl) {
    throw new Error('Thiếu PUBLIC_BASE_URL hoặc PAYOS_RETURN_PATH / PAYOS_CANCEL_PATH trong .env.');
  }

  const order_code = order.orderCode ?? order.order_code;
  const payos_order_code = order.payosOrderCode ?? order.payos_order_code;
  const total_amount = order.totalAmount ?? order.total_amount;
  const payment_code = order.paymentCode ?? order.payment_code;
  const product_name = order.productName ?? order.product_name;

  const description = truncateText(payment_code ?? order_code, 25);
  const amount = Number(total_amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Đơn ${order_code} có số tiền không hợp lệ (${total_amount}). Không thể tạo QR PayOS.`);
  }
  const orderCode = Number(payos_order_code ?? String(order_code ?? '').replace(/^[A-Z]+_/, ''));
  if (!Number.isFinite(orderCode) || orderCode <= 0) {
    throw new Error(`Đơn ${order_code} chưa có payos_order_code hợp lệ để tạo checkout PayOS.`);
  }
  const expiredAt = Math.floor(Date.now() / 1000) + (Math.max(1, config.payosExpireMinutes) * 60);

  return {
    orderCode,
    amount,
    description,
    items: [
      {
        name: truncateText(product_name, 25) || 'Don hang Cenar Store',
        quantity: 1,
        price: amount,
      },
    ],
    cancelUrl,
    returnUrl,
    expiredAt,
    signature: buildPayOSSignature({ amount, cancelUrl, description, orderCode, returnUrl }),
  };
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
    throw new Error(payload?.desc || `PayOS API trả về HTTP ${response.status}`);
  }

  return payload?.data ?? payload;
}

function buildCheckoutUrlFromLinkId(paymentLinkId) {
  if (!paymentLinkId) return null;
  return `https://pay.payos.vn/web/${paymentLinkId}`;
}

async function renderPaymentQrImage(order) {
  const qrData = order.payment_qr_code || order.payment_checkout_url || order.payment_code || order.order_code;
  if (!qrData) return null;
  return QRCode.toBuffer(qrData, {
    type: 'png',
    width: 720,
    margin: 2,
    color: {
      dark: '#111827',
      light: '#FFFFFFFF',
    },
  });
}

export async function createOrLoadPayOSLink(order) {
  assertPaymentConfig();

  const payment_link_id = order.paymentLinkId ?? order.payment_link_id;
  const payment_checkout_url = order.paymentCheckoutUrl ?? order.payment_checkout_url;
  const order_code = order.orderCode ?? order.order_code;
  const payos_order_code = order.payosOrderCode ?? order.payos_order_code;
  const payment_qr_code = order.paymentQrCode ?? order.payment_qr_code;
  const payment_qr_text = order.paymentQrText ?? order.payment_qr_text;

  if (payment_link_id && payment_checkout_url) {
    return order;
  }

  const payload = buildPayOSRequestPayload(order);

  try {
    const created = await callPayOSApi('POST', '/v2/payment-requests', payload);
    return savePaymentLinkData(order_code, {
      paymentLinkId: created.paymentLinkId ?? created.id ?? null,
      checkoutUrl: created.checkoutUrl ?? buildCheckoutUrlFromLinkId(created.paymentLinkId ?? created.id),
      qrCode: created.qrCode ?? null,
      qrUrl: created.checkoutUrl ?? buildCheckoutUrlFromLinkId(created.paymentLinkId ?? created.id),
      qrText: created.qrCode ?? null,
      expiredAt: created.expiredAt ? new Date(Number(created.expiredAt) * 1000).toISOString() : null,
    });
  } catch (error) {
    const knownDuplicate = /đơn thanh toán đã tồn tại|already exists/i.test(error.message);
    if (!knownDuplicate) throw error;

    const info = await getPayOSPaymentInfo(payos_order_code);
    return savePaymentLinkData(order_code, {
      paymentLinkId: info.id ?? payment_link_id ?? null,
      checkoutUrl: payment_checkout_url ?? buildCheckoutUrlFromLinkId(info.id),
      qrCode: payment_qr_code ?? null,
      qrUrl: payment_checkout_url ?? buildCheckoutUrlFromLinkId(info.id),
      qrText: payment_qr_text ?? null,
      expiredAt: info.expiredAt ? new Date(Number(info.expiredAt) * 1000).toISOString() : null,
    });
  }
}

export async function getPayOSPaymentInfo(identifier) {
  assertPaymentConfig();
  return callPayOSApi('GET', `/v2/payment-requests/${encodeURIComponent(identifier)}`);
}

export async function cancelPayOSPaymentLink(order, cancellationReason = 'Khách yêu cầu hủy đơn hàng') {
  assertPaymentConfig();
  const identifier = order.payment_link_id || order.payos_order_code;
  if (!identifier) return null;
  try {
    return await callPayOSApi('POST', `/v2/payment-requests/${encodeURIComponent(identifier)}/cancel`, {
      cancellationReason,
    });
  } catch (error) {
    if (/không thể hủy|cannot cancel|đã hủy/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

export async function confirmPayOSWebhookUrl() {
  assertPaymentConfig();
  const webhookUrl = getWebhookUrl();
  if (!webhookUrl) {
    throw new Error('Thiếu PUBLIC_BASE_URL nên chưa thể xác nhận webhook PayOS.');
  }
  return callPayOSApi('POST', '/confirm-webhook', { webhookUrl });
}

// ═══ VietQR — Tạo QR chuyển khoản ngân hàng (xác nhận tay bằng /qr xac_nhan_tay:true) ═══

import { getGuildConfig, hasBankConfig } from './guildConfigService.js';

function getBankInfo(guildId) {
  const gc = getGuildConfig(guildId);
  if (hasBankConfig(gc)) {
    return {
      bankBin: gc.bank_bin,
      accountNo: gc.bank_account_no,
      accountName: gc.bank_account_name,
    };
  }
  return null;
}

export function buildVietQRUrl({ bankBin, accountNo, amount, content, accountName }) {
  // Chuẩn VietQR: https://img.vietqr.io/image/<BANK_ID>-<ACCOUNT_NO>-<TEMPLATE>.png?amount=X&addInfo=Y&accountName=Z
  const template = 'compact2';
  const encodedContent = encodeURIComponent(content || '');
  const encodedName = encodeURIComponent(accountName || '');
  return `https://img.vietqr.io/image/${bankBin}-${accountNo}-${template}.png?amount=${amount}&addInfo=${encodedContent}&accountName=${encodedName}`;
}

export async function sendVietQRPayment({ guild, orderCode }) {
  const order = getOrderByCode(orderCode);
  if (!order) throw new Error('Không tìm thấy đơn hàng.');
  if (!(Number(order.total_amount) > 0)) throw new Error('Đơn này không có số tiền cần thanh toán.');
  if (order.payment_status === 'PAID') throw new Error('Đơn này đã thanh toán rồi.');

  const bankInfo = getBankInfo(order.guild_id);
  if (!bankInfo) {
    throw new Error('Chưa cấu hình ngân hàng. Dùng `/setup-bank` để cấu hình tài khoản nhận tiền.');
  }

  const transferContent = order.payment_code || order.order_code;
  const vietqrUrl = buildVietQRUrl({
    bankBin: bankInfo.bankBin,
    accountNo: bankInfo.accountNo,
    amount: order.total_amount,
    content: transferContent,
    accountName: bankInfo.accountName,
  });

  const response = await fetch(vietqrUrl);
  if (!response.ok) throw new Error(`VietQR API lỗi: ${response.status}`);
  const imageBuffer = Buffer.from(await response.arrayBuffer());

  const ticketChannel = await guild.channels.fetch(order.ticket_channel_id).catch(() => null);
  if (!ticketChannel?.isTextBased()) throw new Error('Ticket của đơn hàng không còn khả dụng.');

  const attachmentName = `vietqr-${order.order_code}.png`;

  // ═══ VietQR Embed — QR hiển thị inline ═══
  const bankName = (bankInfo.bankName || bankInfo.bankBin || 'BANK').toUpperCase();
  const embed = new EmbedBuilder()
    .setColor(0x00b4d8)
    .setTitle('Thông Tin Thanh Toán Đơn Hàng')
    .setDescription(
      `Quét mã QR hoặc chuyển khoản đúng thông tin bên dưới — hệ thống sẽ tự động xác nhận và xử lý đơn hàng trong vòng 1–2 phút sau khi nhận được tiền.`
    )
    .addFields(
      { name: 'Ngân hàng', value: `\`${bankName}\``, inline: true },
      { name: 'Số tài khoản', value: `\`${bankInfo.accountNo}\``, inline: true },
      { name: 'Chủ tài khoản', value: `\`${(bankInfo.accountName || 'CHỦ TK').toUpperCase()}\``, inline: true },
      { name: 'Nội dung chuyển khoản', value: `\`${transferContent}\``, inline: false },
      { name: 'Sản phẩm', value: `\`${order.quantity}x ${order.product_name}\``, inline: true },
      { name: 'Số tiền', value: `\`${formatCurrency(order.total_amount)}\``, inline: true },
    )
    .setImage(`attachment://${attachmentName}`)
    .setFooter({ text: 'Lưu ý: Giao dịch sẽ hết hạn sau 10 phút nếu chưa thanh toán.' });

  const sentMessage = await ticketChannel.send({
    content: `<@${order.customer_id}>`,
    embeds: [embed],
    files: [new AttachmentBuilder(imageBuffer, { name: attachmentName })],
  });

  // Lưu VietQR URL vào DB để website hiển thị QR code
  savePaymentLinkData(order.order_code, {
    paymentLinkId: null,
    checkoutUrl: null,
    qrCode: vietqrUrl,
    qrUrl: vietqrUrl,
  });
  const saved = savePaymentMessage(order.order_code, sentMessage.id);
  return { order: saved, message: sentMessage, vietqrUrl };
}

export async function sendOrRefreshPaymentQr({ guild, orderCode }) {
  assertPaymentConfig();

  const current = getOrderByCode(orderCode);
  if (!current) {
    throw new Error('Không tìm thấy đơn hàng.');
  }

  if (!(Number(current.total_amount) > 0)) {
    throw new Error('Đơn này không có số tiền cần thanh toán.');
  }

  if (current.payment_status === 'PAID') {
    throw new Error('Đơn này đã thanh toán rồi.');
  }

  const order = await createOrLoadPayOSLink(current);
  const ticketChannel = await guild.channels.fetch(order.ticket_channel_id).catch(() => null);
  if (!ticketChannel?.isTextBased()) {
    throw new Error('Ticket của đơn hàng không còn khả dụng.');
  }

  const attachmentName = `payos-${order.order_code}.png`;
  const imageBuffer = await renderPaymentQrImage(order);
  const files = imageBuffer ? [new AttachmentBuilder(imageBuffer, { name: attachmentName })] : [];

  // ═══ PayOS QR — Components V2 (QR inline qua MediaGallery attachment://) ═══
  const { container, actionRow, flags } = buildPaymentQrV2({
    order,
    attachmentName,
    checkoutUrl: order.payment_checkout_url,
    hasImage: Boolean(imageBuffer),
  });

  const messagePayload = {
    components: [container, actionRow],
    flags,
    files,
    allowedMentions: { users: [order.customer_id] },
  };

  let sentMessage = null;
  if (order.payment_message_id) {
    const existing = await ticketChannel.messages.fetch(order.payment_message_id).catch(() => null);
    if (existing) {
      sentMessage = await existing.edit(messagePayload).catch(() => null);
    }
  }

  if (!sentMessage) {
    sentMessage = await ticketChannel.send(messagePayload);
  }

  const updated = savePaymentMessage(order.order_code, sentMessage.id);
  return {
    order: updated,
    message: sentMessage,
    checkoutUrl: updated.payment_checkout_url,
  };
}

export async function regeneratePaymentQr({ guild, orderCode }) {
  assertPaymentConfig();

  const current = getOrderByCode(orderCode);
  if (!current) throw new Error('Không tìm thấy đơn hàng.');
  if (!(Number(current.total_amount) > 0)) throw new Error('Đơn này không có số tiền cần thanh toán.');
  if (current.payment_status === 'PAID') throw new Error('Đơn này đã thanh toán rồi.');

  // Hủy link PayOS cũ (best-effort) để tránh tồn đọng giao dịch chờ
  if (current.payment_link_id || current.payos_order_code) {
    await cancelPayOSPaymentLink(current, 'Khách tạo lại hoá đơn mới để gia hạn').catch(() => null);
  }

  // Xoá field link cũ + cấp payos_order_code mới → PayOS không từ chối trùng,
  // QR và link checkout sẽ hoàn toàn mới.
  const reset = resetPaymentLinkForRegen(orderCode);
  if (!reset) throw new Error('Không reset được hoá đơn cũ.');

  return sendOrRefreshPaymentQr({ guild, orderCode });
}

function parseWebhookSuccessFlag(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0') return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return null;
}

function normalizePayOSWebhookBody(body) {
  return {
    code: body?.code,
    desc: body?.desc,
    success: parseWebhookSuccessFlag(body?.success),
    data: body?.data ?? {},
    signature: body?.signature ?? '',
  };
}

async function finalizePaidOrder(client, order, paymentData, transactionId, transactionContent) {
  const eventState = recordPaymentEvent({
    orderCode: order.order_code,
    provider: 'PAYOS',
    transactionId,
    amount: paymentData.amount ?? order.total_amount,
    content: transactionContent,
    rawPayload: paymentData,
  });

  if (eventState.duplicate || order.payment_status === 'PAID') {
    return { updated: order, duplicate: true };
  }

  const updated = markOrderPaid(order.order_code, {
    amountPaid: paymentData.amount ?? order.total_amount,
    transactionId,
    transactionContent,
  });

  // TỰ ĐỘNG GIAO HÀNG TỪ KHO (AUTO-DELIVERY)
  let autoDelivered = false;
  let finalOrder = updated;
  try {
    // Làm sạch tên sản phẩm để so khớp kho hàng chính xác theo từng sản phẩm cụ thể
    const cleanProductName = (updated.product_name || '')
      .replace(/<a?:[a-zA-Z0-9_]+:[0-9]+>/g, '') // Bỏ Discord custom emoji
      .replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '') // Bỏ emoji
      .trim()
      .toLowerCase();

    const serviceType = updated.service_type || 'netflix';
    
    // Claim kho ATOMIC: gộp SELECT + UPDATE vào một câu lệnh để hai webhook
    // đồng thời không thể grab cùng một tài khoản (chống giao trùng).
    const claimStock = (type) => db.prepare(
      `UPDATE account_stock SET status = 'SOLD', order_code = ?, sold_at = ?
       WHERE id = (
         SELECT id FROM account_stock
         WHERE status = 'AVAILABLE' AND LOWER(service_type) = ?
         ORDER BY id ASC LIMIT 1
       )
       RETURNING *`
    ).get(updated.order_code, nowIso(), type);

    // Ưu tiên khớp chính xác tên sản phẩm, fallback khớp service_type
    let stockItem = claimStock(cleanProductName);
    if (!stockItem) {
      stockItem = claimStock(serviceType.toLowerCase());
    }

    if (stockItem) {
      const parts = decrypt(stockItem.credentials).split('|').map(p => p.trim());
      const email = parts[0] || '';
      const password = parts[1] || '';
      const profile = parts[2] || '';
      const pin = parts[3] || '';

      // Cập nhật thông tin giao hàng trong order và đổi trạng thái thành COMPLETED
      markOrderCompleted(updated.order_code, 'SYSTEM_AUTO', config.feedbackTimeoutHours);

      const customer = await client.users.fetch(updated.customer_id).catch(() => null);
      let dmChannelId = null;
      let dmMessageId = null;

      if (customer) {
        const dmChannel = await customer.createDM().catch(() => null);
        if (dmChannel) {
          dmChannelId = dmChannel.id;
          // Gửi DM chứa tài khoản cho khách
          const { buildDeliveryCredentialEmbeds, buildDeliveryLoginComponents } = await import('../utils/embeds.js');

          // Lấy thông tin order đầy đủ sau khi saveDelivery
          const tempOrder = saveDelivery(updated.order_code, 'SYSTEM_AUTO', email, password, profile, pin, config.defaultLoginUrl, config.defaultDeliveryTerms, dmChannelId, null);

          const dmMessage = await dmChannel.send({ 
            embeds: buildDeliveryCredentialEmbeds(tempOrder), 
            components: buildDeliveryLoginComponents(tempOrder) 
          }).catch(() => null);

          if (dmMessage) {
            dmMessageId = dmMessage.id;
            saveDelivery(updated.order_code, 'SYSTEM_AUTO', email, password, profile, pin, config.defaultLoginUrl, config.defaultDeliveryTerms, dmChannelId, dmMessageId);
          }
        }
      }

      autoDelivered = true;
      finalOrder = getOrderByCode(updated.order_code) || updated;
    }
  } catch (err) {
    console.error('[AUTO-DELIVERY ERROR]', err);
  }

  const guild = await client.guilds.fetch(finalOrder.guild_id).catch(() => null);
  if (guild) {
    await updateOrderLogMessage(guild, finalOrder);
    await sendPaymentConfirmedFlow({
      guild,
      order: finalOrder,
      amount: finalOrder.amount_paid,
      transactionContent,
    });
    await applyCustomerRoles(guild, finalOrder.customer_id);

    if (autoDelivered) {
      // Ghi log giao hàng tự động thành công
      await emitStaffLog(client, { guildId: finalOrder.guild_id, targetId: finalOrder.customer_id, action: 'ORDER_DELIVERED', detail: 'Hệ thống tự động giao hàng từ kho', relatedOrderCode: finalOrder.order_code });
      
      // Gửi log thông báo trong ticket channel
      const ticketChannel = await guild.channels.fetch(finalOrder.ticket_channel_id).catch(() => null);
      if (ticketChannel?.isTextBased()) {
        const { buildDeliveryLogText } = await import('../utils/embeds.js');
        await ticketChannel.send(buildDeliveryLogText(finalOrder)).catch(() => null);
      }
    } else {
      // Ghi log thanh toán thành công thông thường
      await emitStaffLog(client, { guildId: finalOrder.guild_id, targetId: finalOrder.customer_id, action: 'PAYMENT_CONFIRMED', detail: transactionContent, relatedOrderCode: finalOrder.order_code });

      // Nếu kho hết hàng, bắn cảnh báo vào kênh staff_log
      try {
        const cleanProductName = (finalOrder.product_name || '')
          .replace(/<a?:[a-zA-Z0-9_]+:[0-9]+>/g, '')
          .replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD10-\uDDFF]/g, '')
          .trim()
          .toLowerCase();
        const serviceType = finalOrder.service_type || 'netflix';
        
        let counts = db.prepare("SELECT COUNT(*) AS count FROM account_stock WHERE status = 'AVAILABLE' AND LOWER(service_type) = ?").get(cleanProductName);
        if (!counts || counts.count === 0) {
          counts = db.prepare("SELECT COUNT(*) AS count FROM account_stock WHERE status = 'AVAILABLE' AND LOWER(service_type) = ?").get(serviceType.toLowerCase());
        }
        
        if (!counts || counts.count === 0) {
          const { getGuildConfig } = await import('./guildConfigService.js');
          const gCfg = getGuildConfig(finalOrder.guild_id);
          if (gCfg?.staff_log_channel_id) {
            const chan = await guild.channels.fetch(gCfg.staff_log_channel_id).catch(() => null);
            if (chan?.isTextBased()) {
              await chan.send(`**CANH BAO HET KHO:** Don hang \`${finalOrder.order_code}\` (**${finalOrder.product_name}**) da thanh toan thanh cong nhung **KHO HANG DA HET**. Vui long giao hang thu cong!`);
            }
          }
        }
      } catch (errStock) {
        console.error('[STOCK WARNING ERROR]', errStock);
      }
    }
  }

  syncCustomerStats(finalOrder.guild_id, finalOrder.customer_id);
  return { updated: finalOrder, duplicate: false };
}

export async function handlePayOSWebhook({ client, body }) {
  const payload = normalizePayOSWebhookBody(body);
  if (!verifyPayOSWebhookSignature(payload.data, payload.signature)) {
    return { ok: false, status: 400, body: { ok: false, message: 'Invalid PayOS signature' } };
  }

  const payosOrderCode = Number(payload.data.orderCode);

  // 1. Kiểm tra xem có phải đơn NẠP TIỀN ví không
  if (Number.isFinite(payosOrderCode)) {
    const topup = getTopupByPayOSCode(payosOrderCode);
    if (topup) {
      const resultCode = String(payload.data.code ?? payload.code ?? '').trim();
      const isSuccess = payload.success === true || (payload.success === null && resultCode === '00');

      if (isSuccess && resultCode === '00' && Number(payload.data.amount ?? 0) >= topup.amount) {
        const topupResult = finalizeTopup(topup.topup_code);
          
          if (topupResult && global.discordClient) {
            try {
              const user = await global.discordClient.users.fetch(topupResult.customer_id);
              if (user) {
                const E = createEmojiResolver(topupResult.guild_id);
                const container = new ContainerBuilder().setAccentColor(0x2ECC71);
                container.addTextDisplayComponents(
                  new TextDisplayBuilder().setContent(`## ${E('tickgreen') || '✅'} NẠP TIỀN THÀNH CÔNG!\n\nBạn đã nạp thành công **${topupResult.amount.toLocaleString('vi-VN')}đ** vào ví.\n> ${E('status_check') || '✅'} Giao dịch: \`${topupResult.topup_code}\``)
                );
                await user.send({ components: [container], flags: MessageFlags.IsComponentsV2 });
              }
            } catch (err) {
              console.error('[TOPUP DM ERROR]', err.message);
            }
          }

          return { ok: true, status: 200, body: { ok: true, message: 'Topup confirmed', topup_code: topup.topup_code } };
      }
      return { ok: true, status: 200, body: { ok: true, message: 'Ignored non-success topup' } };
    }
  }

  // 2. Kiểm tra xem có phải đơn BOOST SERVER không
  if (Number.isFinite(payosOrderCode)) {
    const resultCode = String(payload.data.code ?? payload.code ?? '').trim();
    const isSuccess  = payload.success === true || (payload.success === null && resultCode === '00');
    if (isSuccess && resultCode === '00') {
      const { getBoostOrderByPayOSCode, handleBoostPayOSWebhook } = await import('./boostServerService.js');
      const boostOrder = getBoostOrderByPayOSCode(payosOrderCode);
      if (boostOrder) {
        await handleBoostPayOSWebhook({
          client,
          payosOrderCode,
          amount:      Number(payload.data.amount ?? 0),
          reference:   payload.data.reference ?? null,
          description: payload.data.description ?? null,
        });
        return { ok: true, status: 200, body: { ok: true, message: 'Boost payment confirmed', order_code: boostOrder.order_code } };
      }
    }
  }

  // 2. Tìm đơn hàng thông thường
  let order = Number.isFinite(payosOrderCode) ? getOrderByPayOSCode(payosOrderCode) : null;
  const matched = findOrderByIncomingPaymentCode({
    orderCode: payload.data.orderCode,
    description: payload.data.description,
    reference: payload.data.reference,
  });

  if (!order) {
    order = matched.order || getOrderByPaymentCode(String(payload.data.description ?? '').trim().toUpperCase());
  }

  if (order && matched.matchedCode) {
    syncPaymentCodeIfPossible(order, matched.matchedCode);
  }

  if (!order) {
    return { ok: true, status: 200, body: { ok: true, message: 'No matching order found' } };
  }

  const resultCode = String(payload.data.code ?? payload.code ?? '').trim();
  const isSuccess = payload.success === true || (payload.success === null && resultCode === '00');
  if (!isSuccess || resultCode !== '00') {
    return { ok: true, status: 200, body: { ok: true, message: 'Ignored non-success event' } };
  }

  if (Number(payload.data.amount ?? 0) < Number(order.total_amount ?? 0)) {
    return { ok: true, status: 200, body: { ok: true, message: 'Ignored insufficient amount' } };
  }

  const transactionId = payload.data.reference || payload.data.paymentLinkId || `PAYOS_${payload.data.orderCode}`;
  const transactionContent = payload.data.description || order.payment_code || order.order_code;
  const result = await finalizePaidOrder(client, order, payload.data, transactionId, transactionContent);

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      message: result.duplicate ? 'Duplicate or already paid' : 'Payment confirmed',
      order_code: order.order_code,
      amount: formatCurrency(result.updated.amount_paid),
      matched_by: matched.matchedBy ?? (Number.isFinite(payosOrderCode) ? 'payos_order_code' : null),
    },
  };
}

export async function syncPaymentStatusFromPayOS({ client, orderCode = null, payosOrderCode = null }) {
  assertPaymentConfig();
  const order = orderCode
    ? getOrderByCode(orderCode)
    : getOrderByPayOSCode(payosOrderCode);

  if (!order) {
    throw new Error('Không tìm thấy đơn hàng cần đồng bộ PayOS.');
  }

  const info = await getPayOSPaymentInfo(order.payment_link_id || order.payos_order_code);
  const state = String(info.status ?? '').toUpperCase();

  if (state === 'PAID' && order.payment_status !== 'PAID') {
    const result = await finalizePaidOrder(
      client,
      order,
      info,
      `PAYOS_LOOKUP_${info.id ?? order.payos_order_code}`,
      order.payment_code ?? order.order_code,
    );
    return { order: result.updated, state: 'PAID', synced: true };
  }

  if (state === 'CANCELLED' && order.status === 'PENDING_PAYMENT') {
    const updated = setOrderStatus(order.order_code, 'CANCELLED');
    if (updated && client?.guilds?.fetch) {
      const guild = await client.guilds.fetch(updated.guild_id).catch(() => null);
      if (guild) {
        await updateOrderLogMessage(guild, updated).catch(() => null);
      }
    }
    return { order: updated, state, synced: true };
  }

  return { order, state, synced: false };
}

export async function confirmOrderPaidManually(guild, orderCode, amount = null) {
  const order = getOrderByCode(orderCode);
  if (!order) {
    throw new Error('Không tìm thấy đơn hàng.');
  }

  const updated = markOrderPaid(order.order_code, {
    amountPaid: amount ?? order.total_amount,
    transactionId: `MANUAL_${Date.now()}`,
    transactionContent: 'Manual confirmation',
  });

  await updateOrderLogMessage(guild, updated);
  await sendPaymentConfirmedFlow({
    guild,
    order: updated,
    amount: updated.amount_paid,
    transactionContent: 'Manual confirmation',
  });
  await applyCustomerRoles(guild, updated.customer_id);
  await emitStaffLog(guild.client, { guildId: updated.guild_id, action: 'PAYMENT_CONFIRMED_MANUAL', relatedOrderCode: updated.order_code, detail: 'Xác nhận tay QR/thanh toán' });

  return updated;
}

export function getLatestOrderForTicket(channelId) {
  return getLatestOrderByTicketChannel(channelId);
}

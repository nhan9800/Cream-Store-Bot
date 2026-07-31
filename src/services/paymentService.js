import crypto from 'node:crypto';
import { AttachmentBuilder, EmbedBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import QRCode from 'qrcode';
import { assertPaymentConfig, config, getPayOSCancelUrl, getPayOSReturnUrl, getWebhookUrl } from '../config.js';
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
} from './orderService.js';
import { findOrderByIncomingPaymentCode, syncPaymentCodeIfPossible } from './paymentOrderMatcher.js';
import { getTopupByPayOSCode, finalizeTopup } from './walletService.js';
import { syncCustomerStats } from './customerService.js';
import { applyCustomerRoles } from './roleService.js';
import { emitStaffLog } from './staffLogService.js';
import { sendPaymentConfirmedFlow, updateOrderLogMessage } from './notificationService.js';
import {
  buildPaymentPendingComponents,
  buildPaymentRequestEmbed,
  buildPaymentWaitingAckEmbed,
} from '../utils/embeds.js';
import { formatCurrency } from '../utils/formatters.js';

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

export function verifyPayOSWebhookSignature(data, signature) {
  if (!config.payosChecksumKey || !signature || !data) return false;
  const sortedData = sortObjDataByKey(data);
  const queryString = convertObjToQueryStr(sortedData);
  const expected = createHmacHex(config.payosChecksumKey, queryString);
  return expected.toLowerCase() === String(signature).toLowerCase();
}

function buildPayOSRequestPayload(order) {
  const returnUrl = getPayOSReturnUrl();
  const cancelUrl = getPayOSCancelUrl();
  if (!returnUrl || !cancelUrl) {
    throw new Error('Thiếu PUBLIC_BASE_URL hoặc PAYOS_RETURN_PATH / PAYOS_CANCEL_PATH trong .env.');
  }

  const description = truncateText(order.payment_code ?? order.order_code, 25);
  const amount = Number(order.total_amount);
  const orderCode = Number(order.payos_order_code ?? String(order.order_code ?? '').replace(/^[A-Z]+_/, ''));
  if (!Number.isFinite(orderCode) || orderCode <= 0) {
    throw new Error(`Đơn ${order.order_code} chưa có payos_order_code hợp lệ để tạo checkout PayOS.`);
  }
  const expiredAt = Math.floor(Date.now() / 1000) + (Math.max(1, config.payosExpireMinutes) * 60);

  return {
    orderCode,
    amount,
    description,
    items: [
      {
        name: truncateText(order.product_name, 25) || 'Don hang Cenar Store',
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

  if (order.payment_link_id && order.payment_checkout_url) {
    return order;
  }

  const payload = buildPayOSRequestPayload(order);

  try {
    const created = await callPayOSApi('POST', '/v2/payment-requests', payload);
    return savePaymentLinkData(order.order_code, {
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

    const info = await getPayOSPaymentInfo(order.payos_order_code);
    return savePaymentLinkData(order.order_code, {
      paymentLinkId: info.id ?? order.payment_link_id ?? null,
      checkoutUrl: order.payment_checkout_url ?? buildCheckoutUrlFromLinkId(info.id),
      qrCode: order.payment_qr_code ?? null,
      qrUrl: order.payment_checkout_url ?? buildCheckoutUrlFromLinkId(info.id),
      qrText: order.payment_qr_text ?? null,
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

// ═══ VietQR — Tạo QR chuyển khoản ngân hàng (SePay bắt webhook) ═══

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
  // Fallback: dùng SEPAY_BANK_ACCOUNT từ .env nếu có
  const sepayAccount = config.sepayBankAccount;
  if (sepayAccount) {
    return {
      bankBin: config.vietqrBankBin || '970418', // BIDV mặc định
      accountNo: sepayAccount,
      accountName: config.vietqrAccountName || 'CREAM STORE',
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
  if (order.total_amount <= 0) throw new Error('Đơn này không có số tiền cần thanh toán.');
  if (order.payment_status === 'PAID') throw new Error('Đơn này đã thanh toán rồi.');

  const bankInfo = getBankInfo(order.guild_id);
  if (!bankInfo) {
    throw new Error('Chưa cấu hình ngân hàng. Dùng `/setup-bank` hoặc thêm SEPAY_BANK_ACCOUNT vào .env.');
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
    .setTitle('🏦 Thông Tin Thanh Toán Đơn Hàng')
    .setDescription(
      `Bạn có thể quét mã QR hoặc vui lòng chuyển khoản đúng thông tin để hệ thống tự động giải phóng key. Trong trường hợp chuyển sai nội dung vui lòng tạo ticket!`
    )
    .addFields(
      { name: 'Ngân hàng', value: `\`${bankName}\``, inline: true },
      { name: 'Số tài khoản', value: `\`${bankInfo.accountNo}\``, inline: true },
      { name: 'Chủ tài khoản', value: `\`${(bankInfo.accountName || 'CHỦ TK').toUpperCase()}\``, inline: true },
      { name: 'Nội dung', value: `\`${transferContent}\``, inline: false },
      { name: 'Sản phẩm', value: `\`${order.quantity}x ${order.product_name}\``, inline: true },
      { name: 'Số tiền', value: `\`${formatCurrency(order.total_amount)}\``, inline: true },
    )
    .setImage(`attachment://${attachmentName}`)
    .setFooter({ text: '⚠️ Lưu ý: Giao dịch sẽ hết hạn sau 10p nếu chưa thanh toán. Bạn có thể tạo lại hóa đơn mới.' });

  const sentMessage = await ticketChannel.send({
    content: `<@${order.customer_id}>`,
    embeds: [embed],
    files: [new AttachmentBuilder(imageBuffer, { name: attachmentName })],
  });

  savePaymentMessage(order.order_code, sentMessage.id);
  return { order, message: sentMessage, vietqrUrl };
}

export async function sendOrRefreshPaymentQr({ guild, orderCode }) {
  assertPaymentConfig();

  const current = getOrderByCode(orderCode);
  if (!current) {
    throw new Error('Không tìm thấy đơn hàng.');
  }

  if (current.total_amount <= 0) {
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

  // ═══ PayOS Embed (hiển thị QR inline) ═══
  const expireText = order.payment_expired_at
    ? `<t:${Math.floor(new Date(order.payment_expired_at).getTime() / 1000)}:R>`
    : '_30 phút_';

  const embed = new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle('💳 Thông Tin Thanh Toán Đơn Hàng :shop:')
    .setDescription(
      `Bạn có thể quét mã QR hoặc vui lòng chuyển khoản đúng thông tin để hệ thống tự động giải phóng key sau khi nhận giao dịch.`
    )
    .addFields(
      { name: 'Nội dung', value: `\`${order.payment_code ?? order.order_code}\``, inline: false },
      { name: 'Sản phẩm', value: `\`${order.quantity}x ${order.product_name}\``, inline: true },
      { name: 'Số tiền', value: `\`${formatCurrency(order.total_amount)}\``, inline: true },
      { name: 'Hết hạn', value: expireText, inline: false },
    )
    .setFooter({ text: '⚠️ Lưu ý: Giao dịch sẽ hết hạn sau 10p nếu chưa thanh toán. Bạn có thể tạo lại hóa đơn mới.' });

  if (imageBuffer) {
    embed.setImage(`attachment://${attachmentName}`);
  }

  const actionRow = new ActionRowBuilder();
  if (order.payment_checkout_url && /^https?:\/\//i.test(order.payment_checkout_url)) {
    actionRow.addComponents(
      new ButtonBuilder().setLabel('💳 Thanh Toán Ngay').setStyle(ButtonStyle.Link).setURL(order.payment_checkout_url)
    );
  }
  actionRow.addComponents(
    new ButtonBuilder().setCustomId(`queue:view:${order.order_code}`).setLabel('📍 Xem Hàng Chờ').setStyle(ButtonStyle.Secondary)
  );

  const messagePayload = {
    content: `<@${order.customer_id}>`,
    embeds: [embed],
    files: imageBuffer ? [new AttachmentBuilder(imageBuffer, { name: attachmentName })] : [],
    components: actionRow.components.length ? [actionRow] : [],
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

  const guild = await client.guilds.fetch(updated.guild_id).catch(() => null);
  if (guild) {
    await updateOrderLogMessage(guild, updated);
    await sendPaymentConfirmedFlow({
      guild,
      order: updated,
      amount: updated.amount_paid,
      transactionContent,
    });
    await applyCustomerRoles(guild, updated.customer_id);
    await emitStaffLog(client, { guildId: updated.guild_id, targetId: updated.customer_id, action: 'PAYMENT_CONFIRMED', detail: transactionContent, relatedOrderCode: updated.order_code });
  }

  syncCustomerStats(updated.guild_id, updated.customer_id);
  return { updated, duplicate: false };
}

export async function handlePayOSWebhook({ client, body }) {
  const payload = normalizePayOSWebhookBody(body);

  const payosOrderCode = Number(payload.data.orderCode);
  
  // 1. Kiểm tra xem có phải đơn NẠP TIỀN ví không
  if (Number.isFinite(payosOrderCode)) {
    const topup = getTopupByPayOSCode(payosOrderCode);
    if (topup) {
      const resultCode = String(payload.data.code ?? payload.code ?? '').trim();
      const isSuccess = payload.success === true || (payload.success === null && resultCode === '00');
      
      if (isSuccess && resultCode === '00' && Number(payload.data.amount ?? 0) >= topup.amount) {
        finalizeTopup(topup.topup_code);
        return { ok: true, status: 200, body: { ok: true, message: 'Topup confirmed', topup_code: topup.topup_code } };
      }
      return { ok: true, status: 200, body: { ok: true, message: 'Ignored non-success topup' } };
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

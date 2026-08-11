import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { config, getBinancePayCancelUrl, getBinancePayReturnUrl, getBinancePayWebhookUrl } from '../config.js';
import { db, nowIso } from '../database/db.js';
import { getOrderByCode, savePaymentLinkData, savePaymentMessage } from './orderService.js';
import { finalizePaidOrder } from './paymentService.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { translateProductName } from '../utils/internationalCatalog.js';

const CERTIFICATE_CACHE_MS = 6 * 60 * 60 * 1000;
let certificateCache = { expiresAt: 0, values: new Map() };

function randomNonce() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.randomBytes(32);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join('');
}

export function signBinancePayload({ timestamp, nonce, body, secretKey = config.binancePaySecretKey }) {
  const payload = `${timestamp}\n${nonce}\n${body}\n`;
  return crypto.createHmac('sha512', secretKey).update(payload).digest('hex').toUpperCase();
}

function authenticatedHeaders(body) {
  const timestamp = String(Date.now());
  const nonce = randomNonce();
  return {
    'Content-Type': 'application/json',
    'BinancePay-Timestamp': timestamp,
    'BinancePay-Nonce': nonce,
    'BinancePay-Certificate-SN': config.binancePayApiKey,
    'BinancePay-Signature': signBinancePayload({ timestamp, nonce, body }),
  };
}

async function callBinancePay(path, payload = {}) {
  if (!config.binancePayEnabled || !config.binancePayApiKey || !config.binancePaySecretKey) {
    throw new Error('Binance Pay is not active. Configure the Merchant API identity and secret first.');
  }
  const body = JSON.stringify(payload);
  const response = await fetch(`${config.binancePayApiBase.replace(/\/$/, '')}${path}`, {
    method: 'POST',
    headers: authenticatedHeaders(body),
    body,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.status !== 'SUCCESS') {
    throw new Error(result?.errorMessage || result?.code || `Binance Pay HTTP ${response.status}`);
  }
  return result.data;
}

function normalizePublicKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.includes('BEGIN PUBLIC KEY')) return raw;
  const lines = raw.replace(/\s+/g, '').match(/.{1,64}/g) || [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

async function loadCertificates() {
  if (certificateCache.expiresAt > Date.now() && certificateCache.values.size) return certificateCache.values;
  const result = await callBinancePay('/binancepay/openapi/certificates', {});
  const rows = Array.isArray(result) ? result : (Array.isArray(result?.certificates) ? result.certificates : []);
  const values = new Map();
  for (const row of rows) {
    const serial = String(row.certSerial || row.certSerialNo || '').trim();
    const publicKey = normalizePublicKey(row.certPublic);
    if (serial && publicKey) values.set(serial, publicKey);
  }
  if (!values.size) throw new Error('Binance Pay returned no webhook verification certificates.');
  certificateCache = { expiresAt: Date.now() + CERTIFICATE_CACHE_MS, values };
  return values;
}

export async function verifyBinanceWebhook({ headers, rawBody }) {
  const serial = String(headers['binancepay-certificate-sn'] || '').trim();
  const nonce = String(headers['binancepay-nonce'] || '').trim();
  const timestamp = String(headers['binancepay-timestamp'] || '').trim();
  const signature = String(headers['binancepay-signature'] || '').trim();
  if (!serial || !nonce || !timestamp || !signature || !rawBody) return false;
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 10 * 60 * 1000) return false;

  let certificates = await loadCertificates();
  let publicKey = certificates.get(serial);
  if (!publicKey) {
    certificateCache.expiresAt = 0;
    certificates = await loadCertificates();
    publicKey = certificates.get(serial);
  }
  if (!publicKey) return false;
  const payload = `${timestamp}\n${nonce}\n${rawBody}\n`;
  return crypto.verify('RSA-SHA256', Buffer.from(payload, 'utf8'), publicKey, Buffer.from(signature, 'base64'));
}

function cryptoAmountForOrder(order) {
  const amount = Number(order.total_amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('The order amount is invalid.');
  if (config.storePriceSourceCurrency === 'VND') {
    if (!Number.isFinite(config.storeVndPerUsd) || config.storeVndPerUsd <= 0) {
      throw new Error('STORE_VND_PER_USD must be configured before accepting international payments.');
    }
    return Number((amount / config.storeVndPerUsd).toFixed(2));
  }
  return Number(amount.toFixed(8));
}

function safeGoodsName(value) {
  return String(value || 'Cenar Global digital service')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/<a?:[A-Za-z0-9_]+:\d+>/g, '')
    .replace(/[^A-Za-z0-9 .()_-]/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 120) || 'Cenar Global digital service';
}

function merchantTradeNo(orderCode) {
  const base = String(orderCode || 'ORDER').replace(/[^A-Za-z0-9]/g, '').slice(0, 22);
  return `${base}${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`.slice(0, 32);
}

export async function createBinancePayOrder(order) {
  const returnUrl = getBinancePayReturnUrl();
  const cancelUrl = getBinancePayCancelUrl();
  const webhookUrl = getBinancePayWebhookUrl();
  if (!returnUrl || !cancelUrl || !webhookUrl) throw new Error('PUBLIC_BASE_URL is required for Binance Pay callbacks.');
  const amount = cryptoAmountForOrder(order);
  const currency = config.binancePayCurrency;
  const goodsName = safeGoodsName(order.product_name);
  const tradeNo = merchantTradeNo(order.order_code);
  const result = await callBinancePay('/binancepay/openapi/v3/order', {
    env: { terminalType: 'WEB' },
    merchantTradeNo: tradeNo,
    orderAmount: amount,
    currency,
    supportPayCurrency: config.binancePayCurrencies.join(','),
    description: goodsName,
    goodsDetails: [{
      goodsType: '02',
      goodsCategory: 'Z000',
      referenceGoodsId: String(order.product_id || order.order_code).replace(/[^A-Za-z0-9]/g, '').slice(0, 64),
      goodsName,
    }],
    returnUrl,
    cancelUrl,
    webhookUrl,
    orderExpireTime: Date.now() + Math.max(1, config.binancePayExpireMinutes) * 60_000,
    passThroughInfo: order.order_code,
  });
  return { ...result, merchantTradeNo: tradeNo, cryptoAmount: amount, currency };
}

function buildBinancePaymentPayload(order, checkout) {
  const E = createEmojiResolver(order.guild_id);
  const container = new ContainerBuilder().setAccentColor(0xF3BA2F);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('payment_money')} BINANCE PAY • SECURE CRYPTO CHECKOUT`,
    `> ${E('cenar_verified')} This invoice is linked to your Cenar Global order and will be confirmed automatically.`,
    '',
    `${E('order_id')} **Order:** \`${order.order_code}\``,
    `${E('order_product')} **Product:** ${translateProductName(order.product_name)}`,
    `${E('payment_money')} **Amount:** \`${checkout.cryptoAmount} ${checkout.currency}\``,
    `${E('icon_clock')} **Expires:** <t:${Math.floor(Number(checkout.expireTime) / 1000)}:R>`,
    '',
    `${E('status_warn')} Pay only through the official checkout button below. Staff will never request your Binance password, seed phrase or 2FA code.`,
    `-# ${E('cenar_support')} Payment status is updated only after a signed Binance webhook is verified.`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const pay = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open Binance Pay').setURL(checkout.checkoutUrl || checkout.universalUrl);
  const payEmoji = E.component('payment_money');
  if (payEmoji) pay.setEmoji(payEmoji);
  return {
    components: [container, new ActionRowBuilder().addComponents(pay)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export async function sendOrRefreshBinancePay({ guild, orderCode }) {
  if (!config.binancePayEnabled) throw new Error('Binance Pay is not enabled for this store yet.');
  let order = getOrderByCode(orderCode);
  if (!order || order.guild_id !== guild.id) throw new Error('Order not found.');
  if (order.payment_status === 'PAID') throw new Error('This order has already been paid.');

  let checkout;
  if (order.payment_provider === 'BINANCE_PAY' && order.payment_link_id && order.payment_checkout_url) {
    checkout = {
      prepayId: order.payment_link_id,
      checkoutUrl: order.payment_checkout_url,
      expireTime: new Date(order.payment_expired_at).getTime(),
      cryptoAmount: cryptoAmountForOrder(order),
      currency: config.binancePayCurrency,
    };
  } else {
    db.prepare(`UPDATE orders SET payment_provider = 'BINANCE_PAY', payment_link_id = NULL,
      payment_merchant_trade_no = NULL,
      payment_checkout_url = NULL, payment_qr_code = NULL, payment_qr_url = NULL,
      payment_qr_text = NULL, payment_expired_at = NULL, updated_at = ? WHERE order_code = ?`)
      .run(nowIso(), order.order_code);
    checkout = await createBinancePayOrder(order);
    db.prepare('UPDATE orders SET payment_merchant_trade_no = ?, updated_at = ? WHERE order_code = ?')
      .run(checkout.merchantTradeNo, nowIso(), order.order_code);
    order = savePaymentLinkData(order.order_code, {
      paymentLinkId: checkout.prepayId,
      checkoutUrl: checkout.checkoutUrl || checkout.universalUrl,
      qrCode: checkout.qrContent || null,
      qrUrl: checkout.qrcodeLink || null,
      qrText: `${checkout.cryptoAmount} ${checkout.currency}`,
      expiredAt: new Date(Number(checkout.expireTime)).toISOString(),
    });
  }

  const ticketChannel = await guild.channels.fetch(order.ticket_channel_id).catch(() => null);
  if (!ticketChannel?.isTextBased()) throw new Error('The order ticket is unavailable.');
  const payload = buildBinancePaymentPayload(order, checkout);
  let message = order.payment_message_id ? await ticketChannel.messages.fetch(order.payment_message_id).catch(() => null) : null;
  message = message ? await message.edit(payload) : await ticketChannel.send(payload);
  savePaymentMessage(order.order_code, message.id);
  return { order: getOrderByCode(order.order_code), checkout };
}

function parseWebhookData(body) {
  if (typeof body?.data === 'string') {
    try { return JSON.parse(body.data); } catch { return {}; }
  }
  return body?.data && typeof body.data === 'object' ? body.data : {};
}

export async function handleBinancePayWebhook({ client, headers, rawBody, body }) {
  if (!config.binancePayEnabled) return { status: 503, body: { returnCode: 'FAIL', returnMessage: 'Binance Pay disabled' } };
  const verified = await verifyBinanceWebhook({ headers, rawBody });
  if (!verified) return { status: 400, body: { returnCode: 'FAIL', returnMessage: 'Invalid signature' } };

  const data = parseWebhookData(body);
  const state = String(body?.bizStatus || data.bizStatus || data.status || '').toUpperCase();
  if (!['PAY_SUCCESS', 'PAID', 'SUCCESS'].includes(state)) {
    return { status: 200, body: { returnCode: 'SUCCESS', returnMessage: null } };
  }
  const prepayId = String(data.prepayId || body?.bizId || '').trim();
  let order = prepayId ? db.prepare('SELECT * FROM orders WHERE payment_provider = ? AND payment_link_id = ? LIMIT 1').get('BINANCE_PAY', prepayId) : null;
  const merchantTradeNo = String(data.merchantTradeNo || data.merchantTradeNO || '').trim();
  if (!order && merchantTradeNo) {
    order = db.prepare('SELECT * FROM orders WHERE payment_provider = ? AND payment_merchant_trade_no = ? LIMIT 1')
      .get('BINANCE_PAY', merchantTradeNo);
  }
  if (!order && data.passThroughInfo) order = getOrderByCode(String(data.passThroughInfo));
  if (!order) return { status: 200, body: { returnCode: 'SUCCESS', returnMessage: null } };

  const paidCurrency = String(data.currency || data.orderCurrency || config.binancePayCurrency).toUpperCase();
  const paidCrypto = Number(data.totalFee ?? data.orderAmount ?? data.amount ?? 0);
  const expectedCrypto = cryptoAmountForOrder(order);
  if (!config.binancePayCurrencies.includes(paidCurrency) || !Number.isFinite(paidCrypto) || paidCrypto + 1e-8 < expectedCrypto) {
    console.warn(`[BINANCE-PAY] Rejected amount/currency for ${order.order_code}: ${paidCrypto} ${paidCurrency}`);
    return { status: 200, body: { returnCode: 'SUCCESS', returnMessage: null } };
  }

  const transactionId = String(data.transactionId || data.prepayId || body?.bizId || `BINANCE_${order.order_code}`);
  await finalizePaidOrder(
    client,
    order,
    { amount: order.total_amount, cryptoAmount: paidCrypto, cryptoCurrency: paidCurrency, raw: data },
    transactionId,
    `BINANCE ${paidCrypto} ${paidCurrency}`,
    'BINANCE_PAY',
  );
  return { status: 200, body: { returnCode: 'SUCCESS', returnMessage: null } };
}

export const binancePayInternals = { cryptoAmountForOrder, safeGoodsName, merchantTradeNo, normalizePublicKey, parseWebhookData };

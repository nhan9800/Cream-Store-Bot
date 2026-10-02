import { db, nowIso } from '../database/db.js';
import { randomDigits } from '../utils/id.js';
import { getGuildConfig, upsertGuildConfig } from './guildConfigService.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import {
  BOOST_PRESENTATION_COLORS, BOOST_PRESENTATION_VERSION, BOOST_SILENT_MENTIONS, boostPresentationPanel,
} from './boostPresentationService.js';

// ─── Constants ────────────────────────────────────────────────────────────────

export const BOOST_PACKAGES = [
  { key: '1m', label: '14x Boost Server · 1 Tháng', price: 120000, months: 1, availability: 'Có liền' },
  { key: '3m', label: '14x Boost Server · 3 Tháng', price: 320000, months: 3, availability: 'Có liền' },
];

const STORE_ONE_BOOST_PANEL = Object.freeze({
  channelId: '1524080488233435336',
  messageId: '1524080492968935487',
});

// ─── DB helpers ───────────────────────────────────────────────────────────────

function generateOrderCode() {
  return `BST_${randomDigits(6)}`;
}

function generatePayOSOrderCode() {
  // Tách riêng namespace Boost khỏi đơn CN_ 6 số và đơn nạp ví.
  return 8_000_000_000_000 + Number(randomDigits(8));
}

function payosCodeExists(code) {
  return Boolean(
    db.prepare('SELECT 1 FROM boost_server_orders WHERE payos_order_code = ?').get(code)
    || db.prepare('SELECT 1 FROM orders WHERE payos_order_code = ?').get(code)
    || db.prepare('SELECT 1 FROM wallet_topup_orders WHERE payos_order_code = ?').get(code)
  );
}

export function getBoostPackage(packageKey) {
  return BOOST_PACKAGES.find(item => item.key === String(packageKey || '').toLowerCase()) ?? null;
}

export function createBoostOrder({ guildId, customerId, customerTag, serverLink, serverId, serverName, packageKey, pkg, durationMonths }) {
  const selectedPackage = getBoostPackage(packageKey)
    || BOOST_PACKAGES.find(item => item.label === pkg || item.months === Number(durationMonths));
  if (!selectedPackage) throw new Error('Gói Boost Server không hợp lệ.');

  let code = null;
  for (let i = 0; i < 25; i++) {
    code = generateOrderCode();
    const exists = db.prepare('SELECT 1 FROM boost_server_orders WHERE order_code = ?').get(code);
    if (!exists) break;
    code = null;
  }
  if (!code) throw new Error('Không thể cấp mã đơn Boost Server. Vui lòng thử lại.');

  let payosOrderCode = null;
  for (let i = 0; i < 25; i++) {
    const candidate = generatePayOSOrderCode();
    if (!payosCodeExists(candidate)) {
      payosOrderCode = candidate;
      break;
    }
  }
  if (!payosOrderCode) throw new Error('Không thể cấp mã thanh toán PayOS. Vui lòng thử lại.');

  const now = nowIso();
  db.prepare(`
    INSERT INTO boost_server_orders
      (order_code, guild_id, customer_id, customer_tag, server_link, server_id, server_name,
       package, duration_months, amount, status, payment_status, payos_order_code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 'PENDING', ?, ?, ?)
  `).run(code, guildId, customerId, customerTag ?? null, serverLink, serverId, serverName ?? null,
         selectedPackage.label, selectedPackage.months, selectedPackage.price, payosOrderCode, now, now);

  return getBoostOrderByCode(code);
}

export function getBoostOrderByCode(code) {
  return db.prepare('SELECT * FROM boost_server_orders WHERE order_code = ?').get(code?.toUpperCase?.() ?? code);
}

export function getBoostOrderByPayOSCode(payosCode) {
  return db.prepare('SELECT * FROM boost_server_orders WHERE payos_order_code = ?').get(Number(payosCode));
}

function normalizeAccessKey(key) {
  return String(key || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashAccessKey(key) {
  return crypto.createHash('sha256').update(normalizeAccessKey(key)).digest('hex');
}

function generateAccessKey() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let value = '';
  for (let i = 0; i < 12; i++) value += alphabet[crypto.randomInt(0, alphabet.length)];
  return `BST-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}`;
}

function protectAccessKey(key) {
  try {
    return encrypt(key);
  } catch (error) {
    console.warn('[BOOST KEY] ENCRYPTION_KEY chưa sẵn sàng; dùng lớp tương thích cục bộ:', error.message);
    return `compat:v1:${Buffer.from(key, 'utf8').toString('base64')}`;
  }
}

function revealAccessKey(value) {
  if (!value) return null;
  if (String(value).startsWith('compat:v1:')) {
    return Buffer.from(String(value).slice('compat:v1:'.length), 'base64').toString('utf8');
  }
  const revealed = decrypt(value);
  return revealed && !String(revealed).startsWith('enc:v1:') ? String(revealed) : null;
}

export function ensureBoostAccessKey(code) {
  let order = getBoostOrderByCode(code);
  if (!order) throw new Error(`Không tìm thấy đơn boost ${code}`);
  if (order.payment_status !== 'PAID') throw new Error('Đơn Boost Server chưa thanh toán.');

  const existingKey = revealAccessKey(order.access_key_encrypted);
  if (existingKey) return { order, accessKey: existingKey, created: false };

  for (let attempt = 0; attempt < 20; attempt++) {
    const accessKey = generateAccessKey();
    const keyHash = hashAccessKey(accessKey);
    try {
      db.prepare(`
        UPDATE boost_server_orders
        SET access_key_hash = ?, access_key_encrypted = ?, access_key_issued_at = ?, updated_at = ?
        WHERE order_code = ? AND access_key_hash IS NULL
      `).run(keyHash, protectAccessKey(accessKey), nowIso(), nowIso(), order.order_code);
      order = getBoostOrderByCode(order.order_code);
      const storedKey = revealAccessKey(order.access_key_encrypted);
      if (storedKey) return { order, accessKey: storedKey, created: storedKey === accessKey };
    } catch (error) {
      if (!/UNIQUE constraint failed/i.test(error.message)) throw error;
    }
  }
  throw new Error('Không thể cấp key tra cứu Boost Server.');
}

export function getBoostOrderByAccessKey(key) {
  const normalized = normalizeAccessKey(key);
  if (normalized.length < 12) return null;
  return db.prepare('SELECT * FROM boost_server_orders WHERE access_key_hash = ?').get(hashAccessKey(normalized)) ?? null;
}

export function getBoostOrdersByGuild(guildId, status = null) {
  if (status) {
    return db.prepare('SELECT * FROM boost_server_orders WHERE guild_id = ? AND status = ? ORDER BY created_at DESC').all(guildId, status);
  }
  return db.prepare('SELECT * FROM boost_server_orders WHERE guild_id = ? ORDER BY created_at DESC LIMIT 50').all(guildId);
}

export function getActiveBoostOrders(guildId) {
  return db.prepare(`
    SELECT * FROM boost_server_orders
    WHERE guild_id = ? AND status = 'ACTIVE'
    ORDER BY boost_started_at ASC
  `).all(guildId);
}

export function getBoostOrdersByCustomer(guildId, customerId) {
  return db.prepare(`
    SELECT * FROM boost_server_orders
    WHERE guild_id = ? AND customer_id = ?
    ORDER BY created_at DESC LIMIT 10
  `).all(guildId, customerId);
}

export function updateBoostOrderStatus(code, status, extra = {}) {
  const now = nowIso();
  const order = getBoostOrderByCode(code);
  if (!order) throw new Error(`Không tìm thấy đơn boost ${code}`);

  db.prepare(`
    UPDATE boost_server_orders
    SET status = ?,
        payment_status = COALESCE(?, payment_status),
        boost_started_at = COALESCE(?, boost_started_at),
        boost_expires_at = COALESCE(?, boost_expires_at),
        handled_by = COALESCE(?, handled_by),
        note = COALESCE(?, note),
        customer_status_note = COALESCE(?, customer_status_note),
        updated_at = ?
    WHERE order_code = ?
  `).run(
    status,
    extra.paymentStatus ?? null,
    extra.boostStartedAt ?? null,
    extra.boostExpiresAt ?? null,
    extra.handledBy ?? null,
    extra.note ?? null,
    extra.customerStatusNote ?? null,
    now,
    order.order_code,
  );
  return getBoostOrderByCode(order.order_code);
}

export function updateBoostLiveStatus(code, { status, boostExpiresAt, handledBy, customerStatusNote, note } = {}) {
  const order = getBoostOrderByCode(code);
  if (!order) throw new Error(`Không tìm thấy đơn boost ${code}`);
  const nextStatus = String(status || order.status).toUpperCase();
  if (!['PENDING', 'ACTIVE', 'WARRANTY', 'COMPLETED', 'CANCELLED'].includes(nextStatus)) {
    throw new Error('Trạng thái Boost Server không hợp lệ.');
  }
  if (['ACTIVE', 'WARRANTY', 'COMPLETED'].includes(nextStatus) && order.payment_status !== 'PAID') {
    throw new Error('Không thể chuyển trạng thái khi PayOS chưa xác nhận thanh toán.');
  }

  const startedAt = nextStatus === 'ACTIVE' && !order.boost_started_at ? nowIso() : order.boost_started_at;
  db.prepare(`
    UPDATE boost_server_orders
    SET status = ?, boost_started_at = ?, boost_expires_at = COALESCE(?, boost_expires_at),
        handled_by = COALESCE(?, handled_by), customer_status_note = COALESCE(?, customer_status_note),
        note = COALESCE(?, note), updated_at = ?
    WHERE order_code = ?
  `).run(nextStatus, startedAt, boostExpiresAt ?? null, handledBy ?? null,
    customerStatusNote ?? null, note ?? null, nowIso(), order.order_code);
  return getBoostOrderByCode(order.order_code);
}

export function saveBoostPaymentLink(code, { checkoutUrl, paymentLinkId, qrCode }) {
  db.prepare(`
    UPDATE boost_server_orders
    SET payment_checkout_url = ?, payment_link_id = ?, payment_qr_code = ?, updated_at = ?
    WHERE order_code = ?
  `).run(checkoutUrl ?? null, paymentLinkId ?? null, qrCode ?? null, nowIso(), code);
}

// ─── PayOS Integration ────────────────────────────────────────────────────────

export async function createBoostPayOSLink(order) {
  const { config: cfg, assertPaymentConfig } = await import('../config.js');
  assertPaymentConfig();

  // Cache hit — đã có link rồi
  if (order.payment_checkout_url && order.payment_link_id) {
    return { checkoutUrl: order.payment_checkout_url, qrCode: order.payment_qr_code ?? null };
  }

  const { createHmac } = await import('node:crypto');

  const orderCode  = Number(order.payos_order_code);
  const amount     = Number(order.amount);
  const description = order.order_code; // max 25 chars — "BST_123456" = 10 chars ✓
  const baseUrl = String(cfg.publicBaseUrl || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error('Thiếu PUBLIC_BASE_URL để tạo thanh toán PayOS.');
  const returnUrl  = baseUrl + '/payments/payos/return';
  const cancelUrl  = baseUrl + '/payments/payos/cancel';
  const expiredAt  = Math.floor(Date.now() / 1000) + 60 * 60; // 1 giờ

  const sigData = `amount=${amount}&cancelUrl=${cancelUrl}&description=${description}&orderCode=${orderCode}&returnUrl=${returnUrl}`;
  const signature = createHmac('sha256', cfg.payosChecksumKey).update(sigData).digest('hex');

  const body = {
    orderCode,
    amount,
    description,
    items: [{ name: order.package.slice(0, 25), quantity: 1, price: amount }],
    cancelUrl,
    returnUrl,
    expiredAt,
    signature,
  };

  const res = await fetch('https://api-merchant.payos.vn/v2/payment-requests', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': cfg.payosClientId,
      'x-api-key': cfg.payosApiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || data?.code !== '00') throw new Error(data?.desc || `PayOS API trả về HTTP ${res.status}`);

  const checkoutUrl   = data.data?.checkoutUrl;
  const paymentLinkId = data.data?.paymentLinkId ?? data.data?.id;
  const qrCode        = data.data?.qrCode ?? null; // chuỗi EMVCo thật để render QR hợp lệ
  if (!checkoutUrl || !paymentLinkId) throw new Error('PayOS không trả về đường dẫn thanh toán hợp lệ.');
  saveBoostPaymentLink(order.order_code, { checkoutUrl, paymentLinkId, qrCode });

  return { checkoutUrl, qrCode };
}

// ─── Webhook: tự động xác nhận khi PayOS báo thanh toán thành công ────────────

export async function handleBoostPayOSWebhook({ client, payosOrderCode, amount, reference, description }) {
  const order = getBoostOrderByPayOSCode(payosOrderCode);
  if (!order) return null; // không phải đơn boost

  if (order.payment_status === 'PAID' && order.access_key_hash) return order;

  if (order.payment_status !== 'PAID' && Number(amount) < Number(order.amount)) return null; // số tiền không đủ

  // Đánh dấu đã thanh toán — giữ status PENDING để admin kích hoạt boost
  let updated = order.payment_status === 'PAID'
    ? order
    : updateBoostOrderStatus(order.order_code, 'PENDING', {
      paymentStatus: 'PAID',
      note: `Thanh toán PayOS: ${reference ?? description ?? ''}`,
      customerStatusNote: 'PayOS đã xác nhận thanh toán. Đơn đang trong hàng đợi xử lý 14 Boosts.',
    });
  const issued = ensureBoostAccessKey(updated.order_code);
  updated = issued.order;

  // Gửi thông báo vào kênh log để admin biết cần boost
  await sendBoostLog(client, order.guild_id, updated, 'PayOS đã xác nhận — đơn chờ xử lý', null).catch(error => {
    console.error('[BOOST WEBHOOK] Không thể gửi log:', error.message);
  });

  // DM khách báo đã nhận tiền
  try {
    const user = await client.users.fetch(order.customer_id);
    await user.send(buildBoostOrderDetailPayload(updated, false, {
      guildId: order.guild_id, heading: 'THANH TOÁN BOOST THÀNH CÔNG', accessKey: issued.accessKey, includeActions: false,
    }));
  } catch (error) {
    console.warn('[BOOST WEBHOOK] Không thể DM key cho khách:', error.message);
  }

  // Refresh panel
  refreshBoostPanel(client, order.guild_id).catch(() => null);

  return updated;
}

// ─── DM Payment — gửi link PayOS kèm nút bấm ────────────────────────────────

export function isBoostPaymentClosed(order) {
  return ['CANCELLED', 'REFUNDED'].includes(order?.status) || order?.payment_status === 'REFUNDED';
}

export async function createBoostPaymentPayload(order, guildId) {
  if (isBoostPaymentClosed(order)) throw new Error('Đơn Boost đã huỷ hoặc hoàn tiền; không thể tạo thanh toán.');
  const E = createEmojiResolver(guildId ?? order.guild_id);
  const amountFmt = Number(order.amount).toLocaleString('vi-VN');

  let checkoutUrl = order.payment_checkout_url;
  let qrCodeStr   = order.payment_qr_code ?? null; // chuỗi EMVCo từ PayOS

  // Tạo link PayOS nếu chưa có
  if (!checkoutUrl) {
    const result = await createBoostPayOSLink(order);
    checkoutUrl = result.checkoutUrl;
    qrCodeStr   = result.qrCode ?? null;
    const fresh = getBoostOrderByCode(order.order_code);
    checkoutUrl = fresh?.payment_checkout_url ?? checkoutUrl;
    qrCodeStr   = fresh?.payment_qr_code ?? qrCodeStr;
  }

  const qrData = qrCodeStr || checkoutUrl;
  if (!qrData || !checkoutUrl) throw new Error('Không thể tạo mã QR PayOS cho đơn Boost Server.');
  const attachmentName = `boost-payos-${order.order_code}.png`;
  const qrBuffer = await QRCode.toBuffer(qrData, {
    type: 'png', width: 720, margin: 2,
    color: { dark: '#111827', light: '#FFFFFFFF' },
  });

  const overview = boostPresentationPanel(BOOST_PRESENTATION_COLORS.teal, [
    `# ${E('brand_boost')} THANH TOÁN BOOST SERVER\n${E('order_id')} **Đơn \`${order.order_code}\`**`,
    `${E('order_product')} **${order.package}**\n${E('payment_money')} **Tổng thanh toán: ${amountFmt}đ**\n${E('status_warn')} Chờ PayOS xác nhận thanh toán`,
  ]);
  const server = boostPresentationPanel(BOOST_PRESENTATION_COLORS.teal, [
    `### ${E('icon_store')} Kiểm tra máy chủ nhận Boost\n${boostServerSummary(order, E)}`,
  ]);
  const payment = boostPresentationPanel(BOOST_PRESENTATION_COLORS.copper, [
    `### ${E('payment_qr')} Quét mã để thanh toán\nKiểm tra đúng số tiền và nội dung đơn trước khi xác nhận chuyển khoản.`,
  ]);
  payment.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
    new MediaGalleryItemBuilder().setURL(`attachment://${attachmentName}`).setDescription(`QR PayOS thanh toán đơn ${order.order_code}, số tiền ${amountFmt} đồng.`),
  ));
  payment.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# PayOS xác nhận thành công, bot gửi key tra cứu qua DM. QR có hiệu lực 60 phút từ lúc tạo.`,
  ));

  const payButton = withButtonEmoji(
    new ButtonBuilder().setLabel('Thanh Toán PayOS').setStyle(ButtonStyle.Link).setURL(checkoutUrl),
    E.component('payment_payos'),
  );
  payment.addActionRowComponents(new ActionRowBuilder().addComponents(payButton));
  const components = [overview, server, payment];
  return {
    components,
    files: [new AttachmentBuilder(qrBuffer, { name: attachmentName })],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: BOOST_SILENT_MENTIONS,
  };
}

export async function sendBoostPaymentDM(dmChannel, order, guildId) {
  const payload = await createBoostPaymentPayload(order, guildId);
  return dmChannel.send(payload);
}

// ─── Panel builder — Components V2 ───────────────────────────────────────────

export function buildBoostPanelEmbed(guildId) {
  const E = createEmojiResolver(guildId ?? '');
  const activeOrders = getActiveBoostOrders(guildId);

  const embed = new EmbedBuilder()
    .setColor(0xEB459E)
    .setTitle('HỆ THỐNG BOOST SERVER LEVEL 3')
    .setDescription([
      `${E('brand_boost')} **14x Boosts · loại có liền**`,
      `${E('payment_payos')} PayOS tự xác nhận và cấp key tra cứu live.`,
      '',
      `${E('icon_price')} **1 Tháng:** **120.000 VND**`,
      `${E('icon_price')} **3 Tháng:** **320.000 VND**`,
      '',
      `${E('status_info')} Chọn gói, quét QR, nhận key rồi nhập key để theo dõi tiến độ.`,
    ].join('\n'));

  const liveSection = buildLiveListSection(activeOrders, guildId, { maxChars: 900 });
  embed.addFields({
    name: `${E('status_loading')} Server Đang Boost Live (${activeOrders.length})`,
    value: liveSection || 'Chưa có server nào đang boost.',
  });
  embed.setFooter({ text: 'Cenar Store · PayOS xác nhận tự động · vận hành theo hàng đợi' });
  embed.setTimestamp();

  return embed;
}

function buildLiveListSection(activeOrders, guildId = '', { maxChars = 1600 } = {}) {
  const E = createEmojiResolver(guildId);
  if (!activeOrders.length) {
    return `${E('status_info')} Chưa có máy chủ đang hoạt động trong danh sách.`;
  }
  const lines = [];
  for (const [i, o] of activeOrders.slice(0, 15).entries()) {
    const expiry = o.boost_expires_at
      ? `<t:${Math.floor(new Date(o.boost_expires_at).getTime() / 1000)}:R>`
      : 'Đang boost';
    const name = o.server_name ? `**${o.server_name}**` : `\`${o.server_id}\``;
    const line = `${E(o.status === 'WARRANTY' ? 'warranty_shield' : 'status_check')} **${i + 1}.** ${name} · ${o.status === 'WARRANTY' ? 'Đang bảo hành' : expiry}`;
    if ([...lines, line].join('\n').length > maxChars) break;
    lines.push(line);
  }
  if (lines.length < activeOrders.length) lines.push(`-# Hiển thị ${lines.length}/${activeOrders.length} đơn đang theo dõi.`);
  return lines.join('\n');
}

export function buildBoostPanelPayload(guildId, { activeOrders = getActiveBoostOrders(guildId) } = {}) {
  const E = createEmojiResolver(guildId ?? '');
  return {
    components: [
      boostPresentationPanel(BOOST_PRESENTATION_COLORS.teal, [
        `# ${E('brand_boost')} BOOST SERVER LEVEL 3\n**14 Boosts · Theo dõi bằng key riêng**`,
        'Chọn thời hạn cho máy chủ của bạn. Thanh toán qua PayOS và nhận key theo dõi sau khi giao dịch được xác nhận.',
      ]),
      boostPresentationPanel(BOOST_PRESENTATION_COLORS.copper, [
        `### ${E('icon_price')} Gói Boost chính thức\n${BOOST_PACKAGES.map((pkg) => `${E('icon_duration')} **${pkg.months} tháng · 14 Boosts**\n**${Number(pkg.price).toLocaleString('vi-VN')}đ** · ${pkg.availability}`).join('\n\n')}`,
        `${E('payment_qr')} **Đặt gói → Kiểm tra server → Thanh toán QR**\n${E('icon_key')} Key được gửi qua DM. Nhập key tại đây để xem trạng thái và gửi yêu cầu bảo hành.`,
      ]),
      boostPresentationPanel(BOOST_PRESENTATION_COLORS.teal, [
        `### ${E('status_loading')} Đơn Boost đang theo dõi · ${activeOrders.length}\n${buildLiveListSection(activeOrders, guildId)}`,
        '-# Trạng thái được cập nhật theo từng đơn bởi đội ngũ Cenar Store.',
      ]),
      ...buildBoostPanelRows(guildId),
    ],
    flags: MessageFlags.IsComponentsV2, allowedMentions: BOOST_SILENT_MENTIONS,
  };
}

export function buildBoostPackagePickerPayload(guildId) {
  const E = createEmojiResolver(guildId ?? '');
  const container = new ContainerBuilder().setAccentColor(BOOST_PRESENTATION_COLORS.teal);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('brand_boost')} CHỌN THỜI HẠN BOOST`,
    `${E('status_check')} Cả hai gói đều là **loại có liền**. Giá được khóa theo nút bạn chọn.`,
    '',
    `> ${E('icon_duration')} **1 Tháng:** 120.000 VND`,
    `> ${E('icon_duration')} **3 Tháng:** 320.000 VND`,
  ].join('\n')));

  const oneMonth = withButtonEmoji(
    new ButtonBuilder().setCustomId('boost:buy:1m').setLabel('1 Tháng · 120K').setStyle(ButtonStyle.Primary),
    E.component('brand_boost'),
  );
  const threeMonths = withButtonEmoji(
    new ButtonBuilder().setCustomId('boost:buy:3m').setLabel('3 Tháng · 320K').setStyle(ButtonStyle.Success),
    E.component('icon_duration'),
  );
  return {
    components: [container, new ActionRowBuilder().addComponents(oneMonth, threeMonths)],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}

export function buildBoostPanelRows(guildId) {
  const E = createEmojiResolver(guildId ?? '');

  const buyBtn = new ButtonBuilder()
    .setCustomId('boost:buy')
    .setLabel('Mua Boost Server')
    .setStyle(ButtonStyle.Primary);
  const buyEmo = E.component('brand_boost');
  if (buyEmo) buyBtn.setEmoji(buyEmo);

  const checkBtn = new ButtonBuilder()
    .setCustomId('boost:key')
    .setLabel('Nhập Key / Xem Live')
    .setStyle(ButtonStyle.Secondary);
  const checkEmo = E.component('icon_key');
  if (checkEmo) checkBtn.setEmoji(checkEmo);

  const recoverBtn = new ButtonBuilder()
    .setCustomId('boost:check')
    .setLabel('Đơn Của Tôi')
    .setStyle(ButtonStyle.Secondary);
  const recoverEmo = E.component('order_id');
  if (recoverEmo) recoverBtn.setEmoji(recoverEmo);

  const warrantyBtn = new ButtonBuilder()
    .setCustomId('boost:warranty')
    .setLabel('Báo Cáo Bảo Hành')
    .setStyle(ButtonStyle.Danger);
  const warEmo = E.component('ticket_claim');
  if (warEmo) warrantyBtn.setEmoji(warEmo);

  return [new ActionRowBuilder().addComponents(buyBtn, checkBtn, recoverBtn, warrantyBtn)];
}

function boostStatusMeta(order, guildId) {
  const E = createEmojiResolver(guildId ?? order.guild_id ?? '');
  if (order.status === 'ACTIVE') return { label: `${E('status_check')} Đang Boost Live`, color: 0x57F287, step: '3/3' };
  if (order.status === 'WARRANTY') return { label: `${E('warranty_shield')} Đang bảo hành`, color: 0x5865F2, step: '3/3' };
  if (order.status === 'COMPLETED') return { label: `${E('order_complete')} Đã hoàn thành`, color: 0x95A5A6, step: '3/3' };
  if (order.status === 'CANCELLED') return { label: `${E('status_cross')} Đã huỷ`, color: 0xED4245, step: '0/3' };
  if (order.status === 'REFUNDED') return { label: `${E('payment_refund')} Đã hoàn tiền`, color: 0x95A5A6, step: '0/3' };
  if (order.payment_status === 'PAID') return { label: `${E('order_queue')} Đã thanh toán · đang xử lý`, color: 0xFEE75C, step: '2/3' };
  return { label: `${E('status_warn')} Chờ thanh toán`, color: 0xFEE75C, step: '1/3' };
}

function discordTime(value, style = 'F') {
  const millis = new Date(value).getTime();
  return Number.isFinite(millis) ? `<t:${Math.floor(millis / 1000)}:${style}>` : 'Chưa cập nhật';
}

export function buildBoostLiveStatusPayload(order, guildId, { isStaff = false, accessKey = null } = {}) {
  const E = createEmojiResolver(guildId ?? order.guild_id ?? '');
  const payload = buildBoostOrderDetailPayload(order, isStaff, {
    guildId, heading: 'BOOST SERVER · TRẠNG THÁI ĐƠN', accessKey, includeActions: false,
  });
  const row = new ActionRowBuilder().addComponents(withButtonEmoji(
    new ButtonBuilder().setCustomId(`boost:live:${order.order_code}`).setLabel('Làm Mới Trạng Thái').setStyle(ButtonStyle.Primary),
    E.component('status_loading'),
  ));
  if (order.status === 'ACTIVE') row.addComponents(withButtonEmoji(
    new ButtonBuilder().setCustomId(`boost:warranty_req:${order.order_code}`).setLabel('Yêu Cầu Bảo Hành').setStyle(ButtonStyle.Secondary),
    E.component('warranty_shield'),
  ));
  if (isStaff) row.addComponents(withButtonEmoji(
    new ButtonBuilder().setCustomId(`boost:manage:${order.order_code}`).setLabel('Cập Nhật Live').setStyle(ButtonStyle.Success),
    E.component('icon_settings'),
  ));
  payload.components.push(row);
  return payload;
}

// ─── Order detail embed ───────────────────────────────────────────────────────

function boostServerSummary(order, E) {
  return [
    order.server_name ? `**${order.server_name}**` : null,
    `${E('icon_store')} Server ID: \`${order.server_id}\``,
    order.server_link ? `[Vào máy chủ](${order.server_link})` : null,
  ].filter(Boolean).join('\n');
}

export function buildBoostOrderDetailPayload(order, isStaff = false, {
  guildId = order.guild_id, heading = 'ĐƠN BOOST SERVER', accessKey = null, includeActions = true, extraText = null,
} = {}) {
  const E = createEmojiResolver(guildId ?? '');
  const meta = boostStatusMeta(order, guildId);
  const payment = order.payment_status === 'PAID' ? `${E('payment_success')} Đã thanh toán` : `${E('status_warn')} Chờ thanh toán`;
  const visibleNote = isStaff ? order.note : order.customer_status_note;
  const overview = boostPresentationPanel(meta.color, [
    `# ${E('brand_boost')} ${heading}\n**${order.order_code}**`,
    `**Trạng thái dịch vụ**\n${meta.label}\n\n**Thanh toán**\n${payment}`,
  ]);
  const information = boostPresentationPanel(BOOST_PRESENTATION_COLORS.teal, [
    `### ${E('order_product')} Gói đã chọn\n${order.package}\n\n${E('payment_money')} **Số tiền: ${Number(order.amount).toLocaleString('vi-VN')}đ**`,
    `### ${E('icon_store')} Máy chủ nhận Boost\n${boostServerSummary(order, E)}`,
    [order.boost_started_at ? `${E('icon_calendar')} **Bắt đầu:** ${discordTime(order.boost_started_at)}` : null,
      order.boost_expires_at ? `${E('icon_expire')} **Hết hạn:** ${discordTime(order.boost_expires_at)}\n${discordTime(order.boost_expires_at, 'R')}` : null].filter(Boolean).join('\n'),
  ]);
  const updates = boostPresentationPanel(BOOST_PRESENTATION_COLORS.copper, [
    visibleNote ? `### ${E('status_info')} ${isStaff ? 'Ghi chú xử lý' : 'Cập nhật từ shop'}\n${visibleNote}` : null,
    extraText,
    accessKey ? `### ${E('icon_key')} Key tra cứu của bạn\n\`\`\`${accessKey}\`\`\`\nGiữ kín key. Dùng nút **Nhập Key / Xem Live** tại panel Boost để theo dõi.` : null,
    `-# Đặt lúc ${discordTime(order.created_at)}\n-# Cập nhật ${discordTime(order.updated_at, 'R')} · ${BOOST_PRESENTATION_VERSION}`,
  ]);
  return {
    components: [overview, information, updates, ...(includeActions ? buildBoostOrderActionRows(order, isStaff) : [])],
    flags: MessageFlags.IsComponentsV2, allowedMentions: BOOST_SILENT_MENTIONS,
  };
}

// Compatibility for integrations that still consume an embed. New handlers
// use the grouped Components V2 payload, and every icon resolves from the guild.
export function buildBoostOrderDetailEmbed(order, isStaff = false) {
  const E = createEmojiResolver(order.guild_id ?? '');
  const meta = boostStatusMeta(order, order.guild_id);
  const embed = new EmbedBuilder().setColor(meta.color).setTitle(`Đơn Boost Server · ${order.order_code}`)
    .addFields(
      { name: `${E('order_product')} Gói`, value: order.package, inline: false },
      { name: `${E('payment_money')} Số tiền`, value: `${Number(order.amount).toLocaleString('vi-VN')}đ`, inline: true },
      { name: `${E('status_info')} Trạng thái`, value: meta.label, inline: true },
      { name: `${E('payment_payos')} Thanh toán`, value: order.payment_status === 'PAID' ? `${E('payment_success')} Đã thanh toán` : `${E('status_warn')} Chờ thanh toán`, inline: false },
      { name: `${E('icon_store')} Server`, value: boostServerSummary(order, E), inline: false },
    );
  if (order.boost_started_at) embed.addFields({ name: `${E('icon_calendar')} Bắt đầu Boost`, value: discordTime(order.boost_started_at), inline: true });
  if (order.boost_expires_at) embed.addFields({ name: `${E('icon_expire')} Hết hạn`, value: discordTime(order.boost_expires_at, 'R'), inline: true });
  const note = isStaff ? order.note : order.customer_status_note;
  if (note) embed.addFields({ name: `${E('status_info')} Ghi chú`, value: note, inline: false });
  embed.addFields({ name: `${E('icon_clock')} Ngày đặt`, value: discordTime(order.created_at), inline: false });
  if (!isBoostPaymentClosed(order) && order.payment_status !== 'PAID' && order.payment_checkout_url) embed.addFields({ name: 'Thanh toán PayOS', value: `[Mở thanh toán](${order.payment_checkout_url})`, inline: false });
  return embed.setFooter({ text: 'Cenar Store · Boost Server' });
}

export function buildBoostOrderActionRows(order, isStaff = false) {
  const rows = [];
  const E = createEmojiResolver(order.guild_id ?? '');

  if (!['PENDING', 'ACTIVE', 'WARRANTY', 'COMPLETED', 'CANCELLED', 'REFUNDED'].includes(order.status)) return rows;

  const row1 = new ActionRowBuilder();
  const canPay = order.payment_status !== 'PAID' && !isBoostPaymentClosed(order);

  // Nút thanh toán PayOS — hiển thị đầu tiên nếu chưa trả
  if (canPay && order.payment_checkout_url) {
    row1.addComponents(
      withButtonEmoji(new ButtonBuilder()
        .setLabel('Thanh Toán PayOS')
        .setStyle(ButtonStyle.Link)
        .setURL(order.payment_checkout_url), E.component('payment_payos'))
    );
  }
  if (canPay && !order.payment_checkout_url) {
    row1.addComponents(withButtonEmoji(
      new ButtonBuilder()
        .setCustomId(`boost:payment:${order.order_code}`)
        .setLabel('Tạo QR PayOS')
        .setStyle(ButtonStyle.Primary),
      E.component('payment_qr'),
    ));
  }

  // Huỷ đơn
  if (order.status === 'PENDING' && (isStaff || order.payment_status !== 'PAID')) {
    row1.addComponents(
      withButtonEmoji(new ButtonBuilder()
        .setCustomId(`boost:cancel:${order.order_code}`)
        .setLabel('Huỷ Đơn')
        .setStyle(ButtonStyle.Danger), E.component('order_cancel'))
    );
  }

  // Staff actions
  if (isStaff && order.payment_status === 'PAID' && order.status === 'PENDING') {
    row1.addComponents(withButtonEmoji(
      new ButtonBuilder()
        .setCustomId(`boost:activate:${order.order_code}`)
        .setLabel('Đã Boost (Kích Hoạt)')
        .setStyle(ButtonStyle.Primary), E.component('status_check')),
    );
  }
  if (isStaff && ['ACTIVE', 'WARRANTY'].includes(order.status)) {
    row1.addComponents(withButtonEmoji(
      new ButtonBuilder()
        .setCustomId(`boost:complete:${order.order_code}`)
        .setLabel('Hoàn Thành')
        .setStyle(ButtonStyle.Success), E.component('order_complete')),
    );
  }
  if (isStaff) {
    row1.addComponents(withButtonEmoji(
      new ButtonBuilder()
        .setCustomId(`boost:manage:${order.order_code}`)
        .setLabel('Cập Nhật Live')
        .setStyle(ButtonStyle.Secondary), E.component('icon_settings')),
    );
  }

  // Bảo hành
  if (order.status === 'ACTIVE') {
    row1.addComponents(
      withButtonEmoji(new ButtonBuilder()
        .setCustomId(`boost:warranty_req:${order.order_code}`)
        .setLabel('Báo Cáo Bảo Hành')
        .setStyle(ButtonStyle.Secondary), E.component('warranty_shield'))
    );
  }

  if (row1.components.length > 0) rows.push(row1);
  return rows;
}

// ─── Panel refresh ────────────────────────────────────────────────────────────

export async function refreshBoostPanel(client, guildId) {
  const cfg = getGuildConfig(guildId);
  const hasConfiguredPanel = Boolean(cfg?.boost_panel_channel_id && cfg?.boost_panel_message_id);
  const mayRecoverStoreOnePanel = String(guildId) === STORE_ONE_GUILD_ID
    && !cfg?.boost_panel_channel_id
    && !cfg?.boost_panel_message_id;

  const channelId = hasConfiguredPanel
    ? cfg.boost_panel_channel_id
    : mayRecoverStoreOnePanel ? STORE_ONE_BOOST_PANEL.channelId : null;
  const messageId = hasConfiguredPanel
    ? cfg.boost_panel_message_id
    : mayRecoverStoreOnePanel ? STORE_ONE_BOOST_PANEL.messageId : null;

  if (!channelId || !messageId) return { status: 'not_configured' };

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return { status: 'guild_not_found' };

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return { status: 'channel_not_found' };

  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (!msg) return { status: 'message_not_found' };
  if (msg.author?.id !== client.user?.id) return { status: 'message_not_owned' };

  const payload = buildBoostPanelPayload(guildId);

  try {
    await msg.edit({ ...payload, embeds: [], content: null });
    if (mayRecoverStoreOnePanel) {
      upsertGuildConfig({
        guild_id: guildId,
        boost_panel_channel_id: channel.id,
        boost_panel_message_id: msg.id,
        updated_by: client.user?.id ?? null,
      });
    }
    return {
      status: 'updated',
      channelId: channel.id,
      messageId: msg.id,
      recoveredConfig: mayRecoverStoreOnePanel,
    };
  } catch (error) {
    console.error('[BOOST PANEL] Lỗi refresh:', error.message);
    return { status: 'error', error: error.message };
  }
}

// ─── Log helper ───────────────────────────────────────────────────────────────

// Kênh log boost mặc định (Server 1) — fallback nếu DB chưa config
const DEFAULT_BOOST_LOG_CHANNEL = '1524232964928438455';

export function buildBoostLogPayload(order, guildId, action, actorId = null) {
  const E = createEmojiResolver(guildId ?? order.guild_id ?? '');
  const meta = boostStatusMeta(order, guildId);
  const payment = order.payment_status === 'PAID' ? `${E('payment_success')} Đã thanh toán` : `${E('status_warn')} Chờ thanh toán`;
  const actions = new ActionRowBuilder();
  if (order.payment_status === 'PAID' && order.status === 'PENDING') {
    actions.addComponents(withButtonEmoji(new ButtonBuilder().setCustomId(`boost:activate:${order.order_code}`)
      .setLabel('Kích Hoạt Boost').setStyle(ButtonStyle.Success), E.component('status_check')));
  }
  if (order.payment_status === 'PAID' && ['ACTIVE', 'WARRANTY'].includes(order.status)) {
    actions.addComponents(withButtonEmoji(new ButtonBuilder().setCustomId(`boost:complete:${order.order_code}`)
      .setLabel('Hoàn Thành').setStyle(ButtonStyle.Primary), E.component('order_complete')));
  }
  actions.addComponents(withButtonEmoji(new ButtonBuilder().setCustomId(`boost:manage:${order.order_code}`)
    .setLabel('Cập Nhật Live').setStyle(ButtonStyle.Secondary), E.component('icon_settings')));
  return {
    components: [
      boostPresentationPanel(meta.color, [
        `# ${E('brand_boost')} BOOST SERVER\n## [BOOST LOG] ${action}`,
        `${E('order_id')} **Mã đơn: \`${order.order_code}\`**\n\n**Trạng thái dịch vụ**\n${meta.label}\n\n**Thanh toán**\n${payment}`,
      ]),
      boostPresentationPanel(BOOST_PRESENTATION_COLORS.teal, [
        `### ${E('order_product')} Gói và giá trị đơn\n${order.package}\n${E('payment_money')} **${Number(order.amount).toLocaleString('vi-VN')}đ**`,
        `### ${E('icon_store')} Máy chủ nhận Boost\n${boostServerSummary(order, E)}`,
        `${E('cenar_verified')} **Khách hàng:** <@${order.customer_id}>${actorId ? `\n${E('cenar_staff')} **Xử lý bởi:** <@${actorId}>` : ''}`,
      ]),
      boostPresentationPanel(BOOST_PRESENTATION_COLORS.copper, [
        order.note ? `### ${E('status_info')} Ghi chú xử lý\n${order.note}` : null,
        `-# Ghi nhận ${discordTime(order.updated_at || order.created_at)} · ${BOOST_PRESENTATION_VERSION}`,
      ], actions),
    ],
    flags: MessageFlags.IsComponentsV2, allowedMentions: BOOST_SILENT_MENTIONS,
  };
}

export async function sendBoostLog(client, guildId, order, action, actorId = null) {
  const cfg = getGuildConfig(guildId);
  const logChannelId = cfg?.boost_log_channel_id || DEFAULT_BOOST_LOG_CHANNEL;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const channel = await guild.channels.fetch(logChannelId).catch(() => null);
  if (!channel) return;
  await channel.send(buildBoostLogPayload(order, guildId, action, actorId)).catch(error =>
    console.error('[BOOST LOG] Gửi log thất bại:', error.message));
}

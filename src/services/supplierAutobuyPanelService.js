import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ContainerBuilder,
  MessageFlags, PermissionFlagsBits, SeparatorBuilder, SeparatorSpacingSize, TextDisplayBuilder,
  StringSelectMenuBuilder, AttachmentBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
} from 'discord.js';
import QRCode from 'qrcode';
import { db } from '../database/db.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { STORE_ONE_GUILD_ID } from '../utils/locale.js';

const CATEGORY_ID = '1514606994256957600';
const CHANNEL_NAME = '🛒・autobuy';
const channelTopic = botId => `Cenar AutoBuy · Cenar Store quản lý · Bot ${botId}`;
const PREFIX = `supplier-autobuy:${STORE_ONE_GUILD_ID}:`;
const CONTROL_IDS = ['supplier-autobuy:catalog', 'supplier-autobuy:status'];
const NO_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false };
const starts = new WeakMap();
let panelHealth = Object.freeze({ status: 'NOT_STARTED', channelId: null, messageId: null });
const snowflake = value => typeof value === 'string' && /^\d{17,20}$/.test(value);

function setHealth(status, channelId = null, messageId = null) {
  panelHealth = Object.freeze({ status, channelId: snowflake(channelId) ? channelId : null, messageId: snowflake(messageId) ? messageId : null });
  return panelHealth;
}

export function getSupplierAutobuyPanelHealth() { return panelHealth; }

function checkedLine(snapshot) {
  const value = snapshot?.checkedAt;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) return 'Đang chờ lần kiểm tra đầu tiên.';
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return 'Đang chờ lần kiểm tra đầu tiên.';
  return `Lần kiểm tra gần nhất: <t:${Math.floor(date / 1000)}:f>.`;
}

function stateLine(snapshot) {
  if (snapshot?.purchasesEnabled === true) return 'Chọn gói phù hợp, kiểm tra điều kiện rồi thanh toán. Hàng được giao riêng cho đúng tài khoản đặt mua.';
  if (snapshot?.status === 'CONNECTED' && snapshot?.provider === 'dopermind') return 'Nguồn hàng mới đã kết nối thành công. Shop đang hoàn thiện giá bán và điều kiện từng sản phẩm.';
  if (snapshot?.status === 'HTTP_OK_SCHEMA_UNVERIFIED') return 'Đã nhận phản hồi kết nối. Shop đang kiểm tra danh mục và điều kiện bán.';
  if (snapshot?.status === 'CHECKING') return 'Shop đang kiểm tra kết nối nguồn hàng.';
  return 'Shop đang hoàn thiện kết nối nguồn hàng và bảng giá.';
}

function containerWithTitle(title, text, accent = 0x41B899) {
  const container = new ContainerBuilder().setAccentColor(accent);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(title));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  return container;
}

export function buildSupplierAutobuyPanel({ client, snapshot, supportChannelId } = {}) {
  const E = createEmojiResolver(STORE_ONE_GUILD_ID);
  const opened = snapshot?.purchasesEnabled === true;
  const container = containerWithTitle(`## ${E('panel_order')} CENAR AUTOBUY`.trim(), [
    `### ${E(snapshot?.status === 'CONNECTED' || opened ? 'status_check' : 'status_loading')} ${opened ? 'Chọn gói · Thanh toán · Nhận hàng riêng' : snapshot?.status === 'CONNECTED' ? 'Đã kết nối nguồn hàng mới' : 'Đang chuẩn bị mở bán'}`,
    stateLine(snapshot),
    '',
    opened ? 'Giá, thời hạn, hình thức tài khoản và bảo hành được ghi rõ trước khi bạn xác nhận.' : 'Danh mục, giá bán và bảo hành sẽ được công bố sau khi kiểm tra đầy đủ.',
    opened ? '**Bấm Danh mục & giá để bắt đầu.**' : '**Kênh hiện chưa nhận thanh toán hoặc tạo đơn autobuy.**',
  ].join('\n'));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${E('status_info')} ${checkedLine(snapshot)}\n-# Các đơn đang có vẫn được shop hỗ trợ theo chính sách đã mua.`));
  const row = new ActionRowBuilder().addComponents(
    withButtonEmoji(new ButtonBuilder().setCustomId(CONTROL_IDS[0]).setLabel('Danh mục & giá').setStyle(ButtonStyle.Primary), E('icon_doc')),
    withButtonEmoji(new ButtonBuilder().setCustomId(CONTROL_IDS[1]).setLabel('Tình trạng mở bán').setStyle(ButtonStyle.Secondary), E('status_loading')),
  );
  if (snowflake(supportChannelId)) row.addComponents(withButtonEmoji(new ButtonBuilder().setLabel('Tạo ticket hỗ trợ')
    .setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${STORE_ONE_GUILD_ID}/${supportChannelId}`), E('cenar_support')));
  return { components: [container, row], flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications, allowedMentions: { ...NO_MENTIONS } };
}

export function buildSupplierAutobuyReply({ client, snapshot, action, customerId } = {}) {
  const E = createEmojiResolver(STORE_ONE_GUILD_ID);
  const catalog = action === 'catalog';
  const title = catalog ? `## ${E('icon_doc')} Danh mục đang được chuẩn bị` : `## ${E('status_loading')} Tình trạng autobuy`;
  const count = snapshot?.status === 'CONNECTED' && Number.isSafeInteger(snapshot?.productCount) && snapshot.productCount >= 0
    ? `Shop đã kiểm tra kết nối danh mục **${snapshot.productCount} sản phẩm**. Giá bán và điều kiện từng gói đang được hoàn thiện.\n\n` : '';
  const text = catalog
    ? `${count}Shop chưa công bố sản phẩm hoặc giá bán autobuy. Giá, thời hạn và bảo hành sẽ hiển thị rõ trước khi khách xác nhận mua.\n\n**Hiện chưa nhận tiền hoặc tạo đơn ở kênh này.**`
    : `${stateLine(snapshot)}\n\n${checkedLine(snapshot)}\nĐây là kết quả kiểm tra đã lưu; thao tác này không tạo giao dịch.\n\n**${snapshot?.purchasesEnabled === true ? 'Autobuy đã sẵn sàng. Xem giá và điều kiện trước khi mua.' : 'Autobuy chưa mở bán.'}**`;
  const components = [containerWithTitle(title, text)];
  if (ownerId(customerId)) components.push(row(button(`supplier-autobuy:orders:${customerId}`, 'Đơn của tôi', 'icon_doc')));
  return { components, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { ...NO_MENTIONS } };
}

const PAGE_SIZE = 8;
const ownerId = value => typeof value === 'string' && /^\d{17,20}$/.test(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value);
const clean = (value, limit = 200) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const markdown = (value, limit = 200) => clean(value, limit).replace(/@/g, '＠').replace(/([\\`*_{}\[\]()#+\-.!>|~])/g, '\\$1');
const money = amount => Number.isSafeInteger(amount) && amount >= 0 ? `${new Intl.NumberFormat('vi-VN').format(amount)}đ` : 'Đang cập nhật';
const priceOf = offer => offer?.unitPriceVnd ?? offer?.priceVnd;
function productIcon(name) {
  const value = clean(name, 500).toLowerCase();
  for (const [pattern, slot] of [[/capcut/, 'brand_capcut'], [/adobe/, 'brand_adobe'], [/chatgpt|gpt/, 'brand_chatgpt'], [/spotify/, 'brand_spotify'], [/gemini/, 'brand_gemini'], [/office/, 'brand_office']]) if (pattern.test(value)) return slot;
  if (/vpn|proxy/.test(value)) return 'icon_key';
  if (/udemy|coursera|duolingo|autodesk/.test(value)) return 'icon_book';
  if (/zoom/.test(value)) return 'icon_group';
  if (/grok|perplexity|elevenlabs|wispr/.test(value)) return 'icon_brain';
  return 'icon_doc';
}
function categoryIcon(name) {
  const value = clean(name, 100).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/vpn|bao mat|security/.test(value)) return 'icon_key';
  if (/ai|tri tue/.test(value)) return 'icon_brain';
  if (/sang tao|creative|design/.test(value)) return 'icon_art';
  if (/hoc|education|learning/.test(value)) return 'icon_book';
  if (/office|van phong|productivity/.test(value)) return 'brand_office';
  if (/giai tri|entertainment|stream/.test(value)) return 'icon_gift';
  return 'icon_settings';
}
function selectEmoji(E, slot) { const emoji = E.component?.(slot); return emoji ? { emoji } : {}; }
const validOffer = offer => typeof offer?.productKey === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(offer.productKey) && clean(offer?.name).length > 0
  && Number.isSafeInteger(priceOf(offer)) && priceOf(offer) > 0 && offer.available === true;
const privatePayload = components => ({ components, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { ...NO_MENTIONS } });
const button = (id, label, slot = 'icon_doc', style = ButtonStyle.Secondary) => {
  const E = createEmojiResolver(STORE_ONE_GUILD_ID);
  return withButtonEmoji(new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style), E(slot));
};
const row = (...buttons) => new ActionRowBuilder().addComponents(buttons);
const nav = customerId => row(button(`supplier-autobuy:page:${customerId}:0:0`, 'Danh mục', 'icon_store'), button(`supplier-autobuy:orders:${customerId}`, 'Đơn của tôi', 'icon_doc'));
function requireOwner(customerId) { if (!ownerId(customerId)) throw new Error('INVALID_CUSTOMER'); }

export function buildSupplierCatalogView({ catalog, customerId, page = 0, category = 0 } = {}) {
  requireOwner(customerId);
  const E = createEmojiResolver(STORE_ONE_GUILD_ID);
  const offers = Array.isArray(catalog?.offers) ? catalog.offers.filter(validOffer) : [];
  const categories = [...new Set(offers.map(offer => clean(offer.category, 60) || 'Khác'))].sort().slice(0, 24);
  const categoryIndex = Number.isInteger(category) && category >= 0 && category <= categories.length ? category : 0;
  const filtered = categoryIndex === 0 ? offers : offers.filter(offer => (clean(offer.category, 60) || 'Khác') === categories[categoryIndex - 1]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Number.isInteger(page) ? Math.max(0, Math.min(page, pages - 1)) : 0;
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const text = visible.length ? visible.map(offer => `${E(productIcon(offer.name))} **${markdown(offer.name, 90)}**\n${E('icon_price')} **${money(priceOf(offer))}** · ${markdown(offer.termLabel || 'Xem điều kiện gói', 65)}`).join('\n\n')
    : 'Chưa có gói phù hợp còn hàng. Bạn có thể quay lại sau hoặc tạo ticket để shop kiểm tra.';
  const container = containerWithTitle(`## ${E('icon_store')} Chọn gói bạn cần`, `${text}\n\n-# Trang ${currentPage + 1}/${pages} · ${filtered.length} gói đang có hàng. Giá và tồn kho được kiểm tra lại trước khi tạo đơn.`);
  const components = [container];
  if (categories.length > 1) {
    components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`supplier-autobuy:category:${customerId}`).setPlaceholder('Lọc theo nhu cầu')
      .addOptions([{ label: 'Tất cả sản phẩm', value: '0', default: categoryIndex === 0, ...selectEmoji(E, 'icon_store') },
        ...categories.map((name, index) => ({ label: clean(name, 100), value: String(index + 1), default: categoryIndex === index + 1, ...selectEmoji(E, categoryIcon(name)) }))])));
  }
  if (visible.length) {
    components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`supplier-autobuy:select:${customerId}`).setPlaceholder('Chọn sản phẩm để xem điều kiện')
      .addOptions(visible.map(offer => ({ label: clean(offer.name, 100), value: offer.productKey,
        description: `${money(priceOf(offer))} · ${clean(offer.warrantyLabel || 'Xem bảo hành', 55)}`.slice(0, 100), ...selectEmoji(E, productIcon(offer.name)) })))));
  }
  const controls = [];
  if (currentPage > 0) controls.push(button(`supplier-autobuy:page:${customerId}:${categoryIndex}:${currentPage - 1}`, 'Trang trước', 'icon_prev'));
  if (currentPage + 1 < pages) controls.push(button(`supplier-autobuy:page:${customerId}:${categoryIndex}:${currentPage + 1}`, 'Trang sau', 'icon_next'));
  controls.push(button(`supplier-autobuy:orders:${customerId}`, 'Đơn của tôi', 'icon_doc'));
  components.push(row(...controls));
  return privatePayload(components);
}

export function buildSupplierQuoteView({ quote, customerId, manager = false } = {}) {
  requireOwner(customerId);
  if (!identifier(quote?.quoteId) || !identifier(quote?.productKey)) throw new Error('INVALID_QUOTE');
  const E = createEmojiResolver(STORE_ONE_GUILD_ID);
  const expiry = Date.parse(quote.expiresAt);
  const text = [
    `### ${markdown(quote.productName, 150)}`,
    `${E('icon_price')} **${money(quote.totalPriceVnd)}** · ${Number.isSafeInteger(quote.quantity) ? quote.quantity : 1} sản phẩm`,
    `${E('icon_duration')} Thời hạn: **${markdown(quote.termLabel || 'Theo mô tả gói', 100)}**`,
    `${E('panel_warranty')} Bảo hành: ${markdown(quote.warrantyLabel || 'Chưa có thông tin', 160)}`,
    `${E('ticket_user')} Hình thức: ${markdown(quote.accountForm || 'Xem mô tả gói', 130)}`,
    quote.comparisonDisclosure ? `-# ${markdown(quote.comparisonDisclosure, 240)}` : '',
    Number.isFinite(expiry) ? `-# Báo giá hết hạn <t:${Math.floor(expiry / 1000)}:R>. Nếu giá hoặc tồn kho thay đổi, shop sẽ yêu cầu bạn xem lại.` : '',
    '**Kiểm tra đúng gói và điều kiện trước khi xác nhận tạo đơn.**',
  ].filter(Boolean).join('\n\n');
  const controls = [button(`supplier-autobuy:confirm:${customerId}:${quote.quoteId}`, 'Xác nhận tạo đơn', 'icon_cart', ButtonStyle.Success)];
  const quantityId = `supplier-autobuy:qty:${customerId}:${quote.productKey}`;
  if (quantityId.length <= 100) controls.push(button(quantityId, 'Đổi số lượng', 'icon_edit'));
  const priceId = `supplier-autobuy:editprice:${customerId}:${quote.productKey}`;
  if (manager && priceId.length <= 100) controls.push(button(priceId, 'Admin · Sửa giá', 'panel_edit'));
  return privatePayload([containerWithTitle(`## ${E('status_info')} Kiểm tra gói đã chọn`, text), row(...controls), nav(customerId)]);
}

const STATUSES = Object.freeze({ PENDING_PAYMENT: 'Chờ thanh toán', UNPAID: 'Chờ thanh toán', PROCESSING: 'Đang xử lý', PAID: 'Đã thanh toán', COMPLETED: 'Đã hoàn thành', DELIVERED: 'Đã giao hàng', READY: 'Có hàng để nhận', UNKNOWN: 'Đang đối soát với nguồn', RECONCILING: 'Đang đối soát với nguồn', REVIEW_REQUIRED: 'Shop đang kiểm tra', REVIEW: 'Shop đang kiểm tra đơn', BLOCKED: 'Shop đang kiểm tra đơn', WAITING_STOCK: 'Đang chờ nguồn bổ sung hàng', WAITING_SUPPLIER_FUNDS: 'Shop đang xử lý nguồn hàng', SUBMITTING: 'Đang lấy hàng', PURCHASED: 'Đã có hàng · Đang giao riêng', DELIVERY_PENDING: 'Đang chờ gửi hàng riêng', DELIVERING: 'Đang gửi hàng riêng', PENDING: 'Đang chờ lấy hàng', FAILED: 'Cần shop hỗ trợ', CANCELLED: 'Đã hủy', REFUNDED: 'Đã hoàn tiền' });
function orderCodeOf(order) { return order?.orderCode ?? order?.order_code; }
function publicOrderText(order, nameLimit = 150) {
  const terminal = ['COMPLETED', 'CANCELLED', 'REFUNDED'].includes(order?.status);
  const paid = ['PAID', 'FREE'].includes(order?.paymentStatus ?? order?.payment_status);
  const status = (terminal ? STATUSES[order.status] : paid ? STATUSES[order?.deliveryStatus] : null) || STATUSES[order?.status] || 'Đang cập nhật';
  const name = order?.productName ?? order?.product_name ?? 'Đơn autobuy';
  const amount = order?.totalPriceVnd ?? order?.totalAmount ?? order?.total_amount;
  return `**${markdown(name, nameLimit)}**\nMã đơn: \`${orderCodeOf(order)}\`\nTổng tiền: **${money(amount)}**\nTrạng thái: **${status}**`;
}

function payosUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['pay.payos.vn', 'payos.vn'].includes(url.hostname)
      && !url.username && !url.password && !url.port ? url.href : null;
  } catch { return null; }
}
function paymentExpiry(payment) {
  const value = payment?.expiresAt;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
function paymentState(order, payment) {
  const unpaid = !payment?.paid && !['PAID', 'FREE'].includes(order?.paymentStatus ?? order?.payment_status)
    && !['COMPLETED', 'REFUNDED', 'CANCELLED'].includes(order?.status);
  const expiresAt = paymentExpiry(payment);
  return { unpaid, expiresAt, expired: expiresAt !== null && expiresAt <= Date.now() };
}

export function buildSupplierOrderView({ order, customerId, payment = order?.payment ?? null, qrAttachmentName = null, qrUnavailable = false } = {}) {
  requireOwner(customerId);
  const code = orderCodeOf(order) ?? payment?.orderCode;
  if (!/^CN_\d{6,12}$/.test(code || '')) throw new Error('INVALID_ORDER');
  const E = createEmojiResolver(STORE_ONE_GUILD_ID);
  const { unpaid, expiresAt, expired } = paymentState(order, payment);
  const text = [publicOrderText({ ...order, orderCode: code }), '',
    !unpaid ? 'Thanh toán và trạng thái đơn được ghi nhận ở trên. Bấm Nhận hàng riêng khi đơn đã có kết quả.'
      : expired ? 'Hóa đơn đã hết hạn. Vui lòng kiểm tra đơn hoặc tạo ticket hỗ trợ; không chuyển tiền vào mã QR cũ.'
      : qrAttachmentName ? 'Quét mã QR bên dưới hoặc bấm Mở trang thanh toán. Bot tự xác nhận khi nhận được tiền.'
      : qrUnavailable ? 'Chưa hiển thị được ảnh QR. Bạn có thể dùng trang thanh toán PayOS hoặc bấm Kiểm tra đơn để xem lại hóa đơn hiện có.'
      : 'Thanh toán cho đúng mã đơn. Mọi lần kiểm tra và nhận lại hàng đều sử dụng đơn này.',
    unpaid && expiresAt !== null ? `${E('icon_expire')} **${expired ? 'Đã hết hạn' : 'Hạn thanh toán'}:** <t:${Math.floor(expiresAt / 1000)}:f> · <t:${Math.floor(expiresAt / 1000)}:R>` : null,
  ].filter(line => line !== null).join('\n');
  const controls = [];
  if (unpaid && !expired) controls.push(button(`supplier-autobuy:pay:${customerId}:${code}:payos`, 'Thanh toán QR / PayOS', 'payment_payos', ButtonStyle.Primary),
    button(`supplier-autobuy:pay:${customerId}:${code}:wallet`, 'Dùng ví Cenar', 'icon_wallet'));
  const link = unpaid && !expired ? payosUrl(payment?.checkoutUrl) : null;
  if (link) controls.push(withButtonEmoji(new ButtonBuilder().setLabel('Mở trang thanh toán').setStyle(ButtonStyle.Link).setURL(link), E('payment_payos')));
  controls.push(button(`supplier-autobuy:order:${customerId}:${code}`, 'Kiểm tra đơn', 'icon_refresh'),
    button(`supplier-autobuy:delivery:${customerId}:${code}`, 'Nhận hàng riêng', 'icon_gift'));
  const container = containerWithTitle(`## ${E('panel_order')} Đơn autobuy của bạn`, text);
  if (unpaid && !expired && qrAttachmentName === `payos-${code}.png`) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder()
      .setURL(`attachment://${qrAttachmentName}`).setDescription(`Mã QR thanh toán PayOS cho đơn ${code}`)));
  }
  return privatePayload([container, row(...controls), nav(customerId)]);
}

/** Render locally; payment data must already be resolved by the owned order. */
export async function buildSupplierPaymentView({ order, customerId, payment = order?.payment ?? null } = {}) {
  requireOwner(customerId);
  const code = orderCodeOf(order) ?? payment?.orderCode;
  if (!/^CN_\d{6,12}$/.test(code || '')) throw new Error('INVALID_ORDER');
  const { unpaid, expired } = paymentState(order, payment);
  const method = typeof payment?.method === 'string' ? payment.method.toUpperCase() : null;
  let qrAttachmentName = null, files;
  const payos = unpaid && !expired && method === 'PAYOS';
  if (payos) {
    const raw = payment?.qrCode;
    // PayOS returns an EMV/VietQR payload. Never fetch remote image URLs or
    // encode arbitrary supplier URLs; only the verified PayOS link is fallback.
    const data = typeof raw === 'string' && raw.length <= 4096 && /^000201[\x20-\x7e]{20,}$/.test(raw)
      && !/(?:https?|data|javascript|file|ftp):/i.test(raw)
      ? raw : payosUrl(payment?.checkoutUrl);
    if (data) {
      try {
        const image = await QRCode.toBuffer(data, { type: 'png', width: 720, margin: 2,
          errorCorrectionLevel: 'M', color: { dark: '#111827', light: '#FFFFFFFF' } });
        if (Buffer.isBuffer(image) && image.length <= 1024 * 1024) {
          qrAttachmentName = `payos-${code}.png`;
          files = [new AttachmentBuilder(image, { name: qrAttachmentName })];
        }
      } catch { /* Keep the existing invoice link; never create another one. */ }
    }
  }
  return { ...buildSupplierOrderView({ order, customerId, payment, qrAttachmentName, qrUnavailable: payos && !qrAttachmentName }), ...(files ? { files } : {}) };
}

export function buildSupplierOrderListView({ orders, customerId } = {}) {
  requireOwner(customerId);
  const E = createEmojiResolver(STORE_ONE_GUILD_ID);
  const safe = Array.isArray(orders) ? orders.filter(order => /^CN_\d{6,12}$/.test(orderCodeOf(order) || '')).slice(0, 10) : [];
  const text = safe.length ? safe.map(order => publicOrderText(order, 70)).join('\n\n') : 'Bạn chưa có đơn autobuy. Vào Danh mục để chọn gói và xem điều kiện.';
  const components = [containerWithTitle(`## ${E('icon_doc')} Đơn autobuy của tôi`, text)];
  if (safe.length) components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`supplier-autobuy:orderselect:${customerId}`)
    .setPlaceholder('Chọn đơn để kiểm tra hoặc nhận hàng').addOptions(safe.map(order => ({ label: orderCodeOf(order), value: orderCodeOf(order), description: clean(order.productName ?? order.product_name ?? 'Đơn autobuy', 100) })))));
  components.push(nav(customerId));
  return privatePayload(components);
}

export function buildSupplierNoticeView({ title = 'Thông tin autobuy', text, customerId, warning = false } = {}) {
  requireOwner(customerId);
  const E = createEmojiResolver(STORE_ONE_GUILD_ID);
  return privatePayload([containerWithTitle(`## ${E(warning ? 'status_warn' : 'status_check')} ${markdown(title, 100)}`, markdown(text, 1200), warning ? 0xDDAA55 : 0x41B899), nav(customerId)]);
}

function readSetting(name) { return db.prepare('SELECT value FROM system_settings WHERE key = ?').get(`${PREFIX}${name}`)?.value ?? null; }
function saveSetting(name, value) {
  db.prepare(`INSERT INTO system_settings (key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`).run(`${PREFIX}${name}`, value, new Date().toISOString());
}
function componentIds(message) {
  const ids = [];
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.custom_id === 'string') ids.push(value.custom_id);
    if (Array.isArray(value.components)) value.components.forEach(walk);
  };
  for (const component of message.components || []) walk(typeof component.toJSON === 'function' ? component.toJSON() : component);
  return ids.sort();
}
function ownedPanel(message, botId) {
  return message?.author?.id === botId && !message.webhookId
    && JSON.stringify(componentIds(message)) === JSON.stringify([...CONTROL_IDS].sort());
}
function ownedChannel(channel, botId) {
  return channel?.type === ChannelType.GuildText && channel.guildId === STORE_ONE_GUILD_ID
    && channel.parentId === CATEGORY_ID && channel.name === CHANNEL_NAME
    && channel.topic === channelTopic(botId);
}
function readOnlyPermissions(channel, botId) {
  const everyone = channel.permissionOverwrites?.cache?.get(STORE_ONE_GUILD_ID);
  const bot = channel.permissionsFor?.(botId);
  const deny = [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads];
  const permittedWriter = [...(channel.permissionOverwrites?.cache?.values() || [])]
    .some(overwrite => overwrite.id !== botId && overwrite.id !== STORE_ONE_GUILD_ID && overwrite.allow?.any(deny));
  return everyone?.allow?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])
    && everyone?.deny?.has(deny)
    && !permittedWriter
    && bot?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]);
}

export function ensureSupplierAutobuyChannel(client, { guildId, envFile, snapshot } = {}) {
  if (guildId !== STORE_ONE_GUILD_ID || envFile !== '.env') return Promise.resolve(setHealth('DISABLED_OTHER_STORE'));
  if (starts.has(client)) return starts.get(client);
  const task = Promise.resolve().then(async () => {
    let channelId = null;
    let messageId = null;
    try {
      const botId = client.user?.id;
      if (!snowflake(botId)) return setHealth('DEGRADED_BOT_UNAVAILABLE');
      const guild = await client.guilds.fetch(STORE_ONE_GUILD_ID);
      if (guild?.id !== STORE_ONE_GUILD_ID) return setHealth('DEGRADED_GUILD_UNAVAILABLE');
      // Authoritative inventory, never a cache-only absence followed by create.
      const channels = await guild.channels.fetch();
      if (!channels || typeof channels.values !== 'function') return setHealth('DEGRADED_CHANNEL_READ');
      const parent = channels.get(CATEGORY_ID);
      if (parent?.type !== ChannelType.GuildCategory || parent.guildId !== STORE_ONE_GUILD_ID) return setHealth('DEGRADED_CATEGORY_UNAVAILABLE');
      channelId = readSetting('channel_id');
      messageId = readSetting('message_id');
      if ((channelId && !snowflake(channelId)) || (messageId && !snowflake(messageId)) || (!channelId && messageId)) return setHealth('DEGRADED_SAVED_REFERENCE');
      let channel;
      if (channelId) {
        channel = channels.get(channelId);
        if (!ownedChannel(channel, botId)) return setHealth('DEGRADED_SAVED_CHANNEL', channelId, messageId);
      } else {
        const matches = [...channels.values()].filter(item => ownedChannel(item, botId));
        if (matches.length > 1) return setHealth('DEGRADED_AMBIGUOUS_CHANNEL');
        channel = matches[0];
        if (!channel) {
          // A conflicting name is not ours to adopt, rename or overwrite.
          if ([...channels.values()].some(item => item.parentId === CATEGORY_ID && item.name === CHANNEL_NAME)) return setHealth('DEGRADED_CHANNEL_CONFLICT');
          if (readSetting('channel_pending') === '1') return setHealth('DEGRADED_CHANNEL_UNCERTAIN');
          if (!parent.permissionsFor?.(botId)?.has(PermissionFlagsBits.ManageChannels)) return setHealth('DEGRADED_NO_ACCESS');
          saveSetting('channel_pending', '1');
          channel = await guild.channels.create({
            name: CHANNEL_NAME, type: ChannelType.GuildText, parent: CATEGORY_ID,
            topic: channelTopic(botId),
            permissionOverwrites: [
              { id: STORE_ONE_GUILD_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.CreatePrivateThreads, PermissionFlagsBits.SendMessagesInThreads] },
              { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages] },
            ],
            reason: 'Owner-requested separate autobuy channel; sales remain disabled',
          });
          if (!ownedChannel(channel, botId)) return setHealth('DEGRADED_CREATED_CHANNEL');
        }
        channelId = channel.id;
        saveSetting('channel_id', channelId);
        saveSetting('channel_pending', '0');
      }
      if (!readOnlyPermissions(channel, botId)) return setHealth('DEGRADED_CHANNEL_PERMISSIONS', channelId, messageId);
      const supportId = db.prepare('SELECT ticket_panel_channel_id FROM guild_settings WHERE guild_id = ?').get(STORE_ONE_GUILD_ID)?.ticket_panel_channel_id;
      const support = snowflake(supportId) ? channels.get(supportId) : null;
      const supportChannelId = support?.guildId === STORE_ONE_GUILD_ID && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(support.type) ? supportId : null;
      const payload = buildSupplierAutobuyPanel({ client, snapshot, supportChannelId });
      let message;
      if (messageId) {
        message = await channel.messages.fetch(messageId);
        if (!ownedPanel(message, botId)) return setHealth('DEGRADED_SAVED_MESSAGE', channelId, messageId);
      } else {
        const recent = await channel.messages.fetch({ limit: 100 });
        const matching = [...recent.values()].filter(item => ownedPanel(item, botId));
        if (matching.length > 1) return setHealth('DEGRADED_AMBIGUOUS_PANEL', channelId);
        message = matching[0];
        if (!message) {
          // Unknown send outcomes require reconciliation; don't duplicate a
          // potentially posted card when its receipt was lost or aged away.
          if (readSetting('panel_pending') === '1' || recent.size >= 100) return setHealth('DEGRADED_PUBLICATION_UNCERTAIN', channelId);
          saveSetting('panel_pending', '1');
          message = await channel.send(payload);
          if (!ownedPanel(message, botId) || !snowflake(message.id)) return setHealth('DEGRADED_SENT_MESSAGE', channelId);
        }
        messageId = message.id;
        saveSetting('message_id', messageId);
        saveSetting('panel_pending', '0');
      }
      // SuppressNotifications is a send-only flag; edits retain silence through
      // allowedMentions and do not attempt to set an unsupported edit flag.
      await message.edit({ ...payload, flags: MessageFlags.IsComponentsV2 });
      return setHealth('READY', channelId, messageId);
    } catch {
      return setHealth('DEGRADED_SETUP_FAILED', channelId, messageId);
    }
  });
  starts.set(client, task);
  return task;
}

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { config } from '../config.js';
import { createEmojiResolver, withButtonEmoji } from '../utils/emojiHelper.js';
import { accentFor } from '../utils/uiKit.js';
import { getTicketById, getTicketByChannelId } from './ticketService.js';
import {
  createOrder,
  getCompletedOrdersByCustomer,
  getLatestOrderByTicketChannel,
  getQueuePosition,
  saveOrderLogMessage,
} from './orderService.js';
import { getProductById } from './productCatalogService.js';
import { getGuildConfig } from './guildConfigService.js';
import { openWarrantyTicket } from './warrantyService.js';
import { sendOrRefreshPaymentQr, sendVietQRPayment } from './paymentService.js';
import { buildOrderCreatedV2, buildQueuePositionV2 } from '../utils/embeds.js';
import { buildOrderLogContent } from '../utils/formatters.js';
import { emitStaffLog } from './staffLogService.js';
import { emitAutomationLog } from './automationLogService.js';

export const AI_SUPPORT_PREFIX = 'ai:support:';
const ORDER_CODE_PATTERN = /\b(?:CN|CR)_\d{6}\b/i;
const responseSlots = new Map();
const warrantyGuideSlots = new Map();
const orderConfirmationLocks = new Set();

const PRODUCT_HINT_GROUPS = Object.freeze([
  ['youtube', ['youtube', 'yt premium', 'yout']],
  ['netflix', ['netflix', 'net']],
  ['spotify', ['spotify', 'spot']],
  ['discord', ['discord', 'nitro', 'boost server']],
  ['chatgpt', ['chatgpt', 'chat gpt', 'gpt plus']],
  ['gemini', ['gemini', 'google one']],
  ['capcut', ['capcut']],
  ['canva', ['canva']],
  ['office', ['office', 'onedrive']],
  ['claude', ['claude']],
  ['adobe', ['adobe']],
  ['gearup', ['gearup', 'booster']],
]);

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

function short(value, max = 90) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function money(value) {
  return `${Number(value || 0).toLocaleString('vi-VN')}đ`;
}

function orderDate(order) {
  const value = order.completed_at || order.created_at;
  const timestamp = Math.floor(new Date(value).getTime() / 1000);
  return Number.isFinite(timestamp) ? `<t:${timestamp}:d>` : 'không rõ ngày';
}

function orderDateLabel(order) {
  const date = new Date(order.completed_at || order.created_at);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
    : 'không rõ ngày';
}

function messagePayload(lines, color = accentFor('info'), rows = []) {
  const container = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.filter(Boolean).join('\n')));
  return {
    components: [container, ...rows],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function extractOrderCode(content) {
  return String(content || '').match(ORDER_CODE_PATTERN)?.[0]?.toUpperCase() || null;
}

export function classifyCustomerIntent(content) {
  const text = normalize(content);
  if (!text.trim()) return 'GENERAL';
  const productMentioned = PRODUCT_HINT_GROUPS.some(([, hints]) => hints.some((hint) => text.includes(hint)));
  const warrantySignal = /bao hanh|mat premium|bi out|out fam|het han som|sai (pass|mat khau)|khong dang nhap|tai khoan (loi|die|hong)|bi khoa/.test(text)
    || (productMentioned && /loi|hong|khong dung duoc|khong vao duoc|mat quyen/.test(text));
  if (warrantySignal) return 'WARRANTY';
  if (/\b(chot|dat mua|xac nhan mua|ok lay|mua ngay|lay goi)\b/.test(text)) return 'PURCHASE_CONFIRM';
  if (/\b(muon mua|can mua|mua goi|dat hang)\b/.test(text)) return 'PURCHASE';
  if (/gia bao nhieu|bao nhieu tien|con hang|tu van|goi nao|san pham nao|bang gia/.test(text)
    || (productMentioned && /gia|mua|thang|goi|bao nhieu/.test(text))) return 'PRODUCT_ADVICE';
  if (/shop oi|ho tro|giup|minh hoi|cho hoi|lam sao|the nao|tai sao|khong biet/.test(text) || /\?$/.test(text.trim())) return 'SUPPORT';
  return 'GENERAL';
}

export function hasExplicitPurchaseConfirmation(content) {
  return classifyCustomerIntent(content) === 'PURCHASE_CONFIRM';
}

export function sanitizeCustomerTextForAi(content) {
  return String(content || '')
    .replace(/https?:\/\/\S+/gi, '[LIÊN KẾT ĐÃ ẨN]')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[EMAIL ĐÃ ẨN]')
    .replace(/\b(?:password|pass|mật khẩu|mat khau)\s*[:=]\s*\S+/gi, '$1: [ĐÃ ẨN]')
    .replace(/\b(?:otp|mã otp|ma otp|2fa)\s*[:=]?\s*\d{4,8}\b/gi, '$1: [ĐÃ ẨN]')
    .replace(/(?<![A-Z_])\b\d{9,16}\b(?!_\d)/gi, '[SỐ NHẠY CẢM ĐÃ ẨN]')
    .replace(/\b[A-Za-z\d_-]{20,}\.[A-Za-z\d_-]{6,}\.[A-Za-z\d_-]{20,}\b/g, '[TOKEN ĐÃ ẨN]')
    .slice(0, 1800);
}

export function claimAiResponseSlot(key, cooldownSeconds, now = Date.now()) {
  const normalizedKey = String(key || '');
  const expiresAt = responseSlots.get(normalizedKey) || 0;
  if (expiresAt > now) return false;
  responseSlots.set(normalizedKey, now + Math.max(1, Number(cooldownSeconds) || 1) * 1000);
  if (responseSlots.size > 2000) {
    for (const [entry, expiry] of responseSlots) if (expiry <= now) responseSlots.delete(entry);
  }
  return true;
}

export function isAiPublicChannel(message) {
  const allowed = new Set((config.aiPublicChannelIds || []).map(String));
  return allowed.has(String(message?.channel?.id || ''));
}

export function shouldAiReplyInPublic(message, { mentioned = false, isStaff = false } = {}) {
  if (isStaff) return Boolean(mentioned);
  if (mentioned) return true;
  return isAiPublicChannel(message)
    && String(message?.content || '').trim().length >= 5
    && classifyCustomerIntent(message.content) !== 'GENERAL';
}

export function shouldAiReplyInTicket(message, ticket) {
  if (!ticket || ticket.status !== 'OPEN' || ticket.customer_id !== message.author?.id) return false;
  const intent = classifyCustomerIntent(message.content);
  return message.mentions?.has?.(message.client.user)
    || intent !== 'GENERAL'
    || /\?/.test(String(message.content || ''));
}

export function matchWarrantyOrders(orders, content) {
  const text = normalize(content);
  const matchedGroups = PRODUCT_HINT_GROUPS.filter(([, hints]) => hints.some((hint) => text.includes(hint)));
  if (!matchedGroups.length) return orders;
  const filtered = orders.filter((order) => {
    const product = normalize(order.product_name);
    return matchedGroups.some(([, hints]) => hints.some((hint) => product.includes(hint)));
  });
  return filtered.length ? filtered : orders;
}

export function buildWarrantyLookupPayload({ ticket, guildId, orders = [], reason = null }) {
  const E = createEmojiResolver(guildId);
  const validOrders = orders.slice(0, 5);
  const lines = [
    `## ${E('warranty_shield')} TRỢ LÝ TRA ĐƠN BẢO HÀNH`,
    reason ? `> ${E('status_warn')} ${reason}` : `> ${E('status_info')} Bạn chưa cần nhớ chính xác mã đơn; hệ thống đã tra lịch sử của đúng tài khoản Discord này.`,
  ];
  const rows = [];

  if (validOrders.length) {
    lines.push(
      '',
      `${E('status_check')} Tìm thấy **${validOrders.length} đơn đã hoàn thành** có thể phù hợp. Hãy chọn đúng đơn đang gặp lỗi:`,
      ...validOrders.map((order) => `${E('order_id')} \`${order.order_code}\` · **${short(order.product_name, 70)}** · ${orderDate(order)}`),
      `-# Chọn đơn chỉ mở hồ sơ bảo hành; bot không tự kết luận lỗi hay cam kết phương án xử lý.`,
    );
    const select = new StringSelectMenuBuilder()
      .setCustomId(`${AI_SUPPORT_PREFIX}warranty_select:${ticket.id}`)
      .setPlaceholder('Chọn đơn cần bảo hành')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(validOrders.map((order) => new StringSelectMenuOptionBuilder()
        .setLabel(short(`${order.order_code} · ${order.product_name}`, 100))
        .setDescription(short(`Mua ${orderDateLabel(order)} · ${order.status}`, 100))
        .setValue(order.order_code)));
    rows.push(new ActionRowBuilder().addComponents(select));
  } else {
    lines.push(
      '',
      `${E('status_warn')} Hệ thống chưa tìm thấy đơn hoàn thành phù hợp trên tài khoản Discord này.`,
      `${E('icon_clipboard')} Vui lòng gửi **tên sản phẩm · ngày mua gần đúng · email nhận hàng (nếu có) · nội dung chuyển khoản hoặc ảnh giao dịch**.`,
      `${E('cenar_support')} AI sẽ không tạo đơn 0đ hay lịch sử giả; thông tin sẽ được chuyển để staff xác minh thủ công.`,
    );
    const escalate = withButtonEmoji(
      new ButtonBuilder()
        .setCustomId(`${AI_SUPPORT_PREFIX}escalate:${ticket.id}`)
        .setLabel('Chuyển Staff Xác Minh')
        .setStyle(ButtonStyle.Secondary),
      E.component('cenar_support'),
    );
    rows.push(new ActionRowBuilder().addComponents(escalate));
  }
  return messagePayload(lines, validOrders.length ? accentFor('info') : accentFor('warning'), rows);
}

export async function sendTicketAiWelcome({ channel, ticket, guildId }) {
  if (!channel?.isTextBased?.() || !ticket || ticket.ticket_type === 'APPEAL') return null;
  const E = createEmojiResolver(guildId);
  const priceUrl = `https://discord.com/channels/${guildId}/1514606995842273280`;
  const lookup = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId(`${AI_SUPPORT_PREFIX}warranty_lookup:${ticket.id}`)
      .setLabel('Tra Đơn Bảo Hành')
      .setStyle(ButtonStyle.Secondary),
    E.component('warranty_shield'),
  );
  const prices = withButtonEmoji(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Xem Bảng Giá').setURL(priceUrl),
    E.component('icon_price'),
  );
  const typeLine = ticket.ticket_type === 'ORDER'
    ? 'Hãy gửi tên sản phẩm, thời hạn và số lượng. AI sẽ tư vấn từ bảng giá thật; khi bạn chốt, bot tạo bước xác nhận trước khi lên đơn.'
    : 'Hãy mô tả vấn đề. Nếu đây là yêu cầu bảo hành hoặc bạn tạo nhầm loại ticket, dùng nút tra đơn bên dưới.';
  return channel.send(messagePayload([
    `## ${E('icon_brain')} CENAR AI ĐANG TRỰC`,
    `> ${E('cenar_support')} ${typeLine}`,
    `${E('status_info')} Staff nhắn vào ticket sẽ tạm tiếp quản; AI tự quay lại sau thời gian tạm nghỉ nếu khách vẫn cần hỗ trợ.`,
    `${E('status_warn')} AI không xác nhận thanh toán, hoàn tiền, kết quả bảo hành hoặc yêu cầu mật khẩu/OTP.`,
  ], accentFor('info'), [new ActionRowBuilder().addComponents(lookup, prices)]));
}

async function sendWarrantyOpened(message, result, orderCode) {
  if (!result.channel?.id) {
    throw new Error('Hồ sơ bảo hành cũ không còn kênh xử lý; cần staff khôi phục thủ công.');
  }
  const E = createEmojiResolver(message.guildId);
  const text = result.reused
    ? `${E('status_info')} Đơn \`${orderCode}\` đã có hồ sơ bảo hành tại <#${result.channel.id}>.`
    : `${E('status_check')} Mình đã xác minh đơn \`${orderCode}\` thuộc đúng tài khoản của bạn và mở hồ sơ tại <#${result.channel.id}>.`;
  await message.channel.send({ content: text, allowedMentions: { parse: [] } });
}

export async function triageWarrantyMessage(message, ticket) {
  if (classifyCustomerIntent(message.content) !== 'WARRANTY') return false;
  const key = `${message.guildId}:${ticket.id}`;
  const now = Date.now();
  if ((warrantyGuideSlots.get(key) || 0) > now) return true;
  warrantyGuideSlots.set(key, now + 30_000);

  const orderCode = extractOrderCode(message.content);
  if (orderCode && ticket.ticket_type === 'WARRANTY' && ticket.related_order_code === orderCode) {
    return false;
  }

  if (orderCode) {
    try {
      const result = await openWarrantyTicket({
        guild: message.guild,
        customerId: message.author.id,
        actorId: message.client.user.id,
        orderCode,
        reason: short(message.content, 500),
      });
      await sendWarrantyOpened(message, result, orderCode);
    } catch (error) {
      const orders = matchWarrantyOrders(
        getCompletedOrdersByCustomer(message.guildId, message.author.id, 25),
        message.content,
      );
      await message.channel.send(buildWarrantyLookupPayload({
        ticket,
        guildId: message.guildId,
        orders,
        reason: 'Mã vừa gửi chưa thể xác minh với tài khoản Discord của bạn. Vui lòng chọn từ lịch sử bên dưới hoặc chuyển staff kiểm tra.',
      }));
    }
    return true;
  }

  const orders = matchWarrantyOrders(
    getCompletedOrdersByCustomer(message.guildId, message.author.id, 25),
    message.content,
  );
  await message.channel.send(buildWarrantyLookupPayload({ ticket, guildId: message.guildId, orders }));
  return true;
}

function resolveOrderProduct(guildId, productId) {
  const product = getProductById(Number(productId));
  if (!product || Number(product.is_active) !== 1) throw new Error('Sản phẩm này hiện không còn mở bán.');
  if (!['WEB', String(guildId)].includes(String(product.guild_id))) throw new Error('Sản phẩm không thuộc cửa hàng này.');
  if (!Number.isFinite(Number(product.price)) || Number(product.price) <= 0) {
    throw new Error('Sản phẩm cần staff báo giá trước khi tạo đơn.');
  }
  return product;
}

export async function prepareAiOrderConfirmation(message, { productId, quantity = 1 }) {
  const ticket = getTicketByChannelId(message.channel.id);
  if (!ticket || ticket.status !== 'OPEN' || ticket.ticket_type !== 'ORDER') {
    throw new Error('AI chỉ chuẩn bị đơn trong ticket mua hàng đang mở.');
  }
  if (ticket.customer_id !== message.author.id) throw new Error('Chỉ chủ ticket mới có thể chốt đơn.');
  const existing = getLatestOrderByTicketChannel(ticket.channel_id);
  if (existing && !['COMPLETED', 'CANCELLED'].includes(existing.status)) {
    throw new Error(`Ticket đã có đơn ${existing.order_code} đang xử lý.`);
  }

  const product = resolveOrderProduct(message.guildId, productId);
  const safeQuantity = Math.min(10, Math.max(1, Number.parseInt(quantity, 10) || 1));
  const total = Number(product.price) * safeQuantity;
  const E = createEmojiResolver(message.guildId);
  const confirm = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId(`${AI_SUPPORT_PREFIX}order_confirm:${ticket.id}:${product.id}:${safeQuantity}`)
      .setLabel('Xác Nhận Tạo Đơn')
      .setStyle(ButtonStyle.Success),
    E.component('status_check'),
  );
  const cancel = withButtonEmoji(
    new ButtonBuilder()
      .setCustomId(`${AI_SUPPORT_PREFIX}order_cancel:${ticket.id}`)
      .setLabel('Huỷ')
      .setStyle(ButtonStyle.Secondary),
    E.component('status_cross'),
  );
  await message.channel.send(messagePayload([
    `## ${E('icon_cart')} XÁC NHẬN ĐƠN DO AI CHUẨN BỊ`,
    `${E('order_product')} **Sản phẩm** — ${product.name}`,
    `${E('icon_duration')} **Thời hạn** — ${product.duration_days ? `${product.duration_days} ngày` : `${product.duration_months || 1} tháng`}`,
    `${E('icon_clipboard')} **Số lượng** — ${safeQuantity}`,
    `${E('payment_money')} **Tổng thanh toán** — ${money(total)}`,
    '',
    `${E('status_warn')} Kiểm tra kỹ rồi bấm xác nhận. Giá và thời hạn được lấy trực tiếp từ catalog; AI không được tự nhập số tiền.`,
  ], accentFor('warning'), [new ActionRowBuilder().addComponents(confirm, cancel)]));
  return { ticket, product, quantity: safeQuantity, total };
}

async function createVerifiedOrderFromInteraction(interaction, ticket, product, quantity) {
  const guildConfig = getGuildConfig(interaction.guildId);
  if (!guildConfig?.order_log_channel_id) throw new Error('Server chưa cấu hình kênh log đơn hàng.');
  const existing = getLatestOrderByTicketChannel(ticket.channel_id);
  if (existing && !['COMPLETED', 'CANCELLED'].includes(existing.status)) {
    throw new Error(`Ticket đã có đơn ${existing.order_code} đang xử lý.`);
  }
  const total = Number(product.price) * quantity;
  const order = createOrder({
    guildId: interaction.guildId,
    ticketId: ticket.id,
    ticketChannelId: ticket.channel_id,
    customerId: ticket.customer_id,
    productName: product.name,
    quantity,
    note: `AI hỗ trợ · catalog #${product.id} · khách xác nhận bằng nút`,
    totalAmount: total,
    durationMonths: product.duration_months || 1,
    durationDays: product.duration_days || null,
    orderLogChannelId: guildConfig.order_log_channel_id,
    createdById: interaction.client.user.id,
  });

  const orderLogChannel = await interaction.guild.channels.fetch(guildConfig.order_log_channel_id);
  const logMessage = await orderLogChannel.send({ content: buildOrderLogContent(order) });
  saveOrderLogMessage(order.order_code, logMessage.id);
  const queue = getQueuePosition(order);
  const { container: orderContainer, actionRow: orderActionRow, flags } = buildOrderCreatedV2(order, guildConfig.order_log_channel_id);
  const { container: queueContainer, actionRow: queueActionRow } = buildQueuePositionV2(order, queue.position, queue.total);
  await interaction.channel.send({
    components: [orderContainer, orderActionRow, queueContainer, queueActionRow],
    flags,
    allowedMentions: { users: [ticket.customer_id] },
  });

  try {
    await sendOrRefreshPaymentQr({ guild: interaction.guild, orderCode: order.order_code });
  } catch (payosError) {
    await sendVietQRPayment({ guild: interaction.guild, orderCode: order.order_code }).catch(async (vietqrError) => {
      const E = createEmojiResolver(interaction.guildId);
      await interaction.channel.send({
        content: `${E('status_warn')} Đơn đã tạo nhưng chưa sinh được QR. Staff đã nhận log để kiểm tra.`,
        allowedMentions: { parse: [] },
      });
      console.error('[AI ORDER] Không tạo được QR:', payosError.message, vietqrError.message);
    });
  }

  await emitStaffLog(interaction.client, {
    guildId: interaction.guildId,
    actorId: interaction.client.user.id,
    targetId: ticket.customer_id,
    action: 'AI_ORDER_CREATE_CONFIRMED',
    detail: `${product.name} x${quantity} · giá catalog ${total}`,
    relatedOrderCode: order.order_code,
    relatedTicketCode: ticket.ticket_code,
  });
  return order;
}

async function validateOwnedTicket(interaction, ticketId) {
  const ticket = getTicketById(Number(ticketId));
  if (!ticket || ticket.guild_id !== interaction.guildId || ticket.status !== 'OPEN') {
    throw new Error('Ticket không còn hoạt động.');
  }
  if (ticket.customer_id !== interaction.user.id) throw new Error('Chỉ chủ ticket mới dùng được thao tác này.');
  return ticket;
}

async function replyEphemeral(interaction, content) {
  const payload = typeof content === 'string' ? { content } : content;
  const next = {
    ...payload,
    flags: (Number(payload.flags) || 0) | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  };
  if (interaction.deferred) {
    const { flags: _flags, ...editPayload } = next;
    return interaction.editReply(editPayload);
  }
  return interaction.replied ? interaction.followUp(next) : interaction.reply(next);
}

export async function handleAiSupportInteraction(interaction) {
  if (!interaction.customId?.startsWith(AI_SUPPORT_PREFIX)) return false;
  if (!interaction.inGuild?.()) return true;
  const parts = interaction.customId.slice(AI_SUPPORT_PREFIX.length).split(':');
  const action = parts[0];
  const E = createEmojiResolver(interaction.guildId);

  try {
    if (!claimAiResponseSlot(
      `interaction:${interaction.guildId}:${interaction.user.id}:${action}`,
      action === 'order_confirm' ? 10 : 5,
    )) {
      await replyEphemeral(interaction, `${E('icon_clock')} Thao tác vừa được tiếp nhận; vui lòng không bấm liên tục.`);
      return true;
    }

    if (action === 'warranty_lookup') {
      const ticket = await validateOwnedTicket(interaction, parts[1]);
      const orders = getCompletedOrdersByCustomer(interaction.guildId, interaction.user.id, 25);
      await replyEphemeral(interaction, buildWarrantyLookupPayload({ ticket, guildId: interaction.guildId, orders }));
      return true;
    }

    if (action === 'warranty_select' && interaction.isStringSelectMenu()) {
      const ticket = await validateOwnedTicket(interaction, parts[1]);
      const orderCode = String(interaction.values[0] || '').toUpperCase();
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await openWarrantyTicket({
        guild: interaction.guild,
        customerId: interaction.user.id,
        actorId: interaction.client.user.id,
        orderCode,
        reason: 'Khách chọn đơn qua trợ lý AI',
      });
      if (!result.channel?.id) throw new Error('Hồ sơ bảo hành cũ không còn kênh xử lý; đã chuyển staff kiểm tra.');
      await interaction.editReply(`${E('status_check')} Đã ${result.reused ? 'mở lại' : 'tạo'} hồ sơ bảo hành tại <#${result.channel.id}>.`);
      return true;
    }

    if (action === 'escalate') {
      const ticket = await validateOwnedTicket(interaction, parts[1]);
      await emitAutomationLog(interaction.client, {
        guildId: interaction.guildId,
        customerId: interaction.user.id,
        action: 'AI_SUPPORT_ESCALATED',
        title: 'AI CHUYỂN YÊU CẦU CHO STAFF',
        summary: 'Khách không tìm thấy mã đơn hoặc lịch sử hoàn thành phù hợp; cần xác minh thủ công.',
        reference: ticket.ticket_code,
        status: 'warning',
        fields: [{ label: 'Ticket', value: `#${interaction.channel.name}`, emoji: 'ticket_open' }],
      });
      await replyEphemeral(interaction, `${E('status_check')} Đã chuyển yêu cầu sang staff. Hãy bổ sung tên sản phẩm, ngày mua gần đúng và bằng chứng thanh toán trong ticket này.`);
      return true;
    }

    if (action === 'order_cancel') {
      await validateOwnedTicket(interaction, parts[1]);
      const cancelled = messagePayload([
        `## ${E('status_cross')} ĐÃ HUỶ BƯỚC TẠO ĐƠN`,
        `${E('status_info')} Chưa có đơn hàng hoặc giao dịch thanh toán nào được tạo.`,
      ], accentFor('warning'));
      await interaction.update({
        components: cancelled.components,
        allowedMentions: { parse: [] },
      });
      return true;
    }

    if (action === 'order_confirm') {
      const ticket = await validateOwnedTicket(interaction, parts[1]);
      if (ticket.ticket_type !== 'ORDER') throw new Error('Đây không phải ticket mua hàng.');
      const product = resolveOrderProduct(interaction.guildId, parts[2]);
      const quantity = Math.min(10, Math.max(1, Number.parseInt(parts[3], 10) || 1));
      const lockKey = `${interaction.guildId}:${ticket.id}`;
      if (orderConfirmationLocks.has(lockKey)) throw new Error('Đơn đang được tạo, vui lòng không bấm lại.');
      orderConfirmationLocks.add(lockKey);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const order = await createVerifiedOrderFromInteraction(interaction, ticket, product, quantity);
        await interaction.editReply(`${E('status_check')} Đã tạo đơn \`${order.order_code}\` theo đúng giá catalog **${money(order.total_amount)}**.`);
        await interaction.message.edit({
          components: messagePayload([
            `## ${E('status_check')} ĐƠN ĐÃ ĐƯỢC XÁC NHẬN`,
            `${E('order_id')} Mã đơn — \`${order.order_code}\``,
            `${E('order_product')} ${product.name} · số lượng ${quantity}`,
            `${E('payment_money')} Tổng thanh toán — **${money(order.total_amount)}**`,
          ], accentFor('success')).components,
          allowedMentions: { parse: [] },
        }).catch(() => null);
      } finally {
        orderConfirmationLocks.delete(lockKey);
      }
      return true;
    }
  } catch (error) {
    console.error('[AI SUPPORT INTERACTION]', error);
    await replyEphemeral(interaction, `${E('status_warn')} ${error.message}`).catch(() => null);
    return true;
  }
  return false;
}

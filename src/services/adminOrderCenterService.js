import sharp from 'sharp';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { config } from '../config.js';
import { db, nowIso } from '../database/db.js';
import { createEmojiResolver } from '../utils/emojiHelper.js';
import { formatCurrency, getOrderStatusLabel, getPaymentStatusLabel } from '../utils/formatters.js';
import { isManager } from '../utils/permissions.js';
import { autoSyncGuildEmojis } from './emojiService.js';
import { getGuildConfig } from './guildConfigService.js';

const CATEGORY_NAME = '⌁ QUẢN TRỊ ĐƠN HÀNG';
const CHANNEL_NAME = '📦・trung-tam-don-hang';
const ACTIVE_STATUSES = [
  'PENDING_PAYMENT',
  'PROCESSING',
  'WAITING_STAFF',
  'WAITING_CUSTOMER',
  'DELIVERING',
  'WARRANTY_OPEN',
];
const PROCESSING_AGING_STATUSES = ACTIVE_STATUSES.filter((status) => status !== 'PENDING_PAYMENT');
const setupCache = new Map();
const refreshTimers = new Map();
const lastPanelRefreshAt = new Map();

const CUSTOM_EMOJIS = [
  { name: 'cenar_order_center', slot: 'admin_order_center', label: 'C', colors: ['#8B5CF6', '#EC4899'], glyph: '▤' },
  { name: 'cenar_order_week1', slot: 'admin_order_week1', label: '7D', colors: ['#F59E0B', '#FDE047'], glyph: '' },
  { name: 'cenar_order_week2', slot: 'admin_order_week2', label: '14D', colors: ['#DC2626', '#FB7185'], glyph: '' },
  { name: 'cenar_order_priority', slot: 'admin_order_priority', label: '', colors: ['#7C3AED', '#F97316'], glyph: '↑' },
];

function sqlPlaceholders(values) {
  return values.map(() => '?').join(',');
}

function toUnix(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function ageDays(value, nowMs = Date.now()) {
  const createdMs = new Date(value).getTime();
  if (!Number.isFinite(createdMs)) return 0;
  return Math.max(0, Math.floor((nowMs - createdMs) / 86_400_000));
}

function trimText(value, max = 80, fallback = '—') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

function componentEmoji(E, slot) {
  return E.component(slot) || undefined;
}

function addEmoji(button, emoji) {
  if (emoji) button.setEmoji(emoji);
  return button;
}

function orderTicketLink(order) {
  if (!/^\d{17,20}$/.test(String(order.ticket_channel_id || ''))) return null;
  return `https://discord.com/channels/${order.guild_id}/${order.ticket_channel_id}`;
}

function getActiveOrders(guildId, limit = 12) {
  return db.prepare(`
    SELECT * FROM orders
    WHERE guild_id = ? AND status IN (${sqlPlaceholders(ACTIVE_STATUSES)})
    ORDER BY
      CASE WHEN datetime(created_at) <= datetime('now', '-14 days') THEN 0
           WHEN datetime(created_at) <= datetime('now', '-7 days') THEN 1
           ELSE 2 END,
      priority_rank DESC,
      datetime(created_at) ASC,
      id ASC
    LIMIT ?
  `).all(guildId, ...ACTIVE_STATUSES, limit);
}

function getAdminSummary(guildId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'PENDING_PAYMENT' THEN 1 ELSE 0 END) AS pending_payment,
      SUM(CASE WHEN status = 'PROCESSING' THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN claimed_by_id IS NULL AND status != 'PENDING_PAYMENT' THEN 1 ELSE 0 END) AS unclaimed,
      SUM(CASE WHEN status != 'PENDING_PAYMENT' AND datetime(created_at) <= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS week_one,
      SUM(CASE WHEN status != 'PENDING_PAYMENT' AND datetime(created_at) <= datetime('now', '-14 days') THEN 1 ELSE 0 END) AS week_two
    FROM orders
    WHERE guild_id = ? AND status IN (${sqlPlaceholders(ACTIVE_STATUSES)})
  `).get(guildId, ...ACTIVE_STATUSES) || {};
  return {
    total: Number(row.total || 0),
    pendingPayment: Number(row.pending_payment || 0),
    processing: Number(row.processing || 0),
    unclaimed: Number(row.unclaimed || 0),
    weekOne: Number(row.week_one || 0),
    weekTwo: Number(row.week_two || 0),
  };
}

export function selectAgingReminderStage(order, nowMs = Date.now(), options = {}) {
  if (!order || !PROCESSING_AGING_STATUSES.includes(String(order.status))) return null;
  const days = ageDays(order.created_at, nowMs);
  const weekOneDays = Number(options.weekOneDays ?? config.adminOrderReminderWeekOneDays);
  const weekTwoDays = Number(options.weekTwoDays ?? config.adminOrderReminderWeekTwoDays);
  if (days >= weekTwoDays && !order.admin_age_reminder_2w_sent_at) return 'week2';
  if (days >= weekOneDays && !order.admin_age_reminder_1w_sent_at) return 'week1';
  return null;
}

function emojiSvg({ label, colors, glyph }) {
  const main = glyph || label;
  const fontSize = label.length >= 3 ? 39 : (label.length === 2 ? 48 : 70);
  return Buffer.from(`
    <svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="8" y1="8" x2="120" y2="120" gradientUnits="userSpaceOnUse">
          <stop stop-color="${colors[0]}"/><stop offset="1" stop-color="${colors[1]}"/>
        </linearGradient>
        <filter id="s"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-opacity=".3"/></filter>
      </defs>
      <rect x="8" y="8" width="112" height="112" rx="30" fill="url(#g)" filter="url(#s)"/>
      <rect x="13" y="13" width="102" height="102" rx="25" fill="none" stroke="white" stroke-opacity=".28" stroke-width="3"/>
      <text x="64" y="70" dominant-baseline="middle" text-anchor="middle" fill="white"
        font-family="Arial, Segoe UI, sans-serif" font-size="${fontSize}" font-weight="800">${main}</text>
      ${glyph && label ? `<text x="96" y="103" text-anchor="middle" fill="white" font-family="Arial" font-size="24" font-weight="800">${label}</text>` : ''}
    </svg>
  `);
}

export async function ensureAdminOrderEmojis(guild) {
  if (!guild || String(guild.id) !== String(config.storeOneGuildId)) return { created: [], existing: [] };
  await guild.emojis.fetch().catch(() => null);
  const created = [];
  const existing = [];

  for (const definition of CUSTOM_EMOJIS) {
    const found = guild.emojis.cache.find((emoji) => emoji.name === definition.name);
    if (found) {
      existing.push(found.name);
      continue;
    }
    try {
      const png = await sharp(emojiSvg(definition)).resize(128, 128).png({ compressionLevel: 9 }).toBuffer();
      const emoji = await guild.emojis.create({
        attachment: png,
        name: definition.name,
        reason: 'Cenar Store 1 · giao diện Trung tâm đơn admin',
      });
      created.push(emoji.name);
    } catch (error) {
      console.error(`[ADMIN-ORDER-CENTER] Không thể tạo emoji ${definition.name}:`, error.message);
    }
  }

  autoSyncGuildEmojis(guild);
  return { created, existing };
}

function privateOverwrites(guild, guildConfig) {
  const entries = new Map();
  entries.set(guild.roles.everyone.id, {
    id: guild.roles.everyone.id,
    deny: [PermissionFlagsBits.ViewChannel],
  });
  entries.set(guild.client.user.id, {
    id: guild.client.user.id,
    allow: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.EmbedLinks,
    ],
  });
  const adminRoleIds = [guildConfig?.manager_role_id, ...config.ownerRoleIds].filter(Boolean);
  for (const roleId of adminRoleIds) {
    if (!guild.roles.cache.has(String(roleId))) continue;
    entries.set(String(roleId), {
      id: String(roleId),
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
      ],
    });
  }
  return [...entries.values()];
}

export async function ensureAdminOrderCenter(guild) {
  if (!guild || String(guild.id) !== String(config.storeOneGuildId)) return null;
  const cached = setupCache.get(guild.id);
  if (cached?.channel && !cached.channel.deleted) return cached;

  const guildConfig = getGuildConfig(guild.id);
  if (!guildConfig) {
    console.warn(`[ADMIN-ORDER-CENTER] Guild ${guild.id} chưa có guild_settings; bỏ qua auto-setup.`);
    return null;
  }

  await guild.channels.fetch().catch(() => null);
  await guild.roles.fetch().catch(() => null);
  const emojiResult = await ensureAdminOrderEmojis(guild);
  const overwrites = privateOverwrites(guild, guildConfig);

  let category = guildConfig.admin_order_category_id
    ? await guild.channels.fetch(guildConfig.admin_order_category_id).catch(() => null)
    : null;
  if (!category || category.type !== ChannelType.GuildCategory) {
    category = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name === CATEGORY_NAME) || null;
  }
  if (!category) {
    category = await guild.channels.create({
      name: CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      permissionOverwrites: overwrites,
      reason: 'Cenar Store 1 · Trung tâm quản trị đơn hàng',
    });
  }

  let channel = guildConfig.admin_order_channel_id
    ? await guild.channels.fetch(guildConfig.admin_order_channel_id).catch(() => null)
    : null;
  if (!channel?.isTextBased()) {
    channel = guild.channels.cache.find((candidate) => (
      candidate.type === ChannelType.GuildText
      && candidate.parentId === category.id
      && candidate.name === CHANNEL_NAME
    )) || null;
  }
  if (!channel) {
    channel = await guild.channels.create({
      name: CHANNEL_NAME,
      topic: 'Bảng điều phối đơn nội bộ · tự động ưu tiên đơn tồn 7/14 ngày · chỉ Admin/Manager',
      type: ChannelType.GuildText,
      parent: category.id,
      permissionOverwrites: overwrites,
      reason: 'Cenar Store 1 · Trung tâm quản trị đơn hàng',
    });
  } else {
    for (const overwrite of overwrites) {
      await channel.permissionOverwrites.edit(overwrite.id, {
        ViewChannel: overwrite.deny ? false : true,
        SendMessages: overwrite.allow ? true : undefined,
        ReadMessageHistory: overwrite.allow ? true : undefined,
      }).catch(() => null);
    }
  }

  db.prepare(`
    UPDATE guild_settings
    SET admin_order_category_id = ?, admin_order_channel_id = ?, updated_at = ?
    WHERE guild_id = ?
  `).run(category.id, channel.id, nowIso(), guild.id);

  const result = { category, channel, emojiResult };
  setupCache.set(guild.id, result);
  return result;
}

export function buildAdminOrderCenterPanel({ guildId, orders, summary, refreshedAt = new Date() }) {
  const E = createEmojiResolver(guildId);
  const container = new ContainerBuilder().setAccentColor(0xA855F7);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `# ${E('admin_order_center')} TRUNG TÂM ĐIỀU PHỐI ĐƠN`,
    '> Bảng nội bộ Store 1 · đơn cũ được đẩy lên trước để Admin không bỏ sót.',
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('icon_chart')} **Đang mở:** ${summary.total}  ·  ${E('order_pending')} **Chờ thanh toán:** ${summary.pendingPayment}  ·  ${E('order_processing')} **Đang xử lý:** ${summary.processing}`,
    `${E('ticket_claim')} **Chưa claim:** ${summary.unclaimed}  ·  ${E('admin_order_week1')} **Từ 7 ngày:** ${summary.weekOne}  ·  ${E('admin_order_week2')} **Từ 14 ngày:** ${summary.weekTwo}`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));

  const rows = orders.length ? orders.map((order, index) => {
    const age = ageDays(order.created_at, refreshedAt.getTime());
    const urgency = age >= config.adminOrderReminderWeekTwoDays
      ? E('admin_order_week2')
      : (age >= config.adminOrderReminderWeekOneDays ? E('admin_order_week1') : E('order_queue'));
    const ticket = /^\d{17,20}$/.test(String(order.ticket_channel_id || '')) ? `<#${order.ticket_channel_id}>` : 'không có kênh';
    return `${urgency} **${index + 1}. \`${order.order_code}\`** · <@${order.customer_id}> · **${trimText(order.product_name, 44)}** · ${age} ngày · ${getOrderStatusLabel(order.status, guildId)} · ${ticket}`;
  }) : [`${E('status_check')} Không có đơn đang mở. Hàng đợi hiện đã sạch.`];
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(rows.join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small));
  const refreshedUnix = Math.floor(refreshedAt.getTime() / 1000);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `-# ${E('icon_clock')} Cập nhật <t:${refreshedUnix}:R> · hiển thị tối đa ${orders.length || 0} đơn ưu tiên · dùng Tra cứu để xem toàn bộ chi tiết`,
  ));

  const refreshButton = addEmoji(
    new ButtonBuilder().setCustomId('adminorder:refresh').setLabel('Làm mới').setStyle(ButtonStyle.Primary),
    componentEmoji(E, 'admin_order_center'),
  );
  const agingButton = addEmoji(
    new ButtonBuilder().setCustomId('adminorder:aging').setLabel('Đơn 7–14 ngày').setStyle(ButtonStyle.Secondary),
    componentEmoji(E, 'admin_order_week1'),
  );
  const lookupButton = addEmoji(
    new ButtonBuilder().setCustomId('adminorder:lookup').setLabel('Tra cứu đơn').setStyle(ButtonStyle.Success),
    componentEmoji(E, 'icon_search'),
  );
  return {
    components: [container, new ActionRowBuilder().addComponents(refreshButton, agingButton, lookupButton)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
}

export function buildAdminOrderDetailPayload(order, { reminderStage = null, roleIds = [] } = {}) {
  const E = createEmojiResolver(order.guild_id);
  const age = ageDays(order.created_at);
  const isWeekTwo = reminderStage === 'week2';
  const headerEmoji = reminderStage
    ? E(isWeekTwo ? 'admin_order_week2' : 'admin_order_week1')
    : E('admin_order_center');
  const title = reminderStage
    ? `ĐƠN TỒN ${isWeekTwo ? '14+ NGÀY · ƯU TIÊN KHẨN' : '7+ NGÀY · CẦN ƯU TIÊN'}`
    : `CHI TIẾT ĐƠN ${order.order_code}`;
  const mentionLine = roleIds.length ? roleIds.map((id) => `<@&${id}>`).join(' ') : null;
  const createdUnix = toUnix(order.created_at);
  const updatedUnix = toUnix(order.updated_at);
  const paidUnix = toUnix(order.paid_at);
  const completedUnix = toUnix(order.completed_at);
  const ticket = /^\d{17,20}$/.test(String(order.ticket_channel_id || '')) ? `<#${order.ticket_channel_id}>` : '`không có / đã xóa`';

  const container = new ContainerBuilder().setAccentColor(isWeekTwo ? 0xEF4444 : (reminderStage ? 0xF59E0B : 0x8B5CF6));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${headerEmoji} ${title}`,
    mentionLine,
    reminderStage ? `> ${E('admin_order_priority')} Đơn đã nằm trong hệ thống **${age} ngày**. Vui lòng kiểm tra, claim và xử lý trước các đơn mới.` : null,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('order_id')} **Mã đơn:** \`${order.order_code}\``,
    `${E('ticket_user')} **Khách hàng:** <@${order.customer_id}> · \`${order.customer_id}\``,
    `${E('order_product')} **Sản phẩm:** ${trimText(order.product_name, 180)} · SL **${order.quantity || 1}**`,
    `${E('icon_edit')} **Ghi chú:** ${trimText(order.note, 260)}`,
    `${E('payment_money')} **Giá trị:** ${formatCurrency(order.total_amount)} · đã nhận **${formatCurrency(order.amount_paid)}**`,
    `${E('icon_chart')} **Đơn / thanh toán:** ${getOrderStatusLabel(order.status, order.guild_id)} · ${getPaymentStatusLabel(order.payment_status, order.guild_id)}`,
  ].join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `${E('ticket_open')} **Ticket:** ${ticket} · ID \`${order.ticket_id}\``,
    `${E('ticket_claim')} **Người nhận:** ${order.claimed_by_id ? `<@${order.claimed_by_id}>` : '**Chưa có Admin claim**'}`,
    `${E('payment_payos')} **Cổng thanh toán:** ${trimText(order.payment_provider, 40)}${order.paid_transaction_id ? ` · GD \`${trimText(order.paid_transaction_id, 70)}\`` : ''}`,
    `${E('icon_clock')} **Tạo:** ${createdUnix ? `<t:${createdUnix}:F> · <t:${createdUnix}:R>` : '—'} · **${age} ngày**`,
    `${E('icon_history')} **Cập nhật:** ${updatedUnix ? `<t:${updatedUnix}:R>` : '—'}${paidUnix ? ` · trả tiền <t:${paidUnix}:R>` : ''}${completedUnix ? ` · hoàn thành <t:${completedUnix}:R>` : ''}`,
    `${E('icon_key')} **Dữ liệu giao hàng:** ${order.credential_email || order.credential_password ? 'đã lưu trong hệ thống bảo mật' : 'chưa có'}`,
  ].join('\n')));

  const buttons = [];
  if (!['COMPLETED', 'CANCELLED', 'FAILED'].includes(order.status)) {
    buttons.push(addEmoji(
      new ButtonBuilder().setCustomId(`order:claim:${order.order_code}`).setLabel('Claim ưu tiên').setStyle(ButtonStyle.Primary),
      componentEmoji(E, 'admin_order_priority'),
    ));
  }
  const ticketLink = orderTicketLink(order);
  if (ticketLink) {
    buttons.push(addEmoji(
      new ButtonBuilder().setURL(ticketLink).setLabel('Mở ticket').setStyle(ButtonStyle.Link),
      componentEmoji(E, 'ticket_open'),
    ));
  }

  return {
    components: buttons.length ? [container, new ActionRowBuilder().addComponents(...buttons)] : [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], roles: roleIds },
  };
}

function buildAgingListPayload(guildId) {
  const E = createEmojiResolver(guildId);
  const orders = db.prepare(`
    SELECT * FROM orders
    WHERE guild_id = ?
      AND status IN (${sqlPlaceholders(PROCESSING_AGING_STATUSES)})
      AND datetime(created_at) <= datetime('now', ?)
    ORDER BY datetime(created_at) ASC, priority_rank DESC
    LIMIT 15
  `).all(guildId, ...PROCESSING_AGING_STATUSES, `-${config.adminOrderReminderWeekOneDays} days`);
  const container = new ContainerBuilder().setAccentColor(0xF59E0B);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${E('admin_order_priority')} HÀNG ĐỢI ƯU TIÊN 7–14 NGÀY\n> Sắp xếp cũ nhất trước. Bấm **Tra cứu đơn** để xem toàn bộ thông tin một mã cụ thể.`,
  ));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const lines = orders.length ? orders.map((order, index) => {
    const days = ageDays(order.created_at);
    const icon = days >= config.adminOrderReminderWeekTwoDays ? E('admin_order_week2') : E('admin_order_week1');
    return `${icon} **${index + 1}. \`${order.order_code}\`** · ${days} ngày · <@${order.customer_id}> · ${trimText(order.product_name, 55)} · ${order.claimed_by_id ? `<@${order.claimed_by_id}>` : '**chưa claim**'}`;
  }) : [`${E('status_check')} Hiện không có đơn xử lý nào tồn từ ${config.adminOrderReminderWeekOneDays} ngày.`];
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  return { components: [container], flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

export async function refreshAdminOrderCenter(guild, { force = false } = {}) {
  if (!guild || String(guild.id) !== String(config.storeOneGuildId)) return null;
  const lastRefresh = lastPanelRefreshAt.get(guild.id) || 0;
  if (!force && Date.now() - lastRefresh < 4 * 60 * 1000) return null;

  const setup = await ensureAdminOrderCenter(guild);
  if (!setup?.channel?.isTextBased()) return null;
  const currentConfig = getGuildConfig(guild.id);
  const payload = buildAdminOrderCenterPanel({
    guildId: guild.id,
    orders: getActiveOrders(guild.id),
    summary: getAdminSummary(guild.id),
    refreshedAt: new Date(),
  });

  let panelMessage = currentConfig?.admin_order_panel_message_id
    ? await setup.channel.messages.fetch(currentConfig.admin_order_panel_message_id).catch(() => null)
    : null;
  if (panelMessage) {
    await panelMessage.edit(payload);
  } else {
    panelMessage = await setup.channel.send(payload);
    await panelMessage.pin('Cenar Store 1 · ghim Trung tâm điều phối đơn').catch(() => null);
    db.prepare(`
      UPDATE guild_settings
      SET admin_order_panel_message_id = ?, updated_at = ?
      WHERE guild_id = ?
    `).run(panelMessage.id, nowIso(), guild.id);
  }
  lastPanelRefreshAt.set(guild.id, Date.now());
  return { ...setup, panelMessage };
}

export function scheduleAdminOrderCenterRefresh(guildId, delayMs = 1500) {
  if (String(guildId) !== String(config.storeOneGuildId)) return;
  if (refreshTimers.has(guildId)) clearTimeout(refreshTimers.get(guildId));
  const timer = setTimeout(async () => {
    refreshTimers.delete(guildId);
    const client = global.discordClient;
    const guild = client?.guilds?.cache?.get(guildId)
      || await client?.guilds?.fetch?.(guildId).catch(() => null);
    if (guild) await refreshAdminOrderCenter(guild, { force: true }).catch((error) => {
      console.error('[ADMIN-ORDER-CENTER] Refresh error:', error.message);
    });
  }, delayMs);
  timer.unref?.();
  refreshTimers.set(guildId, timer);
}

export async function processAdminOrderAgingReminders(client) {
  const guild = client?.guilds?.cache?.get(config.storeOneGuildId)
    || await client?.guilds?.fetch?.(config.storeOneGuildId).catch(() => null);
  if (!guild) return { sent: 0, skipped: true };
  const setup = await ensureAdminOrderCenter(guild);
  if (!setup?.channel?.isTextBased()) return { sent: 0, skipped: true };

  const guildConfig = getGuildConfig(guild.id);
  const roleIds = [...new Set([guildConfig?.manager_role_id, ...config.ownerRoleIds]
    .filter((id) => id && guild.roles.cache.has(String(id)))
    .map(String))];
  const candidates = db.prepare(`
    SELECT * FROM orders
    WHERE guild_id = ? AND status IN (${sqlPlaceholders(PROCESSING_AGING_STATUSES)})
    ORDER BY datetime(created_at) ASC
    LIMIT 100
  `).all(guild.id, ...PROCESSING_AGING_STATUSES);

  let sent = 0;
  for (const order of candidates) {
    if (sent >= 10) break;
    const stage = selectAgingReminderStage(order);
    if (!stage) continue;
    const message = await setup.channel.send(buildAdminOrderDetailPayload(order, {
      reminderStage: stage,
      roleIds,
    })).catch((error) => {
      console.error(`[ADMIN-ORDER-CENTER] Reminder ${order.order_code} failed:`, error.message);
      return null;
    });
    if (!message) continue;
    const timestamp = nowIso();
    if (stage === 'week2') {
      db.prepare(`
        UPDATE orders
        SET admin_age_reminder_1w_sent_at = COALESCE(admin_age_reminder_1w_sent_at, ?),
            admin_age_reminder_2w_sent_at = ?, updated_at = ?
        WHERE order_code = ?
      `).run(timestamp, timestamp, timestamp, order.order_code);
    } else {
      db.prepare(`
        UPDATE orders SET admin_age_reminder_1w_sent_at = ?, updated_at = ? WHERE order_code = ?
      `).run(timestamp, timestamp, order.order_code);
    }
    sent += 1;
  }
  await refreshAdminOrderCenter(guild, { force: sent > 0 }).catch(() => null);
  return { sent, skipped: false };
}

export async function handleAdminOrderCenterInteraction(interaction) {
  if (!interaction.inGuild() || String(interaction.guildId) !== String(config.storeOneGuildId)) return false;
  if (!String(interaction.customId || '').startsWith('adminorder:')) return false;
  const guildConfig = getGuildConfig(interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => interaction.member ?? null);
  if (!isManager(member, guildConfig)) {
    await interaction.reply({ content: 'Bạn cần quyền Admin / Manager để dùng Trung tâm đơn.', flags: MessageFlags.Ephemeral }).catch(() => null);
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'adminorder:lookup') {
    const input = new TextInputBuilder()
      .setCustomId('order_code')
      .setLabel('Mã đơn cần tra cứu')
      .setPlaceholder('Ví dụ: CN_123456')
      .setRequired(true)
      .setMaxLength(32)
      .setStyle(TextInputStyle.Short);
    const modal = new ModalBuilder()
      .setCustomId('adminorder:lookup:modal')
      .setTitle('Tra cứu toàn bộ thông tin đơn')
      .addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.isModalSubmit() && interaction.customId === 'adminorder:lookup:modal') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const code = interaction.fields.getTextInputValue('order_code').trim().toUpperCase();
    const order = db.prepare('SELECT * FROM orders WHERE guild_id = ? AND order_code = ?').get(interaction.guildId, code);
    if (!order) {
      await interaction.editReply({ content: `Không tìm thấy đơn \`${trimText(code, 32)}\` trong Store 1.` });
      return true;
    }
    const payload = buildAdminOrderDetailPayload(order);
    await interaction.editReply({ ...payload, flags: payload.flags | MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'adminorder:aging') {
    await interaction.reply(buildAgingListPayload(interaction.guildId));
    return true;
  }

  if (interaction.isButton() && interaction.customId === 'adminorder:refresh') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await refreshAdminOrderCenter(interaction.guild, { force: true });
    await interaction.editReply({ content: 'Đã làm mới hàng đợi và số liệu Trung tâm đơn.' });
    return true;
  }

  return false;
}

export const adminOrderCenterInternals = {
  ACTIVE_STATUSES,
  PROCESSING_AGING_STATUSES,
  ageDays,
  getAdminSummary,
  getActiveOrders,
};

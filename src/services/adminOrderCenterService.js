import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
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
import { formatCurrency, formatOrderDuration, getOrderStatusLabel, getPaymentStatusLabel } from '../utils/formatters.js';
import { isManager } from '../utils/permissions.js';
import { autoSyncGuildEmojis, formatProductDisplayName } from './emojiService.js';
import { getGuildConfig } from './guildConfigService.js';
import { STORE_ONE_CHANNEL_NAMES } from '../config/storeOneChannelAesthetic.js';

const CATEGORY_NAME = STORE_ONE_CHANNEL_NAMES.adminOrderCategory;
const CHANNEL_NAME = STORE_ONE_CHANNEL_NAMES.adminOrderCenter;
const ACTIVE_STATUSES = [
  'PENDING_PAYMENT',
  'PROCESSING',
  'WAITING_STAFF',
  'WAITING_CUSTOMER',
  'DELIVERING',
  'WARRANTY_OPEN',
];
const PROCESSING_AGING_STATUSES = ACTIVE_STATUSES.filter((status) => status !== 'PENDING_PAYMENT');
const WARRANTY_STATUSES = new Set(['WARRANTY', 'WARRANTY_OPEN']);
const ADMIN_AGING_ANCHOR_SQL = `CASE
  WHEN status IN ('WARRANTY', 'WARRANTY_OPEN')
    THEN COALESCE(NULLIF(status_changed_at, ''), NULLIF(updated_at, ''), created_at)
  ELSE created_at
END`;
const setupCache = new Map();
const refreshTimers = new Map();
const lastPanelRefreshAt = new Map();
const ticketChannelCache = new Map();
const customerIdentityCache = new Map();
const TICKET_CHANNEL_CACHE_TTL_MS = 5 * 60 * 1000;
const CUSTOMER_IDENTITY_CACHE_TTL_MS = 15 * 60 * 1000;
const COMPACT_CARD_UI_VERSION = '2026-09-05-aging-lifecycle-v3';
const LEGACY_WARRANTY_AGING_MIGRATION = '2026-09-05-reset-warranty-aging-anchor-v1';
const RESERVATION_TTL_MS = 10 * 60 * 1000;

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

export function getAdminOrderAgingAnchor(order) {
  if (!order) return null;
  if (WARRANTY_STATUSES.has(String(order.status || '').toUpperCase())) {
    return order.status_changed_at || order.updated_at || order.created_at || null;
  }
  return order.created_at || null;
}

export function getAdminOrderAgeDays(order, nowMs = Date.now()) {
  return ageDays(getAdminOrderAgingAnchor(order), nowMs);
}

export function getAdminOrderAgingLifecycleKey(order) {
  const status = String(order?.status || '').toUpperCase();
  const scope = WARRANTY_STATUSES.has(status) ? 'WARRANTY' : 'ORDER';
  const anchor = getAdminOrderAgingAnchor(order);
  const anchorMs = new Date(anchor).getTime();
  const normalizedAnchor = Number.isFinite(anchorMs) ? new Date(anchorMs).toISOString() : String(anchor || 'unknown');
  return `${scope}:${normalizedAnchor}`;
}

function reminderMarkerBelongsToLifecycle(markerAt, anchorAt) {
  if (!markerAt) return false;
  const markerMs = new Date(markerAt).getTime();
  const anchorMs = new Date(anchorAt).getTime();
  return Number.isFinite(markerMs) && Number.isFinite(anchorMs) && markerMs >= anchorMs;
}

function agingStageByElapsedDays(days, { weekOneDays, weekTwoDays }) {
  if (days >= weekTwoDays) return 'week2';
  if (days >= weekOneDays) return 'week1';
  return null;
}

function trimText(value, max = 80, fallback = '—') {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return fallback;
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

function formatAdminProductName(guildId, productName, E, max = 80) {
  const displayName = formatProductDisplayName(guildId, productName, E);
  return trimText(displayName, max, 'Dịch vụ Cenar');
}

function componentEmoji(E, slot) {
  return E.component(slot) || undefined;
}

function addEmoji(button, emoji) {
  if (emoji) button.setEmoji(emoji);
  return button;
}

function orderTicketLink(order, ticketChannelId) {
  if (!/^\d{17,20}$/.test(String(ticketChannelId || ''))) return null;
  return `https://discord.com/channels/${order.guild_id}/${ticketChannelId}`;
}

function getOrderTicketCandidates(order) {
  const ticketId = Number(order.ticket_id);
  const rows = db.prepare(`
    SELECT channel_id
    FROM tickets
    WHERE guild_id = ?
      AND (related_order_code = ? OR id = ? OR channel_id = ?)
    ORDER BY
      CASE WHEN status = 'OPEN' THEN 0 ELSE 1 END,
      CASE WHEN related_order_code = ? THEN 0 ELSE 1 END,
      id DESC
  `).all(
    order.guild_id,
    order.order_code,
    Number.isSafeInteger(ticketId) ? ticketId : -1,
    String(order.ticket_channel_id || ''),
    order.order_code,
  );
  return [...new Set([
    ...rows.map((row) => String(row.channel_id || '')),
    String(order.ticket_channel_id || ''),
  ].filter((channelId) => /^\d{17,20}$/.test(channelId)))];
}

async function fetchLiveGuildChannel(guild, channelId) {
  const cached = ticketChannelCache.get(channelId);
  if (cached && Date.now() - cached.checkedAt < TICKET_CHANNEL_CACHE_TTL_MS) {
    if (!cached.exists) return null;
    return guild.channels.cache.get(channelId)
      || await guild.channels.fetch(channelId).catch(() => null);
  }
  const channel = guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null);
  ticketChannelCache.set(channelId, { exists: Boolean(channel), checkedAt: Date.now() });
  return channel;
}

export async function resolveOrderTicketChannel(guild, order) {
  if (!guild || !order || String(guild.id) !== String(order.guild_id)) return null;
  for (const channelId of getOrderTicketCandidates(order)) {
    const channel = await fetchLiveGuildChannel(guild, channelId);
    if (channel?.isTextBased?.()) return channel;
  }
  return null;
}

function safeDiscordDisplay(value, max = 48) {
  return trimText(value, max, 'Tài khoản Discord')
    .replace(/([\\`*_~|>])/g, '\\$1')
    .replaceAll('<', '‹')
    .replaceAll('@', '＠');
}

export async function resolveOrderCustomerIdentity(guild, order) {
  const customerId = String(order?.customer_id || '').trim();
  if (!/^\d{17,20}$/.test(customerId)) return `ID \`${trimText(customerId, 32, 'không hợp lệ')}\``;
  const cacheKey = `${guild?.id || order?.guild_id}:${customerId}`;
  const cached = customerIdentityCache.get(cacheKey);
  if (cached && Date.now() - cached.checkedAt < CUSTOMER_IDENTITY_CACHE_TTL_MS) return cached.label;

  const member = guild?.members?.cache?.get(customerId)
    || await guild?.members?.fetch?.(customerId).catch(() => null);
  const user = member?.user
    || guild?.client?.users?.cache?.get(customerId)
    || await guild?.client?.users?.fetch?.(customerId).catch(() => null);
  let label;
  if (user) {
    const displayName = safeDiscordDisplay(member?.displayName || user.globalName || user.username);
    const username = String(user.username || '').replaceAll('`', "'").slice(0, 32);
    label = `**${displayName}**${username ? ` · \`@${username}\`` : ''} · ID \`${customerId}\``;
  } else {
    label = `**Không lấy được hồ sơ Discord** · ID \`${customerId}\``;
  }
  customerIdentityCache.set(cacheKey, { label, checkedAt: Date.now() });
  return label;
}

function getActiveOrders(guildId, limit = 12) {
  return db.prepare(`
    SELECT * FROM orders
    WHERE guild_id = ? AND status IN (${sqlPlaceholders(ACTIVE_STATUSES)})
    ORDER BY
      CASE WHEN datetime(${ADMIN_AGING_ANCHOR_SQL}) <= datetime('now', '-14 days') THEN 0
           WHEN datetime(${ADMIN_AGING_ANCHOR_SQL}) <= datetime('now', '-7 days') THEN 1
           ELSE 2 END,
      priority_rank DESC,
      datetime(${ADMIN_AGING_ANCHOR_SQL}) ASC,
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
      SUM(CASE WHEN status != 'PENDING_PAYMENT' AND datetime(${ADMIN_AGING_ANCHOR_SQL}) <= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS week_one,
      SUM(CASE WHEN status != 'PENDING_PAYMENT' AND datetime(${ADMIN_AGING_ANCHOR_SQL}) <= datetime('now', '-14 days') THEN 1 ELSE 0 END) AS week_two
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
  const anchor = getAdminOrderAgingAnchor(order);
  const days = ageDays(anchor, nowMs);
  const weekOneDays = Number(options.weekOneDays ?? config.adminOrderReminderWeekOneDays);
  const weekTwoDays = Number(options.weekTwoDays ?? config.adminOrderReminderWeekTwoDays);
  const weekOneSent = reminderMarkerBelongsToLifecycle(order.admin_age_reminder_1w_sent_at, anchor);
  const weekTwoSent = reminderMarkerBelongsToLifecycle(order.admin_age_reminder_2w_sent_at, anchor);
  if (days >= weekTwoDays) return weekTwoSent ? null : 'week2';
  if (days >= weekOneDays) return (weekOneSent || weekTwoSent) ? null : 'week1';
  return null;
}

export function resetLegacyWarrantyAgingStateOnce() {
  const markerKey = `migration:${LEGACY_WARRANTY_AGING_MIGRATION}`;
  const existing = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(markerKey);
  if (existing) return { changed: 0, skipped: true };
  const appliedAt = nowIso();
  const changed = db.transaction(() => {
    const result = db.prepare(`
      UPDATE orders
      SET admin_age_reminder_1w_sent_at = NULL,
          admin_age_reminder_2w_sent_at = NULL
      WHERE status IN ('WARRANTY', 'WARRANTY_OPEN')
    `).run();
    db.prepare(`
      UPDATE admin_order_aging_reminders
      SET state = CASE WHEN state = 'SENT' THEN 'SUPERSEDED' ELSE 'RESOLVED' END,
          resolution_reason = 'LEGACY_WARRANTY_AGING_RESET'
      WHERE state IN ('RESERVED', 'SENT')
        AND order_code IN (
          SELECT order_code FROM orders WHERE status IN ('WARRANTY', 'WARRANTY_OPEN')
        )
    `).run();
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, ?)
    `).run(markerKey, JSON.stringify({ changed: result.changes, appliedAt }), appliedAt);
    return result.changes;
  })();
  return { changed, skipped: false };
}

export function markAdminOrderReminderLifecycleChanged(previousOrder, updatedOrder) {
  if (!previousOrder || !updatedOrder || previousOrder.status === updatedOrder.status) return { changed: false };
  const previousStatus = String(previousOrder.status || '').toUpperCase();
  const nextStatus = String(updatedOrder.status || '').toUpperCase();
  const enteringWarranty = WARRANTY_STATUSES.has(nextStatus) && !WARRANTY_STATUSES.has(previousStatus);
  const leavingAgingQueue = !PROCESSING_AGING_STATUSES.includes(nextStatus);
  if (!enteringWarranty && !leavingAgingQueue) return { changed: false };

  const reason = enteringWarranty ? 'WARRANTY_LIFECYCLE_STARTED' : `ORDER_STATUS_${nextStatus || 'UNKNOWN'}`;
  db.transaction(() => {
    db.prepare(`
      UPDATE orders
      SET admin_age_reminder_1w_sent_at = NULL,
          admin_age_reminder_2w_sent_at = NULL
      WHERE id = ?
    `).run(updatedOrder.id);
    db.prepare(`
      UPDATE admin_order_aging_reminders
      SET state = CASE WHEN state = 'SENT' THEN 'SUPERSEDED' ELSE 'RESOLVED' END,
          resolution_reason = ?
      WHERE order_code = ? AND state IN ('RESERVED', 'SENT')
    `).run(reason, updatedOrder.order_code);
  })();
  return { changed: true, enteringWarranty, leavingAgingQueue, reason };
}

function reminderMarkerColumn(stage) {
  if (stage === 'week1') return 'admin_age_reminder_1w_sent_at';
  if (stage === 'week2') return 'admin_age_reminder_2w_sent_at';
  throw new Error(`Invalid admin aging reminder stage: ${stage}`);
}

export function releaseStaleAdminOrderAgingReservations(nowMs = Date.now()) {
  const cutoff = new Date(nowMs - RESERVATION_TTL_MS).toISOString();
  const stale = db.prepare(`
    SELECT * FROM admin_order_aging_reminders
    WHERE state = 'RESERVED' AND datetime(reserved_at) <= datetime(?)
    ORDER BY id ASC
    LIMIT 100
  `).all(cutoff);
  for (const reservation of stale) releaseAdminOrderAgingReminder(reservation.reservation_token);
  return stale.length;
}

export function reserveAdminOrderAgingReminder(orderId, {
  stage,
  nowMs = Date.now(),
  reservedAt = new Date(nowMs).toISOString(),
} = {}) {
  const markerColumn = reminderMarkerColumn(stage);
  const reserve = db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order || selectAgingReminderStage(order, nowMs) !== stage) return null;
    const lifecycleKey = getAdminOrderAgingLifecycleKey(order);
    const anchor = getAdminOrderAgingAnchor(order);
    const previousMarkerAt = order[markerColumn] || null;
    const token = randomUUID();
    try {
      db.prepare(`
        INSERT INTO admin_order_aging_reminders (
          guild_id, order_code, lifecycle_key, stage, state,
          reservation_token, previous_marker_at, reserved_at
        ) VALUES (?, ?, ?, ?, 'RESERVED', ?, ?, ?)
      `).run(order.guild_id, order.order_code, lifecycleKey, stage, token, previousMarkerAt, reservedAt);
    } catch (error) {
      if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) return null;
      throw error;
    }

    const result = db.prepare(`
      UPDATE orders
      SET ${markerColumn} = ?
      WHERE id = ?
        AND status = ?
        AND COALESCE(${ADMIN_AGING_ANCHOR_SQL}, '') = ?
        AND COALESCE(${markerColumn}, '') = ?
    `).run(reservedAt, order.id, order.status, String(anchor || ''), String(previousMarkerAt || ''));
    if (result.changes !== 1) {
      db.prepare("DELETE FROM admin_order_aging_reminders WHERE reservation_token = ? AND state = 'RESERVED'").run(token);
      return null;
    }
    const previousCards = db.prepare(`
      SELECT message_id, channel_id
      FROM admin_order_aging_reminders
      WHERE order_code = ? AND lifecycle_key = ? AND state = 'SENT' AND message_id IS NOT NULL
      ORDER BY id DESC
    `).all(order.order_code, lifecycleKey);
    return {
      token,
      stage,
      reservedAt,
      previousMarkerAt,
      lifecycleKey,
      anchor: String(anchor || ''),
      order: db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id),
      previousCards,
    };
  });
  return reserve();
}

export function finalizeAdminOrderAgingReminder(token, { messageId, channelId } = {}) {
  return db.transaction(() => {
    const reservation = db.prepare(`
      SELECT * FROM admin_order_aging_reminders
      WHERE reservation_token = ? AND state = 'RESERVED'
    `).get(token);
    if (!reservation) return null;
    const order = db.prepare('SELECT * FROM orders WHERE order_code = ?').get(reservation.order_code);
    const markerColumn = reminderMarkerColumn(reservation.stage);
    const stillCurrent = order
      && PROCESSING_AGING_STATUSES.includes(String(order.status))
      && getAdminOrderAgingLifecycleKey(order) === reservation.lifecycle_key
      && String(order[markerColumn] || '') === String(reservation.reserved_at);
    if (!stillCurrent) {
      if (order) {
        db.prepare(`
          UPDATE orders SET ${markerColumn} = ?
          WHERE id = ? AND ${markerColumn} = ?
        `).run(reservation.previous_marker_at || null, order.id, reservation.reserved_at);
      }
      db.prepare(`
        UPDATE admin_order_aging_reminders
        SET state = 'RESOLVED', resolved_at = ?, resolution_reason = 'LIFECYCLE_CHANGED_DURING_SEND'
        WHERE id = ? AND state = 'RESERVED'
      `).run(nowIso(), reservation.id);
      return null;
    }
    const sentAt = nowIso();
    const finalized = db.prepare(`
      UPDATE admin_order_aging_reminders
      SET state = 'SENT', message_id = ?, channel_id = ?, sent_at = ?
      WHERE id = ? AND state = 'RESERVED'
    `).run(messageId || null, channelId || null, sentAt, reservation.id);
    if (finalized.changes !== 1) return null;
    const supersededCards = db.prepare(`
      SELECT message_id, channel_id
      FROM admin_order_aging_reminders
      WHERE order_code = ? AND lifecycle_key = ? AND state = 'SENT' AND id != ?
        AND message_id IS NOT NULL
    `).all(reservation.order_code, reservation.lifecycle_key, reservation.id);
    db.prepare(`
      UPDATE admin_order_aging_reminders
      SET state = 'SUPERSEDED', resolution_reason = 'STRONGER_STAGE_SENT'
      WHERE order_code = ? AND lifecycle_key = ? AND state = 'SENT' AND id != ?
    `).run(reservation.order_code, reservation.lifecycle_key, reservation.id);
    return { order, reservation: { ...reservation, state: 'SENT', message_id: messageId, channel_id: channelId }, supersededCards };
  })();
}

export function releaseAdminOrderAgingReminder(token) {
  return db.transaction(() => {
    const reservation = db.prepare(`
      SELECT * FROM admin_order_aging_reminders
      WHERE reservation_token = ? AND state = 'RESERVED'
    `).get(token);
    if (!reservation) return false;
    const markerColumn = reminderMarkerColumn(reservation.stage);
    db.prepare(`
      UPDATE orders SET ${markerColumn} = ?
      WHERE order_code = ? AND ${markerColumn} = ?
    `).run(reservation.previous_marker_at || null, reservation.order_code, reservation.reserved_at);
    db.prepare("DELETE FROM admin_order_aging_reminders WHERE id = ? AND state = 'RESERVED'").run(reservation.id);
    return true;
  })();
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
    const age = getAdminOrderAgeDays(order, refreshedAt.getTime());
    const urgency = age >= config.adminOrderReminderWeekTwoDays
      ? E('admin_order_week2')
      : (age >= config.adminOrderReminderWeekOneDays ? E('admin_order_week1') : E('order_queue'));
    const ticket = /^\d{17,20}$/.test(String(order.resolved_ticket_channel_id || ''))
      ? `<#${order.resolved_ticket_channel_id}>`
      : '**đã đóng/xóa**';
    const customer = order.resolved_customer_identity || `ID \`${order.customer_id}\``;
    return `${urgency} **${index + 1}. \`${order.order_code}\`** · ${customer} · **${formatAdminProductName(guildId, order.product_name, E, 44)}** · ${age} ngày · ${getOrderStatusLabel(order.status, guildId)} · ${ticket}`;
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

export function buildAdminOrderDetailPayload(order, {
  reminderStage = null,
  roleIds = [],
  ticketChannelId = null,
  customerIdentity = null,
  suppressRoleNotifications = false,
} = {}) {
  const E = createEmojiResolver(order.guild_id);
  const age = getAdminOrderAgeDays(order);
  const isWeekTwo = reminderStage === 'week2';
  const headerEmoji = reminderStage
    ? E(isWeekTwo ? 'admin_order_week2' : 'admin_order_week1')
    : E('admin_order_center');
  const title = reminderStage
    ? `${order.order_code} · TỒN ${age} NGÀY`
    : `CHI TIẾT ĐƠN ${order.order_code}`;
  const mentionLine = roleIds.length ? roleIds.map((id) => `<@&${id}>`).join(' ') : null;
  const createdUnix = toUnix(order.created_at);
  const updatedUnix = toUnix(order.updated_at);
  const verifiedTicketId = /^\d{17,20}$/.test(String(ticketChannelId || '')) ? String(ticketChannelId) : null;
  const ticket = verifiedTicketId ? `<#${verifiedTicketId}>` : '**Đã đóng / đã xóa**';
  const customer = customerIdentity || `ID \`${order.customer_id}\``;
  const note = String(order.note || '').replace(/\s+/g, ' ').trim();
  const claimant = order.claimed_by_id ? `<@${order.claimed_by_id}>` : '**Chưa có Admin claim**';

  const container = new ContainerBuilder().setAccentColor(isWeekTwo ? 0xEF4444 : (reminderStage ? 0xF59E0B : 0x8B5CF6));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${headerEmoji} ${title}`,
    mentionLine,
  ].filter(Boolean).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  if (reminderStage) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `${E('ticket_user')} **Khách:** ${customer}`,
      `${E('ticket_open')} **Ticket:** ${ticket}`,
      `${E('order_product')} **Sản phẩm:** ${formatAdminProductName(order.guild_id, order.product_name, E, 120)} · SL **${order.quantity || 1}**`,
      `${E('icon_duration')} **Thời hạn:** ${formatOrderDuration(order)}`,
      `${E('icon_chart')} **Trạng thái:** ${getOrderStatusLabel(order.status, order.guild_id)} · ${getPaymentStatusLabel(order.payment_status, order.guild_id)}`,
      `${E('payment_money')} **Giá trị:** ${formatCurrency(order.total_amount)} · nhận **${formatCurrency(order.amount_paid)}**`,
      `${E('ticket_claim')} **Phụ trách:** ${claimant} · ${E('icon_history')} ${updatedUnix ? `<t:${updatedUnix}:R>` : 'chưa cập nhật'}`,
      note ? `${E('icon_edit')} **Ghi chú:** ${trimText(note, 180)}` : null,
      `-# ${E('admin_order_priority')} Ưu tiên kiểm tra và xử lý trước đơn mới.`,
    ].filter(Boolean).join('\n')));
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
      `${E('ticket_user')} **Khách hàng:** ${customer}`,
      `${E('ticket_open')} **Ticket:** ${ticket} · ID \`${order.ticket_id}\``,
      `${E('order_product')} **Sản phẩm:** ${formatAdminProductName(order.guild_id, order.product_name, E, 180)} · SL **${order.quantity || 1}**`,
      `${E('icon_duration')} **Thời hạn:** ${formatOrderDuration(order)}`,
      note ? `${E('icon_edit')} **Ghi chú:** ${trimText(note, 260)}` : null,
      `${E('icon_chart')} **Trạng thái:** ${getOrderStatusLabel(order.status, order.guild_id)} · ${getPaymentStatusLabel(order.payment_status, order.guild_id)}`,
      `${E('payment_money')} **Giá trị:** ${formatCurrency(order.total_amount)} · đã nhận **${formatCurrency(order.amount_paid)}**`,
      `${E('ticket_claim')} **Phụ trách:** ${claimant}`,
      `${E('icon_clock')} **Tạo:** ${createdUnix ? `<t:${createdUnix}:F> (<t:${createdUnix}:R>)` : '—'} · **${age} ngày**`,
      `${E('payment_payos')} **Giao dịch:** ${trimText(order.payment_provider, 40)}${order.paid_transaction_id ? ` · \`${trimText(order.paid_transaction_id, 70)}\`` : ''}`,
      `${E('icon_key')} **Giao hàng:** ${order.credential_email || order.credential_password ? 'đã lưu trong hệ thống bảo mật' : 'chưa có dữ liệu'}`,
    ].filter(Boolean).join('\n')));
  }

  const buttons = [];
  if (!['COMPLETED', 'CANCELLED', 'FAILED'].includes(order.status)) {
    buttons.push(addEmoji(
      new ButtonBuilder().setCustomId(`order:claim:${order.order_code}`).setLabel('Claim ưu tiên').setStyle(ButtonStyle.Primary),
      componentEmoji(E, 'admin_order_priority'),
    ));
  }
  const ticketLink = orderTicketLink(order, verifiedTicketId);
  if (ticketLink) {
    buttons.push(addEmoji(
      new ButtonBuilder().setURL(ticketLink).setLabel('Mở ticket').setStyle(ButtonStyle.Link),
      componentEmoji(E, 'ticket_open'),
    ));
  }

  return {
    components: buttons.length ? [container, new ActionRowBuilder().addComponents(...buttons)] : [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: suppressRoleNotifications ? { parse: [] } : { parse: [], roles: roleIds },
  };
}

function buildAgingListPayload(guildId) {
  const E = createEmojiResolver(guildId);
  const orders = db.prepare(`
    SELECT * FROM orders
    WHERE guild_id = ?
      AND status IN (${sqlPlaceholders(PROCESSING_AGING_STATUSES)})
      AND datetime(${ADMIN_AGING_ANCHOR_SQL}) <= datetime('now', ?)
    ORDER BY datetime(${ADMIN_AGING_ANCHOR_SQL}) ASC, priority_rank DESC
    LIMIT 15
  `).all(guildId, ...PROCESSING_AGING_STATUSES, `-${config.adminOrderReminderWeekOneDays} days`);
  const container = new ContainerBuilder().setAccentColor(0xF59E0B);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${E('admin_order_priority')} HÀNG ĐỢI ƯU TIÊN 7–14 NGÀY\n> Sắp xếp cũ nhất trước. Bấm **Tra cứu đơn** để xem toàn bộ thông tin một mã cụ thể.`,
  ));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const lines = orders.length ? orders.map((order, index) => {
    const days = getAdminOrderAgeDays(order);
    const icon = days >= config.adminOrderReminderWeekTwoDays ? E('admin_order_week2') : E('admin_order_week1');
    return `${icon} **${index + 1}. \`${order.order_code}\`** · ${days} ngày · <@${order.customer_id}> · ${formatAdminProductName(guildId, order.product_name, E, 55)} · ${order.claimed_by_id ? `<@${order.claimed_by_id}>` : '**chưa claim**'}`;
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
  const orders = getActiveOrders(guild.id);
  for (const order of orders) {
    const [ticketChannel, customerIdentity] = await Promise.all([
      resolveOrderTicketChannel(guild, order),
      resolveOrderCustomerIdentity(guild, order),
    ]);
    order.resolved_ticket_channel_id = ticketChannel?.id || null;
    order.resolved_customer_identity = customerIdentity;
  }
  const payload = buildAdminOrderCenterPanel({
    guildId: guild.id,
    orders,
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
    if (guild) {
      await cleanupStaleAdminOrderReminderCards(guild).catch((error) => {
        console.error('[ADMIN-ORDER-CENTER] Reminder cleanup error:', error.message);
      });
      await refreshAdminOrderCenter(guild, { force: true }).catch((error) => {
        console.error('[ADMIN-ORDER-CENTER] Refresh error:', error.message);
      });
    }
  }, delayMs);
  timer.unref?.();
  refreshTimers.set(guildId, timer);
}

async function deleteTrackedReminderMessage(guild, fallbackChannel, card) {
  if (!card?.message_id) return false;
  const channelId = String(card.channel_id || fallbackChannel?.id || '');
  const channel = String(fallbackChannel?.id || '') === channelId
    ? fallbackChannel
    : guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return false;
  const message = await channel.messages.fetch(card.message_id).catch(() => null);
  if (!message || message.author?.id !== guild.client.user?.id) return false;
  await message.delete().catch(() => null);
  return true;
}

export async function cleanupStaleAdminOrderReminderCards(guild, { setup = null } = {}) {
  if (!guild || String(guild.id) !== String(config.storeOneGuildId)) {
    return { scanned: 0, deleted: 0, resolved: 0, releasedReservations: 0, skipped: true };
  }
  const center = setup || await ensureAdminOrderCenter(guild);
  if (!center?.channel?.isTextBased()) {
    return { scanned: 0, deleted: 0, resolved: 0, releasedReservations: 0, skipped: true };
  }
  const releasedReservations = releaseStaleAdminOrderAgingReservations();
  const cards = db.prepare(`
    SELECT reminder.*, orders.id AS order_id, orders.status AS order_status,
           orders.created_at AS order_created_at, orders.updated_at AS order_updated_at,
           orders.status_changed_at AS order_status_changed_at
    FROM admin_order_aging_reminders reminder
    LEFT JOIN orders ON orders.order_code = reminder.order_code
    WHERE reminder.guild_id = ?
      AND reminder.state IN ('SENT', 'SUPERSEDED')
      AND reminder.message_id IS NOT NULL
    ORDER BY reminder.id ASC
    LIMIT 500
  `).all(guild.id);
  let deleted = 0;
  let resolved = 0;
  for (const card of cards) {
    const order = card.order_id ? {
      id: card.order_id,
      status: card.order_status,
      created_at: card.order_created_at,
      updated_at: card.order_updated_at,
      status_changed_at: card.order_status_changed_at,
    } : null;
    const current = card.state === 'SENT'
      && order
      && PROCESSING_AGING_STATUSES.includes(String(order.status))
      && getAdminOrderAgingLifecycleKey(order) === card.lifecycle_key;
    if (current) continue;
    if (await deleteTrackedReminderMessage(guild, center.channel, card)) deleted += 1;
    const timestamp = nowIso();
    const result = db.prepare(`
      UPDATE admin_order_aging_reminders
      SET state = 'RESOLVED', resolved_at = ?,
          resolution_reason = COALESCE(resolution_reason, 'LIFECYCLE_NO_LONGER_ACTIVE')
      WHERE id = ? AND state IN ('SENT', 'SUPERSEDED')
    `).run(timestamp, card.id);
    resolved += result.changes;
    if (order && (!PROCESSING_AGING_STATUSES.includes(String(order.status))
      || getAdminOrderAgingLifecycleKey(order) !== card.lifecycle_key)) {
      db.prepare(`
        UPDATE orders
        SET admin_age_reminder_1w_sent_at = NULL,
            admin_age_reminder_2w_sent_at = NULL
        WHERE id = ?
      `).run(order.id);
    }
  }
  return { scanned: cards.length, deleted, resolved, releasedReservations, skipped: false };
}

export async function processAdminOrderAgingReminders(client) {
  const guild = client?.guilds?.cache?.get(config.storeOneGuildId)
    || await client?.guilds?.fetch?.(config.storeOneGuildId).catch(() => null);
  if (!guild) return { sent: 0, skipped: true };
  const setup = await ensureAdminOrderCenter(guild);
  if (!setup?.channel?.isTextBased()) return { sent: 0, skipped: true };
  const cleanup = await cleanupStaleAdminOrderReminderCards(guild, { setup });

  const guildConfig = getGuildConfig(guild.id);
  const roleIds = [...new Set([guildConfig?.manager_role_id, ...config.ownerRoleIds]
    .filter((id) => id && guild.roles.cache.has(String(id)))
    .map(String))];
  const candidates = db.prepare(`
    SELECT * FROM orders
    WHERE guild_id = ? AND status IN (${sqlPlaceholders(PROCESSING_AGING_STATUSES)})
    ORDER BY datetime(${ADMIN_AGING_ANCHOR_SQL}) ASC
    LIMIT 100
  `).all(guild.id, ...PROCESSING_AGING_STATUSES);

  let sent = 0;
  let stale = 0;
  let errors = 0;
  for (const order of candidates) {
    if (sent >= 10) break;
    const stage = selectAgingReminderStage(order);
    if (!stage) continue;
    const reservation = reserveAdminOrderAgingReminder(order.id, { stage });
    if (!reservation) continue;
    const [ticketChannel, customerIdentity] = await Promise.all([
      resolveOrderTicketChannel(guild, reservation.order),
      resolveOrderCustomerIdentity(guild, reservation.order),
    ]);
    try {
      const message = await setup.channel.send(buildAdminOrderDetailPayload(reservation.order, {
        reminderStage: stage,
        roleIds,
        ticketChannelId: ticketChannel?.id || null,
        customerIdentity,
      }));
      const finalized = finalizeAdminOrderAgingReminder(reservation.token, {
        messageId: message.id,
        channelId: setup.channel.id,
      });
      if (!finalized) {
        stale += 1;
        if (message.author?.id === client.user?.id) await message.delete().catch(() => null);
        continue;
      }
      for (const previous of finalized.supersededCards) {
        await deleteTrackedReminderMessage(guild, setup.channel, previous);
        db.prepare(`
          UPDATE admin_order_aging_reminders
          SET state = 'RESOLVED', resolved_at = ?,
              resolution_reason = 'SUPERSEDED_CARD_REMOVED'
          WHERE order_code = ? AND lifecycle_key = ? AND message_id = ? AND state = 'SUPERSEDED'
        `).run(nowIso(), finalized.order.order_code, reservation.lifecycleKey, previous.message_id);
      }
      sent += 1;
    } catch (error) {
      errors += 1;
      releaseAdminOrderAgingReminder(reservation.token);
      console.error(`[ADMIN-ORDER-CENTER] Reminder ${order.order_code} failed:`, error.message);
    }
  }
  await refreshAdminOrderCenter(guild, { force: sent > 0 }).catch(() => null);
  return { sent, stale, errors, cleanup, skipped: false };
}

async function fetchRecentAdminOrderMessages(channel, limit = 500) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const messages = [];
  let before;
  while (messages.length < safeLimit) {
    const page = await channel.messages.fetch({
      limit: Math.min(100, safeLimit - messages.length),
      ...(before ? { before } : {}),
    });
    if (!page.size) break;
    const values = [...page.values()];
    messages.push(...values);
    before = values.at(-1)?.id;
    if (page.size < 100) break;
  }
  return messages.sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
}

function isAdminOrderAgingReminderCard(componentJson) {
  return /TỒN\s+\d+\s+NGÀY/iu.test(componentJson);
}

export async function refreshExistingAdminAgingReminderCards(guild, { force = false, limit = 500 } = {}) {
  if (!guild || String(guild.id) !== String(config.storeOneGuildId)) return { scanned: 0, updated: 0, deleted: 0, failed: 0, skipped: true };
  const versionKey = `admin_order_center_card_ui_version:${guild.id}`;
  const currentVersion = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(versionKey)?.value;
  if (!force && currentVersion === COMPACT_CARD_UI_VERSION) {
    return { scanned: 0, updated: 0, deleted: 0, failed: 0, skipped: true };
  }

  const setup = await ensureAdminOrderCenter(guild);
  if (!setup?.channel?.isTextBased()) return { scanned: 0, updated: 0, deleted: 0, failed: 0, skipped: true };
  const guildConfig = getGuildConfig(guild.id);
  const roleIds = [...new Set([guildConfig?.manager_role_id, ...config.ownerRoleIds]
    .filter((id) => id && guild.roles.cache.has(String(id)))
    .map(String))];
  const messages = await fetchRecentAdminOrderMessages(setup.channel, limit);
  let scanned = 0;
  let updated = 0;
  let deleted = 0;
  let failed = 0;
  const seenLifecycles = new Set();

  for (const message of messages) {
    if (message.author?.id !== guild.client.user.id) continue;
    const componentJson = JSON.stringify(message.components.map((component) => component.toJSON()));
    if (!isAdminOrderAgingReminderCard(componentJson)) continue;
    const orderCode = componentJson.match(/order:claim:([A-Za-z0-9_-]{3,32})/)?.[1]
      || componentJson.match(/\b(?:CN|CR)_\d{3,20}\b/)?.[0];
    if (!orderCode) continue;
    scanned += 1;
    const order = db.prepare('SELECT * FROM orders WHERE guild_id = ? AND order_code = ?').get(guild.id, orderCode);
    const days = order ? getAdminOrderAgeDays(order) : 0;
    const elapsedStage = agingStageByElapsedDays(days, {
      weekOneDays: config.adminOrderReminderWeekOneDays,
      weekTwoDays: config.adminOrderReminderWeekTwoDays,
    });
    const eligible = order
      && PROCESSING_AGING_STATUSES.includes(String(order.status))
      && elapsedStage;
    const lifecycleKey = eligible ? getAdminOrderAgingLifecycleKey(order) : null;
    const dedupeKey = eligible ? `${order.order_code}:${lifecycleKey}` : null;
    if (!eligible || seenLifecycles.has(dedupeKey)) {
      try {
        await message.delete();
        deleted += 1;
        db.prepare(`
          UPDATE admin_order_aging_reminders
          SET state = 'RESOLVED', resolved_at = ?, resolution_reason = 'LEGACY_CARD_NOT_ACTIONABLE'
          WHERE message_id = ? AND state IN ('SENT', 'SUPERSEDED')
        `).run(nowIso(), message.id);
        if (order && !seenLifecycles.has(dedupeKey)) {
          db.prepare(`
            UPDATE orders
            SET admin_age_reminder_1w_sent_at = NULL,
                admin_age_reminder_2w_sent_at = NULL
            WHERE id = ?
          `).run(order.id);
        }
      } catch (error) {
        failed += 1;
        console.error(`[ADMIN-ORDER-CENTER] Không thể dọn card ${orderCode}:`, error.message);
      }
      continue;
    }
    seenLifecycles.add(dedupeKey);
    const [ticketChannel, customerIdentity] = await Promise.all([
      resolveOrderTicketChannel(guild, order),
      resolveOrderCustomerIdentity(guild, order),
    ]);
    const stage = elapsedStage;
    try {
      await message.edit(buildAdminOrderDetailPayload(order, {
        reminderStage: stage,
        roleIds,
        ticketChannelId: ticketChannel?.id || null,
        customerIdentity,
        suppressRoleNotifications: true,
      }));
      const sentAt = message.createdAt?.toISOString?.() || nowIso();
      if (stage === 'week2') {
        db.prepare(`
          UPDATE orders
          SET admin_age_reminder_1w_sent_at = COALESCE(admin_age_reminder_1w_sent_at, ?),
              admin_age_reminder_2w_sent_at = COALESCE(admin_age_reminder_2w_sent_at, ?)
          WHERE id = ?
        `).run(sentAt, sentAt, order.id);
      } else {
        db.prepare(`
          UPDATE orders
          SET admin_age_reminder_1w_sent_at = COALESCE(admin_age_reminder_1w_sent_at, ?)
          WHERE id = ?
        `).run(sentAt, order.id);
      }
      db.prepare(`
        INSERT OR IGNORE INTO admin_order_aging_reminders (
          guild_id, order_code, lifecycle_key, stage, state, reservation_token,
          previous_marker_at, message_id, channel_id, reserved_at, sent_at
        ) VALUES (?, ?, ?, ?, 'SENT', ?, NULL, ?, ?, ?, ?)
      `).run(
        guild.id,
        order.order_code,
        lifecycleKey,
        stage,
        `legacy-${message.id}`,
        message.id,
        setup.channel.id,
        sentAt,
        sentAt,
      );
      updated += 1;
    } catch (error) {
      failed += 1;
      console.error(`[ADMIN-ORDER-CENTER] Không thể làm gọn card ${order.order_code}:`, error.message);
    }
  }

  if (failed === 0) {
    db.prepare(`
      INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(versionKey, COMPACT_CARD_UI_VERSION, nowIso());
  }
  return { scanned, updated, deleted, failed, skipped: false };
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
    const [ticketChannel, customerIdentity] = await Promise.all([
      resolveOrderTicketChannel(interaction.guild, order),
      resolveOrderCustomerIdentity(interaction.guild, order),
    ]);
    const payload = buildAdminOrderDetailPayload(order, {
      ticketChannelId: ticketChannel?.id || null,
      customerIdentity,
    });
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

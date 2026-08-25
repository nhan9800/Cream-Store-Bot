// ═══════════════════════════════════════════════════════════════════
// shared.js — Nguồn DUY NHẤT cho state dùng chung + helper của tầng interaction.
// KHÔNG khai báo lại các state này ở bất kỳ module nào khác.
// Mọi module handler phải import từ đây để nhìn CÙNG một instance
// (activeTicketCreations / activeTicketCloses / announcementCache là chốt
//  chống bấm-2-lần; nếu bị nhân đôi, chốt sẽ vô hiệu trên production).
// ═══════════════════════════════════════════════════════════════════

import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { config } from '../config.js';
import { emitStaffLog } from '../services/staffLogService.js';
import { getOrderByCode, markOrderCompleted } from '../services/orderService.js';
import { sendCompletedFlow, updateOrderLogMessage } from '../services/notificationService.js';
import { buildFeedbackModalPrompt, buildWarrantyPanelModalPrompt } from '../utils/embeds.js';
import { sanitizeDiscordPayload } from '../utils/uiKit.js';

export const FEEDBACK_TEXT_INPUT_ID = 'feedback_content';
export const WARRANTY_ORDER_INPUT_ID = 'warranty_order_code';
export const WARRANTY_REASON_INPUT_ID = 'warranty_reason';

export const CHAR_TO_SLOT = {
  '🛍️': 'panel_order',
  '🆘': 'panel_support',
  '🤝': 'panel_partnership',
  '🛠️': 'panel_warranty',
  '✏️': 'panel_edit',
  '📌': 'order_queue',
  '🎉': 'order_complete',
  '📦': 'order_product',
  '🏦': 'payment_vietqr',
  '📱': 'payment_qr',
  '↩️': 'payment_refund',
  '🔒': 'ticket_close',
  '🛡️': 'ticket_claim',
  '🎫': 'ticket_open',
  '👤': 'ticket_user',
  '🧑‍💼': 'ticket_staff',
  '⏰': 'icon_clock',
  '📅': 'icon_calendar',
  '📜': 'icon_history',
  'ℹ️': 'status_info',
  '🎬': 'brand_capcut',
  '🍿': 'brand_netflix',
  '🎵': 'brand_spotify',
  '📺': 'brand_youtube',
  '▶️': 'brand_youtube',
  '🤖': 'brand_chatgpt',
  '💬': 'brand_discord',
  '🚀': 'brand_boost',
  '🔮': 'brand_boost',
  '💎': 'brand_nitro',
  '📈': 'brand_office',
  '🎮': 'brand_gearup',
  '🏪': 'icon_store',
  '⭐': 'icon_star',
  '🔥': 'icon_fire',
  '🎁': 'icon_gift',
  '✨': 'icon_sparkle',
  '👑': 'icon_crown',
  '📊': 'icon_chart',
  '📍': 'icon_location',
  '🔑': 'icon_key',
  '🔗': 'icon_link',
  '✅': 'status_check',
  '❌': 'status_cross',
  '⚠️': 'status_warn',
  '⏳': 'status_loading',
  '💰': 'payment_money',
  '💳': 'payment_payos',
  '⚙️': 'icon_settings',
  '⏱️': 'icon_duration',
  '⛔': 'status_cross',
  '🔇': 'status_cross'
};

export const EMOJI_REGEX = new RegExp(Object.keys(CHAR_TO_SLOT).sort((a, b) => b.length - a.length).join('|'), 'g');

export function resolvePayloadEmojis(payload, E) {
  if (!payload) return payload;

  function resolveRecursive(val) {
    if (!val) return val;
    
    if (typeof val === 'string') {
      return val.replace(EMOJI_REGEX, (char) => {
        const slot = CHAR_TO_SLOT[char];
        return slot ? E(slot, char) : char;
      });
    }
    
    if (Array.isArray(val)) {
      return val.map(resolveRecursive);
    }
    
    if (typeof val === 'object') {
      // Keep class instances (Buffer, Stream, AttachmentBuilder, ContainerBuilder, etc.) intact
      const proto = Object.getPrototypeOf(val);
      if (proto !== Object.prototype && proto !== null) {
        return val;
      }
      
      const res = {};
      for (const [key, value] of Object.entries(val)) {
        if (key === 'files') {
          res[key] = value;
        } else {
          res[key] = resolveRecursive(value);
        }
      }
      return res;
    }
    
    return val;
  }

  try {
    return sanitizeDiscordPayload(resolveRecursive(payload));
  } catch (error) {
    console.error('[EMOJI] Lỗi khi xử lý payload emoji:', error);
    return payload;
  }
}

export const announcementCache = new Map();
export const ANNOUNCEMENT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 phút
export const activeTicketCreations = new Set();
export const activeTicketCloses = new Set();

export function announcementCacheSet(key, value) {
  announcementCache.set(key, value);
  setTimeout(() => announcementCache.delete(key), ANNOUNCEMENT_CACHE_TTL_MS);
}

export async function safeReply(interaction, payload) {
  const response = payload && typeof payload === 'object' && Object.hasOwn(payload, 'ephemeral')
    ? (() => {
        const normalized = { ...payload };
        const ephemeral = normalized.ephemeral === true;
        delete normalized.ephemeral;
        if (ephemeral) {
          const existingFlags = typeof normalized.flags === 'number' ? normalized.flags : 0;
          normalized.flags = existingFlags | MessageFlags.Ephemeral;
        }
        return normalized;
      })()
    : payload;

  // Timeout guard: nếu interaction quá 14 giây thì không reply được nữa
  if (Date.now() - interaction.createdTimestamp > 14000 && !interaction.deferred && !interaction.replied) {
    console.warn(`[INTERACTION] Interaction ${interaction.id} đã hết hạn (>14s), bỏ qua reply.`);
    return null;
  }

  if (interaction.replied || interaction.deferred) {
    return interaction.followUp(response).catch(() => null);
  }

  return interaction.reply(response).catch(() => null);
}

export async function completeOrderByCode(guild, orderCode, actorId) {
  const currentOrder = getOrderByCode(orderCode);
  if (!currentOrder) return null;

  if (currentOrder.total_amount > 0 && currentOrder.payment_status !== 'PAID') {
    throw new Error('Đơn này chưa thanh toán xong.');
  }

  if (currentOrder.status === 'COMPLETED') {
    return {
      order: currentOrder,
      dmResult: { dmSent: false },
      alreadyCompleted: true,
    };
  }

  const order = markOrderCompleted(orderCode, actorId, config.feedbackTimeoutHours);

  await updateOrderLogMessage(guild, order);
  const dmResult = await sendCompletedFlow({
    guild,
    order,
    actorId,
    supportId: actorId,
  });
  await emitStaffLog(guild.client, {
    guildId: guild.id,
    actorId,
    targetId: order.customer_id,
    action: 'ORDER_COMPLETE_MANUAL',
    detail: 'Lệnh +done / thao tác hoàn thành thủ công',
    relatedOrderCode: order.order_code,
  });

  return { order, dmResult, alreadyCompleted: false };
}

export function buildWarrantyPanelModal() {
  const prompt = buildWarrantyPanelModalPrompt();

  const modal = new ModalBuilder()
    .setCustomId('ticket:warranty:panel:modal')
    .setTitle(prompt.title);

  const orderInput = new TextInputBuilder()
    .setCustomId(WARRANTY_ORDER_INPUT_ID)
    .setLabel(prompt.orderLabel)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder(prompt.orderPlaceholder)
    .setMaxLength(20);

  const reasonInput = new TextInputBuilder()
    .setCustomId(WARRANTY_REASON_INPUT_ID)
    .setLabel(prompt.reasonLabel)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder(prompt.reasonPlaceholder)
    .setMaxLength(500);

  modal.addComponents(
    new ActionRowBuilder().addComponents(orderInput),
    new ActionRowBuilder().addComponents(reasonInput),
  );

  return modal;
}

export function buildFeedbackModal(orderCode, stars) {
  const prompt = buildFeedbackModalPrompt(stars);

  const modal = new ModalBuilder()
    .setCustomId(`feedback:modal:${orderCode}:${stars}`)
    .setTitle(prompt.title);

  const input = new TextInputBuilder()
    .setCustomId(FEEDBACK_TEXT_INPUT_ID)
    .setLabel(prompt.label)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder(prompt.placeholder)
    .setMaxLength(700);

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

export function getTicketCategoryId(guildConfig, ticketType) {
  switch (ticketType) {
    case 'SUPPORT': return guildConfig.support_category_id || guildConfig.ticket_category_id;
    case 'COMPLAINT': return guildConfig.complaint_category_id || guildConfig.ticket_category_id;
    case 'PARTNERSHIP': return guildConfig.partnership_category_id || guildConfig.ticket_category_id;
    case 'WARRANTY': return guildConfig.warranty_category_id || guildConfig.ticket_category_id;
    case 'APPEAL': return guildConfig.warranty_category_id || guildConfig.ticket_category_id;
    default: return guildConfig.ticket_category_id; // ORDER
  }
}

export function parsePrice(raw) {
  if (!raw) return null;
  const cleaned = String(raw).trim().toLowerCase();
  let multiplier = 1;
  let normalized = cleaned;
  if (normalized.endsWith('k')) {
    multiplier = 1000;
    normalized = normalized.slice(0, -1);
  }
  const digits = normalized.replace(/[^\d]/g, '');
  if (!digits) return null;
  const value = Number.parseInt(digits, 10) * multiplier;
  return Number.isFinite(value) ? value : null;
}

export function parseCompactSecondaryPrice(description) {
  if (!description) return null;
  const cleaned = description.trim();

  // Check if description looks like a price value
  // Match: digits optionally with dots/commas as thousands separators, optional 'k' suffix, optional 'VND'/'đ'
  const priceMatch = cleaned.match(/^([\d.,]+)\s*(k|K)?\s*(VND|vnd|đ)?$/);
  if (!priceMatch) return null;

  let numStr = priceMatch[1].replace(/[.,]/g, '');
  let value = Number.parseInt(numStr, 10);
  if (!Number.isFinite(value)) return null;

  if (priceMatch[2]?.toLowerCase() === 'k') {
    value *= 1000;
  }

  return value.toLocaleString('vi-VN') + ' VND';
}

export function getDefaultCategoryDetails(category) {
  const cat = category.toLowerCase();
  if (cat === 'youtube') {
    return { title: '📺 BẢNG GIÁ YOUTUBE PREMIUM (SIÊU ỔN ĐỊNH)', color: 'ED4245', name: 'YouTube Premium' };
  }
  if (cat === 'spotify') {
    return { title: '🎵 BẢNG GIÁ SPOTIFY PREMIUM (SIÊU ỔN ĐỊNH)', color: '57F287', name: 'Spotify Premium' };
  }
  if (cat === 'netflix') {
    return { title: '🍿 BẢNG GIÁ NETFLIX EXTRA PREMIUM', color: 'E50914', name: 'Netflix Premium' };
  }
  if (cat === 'nitro') {
    return { title: '💎 BẢNG GIÁ DISCORD NITRO PREMIUM', color: '5865F2', name: 'Discord Nitro' };
  }
  if (cat === 'boost') {
    return { title: '🚀 BẢNG GIÁ DISCORD BOOST SERVER', color: 'EB459E', name: 'Discord Boost' };
  }
  if (cat === 'decor') {
    return { title: '⚙️ DECOR / NPL', color: 'EB459E', name: 'Decor Discord', display_mode: 'compact', subtitle: '⚙️ DEC/NPL ( LOG ACC )' };
  }
  if (cat === 'ai') {
    return { title: '🤖 BẢNG GIÁ AI & PHẦN MỀM PREMIUM', color: '9B59B6', name: 'AI & Phần Mềm' };
  }
  if (cat === 'gearup') {
    return { title: '🎮 BẢNG GIÁ GEARUP BOOSTER', color: '00E6FF', name: 'Gearup Booster' };
  }
  if (cat === 'service') {
    return { title: '🛠️ DỊCH VỤ SETUP DISCORD & BOT CUSTOM & WEBSITE', color: '5865F2', name: 'Dịch Vụ Setup & Custom' };
  }
  return { title: `BẢNG GIÁ ${category.toUpperCase()}`, color: 'F3A6D7', name: category.toUpperCase() };
}

export function parseDateInput(raw) {
  if (!raw || !raw.trim()) return new Date().toISOString();
  const trimmed = raw.trim();
  // DD/MM/YYYY
  const match = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (match) {
    const d = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  // ISO fallback
  const d2 = new Date(trimmed);
  if (!Number.isNaN(d2.getTime())) return d2.toISOString();
  return new Date().toISOString();
}

export function parsePrefixCommand(content) {
  if (!content.startsWith('+')) return null;
  const [command, ...args] = content.trim().split(/\s+/);
  return {
    command: command.toLowerCase(),
    args,
  };
}

export function resolveDecorEmoji(guildId, emojiName) {
  const isServer1 = guildId === '1282637033340403754';
  if (isServer1) {
    switch (emojiName) {
      case 'header': return '<a:ccjdeobt:1481142015994495059>';
      case 'bullet': return '<a:chamxanh:1481124932447371374>';
      case 'arrow': return '<a:69_Arrow:1448888143120957532>';
      case 'check': return '<:verifybadge:1481127479702847646>';
      case 'husky': return '<a:husky:1105033204114673675>';
    }
  } else {
    switch (emojiName) {
      case 'header': return '✨';
      case 'bullet': return '🟢';
      case 'arrow': return '➡️';
      case 'check': return '🔵';
      case 'husky': return '<a:husky:1105033204114673675>';
    }
  }
  return '';
}


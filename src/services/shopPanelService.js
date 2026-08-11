import { db, nowIso } from '../database/db.js';
import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { getActiveProducts } from './productCatalogService.js';
import { formatCurrency } from '../utils/formatters.js';
import { getEmojiMap, resolveSelectMenuEmoji, resolveProductEmoji } from './emojiService.js';
import { fmt, h2, subtext } from '../utils/embedHelpers.js';
import { config } from '../config.js';
import { isInternationalGuild } from '../utils/locale.js';
import { formatInternationalPrice, translateProductName } from '../utils/internationalCatalog.js';

// ═══════════════════════════════════════════════
// CRUD — shop_panels
// ═══════════════════════════════════════════════

export function createShopPanel({ guildId, channelId, messageId, category, title, imageUrl, features }) {
  const ts = nowIso();
  const result = db.prepare(`
    INSERT INTO shop_panels (guild_id, channel_id, message_id, category, title, image_url, features, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(guildId, channelId, messageId, category, title ?? null, imageUrl ?? null, features ?? null, ts, ts);
  return getShopPanelById(Number(result.lastInsertRowid));
}

export function getShopPanelById(id) {
  return db.prepare('SELECT * FROM shop_panels WHERE id = ?').get(id) ?? null;
}

export function getShopPanelByMessageId(messageId) {
  return db.prepare('SELECT * FROM shop_panels WHERE message_id = ?').get(messageId) ?? null;
}

export function getShopPanelsByGuild(guildId) {
  return db.prepare('SELECT * FROM shop_panels WHERE guild_id = ? ORDER BY created_at DESC').all(guildId);
}

export function updateShopPanel(id, fields = {}) {
  const panel = getShopPanelById(id);
  if (!panel) return null;

  const title = fields.title !== undefined ? fields.title : panel.title;
  const imageUrl = fields.imageUrl !== undefined ? fields.imageUrl : panel.image_url;
  const features = fields.features !== undefined ? fields.features : panel.features;
  const category = fields.category !== undefined ? fields.category : panel.category;
  const messageId = fields.messageId !== undefined ? fields.messageId : panel.message_id;

  db.prepare(`
    UPDATE shop_panels SET title = ?, image_url = ?, features = ?, category = ?, message_id = ?, updated_at = ?
    WHERE id = ?
  `).run(title, imageUrl, features, category, messageId, nowIso(), id);

  return getShopPanelById(id);
}

export function deleteShopPanel(id) {
  return db.prepare('DELETE FROM shop_panels WHERE id = ?').run(id);
}

// ═══════════════════════════════════════════════
// Màu accent theo danh mục dịch vụ
// ═══════════════════════════════════════════════
const CATEGORY_ACCENT = {
  netflix:    0xE50914,
  spotify:    0x1DB954,
  youtube:    0xFF0000,
  chatgpt:    0x10A37F,
  claude:     0xD97706,
  gemini:     0x4285F4,
  office:     0xD83B01,
  adobe:      0xFF0000,
  capcut:     0x000000,
  discord:    0x5865F2,
  nitro:      0x5865F2,
  gearup:     0x00C2FF,
};

function accentForCategory(category) {
  const key = (category || '').toLowerCase().replace(/\s+/g, '');
  for (const [k, v] of Object.entries(CATEGORY_ACCENT)) {
    if (key.includes(k)) return v;
  }
  return config.accentColorPrimary;
}

// ═══════════════════════════════════════════════
// Build Components V2 Panel
// ═══════════════════════════════════════════════

export function buildShopPanelV2({ guildId, category, title, imageUrl, features }) {
  const international = isInternationalGuild(guildId);
  let products = [];
  const activeProducts = getActiveProducts(guildId);
  const catLower = (category || '').toLowerCase();

  if (catLower === 'nitro') {
    products = activeProducts.filter(p => p.service_type && ['nitro', 'boost'].includes(p.service_type.toLowerCase()));
  } else if (catLower === 'decor_acc') {
    products = activeProducts.filter(p => p.service_type && p.service_type.toLowerCase() === 'decor' && !p.name.toLowerCase().includes('gift'));
  } else if (catLower === 'decor_gift') {
    products = activeProducts.filter(p => p.service_type && p.service_type.toLowerCase() === 'decor' && p.name.toLowerCase().includes('gift'));
  } else if (catLower === 'streaming') {
    products = activeProducts.filter(p => p.service_type && ['streaming', 'youtube', 'spotify', 'netflix'].includes(p.service_type.toLowerCase()));
  } else {
    products = activeProducts.filter(p => p.service_type && p.service_type.toLowerCase() === catLower);
  }

  const em = getEmojiMap(guildId);
  const E = (slot, fallback = '') => em[slot] || fallback;
  const Ecomp = (slot) => {
    const raw = em[slot];
    const m = raw && raw.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
    return m ? { id: m[3], name: m[2], animated: m[1] === 'a' } : null;
  };
  const displayTitle = title || category;

  // Tìm emoji brand phù hợp với danh mục
  const catKey = (category || '').toLowerCase();
  const brandSlots = ['netflix','spotify','youtube','chatgpt','claude','gemini','office','adobe','capcut','discord','nitro','gearup'];
  const matchedBrandSlot = brandSlots.find(s => catKey.includes(s));
  const brandEmoji = matchedBrandSlot ? E(`brand_${matchedBrandSlot}`) : E('icon_store');
  const accentColor = accentForCategory(category);

  // ─── Build Embed Description ───
  let desc = international
    ? `> ${E('icon_sparkle')} **Premium digital services with transparent delivery and warranty support from Cenar Global.**\n\n`
    : `> ${E('icon_sparkle')} **Dịch vụ số chính hãng — bảo hành uy tín tại ${config.storeName || 'Cenar Store'}**\n\n`;

  if (features) {
    const featureLines = features.split('\n').filter(l => l.trim());
    const formatted = featureLines.map(line => {
      const trimmed = line.trim();
      if (/^[•\-\*]/.test(trimmed)) return trimmed;
      if (/^\p{Emoji}/u.test(trimmed)) return trimmed;
      return `${E('status_check')} ${trimmed}`.trim();
    }).join('\n');

    desc += `### ${E('icon_sparkle')} ${international ? 'SERVICE BENEFITS' : 'Quyền Lợi Dịch Vụ'}\n${formatted}\n\n`;
  }

  if (products.length > 0) {
    const priceLines = products.map(p => {
      const priceText = international ? formatInternationalPrice(p.price) : Number(p.price).toLocaleString('vi-VN') + 'đ';
      const pEmoji = resolveProductEmoji(guildId, p.emoji) || E('muiten');
      return `${pEmoji} **${international ? translateProductName(p.name) : p.name}** — \`${priceText}\` / ${p.duration_months} ${international ? 'month(s)' : 'tháng'}`.trim();
    });
    desc += `### ${E('icon_price')} ${international ? 'LIVE PRICING' : 'Bảng Giá Dịch Vụ'}\n${priceLines.join('\n')}\n\n`;
  }

  desc += international
    ? `-# ${E('icon_heart_purple')} Select a package below to order · Cenar Global`
    : `-# ${E('icon_heart_purple')} Chọn gói bên dưới để đặt hàng · ${config.storeName || 'Cenar Store'}`;

  const embed = new EmbedBuilder()
    .setColor(accentColor || 0x2f3136)
    .setTitle(`${brandEmoji} ${displayTitle}`)
    .setDescription(desc)
    .setTimestamp();

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  // ─── Select menu ───
  let selectRow = null;
  if (products.length > 0) {
    const selectOptions = products.slice(0, 25).map(p => ({
      label: `${international ? translateProductName(p.name) : p.name}`.slice(0, 100),
      description: `${international ? formatInternationalPrice(p.price) : `${formatCurrency(p.price)}đ`} · ${p.duration_months} ${international ? 'month(s)' : 'tháng'}`.slice(0, 100),
      value: `${p.id}`,
      emoji: resolveSelectMenuEmoji(guildId, p.emoji, 'order_product') || undefined,
    }));

    selectRow = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('product:select')
        .setPlaceholder(`${displayTitle} — ${international ? 'Select a package' : 'Chọn gói phù hợp với bạn'}`)
        .addOptions(selectOptions)
    );
  }

  // ─── Edit button (Admin only) ───
  const editBtn = new ButtonBuilder()
    .setCustomId('shop:panel:edit')
    .setLabel(international ? 'Edit Panel' : 'Sửa Panel')
    .setStyle(ButtonStyle.Secondary);
  const editEmoji = Ecomp('panel_edit');
  if (editEmoji) editBtn.setEmoji(editEmoji);
  const editRow = new ActionRowBuilder().addComponents(editBtn);

  const components = [];
  if (selectRow) components.push(selectRow);
  components.push(editRow);

  return { embeds: [embed], components };
}

// ═══════════════════════════════════════════════
// Auto-refresh all shop panels for a guild
// ═══════════════════════════════════════════════

export async function refreshAllShopPanels(client, guildId) {
  const panels = getShopPanelsByGuild(guildId);
  if (!panels.length) return;

  for (const panel of panels) {
    try {
      const channel = await client.channels.fetch(panel.channel_id).catch(() => null);
      if (!channel?.isTextBased()) continue;

      const msg = await channel.messages.fetch(panel.message_id).catch(() => null);
      if (!msg) continue;

      const { embeds, components } = buildShopPanelV2({
        guildId,
        category: panel.category,
        title: panel.title || panel.category,
        imageUrl: panel.image_url,
        features: panel.features,
      });

      await msg.edit({ embeds, components }).catch(() => null);
    } catch (e) {
      // Panel bị xóa hoặc lỗi → bỏ qua
    }
  }
}

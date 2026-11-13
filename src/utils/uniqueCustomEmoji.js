import { CORE_UI_EMOJI_ASSETS } from '../config/coreEmojiPack2026.js';
import { createEmojiResolver } from './emojiHelper.js';
import { getCanonicalEmojiSlot, parseDiscordEmoji, resolveLiveCustomEmoji } from '../services/emojiService.js';

const CUSTOM = /<a?:[A-Za-z0-9_]+:\d+>/g;
const protectedText = /(```[\s\S]*?(?:```|$)|`[^`\n]*`|\|\|[\s\S]*?(?:\|\||$)|https?:\/\/[^\s<>]+)/g;
const nativeEmoji = /\p{Extended_Pictographic}|[\uFE0E\uFE0F\u200D\u20E3]/gu;
const json = value => value?.toJSON?.() || value;
const relatedArt = [
  [/price|tag|money|wallet|payment/i, ['payment_money', 'icon_wallet', 'payment_payos', 'payment_vietqr', 'icon_gem', 'order_id', 'icon_chart', 'icon_gift']],
  [/brand_|product|package/i, ['order_product', 'icon_brain', 'icon_key', 'icon_book', 'icon_art', 'icon_gem', 'icon_sparkle', 'icon_doc']],
  [/doc|history|transcript|clipboard/i, ['icon_doc', 'icon_clipboard', 'order_id', 'icon_folder', 'icon_search', 'icon_book']],
  [/store|cart|order/i, ['icon_store', 'icon_cart', 'order_product', 'icon_gift', 'icon_target', 'icon_chart']],
];

function offset(value, length) {
  let hash = 2166136261;
  for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return length ? (hash >>> 0) % length : 0;
}

/** One allocator per view (or shared campaign), reserving final wire IDs. */
export function createUniqueCustomEmojiResolver(guildId, {
  seed = '', resolver = createEmojiResolver(guildId),
} = {}) {
  const used = new Set();
  let missing = 0, sequence = 0, pool;
  const canonical = candidate => {
    try { return resolveLiveCustomEmoji(candidate, guildId); } catch { return ''; }
  };
  const candidates = () => pool ||= [...new Map(CORE_UI_EMOJI_ASSETS.map(asset => {
    const token = canonical(resolver(asset.name));
    return [parseDiscordEmoji(token)?.id, token];
  }).filter(([id, token]) => id && token)).values()];
  const allocate = (preferred, purpose = '') => {
    sequence++;
    const direct = canonical(typeof preferred === 'string' && !preferred.startsWith('<')
      ? resolver(preferred) : preferred);
    const id = parseDiscordEmoji(direct)?.id;
    if (id && !used.has(id)) { used.add(id); return direct; }
    const name = parseDiscordEmoji(typeof preferred === 'string' ? preferred : '')?.name
      || (typeof preferred === 'object' ? preferred?.name : preferred);
    const semantic = getCanonicalEmojiSlot(name) || String(name || '');
    for (const slot of relatedArt.find(([pattern]) => pattern.test(semantic))?.[1] || []) {
      const token = canonical(resolver(slot));
      const candidateId = parseDiscordEmoji(token)?.id;
      if (candidateId && !used.has(candidateId)) { used.add(candidateId); return token; }
    }
    const alternatives = candidates();
    const first = offset(`${seed}:${purpose || sequence}`, alternatives.length);
    for (let index = 0; index < alternatives.length; index++) {
      const token = alternatives[(first + index) % alternatives.length];
      const candidateId = parseDiscordEmoji(token)?.id;
      if (candidateId && !used.has(candidateId)) { used.add(candidateId); return token; }
    }
    missing++;
    return '';
  };
  allocate.component = (preferred, purpose) => {
    const parsed = parseDiscordEmoji(allocate(preferred, purpose));
    return parsed ? { id: parsed.id, name: parsed.name, animated: parsed.animated } : null;
  };
  allocate.status = () => ({ allocated: used.size, missing });
  return allocate;
}

function buttonSlot(label) {
  if (/ví/i.test(label)) return 'icon_wallet';
  if (/payos|thanh toán/i.test(label)) return 'payment_payos';
  if (/nhận hàng/i.test(label)) return 'icon_gift';
  if (/hỗ trợ|ticket/i.test(label)) return 'cenar_support';
  if (/danh mục/i.test(label)) return 'icon_store';
  return 'icon_doc';
}

/** Presentation only: no IDs, values, links, file data or literal code changes. */
export function withUniqueCustomEmoji(payload, { guildId, seed = '', resolver } = {}) {
  const E = createUniqueCustomEmojiResolver(guildId, { seed, ...(resolver ? { resolver } : {}) });
  const text = (value, purpose) => String(value).split(protectedText).map(part => {
    if (/^(?:`|\|\||https?:\/\/)/.test(part)) return part;
    return part.replace(nativeEmoji, '').replace(CUSTOM, token => E(token, purpose));
  }).join('');
  const visit = (value, path = 'view') => {
    const item = json(value);
    if (!item || typeof item !== 'object') return item;
    if (Array.isArray(item)) return item.map((child, index) => visit(child, `${path}.${index}`));
    const result = {};
    for (const [key, child] of Object.entries(item)) {
      if (key === 'files') result[key] = child;
      else if (key === 'content' && typeof child === 'string') result[key] = text(child, path);
      else if (['label', 'placeholder', 'description'].includes(key) && typeof child === 'string') {
        result[key] = child.replace(nativeEmoji, '').replace(CUSTOM, '').trim();
      } else if (key !== 'emoji') result[key] = ['components', 'options', 'accessory'].includes(key)
        ? visit(child, `${path}.${key}`) : child;
    }
    if (item.emoji || item.type === 2 || (item.label && item.value !== undefined)) {
      const emoji = E.component(item.emoji || buttonSlot(item.label || ''), `${path}.emoji`);
      if (emoji) result.emoji = emoji;
    }
    if (item.type === 10 && /^#{1,3}\s/.test(result.content || '')
      && !(result.content.split('\n')[0].match(CUSTOM) || []).length) {
      const icon = E('panel_order', `${path}.heading`);
      if (icon) result.content = result.content.replace(/^(#{1,3})\s*/, `$1 ${icon} `);
    }
    return result;
  };
  const result = visit(payload);
  if (E.status().missing) {
    const first = result.components?.find(component => component.type === 17);
    if (first) first.components.push({ type: 10,
      content: '-# Bộ emoji custom đang đồng bộ; chức năng và thông tin đơn hàng vẫn sử dụng được.' });
  }
  return result;
}

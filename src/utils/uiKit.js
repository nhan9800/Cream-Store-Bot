// ╔══════════════════════════════════════════════════════╗
// ║  UI Kit — primitive dùng chung cho Components V2      ║
// ║                                                      ║
// ║  Mục tiêu: mọi builder V2 gọi chung 1 nguồn màu       ║
// ║  (config.accentColor*) + 1 cách mô phỏng branding,    ║
// ║  thay cho việc tự new ContainerBuilder + hardcode hex.║
// ║                                                      ║
// ║  Phần format CHUỖI (h2/subtext/fields/vnd/...) tái     ║
// ║  dùng embedHelpers.js — uiKit chỉ lo dựng Container.   ║
// ╚══════════════════════════════════════════════════════╝

import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
} from 'discord.js';
import { config } from '../config.js';
import { h2, h3, subtext, fields as fieldsBlock, lines as joinLines } from './embedHelpers.js';

// ─── Màu: nguồn duy nhất, map từ config.accentColor* ────────
const KIND_ACCENT = {
  primary: config.accentColorPrimary,
  success: config.accentColorSuccess,
  warning: config.accentColorWarning,
  info: config.accentColorInfo,
  danger: config.accentColorDanger,
};

/** Trả mã màu số cho 1 kind ngữ nghĩa. Thay mọi hardcode hex. */
export function accentFor(kind = 'primary') {
  return KIND_ACCENT[kind] ?? KIND_ACCENT.primary;
}

// ─── Branding cho V2 (mô phỏng author/footer của embed) ─────
function brandConfig(kind = 'store') {
  if (kind === 'shipper') {
    return { name: config.shipperName, footer: config.shipperFooter, icon: config.shipperIconUrl };
  }
  return { name: config.storeName, footer: config.storeFooter, icon: config.storeIconUrl };
}

/** Dòng footer subtext mô phỏng setFooter() — dùng cuối container. */
export function brandFooterLine(kind = 'store') {
  const brand = brandConfig(kind);
  return subtext(brand.footer || brand.name || 'Cenar Store');
}

/** Tên brand (đọc từ config, KHÔNG hardcode). */
export function brandName(kind = 'store') {
  return brandConfig(kind).name || 'Cenar Store';
}

// ─── Khởi tạo + primitive thêm vào container ────────────────

/** Tạo ContainerBuilder đã set accent theo kind ngữ nghĩa. */
export function container({ accent = 'primary' } = {}) {
  return new ContainerBuilder().setAccentColor(accentFor(accent));
}

/** Thêm 1 TextDisplay (content là chuỗi đã format sẵn bằng embedHelpers). */
export function addText(c, content) {
  const normalized = normalizeV2Text(content);
  if (!normalized) return c;
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(normalized));
  return c;
}

/**
 * Chuẩn hóa nội dung TextDisplay trước khi gửi lên Discord.
 * Components V2 rất dễ bị cảm giác rời rạc khi mỗi builder tự thêm nhiều
 * dòng trống; quy tắc chung chỉ giữ tối đa một dòng trống giữa các section.
 */
export function normalizeV2Text(content) {
  if (content === null || content === undefined) return '';
  return stripDiscordUnicode(String(content))
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Components V2 must use the server's custom emoji set. Strip native emoji
// and presentation selectors at the final payload boundary so legacy builders
// cannot reintroduce platform-dependent glyphs.
export function stripDiscordUnicode(value) {
  return String(value)
    .replace(/[\u{1F000}-\u{1FAFF}\u{1FC00}-\u{1FFFD}\u2600-\u27BF\u2300-\u23FF\u2B00-\u2BFF]/gu, '')
    .replace(/[\uFE0E\uFE0F\u200D\u20E3]/g, '');
}

export function sanitizeDiscordPayload(payload) {
  const visit = (value) => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return stripDiscordUnicode(value);
    if (Array.isArray(value)) return value.map(visit);
    if (typeof value?.toJSON === 'function' && /Builder$/.test(value.constructor?.name || '')) {
      return visit(value.toJSON());
    }
    if (typeof value === 'object') {
      const result = {};
      for (const [key, child] of Object.entries(value)) {
        result[key] = key === 'files' ? child : visit(child);
      }
      return result;
    }
    return value;
  };
  return visit(payload);
}

/** TextDisplay đã chuẩn hóa, dùng cho các builder V2 không dùng addText(). */
export function textDisplay(content) {
  const normalized = normalizeV2Text(content);
  return normalized ? new TextDisplayBuilder().setContent(normalized) : null;
}

/** Header: h2(title) + optional dòng subtitle (đã format sẵn). */
export function addHeader(c, { title, subtitle = null } = {}) {
  const content = joinLines(h2(title), subtitle);
  return addText(c, content);
}

/** Khối field dạng `> **Label:** value` từ object pairs (lọc rỗng). */
export function addFieldsBlock(c, pairs) {
  const block = fieldsBlock(pairs);
  return addText(c, block);
}

/** Separator (đường kẻ ngang). */
export function addSeparator(c, { divider = true, size = 'small' } = {}) {
  const spacing = size === 'large' ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small;
  c.addSeparatorComponents(new SeparatorBuilder().setDivider(divider).setSpacing(spacing));
  return c;
}

/** Banner/ảnh inline. Chấp nhận URL ngoài hoặc 'attachment://file.png'. */
export function addBanner(c, urlOrAttachment) {
  if (!urlOrAttachment) return c;
  c.addMediaGalleryComponents(
    new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(urlOrAttachment)
    )
  );
  return c;
}

/** Footer brand (subtext). Thêm separator nhỏ trước footer cho gọn. */
export function addFooter(c, kind = 'store', { separator = true } = {}) {
  if (separator) addSeparator(c, { divider: true, size: 'small' });
  return addText(c, brandFooterLine(kind));
}

// ─── Đóng gói payload (chuẩn hoá return) ────────────────────

/** Chuẩn hoá payload V2: { components, flags }. */
export function v2(components, { extraRows = [] } = {}) {
  const list = Array.isArray(components) ? components : [components];
  return {
    components: [...list, ...extraRows],
    flags: MessageFlags.IsComponentsV2,
  };
}

/**
 * Như v2 nhưng kèm allowedMentions để mention trong TextDisplay ping được.
 * Mention <@id> phải tự nhúng vào nội dung TextDisplay TRƯỚC khi gọi.
 */
export function v2Mention(userId, components, { extraRows = [] } = {}) {
  return {
    ...v2(components, { extraRows }),
    allowedMentions: { users: userId ? [String(userId)] : [] },
  };
}

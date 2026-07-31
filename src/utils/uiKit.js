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
  if (content === null || content === undefined || content === '') return c;
  c.addTextDisplayComponents(new TextDisplayBuilder().setContent(String(content)));
  return c;
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
  const spacing = size === 'large' ? SeparatorSpacingSize.Small : SeparatorSpacingSize.Small;
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

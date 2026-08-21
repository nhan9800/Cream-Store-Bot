import { getEmojiMap } from '../services/emojiService.js';

const fallbackEmojis = {
  // Emoji.gg assets uploaded to Cenar Store (2026-08-08)
  cenar_verified: '<:cenar_verified:1535618654358736926>',
  // Emoji support cũ đã bị xóa khỏi guild; dùng asset staff còn hoạt động cho tới
  // khi auto-sync nạp lại mapping cenar_support từ emoji đã chuẩn hóa.
  cenar_support: '<:cenar_staff:1535618674885402684>',
  cenar_staff: '<:cenar_staff:1535618674885402684>',
  cenar_admin: '<:cenar_admin:1535618678853337149>',
  cenar_wallet: '<:cenar_wallet:1535618682481545217>',
  cenar_partner: '<:cenar_partner:1535637391841173534>',
  cenar_partner_ok: '<:cenar_partner_ok:1535637394207015003>',
  cenar_ctv: '<:cenar_ctv:1535637396782317689>',
  cenar_cooldown: '<:cenar_cooldown:1535637399596699688>',
  cenar_announce: '<:cenar_announce:1535637405820911698>',
  cenar_price: '<:cenar_price:1535637409759494185>',
  warranty_shield: '<:cenar_warranty_shield:1535690283893784738>',
  warranty_purchase: '<:cenar_purchase_date:1535690286427275336>',
  warranty_expiry: '<:cenar_expiry_date:1535690288658518068>',
  transcript_web: '<:cenar_transcript_web:1535690290684231700>',
  customer_patron: '<:cenar_activity_search:1535690292420812962>',
  otp_loading: '<a:cenar_otp_loading:1535705387024515082>',
  card_success: '<a:cenar_card_success:1535705389780439160>',
  ctv_crystal: '<a:cenar_ctv_crystal:1535705392674508833>',
  partner_rules: '<:cenar_partner_rules:1535867940161716328>',
  partner_guide: '<:cenar_partner_guide:1535867942183636992>',
  verify_shield: '<:cenar_verify_shield:1535887317011664987>',
  recovery_backup: '<a:cenar_recovery_backup:1535887319406485627>',
  recovery_restore: '<:cenar_recovery_restore:1535887322304880671>',
  brand_locket: '<:cenar_tsm_locket:1282651426459226155>',

  // Promotion board · Emoji.gg Basic License (2026-08-20)
  promo_discount: '<:cenar_promo_discount:1539948477562490912>',
  promo_nitro: '<a:cenar_promo_nitro:1539948481714593853>',
  promo_boost: '<a:cenar_promo_boost:1539948484885479455>',
  promo_netflix: '<a:cenar_promo_netflix:1539948487846662194>',
  promo_decor: '<a:cenar_promo_decor:1539948490203992085>',
  promo_legend: '<:cenar_promo_legend:1539948492905250846>',

  // Panel Ticket buttons
  panel_order:        '<:cr_muahang:1348622828152426528>',
  panel_support:      '<:cenar_staff:1535618674885402684>',
  panel_complaint:    '<a:dot_red:1367140105248047114>',
  panel_partnership:  '<:cenar_partner:1535637391841173534>',
  panel_warranty:     '<:cenar_verified:1535618654358736926>',
  panel_edit:         '<:cenar_admin:1535618678853337149>',

  // Stock / Order
  stock_header:       '<:cenar_shop:1535691148994023506>',
  order_created:      '<:cenar_verified:1535618654358736926>',
  order_queue:        '<a:Dotyellow:1481134440725090315>',
  order_cancel:       '<a:tick_red51:1384069065626222632>',
  order_complete:     '<a:tickgreen:1384069022831874169>',
  order_processing:   '<a:redload:1459179959158571119>',
  order_pending:      '<a:redload:1459179959158571119>',
  order_id:           '<:cenar_verified:1535618654358736926>',
  order_product:      '<a:Arrow2:1367139234833498113>',
  admin_order_center: '<:cenar_admin:1535618678853337149>',
  admin_order_week1:  '<a:Dotyellow:1481134440725090315>',
  admin_order_week2:  '<a:tick_red51:1384069065626222632>',
  admin_order_priority: '<a:tsm_fire:1327553120842158111>',

  // Payment
  payment_payos:      '<:cr_cardd:1348624271437463552>',
  payment_vietqr:     '<:cr_vcb:1348627024859889676>',
  payment_success:    '<a:tickgreen:1384069022831874169>',
  payment_qr:         '<:cenar_verifybadge:1535690872551768164>',
  payment_money:      '<:cenar_wallet:1535618682481545217>',
  payment_refund:     '<a:tick_red51:1384069065626222632>',

  // Ticket
  ticket_close:       '<a:tick_red51:1384069065626222632>',
  ticket_claim:       '<:cenar_verifybadge:1535690872551768164>',
  ticket_open:        '<:cenar_staff:1535618674885402684>',
  ticket_user:        '<:cenar_verified:1535618654358736926>',
  ticket_staff:       '<:cenar_staff:1535618674885402684>',

  // Time
  icon_clock:         '<a:redload:1459179959158571119>',
  icon_calendar:      '<a:Arrow2:1367139234833498113>',
  icon_expire:        '<a:tick_red51:1384069065626222632>',
  icon_history:       '<:cr_baohanh:1348625535512870965>',
  icon_duration:      '<a:redload:1459179959158571119>',
  icon_location:      '<:verifybadge:1481127479702847646>',
  icon_heart_purple:  '<:cenar_tim:1535691544387002508>',

  // Status
  status_check:       '<a:tickgreen:1384069022831874169>',
  status_cross:       '<a:tick_red51:1384069065626222632>',
  status_warn:        '<a:Dotyellow:1481134440725090315>',
  status_info:        '<a:starxoay:1481141954346483845>',
  status_loading:     '<a:redload:1459179959158571119>',

  // Brands
  brand_netflix:      '<:cenar_price_netflix:1535910620828803113>',
  brand_spotify:      '<:cenar_spotify:1535690966911025262>',
  brand_youtube:      '<:cenar_youtube:1535691301343858739>',
  brand_chatgpt:      '<:cenar_price_chatgpt:1535910616748007464>',
  brand_nitro:        '<:cenar_price_nitro:1535910618782240768>',
  brand_boost:        '<:boost:1327543332171284532>',
  brand_discord:      '<:discord_nitro:1384901794475282523>',
  brand_adobe:        '<:cr_adobe:1366632539032125470>',
  brand_capcut:       '<:capcut:1481152550521536615>',
  brand_claude:       '<:cenar_claude:1535690552874639531>',
  brand_office:       '<:office365:1459180639390535836>',
  brand_gearup:       '<:gearup:1515216203453432002>',
  brand_gemini:       '<:gemini:1481157054210248864>',

  // Misc
  icon_price:         '<:cenar_money:1535691094585507930>',
  icon_duration:      '<a:redload:1459179959158571119>',
  icon_store:         '<:cenar_shop:1535691148994023506>',
  icon_star:          '<a:sao:1481149556753305600>',
  icon_fire:          '<a:tsm_fire:1327553120842158111>',
  icon_gem:           '<:Diamond:1485905790903783465>',
  icon_gift:          '<a:starxoay:1481141954346483845>',
  icon_sparkle:       '<a:starxoay:1481141954346483845>',
  icon_crown:         '<:cenar_platinum:1535690430329393153>',
  icon_chart:         '<a:starxoay:1481141954346483845>',
  icon_id:            '<:cenar_verified:1535618654358736926>',
  icon_location:      '<a:Dotyellow:1481134440725090315>',
  icon_settings:      '<:cenar_admin:1535618678853337149>',
  icon_key:           '<:cenar_verifybadge:1535690872551768164>',
  icon_link:          '<a:Arrow2:1367139234833498113>',
  icon_trophy:        '<a:starxoay:1481141954346483845>',
  icon_gold:          '<:Gold:1485905231199076412>',
  icon_silver:        '<:sliver:1327567474211684394>',
  icon_bronze:        '<:bronze:1327567486219976764>',
  icon_clipboard:     '<:cenar_shop:1535691148994023506>',
  icon_heart:         '<:cenar_tim:1535691544387002508>',
  icon_heart_purple:  '<:cenar_tim:1535691544387002508>',
  icon_cart:          '<a:cenar_price_cart:1535910626088583190>',
  icon_wallet:        '<:cenar_wallet:1535618682481545217>',
  icon_brain:         '<:chatgopete:1481154927677014098>',
  icon_announce:      '<a:Arrow2:1367139234833498113>',
  icon_group:         '<:2895managerbadge:1483326442245849200>',
  icon_search:        '<:cenar_activity_search:1535690292420812962>',
  icon_tip:           '<a:starxoay:1481141954346483845>',
  icon_doc:           '<:cenar_shop:1535691148994023506>',
  icon_art:           '<:cr_adobe:1366632539032125470>',
  icon_green:         '<a:tickgreen:1384069022831874169>',
  icon_red:           '<a:tick_red51:1384069065626222632>',
  icon_prev:          '<a:Arrow2:1367139234833498113>',
  icon_next:          '<a:Arrow2:1367139234833498113>',
};

/**
 * Tạo emoji resolver cho một guild.
 * Trả về custom emoji của server/application nếu có, nếu không → dùng fallback
 * Unicode được truyền vào. Slot chưa cấu hình + không truyền fallback → chuỗi rỗng.
 * @param {string} guildId
 * @returns {(slot: string, fallback?: string) => string}
 */
export function createEmojiResolver(guildId) {
  const em = guildId ? getEmojiMap(guildId) : {};
  const fn = (slot, fallback = '') => {
    const candidate = em[slot] || fallbackEmojis[slot] || fallback;
    // UI policy: only render Discord custom emoji. Existing callers may still
    // pass a historical Unicode fallback; intentionally discard it here.
    const match = String(candidate || '').match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
    if (!match) return '';
    // Tên emoji có thể đã được chuẩn hóa thành cenar_<ten> trong khi ID giữ
    // nguyên. Dùng tên thật từ cache để mọi Components V2 và tin nhắn đều hiển
    // thị đúng ngay cả trước khi mapping database được refresh.
    const cache = global.discordClient?.guilds?.cache.get(guildId)?.emojis?.cache
      || global.discordClient?.emojis?.cache;
    const cached = cache?.get(match[3]);
    if (cached) return cached.animated
      ? `<a:${cached.name}:${cached.id}>`
      : `<:${cached.name}:${cached.id}>`;
    if (cache?.size) return '';
    return candidate;
  };
  // Trả về object emoji cho ButtonBuilder.setEmoji() — nút không nhúng được
  // custom emoji vào label, phải gắn rời qua .setEmoji(). Slot trống → null.
  fn.component = (slot) => {
    const raw = fn(slot);
    const m = raw && raw.match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
    return m ? { id: m[3], name: m[2], animated: m[1] === 'a' } : null;
  };
  return fn;
}

/**
 * Chuẩn hóa custom emoji trước khi đưa vào Discord component builders.
 * Resolver cố ý trả null khi guild không có emoji; Discord.js lại ném
 * ValidationError nếu null/undefined được truyền thẳng vào setEmoji().
 */
export function normalizeButtonEmoji(value) {
  if (!value) return null;

  if (typeof value === 'string') {
    const custom = value.match(/^<(a?):([a-zA-Z0-9_]+):(\d{17,20})>$/);
    if (custom) {
      return { id: custom[3], name: custom[2], animated: custom[1] === 'a' };
    }
    if (/^\d{17,20}$/.test(value)) return { id: value };
    return null;
  }

  if (typeof value !== 'object') return null;
  const id = String(value.id || '').trim();
  if (!/^\d{17,20}$/.test(id)) return null;
  const name = String(value.name || '').trim();
  return {
    id,
    ...(name ? { name } : {}),
    ...(value.animated === true ? { animated: true } : {}),
  };
}

/**
 * Gắn custom emoji đầu tiên hợp lệ, hoặc giữ nguyên button khi không có emoji.
 * Hàm luôn trả lại builder để vẫn có thể dùng theo kiểu chain.
 */
export function withButtonEmoji(button, ...candidates) {
  for (const candidate of candidates) {
    const emoji = normalizeButtonEmoji(candidate);
    if (!emoji) continue;
    button.setEmoji(emoji);
    break;
  }
  return button;
}


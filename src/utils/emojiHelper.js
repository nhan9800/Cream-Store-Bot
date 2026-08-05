import { getEmojiMap } from '../services/emojiService.js';

const fallbackEmojis = {
  // Panel Ticket buttons
  panel_order:        '<:cr_muahang:1348622828152426528>',
  panel_support:      '<a:starxoay:1481141954346483845>',
  panel_complaint:    '<a:dot_red:1367140105248047114>',
  panel_partnership:  '<:Partner:1367138825129955379>',
  panel_warranty:     '<:cr_baohanh:1348625535512870965>',
  panel_edit:         '<:gearup:1515216203453432002>',

  // Stock / Order
  stock_header:       '<:cr_shop:1392749981332541501>',
  order_created:      '<a:tickgreen:1384069022831874169>',
  order_queue:        '<a:Dotyellow:1481134440725090315>',
  order_cancel:       '<a:tick_red51:1384069065626222632>',
  order_complete:     '<a:tickgreen:1384069022831874169>',
  order_processing:   '<a:redload:1459179959158571119>',
  order_pending:      '<a:redload:1459179959158571119>',
  order_id:           '<:verifybadge:1481127479702847646>',
  order_product:      '<a:Arrow2:1367139234833498113>',

  // Payment
  payment_payos:      '<:cr_cardd:1348624271437463552>',
  payment_vietqr:     '<:cr_vcb:1348627024859889676>',
  payment_success:    '<a:tickgreen:1384069022831874169>',
  payment_qr:         '<:verifybadge:1481127479702847646>',
  payment_money:      '<:money:1442876095442714748>',
  payment_refund:     '<a:tick_red51:1384069065626222632>',

  // Ticket
  ticket_close:       '<a:tick_red51:1384069065626222632>',
  ticket_claim:       '<:verifybadge:1481127479702847646>',
  ticket_open:        '<a:tickgreen:1384069022831874169>',
  ticket_user:        '<:verifybadge:1481127479702847646>',
  ticket_staff:       '<:2895managerbadge:1483326442245849200>',

  // Time
  icon_clock:         '<a:redload:1459179959158571119>',
  icon_calendar:      '<a:Arrow2:1367139234833498113>',
  icon_expire:        '<a:tick_red51:1384069065626222632>',
  icon_history:       '<:cr_baohanh:1348625535512870965>',
  icon_duration:      '<a:redload:1459179959158571119>',
  icon_location:      '<:verifybadge:1481127479702847646>',
  icon_heart_purple:  '<:purple_heart_glow:1327541911749263360>',

  // Status
  status_check:       '<a:tickgreen:1384069022831874169>',
  status_cross:       '<a:tick_red51:1384069065626222632>',
  status_warn:        '<a:Dotyellow:1481134440725090315>',
  status_info:        '<a:starxoay:1481141954346483845>',
  status_loading:     '<a:redload:1459179959158571119>',

  // Brands
  brand_netflix:      '<:Netflix:1481133651319328789>',
  brand_spotify:      '<:spotify:1459181297288220704>',
  brand_youtube:      '<:youtube:1373734824342327297>',
  brand_chatgpt:      '<:chatgopete:1481154927677014098>',
  brand_nitro:        '<:discord_nitro:1384901794475282523>',
  brand_boost:        '<:boost:1327543332171284532>',
  brand_discord:      '<:discord_nitro:1384901794475282523>',
  brand_adobe:        '<:cr_adobe:1366632539032125470>',
  brand_capcut:       '<:capcut:1481152550521536615>',
  brand_claude:       '<:claude:1483324441076301824>',
  brand_office:       '<:office365:1459180639390535836>',
  brand_gearup:       '<:gearup:1515216203453432002>',
  brand_gemini:       '<:gemini:1481157054210248864>',

  // Misc
  icon_price:         '<:money:1442876095442714748>',
  icon_duration:      '<a:redload:1459179959158571119>',
  icon_store:         '<:cr_shop:1392749981332541501>',
  icon_star:          '<a:sao:1481149556753305600>',
  icon_fire:          '<a:tsm_fire:1327553120842158111>',
  icon_gem:           '<:Diamond:1485905790903783465>',
  icon_gift:          '<a:starxoay:1481141954346483845>',
  icon_sparkle:       '<a:starxoay:1481141954346483845>',
  icon_crown:         '<:Platinum:1485905566130765908>',
  icon_chart:         '<a:starxoay:1481141954346483845>',
  icon_id:            '<:verifybadge:1481127479702847646>',
  icon_location:      '<a:Dotyellow:1481134440725090315>',
  icon_settings:      '<:gearup:1515216203453432002>',
  icon_key:           '<:verifybadge:1481127479702847646>',
  icon_link:          '<a:Arrow2:1367139234833498113>',
  icon_trophy:        '<a:starxoay:1481141954346483845>',
  icon_gold:          '<:Gold:1485905231199076412>',
  icon_silver:        '<:sliver:1327567474211684394>',
  icon_bronze:        '<:bronze:1327567486219976764>',
  icon_clipboard:     '<:cr_shop:1392749981332541501>',
  icon_heart:         '<:purple_heart_glow:1327541911749263360>',
  icon_heart_purple:  '<:purple_heart_glow:1327541911749263360>',
  icon_cart:          '<:cr_carttt:1348626032747614268>',
  icon_wallet:        '<:cr_cardd:1348624271437463552>'
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
    return /^<a?:[a-zA-Z0-9_]+:\d+>$/.test(candidate) ? candidate : '';
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


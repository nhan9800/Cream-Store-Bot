/**
 * ╔══════════════════════════════════════════════════════╗
 * ║           Cream Store — Emoji Service                ║
 * ║  Cho phép admin cấu hình custom emoji Discord cho    ║
 * ║  từng "slot" giao diện của bot                       ║
 * ╚══════════════════════════════════════════════════════╝
 */

import { db, nowIso } from '../database/db.js';

// ═══════════════════════════════════════════════
// Định nghĩa các SLOT emoji và fallback mặc định
// ═══════════════════════════════════════════════
export const EMOJI_SLOTS = {
  // Panel Ticket buttons
  panel_order:        { label: 'Mua Hàng',             default: '🛍️' },
  panel_support:      { label: 'Hỗ Trợ',               default: '🆘' },
  panel_complaint:    { label: 'Khiếu Nại',            default: '⚠️' },
  panel_partnership:  { label: 'Hợp Tác',              default: '🤝' },
  panel_warranty:     { label: 'Bảo Hành',             default: '🛠️' },
  panel_edit:         { label: 'Sửa Panel (Admin)',    default: '✏️' },

  // Stock / Order
  stock_header:       { label: 'Header bảng giá',      default: '🛍️' },
  order_created:      { label: 'Đơn hàng tạo',         default: '✅' },
  order_queue:        { label: 'Hàng chờ',             default: '📌' },
  order_cancel:       { label: 'Hủy đơn',              default: '❌' },
  order_complete:     { label: 'Đơn hoàn thành',       default: '🎉' },
  order_processing:   { label: 'Đơn đang xử lý',       default: '⚙️' },
  order_pending:      { label: 'Đơn chờ thanh toán',   default: '⏳' },
  order_id:           { label: 'Mã đơn',               default: '🆔' },
  order_product:      { label: 'Sản phẩm',             default: '📦' },
  admin_order_center: { label: 'Trung tâm đơn admin',  default: '' },
  admin_order_week1:  { label: 'Đơn tồn 7 ngày',       default: '' },
  admin_order_week2:  { label: 'Đơn tồn 14 ngày',      default: '' },
  admin_order_priority: { label: 'Ưu tiên xử lý',      default: '' },

  // Payment
  payment_payos:      { label: 'PayOS',                default: '💳' },
  payment_vietqr:     { label: 'VietQR/Ngân hàng',    default: '🏦' },
  payment_success:    { label: 'Thanh toán thành công', default: '✅' },
  payment_qr:         { label: 'Mã QR',                default: '📱' },
  payment_money:      { label: 'Số tiền',              default: '💰' },
  payment_refund:     { label: 'Hoàn tiền',            default: '↩️' },

  // Ticket
  ticket_close:       { label: 'Đóng ticket',          default: '🔒' },
  ticket_claim:       { label: 'Claim đơn (Staff)',   default: '🛡️' },
  ticket_open:        { label: 'Mở ticket mới',        default: '🎫' },
  ticket_user:        { label: 'Khách hàng',           default: '👤' },
  ticket_staff:       { label: 'Nhân viên',            default: '🧑‍💼' },

  // Time
  icon_clock:         { label: 'Đồng hồ',              default: '⏰' },
  icon_calendar:      { label: 'Lịch',                 default: '📅' },
  icon_expire:        { label: 'Hết hạn',              default: '⏱️' },
  icon_history:       { label: 'Lịch sử',              default: '📜' },

  // Bảo hành / lưu trữ — mỗi ý nghĩa dùng một asset riêng để tránh lặp hình
  warranty_shield:    { label: 'Khiên bảo hành Cenar', default: '' },
  warranty_purchase:  { label: 'Ngày mua bảo hành',   default: '' },
  warranty_expiry:    { label: 'Ngày hết hạn',        default: '' },
  transcript_web:     { label: 'Transcript trên web', default: '' },
  customer_patron:    { label: 'Khách hàng Cenar',    default: '' },
  otp_loading:        { label: 'Đang chờ OTP (GIF)', default: '' },
  card_success:       { label: 'Thẻ thành công (GIF)', default: '' },
  ctv_crystal:        { label: 'Điểm nhấn CTV (GIF)', default: '' },
  partner_rules:      { label: 'Quy định Partner', default: '' },
  partner_guide:      { label: 'Hướng dẫn Partner', default: '' },
  verify_shield:      { label: 'Khiên xác minh OAuth', default: '' },
  recovery_backup:    { label: 'Backup mã hóa (GIF)', default: '' },
  recovery_restore:   { label: 'Khôi phục server', default: '' },

  // Bảng khuyến mãi
  promo_discount:     { label: 'Khuyến mãi Cenar', default: '' },
  promo_nitro:        { label: 'Nitro khuyến mãi', default: '' },
  promo_boost:        { label: 'Boost Server khuyến mãi', default: '' },
  promo_netflix:      { label: 'Netflix khuyến mãi', default: '' },
  promo_decor:        { label: 'Decor / Frames khuyến mãi', default: '' },
  promo_legend:       { label: 'Quà Tặng Huyền Thoại', default: '' },

  // Cenar Music · custom controls (resolve về emoji thật trong guild)
  music_wave:         { label: 'Cenar Music',           default: '' },
  music_now:          { label: 'Đang phát',             default: '' },
  music_add:          { label: 'Thêm bài',              default: '' },
  music_play:         { label: 'Phát nhạc',             default: '' },
  music_pause:        { label: 'Tạm dừng',              default: '' },
  music_skip:         { label: 'Chuyển bài',            default: '' },
  music_stop:         { label: 'Dừng nhạc',             default: '' },
  music_loop:         { label: 'Lặp bài',               default: '' },
  music_shuffle:      { label: 'Trộn hàng đợi',         default: '' },
  music_queue:        { label: 'Hàng đợi nhạc',         default: '' },
  music_volume:       { label: 'Âm lượng',              default: '' },
  music_refresh:      { label: 'Làm mới player',        default: '' },
  music_disconnect:   { label: 'Rời phòng thoại',      default: '' },

  // Status
  status_check:       { label: 'Tích xanh',            default: '✅' },
  status_cross:       { label: 'Dấu X',                default: '❌' },
  status_warn:        { label: 'Cảnh báo',             default: '⚠️' },
  status_info:        { label: 'Thông tin',            default: 'ℹ️' },
  status_loading:     { label: 'Đang tải',             default: '⏳' },

  // Brand
  brand_netflix:      { label: 'Netflix',              default: '🎬' },
  brand_spotify:      { label: 'Spotify',              default: '🎵' },
  brand_youtube:      { label: 'YouTube',              default: '📺' },
  brand_chatgpt:      { label: 'ChatGPT',              default: '🤖' },
  brand_nitro:        { label: 'Discord Nitro',        default: '💎' },
  brand_boost:        { label: 'Discord Boost',        default: '🚀' },
  brand_discord:      { label: 'Discord',              default: '💬' },
  brand_adobe:        { label: 'Adobe CC',             default: '🎨' },
  brand_capcut:       { label: 'CapCut',               default: '🎬' },
  brand_claude:       { label: 'Claude AI',            default: '🤖' },
  brand_locket:       { label: 'Locket Gold',          default: '' },
  brand_office:       { label: 'Office 365',           default: '📈' },
  brand_gearup:       { label: 'GearUP Booster',       default: '🎮' },
  brand_gemini:       { label: 'Gemini AI',            default: '✨' },

  // Misc
  icon_price:         { label: 'Biểu tượng giá',       default: '💰' },
  icon_duration:      { label: 'Biểu tượng thời hạn',   default: '⏱️' },
  icon_store:         { label: 'Biểu tượng cửa hàng',   default: '🏪' },
  icon_star:          { label: 'Sao',                  default: '⭐' },
  icon_fire:          { label: 'Lửa',                  default: '🔥' },
  icon_gem:           { label: 'Kim cương',            default: '💎' },
  icon_gift:          { label: 'Quà',                  default: '🎁' },
  icon_sparkle:       { label: 'Sparkle',              default: '✨' },
  icon_crown:         { label: 'Vương miện',           default: '👑' },
  icon_chart:         { label: 'Biểu đồ',              default: '📊' },
  icon_id:            { label: 'ID',                   default: '🆔' },
  icon_location:      { label: 'Địa điểm',             default: '📍' },
  icon_settings:      { label: 'Cài đặt',              default: '⚙️' },
  icon_key:           { label: 'Chìa khóa',            default: '🔑' },
  icon_link:          { label: 'Link',                 default: '🔗' },

  // Misc bổ sung (Wave: bỏ unicode sống) — tải từ Twemoji làm application emoji
  icon_cycle:         { label: 'Định kỳ (vòng lặp)',   default: '🔄' },
  icon_once:          { label: 'Mua lẻ (một lần)',     default: '🔂' },
  icon_home:          { label: 'Nhà / Gia đình',       default: '🏠' },
  icon_trash:         { label: 'Xóa / Thùng rác',      default: '🗑️' },
  icon_trophy:        { label: 'Cúp / Vinh danh',      default: '🏆' },
  icon_gold:          { label: 'Huy chương vàng',      default: '🥇' },
  icon_silver:        { label: 'Huy chương bạc',       default: '🥈' },
  icon_bronze:        { label: 'Huy chương đồng',      default: '🥉' },
  icon_empty:         { label: 'Trống / Hộp thư rỗng', default: '📭' },
  icon_clipboard:     { label: 'Bảng / Danh sách',     default: '📋' },
  icon_heart:         { label: 'Trái tim',             default: '❤️' },
  icon_heart_purple:  { label: 'Trái tim tím (brand)', default: '💜' },
  icon_cart:          { label: 'Giỏ hàng',             default: '🛒' },
  icon_block:         { label: 'Chặn / Cấm',           default: '🚫' },
  icon_wallet:        { label: 'Ví điện tử',           default: '💳' },
  icon_unlock:        { label: 'Mở khóa',              default: '🔓' },
  icon_brain:         { label: 'Bộ não / AI',          default: '🧠' },
  icon_web:           { label: 'Web / Internet',       default: '🌐' },
  icon_announce:      { label: 'Loa thông báo',        default: '📢' },
  icon_group:         { label: 'Nhóm người',           default: '👥' },
  icon_search:        { label: 'Tìm kiếm',             default: '🔍' },
  icon_up:            { label: 'Mũi tên lên',          default: '🔼' },
  icon_target:        { label: 'Mục tiêu',             default: '🎯' },
  icon_tip:           { label: 'Mẹo / Bóng đèn',       default: '💡' },
  icon_tag:           { label: 'Nhãn giá',             default: '🏷️' },
  icon_number:        { label: 'Số / Đếm',             default: '🔢' },
  icon_ticket:        { label: 'Vé / Mã giảm giá',     default: '🎟️' },
  icon_folder:        { label: 'Thư mục',              default: '🗂️' },
  icon_doc:           { label: 'Tài liệu',             default: '📄' },
  icon_edit:          { label: 'Ghi chú / Sửa',        default: '📝' },
  icon_book:          { label: 'Sách / Sổ',            default: '📚' },
  icon_art:           { label: 'Bảng màu',             default: '🎨' },
  icon_money_wings:   { label: 'Tiền bay (hoàn tiền)', default: '💸' },
  icon_green:         { label: 'Chấm xanh lá',         default: '🟢' },
  icon_red:           { label: 'Chấm đỏ',              default: '🔴' },
  icon_prev:          { label: 'Trang trước',          default: '⬅️' },
  icon_next:          { label: 'Trang sau',            default: '➡️' },
  icon_num1:          { label: 'Số 1',                 default: '1️⃣' },
  icon_num2:          { label: 'Số 2',                 default: '2️⃣' },
  icon_num3:          { label: 'Số 3',                 default: '3️⃣' },
  icon_num4:          { label: 'Số 4',                 default: '4️⃣' },
  icon_num5:          { label: 'Số 5',                 default: '5️⃣' },
  icon_num6:          { label: 'Số 6',                 default: '6️⃣' },
  icon_num7:          { label: 'Số 7',                 default: '7️⃣' },
  icon_num8:          { label: 'Số 8',                 default: '8️⃣' },
  icon_num9:          { label: 'Số 9',                 default: '9️⃣' },
  icon_num10:         { label: 'Số 10',                default: '🔟' },

  // Hướng dẫn Join Fam YouTube (2026-08) — đồng bộ từ scripts/sync-youtube-guide-emojis.js
  guide_youtube:      { label: 'HD Join Fam · Logo YouTube',      default: '' },
  guide_playstore:    { label: 'HD Join Fam · Logo Google Play',  default: '' },
  guide_wallet:       { label: 'HD Join Fam · Ví thanh toán',     default: '' },
  guide_family:       { label: 'HD Join Fam · Gia đình',          default: '' },
  guide_warning:      { label: 'HD Join Fam · Cảnh báo',          default: '' },
  guide_card:         { label: 'HD Join Fam · Thẻ thanh toán',    default: '' },
  guide_upgrade:      { label: 'YouTube · Nâng cấp',              default: '' },
  guide_refund:       { label: 'YouTube · Hoàn tiền',             default: '' },
  guide_exchange:     { label: 'YouTube · Đổi sản phẩm',          default: '' },
};

// ═══════════════════════════════════════════════
// Định nghĩa danh sách ALIAS của từng SLOT để auto-sync
// ═══════════════════════════════════════════════
export const SLOT_ALIASES = {
  // Panel Ticket buttons
  panel_order: ['mua_hang', 'order', 'shopping', 'cart'],
  panel_support: ['ho_tro', 'support', 'help', 'sos', 'cenar_support'],
  panel_complaint: ['khieu_nai', 'complaint', 'report'],
  panel_partnership: ['hop_tac', 'partnership', 'collab'],
  panel_warranty: ['bao_hanh', 'warranty', 'repair', 'cenar_verified'],
  panel_edit: ['sua_panel', 'edit_panel', 'cenar_admin'],

  // Stock / Order
  stock_header: ['stock_header', 'bang_gia', 'price_list'],
  order_created: ['order_created', 'success_created', 'don_hang_tao', 'cenar_verified'],
  order_queue: ['order_queue', 'queue', 'hang_cho'],
  order_cancel: ['order_cancel', 'cancel', 'huy_don'],
  order_complete: ['order_complete', 'complete', 'hoan_thanh'],
  order_processing: ['order_processing', 'processing', 'dang_xu_ly'],
  order_pending: ['order_pending', 'pending', 'cho_thanh_toan'],
  order_id: ['order_id', 'id_don', 'cenar_verified'],
  order_product: ['order_product', 'product', 'san_pham'],
  admin_order_center: ['cenar_order_center', 'order_center', 'admin_orders'],
  admin_order_week1: ['cenar_order_week1', 'order_week1', 'order_7d'],
  admin_order_week2: ['cenar_order_week2', 'order_week2', 'order_14d'],
  admin_order_priority: ['cenar_order_priority', 'order_priority', 'priority_order'],

  // Payment
  payment_payos: ['payos', 'bank_transfer', 'chuyen_khoan'],
  payment_vietqr: ['vietqr', 'banking', 'ngan_hang'],
  payment_success: ['payment_success', 'paid', 'da_thanh_toan', 'card_success'],
  payment_qr: ['qr_code', 'ma_qr'],
  payment_money: ['money', 'tien', 'price', 'coin', 'cenar_wallet'],
  payment_refund: ['refund', 'hoan_tien'],

  // Ticket
  ticket_close: ['close', 'ticket_close', 'dong_ticket'],
  ticket_claim: ['claim', 'ticket_claim', 'nhan_ticket'],
  ticket_open: ['open', 'ticket_open', 'mo_ticket', 'cenar_support'],
  ticket_user: ['user', 'ticket_user', 'khach_hang', 'cenar_verified'],
  ticket_staff: ['staff', 'ticket_staff', 'nhan_vien', 'cenar_staff'],

  // Time
  icon_clock: ['clock', 'time', 'dong_ho'],
  icon_calendar: ['calendar', 'lich', 'date'],
  icon_expire: ['expire', 'het_han'],
  icon_history: ['history', 'lich_su'],
  warranty_shield: ['cenar_warranty_shield', 'warranty_shield'],
  warranty_purchase: ['cenar_purchase_date', 'purchase_date'],
  warranty_expiry: ['cenar_expiry_date', 'expiry_date'],
  transcript_web: ['cenar_transcript_web', 'transcript_web'],
  customer_patron: ['cenar_activity_search', 'customer_activity'],
  otp_loading: ['cenar_otp_loading', 'otp_loading'],
  card_success: ['cenar_card_success', 'card_success'],
  ctv_crystal: ['cenar_ctv_crystal', 'ctv_crystal'],
  partner_rules: ['cenar_partner_rules', 'partner_rules'],
  partner_guide: ['cenar_partner_guide', 'partner_guide'],
  verify_shield: ['cenar_verify_shield', 'verify_shield'],
  recovery_backup: ['cenar_recovery_backup', 'recovery_backup'],
  recovery_restore: ['cenar_recovery_restore', 'recovery_restore'],
  promo_discount: ['cenar_promo_discount', 'promo_discount'],
  promo_nitro: ['cenar_promo_nitro', 'promo_nitro'],
  promo_boost: ['cenar_promo_boost', 'promo_boost'],
  promo_netflix: ['cenar_promo_netflix', 'promo_netflix'],
  promo_decor: ['cenar_promo_decor', 'promo_decor'],
  promo_legend: ['cenar_promo_legend', 'promo_legend'],
  music_wave: ['cenar_music_wave', 'spotify', 'cenar_spotify'],
  music_now: ['cenar_music_now', 'youtube', 'cenar_youtube'],
  music_add: ['cenar_music_add', 'cenar_verified'],
  music_play: ['cenar_music_playpause', 'cenar_music_play', 'tickgreen'],
  music_pause: ['cenar_music_playpause', 'cenar_music_pause', 'redload'],
  music_skip: ['cenar_music_skip', 'arrow2'],
  music_stop: ['cenar_music_stop', 'tick_red51'],
  music_loop: ['cenar_music_repeat', 'cenar_music_loop', 'starxoay'],
  music_shuffle: ['cenar_music_shuffle', 'cenar_activity_search'],
  music_queue: ['cenar_music_queue', 'cenar_shop'],
  music_volume: ['cenar_music_volume', 'cenar_spotify'],
  music_refresh: ['cenar_music_refresh', 'starxoay'],
  music_disconnect: ['cenar_music_disconnect', 'tick_red51'],

  // YouTube transition policy
  guide_upgrade: ['yt_upgrade', 'cenar_yt_upgrade', 'upgrade'],
  guide_refund: ['yt_refund', 'cenar_yt_refund', 'moneytransfer', 'refund'],
  guide_exchange: ['yt_exchange', 'cenar_yt_exchange', 'exchange'],

  // Status
  status_check: ['check', 'tick', 'success', 'tich_xanh'],
  status_cross: ['cross', 'fail', 'error', 'dau_x'],
  status_warn: ['warn', 'warning', 'caution', 'canh_bao'],
  status_info: ['info', 'thong_tin'],
  status_loading: ['loading', 'loading_icon', 'dang_tai', 'otp_loading'],

  // Brand
  brand_netflix: ['price_netflix', 'netflix', 'brand_netflix', 'netflix62'],
  brand_spotify: ['spotify', 'brand_spotify', 'spotify2', 'spotify_app_logo10'],
  // Prefer the refreshed YouTube logo pack; keep old names as fallbacks for
  // guilds that have not completed the automatic emoji sync yet.
  brand_youtube: ['cenar_yt_logo', 'yt_logo', 'youtube', 'brand_youtube'],
  brand_chatgpt: ['price_chatgpt', 'chatgpt', 'brand_chatgpt', 'cr_chatgpt'],
  brand_nitro: ['price_nitro', 'nitro', 'brand_nitro', 'discord_nitro', '9836flyingnitroboost'],
  brand_boost: ['boost', 'brand_boost', 'booster', 'discord_boost', '3825boosterorange', '9836flyingnitroboost'],
  brand_discord: ['discord', 'brand_discord'],
  brand_adobe: ['adobe', 'cr_adobe', 'photoshop_cc_icon3'],
  brand_capcut: ['capcut', 'cr_capcut'],
  brand_claude: ['claude', 'claude_ai', 'cr_claude'],
  brand_locket: ['tsm_locket', 'locket', 'locket_gold'],
  brand_office: ['office', 'office365', 'tsm_offices'],
  brand_gearup: ['gearup', 'gear_up'],
  brand_gemini: ['gemini', 'tsm_gemini'],

  // Misc
  icon_price: ['price_tag', 'tag_gia', 'money', 'cenar_price'],
  icon_duration: ['duration', 'thoi_han'],
  icon_store: ['shop', 'store', 'cua_hang', 'cr_shop'],
  icon_star: ['star', 'sao'],
  icon_fire: ['fire', 'lua'],
  icon_gem: ['gem', 'diamond', 'kim_cuong'],
  icon_gift: ['gift', 'qua'],
  icon_sparkle: ['sparkle', 'nhap_nhay'],
  icon_crown: ['crown', 'vuong_mien', 'platinum'],
  icon_chart: ['chart', 'bieu_do'],
  icon_id: ['id', 'icon_id', 'verified'],
  icon_location: ['location', 'dia_diem'],
  icon_settings: ['settings', 'cai_dat', 'cenar_admin'],
  icon_key: ['key', 'chia_khoa', 'verifybadge'],
  icon_link: ['link', 'lien_ket'],
  icon_cart: ['price_cart', 'cart', 'shopping_cart', 'gio_hang'],
  icon_search: ['activity_search', 'search', 'find', 'tim_kiem'],

  // Hướng dẫn Join Fam YouTube — emoji tải từ emoji.gg, tên trong server là cenar_yt_*
  guide_youtube: ['yt_logo', 'cenar_yt_logo', 'youtube_logo'],
  guide_playstore: ['yt_play', 'cenar_yt_play', 'playstore'],
  guide_wallet: ['yt_wallet', 'cenar_yt_wallet'],
  guide_family: ['yt_family', 'cenar_yt_family', 'family'],
  guide_warning: ['yt_warning', 'cenar_yt_warning'],
  guide_card: ['yt_card', 'cenar_yt_card', 'creditcard']
};

/**
 * Tự động đồng bộ các emoji từ server Discord vào các slot cấu hình
 * @param {import('discord.js').Guild} guild
 * @returns {{ syncedCount: number, updatedSlots: string[] }}
 */
export function autoSyncGuildEmojis(guild) {
  if (!guild) return { syncedCount: 0, updatedSlots: [] };
  
  const current = loadFromDb(guild.id);
  let changed = false;
  const updatedSlots = [];

  const guildEmojisMap = new Map();
  guild.emojis.cache.forEach(emoji => {
    guildEmojisMap.set(emoji.name.toLowerCase(), emoji);
  });

  for (const [slot, meta] of Object.entries(EMOJI_SLOTS)) {
    const rawNames = [slot, ...(SLOT_ALIASES[slot] || [])];
    const potentialNames = [...new Set(rawNames.flatMap((name) => [
      name,
      name.startsWith('cenar_') ? name : `cenar_${name}`,
    ]))];
    let matchedEmoji = null;
    for (const name of potentialNames) {
      const cleanName = name.toLowerCase();
      if (guildEmojisMap.has(cleanName)) {
        matchedEmoji = guildEmojisMap.get(cleanName);
        break;
      }
    }

    if (matchedEmoji) {
      const emojiString = matchedEmoji.animated 
        ? `<a:${matchedEmoji.name}:${matchedEmoji.id}>` 
        : `<:${matchedEmoji.name}:${matchedEmoji.id}>`;
      
      const currentVal = current[slot];
      let shouldUpdate = false;

      if (!currentVal) {
        shouldUpdate = true;
      } else {
        const parsed = parseDiscordEmoji(currentVal);
        if (parsed && parsed.id) {
          if (!guild.emojis.cache.has(parsed.id)) {
            shouldUpdate = true;
          } else {
            const oldEmoji = guild.emojis.cache.get(parsed.id);
            const isMatchingAlias = potentialNames.map(n => n.toLowerCase()).includes(oldEmoji.name.toLowerCase());
            if (
              oldEmoji.name !== parsed.name
              || (isMatchingAlias && oldEmoji.id !== matchedEmoji.id)
            ) {
              shouldUpdate = true;
            }
          }
        } else {
          shouldUpdate = true;
        }
      }

      if (shouldUpdate) {
        current[slot] = emojiString;
        changed = true;
        updatedSlots.push(slot);
      }
    }
  }

  if (changed) {
    const now = nowIso();
    const result = db.prepare(`
      UPDATE guild_settings
      SET custom_emojis = @custom_emojis, updated_at = @now
      WHERE guild_id = @guild_id
    `).run({ custom_emojis: JSON.stringify(current), now, guild_id: guild.id });

    if (result.changes === 0) {
      db.prepare(`
        INSERT INTO guild_settings (guild_id, custom_emojis, updated_at, ticket_category_id, order_log_channel_id, feedback_channel_id)
        VALUES (@guild_id, @custom_emojis, @now, '', '', '')
      `).run({ guild_id: guild.id, custom_emojis: JSON.stringify(current), now });
    }

    refreshCache(guild.id);
  }

  return { syncedCount: updatedSlots.length, updatedSlots };
}

// ═══════════════════════════════════════════════
// Cache theo guildId
// ═══════════════════════════════════════════════
const emojiCache = new Map(); // guildId → { slot → emojiString }

function loadFromDb(guildId) {
  try {
    const row = db.prepare(`SELECT custom_emojis FROM guild_settings WHERE guild_id = ?`).get(guildId);
    if (row?.custom_emojis) {
      return JSON.parse(row.custom_emojis);
    }
  } catch {}
  return {};
}

function refreshCache(guildId) {
  emojiCache.set(guildId, loadFromDb(guildId));
}

// ═══════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════

/**
 * Lấy emoji cho một slot. CHỈ trả về custom emoji của server/application.
 * KHÔNG fallback unicode (yêu cầu bắt buộc của dự án). Slot trống → chuỗi rỗng.
 * @param {string} guildId
 * @param {string} slot  — key từ EMOJI_SLOTS
 * @returns {string}  ví dụ: '<:mua_hang:1234567890>' hoặc ''
 */
export function getEmoji(guildId, slot) {
  if (!emojiCache.has(guildId)) refreshCache(guildId);
  const value = emojiCache.get(guildId)?.[slot] || '';
  return parseDiscordEmoji(value)?.formatted || '';
}

/**
 * Lấy toàn bộ emoji map cho một guild (để truyền vào builders).
 * CHỈ custom emoji — slot chưa cấu hình trả về chuỗi rỗng, không unicode.
 */
export function getEmojiMap(guildId) {
  if (!emojiCache.has(guildId)) refreshCache(guildId);
  const custom = emojiCache.get(guildId) || {};
  const result = {};
  for (const slot of Object.keys(EMOJI_SLOTS)) {
    result[slot] = custom[slot] || '';
  }
  return result;
}

/**
 * Lưu một emoji cho một slot vào DB và refresh cache
 * @param {string} guildId
 * @param {string} slot
 * @param {string} emojiString  — '<:name:id>' hoặc '<a:name:id>' hoặc unicode
 */
export function setEmoji(guildId, slot, emojiString) {
  if (!EMOJI_SLOTS[slot]) throw new Error(`Slot "${slot}" không tồn tại.`);

  const current = loadFromDb(guildId);
  if (emojiString === null || emojiString === 'reset') {
    delete current[slot];
  } else {
    if (!parseDiscordEmoji(emojiString)) {
      throw new Error('Chỉ được dùng emoji custom dạng <:ten:id> hoặc <a:ten:id>.');
    }
    current[slot] = emojiString;
  }

  const now = nowIso();

  // Thử UPDATE trước (row đã tồn tại sau /setup)
  const result = db.prepare(`
    UPDATE guild_settings
    SET custom_emojis = @custom_emojis, updated_at = @now
    WHERE guild_id = @guild_id
  `).run({ custom_emojis: JSON.stringify(current), now, guild_id: guildId });

  // Nếu chưa có row nào (guild chưa /setup) → INSERT với giá trị rỗng cho cột bắt buộc
  if (result.changes === 0) {
    db.prepare(`
      INSERT INTO guild_settings (guild_id, custom_emojis, updated_at, ticket_category_id)
      VALUES (@guild_id, @custom_emojis, @now, '')
    `).run({ guild_id: guildId, custom_emojis: JSON.stringify(current), now });
  }


  refreshCache(guildId);
  return current;
}

/**
 * Reset toàn bộ custom emoji về mặc định
 */
export function resetAllEmojis(guildId) {
  db.prepare(`UPDATE guild_settings SET custom_emojis = NULL WHERE guild_id = ?`).run(guildId);
  emojiCache.delete(guildId);
}

/**
 * Parse custom emoji string từ Discord message (format: <:name:id> hoặc <a:name:id>)
 * Trả về { name, id, animated, formatted } hoặc null
 */
export function parseDiscordEmoji(str) {
  const match = str?.trim().match(/^<(a?):([a-zA-Z0-9_]+):(\d+)>$/);
  if (!match) return null;
  return {
    animated: match[1] === 'a',
    name: match[2],
    id: match[3],
    formatted: str.trim(),
  };
}

/**
 * Check if a string looks like a valid standard Unicode emoji.
 * Rejects plain ASCII text, empty strings, and overly long strings.
 * Discord API only accepts real emoji characters as component emoji names.
 */
function isValidUnicodeEmoji(str) {
  if (!str || typeof str !== 'string') return false;
  // Emoji codepoints are very short (1-8 chars accounting for ZWJ sequences)
  if (str.length > 14) return false;
  // If the string is only ASCII letters, digits, underscores, or spaces → NOT an emoji
  if (/^[a-zA-Z0-9_\s.,!?:;'"()\-]+$/.test(str)) return false;
  // Must contain at least one character outside basic ASCII (emoji live in higher Unicode planes)
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]+$/.test(str)) return false;
  return true;
}

/**
 * Resolve an emoji string (standard or custom) for Discord.js Select Menu option emoji field.
 * Returns a validated emoji or null. Never returns an invalid value that would crash Discord API.
 * @param {string} guildId
 * @param {string} emojiStr 
 * @param {string} fallback 
 * @returns {string|{id: string, name: string, animated: boolean}|null}
 */
export function resolveSelectMenuEmoji(guildId, emojiStr, fallback = null) {
  try {
    if (!emojiStr) {
      return fallback ? resolveSelectMenuEmoji(guildId, fallback, null) : null;
    }

    // If emojiStr is a slot key, resolve it first
    let resolvedEmoji = emojiStr;
    if (EMOJI_SLOTS[emojiStr]) {
      resolvedEmoji = getEmoji(guildId, emojiStr);
    }

    const parsed = parseDiscordEmoji(resolvedEmoji);
    if (parsed) {
      // If the custom emoji ID is not in the bot's cache, it's invalid/deleted/external.
      // We must reject it and resolve the fallback to prevent COMPONENT_INVALID_EMOJI API crash.
      if (global.discordClient && !global.discordClient.emojis.cache.has(parsed.id)) {
        return fallback ? resolveSelectMenuEmoji(guildId, fallback, null) : null;
      }
      return {
        id: parsed.id,
        name: parsed.name,
        animated: parsed.animated,
      };
    }
    // Native Unicode emoji are intentionally disabled by the Cenar UI policy.
    return fallback ? resolveSelectMenuEmoji(guildId, fallback, null) : null;
  } catch {
    // Any unexpected error → gracefully return null instead of crashing
    return null;
  }
}

/**
 * Resolve product catalog emoji slot/string into displayable string format.
 * @param {string} guildId
 * @param {string} emojiStr
 * @returns {string}
 */
export function resolveProductEmoji(guildId, emojiStr) {
  if (!emojiStr) return '';

  const raw = String(emojiStr).trim();
  const parsed = parseDiscordEmoji(raw);
  const legacyName = raw.match(/^:([a-zA-Z0-9_]+):$/)?.[1];
  const lookupName = (parsed?.name || legacyName || raw).toLowerCase();
  const slot = EMOJI_SLOTS[raw]
    ? raw
    : Object.entries(SLOT_ALIASES).find(([slotName, aliases]) => (
      slotName.toLowerCase() === lookupName
      || aliases.some((alias) => alias.toLowerCase() === lookupName)
    ))?.[0];

  const guildCache = global.discordClient?.guilds?.cache.get(guildId)?.emojis?.cache;
  const globalCache = global.discordClient?.emojis?.cache;
  const cache = guildCache?.size ? guildCache : globalCache;
  const formatCached = (emoji) => emoji
    ? (emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`)
    : '';

  // A full Discord mention is safe only while its ID still exists. If an emoji
  // was renamed, rebuild the mention with the live name from cache.
  if (parsed) {
    const cachedById = cache?.get(parsed.id);
    if (cachedById) return formatCached(cachedById);
    if (!cache?.size) return parsed.formatted;
  }

  if (slot) {
    const configured = getEmoji(guildId, slot);
    const configuredParsed = parseDiscordEmoji(configured);
    if (configuredParsed) {
      const cachedConfigured = cache?.get(configuredParsed.id);
      if (cachedConfigured) return formatCached(cachedConfigured);
      if (!cache?.size) return configuredParsed.formatted;
    }
  }

  // Legacy catalog values such as :spotify2: may refer to an emoji that was
  // later normalized to cenar_spotify2. Resolve either live name when present.
  const cachedByName = cache?.find?.((emoji) => {
    const name = String(emoji.name || '').toLowerCase();
    return name === lookupName || name === `cenar_${lookupName}`;
  });
  return formatCached(cachedByName);
}

/**
 * Render product names that may still contain legacy `:emoji_name:` tokens.
 * Invalid/deleted tokens are removed instead of being exposed as broken text.
 * The optional resolver lets callers use their verified custom-emoji fallback
 * for a known slot when the guild database has not been auto-synced yet.
 *
 * @param {string} guildId
 * @param {string} productName
 * @param {(slot: string) => string} [fallbackResolver]
 * @returns {string}
 */
export function formatProductDisplayName(guildId, productName, fallbackResolver = null) {
  const raw = String(productName ?? '').trim();
  if (!raw) return '';

  const resolveToken = (token) => {
    const parsed = parseDiscordEmoji(token);
    const legacyName = token.match(/^:([a-zA-Z0-9_]+):$/)?.[1];
    const lookupName = (parsed?.name || legacyName || '').toLowerCase();
    const slot = Object.entries(SLOT_ALIASES).find(([slotName, aliases]) => (
      slotName.toLowerCase() === lookupName
      || aliases.some((alias) => alias.toLowerCase() === lookupName)
    ))?.[0];
    return resolveProductEmoji(guildId, token)
      || (slot && typeof fallbackResolver === 'function' ? fallbackResolver(slot) : '')
      || '';
  };

  return raw
    .replace(/<a?:[a-zA-Z0-9_]+:\d+>|:[a-zA-Z0-9_]+:/g, resolveToken)
    .replace(/\s+/g, ' ')
    .trim();
}



/**
 * Tìm custom emoji trong guild theo tên (partial match)
 * @param {import('discord.js').Guild} guild
 * @param {string} query
 * @returns {Array<{name, id, animated, formatted}>}
 */
export function searchGuildEmojis(guild, query = '') {
  const q = query.toLowerCase();
  return guild.emojis.cache
    .filter(e => !q || e.name.toLowerCase().includes(q))
    .map(e => ({
      name: e.name,
      id: e.id,
      animated: e.animated,
      formatted: e.animated ? `<a:${e.name}:${e.id}>` : `<:${e.name}:${e.id}>`,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 25);
}

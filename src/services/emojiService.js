/**
 * ╔══════════════════════════════════════════════════════╗
 * ║           Cream Store — Emoji Service                ║
 * ║  Cho phép admin cấu hình custom emoji Discord cho    ║
 * ║  từng "slot" giao diện của bot                       ║
 * ╚══════════════════════════════════════════════════════╝
 */

import { db, nowIso } from '../database/db.js';
import { CORE_UI_EMOJI_SLOTS } from '../config/coreEmojiPack2026.js';

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

// Semantic aliases replace historical UI artwork without depending on an
// emoji snowflake from an old deployment. Product brand logos remain brands.
export const LEGACY_EMOJI_SLOTS = Object.freeze({
  cenar_verified: 'status_check', cenar_support: 'panel_support',
  cenar_staff: 'ticket_staff', cenar_admin: 'admin_order_center',
  cenar_wallet: 'icon_wallet', cenar_partner: 'panel_partnership',
  cenar_partner_ok: 'status_check', cenar_ctv: 'ctv_crystal',
  cenar_cooldown: 'status_loading', cenar_announce: 'icon_announce', cenar_price: 'icon_price',
  cr_shop: 'icon_store', shop: 'icon_store', verifybadge: 'verify_shield',
  cr_muahang: 'panel_order', muahang: 'panel_order', cr_carttt: 'icon_cart',
  cr_pay: 'payment_money', cr_cardd: 'payment_payos', cr_vcb: 'payment_vietqr',
  cr_tim: 'icon_heart', cr_green: 'icon_green', chamxanh: 'icon_green',
  cr_voucher: 'icon_ticket', muiten: 'icon_next', '69_arrow': 'icon_next', arrow2: 'icon_next',
  money: 'payment_money', tsm_fire: 'icon_fire', purple_heart_glow: 'icon_heart_purple',
  tickgreen: 'status_check', tick_red51: 'status_cross', dotyellow: 'status_warn',
  redload: 'status_loading', starxoay: 'icon_sparkle', diamond: 'icon_gem',
  gold: 'icon_gold', sliver: 'icon_silver', bronze: 'icon_bronze',
  gift: 'icon_gift', user: 'ticket_user', time: 'icon_clock', crown: 'icon_crown', warn: 'status_warn',
  cenar_sale_gift: 'icon_gift', cenar_34562snoopypencil: 'icon_edit',
  chatgopete: 'brand_chatgpt', cr_chatgpt: 'brand_chatgpt',
  cr_adobe: 'brand_adobe', discord_nitro: 'brand_nitro',
});

function normalizedEmojiName(value) {
  return String(value || '').trim().toLowerCase();
}

export function getCanonicalEmojiSlot(value) {
  const name = normalizedEmojiName(value);
  if (EMOJI_SLOTS[name]) return name;
  if (LEGACY_EMOJI_SLOTS[name]) return LEGACY_EMOJI_SLOTS[name];
  const unprefixed = name.replace(/^cenar_/, '');
  if (EMOJI_SLOTS[unprefixed]) return unprefixed;
  if (LEGACY_EMOJI_SLOTS[unprefixed]) return LEGACY_EMOJI_SLOTS[unprefixed];
  return Object.entries(SLOT_ALIASES).find(([slot, aliases]) => (
    slot === name || aliases.some((alias) => [name, unprefixed].includes(normalizedEmojiName(alias)))
  ))?.[0] || null;
}

function emojiSources(guildId, client, allowAnyGuild = false) {
  const sources = [];
  const guild = guildId ? client?.guilds?.cache?.get?.(String(guildId)) : null;
  if (guild?.emojis?.cache) sources.push(guild.emojis.cache);
  if (allowAnyGuild && !guildId) {
    for (const knownGuild of client?.guilds?.cache?.values?.() || []) {
      if (knownGuild.emojis?.cache) sources.push(knownGuild.emojis.cache);
    }
  }
  if (client?.application?.emojis?.cache) sources.push(client.application.emojis.cache);
  return sources;
}

function asLiveMention(emoji) {
  if (!emoji || emoji.available === false || !/^\d{15,22}$/.test(String(emoji.id || ''))
    || !/^[a-zA-Z0-9_]{1,32}$/.test(String(emoji.name || ''))) return '';
  return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
}

/** Only current target-guild or application inventory can verify a mention. */
export function resolveVerifiedCustomEmoji(guildId, value, {
  client = global.discordClient, allowAnyGuild = false,
} = {}) {
  const sources = emojiSources(guildId, client, allowAnyGuild);
  const raw = typeof value === 'string' ? value.trim() : '';
  const parsed = parseDiscordEmoji(raw);
  const id = parsed?.id || (typeof value === 'object' && value ? String(value.id || '') : /^\d{15,22}$/.test(raw) ? raw : '');
  if (id) {
    for (const source of sources) {
      const resolved = asLiveMention(source.get?.(id));
      if (resolved) return resolved;
    }
    return '';
  }
  const name = raw.match(/^:([a-zA-Z0-9_]+):$/)?.[1] || raw;
  if (!/^[a-zA-Z0-9_]{1,32}$/.test(name)) return '';
  for (const source of sources) {
    for (const emoji of source.values?.() || []) {
      if (normalizedEmojiName(emoji.name) === normalizedEmojiName(name)) {
        const resolved = asLiveMention(emoji);
        if (resolved) return resolved;
      }
    }
  }
  return '';
}

function clientForGuild(guild) {
  const client = guild.client || global.discordClient;
  if (client?.guilds?.cache?.has?.(guild.id)) return client;
  return { guilds: { cache: new Map([[guild.id, guild]]) }, application: client?.application };
}

function slotNameCandidates(slot) {
  const names = [slot, ...(SLOT_ALIASES[slot] || []),
    ...Object.keys(LEGACY_EMOJI_SLOTS).filter((name) => LEGACY_EMOJI_SLOTS[name] === slot)];
  return [...new Set(names.flatMap((name) => [name, name.startsWith('cenar_') ? name : `cenar_${name}`]))];
}

function verifiedSlot(guildId, slot, configured, client = global.discordClient) {
  const refreshed = resolveVerifiedCustomEmoji(guildId, CORE_UI_EMOJI_SLOTS[slot], { client });
  if (refreshed) return refreshed;
  const current = resolveVerifiedCustomEmoji(guildId, configured, { client });
  if (current) return current;
  for (const name of slotNameCandidates(slot)) {
    const resolved = resolveVerifiedCustomEmoji(guildId, name, { client });
    if (resolved) return resolved;
  }
  return '';
}

function saveEmojiMap(guildId, mapping) {
  const values = { custom_emojis: JSON.stringify(mapping), now: nowIso(), guild_id: guildId };
  const result = db.prepare(`UPDATE guild_settings SET custom_emojis = @custom_emojis,
    updated_at = @now WHERE guild_id = @guild_id`).run(values);
  if (!result.changes) {
    db.prepare(`INSERT INTO guild_settings (guild_id, custom_emojis, updated_at, ticket_category_id, order_log_channel_id, feedback_channel_id)
      VALUES (@guild_id, @custom_emojis, @now, '', '', '')`).run(values);
  }
  refreshCache(guildId);
}

/** Batch bind newly uploaded, verified artwork without modifying commerce. */
export function applyVerifiedEmojiMappings(guild, mappings) {
  if (!guild?.id) throw new Error('EMOJI_GUILD_REQUIRED');
  const current = loadFromDb(guild.id);
  const client = clientForGuild(guild);
  const verified = {};
  for (const [key, candidate] of Object.entries(mappings || {})) {
    const slot = getCanonicalEmojiSlot(key);
    if (!slot || !EMOJI_SLOTS[slot]) throw new Error(`UNKNOWN_EMOJI_SLOT:${key}`);
    const value = resolveVerifiedCustomEmoji(guild.id, candidate, { client });
    if (!value) throw new Error(`EMOJI_NOT_VERIFIED:${slot}`);
    verified[slot] = value;
  }
  const updatedSlots = Object.keys(verified).filter((slot) => current[slot] !== verified[slot]);
  if (updatedSlots.length) saveEmojiMap(guild.id, { ...current, ...verified });
  return { syncedCount: updatedSlots.length, updatedSlots };
}

/**
 * Tự động đồng bộ các emoji từ server Discord vào các slot cấu hình
 * @param {import('discord.js').Guild} guild
 * @returns {{ syncedCount: number, updatedSlots: string[] }}
 */
export function autoSyncGuildEmojis(guild, { pruneStale = false } = {}) {
  if (!guild) return { syncedCount: 0, updatedSlots: [] };

  const current = loadFromDb(guild.id);
  const client = clientForGuild(guild);
  const updatedSlots = [];
  const removedSlots = [];
  for (const slot of Object.keys(EMOJI_SLOTS)) {
    const live = verifiedSlot(guild.id, slot, current[slot], client);
    if (live && live !== current[slot]) {
      current[slot] = live;
      updatedSlots.push(slot);
    } else if (!live && current[slot] && pruneStale) {
      delete current[slot];
      removedSlots.push(slot);
    }
  }
  // Pruning requires a successful inventory fetch. A temporary Discord fetch
  // failure must not erase an admin's mapping.
  if (updatedSlots.length || removedSlots.length) saveEmojiMap(guild.id, current);
  return { syncedCount: updatedSlots.length, updatedSlots, removedSlots };
}

// ═══════════════════════════════════════════════
// Cache theo guildId
// ═══════════════════════════════════════════════
const emojiCache = new Map(); // guildId → { slot → emojiString }

function loadFromDb(guildId) {
  try {
    const row = db.prepare(`SELECT custom_emojis FROM guild_settings WHERE guild_id = ?`).get(guildId);
    if (row?.custom_emojis) {
      const parsed = JSON.parse(row.custom_emojis);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
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
  const canonical = getCanonicalEmojiSlot(slot);
  if (!canonical) return resolveVerifiedCustomEmoji(guildId, slot);
  return verifiedSlot(guildId, canonical, emojiCache.get(guildId)?.[canonical] || '');
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
    result[slot] = verifiedSlot(guildId, slot, custom[slot] || '');
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
    const verified = resolveVerifiedCustomEmoji(guildId, emojiString);
    if (!verified) throw new Error('Emoji không tồn tại trong bộ emoji hiện tại của server hoặc bot.');
    current[slot] = verified;
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
  if (typeof str !== 'string') return null;
  const match = str.trim().match(/^<(a?):([a-zA-Z0-9_]{1,32}):(\d{15,22})>$/);
  if (!match) return null;
  return {
    animated: match[1] === 'a',
    name: match[2],
    id: match[3],
    formatted: str.trim(),
  };
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
    const parsed = parseDiscordEmoji(resolveLiveCustomEmoji(emojiStr, guildId)
      || resolveLiveCustomEmoji(fallback, guildId));
    return parsed ? { id: parsed.id, name: parsed.name, animated: parsed.animated } : null;
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
  return resolveLiveCustomEmoji(emojiStr, guildId);
}

/** Prefer a current semantic binding, then an actually live old/renamed ID. */
export function resolveLiveCustomEmoji(candidate, guildId) {
  if (!candidate) return '';
  const raw = typeof candidate === 'string' ? candidate.trim() : '';
  const parsed = parseDiscordEmoji(raw);
  const name = parsed?.name || (typeof candidate === 'object' ? candidate.name : raw.match(/^:([a-zA-Z0-9_]+):$/)?.[1] || raw);
  const slot = getCanonicalEmojiSlot(name);
  if (slot) {
    const contexts = guildId ? [guildId] : [...(global.discordClient?.guilds?.cache?.keys?.() || [])];
    for (const context of contexts) {
      const current = getEmoji(context, slot);
      if (current) return current;
    }
  }
  const direct = resolveVerifiedCustomEmoji(guildId, candidate, { allowAnyGuild: !guildId });
  if (direct) return direct;
  // A deleted catalog token may have been renamed by the old normalizer while
  // retaining a recognizable name. Name recovery also requires live inventory.
  if (typeof name === 'string' && !parsed && !name.startsWith('cenar_')) {
    return resolveVerifiedCustomEmoji(guildId, `cenar_${name}`, { allowAnyGuild: !guildId });
  }
  return '';
}

export function sanitizeCustomEmojiText(guildId, text, { legacySlots = {} } = {}) {
  const replaceTokens = (part) => part.replace(/<a?:[a-zA-Z0-9_]+:\d+>|:[a-zA-Z0-9_]+:/g, (token) => {
    const parsed = parseDiscordEmoji(token);
    const name = parsed?.name || token.match(/^:([a-zA-Z0-9_]+):$/)?.[1];
    const explicitSlot = legacySlots[parsed?.id] || legacySlots[name] || legacySlots[normalizedEmojiName(name)];
    if (!token.startsWith('<') && !explicitSlot && !getCanonicalEmojiSlot(name)) return token;
    return explicitSlot ? getEmoji(guildId, explicitSlot) : resolveLiveCustomEmoji(token, guildId);
  });
  // Delivered credentials, examples, timestamps and links are literal data.
  // Only presentation outside protected spans is normalized; unknown colon
  // sequences (20:30:15, IPv6 or a password) are not assumed to be emoji.
  return String(text ?? '').split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`|\|\|[\s\S]*?(?:\|\||$)|https?:\/\/[^\s<>]+)/g)
    .map((part) => /^(?:`|\|\||https?:\/\/)/.test(part) ? part : replaceTokens(part)).join('');
}

export function resolveEmojiText(text, guildId) {
  return sanitizeCustomEmojiText(guildId, text);
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
      || (slot && typeof fallbackResolver === 'function' ? resolveLiveCustomEmoji(fallbackResolver(slot), guildId) : '')
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

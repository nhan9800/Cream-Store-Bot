import { GEMINI_PRO_CDK_KEY, GEMINI_PRO_CDK_WARRANTY } from '../config/geminiProCdk202611.js';
// Data-only publication manifest. Never import database/db.js here: importing
// that module opens SQLite. These public prices contain no customer data.
// SALE means the owner supplied this campaign price, not an inferred discount.
// Source: original sale board at 3f7bb80 plus catalog at 755910a (2026-10-02).
export const PROMOTION_CATALOG_VERSION = 'CENAR-PROMOTION-CATALOG-20261106';

export const PROMOTION_CATALOG_SECTIONS = Object.freeze([
  { key: 'connection', title: 'Kết nối có gu', subtitle: 'Nitro, nâng cấp máy chủ và gói xem phim.' },
  { key: 'ai_own', title: 'AI trên tài khoản của bạn', subtitle: 'Phân biệt chính chủ, cấp acc và tham gia Team/Workspace.' },
  { key: 'ai_supplied', title: 'AI & công cụ nâng cấp', subtitle: 'Bảo hành và hình thức nhận được ghi riêng từng gói.' },
  { key: 'creation', title: 'Sáng tạo & lưu trữ', subtitle: 'Adobe, Gemini, Office và CapCut theo từng thời hạn.' },
  { key: 'entertainment', title: 'Khoảng nghỉ của riêng bạn', subtitle: 'Spotify, YouTube và Locket.' },
  { key: 'decor_account', title: 'Trang trí hồ sơ Discord', subtitle: 'Giá niêm yết cho tài khoản có Nitro hoặc chưa có Nitro.' },
  { key: 'decor_gift', title: 'Gift & Combo Discord', subtitle: 'Giá niêm yết cho từng mức Gift và Combo.' },
  { key: 'services', title: 'Chơi mượt & xây store', subtitle: 'GearUP, setup Discord, bot custom và website.' },
].map((section) => Object.freeze(section)));

export const PROMOTION_PRICE_SOURCE_LABELS = Object.freeze({
  SALE: 'Giá chương trình do shop niêm yết',
  CATALOG: 'Giá niêm yết hiện hành',
});

export const PROMOTION_CATALOG_NOTES = Object.freeze([
  'Mở ticket để shop xác nhận đúng gói và giá chương trình trước khi thanh toán. Khi mua trên website, kiểm tra giá hiển thị tại bước đặt hàng.',
  'Những dòng ghi giá niêm yết hiện hành chưa có giá khuyến mãi riêng; không suy diễn phần trăm giảm hoặc giá gốc.',
  'KBH là không bảo hành; BHF/FBH là bảo hành full theo thời hạn ghi trên gói. BH gói không bao gồm BH tài khoản.',
  'Pro 100/200/500 là tên gói shop niêm yết, không phải cam kết hạn mức sử dụng hoặc số lượng tài khoản.',
]);

const formatPrice = (price) => `${new Intl.NumberFormat('vi-VN').format(price)}đ`;

function row(section, source, key, label, price, metadata = {}) {
  const duration = metadata.duration || '';
  const account = metadata.account || '';
  const warranty = metadata.warranty || '';
  const priceUnit = metadata.priceUnit || 'gói';
  const formattedPrice = formatPrice(price);
  const displayPrice = priceUnit === 'slot' ? `${formattedPrice}/slot`
    : priceUnit === 'ngày đầu' ? `${formattedPrice}/ngày đầu`
      : priceUnit === 'khởi điểm' ? `từ ${formattedPrice}` : formattedPrice;
  const terms = [duration, account, warranty].filter(Boolean).join(' · ');
  const notes = Object.freeze([...(metadata.notes || [])]);
  return Object.freeze({
    section,
    source,
    key,
    catalogKey: metadata.catalogKey || null,
    label,
    price,
    formattedPrice,
    priceUnit,
    duration,
    account,
    warranty,
    notes,
    requiresShopConfirmation: source === 'SALE' || metadata.requiresShopConfirmation === true,
    presentation: `${label}${terms ? ` · ${terms}` : ''}`,
    formattedPresentation: `${label}${terms ? ` · ${terms}` : ''} — ${displayPrice}`,
    ...Object.fromEntries(Object.entries(metadata).filter(([name]) => ![
      'duration', 'account', 'warranty', 'priceUnit', 'notes', 'catalogKey', 'requiresShopConfirmation',
    ].includes(name))),
  });
}

const sale = (section, key, label, price, metadata) => row(section, 'SALE', key, label, price, metadata);
const catalog = (section, key, label, price, metadata = {}) => row(section, 'CATALOG', key, label, price, { ...metadata, catalogKey: key });

const unknownWarranty = 'Xác nhận phạm vi bảo hành với shop trước khi mua';

export const PROMOTION_CATALOG_ROWS = Object.freeze([
  // 01: Only the active Nitro terms.
  catalog('connection', 'discord-nitro-boost-trial-3-months-first-offer', 'Nitro Boost Trial', 65000, { duration: '3 tháng', notes: ['Tài khoản được tạo trên 1 tháng và chưa từng sử dụng Nitro.'] }),
  catalog('connection', 'discord-nitro-boost-1-thang-login', 'Nitro Boost Login', 90000, { duration: '1 tháng' }),
  catalog('connection', 'discord-nitro-boost-2-months-login-keep-mail-7-days', 'Nitro Boost Login · Giữ mail 7 ngày', 115000, { duration: '2 tháng' }),
  catalog('connection', 'discord-nitro-boost-2-months-login-mail-guaranteed', 'Nitro Boost Login · Mail bao sống', 140000, { duration: '2 tháng' }),
  catalog('connection', 'discord-nitro-boost-1-nam-login', 'Nitro Boost Login · Chính chủ', 850000, { duration: '12 tháng', notes: ['Kích hoạt trọn 12 tháng một lần, không gia hạn tự động.', 'Có hàng liền; dòng ổn định được shop tiếp tục duy trì.'] }),
  sale('connection', 'sale-server-boost-3-months', 'Boost Server · Nâng cấp máy chủ', 280000, {
    catalogKey: 'discord-server-boost-14-3-months', duration: '3 tháng',
    notes: ['Shop xác nhận số lượng Boosts và máy chủ áp dụng tại ticket.'],
  }),
  sale('connection', 'sale-netflix-premium-4k-private-1-month', 'Netflix Premium · 4K Private', 75000, {
    catalogKey: 'netflix-extra-1-month-renewable', duration: '1 tháng',
    notes: ['Xác nhận đúng hình thức 4K Private và tài khoản được nhận tại ticket trước khi thanh toán.'],
  }),
  catalog('ai_own', 'chatgpt-plus-direct-payment-1-month-full-warranty', 'ChatGPT Plus chính chủ', 530000, { duration: '1 tháng', warranty: 'Full BH 1 tháng' }),
  catalog('ai_own', 'chatgpt-pro-100-own-account-1-month-package-warranty', 'ChatGPT Pro 100 chính chủ', 2650000, { duration: '1 tháng', warranty: 'BH gói · không BH tài khoản' }),
  catalog('ai_own', 'chatgpt-pro-200-own-account-1-month', 'ChatGPT Pro 200 chính chủ', 4500000, { duration: '1 tháng', warranty: unknownWarranty }),
  catalog('ai_own', 'chatgpt-pro-500-own-account-1-month', 'ChatGPT Pro 500 chính chủ', 12800000, { duration: '1 tháng', warranty: unknownWarranty }),
  catalog('ai_own', 'claude-pro-1-month', 'Claude Pro chính chủ', 550000, { duration: '1 tháng', warranty: 'BH 1 tháng · trừ khóa tài khoản' }),

  // 04: Creation tools.
  catalog('creation', 'adobe-creative-cloud-1-month', 'Adobe Creative Cloud · Không AI credits', 140000, {
    duration: '1 tháng', account: 'Shop cấp tài khoản', warranty: 'Full BH 1 tháng',
  }),
  catalog('creation', 'adobe-creative-cloud-1-month-1000-ai-credits', 'Adobe Creative Cloud · 1.000 AI credits', 170000, {
    duration: '1 tháng', account: 'Shop cấp tài khoản', warranty: 'Full BH 1 tháng',
  }),
  catalog('creation', 'adobe-creative-cloud-12-months-no-ai-credits', 'Adobe Creative Cloud · Không AI credits', 950000, {
    duration: '1 năm', account: 'Shop cấp tài khoản', warranty: 'Full BH 12 tháng',
  }),
  catalog('creation', 'adobe-creative-cloud-4-months-4000-ai-credits', 'Adobe Creative Cloud · 4.000 AI credits/tháng', 1400000, {
    duration: '4 tháng', account: 'Shop cấp tài khoản', warranty: 'Full BH 4 tháng', notes: ['4.000 credits reset mỗi tháng.'],
  }),
  catalog('creation', 'adobe-creative-cloud-12-months-4000-ai-credits', 'Adobe Creative Cloud · 4.000 AI credits/tháng', 3800000, {
    duration: '1 năm', account: 'Shop cấp tài khoản', warranty: 'Full BH 12 tháng', notes: ['4.000 credits reset mỗi tháng.'],
  }),
  catalog('creation', GEMINI_PRO_CDK_KEY, 'Gemini Pro · CDK', 190000, {
    duration: '6 tháng', account: 'Tài khoản chính chủ · Kích hoạt CDK', warranty: GEMINI_PRO_CDK_WARRANTY,
    notes: ['Đóng hồ sơ Google Payments tại https://payments.google.com/ và rời Google Family trước kích hoạt. Lỗi CDK liên hệ Admin; không bảo hành sau kích hoạt thành công. YouTube Premium Lite có thể có hoặc không, vẫn có thể có quảng cáo.'],
  }),
  sale('creation', 'sale-gemini-pro-google-one-5tb-12-months', 'Gemini Pro + Google One 5 TB', 120000, {
    catalogKey: 'gemini-pro-google-one-5tb-12-months-full-warranty', duration: '12 tháng', notes: ['Có thể thêm 5 thành viên. Shop xác nhận điều kiện gói và bảo hành trước khi mua.'],
  }),
  catalog('creation', 'gemini-pro-antigravity-24-months', 'Gemini Pro Antigravity', 250000, {
    duration: '24 tháng', warranty: 'BH 12 tháng',
    notes: ['Shop xác nhận hỗ trợ Gemini 4 Argon, Claude Opus 5.5 và Claude Sonnet 5.5.'],
  }),
  sale('creation', 'sale-office-365-onedrive-12-months', 'Office 365 + OneDrive 1 TB', 200000, {
    catalogKey: 'office-365-onedrive-12-months', duration: '12 tháng',
  }),
  sale('creation', 'sale-capcut-pro-1-month', 'CapCut Pro', 55000, {
    catalogKey: 'capcut-pro-1-thang-2-thiet-bi-cap-acc', duration: '1 tháng',
    notes: ['Shop xác nhận số thiết bị và hình thức tài khoản tại ticket.'],
  }),
  sale('creation', 'sale-capcut-pro-6-months', 'CapCut Pro', 290000, {
    duration: '6 tháng', notes: ['Đặt qua ticket.'],
  }),
  catalog('creation', 'capcut-pro-7-ngay-2-thiet-bi-cap-acc', 'CapCut Pro · 2 thiết bị', 20000, {
    duration: '7 ngày', account: 'Shop cấp tài khoản',
  }),
  catalog('creation', 'capcut-pro-12-thang-3-thiet-bi-chinh-chu', 'CapCut Pro · 3 thiết bị', 1250000, {
    duration: '12 tháng', account: 'Chính chủ',
  }),

  // 05: Retain every original entertainment campaign price.
  sale('entertainment', 'sale-spotify-premium-6-months', 'Spotify Premium', 180000, {
    catalogKey: 'spotify-premium-6-months', duration: '6 tháng',
  }),
  sale('entertainment', 'sale-spotify-premium-12-months', 'Spotify Premium', 280000, {
    catalogKey: 'spotify-premium-12-months', duration: '12 tháng',
  }),
  catalog('entertainment', 'youtube-premium-continuous-6-months', 'YouTube Premium · Ổn định', 250000, { duration: '6 tháng' }),
  catalog('entertainment', 'youtube-premium-continuous-12-months', 'YouTube Premium · Ổn định', 400000, { duration: '12 tháng' }),
  catalog('entertainment', 'locket-gold-1-nam', 'Locket Gold', 80000, {
    duration: '1 năm', account: 'Kích hoạt theo username',
  }),

  // 06-07: Expand every Decor SKU rather than implying an unknown price range.
  ...[25, 35, 50, 60, 70, 79, 88].map((amount) => catalog(
    'decor_account', `decor-discord-acc-co-nitro-goi-${amount}k`, `Decor Discord · Gói ${amount}k`, amount * 1000,
    { duration: 'Vĩnh viễn', account: 'Tài khoản có Nitro' },
  )),
  ...[35, 60, 80, 90, 95, 110].map((amount) => catalog(
    'decor_account', `decor-discord-acc-khong-nitro-goi-${amount}k`, `Decor Discord · Gói ${amount}k`, amount * 1000,
    { duration: 'Vĩnh viễn', account: 'Tài khoản chưa có Nitro' },
  )),
  ...[50, 58, 70, 85, 95, 110].map((amount) => catalog(
    'decor_gift', `decor-discord-dang-gift-goi-${amount}k`, `Decor Discord Gift · Gói ${amount}k`, amount * 1000,
    { duration: 'Vĩnh viễn', account: 'Gift · Bấm nhận' },
  )),
  ...[90, 110, 150, 180].map((amount) => catalog(
    'decor_gift', `decor-discord-combo-gift-goi-${amount}k`, `Decor Discord Combo Gift · Gói ${amount}k`, amount * 1000,
    { duration: 'Vĩnh viễn', account: 'Combo Gift · Bấm nhận' },
  )),

  // 08: Current prices, never an invented sale for these services.
  catalog('services', 'gearup-booster-3-thang', 'GearUP Booster', 180000, { duration: '3 tháng' }),
  catalog('services', 'gearup-booster-6-thang', 'GearUP Booster', 380000, { duration: '6 tháng' }),
  catalog('services', 'gearup-booster-12-thang-1-nam', 'GearUP Booster', 460000, { duration: '12 tháng' }),
  catalog('services', 'discord-store-launch-hosting-3-months', 'Setup Discord Store + Bot Custom', 500000, {
    duration: 'Trọn gói', notes: ['Tặng hosting bot 3 tháng đầu.'],
  }),
  catalog('services', 'discord-store-automation-pro', 'Bot Booking / Bảng Giá / Store Custom', 750000, {
    duration: 'Trọn gói', notes: ['Tặng hosting 3 tháng cho dự án triển khai mới.'],
  }),
  catalog('services', 'discord-store-fullstack-website', 'Discord Store + Bot Custom + Website Đồng Bộ', 1000000, {
    duration: 'Trọn gói', notes: ['Tặng hosting bot 3 tháng đầu.'],
  }),
  catalog('services', 'discord-bot-rescue-ui', 'Fix Bot Lỗi & Nâng Cấp Giao Diện', 500000, {
    duration: 'Theo phạm vi công việc', priceUnit: 'khởi điểm', notes: ['Từ 500.000đ; giá cuối theo tình trạng mã nguồn.'],
  }),
]);

export function getPromotionCatalogRows() {
  return PROMOTION_CATALOG_ROWS;
}

export function getPromotionCatalogGroups(rows = PROMOTION_CATALOG_ROWS) {
  return PROMOTION_CATALOG_SECTIONS.map((section) => ({
    ...section,
    rows: rows.filter((item) => item.section === section.key),
  }));
}

// Data-only publication manifest. Never import database/db.js here: importing
// that module opens SQLite. These public prices contain no customer data.
// SALE means the owner supplied this campaign price, not an inferred discount.
// Source: original sale board at 3f7bb80 plus catalog at 755910a (2026-10-02).
export const PROMOTION_CATALOG_VERSION = 'CENAR-PROMOTION-CATALOG-20261002-COMPLETE';

export const PROMOTION_CATALOG_SECTIONS = Object.freeze([
  { key: 'connection', title: 'Kết nối có gu', subtitle: 'Nitro, nâng cấp máy chủ và gói xem phim.' },
  { key: 'ai_own', title: 'AI trên tài khoản của bạn', subtitle: 'Phân biệt chính chủ, cấp acc và tham gia Team/Workspace.' },
  { key: 'ai_supplied', title: 'AI cấp acc & gói JSON', subtitle: 'Bảo hành và hình thức nhận được ghi riêng từng gói.' },
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
  'Pro 100/200/500 và x5 là tên gói shop niêm yết, không phải cam kết hạn mức sử dụng hoặc số lượng tài khoản.',
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

const suppliedRisk = 'Thời gian dùng thực tế có thể dài hơn tùy cách sử dụng; không cam kết tài khoản duy trì đủ tháng hoặc vượt thời hạn bảo hành.';
const unknownWarranty = 'Xác nhận phạm vi bảo hành với shop trước khi mua';
const jsonDuration = 'Xác nhận thời hạn với shop';

export const PROMOTION_CATALOG_ROWS = Object.freeze([
  // 01: Nine original Nitro campaign tiers, two Boost tiers and Netflix.
  sale('connection', 'sale-nitro-boost-login-1-month', 'Nitro Boost Login', 85000, {
    catalogKey: 'discord-nitro-boost-1-thang-login', duration: '1 tháng', account: 'Login',
  }),
  sale('connection', 'sale-nitro-boost-login-2-months', 'Nitro Boost Login · Có liền', 99000, {
    catalogKey: 'discord-nitro-boost-2-months-login-keep-mail-7-days', duration: '2 tháng', account: 'Login',
    notes: ['Shop xác nhận đúng loại tài khoản và điều kiện giữ mail tại ticket trước khi thanh toán.'],
  }),
  sale('connection', 'sale-nitro-boost-login-2-months-mail', 'Nitro Boost Login · Có liền · Mail bất tử', 120000, {
    catalogKey: 'discord-nitro-boost-2-months-login-mail-guaranteed', duration: '2 tháng', account: 'Login',
    notes: ['Shop xác nhận điều kiện bảo đảm mail thực tế trước khi thanh toán.'],
  }),
  sale('connection', 'sale-nitro-boost-login-4-months', 'Nitro Boost Login · Có liền', 250000, {
    catalogKey: 'discord-nitro-boost-4-thang-login', duration: '4 tháng', account: 'Login',
  }),
  sale('connection', 'sale-nitro-boost-login-6-months', 'Nitro Boost Login · Có liền', 350000, {
    catalogKey: 'discord-nitro-boost-6-thang-login', duration: '6 tháng', account: 'Login',
  }),
  sale('connection', 'sale-nitro-boost-login-8-months', 'Nitro Boost Login · Có liền', 450000, {
    catalogKey: 'discord-nitro-boost-8-thang-login', duration: '8 tháng', account: 'Login',
  }),
  sale('connection', 'sale-nitro-boost-login-12-months-auto', 'Nitro Boost Login · Có liền · Gia hạn auto', 680000, {
    catalogKey: 'discord-nitro-boost-12-thang-login', duration: '12 tháng', account: 'Login',
  }),
  sale('connection', 'sale-nitro-boost-login-1-year-direct', 'Nitro Boost Login · Mua thẳng 1 năm · Có liền', 830000, {
    catalogKey: 'discord-nitro-boost-1-nam-login', duration: '1 năm', account: 'Login',
  }),
  sale('connection', 'sale-nitro-trial-3-months', 'Trial Boost', 65000, {
    catalogKey: 'discord-nitro-boost-trial-3-months-first-offer', duration: '3 tháng',
    notes: ['Shop kiểm tra tài khoản có đủ điều kiện Trial trước khi chốt đơn.'],
  }),
  sale('connection', 'sale-server-boost-1-month', 'Boost Server · Nâng cấp máy chủ', 110000, {
    catalogKey: 'discord-server-boost-14-1-month', duration: '1 tháng',
    notes: ['Shop xác nhận số lượng Boosts và máy chủ áp dụng tại ticket.'],
  }),
  sale('connection', 'sale-server-boost-3-months', 'Boost Server · Nâng cấp máy chủ', 280000, {
    catalogKey: 'discord-server-boost-14-3-months', duration: '3 tháng',
    notes: ['Shop xác nhận số lượng Boosts và máy chủ áp dụng tại ticket.'],
  }),
  sale('connection', 'sale-netflix-premium-4k-private-1-month', 'Netflix Premium · 4K Private', 75000, {
    catalogKey: 'netflix-extra-1-month-renewable', duration: '1 tháng',
    notes: ['Xác nhận đúng hình thức 4K Private và tài khoản được nhận tại ticket trước khi thanh toán.'],
  }),
  catalog('connection', 'gia-han-discord-nitro-boost-2-thang', 'Gia hạn Nitro Boost · Khách hàng cũ', 99000, {
    duration: '2 tháng', account: 'Login',
  }),

  // 02: Five new own-account AI tiers, three other live GPT tiers and old Team.
  sale('ai_own', 'sale-chatgpt-plus-own-account-package-warranty', 'ChatGPT Plus chính chủ', 485000, {
    catalogKey: 'chatgpt-plus-own-account-1-month-package-warranty', duration: '1 tháng', account: 'Chính chủ',
    warranty: 'BH gói 1 tháng · Không BH acc',
  }),
  sale('ai_own', 'sale-chatgpt-plus-own-account-full-warranty', 'ChatGPT Plus chính chủ', 500000, {
    catalogKey: 'chatgpt-plus-direct-payment-1-month-full-warranty', duration: '1 tháng', account: 'Chính chủ', warranty: 'Full BH 1 tháng',
  }),
  sale('ai_own', 'sale-chatgpt-pro-100-own-account', 'ChatGPT Pro 100 chính chủ', 2650000, {
    catalogKey: 'chatgpt-pro-100-own-account-1-month-package-warranty', duration: '1 tháng', account: 'Chính chủ',
    warranty: 'BH gói 1 tháng · Không BH acc',
  }),
  sale('ai_own', 'sale-chatgpt-pro-200-own-account', 'ChatGPT Pro 200 chính chủ', 4800000, {
    catalogKey: 'chatgpt-pro-200-own-account-1-month', duration: '1 tháng', account: 'Chính chủ', warranty: unknownWarranty,
  }),
  sale('ai_own', 'sale-chatgpt-pro-500-own-account', 'ChatGPT Pro 500 chính chủ', 12700000, {
    catalogKey: 'chatgpt-pro-500-own-account-1-month', duration: '1 tháng', account: 'Chính chủ', warranty: unknownWarranty,
  }),
  catalog('ai_own', 'chatgpt-plus-account-1-month-no-warranty', 'ChatGPT Plus', 180000, {
    duration: '1 tháng danh nghĩa', account: 'Shop cấp tài khoản', warranty: 'KBH', notes: [suppliedRisk],
  }),
  catalog('ai_own', 'chatgpt-plus-account-1-month-full-warranty', 'ChatGPT Plus', 350000, {
    duration: '1 tháng', account: 'Shop cấp tài khoản', warranty: 'Full BH 1 tháng',
  }),
  catalog('ai_own', 'chatgpt-business-workspace-1-month-full-warranty', 'ChatGPT Business', 450000, {
    duration: '1 tháng', account: 'Chính chủ · Add Workspace', warranty: 'Full BH 1 tháng',
  }),
  sale('ai_own', 'sale-chatgpt-add-team-own-account-1-month', 'ChatGPT · Add Team chính chủ', 390000, {
    duration: '1 tháng', account: 'Chính chủ · Add Team', warranty: 'Full BH 1 tháng',
    notes: ['Shop tư vấn đúng loại Team và hình thức tham gia trước khi thanh toán.'],
  }),

  // 03: Restore the old MoMo/JSON prices alongside the new supplied AI tiers.
  sale('ai_supplied', 'sale-chatgpt-pro-100-account-no-warranty', 'ChatGPT Pro 100', 1900000, {
    catalogKey: 'chatgpt-pro-100-account-1-month-no-warranty', duration: '1 tháng danh nghĩa', account: 'Shop cấp tài khoản', warranty: 'KBH', notes: [suppliedRisk],
  }),
  sale('ai_supplied', 'sale-chatgpt-pro-100-account-full-warranty', 'ChatGPT Pro 100', 2300000, {
    catalogKey: 'chatgpt-pro-100-account-1-month-full-warranty', duration: '1 tháng', account: 'Shop cấp tài khoản', warranty: 'Full BH 1 tháng',
  }),
  sale('ai_supplied', 'sale-chatgpt-account-2-day-warranty', 'ChatGPT · Cấp acc', 120000, {
    catalogKey: 'chatgpt-account-1-month-2-day-warranty', duration: '1 tháng danh nghĩa', account: 'Shop cấp tài khoản', warranty: 'BH 2 ngày',
    notes: [suppliedRisk, 'Loại Plus/Pro chưa được xác nhận; shop xác nhận đúng gói trước khi mua.'],
  }),
  sale('ai_supplied', 'sale-chatgpt-momo-pay-1-month', 'ChatGPT · MoMo Pay', 130000, {
    duration: '1 tháng danh nghĩa', warranty: 'BH 2 ngày',
    notes: ['Giữ riêng với gói cấp acc 120k; shop xác nhận loại gói và hình thức tài khoản tại ticket.', suppliedRisk],
  }),
  sale('ai_supplied', 'sale-chatgpt-pro-5x-team-4-slots', 'ChatGPT Pro 5x · Ghép Team 4 slot', 79000, {
    duration: jsonDuration, account: 'File JSON + hướng dẫn', priceUnit: 'slot',
  }),
  sale('ai_supplied', 'sale-chatgpt-pro-5x-team-2-slots', 'ChatGPT Pro 5x · Ghép Team 2 slot', 150000, {
    duration: jsonDuration, account: 'File JSON + hướng dẫn', priceUnit: 'slot',
  }),
  sale('ai_supplied', 'sale-chatgpt-pro-5x-account-json', 'Acc ChatGPT Pro 5x', 250000, {
    duration: jsonDuration, account: 'File JSON', warranty: 'BH 60 phút',
  }),
  sale('ai_supplied', 'sale-claude-pro-x5-account-no-warranty', 'Claude Pro x5', 1900000, {
    catalogKey: 'claude-pro-x5-account-1-month-no-warranty', duration: '1 tháng danh nghĩa', account: 'Shop cấp tài khoản', warranty: 'KBH', notes: [suppliedRisk],
  }),
  sale('ai_supplied', 'sale-claude-pro-x5-account-full-warranty', 'Claude Pro x5', 2500000, {
    catalogKey: 'claude-pro-x5-account-1-month-full-warranty', duration: '1 tháng', account: 'Shop cấp tài khoản', warranty: 'Full BH 1 tháng (FBH/BHF)',
  }),
  catalog('ai_supplied', 'claude-pro-1-month', 'Claude Pro', 530000, {
    duration: '1 tháng', warranty: 'Full BH 1 tháng',
  }),
  catalog('ai_supplied', 'claude-api-100m', 'Claude API 100M', 85000, {
    duration: 'Ngày đầu', account: 'Token API', priceUnit: 'ngày đầu',
    baseDurationDays: 1, additionalDayPrice: 5000, minimumDays: 1, maximumDays: 365,
    dailyPricingNote: '85.000đ cho ngày đầu · thêm 5.000đ mỗi ngày tiếp theo',
    notes: ['Giá khởi điểm cho 1 ngày, không phải 85.000đ/tháng.'],
  }),

  // 04: Adobe is newly included at exact current catalog prices.
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
  sale('creation', 'sale-gemini-pro-google-one-5tb-12-months', 'Gemini Pro + Google One 5 TB', 120000, {
    catalogKey: 'gemini-pro-google-one-5tb-12-months-full-warranty', duration: '12 tháng', notes: ['Có thể thêm 5 thành viên. Shop xác nhận điều kiện gói và bảo hành trước khi mua.'],
  }),
  sale('creation', 'sale-gemini-pro-google-one-5tb-18-months', 'Gemini Pro + Google One 5 TB', 190000, {
    catalogKey: 'gemini-pro-google-one-5tb-18-months-full-warranty', duration: '18 tháng', notes: ['Có thể thêm 5 thành viên. Shop xác nhận điều kiện gói và bảo hành trước khi mua.'],
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
  sale('entertainment', 'sale-spotify-premium-3-months', 'Spotify Premium', 110000, {
    catalogKey: 'spotify-premium-3-months', duration: '3 tháng',
  }),
  sale('entertainment', 'sale-spotify-premium-6-months', 'Spotify Premium', 180000, {
    catalogKey: 'spotify-premium-6-months', duration: '6 tháng',
  }),
  sale('entertainment', 'sale-spotify-premium-12-months', 'Spotify Premium', 280000, {
    catalogKey: 'spotify-premium-12-months', duration: '12 tháng',
  }),
  sale('entertainment', 'sale-youtube-premium-stable-1-month', 'YouTube Premium · Ổn định', 58000, {
    catalogKey: 'youtube-premium-continuous-1-month', duration: '1 tháng',
  }),
  sale('entertainment', 'sale-youtube-premium-stable-3-months', 'YouTube Premium · Ổn định', 185000, {
    catalogKey: 'youtube-premium-continuous-3-months', duration: '3 tháng',
  }),
  sale('entertainment', 'sale-youtube-premium-stable-6-months', 'YouTube Premium · Ổn định', 295000, {
    catalogKey: 'youtube-premium-continuous-6-months', duration: '6 tháng',
  }),
  sale('entertainment', 'sale-youtube-premium-stable-12-months', 'YouTube Premium · Ổn định', 530000, {
    catalogKey: 'youtube-premium-continuous-12-months', duration: '12 tháng',
  }),
  catalog('entertainment', 'locket-gold-1-nam', 'Locket Gold', 150000, {
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

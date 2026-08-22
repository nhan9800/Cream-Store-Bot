import { config } from '../config.js';

const GROUP_COPY = Object.freeze({
  nitro: ['Discord Nitro', 'Boost, login and trial packages currently available.'],
  server_boost: ['Discord Server Boost', 'Level 2–3 upgrades with the exact duration shown for each package.'],
  decor_nitro: ['Discord Profile Decor · Nitro Accounts', 'Profile decorations for accounts that already have Nitro.'],
  decor_no_nitro: ['Discord Profile Decor · Non-Nitro Accounts', 'Packages designed for accounts without an active Nitro subscription.'],
  decor_gift: ['Discord Profile Decor · Gift & Combo', 'Delivered as a gift or combo without requesting your password.'],
  chatgpt: ['ChatGPT Plus', 'Ready-to-use and personal-account plans with clear warranty terms.'],
  gemini: ['Gemini & Google One', 'Gemini Advanced/Pro plans with the listed Google One storage.'],
  claude: ['Claude Pro & Claude API', 'Claude Pro accounts and API usage packages are listed separately.'],
  adobe: ['Adobe Creative Cloud', 'All Apps, trial duration and device limits are shown per package.'],
  creative_tools: ['CapCut Pro & Microsoft 365', 'Video, productivity and cloud storage tools.'],
  spotify: ['Spotify Premium', 'Ad-free high-quality music and offline playback for the selected duration.'],
  streaming: ['YouTube Premium & Entertainment', 'Renewal cycles and account requirements are shown for every plan.'],
  gearup: ['GearUP Booster', 'Connection optimization packages for 3–12 months.'],
  locket: ['Locket Gold', 'Long-term premium plans for Locket.'],
  services: ['Bots, Websites & Discord Setup', 'Custom projects are scoped before a final quotation is issued.'],
  other: ['Other Digital Services', 'Currently available products outside the main catalog groups.'],
});

export function translateCatalogGroup(group) {
  const copy = GROUP_COPY[group.key];
  return copy ? { ...group, title: copy[0], note: copy[1] } : group;
}

export function translateProductName(value) {
  return String(value || '')
    .replace(/<a?:[A-Za-z0-9_]+:\d+>/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/Gia\s*Hạn\s*Đều/gi, 'Continuous Renewal')
    .replace(/Gia\s*Hạn\s*1\s*Tháng\s*\/\s*Lần/gi, 'Monthly Renewal')
    .replace(/Gia\s*hạn/gi, 'Renewal')
    .replace(/Tài\s*khoản\s*có\s*Nitro/gi, 'Account with Nitro')
    .replace(/Tài\s*khoản\s*chưa\s*có\s*Nitro/gi, 'Account without Nitro')
    .replace(/Acc\s*có\s*Nitro/gi, 'Account with Nitro')
    .replace(/Acc\s*không\s*Nitro/gi, 'Account without Nitro')
    .replace(/Chính\s*chủ/gi, 'Personal Account')
    .replace(/Cấp\s*Tài\s*Khoản/gi, 'Account Included')
    .replace(/Cấp\s*Acc/gi, 'Account Included')
    .replace(/Full\s*BH/gi, 'Full Warranty')
    .replace(/Không\s*BH/gi, 'No Warranty')
    .replace(/bảo\s*hành/gi, 'Warranty')
    .replace(/Thiết\s*Bị/gi, 'Devices')
    .replace(/Dạng\s*Gift/gi, 'Gift')
    .replace(/Gói\s*(\d+)k/gi, (_, amount) => `$${(Number(amount) * 1000 / Math.max(1, config.storeVndPerUsd)).toFixed(2)} Tier`)
    .replace(/Gói/gi, 'Package')
    .replace(/Tuỳ\s*Chỉnh\s*Tính\s*Năng/gi, 'Custom Features')
    .replace(/Mọi\s*Giao\s*Diện/gi, 'Any Design')
    .replace(/Phí\s*Duy\s*Trì\s*Bot/gi, 'Bot Maintenance')
    .replace(/Dùng\s*chung/gi, 'Shared')
    .replace(/Trọn\s*gói/gi, 'Full Package')
    .replace(/(\d+)\s*tháng/gi, (_, count) => `${count} Month${count === '1' ? '' : 's'}`)
    .replace(/(\d+)\s*năm/gi, (_, count) => `${count} Year${count === '1' ? '' : 's'}`)
    .replace(/(\d+)\s*ngày/gi, (_, count) => `${count} Day${count === '1' ? '' : 's'}`)
    .replace(/\s+/g, ' ')
    .trim();
}

export function translateProductDescription(value) {
  return String(value || '')
    .replace(/<a?:[A-Za-z0-9_]+:\d+>/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng khi mua/gi, 'Please provide the account credentials and 4–5 backup codes after ordering')
    .replace(/Vui lòng gửi tài khoản, mật khẩu và 4-5 mã dự phòng/gi, 'Please provide the account credentials and 4–5 backup codes')
    .replace(/Đăng nhập gia hạn/gi, 'Login-based renewal')
    .replace(/Gia hạn 2 tháng 1 lần/gi, 'Renewed once every 2 months')
    .replace(/Dành cho khách hàng cũ đã từng mua/gi, 'Available to returning customers who previously purchased')
    .replace(/Dành cho tài khoản chưa từng sử dụng Nitro và đã tạo trên 1 tháng/gi, 'For accounts older than 1 month that have never used Nitro')
    .replace(/Nâng cấp/gi, 'Upgrade')
    .replace(/Giao hàng nhanh chóng/gi, 'Fast delivery')
    .replace(/Trang trí hồ sơ/gi, 'Profile decoration')
    .replace(/tài khoản ĐÃ CÓ Nitro/gi, 'an account with active Nitro')
    .replace(/tài khoản CHƯA CÓ Nitro/gi, 'an account without active Nitro')
    .replace(/bấm nhận ngay/gi, 'instant claim')
    .replace(/Tiết kiệm tối đa/gi, 'Best-value option')
    .replace(/bảo hành trọn gói/gi, 'full warranty coverage')
    .replace(/bảo hành toàn diện/gi, 'full warranty coverage')
    .replace(/không đi kèm chính sách bảo hành/gi, 'without warranty coverage')
    .replace(/trong (\d+) tháng/gi, (_, count) => `for ${count} month${count === '1' ? '' : 's'}`)
    .replace(/trong (\d+) ngày/gi, (_, count) => `for ${count} day${count === '1' ? '' : 's'}`)
    .replace(/(\d+) thiết bị/gi, (_, count) => `${count} device${count === '1' ? '' : 's'}`)
    .replace(/đăng ký sử dụng/gi, 'subscription')
    .replace(/hỗ trợ/gi, 'support')
    .replace(/sử dụng/gi, 'usage')
    .replace(/đầy đủ/gi, 'complete')
    .replace(/đã kích hoạt sẵn/gi, 'pre-activated')
    .replace(/được cấp sẵn/gi, 'provided ready to use')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatInternationalPrice(value, { includeSource = false } = {}) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 'Contact for quote';
  if (config.storePriceSourceCurrency === 'VND') {
    const usd = amount / Math.max(1, Number(config.storeVndPerUsd) || 1);
    const display = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(usd);
    return includeSource ? `${display} · ${new Intl.NumberFormat('vi-VN').format(amount)} VND` : display;
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: config.storeCurrency || 'USD' }).format(amount);
}

export function internationalizeProduct(product) {
  if (!product) return product;
  return {
    ...product,
    display_name: translateProductName(product.name),
    display_description: translateProductDescription(product.description),
    display_price: formatInternationalPrice(product.price),
    display_currency: config.storeCurrency || 'USD',
    source_price: Number(product.price || 0),
    source_currency: config.storePriceSourceCurrency,
  };
}

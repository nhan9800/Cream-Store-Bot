import { createEmojiResolver } from '../utils/emojiHelper.js';
import { formatCurrency } from '../utils/formatters.js';

export const AI_CREATIVE_PRICING_UPDATE = Object.freeze({
  guildId: '1282637033340403754',
  announcementChannelId: '1514598369597587546',
  priceChannelId: '1514606995842273280',
  marker: 'CENAR-AI-CREATIVE-PRICING-V2',
  productKeys: Object.freeze({
    chatgptNoWarranty: 'chatgpt-plus-account-1-month-no-warranty',
    chatgptAccount: 'chatgpt-plus-account-1-month-full-warranty',
    chatgptBusiness: 'chatgpt-business-workspace-1-month-full-warranty',
    chatgptDirect: 'chatgpt-plus-direct-payment-1-month-full-warranty',
    claudePro: 'claude-pro-1-month',
    gemini12Months: 'gemini-pro-google-one-5tb-12-months-full-warranty',
    gemini18Months: 'gemini-pro-google-one-5tb-18-months-full-warranty',
    geminiValue: 'gemini-pro-google-one-5tb-12-months-4-month-warranty',
    adobe: 'adobe-creative-cloud-1-month',
  }),
});

export function getAiCreativePricingProducts(products) {
  const byKey = new Map((products || []).map((product) => [product.product_key, product]));
  return {
    chatgptNoWarranty: byKey.get(AI_CREATIVE_PRICING_UPDATE.productKeys.chatgptNoWarranty),
    chatgptAccount: byKey.get(AI_CREATIVE_PRICING_UPDATE.productKeys.chatgptAccount),
    chatgptBusiness: byKey.get(AI_CREATIVE_PRICING_UPDATE.productKeys.chatgptBusiness),
    chatgptDirect: byKey.get(AI_CREATIVE_PRICING_UPDATE.productKeys.chatgptDirect),
    claudePro: byKey.get(AI_CREATIVE_PRICING_UPDATE.productKeys.claudePro),
    gemini12Months: byKey.get(AI_CREATIVE_PRICING_UPDATE.productKeys.gemini12Months),
    gemini18Months: byKey.get(AI_CREATIVE_PRICING_UPDATE.productKeys.gemini18Months),
    geminiValue: byKey.get(AI_CREATIVE_PRICING_UPDATE.productKeys.geminiValue),
    adobe: byKey.get(AI_CREATIVE_PRICING_UPDATE.productKeys.adobe),
  };
}

export function buildAiCreativePricingAnnouncement(guildId, products) {
  const E = createEmojiResolver(guildId);
  const selected = getAiCreativePricingProducts(products);
  const missing = Object.entries(selected)
    .filter(([, product]) => !product || product.is_active === 0)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(`Thiếu sản phẩm đang mở bán cho thông báo: ${missing.join(', ')}`);
  }

  return [
    `## ${E('icon_star')} CENAR NÂNG CẤP DANH MỤC AI & SÁNG TẠO`,
    '> Cenar Store chính thức tinh gọn danh mục, nâng tiêu chuẩn chất lượng và áp dụng chính sách bảo hành minh bạch cho từng gói.',
    '',
    `### ${E('brand_chatgpt')} CHATGPT · 4 LỰA CHỌN`,
    `**01 · Cấp tài khoản · Không bảo hành**`,
    `> ${E('payment_money')} **Giá:** ${formatCurrency(selected.chatgptNoWarranty.price)} / thời hạn danh nghĩa 1 tháng`,
    `> ${E('status_warn')} **Lưu ý rủi ro:** Tài khoản có thể mất sau 1–2 tuần hoặc duy trì lâu hơn. Đây là gói thử vận may, không cam kết sống đủ tháng.`,
    '',
    `**02 · Cấp tài khoản ChatGPT Plus · Full bảo hành**`,
    `> ${E('payment_money')} **Giá:** ${formatCurrency(selected.chatgptAccount.price)} / 1 tháng`,
    `> ${E('warranty_shield')} **Bảo hành:** Full trong suốt thời gian sử dụng`,
    '',
    `**03 · ChatGPT Business · Add workspace chính chủ**`,
    `> ${E('payment_money')} **Giá:** ${formatCurrency(selected.chatgptBusiness.price)} / 1 tháng`,
    `> ${E('icon_group')} **Hình thức:** Thêm tài khoản của khách vào workspace ChatGPT Business, hỗ trợ gia hạn đều`,
    `> ${E('warranty_shield')} **Bảo hành:** Full trong suốt thời gian sử dụng`,
    '',
    `**04 · ChatGPT Plus chính chủ · Thanh toán trực tiếp**`,
    `> ${E('payment_money')} **Giá:** ${formatCurrency(selected.chatgptDirect.price)} / 1 tháng`,
    `> ${E('status_check')} **Hình thức:** Thanh toán Plus trực tiếp trên tài khoản của khách, không qua team/workspace`,
    `> ${E('warranty_shield')} **Bảo hành:** Full trong suốt thời gian sử dụng`,
    '',
    `### ${E('brand_claude')} CLAUDE PRO`,
    `> ${E('payment_money')} **Giá:** ${formatCurrency(selected.claudePro.price)} / 1 tháng`,
    `> ${E('warranty_shield')} **Bảo hành:** Full trong suốt thời gian sử dụng`,
    '',
    `### ${E('brand_gemini')} GEMINI PRO + 5 TB GOOGLE ONE · 3 LỰA CHỌN`,
    `**01 · Gói 12 tháng · Full bảo hành**`,
    `> ${E('payment_money')} **Giá:** ${formatCurrency(selected.gemini12Months.price)}`,
    `> ${E('warranty_shield')} **Bảo hành:** Full 12 tháng`,
    '',
    `**02 · Gói 18 tháng · Full bảo hành**`,
    `> ${E('payment_money')} **Giá:** ${formatCurrency(selected.gemini18Months.price)}`,
    `> ${E('warranty_shield')} **Bảo hành:** Full 18 tháng`,
    '',
    `**03 · Gói tiết kiệm 12 tháng · Bảo hành giới hạn**`,
    `> ${E('payment_money')} **Giá:** ${formatCurrency(selected.geminiValue.price)}`,
    `> ${E('warranty_shield')} **Bảo hành:** 4 tháng đầu`,
    `> ${E('status_info')} **Thời gian sử dụng:** Gói có thể duy trì lâu hơn 12 tháng tùy trạng thái hệ thống, nhưng thời gian vượt phạm vi bảo hành không được cam kết.`,
    '',
    `### ${E('brand_adobe')} ADOBE CREATIVE CLOUD ALL APPS`,
    `> ${E('payment_money')} **Giá:** ${formatCurrency(selected.adobe.price)} / 1 tháng`,
    `> ${E('status_check')} **Danh mục:** Shop chỉ mở bán duy nhất gói 1 tháng`,
    `> ${E('warranty_shield')} **Bảo hành:** Full trong suốt thời gian sử dụng`,
    '',
    `### ${E('status_info')} CAM KẾT TỪ CENAR`,
    '- Tên gói, thời hạn và hình thức bàn giao được công khai rõ ràng trước khi thanh toán.',
    '- Các bảng giá ChatGPT, Claude, Gemini và Adobe cũ đã được thay thế bằng danh mục mới.',
    `- Giá mới đã đồng bộ trên bot, website và kênh <#${AI_CREATIVE_PRICING_UPDATE.priceChannelId}>.`,
    '',
    `${E('icon_cart')} **Sẵn sàng đặt hàng ngay trên website hoặc mở ticket để được tư vấn đúng nhu cầu.**`,
    `-# ${AI_CREATIVE_PRICING_UPDATE.marker}`,
  ].join('\n');
}

export function isAiCreativePricingAnnouncement(message, botId) {
  return message?.author?.id === botId
    && JSON.stringify(message.toJSON?.() || message).includes(AI_CREATIVE_PRICING_UPDATE.marker);
}

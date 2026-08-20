import { createEmojiResolver } from '../utils/emojiHelper.js';
import { formatCurrency } from '../utils/formatters.js';

export const AI_CREATIVE_PRICING_UPDATE = Object.freeze({
  guildId: '1282637033340403754',
  announcementChannelId: '1514598369597587546',
  priceChannelId: '1514606995842273280',
  marker: 'CENAR-AI-CREATIVE-PRICING-V1',
  productKeys: Object.freeze({
    chatgptAccount: 'chatgpt-plus-account-1-month-full-warranty',
    chatgptBusiness: 'chatgpt-business-workspace-1-month-full-warranty',
    adobe: 'adobe-creative-cloud-1-month',
  }),
});

export function getAiCreativePricingProducts(products) {
  const byKey = new Map((products || []).map((product) => [product.product_key, product]));
  return {
    chatgptAccount: byKey.get(AI_CREATIVE_PRICING_UPDATE.productKeys.chatgptAccount),
    chatgptBusiness: byKey.get(AI_CREATIVE_PRICING_UPDATE.productKeys.chatgptBusiness),
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
    `### ${E('brand_chatgpt')} CHATGPT · 2 LỰA CHỌN`,
    `**01 · Cấp tài khoản ChatGPT Plus**`,
    `> ${E('payment_money')} **Giá:** ${formatCurrency(selected.chatgptAccount.price)} / 1 tháng`,
    `> ${E('warranty_shield')} **Bảo hành:** Full trong suốt thời gian sử dụng`,
    '',
    `**02 · ChatGPT Business · Tài khoản chính chủ**`,
    `> ${E('payment_money')} **Giá:** ${formatCurrency(selected.chatgptBusiness.price)} / 1 tháng`,
    `> ${E('icon_group')} **Hình thức:** Thêm tài khoản của khách vào workspace ChatGPT Business`,
    `> ${E('warranty_shield')} **Bảo hành:** Full trong suốt thời gian sử dụng`,
    '',
    `### ${E('brand_adobe')} ADOBE CREATIVE CLOUD ALL APPS`,
    `> ${E('payment_money')} **Giá:** ${formatCurrency(selected.adobe.price)} / 1 tháng`,
    `> ${E('status_check')} **Danh mục:** Shop chỉ mở bán duy nhất gói 1 tháng`,
    `> ${E('warranty_shield')} **Bảo hành:** Full trong suốt thời gian sử dụng`,
    '',
    `### ${E('status_info')} CAM KẾT TỪ CENAR`,
    '- Tên gói, thời hạn và hình thức bàn giao được công khai rõ ràng trước khi thanh toán.',
    '- Các bảng giá ChatGPT và Adobe cũ đã được gỡ khỏi hệ thống.',
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

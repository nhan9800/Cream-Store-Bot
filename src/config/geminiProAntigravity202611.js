// Gemini Pro Antigravity full-warranty plans, set by the owner on 2026-11-27.
// They replace every earlier Gemini Pro offer (6-month CDK, 12-month + 5 TB,
// 24-month Antigravity); historical rows stay in the database for old orders.
// 2026-11-28: the owner confirmed both plans include 5 TB Google One storage.

const description = (months, price) => [
  `Gemini Pro ${months} tháng kèm 5 TB lưu trữ Google One, bảo hành full suốt ${months} tháng sử dụng. Giá trọn gói ${price}.`,
  'QUYỀN LỢI: Có đầy đủ các model mới trong Antigravity theo xác nhận của shop. Kèm 5 TB dung lượng Google One dùng chung cho Google Drive, Gmail và Google Photos. Nguồn mới bền, ổn định, phù hợp sử dụng lâu dài.',
  'LƯU Ý: Model, tính năng và hạn mức thực tế tuân theo Google tại thời điểm sử dụng. Sau khi thanh toán, shop hướng dẫn kích hoạt trong ticket.',
].join('\n\n');

const descriptionEn = (months, price) => [
  `Gemini Pro for ${months} months with 5 TB of Google One storage and full warranty for the entire ${months}-month period. Total price: ${price} VND.`,
  'BENEFITS: Full access to the latest models in Antigravity, as confirmed by the shop. Includes 5 TB of Google One storage shared across Google Drive, Gmail and Google Photos. A durable, stable new source suited to long-term use.',
  'NOTE: Models, features and limits follow Google availability at the time of use. After payment, the shop guides activation in your ticket.',
].join('\n\n');

function plan({ months, price, priceLabel }) {
  return Object.freeze({
    product_key: `gemini-pro-antigravity-${months}-months-full-warranty`,
    name: `Gemini Pro ${months} Tháng + 5 TB Google One (Antigravity · Full BH)`,
    aliases: [`Gemini Pro ${months} Tháng (Antigravity · Full BH)`],
    description: description(months, `${priceLabel}đ`),
    descriptionEn: descriptionEn(months, priceLabel.replaceAll('.', ',')),
    warranty_policy: `Full ${months} tháng`,
    price,
    duration_months: months,
    service_type: 'AI',
    emoji: 'brand_gemini',
    original_price: 0,
    is_featured: 1,
    virtual_purchase_count: 0,
  });
}

export const GEMINI_PRO_ANTIGRAVITY_PLANS = Object.freeze([
  plan({ months: 3, price: 150000, priceLabel: '150.000' }),
  plan({ months: 6, price: 280000, priceLabel: '280.000' }),
]);

export const GEMINI_PRO_ANTIGRAVITY_KEYS = Object.freeze(GEMINI_PRO_ANTIGRAVITY_PLANS.map((p) => p.product_key));

// Catalog seed rows (without the English copy, which is not a catalog column).
export const GEMINI_PRO_ANTIGRAVITY_PRODUCTS = Object.freeze(
  GEMINI_PRO_ANTIGRAVITY_PLANS.map(({ descriptionEn: _en, ...row }) => Object.freeze(row)),
);

const EN_BY_DESCRIPTION = new Map(GEMINI_PRO_ANTIGRAVITY_PLANS.map((p) => [p.description, p.descriptionEn]));
export const translateGeminiAntigravityDescription = (value) => EN_BY_DESCRIPTION.get(value) ?? null;

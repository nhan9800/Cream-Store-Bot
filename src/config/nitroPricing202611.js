// Nitro Boost 2-month offer set by the owner on 2026-11-28:
// one 2-month Login plan at 115.000đ completed within 20–30 minutes of the order being
// received, and a 100.000đ renewal reserved for customers who already bought Nitro here.
// The former "Mail bao sống" 136k plan is retired; its rows stay for historical orders.

export const NITRO_2M_KEY = 'discord-nitro-boost-2-months-login-keep-mail-7-days';
export const NITRO_2M_RENEWAL_KEY = 'discord-nitro-boost-2-months-renewal-returning';
export const NITRO_2M_RETIRED_KEY = 'discord-nitro-boost-2-months-login-mail-guaranteed';
export const NITRO_2M_PRICE = 115_000;
export const NITRO_2M_RENEWAL_PRICE = 100_000;

export const NITRO_2M_PRODUCT = Object.freeze({
  product_key: NITRO_2M_KEY,
  name: 'Discord Nitro Boost 2 Tháng (Login · Xong Trong 20–30 Phút)',
  aliases: ['Discord Nitro Boost 2 Tháng (Login · Giữ Mail 7 Ngày)', 'Discord Nitro Boost 2 Tháng (Login)'],
  description: 'Nitro Boost Login 2 tháng. Shop hoàn thành đơn trong 20–30 phút sau khi nhận đơn. '
    + 'Đăng nhập ngay khi nhận và giữ mail tối thiểu 7 ngày để được hỗ trợ bảo hành.',
  price: NITRO_2M_PRICE,
  ctv_price: 95000,
  duration_months: 2,
  service_type: 'GAME',
  emoji: 'brand_nitro',
  original_price: 0,
  is_featured: 1,
});

export const NITRO_2M_RENEWAL_PRODUCT = Object.freeze({
  product_key: NITRO_2M_RENEWAL_KEY,
  name: 'Discord Nitro Boost 2 Tháng · Gia Hạn Khách Cũ',
  description: 'Giá 100.000đ dành riêng cho khách đã từng mua Nitro Boost tại Cenar Store. '
    + 'Bot tự kiểm tra lịch sử đơn khi bạn đặt. Hoàn thành trong 20–30 phút sau khi nhận đơn.',
  price: NITRO_2M_RENEWAL_PRICE,
  duration_months: 2,
  service_type: 'GAME',
  emoji: 'brand_nitro',
  original_price: NITRO_2M_PRICE,
  is_featured: 1,
});

export const NITRO_RENEWAL_NOT_ELIGIBLE = 'Giá gia hạn 100.000đ chỉ dành cho khách đã từng mua Nitro Boost tại Cenar Store. '
  + `Tài khoản này chưa có đơn Nitro trước đó, bạn có thể chọn gói Nitro Boost 2 tháng ${NITRO_2M_PRICE.toLocaleString('vi-VN')}đ.`;

export function isNitroRenewalProduct(product) {
  return product?.product_key === NITRO_2M_RENEWAL_KEY;
}

/**
 * A returning Nitro customer has at least one paid Nitro Boost order (any plan, any
 * store) that was not cancelled or refunded. Decor products are not Nitro purchases.
 */
export function hasPriorNitroPurchase(db, customerId) {
  if (!customerId || customerId === 'WEB') return false;
  return Boolean(db.prepare(`SELECT 1 FROM orders
    WHERE customer_id = ? AND payment_status = 'PAID'
      AND status NOT IN ('CANCELLED', 'REFUNDED', 'REFUND_PENDING', 'FAILED', 'PENDING_PAYMENT')
      AND LOWER(product_name) LIKE '%nitro%boost%'
      AND LOWER(product_name) NOT LIKE '%decor%'
    LIMIT 1`).get(String(customerId)));
}

export const NETFLIX_PROMO_PRODUCT_KEY = 'netflix-premium-1-month-non-renewable';

export const NETFLIX_PROMO_DETAILS_VI = Object.freeze({
  quality: 'Full HD/4K',
  warranty: '20 ngày',
  renewal: 'Không hỗ trợ gia hạn trên tài khoản đã cấp. Khi hết hạn, khách muốn sử dụng tiếp cần đổi sang tài khoản mới.',
});

export const NETFLIX_PROMO_DETAILS_EN = Object.freeze({
  quality: 'Full HD/4K',
  warranty: '20 days',
  renewal: 'The supplied account cannot be renewed. A new account is required after expiry to continue using the service.',
});

export function isNetflixPromoProduct(product) {
  return String(product?.product_key || '') === NETFLIX_PROMO_PRODUCT_KEY;
}

export function getNetflixPromoDetails(international = false) {
  return international ? NETFLIX_PROMO_DETAILS_EN : NETFLIX_PROMO_DETAILS_VI;
}

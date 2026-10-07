// Owner-confirmed 2026-10-07: reference prices +60,000 VND per pack.
// USD credit is provider usage credit, not cash or a calendar subscription.
export const API_CREDIT_DURATION = 'Không giới hạn ngày · Dùng đến hết credit';
export const API_CREDIT_BANNER = 'api-credit-banner-20261007.webp';
export const API_CREDIT_PRODUCTS = Object.freeze([
  [10, 70000], [30, 90000], [50, 110000],
  [100, 155000], [200, 250000], [500, 530000],
].map(([credit, price]) => Object.freeze({
  product_key: `api-codex-claude-credit-${credit}`,
  name: `API Codex/Claude AI $${credit} Credit`,
  description: `$${credit} credit API Codex/Claude. ${API_CREDIT_DURATION}. Nhận token/API riêng và hướng dẫn trong ticket; model và mức tiêu hao theo hệ thống nhà cung cấp.`,
  price, ctv_price: null, duration_months: 0, service_type: 'AI',
  emoji: 'brand_claude', original_price: 0,
  quota_value: credit, quota_unit: 'USD_CREDIT', activation_method: 'TOKEN',
  warranty_policy: 'Bảo hành trong thời gian sử dụng đến hết credit',
  username_required: 0, login_required: 0,
})));

const packKeys = new Set(API_CREDIT_PRODUCTS.map((product) => product.product_key));
export function isApiCreditProduct(product = {}) {
  return packKeys.has(product.product_key)
    || /^API Codex\/Claude AI \$(10|30|50|100|200|500) Credit$/i.test(String(product.name || product.product_name || ''));
}

export function getApiCreditProducts(products = []) {
  return products.filter((product) => packKeys.has(product.product_key) && product.is_active === 1)
    .sort((a, b) => Number(a.quota_value) - Number(b.quota_value));
}

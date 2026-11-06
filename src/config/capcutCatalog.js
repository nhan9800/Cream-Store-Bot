export const CAPCUT_PRODUCT_KEYS = Object.freeze([
  'capcut-pro-1-thang-2-thiet-bi-cap-acc',
  'capcut-pro-7-ngay-2-thiet-bi-cap-acc',
  'capcut-pro-12-thang-3-thiet-bi-chinh-chu',
]);

export function isCapcutProduct(product) {
  return Boolean(product && CAPCUT_PRODUCT_KEYS.includes(product.product_key));
}

export function capcutPriceSetting(productKey) {
  if (!CAPCUT_PRODUCT_KEYS.includes(productKey)) throw new Error('Gói này không thuộc danh sách CapCut đang bán.');
  return `capcut:price:${productKey}`;
}

// The same explicit VND validation used by the existing Boost Admin editor.
export { parseBoostPrice as parseCapcutPrice } from './boostCatalog.js';

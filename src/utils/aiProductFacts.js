import { API_CREDIT_DURATION, isApiCreditProduct } from '../config/apiCreditCatalog.js';

// Keep subscription duration separate from warranty, hosting gifts and delivery time.
export function aiProductDuration(product) {
  if (isApiCreditProduct(product)) return API_CREDIT_DURATION;
  const name = String(product.name || '');
  const service = String(product.service_type || '').toLowerCase();
  if (service === 'service' && !/duy trì/i.test(name)) return 'Theo phạm vi dự án';
  if (service === 'decor' || /vĩnh viễn|vinh vien|lifetime/i.test(name)) return 'Vĩnh viễn';
  if (Number(product.duration_days) > 0) return `${Number(product.duration_days)} ngày`;
  if (Number(product.duration_months) > 0) return `${Number(product.duration_months)} tháng`;
  return 'Cần xác nhận thời hạn với shop';
}

export function aiProductPrice(product) {
  const price = Number(product.price);
  return Number.isFinite(price) && price > 0 ? `${price.toLocaleString('vi-VN')}đ` : 'Liên hệ shop để báo giá';
}

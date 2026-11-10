import { API_CREDIT_DURATION, isApiCreditProduct } from '../config/apiCreditCatalog.js';

export function aiProductSubscriptionDuration(product) {
  const service = String(product.service_type || '').toLowerCase();
  // These rows store historical placeholder months, not subscription terms.
  if (service === 'decor' || (service === 'service' && !/duy trì/i.test(String(product.name || '')))
    || isApiCreditProduct(product) || /vĩnh viễn|vinh vien|lifetime/i.test(String(product.name || ''))) {
    return { days: null, months: null };
  }
  const days = Number(product.duration_days);
  if (Number.isInteger(days) && days > 0) return { days, months: null };
  // Legacy day-plan rows use duration_months=1 and omit duration_days. Read
  // only the primary SKU duration: never a warranty, delivery or login note.
  const primaryName = String(product.name || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase()
    .split(/[([{+·]|\s[—–]\s|\b(?:bh|bao hanh|giao|nhan hang|kich hoat|giu mail|tang|kem|gift|bonus)\b/)[0];
  const namedDuration = primaryName.match(/\b(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\s*(ngay|days?|thang|months?|nam|years?)\b/);
  const dayRange = /\b\d+\s*(?:[-–~]|den|toi|to)\s*\d+\s*(?:ngay|days?)\b/.test(primaryName);
  if (namedDuration && !namedDuration[2] && !dayRange && /^(?:ngay|days?)$/.test(namedDuration[3])) {
    const namedDays = Number(namedDuration[1]);
    if (namedDays > 0) return { days: namedDays, months: null };
  }
  const months = Number(product.duration_months);
  return { days: null, months: product.duration_months !== null && product.duration_months !== undefined
    && Number.isInteger(months) && months >= 0 ? months : null };
}

// Keep subscription duration separate from warranty, hosting gifts and delivery time.
export function aiProductDuration(product) {
  if (isApiCreditProduct(product)) return API_CREDIT_DURATION;
  const name = String(product.name || '');
  const service = String(product.service_type || '').toLowerCase();
  if (service === 'service' && !/duy trì/i.test(name)) return 'Theo phạm vi dự án';
  if (service === 'decor' || /vĩnh viễn|vinh vien|lifetime/i.test(name)) return 'Vĩnh viễn';
  const duration = aiProductSubscriptionDuration(product);
  if (duration.days) return `${duration.days} ngày`;
  if (duration.months > 0) return `${duration.months} tháng`;
  return 'Cần xác nhận thời hạn với shop';
}

export function aiProductPrice(product) {
  const price = Number(product.price);
  return Number.isFinite(price) && price > 0 ? `${price.toLocaleString('vi-VN')}đ` : 'Liên hệ shop để báo giá';
}

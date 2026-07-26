export function getDurText(p, options = []) {
  if (p.price === 0) return 'Thương lượng';
  if (p.duration_months === null || p.duration_months === undefined) return 'Vĩnh viễn';
  if (p.duration_months === 0) return 'Vĩnh viễn';
  const match = options.find((o) => o.duration === p.duration_months);
  return match ? match.label : `${p.duration_months} tháng`;
}

export function formatPriceVND(price) {
  if (price === 0 || price === null || price === undefined) {
    return 'Thương lượng';
  }
  const numericPrice = Number(price);
  if (isNaN(numericPrice) || numericPrice === 0) {
    return 'Thương lượng';
  }
  return `${numericPrice.toLocaleString('vi-VN')} đ`;
}

export function generateProductSlug(name, sku = '') {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  
  if (!base && sku) {
    return String(sku).toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');
  }
  return base || 'unnamed-product';
}

export function anonymizeCustomerName(name) {
  const s = String(name || '').trim();
  if (!s) return 'Khách hàng';
  if (s.length <= 2) return `${s[0]}***`;
  return `${s.slice(0, 2)}***${s.slice(-1)}`;
}

export function anonymizeCustomerEmail(email) {
  const s = String(email || '').trim();
  if (!s) return '***@cenarstore.xyz';
  const parts = s.split('@');
  if (parts.length !== 2) return `${s.slice(0, 1)}***`;
  const [user, domain] = parts;
  if (user.length <= 2) return `${user[0]}***@${domain}`;
  return `${user.slice(0, 2)}***@${domain}`;
}

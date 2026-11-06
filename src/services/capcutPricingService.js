import { db, nowIso } from '../database/db.js';
import { CAPCUT_PRODUCT_KEYS, capcutPriceSetting, isCapcutProduct, parseCapcutPrice } from '../config/capcutCatalog.js';

export function getEditableCapcutProducts() {
  return db.prepare(`SELECT * FROM product_catalog WHERE guild_id = 'WEB' AND is_active = 1
    AND product_key IN (SELECT value FROM json_each(?)) ORDER BY sort_order, id`).all(JSON.stringify(CAPCUT_PRODUCT_KEYS));
}

export function getCapcutPriceProduct(productId) {
  if (!/^[1-9]\d*$/.test(String(productId)) || !Number.isSafeInteger(Number(productId))) throw new Error('Gói CapCut không hợp lệ.');
  const product = db.prepare("SELECT * FROM product_catalog WHERE id = ? AND guild_id = 'WEB' AND is_active = 1").get(Number(productId));
  if (!isCapcutProduct(product)) throw new Error('Gói này không thuộc danh sách CapCut đang bán.');
  return product;
}

export function updateCapcutPrice(productId, value, expectedPrice, actorId) {
  const price = parseCapcutPrice(value);
  const expected = parseCapcutPrice(expectedPrice);
  return db.transaction(() => {
    const product = getCapcutPriceProduct(productId);
    if (Number(product.price) !== expected) throw new Error('Giá đã được cập nhật bởi Admin khác. Mở lại nút Sửa giá để xem giá mới.');
    const timestamp = nowIso();
    const result = db.prepare(`UPDATE product_catalog SET price = ?, updated_at = ?
      WHERE id = ? AND guild_id = 'WEB' AND is_active = 1 AND product_key = ? AND price = ?`)
      .run(price, timestamp, product.id, product.product_key, expected);
    if (result.changes !== 1) throw new Error('Giá đã thay đổi. Vui lòng mở lại nút Sửa giá.');
    const setting = capcutPriceSetting(product.product_key);
    const save = db.prepare(`INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
    save.run(setting, String(price), timestamp);
    save.run(`${setting}:last_edit`, JSON.stringify({ actorId, price, at: timestamp }), timestamp);
    // Retail catalog only; CTV prices and existing orders/invoices are snapshots.
    return { ...product, price, updated_at: timestamp };
  })();
}

export function assertCapcutPurchaseQuote(productId, expectedPrice, isCtv = false) {
  const product = getCapcutPriceProduct(productId);
  const unitPrice = Number(isCtv && product.ctv_price !== null ? product.ctv_price : product.price);
  if (!Number.isSafeInteger(Number(expectedPrice)) || Number(expectedPrice) !== unitPrice) {
    const error = new Error(`Giá CapCut hiện tại là ${unitPrice.toLocaleString('vi-VN')}đ. Vui lòng chọn lại gói để xác nhận giá mới; chưa tạo đơn hoặc trừ ví.`);
    error.code = 'CAPCUT_PRICE_CHANGED';
    throw error;
  }
  return unitPrice;
}

export function getCapcutWebCheckoutPrice(productId, expectedPrice) {
  const product = getCapcutPriceProduct(productId);
  const price = parseCapcutPrice(product.price);
  if (typeof expectedPrice !== 'number' || !Number.isSafeInteger(expectedPrice) || expectedPrice !== price) {
    const error = new Error('Giá CapCut đã cập nhật. Vui lòng kiểm tra giá mới và xác nhận lại; chưa tạo đơn hoặc trừ ví.');
    error.code = 'CAPCUT_PRICE_CHANGED';
    error.current_price = price;
    error.product_id = product.id;
    throw error;
  }
  return price;
}

import { db, nowIso } from '../database/db.js';
import { BOOST_DEFAULT_PRICE, BOOST_PRICE_SETTING, BOOST_PRODUCT_KEY, parseBoostPrice } from '../config/boostCatalog.js';

export function getBoostPrice() {
  const row = db.prepare("SELECT price FROM product_catalog WHERE guild_id = 'WEB' AND product_key = ? AND is_active = 1 ORDER BY id LIMIT 1").get(BOOST_PRODUCT_KEY);
  return row ? parseBoostPrice(row.price) : BOOST_DEFAULT_PRICE;
}

export function updateBoostPrice(value, expectedPrice, actorId) {
  const price = parseBoostPrice(value);
  return db.transaction(() => {
    if (getBoostPrice() !== Number(expectedPrice)) throw new Error('Giá đã được cập nhật bởi Admin khác. Mở lại nút Sửa giá để xem giá mới.');
    const timestamp = nowIso();
    const result = db.prepare("UPDATE product_catalog SET price = ?, updated_at = ? WHERE guild_id = 'WEB' AND product_key = ? AND is_active = 1").run(price, timestamp, BOOST_PRODUCT_KEY);
    if (result.changes !== 1) throw new Error('Chưa tìm thấy đúng một gói Boost 3 tháng trong catalog.');
    db.prepare(`INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(BOOST_PRICE_SETTING, String(price), timestamp);
    db.prepare(`INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run('boost:3m:price:last_edit', JSON.stringify({ actorId, price, at: timestamp }), timestamp);
    // Existing order/invoice snapshots are intentionally untouched.
    return price;
  })();
}

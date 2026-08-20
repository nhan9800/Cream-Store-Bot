import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { PUBLIC_PRODUCT_COLUMNS } from '../src/services/botApiRoutes.js';

describe('public product purchase metrics', () => {
  it('counts only non-cancelled paid orders and exposes completion details', () => {
    const database = new Database(':memory:');
    database.exec(`
      CREATE TABLE product_catalog (
        id INTEGER, guild_id TEXT, name TEXT, description TEXT, price INTEGER,
        duration_months INTEGER, service_type TEXT, emoji TEXT, is_active INTEGER,
        sort_order INTEGER, original_price INTEGER, product_key TEXT,
        is_featured INTEGER, image_url TEXT, warranty_policy TEXT
      );
      CREATE TABLE account_stock (status TEXT, service_type TEXT);
      CREATE TABLE orders (
        quantity INTEGER, status TEXT, payment_status TEXT,
        product_name TEXT, created_at TEXT
      );
      CREATE TABLE feedbacks (
        is_visible INTEGER, product_id INTEGER, product_name TEXT, stars INTEGER
      );
      INSERT INTO product_catalog VALUES (
        1, 'WEB', 'Claude API 100M', '', 85000, 1, 'AI', 'brand_claude',
        1, 1, 120000, 'claude-api-100m', 1, NULL, 'Bảo hành 4 tháng đầu'
      );
      INSERT INTO orders VALUES
        (2, 'COMPLETED', 'PAID', 'Claude API 100M', '2026-08-05 10:00:00'),
        (1, 'PROCESSING', 'PAID', 'Claude API 100M', '2026-08-05 11:00:00'),
        (20, 'COMPLETED', 'FREE', 'Claude API 100M', '2026-08-05 12:00:00'),
        (20, 'COMPLETED', 'PENDING', 'Claude API 100M', '2026-08-05 13:00:00'),
        (20, 'CANCELLED', 'PAID', 'Claude API 100M', '2026-08-05 14:00:00');
    `);

    const product = database.prepare(`SELECT ${PUBLIC_PRODUCT_COLUMNS} FROM product_catalog pc`).get();
    expect(product.purchase_count).toBe(3);
    expect(product.completed_purchase_count).toBe(2);
    expect(product.last_paid_at).toBe('2026-08-05 11:00:00');
    expect(product.warranty_policy).toBe('Bảo hành 4 tháng đầu');
    expect(product).not.toHaveProperty('virtual_purchase_count');
    database.close();
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, afterEach, describe, expect, it, vi } from 'vitest';

const testDatabasePath = vi.hoisted(() => {
  const relativePath = `./data/test-product-order-linkage-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.test-product-order-linkage-not-present';
  process.env.DATABASE_PATH = relativePath;
  process.env.ENCRYPTION_KEY = 'test-product-order-linkage-key';
  return relativePath;
});

import { db, initDatabase, seedProductCatalog } from '../src/database/db.js';
import { createTicket } from '../src/services/ticketService.js';
import { createOrder } from '../src/services/orderService.js';

let sequence = 0;

beforeAll(() => {
  initDatabase();
  seedProductCatalog(db);
});

afterEach(() => {
  db.prepare('DELETE FROM orders WHERE order_code LIKE ?').run('CN_LINK%');
  db.prepare('DELETE FROM tickets WHERE channel_id LIKE ?').run('link-ticket-%');
});

afterAll(() => {
  db.close();
  for (const suffix of ['', '-shm', '-wal']) {
    fs.rmSync(`${path.resolve(process.cwd(), testDatabasePath)}${suffix}`, { force: true });
  }
});

function createLinkedOrder(options = {}) {
  sequence += 1;
  const product = db.prepare('SELECT * FROM product_catalog WHERE product_key = ?').get('discord-nitro-boost-2-months-login-mail-guaranteed');
  const customerId = `link-customer-${sequence}`;
  const channelId = `link-ticket-${sequence}`;
  const ticket = createTicket({ guildId: 'WEB', channelId, customerId, openedById: customerId, ticketType: 'ORDER' });
  return { product, order: createOrder({
    orderCode: `CN_LINK${sequence}`,
    guildId: 'WEB', ticketId: ticket.id, ticketChannelId: channelId,
    customerId, productName: options.productName || product.name,
    productId: options.productId, quantity: 1, totalAmount: product.price,
    durationMonths: options.durationMonths ?? product.duration_months,
    orderLogChannelId: 'link-order-log', createdById: customerId,
  }) };
}

describe('order to catalog linkage', () => {
  it('persists the selected catalog product id for panel and website orders', () => {
    const { product, order } = createLinkedOrder({ productId: productIdPlaceholder() });
    expect(order.product_id).toBe(product.id);
  });

  it('recovers a unique catalog product when a legacy/manual order supplies only its name', () => {
    const { product, order } = createLinkedOrder({ durationMonths: 1 });
    expect(order.product_id).toBe(product.id);
  });
});

function productIdPlaceholder() {
  return db.prepare('SELECT id FROM product_catalog WHERE product_key = ?').get('discord-nitro-boost-2-months-login-mail-guaranteed').id;
}

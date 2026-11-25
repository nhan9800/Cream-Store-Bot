import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testDatabasePath = vi.hoisted(() => {
  process.env.ENV_FILE = '.env.test-warranty-picker-not-present';
  process.env.DATABASE_PATH = `./data/test-warranty-picker-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENCRYPTION_KEY = 'test-warranty-picker-key';
  return process.env.DATABASE_PATH;
});
import { db, initDatabase } from '../src/database/db.js';
import { createTicket } from '../src/services/ticketService.js';
import { createOrder, listWarrantyEligibleOrders, setOrderStatus } from '../src/services/orderService.js';
import { buildWarrantyTicketOpenedV2, normalizeWarrantyFormData } from '../src/services/warrantyService.js';

const GUILD = '1282637033340403754';
beforeAll(() => initDatabase());
afterAll(() => {
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(path.resolve(testDatabasePath + suffix), { force: true });
});

function order(code, { guildId = GUILD, customerId = 'buyer', status = 'COMPLETED' } = {}) {
  const ticket = createTicket({ guildId, channelId: `ch-${code}`, customerId, openedById: customerId, ticketType: 'ORDER' });
  createOrder({ guildId, ticketId: ticket.id, ticketChannelId: ticket.channel_id, customerId, productName: `Gói ${code}`,
    quantity: 1, totalAmount: 10000, orderLogChannelId: 'log', createdById: 'staff', orderCode: code });
  return setOrderStatus(code, status);
}

describe('warranty order picker data', () => {
  it('lists only completed or under-warranty orders the customer owns in this guild, open warranty first', () => {
    order('CN_700001');
    order('CN_700002', { status: 'WARRANTY_OPEN' });
    order('CN_700003', { status: 'PROCESSING' });
    order('CN_700004', { customerId: 'someone-else' });
    order('CN_700005', { guildId: 'other-guild' });
    expect(listWarrantyEligibleOrders(GUILD, 'buyer').map(row => row.order_code)).toEqual(['CN_700002', 'CN_700001']);
    expect(listWarrantyEligibleOrders(GUILD, 'nobody')).toEqual([]);
  });

  it('shows when the issue started and what the customer already tried in the warranty case', () => {
    const row = order('CN_700006');
    const formData = normalizeWarrantyFormData(row, { issue: 'Mất Premium', issueSince: 'Sáng nay', triedSteps: 'không có' });
    expect(formData).toMatchObject({ issue: 'Mất Premium', issueSince: 'Sáng nay' });
    expect(formData).not.toHaveProperty('triedSteps');
    const message = buildWarrantyTicketOpenedV2({ order: row, ticket: { id: 1 }, channel: '<#c>', formData, guildId: GUILD });
    const content = JSON.stringify(message.components.map(component => component.toJSON?.() ?? component));
    expect(content).toContain('**Lỗi đã báo** — Mất Premium');
    expect(content).toContain('**Bắt đầu từ** — Sáng nay');
    expect(content).not.toContain('Đã thử');
  });
});

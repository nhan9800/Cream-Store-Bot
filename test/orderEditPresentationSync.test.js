import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const testDatabasePath = vi.hoisted(() => {
  const relativePath = `./data/test-order-edit-sync-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.test-order-edit-sync-not-present';
  process.env.DATABASE_PATH = relativePath;
  return relativePath;
});

import { db, initDatabase } from '../src/database/db.js';
import { createTicket } from '../src/services/ticketService.js';
import {
  createOrder,
  getOrderByCode,
  markOrderCompleted,
} from '../src/services/orderService.js';
import { updateOrderFieldsRaw } from '../src/services/v11DbHelpers.js';
import {
  refreshCompletedTicketMessage,
  sendCompletedTicketFlow,
} from '../src/services/notificationService.js';

const suffix = Date.now().toString();
const guildId = `guild_edit_sync_${suffix}`;
const customerId = `customer_edit_sync_${suffix}`;
const staffId = `staff_edit_sync_${suffix}`;
let sequence = 0;

function createCompletedOrder() {
  sequence += 1;
  const orderCode = `CN_${String(920000 + sequence)}`;
  const channelId = `ticket-${orderCode.toLowerCase()}`;
  const ticket = createTicket({
    guildId,
    channelId,
    customerId,
    openedById: customerId,
    ticketType: 'ORDER',
    relatedOrderCode: orderCode,
  });
  createOrder({
    orderCode,
    guildId,
    ticketId: ticket.id,
    ticketChannelId: channelId,
    customerId,
    productName: 'Sản phẩm cũ 1 tháng',
    quantity: 1,
    totalAmount: 100_000,
    durationMonths: 1,
    orderLogChannelId: 'order-log-test',
    createdById: staffId,
  });
  return markOrderCompleted(orderCode, staffId, 24);
}

function createFakeDiscordChannel(channelId, initialMessages = []) {
  const messages = new Map(initialMessages.map((message) => [message.id, message]));
  const channel = {
    id: channelId,
    isTextBased: () => true,
    messages: {
      fetch: vi.fn(async (query) => {
        if (typeof query === 'string') return messages.get(query) || null;
        const values = [...messages.values()].slice(0, Number(query?.limit || 100));
        return new Map(values.map((message) => [message.id, message]));
      }),
    },
    send: vi.fn(async (payload) => {
      const message = {
        id: `completion-${messages.size + 1}`,
        author: { id: 'bot-user' },
        components: payload.components,
        edit: vi.fn(async (nextPayload) => {
          message.components = nextPayload.components;
          return message;
        }),
      };
      messages.set(message.id, message);
      return message;
    }),
  };
  return { channel, messages };
}

function createFakeGuild(channel) {
  return {
    id: guildId,
    client: { user: { id: 'bot-user' } },
    channels: { fetch: vi.fn(async (channelId) => (channelId === channel.id ? channel : null)) },
  };
}

describe('/sua-don completion presentation synchronization', () => {
  beforeAll(() => {
    initDatabase();
  });

  afterAll(() => {
    db.close();
    const absolutePath = path.resolve(process.cwd(), testDatabasePath);
    for (const suffixToRemove of ['', '-shm', '-wal']) {
      fs.rmSync(`${absolutePath}${suffixToRemove}`, { force: true });
    }
  });

  it('stores a new completion message reference and refreshes it after order fields change', async () => {
    const order = createCompletedOrder();
    const { channel, messages } = createFakeDiscordChannel(order.ticket_channel_id);
    const guild = createFakeGuild(channel);

    const posted = await sendCompletedTicketFlow({
      guild,
      order,
      actorId: staffId,
      supportId: staffId,
    });

    expect(posted).toMatchObject({ posted: true, synced: true, status: 'created' });
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(getOrderByCode(order.order_code)).toMatchObject({
      completion_channel_id: order.ticket_channel_id,
      completion_message_id: posted.messageId,
      completion_staff_id: staffId,
      completion_support_id: staffId,
    });

    const updatedOrder = updateOrderFieldsRaw(order.order_code, {
      product_name: 'Sản phẩm mới 2 tháng',
      quantity: 2,
      duration_months: 2,
      duration_days: null,
      total_amount: 250_000,
    });
    const refreshed = await refreshCompletedTicketMessage({ guild, order: updatedOrder });
    const message = messages.get(posted.messageId);
    const editedPayload = message.edit.mock.calls.at(-1)?.[0];
    const serialized = JSON.stringify(editedPayload.components.map((component) => component.toJSON()));

    expect(refreshed).toMatchObject({ synced: true, status: 'updated' });
    expect(message.edit).toHaveBeenCalledTimes(1);
    expect(serialized).toContain('Sản phẩm mới 2 tháng');
    expect(serialized).toContain('x2');
    expect(serialized).not.toContain('Sản phẩm cũ 1 tháng');
    expect(serialized).toContain(`feedback:quick:${order.order_code}:5`);
    expect(updatedOrder.expiry_at).not.toBe(order.expiry_at);
    expect(updatedOrder.queue_group).toBe('san pham moi 2 thang');
    expect(updatedOrder.service_type).toBeTruthy();
  });

  it('discovers and persists a legacy completion card when no reference was stored', async () => {
    const order = createCompletedOrder();
    const legacyMessage = {
      id: 'legacy-completion-message',
      author: { id: 'bot-user' },
      components: [{
        toJSON: () => ({
          type: 1,
          components: [{ type: 2, custom_id: `feedback:quick:${order.order_code}:5` }],
        }),
      }],
      edit: vi.fn(async () => legacyMessage),
    };
    const { channel } = createFakeDiscordChannel(order.ticket_channel_id, [legacyMessage]);
    const guild = createFakeGuild(channel);

    const refreshed = await refreshCompletedTicketMessage({ guild, order });
    const persisted = getOrderByCode(order.order_code);

    expect(refreshed).toMatchObject({
      synced: true,
      status: 'discovered_and_updated',
      messageId: legacyMessage.id,
    });
    expect(legacyMessage.edit).toHaveBeenCalledTimes(1);
    expect(persisted).toMatchObject({
      completion_channel_id: order.ticket_channel_id,
      completion_message_id: legacyMessage.id,
      completion_staff_id: staffId,
      completion_support_id: staffId,
    });
  });

  it('migrates completion reference columns without replacing existing order data', () => {
    const columns = new Set(db.prepare('PRAGMA table_info(orders)').all().map((column) => column.name));
    for (const column of [
      'completion_channel_id',
      'completion_message_id',
      'completion_staff_id',
      'completion_support_id',
    ]) {
      expect(columns.has(column)).toBe(true);
    }
  });
});

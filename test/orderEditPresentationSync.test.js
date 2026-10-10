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
import { createTicket, closeTicket } from '../src/services/ticketService.js';
import {
  createOrder,
  getOrderByCode,
  markOrderCompleted,
} from '../src/services/orderService.js';
import { updateOrderFieldsRaw } from '../src/services/v11DbHelpers.js';
import {
  refreshCompletedTicketMessage,
  sendCompletedTicketFlow,
  inspectOrderPresentation,
} from '../src/services/notificationService.js';
import { syncOrderFeedbackMessages, inspectOrderFeedbackMessages } from '../src/services/feedbackService.js';
import { execute as editOrderCommand } from '../src/commands/sua-don.js';
import { registerAdminRoutes } from '../src/services/adminApiRoutes.js';
import { config } from '../src/config.js';
import { normalizeMessagePresentation } from '../src/utils/discordEmojiBoundary.js';

const suffix = Date.now().toString();
const guildId = `guild_edit_sync_${suffix}`;
const customerId = '123456789012345678';
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
        embeds: payload.embeds,
        edit: vi.fn(async (nextPayload) => {
          message.components = nextPayload.components;
          message.embeds = nextPayload.embeds;
          return message;
        }),
      };
      messages.set(message.id, message);
      return message;
    }),
  };
  return { channel, messages };
}

function addFakeDm(guild) {
  const { channel, messages } = createFakeDiscordChannel('customer-dm');
  channel.isDMBased = () => true;
  channel.recipientId = customerId;
  guild.client.users = { fetch: vi.fn(async () => ({ createDM: vi.fn(async () => channel) })) };
  guild.client.channels = { fetch: vi.fn(async () => channel) };
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
      'completion_update_dm_channel_id',
      'completion_update_dm_message_id',
    ]) {
      expect(columns.has(column)).toBe(true);
    }
  });

  it('restores a missing card once and serializes simultaneous retries with stale references', async () => {
    const order = createCompletedOrder();
    const { channel } = createFakeDiscordChannel(order.ticket_channel_id);
    const guild = createFakeGuild(channel);
    const results = await Promise.all([
      refreshCompletedTicketMessage({ guild, order }), refreshCompletedTicketMessage({ guild, order }),
    ]);
    expect(results.map((result) => result.status)).toEqual(['created', 'updated']);
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(channel.send.mock.calls[0][0].allowedMentions).toEqual({ parse: [] });
  });

  it('keeps a rated card recognizable without reactivating feedback buttons or closing its ticket', async () => {
    const order = createCompletedOrder();
    db.prepare('UPDATE orders SET feedback_submitted_at=? WHERE order_code=?').run(new Date().toISOString(), order.order_code);
    const { channel } = createFakeDiscordChannel(order.ticket_channel_id);
    const guild = createFakeGuild(channel);
    await refreshCompletedTicketMessage({ guild, order });
    const result = await refreshCompletedTicketMessage({ guild, order });
    expect(result.status).toBe('updated');
    const text = JSON.stringify(channel.send.mock.calls[0][0]);
    expect(text).not.toContain('feedback:quick:');
    expect(text).toContain(`ticket:warranty:${order.order_code}`);
    expect(text).toContain('ĐÃ NHẬN ĐÁNH GIÁ');
    expect(db.prepare('SELECT status FROM tickets WHERE id=?').get(order.ticket_id).status).toBe('OPEN');
  });

  it('discovers a legacy completion embed by exact code while ignoring another order and public reviews', async () => {
    const order = createCompletedOrder();
    const other = { id: 'other-card', author: { id: 'bot-user' }, embeds: [{ title: 'Đơn Hàng Đã Hoàn Thành', description: `${order.order_code}0` }], edit: vi.fn() };
    const review = { id: 'review-card', author: { id: 'bot-user' }, embeds: [{ title: 'Đánh Giá 5/5 Sao', description: order.order_code }], edit: vi.fn() };
    const legacy = { id: 'legacy-embed', author: { id: 'bot-user' }, embeds: [{ title: 'Đơn Hàng Đã Hoàn Thành', fields: [{ value: `\`${order.order_code}\`` }] }], edit: vi.fn() };
    const { channel } = createFakeDiscordChannel(order.ticket_channel_id, [other, review, legacy]);
    const result = await refreshCompletedTicketMessage({ guild: createFakeGuild(channel), order });
    expect(result.messageId).toBe(legacy.id);
    expect(legacy.edit.mock.calls[0][0]).toMatchObject({ content: null, embeds: [] });
    expect(other.edit).not.toHaveBeenCalled(); expect(review.edit).not.toHaveBeenCalled();
  });

  it('updates one private DM for a deleted ticket and preserves all commerce data', async () => {
    const order = createCompletedOrder();
    const { channel } = createFakeDiscordChannel(order.ticket_channel_id);
    const guild = createFakeGuild(channel);
    guild.channels.fetch.mockRejectedValue({ code: 10003 });
    const dm = addFakeDm(guild);
    const before = getOrderByCode(order.order_code);
    const created = await refreshCompletedTicketMessage({ guild, order });
    const retry = await refreshCompletedTicketMessage({ guild, order });
    expect(created).toMatchObject({ synced: true, status: 'dm_updated', ticketStatus: 'channel_missing' });
    expect(retry.messageId).toBe(created.messageId);
    expect(dm.channel.send).toHaveBeenCalledTimes(1);
    expect(channel.send).not.toHaveBeenCalled();
    const after = getOrderByCode(order.order_code);
    for (const field of ['status', 'total_amount', 'amount_paid', 'expiry_at', 'completed_at', 'feedback_submitted_at']) {
      expect(after[field]).toBe(before[field]);
    }
    const storedDm = dm.messages.get(created.messageId);
    // Discord and the send boundary normalize custom emoji and optional inline
    // fields. Object property order is not a difference in the visible message.
    const delivered = normalizeMessagePresentation({ embeds: storedDm.embeds }, guildId).embeds[0];
    storedDm.embeds = [{ ...delivered, fields: delivered.fields.map((field) => ({
      value: field.value, ...(field.inline ? { inline: true } : {}), name: field.name,
    })) }];
    const evidence = await inspectOrderPresentation({ guild, order: after });
    expect(evidence).toMatchObject({ update_dm_status: 'available', dm_matches_current_order: true });
    guild.channels.fetch.mockResolvedValue(channel);
    const changed = updateOrderFieldsRaw(order.order_code, { product_name: 'Thông tin mới', quantity: 2 });
    const synced = await refreshCompletedTicketMessage({ guild, order: changed });
    expect(synced).toMatchObject({ synced: true, dm_synced: true });
    expect(dm.channel.send).toHaveBeenCalledTimes(1);
    expect((await inspectOrderPresentation({ guild, order: getOrderByCode(order.order_code) })).dm_matches_current_order).toBe(true);
  });

  it('leaves a closed ticket and transcript history untouched even if its channel still exists', async () => {
    const order = createCompletedOrder();
    closeTicket(order.ticket_id, staffId);
    const { channel } = createFakeDiscordChannel(order.ticket_channel_id);
    const guild = createFakeGuild(channel); const dm = addFakeDm(guild);
    const result = await refreshCompletedTicketMessage({ guild, order });
    expect(result).toMatchObject({ synced: true, ticketStatus: 'ticket_closed' });
    expect(guild.channels.fetch).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
    expect(dm.channel.send).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT status FROM tickets WHERE id=?').get(order.ticket_id).status).toBe('CLOSED');
  });

  it.each([50013, 50001, 'ETIMEDOUT'])('does not treat channel error %s as deletion or send a fallback', async (code) => {
    const order = createCompletedOrder();
    const { channel } = createFakeDiscordChannel(order.ticket_channel_id);
    const guild = createFakeGuild(channel); const dm = addFakeDm(guild);
    guild.channels.fetch.mockRejectedValue({ code });
    const result = await refreshCompletedTicketMessage({ guild, order });
    expect(result).toMatchObject({ synced: false, status: 'error', code: String(code) });
    expect(channel.send).not.toHaveBeenCalled(); expect(dm.channel.send).not.toHaveBeenCalled();
  });

  it('does not recreate a card if reading the stored message is forbidden', async () => {
    const order = createCompletedOrder();
    db.prepare('UPDATE orders SET completion_channel_id=?, completion_message_id=? WHERE order_code=?')
      .run(order.ticket_channel_id, 'stored-id', order.order_code);
    const { channel } = createFakeDiscordChannel(order.ticket_channel_id);
    channel.messages.fetch.mockRejectedValue({ code: 50013 });
    const result = await refreshCompletedTicketMessage({ guild: createFakeGuild(channel), order });
    expect(result).toMatchObject({ synced: false, code: '50013' }); expect(channel.send).not.toHaveBeenCalled();
  });

  it('avoids duplicating an undiscovered older card when the 500-message scan is exhausted', async () => {
    const order = createCompletedOrder();
    const page = new Map(Array.from({ length: 100 }, (_, i) => [`msg-${i}`, { id: `msg-${i}`, author: { id: 'other-user' } }]));
    const { channel } = createFakeDiscordChannel(order.ticket_channel_id);
    channel.messages.fetch.mockResolvedValue(page);
    const guild = createFakeGuild(channel); const dm = addFakeDm(guild);
    const result = await refreshCompletedTicketMessage({ guild, order });
    expect(result).toMatchObject({ synced: true, ticketStatus: 'search_limit' });
    expect(channel.messages.fetch).toHaveBeenCalledTimes(5);
    expect(channel.send).not.toHaveBeenCalled(); expect(dm.channel.send).toHaveBeenCalledTimes(1);
  });

  it('reports closed customer DMs accurately and retains the database edit', async () => {
    const order = createCompletedOrder(); closeTicket(order.ticket_id, staffId);
    const { channel } = createFakeDiscordChannel(order.ticket_channel_id);
    const guild = createFakeGuild(channel); const dm = addFakeDm(guild);
    dm.channel.send.mockRejectedValue({ code: 50007 });
    const edited = updateOrderFieldsRaw(order.order_code, { product_name: 'Updated product' });
    const result = await refreshCompletedTicketMessage({ guild, order: edited });
    expect(result).toMatchObject({ synced: false, status: 'error', code: '50007' });
    expect(getOrderByCode(order.order_code)).toMatchObject({ product_name: 'Updated product', completion_update_dm_message_id: null });
  });

  it('does not notify another server or a cancelled order with an old completion timestamp', async () => {
    const order = createCompletedOrder(); const { channel } = createFakeDiscordChannel(order.ticket_channel_id);
    const guild = createFakeGuild(channel); guild.id = 'another-guild';
    expect((await refreshCompletedTicketMessage({ guild, order })).synced).toBe(false);
    expect(channel.send).not.toHaveBeenCalled();
    db.prepare("UPDATE orders SET status='CANCELLED' WHERE order_code=?").run(order.order_code);
    expect((await refreshCompletedTicketMessage({ guild: createFakeGuild(channel), order })).status).toBe('not_completed');
  });

  it('synchronizes feedback product/quantity without rewriting stars, text or visibility', async () => {
    const order = createCompletedOrder();
    db.prepare(`INSERT INTO feedbacks(guild_id,order_code,customer_id,stars,content,product_name,is_visible,feedback_channel_id,feedback_message_id)
      VALUES (?,?,?,4,'Ý kiến gốc','Sản phẩm cũ 1 tháng',1,'feedback-channel','review-message')`)
      .run(guildId, order.order_code, customerId);
    const review = { id: 'review-message', author: { id: 'bot-user' }, edit: vi.fn() };
    const { channel } = createFakeDiscordChannel('feedback-channel', [review]);
    const guild = createFakeGuild(channel); guild.members = { fetch: vi.fn(async () => ({ id: customerId })) };
    const edited = updateOrderFieldsRaw(order.order_code, { product_name: 'Tên sản phẩm mới', quantity: 2 });
    const result = await syncOrderFeedbackMessages({ guild, order: edited });
    expect(result).toMatchObject({ synced: true, count: 1 });
    const feedback = db.prepare('SELECT * FROM feedbacks WHERE order_code=?').get(order.order_code);
    expect(feedback).toMatchObject({ stars: 4, content: 'Ý kiến gốc', is_visible: 1, product_name: 'Tên sản phẩm mới' });
    const payload = review.edit.mock.calls[0][0];
    expect(JSON.stringify(payload)).toContain('Tên sản phẩm mới'); expect(JSON.stringify(payload)).toContain('x2');
    expect(payload.allowedMentions).toEqual({ parse: [] }); expect(channel.send).not.toHaveBeenCalled();
    review.components = payload.components;
    expect(await inspectOrderFeedbackMessages({ guild, order: edited })).toEqual({ count: 1, verified: 1 });
  });

  it('supports an authorized sync-only command without changing price, expiry or fulfillment', async () => {
    const order = createCompletedOrder(); const { channel } = createFakeDiscordChannel(order.ticket_channel_id);
    const guild = createFakeGuild(channel);
    guild.members = { fetch: vi.fn(async () => ({ permissions: { has: () => true } })) };
    const interaction = {
      guild, guildId, user: { id: staffId }, deferReply: vi.fn(), editReply: vi.fn(),
      options: {
        getString: (name) => name === 'ma_don' ? order.order_code : null,
        getInteger: () => null, getBoolean: () => true,
      },
    };
    const before = getOrderByCode(order.order_code);
    await editOrderCommand(interaction);
    expect(interaction.editReply.mock.calls.at(-1)[0]).toContain('Đã đồng bộ đơn');
    const after = getOrderByCode(order.order_code);
    for (const field of ['status', 'payment_status', 'total_amount', 'amount_paid', 'expiry_at', 'completed_at']) expect(after[field]).toBe(before[field]);
    expect(channel.send).toHaveBeenCalledTimes(1);
    interaction.guildId = 'different-guild';
    await editOrderCommand(interaction);
    expect(interaction.editReply.mock.calls.at(-1)[0]).toContain('Không tìm thấy mã đơn');
    expect(channel.send).toHaveBeenCalledTimes(1);
    guild.members.fetch.mockResolvedValue({ permissions: { has: () => false }, roles: { cache: new Map() } });
    await editOrderCommand(interaction);
    expect(interaction.editReply.mock.calls.at(-1)[0]).toContain('Chỉ manager');
  });

  it('provides scoped inspection and explicit API recovery without economic mutations', async () => {
    const order = createCompletedOrder(); closeTicket(order.ticket_id, staffId);
    const { channel } = createFakeDiscordChannel(order.ticket_channel_id);
    const guild = createFakeGuild(channel); const dm = addFakeDm(guild);
    guild.channels.fetch.mockRejectedValue({ code: 10003 });
    guild.client.guilds = { cache: new Map([[guildId, guild]]) };
    const routes = [];
    registerAdminRoutes(Object.fromEntries(['get', 'post', 'put', 'delete'].map((method) => [method, (route, ...handlers) => routes.push({ method, route, handlers })])));
    const call = async (method) => {
      let body; let status = 200;
      const handler = routes.find((entry) => entry.method === method && entry.route === '/api/bot/admin/orders/:code/presentation').handlers.at(-1);
      const res = { status: (code) => { status = code; return res; }, json: (value) => { body = value; } };
      await handler({ params: { code: order.order_code }, app: { locals: { discordClient: guild.client } }, header: () => staffId }, res);
      return { status, body };
    };
    const previousGuildId = config.guildId; config.guildId = guildId;
    try {
      const before = await call('get');
      expect(before.body.data).toMatchObject({ ticket_status: 'CLOSED', ticket_channel_status: 'missing', update_dm_status: 'not_created' });
      expect(dm.channel.send).not.toHaveBeenCalled();
      const recovered = await call('post');
      expect(recovered.body.data).toMatchObject({ commerceUnchanged: true, completion: { synced: true, status: 'dm_updated' } });
      const after = await call('get');
      expect(after.body.data).toMatchObject({ update_dm_status: 'available', dm_matches_current_order: true });
      await call('post'); expect(dm.channel.send).toHaveBeenCalledTimes(1);
      config.guildId = 'other-guild'; expect((await call('post')).status).toBe(404);
      config.guildId = guildId;
      db.prepare("UPDATE orders SET status='CANCELLED' WHERE order_code=?").run(order.order_code);
      expect((await call('post')).status).toBe(409);
    } finally { config.guildId = previousGuildId; }
  });
});

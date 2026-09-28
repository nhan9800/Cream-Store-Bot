import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

let tempRoot;
let db;
let ticketService;
let feedbackService;
let orderService;
const previousEnv = {
  ENV_FILE: process.env.ENV_FILE,
  DATABASE_PATH: process.env.DATABASE_PATH,
};

function createTicket({ code, channelId, orderCode = null, status = 'OPEN', keepOpen = 0 }) {
  return Number(db.prepare(`
    INSERT INTO tickets (
      ticket_code, guild_id, channel_id, customer_id, opened_by_id,
      ticket_type, related_order_code, keep_open_requested, status, created_at
    ) VALUES (?, 'FEEDBACK_GUILD', ?, 'CUSTOMER', 'CUSTOMER', 'ORDER', ?, ?, ?, ?)
  `).run(code, channelId, orderCode, keepOpen, status, new Date().toISOString()).lastInsertRowid);
}

function createCompletedOrder({
  code,
  ticketId,
  channelId,
  feedbackSubmitted = true,
  customerId = 'CUSTOMER',
  guildId = 'FEEDBACK_GUILD',
  status = 'COMPLETED',
}) {
  const timestamp = new Date().toISOString();
  db.prepare(`
    INSERT INTO orders (
      order_code, guild_id, ticket_id, ticket_channel_id, customer_id,
      product_name, quantity, total_amount, amount_paid, payment_status, status,
      order_log_channel_id, created_by_id, completed_at, feedback_submitted_at,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      'Test Product', 1, 100000, 100000, 'PAID', 'COMPLETED',
      'ORDER_LOG', 'STAFF', ?, ?, ?, ?
    )
  `).run(code, guildId, ticketId, channelId, customerId, timestamp, feedbackSubmitted ? timestamp : null, timestamp, timestamp);
  if (status !== 'COMPLETED') {
    db.prepare('UPDATE orders SET status = ?, completed_at = NULL WHERE order_code = ?').run(status, code);
  }
}

beforeAll(async () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cenar-feedback-close-'));
  process.env.ENV_FILE = path.join(tempRoot, '.env.test');
  process.env.DATABASE_PATH = path.join(tempRoot, 'feedback-close.sqlite');
  const database = await import('../src/database/db.js');
  db = database.db;
  database.initDatabase();
  ticketService = await import('../src/services/ticketService.js');
  feedbackService = await import('../src/services/feedbackService.js');
  orderService = await import('../src/services/orderService.js');

  db.prepare(`
    INSERT INTO guild_settings (
      guild_id, ticket_category_id, order_log_channel_id,
      feedback_channel_id, manager_role_id, updated_at
    ) VALUES ('FEEDBACK_GUILD', 'TICKET_CATEGORY', 'ORDER_LOG', 'FEEDBACK_CHANNEL', 'MANAGER_ROLE', ?)
  `).run(new Date().toISOString());
});

afterAll(() => {
  if (db?.open) db.close();
  if (tempRoot?.startsWith(os.tmpdir())) fs.rmSync(tempRoot, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function createGuild({ staffMember, ticketChannelId = 'command-channel' }) {
  const feedbackChannelSends = [];
  const ticketChannelSends = [];
  const feedbackChannel = {
    id: 'FEEDBACK_CHANNEL',
    isTextBased: () => true,
    send: async (payload) => {
      feedbackChannelSends.push(payload);
      return { id: 'FEEDBACK_MESSAGE' };
    },
  };
  const ticketChannel = {
    id: ticketChannelId,
    isTextBased: () => true,
    send: async (content) => {
      ticketChannelSends.push(content);
      return { id: 'TICKET_MESSAGE' };
    },
  };
  const member = {
    id: 'CUSTOMER',
    roles: { cache: { has: () => false }, remove: async () => null },
  };
  const guild = {
    id: 'FEEDBACK_GUILD',
    channels: {
      fetch: async (id) => (id === 'FEEDBACK_CHANNEL' ? feedbackChannel : ticketChannel),
    },
    members: {
      fetch: async (id) => (id === 'CUSTOMER' ? member : staffMember),
    },
  };
  return { guild, feedbackChannelSends, ticketChannelSends };
}

function managerMember(allowed) {
  return {
    id: 'ADMIN',
    permissions: { has: () => allowed },
    roles: { cache: { has: (roleId) => roleId === 'MANAGER_ROLE' && allowed } },
  };
}

describe('feedback ticket auto-close scheduling', () => {
  test('schedules auto-close through the shared feedback service used by /feedback', async () => {
    const ticketId = createTicket({ code: 'TKT_COMMAND', channelId: 'command-channel', orderCode: 'CN_FEEDBACK_COMMAND' });
    createCompletedOrder({
      code: 'CN_FEEDBACK_COMMAND',
      ticketId,
      channelId: 'command-channel',
      feedbackSubmitted: false,
    });
    const feedbackChannel = {
      id: 'FEEDBACK_CHANNEL',
      isTextBased: () => true,
      send: async () => ({ id: 'FEEDBACK_MESSAGE' }),
    };
    const ticketChannel = {
      id: 'command-channel',
      isTextBased: () => true,
      send: async () => ({ id: 'TICKET_MESSAGE' }),
    };
    const member = {
      id: 'CUSTOMER',
      roles: {
        cache: { has: () => false },
        remove: async () => null,
      },
    };
    const guild = {
      id: 'FEEDBACK_GUILD',
      channels: {
        fetch: async (id) => (id === 'FEEDBACK_CHANNEL' ? feedbackChannel : ticketChannel),
      },
      members: { fetch: async () => member },
    };

    const result = await feedbackService.publishFeedback({
      guild,
      userId: 'CUSTOMER',
      orderCode: 'CN_FEEDBACK_COMMAND',
      stars: 5,
      content: 'Dịch vụ tốt',
    });

    expect(result.ticket.id).toBe(ticketId);
    expect(result.ticket.auto_close_at).toBeTruthy();
    expect(result.autoClose.scheduled).toBe(true);
    expect(result.order.feedback_submitted_at).toBeTruthy();
  });

  test('keeps a shared ticket open when another linked order is still processing', async () => {
    const ticketId = createTicket({ code: 'TKT_MULTI_ACTIVE', channelId: 'multi-active-channel' });
    createCompletedOrder({
      code: 'CN_MULTI_DONE',
      ticketId,
      channelId: 'multi-active-channel',
      feedbackSubmitted: false,
    });
    createCompletedOrder({
      code: 'CN_MULTI_PROCESSING',
      ticketId,
      channelId: 'multi-active-channel',
      feedbackSubmitted: false,
      status: 'PROCESSING',
    });
    const { guild, ticketChannelSends } = createGuild({
      staffMember: managerMember(false),
      ticketChannelId: 'multi-active-channel',
    });

    const result = await feedbackService.publishFeedback({
      guild,
      userId: 'CUSTOMER',
      orderCode: 'CN_MULTI_DONE',
      stars: 5,
      content: 'Đơn đầu tiên xử lý tốt',
    });

    expect(result.autoClose.scheduled).toBe(false);
    expect(result.autoClose.state.reason).toBe('linked_orders_pending');
    expect(result.autoClose.state.blockingOrders.map((order) => order.order_code))
      .toContain('CN_MULTI_PROCESSING');
    expect(ticketService.getTicketById(ticketId).auto_close_at).toBeNull();
    expect(ticketChannelSends.some((content) => content.includes('Ticket vẫn mở'))).toBe(true);
  });

  test('waits until every completed order in the ticket has its own feedback', () => {
    const ticketId = createTicket({ code: 'TKT_MULTI_FEEDBACK', channelId: 'multi-feedback-channel' });
    createCompletedOrder({
      code: 'CN_MULTI_REVIEWED',
      ticketId,
      channelId: 'multi-feedback-channel',
      feedbackSubmitted: true,
    });
    createCompletedOrder({
      code: 'CN_MULTI_UNREVIEWED',
      ticketId,
      channelId: 'multi-feedback-channel',
      feedbackSubmitted: false,
    });

    const firstOrder = db.prepare('SELECT * FROM orders WHERE order_code = ?').get('CN_MULTI_REVIEWED');
    const blocked = feedbackService.scheduleFeedbackTicketAutoClose(firstOrder);
    expect(blocked.scheduled).toBe(false);
    expect(blocked.state.blockingOrders.map((order) => order.order_code))
      .toContain('CN_MULTI_UNREVIEWED');

    db.prepare('UPDATE orders SET feedback_submitted_at = ? WHERE order_code = ?')
      .run(new Date().toISOString(), 'CN_MULTI_UNREVIEWED');
    const ready = feedbackService.scheduleFeedbackTicketAutoClose(firstOrder);
    expect(ready.scheduled).toBe(true);
    expect(ready.ticket.auto_close_at).toBeTruthy();
  });

  test('cancels an existing feedback close timer as soon as a new order is created in the ticket', () => {
    const ticketId = createTicket({ code: 'TKT_NEW_ORDER', channelId: 'new-order-channel' });
    createCompletedOrder({
      code: 'CN_NEW_ORDER_OLD',
      ticketId,
      channelId: 'new-order-channel',
      feedbackSubmitted: true,
    });
    const completed = db.prepare('SELECT * FROM orders WHERE order_code = ?').get('CN_NEW_ORDER_OLD');
    const scheduled = feedbackService.scheduleFeedbackTicketAutoClose(completed);
    expect(scheduled.scheduled).toBe(true);

    orderService.createOrder({
      guildId: 'FEEDBACK_GUILD',
      ticketId,
      ticketChannelId: 'new-order-channel',
      customerId: 'CUSTOMER',
      productName: 'Second Product',
      serviceType: 'other',
      quantity: 1,
      note: 'multi-order regression test',
      totalAmount: 120000,
      durationMonths: 1,
      orderLogChannelId: 'ORDER_LOG',
      createdById: 'STAFF',
      orderCode: 'CN_NEW_ORDER_NEXT',
    });

    const ticket = ticketService.getTicketById(ticketId);
    expect(ticket.auto_close_at).toBeNull();
    const state = ticketService.getFeedbackAutoCloseState(ticket);
    expect(state.eligible).toBe(false);
    expect(state.blockingOrders.map((order) => order.order_code)).toContain('CN_NEW_ORDER_NEXT');
  });

  test('resolves the live open ticket by order code when stored ticket references are stale', () => {
    const staleTicketId = createTicket({ code: 'TKT_STALE', channelId: 'deleted-channel', status: 'CLOSED' });
    const liveTicketId = createTicket({ code: 'TKT_LIVE', channelId: 'live-channel', orderCode: 'CN_FEEDBACK_1' });
    createCompletedOrder({ code: 'CN_FEEDBACK_1', ticketId: staleTicketId, channelId: 'deleted-channel' });

    const order = db.prepare('SELECT * FROM orders WHERE order_code = ?').get('CN_FEEDBACK_1');
    const scheduled = ticketService.scheduleOrderTicketAutoClose(order, 2);

    expect(scheduled.id).toBe(liveTicketId);
    expect(scheduled.status).toBe('OPEN');
    expect(scheduled.auto_close_at).toBeTruthy();
  });

  test('backfills feedbacked tickets missing a close schedule and respects Keep Open', () => {
    const repairId = createTicket({ code: 'TKT_REPAIR', channelId: 'repair-channel', orderCode: 'CN_FEEDBACK_2' });
    const keepOpenId = createTicket({ code: 'TKT_KEEP', channelId: 'keep-channel', orderCode: 'CN_FEEDBACK_3', keepOpen: 1 });
    const activeId = createTicket({ code: 'TKT_ACTIVE', channelId: 'active-channel' });
    createCompletedOrder({ code: 'CN_FEEDBACK_2', ticketId: repairId, channelId: 'repair-channel' });
    createCompletedOrder({ code: 'CN_FEEDBACK_3', ticketId: keepOpenId, channelId: 'keep-channel' });
    createCompletedOrder({ code: 'CN_ACTIVE_REVIEWED', ticketId: activeId, channelId: 'active-channel' });
    createCompletedOrder({
      code: 'CN_ACTIVE_PROCESSING',
      ticketId: activeId,
      channelId: 'active-channel',
      feedbackSubmitted: false,
      status: 'PROCESSING',
    });

    const repaired = ticketService.scheduleMissingFeedbackTicketAutoCloses('FEEDBACK_GUILD');
    const repairedRow = ticketService.getTicketById(repairId);
    const keptRow = ticketService.getTicketById(keepOpenId);
    const activeRow = ticketService.getTicketById(activeId);

    expect(repaired.map((ticket) => ticket.id)).toContain(repairId);
    expect(repaired.map((ticket) => ticket.id)).not.toContain(keepOpenId);
    expect(repaired.map((ticket) => ticket.id)).not.toContain(activeId);
    expect(repairedRow.auto_close_at).toBeTruthy();
    expect(keptRow.auto_close_at).toBeNull();
    expect(activeRow.auto_close_at).toBeNull();
  });

  test('admin with manager role can publish feedback on behalf of the customer', async () => {
    const ticketId = createTicket({ code: 'TKT_ONBEHALF', channelId: 'onbehalf-channel', orderCode: 'CN_ONBEHALF_OK' });
    createCompletedOrder({
      code: 'CN_ONBEHALF_OK',
      ticketId,
      channelId: 'onbehalf-channel',
      feedbackSubmitted: false,
    });
    const { guild, feedbackChannelSends, ticketChannelSends } = createGuild({ staffMember: managerMember(true), ticketChannelId: 'onbehalf-channel' });

    const result = await feedbackService.publishFeedback({
      guild,
      userId: 'CUSTOMER',
      orderCode: 'CN_ONBEHALF_OK',
      stars: 5,
      content: 'Khách khen dịch vụ tốt (admin ghi hộ)',
      actorId: 'ADMIN',
    });

    // Attribution vẫn thuộc về khách hàng
    expect(result.onBehalf).toBe(true);
    expect(result.actorId).toBe('ADMIN');
    expect(result.order.customer_id).toBe('CUSTOMER');
    expect(result.order.feedback_submitted_at).toBeTruthy();
    expect(result.ticket.id).toBe(ticketId);
    expect(result.ticket.auto_close_at).toBeTruthy();

    const feedbackRow = db.prepare('SELECT * FROM feedbacks WHERE order_code = ?').get('CN_ONBEHALF_OK');
    expect(feedbackRow.customer_id).toBe('CUSTOMER');
    expect(feedbackRow.stars).toBe(5);

    // Thông báo trong ticket ghi rõ admin ghi hộ khách
    expect(ticketChannelSends.some((content) => content.includes('ADMIN') && content.includes('CUSTOMER'))).toBe(true);
    expect(feedbackChannelSends.length).toBe(1);
  });

  test('rejects an actor without manager role who is not the order owner', async () => {
    const ticketId = createTicket({ code: 'TKT_NOTMGR', channelId: 'notmgr-channel', orderCode: 'CN_ONBEHALF_DENY' });
    createCompletedOrder({
      code: 'CN_ONBEHALF_DENY',
      ticketId,
      channelId: 'notmgr-channel',
      feedbackSubmitted: false,
    });
    const { guild } = createGuild({ staffMember: managerMember(false), ticketChannelId: 'notmgr-channel' });

    await expect(feedbackService.publishFeedback({
      guild,
      userId: 'CUSTOMER',
      orderCode: 'CN_ONBEHALF_DENY',
      stars: 4,
      content: 'không được phép',
      actorId: 'ADMIN',
    })).rejects.toThrow('Bạn không có quyền đánh giá hộ khách hàng.');

    // Không có feedback nào được ghi
    const feedbackRow = db.prepare('SELECT * FROM feedbacks WHERE order_code = ?').get('CN_ONBEHALF_DENY');
    expect(feedbackRow).toBeFalsy();
    const orderRow = db.prepare('SELECT feedback_submitted_at FROM orders WHERE order_code = ?').get('CN_ONBEHALF_DENY');
    expect(orderRow.feedback_submitted_at).toBeNull();
  });
});

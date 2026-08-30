import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

let tempRoot;
let db;
let ticketService;
let feedbackService;
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

function createCompletedOrder({ code, ticketId, channelId, feedbackSubmitted = true, customerId = 'CUSTOMER', guildId = 'FEEDBACK_GUILD' }) {
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
    expect(result.order.feedback_submitted_at).toBeTruthy();
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
    createCompletedOrder({ code: 'CN_FEEDBACK_2', ticketId: repairId, channelId: 'repair-channel' });
    createCompletedOrder({ code: 'CN_FEEDBACK_3', ticketId: keepOpenId, channelId: 'keep-channel' });

    const repaired = ticketService.scheduleMissingFeedbackTicketAutoCloses('FEEDBACK_GUILD');
    const repairedRow = ticketService.getTicketById(repairId);
    const keptRow = ticketService.getTicketById(keepOpenId);

    expect(repaired.map((ticket) => ticket.id)).toContain(repairId);
    expect(repaired.map((ticket) => ticket.id)).not.toContain(keepOpenId);
    expect(repairedRow.auto_close_at).toBeTruthy();
    expect(keptRow.auto_close_at).toBeNull();
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

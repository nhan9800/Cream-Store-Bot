import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { db, initDatabase } from '../src/database/db.js';
import {
  buildAdminOrderDetailPayload,
  finalizeAdminOrderAgingReminder,
  getAdminOrderAgeDays,
  releaseAdminOrderAgingReminder,
  reserveAdminOrderAgingReminder,
  selectAgingReminderStage,
} from '../src/services/adminOrderCenterService.js';
import { canOpenMultipleOrderTickets } from '../src/utils/permissions.js';
import { buildOrderCancelledCustomerV2 } from '../src/utils/embeds.js';

const previousDiscordClient = global.discordClient;

afterEach(() => {
  global.discordClient = previousDiscordClient;
});

function memberWithRoles(roleIds = []) {
  const roles = new Set(roleIds.map(String));
  return { roles: { cache: { has: (roleId) => roles.has(String(roleId)) } } };
}

describe('Store 1 CTV multi-ticket permission', () => {
  it('allows the configured CTV role only in Store 1', () => {
    const member = memberWithRoles(['1522844530242748446']);
    expect(canOpenMultipleOrderTickets(member, config.storeOneGuildId)).toBe(true);
    expect(canOpenMultipleOrderTickets(member, '1070676180103086132')).toBe(false);
  });

  it('keeps normal members on the single-open-ticket policy', () => {
    expect(canOpenMultipleOrderTickets(memberWithRoles([]), config.storeOneGuildId)).toBe(false);
  });
});

describe('admin order aging reminders', () => {
  const now = Date.parse('2026-08-13T12:00:00.000Z');

  it('selects the 7-day reminder for an active processing order', () => {
    const order = {
      status: 'PROCESSING',
      created_at: '2026-08-05T12:00:00.000Z',
      admin_age_reminder_1w_sent_at: null,
      admin_age_reminder_2w_sent_at: null,
    };
    expect(selectAgingReminderStage(order, now, { weekOneDays: 7, weekTwoDays: 14 })).toBe('week1');
  });

  it('sends only the stronger 14-day reminder on first scan of an old order', () => {
    const order = {
      status: 'WAITING_STAFF',
      created_at: '2026-07-20T12:00:00.000Z',
      admin_age_reminder_1w_sent_at: null,
      admin_age_reminder_2w_sent_at: null,
    };
    expect(selectAgingReminderStage(order, now, { weekOneDays: 7, weekTwoDays: 14 })).toBe('week2');
    order.admin_age_reminder_2w_sent_at = new Date(now).toISOString();
    expect(selectAgingReminderStage(order, now, { weekOneDays: 7, weekTwoDays: 14 })).toBeNull();
  });

  it('does not age pending-payment or completed orders', () => {
    for (const status of ['PENDING_PAYMENT', 'COMPLETED', 'CANCELLED']) {
      expect(selectAgingReminderStage({
        status,
        created_at: '2026-07-01T12:00:00.000Z',
      }, now, { weekOneDays: 7, weekTwoDays: 14 })).toBeNull();
    }
  });

  it('starts warranty aging from the time warranty opened, not the original purchase', () => {
    const warrantyOpenedAt = '2026-09-05T02:00:00.000Z';
    const order = {
      status: 'WARRANTY_OPEN',
      created_at: '2026-04-01T02:00:00.000Z',
      updated_at: warrantyOpenedAt,
      status_changed_at: warrantyOpenedAt,
      admin_age_reminder_1w_sent_at: null,
      admin_age_reminder_2w_sent_at: null,
    };

    expect(getAdminOrderAgeDays(order, Date.parse('2026-09-05T03:00:00.000Z'))).toBe(0);
    expect(selectAgingReminderStage(order, Date.parse('2026-09-05T03:00:00.000Z'), {
      weekOneDays: 7,
      weekTwoDays: 14,
    })).toBeNull();
    expect(selectAgingReminderStage(order, Date.parse('2026-09-13T02:00:00.000Z'), {
      weekOneDays: 7,
      weekTwoDays: 14,
    })).toBe('week1');
    expect(selectAgingReminderStage(order, Date.parse('2026-09-20T02:00:00.000Z'), {
      weekOneDays: 7,
      weekTwoDays: 14,
    })).toBe('week2');
  });

  it('ignores reminder markers from an older order or warranty lifecycle', () => {
    const order = {
      status: 'WARRANTY_OPEN',
      created_at: '2026-04-01T02:00:00.000Z',
      updated_at: '2026-09-05T02:00:00.000Z',
      status_changed_at: '2026-09-05T02:00:00.000Z',
      admin_age_reminder_1w_sent_at: '2026-05-01T02:00:00.000Z',
      admin_age_reminder_2w_sent_at: '2026-05-08T02:00:00.000Z',
    };

    expect(selectAgingReminderStage(order, Date.parse('2026-09-13T02:00:00.000Z'), {
      weekOneDays: 7,
      weekTwoDays: 14,
    })).toBe('week1');
  });

  it('keeps normal processing orders anchored to their original creation time', () => {
    const order = {
      status: 'PROCESSING',
      created_at: '2026-08-01T02:00:00.000Z',
      updated_at: '2026-09-05T02:00:00.000Z',
      status_changed_at: '2026-09-05T02:00:00.000Z',
      admin_age_reminder_1w_sent_at: null,
      admin_age_reminder_2w_sent_at: null,
    };

    expect(getAdminOrderAgeDays(order, Date.parse('2026-09-05T02:00:00.000Z'))).toBe(35);
    expect(selectAgingReminderStage(order, Date.parse('2026-09-05T02:00:00.000Z'), {
      weekOneDays: 7,
      weekTwoDays: 14,
    })).toBe('week2');
  });

  it('renders a compact reminder and never links an unverified or deleted ticket', () => {
    const createdAt = new Date(Date.now() - 24 * 86_400_000).toISOString();
    const order = {
      guild_id: config.storeOneGuildId,
      order_code: 'CN_781138',
      ticket_id: 603,
      ticket_channel_id: '1528673941718044704',
      customer_id: '869487483015012403',
      product_name: ':spotify2: spo12m',
      quantity: 1,
      note: null,
      total_amount: 300000,
      amount_paid: 300000,
      payment_provider: 'PAYOS',
      paid_transaction_id: 'P00005464632',
      payment_status: 'PAID',
      status: 'WARRANTY_OPEN',
      claimed_by_id: null,
      status_changed_at: createdAt,
      created_at: createdAt,
      updated_at: createdAt,
      credential_email: null,
      credential_password: null,
    };
    const payload = buildAdminOrderDetailPayload(order, {
      reminderStage: 'week2',
      customerIdentity: '**Đức Anh** · `@ducanh368` · ID `869487483015012403`',
    });
    const rendered = JSON.stringify(payload.components.map((component) => component.toJSON()));

    expect(rendered).toContain('Đã đóng / đã xóa');
    expect(rendered).not.toContain('discord.com/channels');
    expect(rendered).not.toContain('Cổng thanh toán');
    expect(rendered).not.toContain('Dữ liệu giao hàng');
    expect(rendered).toContain('Đức Anh');
    expect(rendered).not.toContain('<@869487483015012403>');
    expect(rendered.match(/24 NGÀY/g)).toHaveLength(1);
  });

  it('renders a newly opened warranty as zero days old even when the purchase is old', () => {
    const warrantyOpenedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const payload = buildAdminOrderDetailPayload({
      guild_id: config.storeOneGuildId,
      order_code: 'CR_615637',
      ticket_id: 3,
      ticket_channel_id: '1528673941718044704',
      customer_id: '869487483015012403',
      product_name: 'Discord Nitro',
      quantity: 1,
      total_amount: 115000,
      amount_paid: 115000,
      payment_provider: 'PAYOS',
      payment_status: 'PAID',
      status: 'WARRANTY_OPEN',
      claimed_by_id: null,
      status_changed_at: warrantyOpenedAt,
      created_at: '2026-04-01T02:00:00.000Z',
      updated_at: warrantyOpenedAt,
    }, { reminderStage: 'week1' });
    const rendered = JSON.stringify(payload.components.map((component) => component.toJSON()));

    expect(rendered).toContain('TỒN 0 NGÀY');
    expect(rendered).not.toContain('TỒN 157 NGÀY');
  });

  it('adds the open-ticket button only for a Discord channel verified by the resolver', () => {
    const order = {
      guild_id: config.storeOneGuildId,
      order_code: 'CN_123456',
      ticket_id: 10,
      ticket_channel_id: '111111111111111111',
      customer_id: '222222222222222222',
      product_name: 'Spotify Premium',
      quantity: 1,
      total_amount: 100000,
      amount_paid: 100000,
      payment_provider: 'PAYOS',
      payment_status: 'PAID',
      status: 'PROCESSING',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const payload = buildAdminOrderDetailPayload(order, {
      reminderStage: 'week1',
      ticketChannelId: '333333333333333333',
    });
    const rendered = JSON.stringify(payload.components.map((component) => component.toJSON()));

    expect(rendered).toContain('<#333333333333333333>');
    expect(rendered).toContain(`https://discord.com/channels/${config.storeOneGuildId}/333333333333333333`);
  });

  it('renders the live Claude emoji instead of exposing a legacy :claude: token', () => {
    const liveClaude = {
      id: '1535690552874639531',
      name: 'cenar_claude',
      animated: false,
    };
    global.discordClient = {
      guilds: {
        cache: new Map([[
          config.storeOneGuildId,
          { emojis: { cache: new Map([[liveClaude.id, liveClaude]]) } },
        ]]),
      },
      emojis: { cache: new Map([[liveClaude.id, liveClaude]]) },
    };

    const createdAt = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const payload = buildAdminOrderDetailPayload({
      guild_id: config.storeOneGuildId,
      order_code: 'CN_983047',
      ticket_id: 1,
      customer_id: '1273801433145147555',
      product_name: ':claude: apiclaude100m',
      quantity: 1,
      total_amount: 75000,
      amount_paid: 75000,
      payment_provider: 'PAYOS',
      payment_status: 'PAID',
      status: 'PROCESSING',
      claimed_by_id: null,
      created_at: createdAt,
      updated_at: createdAt,
    }, { reminderStage: 'week2' });
    const rendered = JSON.stringify(payload.components.map((component) => component.toJSON()));

    expect(rendered).toContain('<:cenar_claude:1535690552874639531> apiclaude100m');
    expect(rendered).not.toContain(':claude: apiclaude100m');
  });
});

describe('admin order aging reminder delivery guard', () => {
  const unique = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const guildId = `test_admin_aging_${unique}`;
  const orderCode = `TEST_ADMIN_AGING_${unique}`;
  const ticketChannelId = `8${String(Date.now()).padEnd(17, '7').slice(0, 17)}`;
  let orderId;

  beforeAll(() => {
    initDatabase();
    const ticket = db.prepare(`
      INSERT INTO tickets (
        ticket_code, guild_id, channel_id, customer_id, opened_by_id,
        ticket_type, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'WARRANTY', 'OPEN', ?)
    `).run(
      `TICKET_${unique}`,
      guildId,
      ticketChannelId,
      '123456789012345678',
      '234567890123456789',
      '2026-09-05T02:00:00.000Z',
    );
    const order = db.prepare(`
      INSERT INTO orders (
        order_code, guild_id, ticket_id, ticket_channel_id, customer_id,
        product_name, quantity, total_amount, amount_paid, payment_status,
        status, status_changed_at, order_log_channel_id, created_by_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, 115000, 115000, 'PAID',
        'WARRANTY_OPEN', ?, ?, ?, ?, ?)
    `).run(
      orderCode,
      guildId,
      Number(ticket.lastInsertRowid),
      ticketChannelId,
      '123456789012345678',
      'Discord Nitro',
      '2026-09-05T02:00:00.000Z',
      '345678901234567890',
      '234567890123456789',
      '2026-04-01T02:00:00.000Z',
      '2026-09-05T02:00:00.000Z',
    );
    orderId = Number(order.lastInsertRowid);
  });

  afterAll(() => {
    db.prepare('DELETE FROM admin_order_aging_reminders WHERE order_code = ?').run(orderCode);
    db.prepare('DELETE FROM orders WHERE order_code = ?').run(orderCode);
    db.prepare('DELETE FROM tickets WHERE channel_id = ?').run(ticketChannelId);
  });

  it('atomically prevents duplicate delivery and cancels a send if lifecycle changed', () => {
    const first = reserveAdminOrderAgingReminder(orderId, {
      stage: 'week1',
      nowMs: Date.parse('2026-09-13T02:00:00.000Z'),
      reservedAt: '2026-09-13T02:00:00.000Z',
    });
    expect(first).toBeTruthy();

    const duplicate = reserveAdminOrderAgingReminder(orderId, {
      stage: 'week1',
      nowMs: Date.parse('2026-09-13T02:00:00.000Z'),
      reservedAt: '2026-09-13T02:01:00.000Z',
    });
    expect(duplicate).toBeNull();

    db.prepare(`
      UPDATE orders SET status = 'COMPLETED', status_changed_at = ?, updated_at = ?
      WHERE id = ?
    `).run('2026-09-13T02:02:00.000Z', '2026-09-13T02:02:00.000Z', orderId);

    expect(finalizeAdminOrderAgingReminder(first.token, {
      messageId: '456789012345678901',
      channelId: '567890123456789012',
    })).toBeNull();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const ledger = db.prepare('SELECT * FROM admin_order_aging_reminders WHERE reservation_token = ?').get(first.token);
    expect(order.admin_age_reminder_1w_sent_at).toBeNull();
    expect(ledger.state).toBe('RESOLVED');
    expect(ledger.resolution_reason).toBe('LIFECYCLE_CHANGED_DURING_SEND');
  });

  it('releases failed sends for retry and finalizes exactly one successful card', () => {
    db.prepare(`
      UPDATE orders
      SET status = 'WARRANTY_OPEN', status_changed_at = ?, updated_at = ?,
          admin_age_reminder_1w_sent_at = NULL,
          admin_age_reminder_2w_sent_at = NULL
      WHERE id = ?
    `).run('2026-09-14T02:00:00.000Z', '2026-09-14T02:00:00.000Z', orderId);
    const nowMs = Date.parse('2026-09-22T02:00:00.000Z');
    const failed = reserveAdminOrderAgingReminder(orderId, {
      stage: 'week1',
      nowMs,
      reservedAt: '2026-09-22T02:00:00.000Z',
    });
    expect(failed).toBeTruthy();
    expect(releaseAdminOrderAgingReminder(failed.token)).toBe(true);

    const retry = reserveAdminOrderAgingReminder(orderId, {
      stage: 'week1',
      nowMs,
      reservedAt: '2026-09-22T02:01:00.000Z',
    });
    expect(retry).toBeTruthy();
    const finalized = finalizeAdminOrderAgingReminder(retry.token, {
      messageId: '678901234567890123',
      channelId: '567890123456789012',
    });
    expect(finalized).toBeTruthy();
    expect(finalizeAdminOrderAgingReminder(retry.token, {
      messageId: '789012345678901234',
      channelId: '567890123456789012',
    })).toBeNull();

    const sent = db.prepare(`
      SELECT COUNT(*) AS total FROM admin_order_aging_reminders
      WHERE order_code = ? AND lifecycle_key = ? AND stage = 'week1' AND state = 'SENT'
    `).get(orderCode, retry.lifecycleKey);
    expect(sent.total).toBe(1);
  });
});

describe('cancelled order customer notification', () => {
  it('uses a Components V2 cancellation card and includes the reason', () => {
    const payload = buildOrderCancelledCustomerV2({
      guild_id: config.storeOneGuildId,
      order_code: 'CN_123456',
      quantity: 1,
      product_name: 'YouTube Premium',
      total_amount: 100000,
      payment_status: 'CANCELLED',
    }, 'Quá hạn thanh toán');
    expect(payload.components).toHaveLength(1);
    expect(payload.flags).toBeTruthy();
    expect(JSON.stringify(payload.components[0].toJSON())).toContain('Quá hạn thanh toán');
  });
});

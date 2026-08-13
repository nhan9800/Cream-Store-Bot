import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { buildAdminOrderDetailPayload, selectAgingReminderStage } from '../src/services/adminOrderCenterService.js';
import { canOpenMultipleOrderTickets } from '../src/utils/permissions.js';
import { buildOrderCancelledCustomerV2 } from '../src/utils/embeds.js';

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
  });

  it('does not age pending-payment or completed orders', () => {
    for (const status of ['PENDING_PAYMENT', 'COMPLETED', 'CANCELLED']) {
      expect(selectAgingReminderStage({
        status,
        created_at: '2026-07-01T12:00:00.000Z',
      }, now, { weekOneDays: 7, weekTwoDays: 14 })).toBeNull();
    }
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

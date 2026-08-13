import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { selectAgingReminderStage } from '../src/services/adminOrderCenterService.js';
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

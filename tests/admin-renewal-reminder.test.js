import { describe, expect, test } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  buildAdminRenewalReminderV2,
  resolveAdminReminderStage,
  shouldSendAdminReminder,
} from '../src/services/adminRenewalReminderService.js';
import { STORE_ONE_GUILD_ID } from '../src/utils/locale.js';

const NATIVE_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;
const NOW = new Date('2026-08-12T06:00:00.000Z');

function subscription(overrides = {}) {
  return {
    id: 77,
    guild_id: STORE_ONE_GUILD_ID,
    service_type: 'netflix',
    renewal_mode: 'auto_cycle',
    gmail_email: 'customer@example.com',
    gmail_password: 'NEVER_SHOW_THIS_PASSWORD',
    customer_id: '123456789012345678',
    customer_discord_name: 'customer',
    related_order_code: 'CN_123456',
    purchase_date: '2026-07-12T06:00:00.000Z',
    total_duration_months: 6,
    renewal_cycle_months: 1,
    next_renewal_at: '2026-08-15T06:00:00.000Z',
    expiry_at: '2027-01-12T06:00:00.000Z',
    times_renewed: 0,
    status: 'ACTIVE',
    note: 'Kiểm tra nguồn trước khi gia hạn.',
    admin_reminder_stage: null,
    admin_reminder_sent_at: null,
    admin_claimed_by_id: null,
    admin_claimed_at: null,
    ...overrides,
  };
}

describe('Store 1 admin renewal reminder', () => {
  test('classifies the staged reminder windows', () => {
    expect(resolveAdminReminderStage(subscription({ next_renewal_at: '2026-08-18T06:00:00.000Z' }), NOW)).toBe('UPCOMING_7D');
    expect(resolveAdminReminderStage(subscription({ next_renewal_at: '2026-08-15T06:00:00.000Z' }), NOW)).toBe('UPCOMING_3D');
    expect(resolveAdminReminderStage(subscription({ next_renewal_at: '2026-08-13T06:00:00.000Z' }), NOW)).toBe('URGENT_1D');
    expect(resolveAdminReminderStage(subscription({ next_renewal_at: '2026-08-12T05:59:00.000Z' }), NOW)).toBe('DUE_NOW');
    expect(resolveAdminReminderStage(subscription({ next_renewal_at: '2026-08-11T05:59:00.000Z' }), NOW)).toBe('OVERDUE');
  });

  test('prevents duplicate pings but permits escalation and one overdue repeat per day', () => {
    expect(shouldSendAdminReminder(subscription(), 'UPCOMING_7D', NOW)).toBe(true);
    expect(shouldSendAdminReminder(subscription({
      admin_reminder_stage: 'UPCOMING_7D',
      admin_reminder_sent_at: '2026-08-12T05:00:00.000Z',
    }), 'UPCOMING_7D', NOW)).toBe(false);
    expect(shouldSendAdminReminder(subscription({ admin_reminder_stage: 'UPCOMING_7D' }), 'UPCOMING_3D', NOW)).toBe(true);
    expect(shouldSendAdminReminder(subscription({
      admin_reminder_stage: 'OVERDUE',
      admin_reminder_sent_at: '2026-08-11T05:59:00.000Z',
    }), 'OVERDUE', NOW)).toBe(true);
  });

  test('builds a secure Components V2 admin panel with only custom emoji', () => {
    const payload = buildAdminRenewalReminderV2(subscription(), {
      stage: 'UPCOMING_3D',
      mentionText: '<@&1282638119497109524> <@1138315103821889566>',
      roleIds: ['1282638119497109524'],
      userIds: ['1138315103821889566'],
    });
    const json = payload.components.map((component) => component.toJSON());
    const serialized = JSON.stringify(json);
    const buttons = json[1].components;

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(serialized).toContain('NHẮC ADMIN');
    expect(serialized).toContain('customer@example.com');
    expect(serialized).toContain('Đã ẩn an toàn');
    expect(serialized).not.toContain('NEVER_SHOW_THIS_PASSWORD');
    expect(serialized).not.toMatch(NATIVE_EMOJI);
    expect(buttons.map((button) => button.custom_id || button.url)).toEqual([
      'sub:admin:claim:77',
      'sub:admin:renew:77:0',
      'sub:admin:snooze:77',
      'https://cenarstore.xyz/admin/subscriptions',
    ]);
    expect(buttons.every((button) => button.emoji?.id)).toBe(true);
    expect(payload.allowedMentions).toEqual({
      parse: [],
      roles: ['1282638119497109524'],
      users: ['1138315103821889566'],
    });
  });
});

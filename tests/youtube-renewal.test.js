import { describe, expect, test } from 'vitest';
import {
  addYoutubeCalendarMonths,
  calculateYoutubeMembership,
  maskYoutubeGmail,
  resolveYoutubeReminderStage,
  shouldSendYoutubeReminder,
} from '../src/services/youtubeRenewalUtils.js';

const NOW = new Date('2026-08-20T06:00:00.000Z');

function membership(overrides = {}) {
  return {
    status: 'ACTIVE',
    total_months: 3,
    cycle_months: 1,
    paid_cycles: 1,
    source_cost_per_cycle: 40_000,
    sale_price: 185_000,
    next_source_payment_at: '2026-08-23T06:00:00.000Z',
    customer_expiry_at: '2026-10-20T06:00:00.000Z',
    reminder_days_before: 7,
    reminder_stage: null,
    reminder_for_payment_at: null,
    reminder_sent_at: null,
    snoozed_until: null,
    ...overrides,
  };
}

describe('YouTube renewal calculations', () => {
  test('keeps the calendar day when adding months and clamps month end safely', () => {
    expect(addYoutubeCalendarMonths('2028-01-31T12:00:00.000Z', 1)).toBe('2028-02-29T12:00:00.000Z');
    expect(addYoutubeCalendarMonths('2026-08-20T12:00:00.000Z', 0)).toBe('2026-08-20T12:00:00.000Z');
  });

  test('tracks what the customer bought separately from supplier payments', () => {
    const progress = calculateYoutubeMembership(membership(), NOW);
    expect(progress).toMatchObject({
      totalCycles: 3,
      paidCycles: 1,
      remainingCycles: 2,
      paidMonths: 1,
      remainingMonths: 2,
      expectedSourceCost: 120_000,
      sourceCostPaid: 40_000,
      remainingSourceCost: 80_000,
      expectedMargin: 65_000,
      paymentProgressPercent: 33,
      dueState: 'DUE_SOON',
    });
  });

  test('stops supplier reminders after every sold cycle is covered', () => {
    const complete = membership({ paid_cycles: 3, next_source_payment_at: null });
    expect(calculateYoutubeMembership(complete, NOW).dueState).toBe('FULLY_PAID');
    expect(resolveYoutubeReminderStage(complete, NOW)).toBeNull();
  });

  test('escalates reminders without repeating the same stage', () => {
    const current = membership({
      reminder_stage: 'DUE_3D',
      reminder_for_payment_at: '2026-08-23T06:00:00.000Z',
      reminder_sent_at: '2026-08-20T05:00:00.000Z',
    });
    expect(resolveYoutubeReminderStage(current, NOW)).toBe('DUE_3D');
    expect(shouldSendYoutubeReminder(current, 'DUE_3D', NOW)).toBe(false);
    expect(shouldSendYoutubeReminder(current, 'DUE_1D', NOW)).toBe(true);
  });

  test('masks customer Gmail in public admin reminder panels', () => {
    const masked = maskYoutubeGmail('student.account@gmail.com');
    expect(masked).toContain('@gmail.com');
    expect(masked).not.toContain('student.account');
  });
});

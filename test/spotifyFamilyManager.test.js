import { describe, expect, test } from 'vitest';
import {
  addCalendarMonths,
  calculateFamilyProgress,
  calculateMemberUsage,
  maskPaymentCard,
  resolveFamilyReminderStage,
  shouldSendFamilyReminder,
} from '../src/services/spotifyFamilyUtils.js';

describe('Spotify Family manager', () => {
  test('keeps the renewal day safe at the end of shorter months', () => {
    expect(addCalendarMonths('2026-01-31T12:00:00.000Z', 1)).toBe('2026-02-28T12:00:00.000Z');
    expect(addCalendarMonths('2028-01-31T12:00:00.000Z', 1)).toBe('2028-02-29T12:00:00.000Z');
  });

  test('calculates family cycle, remaining days and live slots', () => {
    const progress = calculateFamilyProgress({
      cycle_started_at: '2026-08-01T12:00:00.000Z',
      next_renewal_at: '2026-09-01T12:00:00.000Z',
      reminder_days_before: 7,
      total_slots: 6,
    }, 4, new Date('2026-08-20T12:00:00.000Z'));

    expect(progress.daysRemaining).toBe(12);
    expect(progress.slotsUsed).toBe(4);
    expect(progress.slotsAvailable).toBe(2);
    expect(progress.progressPercent).toBeGreaterThan(50);
    expect(progress.dueState).toBe('HEALTHY');
  });

  test('reports overdue families and member months used', () => {
    const progress = calculateFamilyProgress({
      cycle_started_at: '2026-07-01T00:00:00.000Z',
      next_renewal_at: '2026-08-01T00:00:00.000Z',
      total_slots: 6,
    }, 6, new Date('2026-08-03T00:00:00.000Z'));
    const member = calculateMemberUsage({
      joined_at: '2026-05-01T00:00:00.000Z',
      purchased_months: 6,
      member_expiry_at: '2026-11-01T00:00:00.000Z',
    }, new Date('2026-08-01T00:00:00.000Z'));

    expect(progress.dueState).toBe('OVERDUE');
    expect(progress.overdueDays).toBeGreaterThanOrEqual(2);
    expect(member.monthsUsed).toBeCloseTo(3, 1);
    expect(member.purchasedMonths).toBe(6);
  });

  test('masks payment cards and de-duplicates staged reminders', () => {
    expect(maskPaymentCard('4111 1111 1111 1234')).toBe('•••• 1234');
    const now = new Date('2026-08-20T00:00:00.000Z');
    const family = {
      status: 'ACTIVE',
      next_renewal_at: '2026-08-23T00:00:00.000Z',
      reminder_for_renewal_at: '2026-08-23T00:00:00.000Z',
      reminder_stage: 'DUE_3D',
      reminder_sent_at: '2026-08-20T00:00:00.000Z',
    };

    expect(resolveFamilyReminderStage(family, now)).toBe('DUE_3D');
    expect(shouldSendFamilyReminder(family, 'DUE_3D', now)).toBe(false);
    expect(shouldSendFamilyReminder({ ...family, reminder_stage: 'DUE_7D' }, 'DUE_3D', now)).toBe(true);
    expect(shouldSendFamilyReminder({ ...family, snoozed_until: '2026-08-21T00:00:00.000Z' }, 'DUE_3D', now)).toBe(false);
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, initDatabase } from '../src/database/db.js';
import {
  addSubscription,
  addSubscriptionMonths,
  applySubscriptionProgressRepairOnce,
  getSubscriptionHistory,
  getSubscriptionProgress,
  isSubscriptionRenewalDue,
  markAdminReminderSent,
  markDisconnected,
  markRenewed,
  migrateSubscriptionMonthlyCycles,
  reserveAdminReminderDispatch,
  setSubscriptionFulfilledMonths,
} from '../src/services/subscriptionService.js';

const GUILD_ID = `test_subscription_lifecycle_${Date.now()}`;
const originalEncryptionKey = process.env.ENCRYPTION_KEY;

function createSubscription({ months, cycle = months > 1 ? 1 : 0, mode = months > 1 ? 'auto_cycle' : 'one_time', suffix = months }) {
  return addSubscription({
    guildId: GUILD_ID,
    serviceType: 'youtube',
    renewalMode: mode,
    gmailEmail: `lifecycle-${suffix}@example.com`,
    gmailPassword: 'test-password',
    relatedOrderCode: `LIFECYCLE_${suffix}_${Date.now()}`,
    purchaseDate: '2026-01-31T10:30:00.000Z',
    totalDurationMonths: months,
    renewalCycleMonths: cycle,
    source: 'TEST',
  });
}

describe('subscription monthly lifecycle', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = originalEncryptionKey || 'test-subscription-lifecycle-encryption-key';
    initDatabase();
    db.prepare('DELETE FROM subscription_events WHERE guild_id = ?').run(GUILD_ID);
    db.prepare('DELETE FROM subscription_accounts WHERE guild_id = ?').run(GUILD_ID);
  });

  afterAll(() => {
    db.prepare('DELETE FROM subscription_events WHERE guild_id = ?').run(GUILD_ID);
    db.prepare('DELETE FROM subscription_accounts WHERE guild_id = ?').run(GUILD_ID);
    if (originalEncryptionKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEncryptionKey;
  });

  it('clamps end-of-month dates instead of skipping February', () => {
    expect(addSubscriptionMonths('2026-01-31T10:30:00.000Z', 1)).toBe('2026-02-28T10:30:00.000Z');
    expect(addSubscriptionMonths('2024-01-31T10:30:00.000Z', 1)).toBe('2024-02-29T10:30:00.000Z');
  });

  it('tracks a 12-month plan from 1/12 through final disconnect', () => {
    let sub = createSubscription({ months: 12, suffix: 'annual' });
    expect(getSubscriptionProgress(sub)).toMatchObject({
      fulfilledMonths: 1,
      totalMonths: 12,
      remainingMonths: 11,
      nextAction: 'RENEW',
      nextCycleNumber: 2,
    });
    expect(sub.next_renewal_at).toBe('2026-02-28T10:30:00.000Z');

    for (let index = 0; index < 10; index += 1) sub = markRenewed(sub.id, { source: 'TEST' });
    expect(getSubscriptionProgress(sub)).toMatchObject({ fulfilledMonths: 11, remainingMonths: 1, nextAction: 'RENEW' });

    sub = markRenewed(sub.id, { source: 'TEST' });
    expect(sub.status).toBe('ACTIVE');
    expect(sub.next_renewal_at).toBeNull();
    expect(getSubscriptionProgress(sub)).toMatchObject({ fulfilledMonths: 12, remainingMonths: 0, nextAction: 'DISCONNECT' });

    const duplicate = markRenewed(sub.id, { source: 'TEST' });
    expect(duplicate.alreadyFulfilled).toBe(true);
    expect(duplicate.times_renewed).toBe(11);

    sub = markDisconnected(sub.id, { source: 'TEST' });
    expect(sub.status).toBe('EXPIRED');
    const history = getSubscriptionHistory(sub.id, 50);
    expect(history.filter((event) => event.event_type === 'RENEWED')).toHaveLength(11);
    expect(history[0].event_type).toBe('DISCONNECTED');
  });

  it('uses disconnect as the next action for a one-month plan', () => {
    const sub = createSubscription({ months: 1, suffix: 'monthly' });
    expect(getSubscriptionProgress(sub)).toMatchObject({
      fulfilledMonths: 1,
      totalMonths: 1,
      remainingMonths: 0,
      nextAction: 'DISCONNECT',
    });
  });

  it('applies one renewal revision exactly once and rejects a stale repeated click', () => {
    const created = createSubscription({ months: 12, suffix: 'idempotent-click' });
    const renewed = markRenewed(created.id, {
      source: 'TEST',
      expectedTimesRenewed: 0,
    });
    expect(renewed.times_renewed).toBe(1);
    expect(renewed.admin_last_completed_for_at).toBe(created.next_renewal_at);
    expect(renewed.admin_reminder_for_at).toBeNull();
    expect(() => markRenewed(created.id, {
      source: 'TEST',
      expectedTimesRenewed: 0,
    })).toThrow(/xử lý/i);
    expect(getSubscriptionHistory(created.id).filter((event) => event.event_type === 'RENEWED')).toHaveLength(1);
  });

  it('reserves an admin reminder exactly once across concurrent scheduler scans', () => {
    const created = createSubscription({ months: 12, suffix: 'reminder-reservation' });
    const sentAt = '2026-01-25T10:30:00.000Z';
    const first = reserveAdminReminderDispatch(created.id, {
      stage: 'UPCOMING_7D',
      channelId: 'CHANNEL_1',
      expectedStage: null,
      expectedSentAt: null,
      expectedTimesRenewed: 0,
      expectedActionAt: created.next_renewal_at,
      sentAt,
    });
    const duplicate = reserveAdminReminderDispatch(created.id, {
      stage: 'UPCOMING_7D',
      channelId: 'CHANNEL_1',
      expectedStage: null,
      expectedSentAt: null,
      expectedTimesRenewed: 0,
      expectedActionAt: created.next_renewal_at,
      sentAt: '2026-01-25T10:30:01.000Z',
    });

    expect(first?.subscription.admin_reminder_stage).toBe('UPCOMING_7D');
    expect(duplicate).toBeNull();
    expect(markAdminReminderSent(created.id, {
      stage: 'UPCOMING_7D',
      messageId: 'MESSAGE_1',
      channelId: 'CHANNEL_1',
      reservedAt: sentAt,
      reminderForAt: created.next_renewal_at,
    })?.admin_reminder_message_id).toBe('MESSAGE_1');
  });

  it('rejects a stale scheduler reservation after the lifecycle already advanced', () => {
    const created = createSubscription({ months: 12, suffix: 'stale-scheduler' });
    markRenewed(created.id, {
      source: 'TEST',
      expectedTimesRenewed: 0,
      expectedActionAt: created.next_renewal_at,
      now: new Date('2026-02-28T10:30:00.000Z'),
    });

    expect(reserveAdminReminderDispatch(created.id, {
      stage: 'DUE_NOW',
      channelId: 'CHANNEL_1',
      expectedStage: null,
      expectedSentAt: null,
      expectedTimesRenewed: 0,
      expectedActionAt: created.next_renewal_at,
      sentAt: '2026-02-28T10:30:01.000Z',
    })).toBeNull();
  });

  it('invalidates an in-flight reminder when Admin completes the cycle', () => {
    const created = createSubscription({ months: 12, suffix: 'inflight-reminder' });
    const reservedAt = '2026-02-27T10:30:00.000Z';
    const reservation = reserveAdminReminderDispatch(created.id, {
      stage: 'URGENT_1D',
      channelId: 'CHANNEL_1',
      expectedStage: null,
      expectedSentAt: null,
      expectedTimesRenewed: 0,
      expectedActionAt: created.next_renewal_at,
      sentAt: reservedAt,
    });
    expect(reservation).not.toBeNull();

    markRenewed(created.id, {
      source: 'TEST',
      expectedTimesRenewed: 0,
      expectedActionAt: created.next_renewal_at,
      now: new Date('2026-02-28T10:30:00.000Z'),
    });

    expect(markAdminReminderSent(created.id, {
      stage: 'URGENT_1D',
      messageId: 'STALE_MESSAGE',
      channelId: 'CHANNEL_1',
      reservedAt,
      reminderForAt: created.next_renewal_at,
    })).toBeNull();
  });

  it('pauses automatic reminders when the next calculated cycle would alert immediately again', () => {
    const created = createSubscription({ months: 12, suffix: 'overdue-backlog' });
    const renewed = markRenewed(created.id, {
      source: 'TEST',
      expectedTimesRenewed: 0,
      expectedActionAt: created.next_renewal_at,
      reminderWindowDays: 7,
      now: new Date('2026-05-01T10:30:00.000Z'),
    });

    expect(renewed.progress_status).toBe('NEEDS_REVIEW');
    expect(renewed.progress_review_note).toMatch(/tránh spam/i);
    expect(isSubscriptionRenewalDue(renewed, 7, new Date('2026-05-01T10:31:00.000Z'))).toBe(false);
  });

  it('only opens renewal actions inside the configured due window', () => {
    const created = createSubscription({ months: 12, suffix: 'due-window' });
    expect(isSubscriptionRenewalDue(created, 7, new Date('2026-02-20T10:30:00.000Z'))).toBe(false);
    expect(isSubscriptionRenewalDue(created, 7, new Date('2026-02-21T10:30:00.000Z'))).toBe(true);
  });

  it('lets Admin safely restore a historical plan to 5/12 months', () => {
    const sub = createSubscription({ months: 12, suffix: 'restore' });
    const updated = setSubscriptionFulfilledMonths(sub.id, 5, { source: 'TEST', note: 'Đối soát Gmail cũ.' });
    expect(updated.times_renewed).toBe(4);
    expect(updated.next_renewal_at).toBe('2026-06-30T10:30:00.000Z');
    expect(getSubscriptionProgress(updated)).toMatchObject({ fulfilledMonths: 5, remainingMonths: 7, nextCycleNumber: 6 });
    expect(getSubscriptionHistory(updated.id)[0]).toMatchObject({ event_type: 'PROGRESS_ADJUSTED', fulfilled_months: 5 });
  });

  it('applies an owner-confirmed progress repair once and restores the next cycle', () => {
    const sub = createSubscription({ months: 12, suffix: 'owner-repair' });
    db.prepare(`
      UPDATE subscription_accounts
      SET times_renewed = 3,
          next_renewal_at = '2026-02-28T10:30:00.000Z',
          admin_reminder_stage = 'OVERDUE',
          admin_reminder_sent_at = '2026-09-03T08:00:00.000Z',
          admin_reminder_message_id = 'BAD_MESSAGE',
          admin_reminder_channel_id = 'REMINDER_CHANNEL'
      WHERE id = ?
    `).run(sub.id);

    const migrationId = `restore-${GUILD_ID}`;
    const repaired = applySubscriptionProgressRepairOnce({
      migrationId,
      orderCode: sub.related_order_code,
      fulfilledMonths: 3,
      note: 'Owner confirmed 3/12.',
    });
    const repeated = applySubscriptionProgressRepairOnce({
      migrationId,
      orderCode: sub.related_order_code,
      fulfilledMonths: 3,
    });

    expect(repaired).toMatchObject({
      changed: true,
      previousFulfilledMonths: 4,
      fulfilledMonths: 3,
      nextRenewalAt: '2026-04-30T10:30:00.000Z',
      staleReminder: {
        channelId: 'REMINDER_CHANNEL',
        messageId: 'BAD_MESSAGE',
      },
    });
    expect(getSubscriptionProgress(db.prepare('SELECT * FROM subscription_accounts WHERE id = ?').get(sub.id)))
      .toMatchObject({ fulfilledMonths: 3, nextCycleNumber: 4 });
    expect(repeated).toMatchObject({ skipped: true, reason: 'already_applied' });
  });

  it('migrates an old two-month cycle without losing fulfilled months', () => {
    const created = createSubscription({ months: 6, cycle: 2, mode: 'auto_cycle', suffix: 'old-cycle' });
    db.prepare(`
      UPDATE subscription_accounts
      SET renewal_cycle_months = 2, times_renewed = 0, next_renewal_at = '2026-03-31T10:30:00.000Z'
      WHERE id = ?
    `).run(created.id);
    const old = db.prepare('SELECT * FROM subscription_accounts WHERE id = ?').get(created.id);
    expect(getSubscriptionProgress(old).fulfilledMonths).toBe(2);
    migrateSubscriptionMonthlyCycles({ guildId: GUILD_ID });
    const migrated = db.prepare('SELECT * FROM subscription_accounts WHERE id = ?').get(old.id);
    expect(migrated.renewal_cycle_months).toBe(1);
    expect(migrated.times_renewed).toBe(1);
    expect(getSubscriptionProgress(migrated).fulfilledMonths).toBe(2);
    expect(migrated.next_renewal_at).toBe('2026-03-31T10:30:00.000Z');
  });
});

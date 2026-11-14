import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(process.env, {
  ENV_FILE: '.env.renewal-date-consistency-test-absent',
  DATABASE_PATH: `./data/test-renewal-date-consistency-${process.pid}-${Date.now()}.sqlite`,
  ENCRYPTION_KEY: 'synthetic-renewal-date-consistency-key',
}));

import { db, initDatabase } from '../src/database/db.js';
import {
  createYoutubeMembership, createYoutubeSource, updateYoutubeMembership,
} from '../src/services/youtubeRenewalService.js';

const guildId = 'test-renewal-date-consistency';
let source;

beforeAll(() => {
  initDatabase();
  source = createYoutubeSource({ guildId, name: 'Synthetic calendar source', defaultCycleCost: 30000 });
});
afterAll(() => {
  const file = db.name;
  db.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
});

function membership(overrides = {}) {
  return createYoutubeMembership({
    guildId, sourceId: source.id, customerGmail: 'calendar-fixture@example.com',
    totalMonths: 4, cycleMonths: 1, paidCycles: 1,
    startedAt: '2026-01-31T10:00:00.000Z', ...overrides,
  });
}

describe('YouTube renewal schedule and coverage consistency', () => {
  it('recomputes implicit due and expiry dates when an operator corrects the start date', () => {
    const created = membership();
    const updated = updateYoutubeMembership(created.id, { startedAt: '2026-02-15T10:00:00.000Z' });
    expect(updated.nextSourcePaymentAt).toBe('2026-03-15T10:00:00.000Z');
    expect(updated.customerExpiryAt).toBe('2026-06-15T10:00:00.000Z');
    expect(updated).toMatchObject({ totalMonths: 4, paidCycles: 1, remainingMonths: 3 });
  });

  it('recomputes an implicit customer expiry when total months changes while keeping an explicit due override', () => {
    const created = membership();
    const updated = updateYoutubeMembership(created.id, {
      totalMonths: 6, nextSourcePaymentAt: '2026-03-02T10:00:00.000Z',
    });
    expect(updated.customerExpiryAt).toBe('2026-07-31T10:00:00.000Z');
    expect(updated.nextSourcePaymentAt).toBe('2026-03-02T10:00:00.000Z');
  });

  it('preserves explicit calendar overrides and preserves dates on a metadata-only edit', () => {
    const created = membership();
    const explicit = updateYoutubeMembership(created.id, {
      startedAt: '2026-02-15T10:00:00.000Z',
      nextSourcePaymentAt: '2026-03-17T10:00:00.000Z',
      customerExpiryAt: '2026-06-20T10:00:00.000Z',
    });
    const metadata = updateYoutubeMembership(created.id, { note: 'Synthetic note only' });
    expect(metadata.nextSourcePaymentAt).toBe(explicit.nextSourcePaymentAt);
    expect(metadata.customerExpiryAt).toBe(explicit.customerExpiryAt);
  });

  it('records only the remaining sold month when a partial final cycle is corrected as paid', () => {
    const created = membership({ totalMonths: 3, cycleMonths: 2 });
    const updated = updateYoutubeMembership(created.id, { paidCycles: 2, actorId: 'synthetic-operator' });
    expect(updated).toMatchObject({ paidMonths: 3, remainingMonths: 0, remainingCycles: 0, nextSourcePaymentAt: null });
    expect(updated.history.find(event => event.eventType === 'ADJUSTMENT')).toMatchObject({
      cyclesAdded: 1, monthsAdded: 1, amountPaid: 0,
    });
  });

  it('records the actual reduction in covered months when undoing a partial final cycle', () => {
    const created = membership({ totalMonths: 3, cycleMonths: 2, paidCycles: 2 });
    const updated = updateYoutubeMembership(created.id, { paidCycles: 1, actorId: 'synthetic-operator' });
    expect(updated).toMatchObject({ paidMonths: 2, remainingMonths: 1, remainingCycles: 1 });
    expect(updated.history.find(event => event.eventType === 'ADJUSTMENT')).toMatchObject({
      cyclesAdded: -1, monthsAdded: -1, amountPaid: 0,
    });
  });
});

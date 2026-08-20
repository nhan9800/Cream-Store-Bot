import { describe, expect, test } from 'vitest';
import { addOrderDuration, formatOrderDuration, normalizeOrderDurationStorage, resolveOrderDuration } from '../src/utils/formatters.js';
import { resolveWarrantyTimeline } from '../src/services/warrantyService.js';
import { data as orderCommand } from '../src/commands/order.js';
import { data as legacyOrderCommand } from '../src/commands/oder.js';

describe('order duration by days', () => {
  test('prefers an explicit day duration over legacy month data', () => {
    const order = { duration_days: 7, duration_months: 0 };
    expect(resolveOrderDuration(order)).toEqual({ unit: 'day', value: 7 });
    expect(formatOrderDuration(order)).toBe('7 ngày');
  });

  test('adds exact calendar days when calculating expiry', () => {
    const expiry = addOrderDuration('2026-08-15T03:00:00.000Z', {
      duration_days: 7,
      duration_months: 0,
    });
    expect(expiry?.toISOString()).toBe('2026-08-22T03:00:00.000Z');
  });

  test('uses day duration in the warranty timeline', () => {
    const timeline = resolveWarrantyTimeline({
      delivered_at: '2026-08-15T03:00:00.000Z',
      duration_days: 7,
      duration_months: 0,
    });
    expect(timeline.dateExpired).toContain(`<t:${Date.UTC(2026, 7, 22, 3) / 1000}:D>`);
  });

  test('keeps legacy month orders unchanged', () => {
    expect(formatOrderDuration({ duration_months: 3 })).toBe('3 tháng');
  });

  test('represents permanent orders without generating a fake expiry date', () => {
    const order = { duration_months: 0, duration_days: null };
    expect(normalizeOrderDurationStorage({ durationMonths: 0, durationDays: null })).toEqual({ durationMonths: 0, durationDays: null });
    expect(resolveOrderDuration(order)).toEqual({ unit: 'permanent', value: 0 });
    expect(formatOrderDuration(order)).toBe('Vĩnh viễn');
    expect(addOrderDuration('2026-08-20T03:00:00.000Z', order)).toBeNull();
    expect(resolveWarrantyTimeline(order).dateExpired).toBe('Vĩnh viễn');
  });

  test.each([
    ['/order', orderCommand],
    ['/oder', legacyOrderCommand],
  ])('%s exposes month, day and permanent duration options', (_name, command) => {
    const optionNames = command.toJSON().options.map((option) => option.name);
    expect(optionNames).toContain('so_thang');
    expect(optionNames).toContain('so_ngay');
    expect(optionNames).toContain('thoi_han');
    const permanentOption = command.toJSON().options.find((option) => option.name === 'thoi_han');
    expect(permanentOption.choices).toContainEqual({ name: 'Vĩnh viễn', value: 'permanent' });
  });
});

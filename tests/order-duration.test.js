import { describe, expect, test } from 'vitest';
import { addOrderDuration, formatOrderDuration, resolveOrderDuration } from '../src/utils/formatters.js';
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

  test.each([
    ['/order', orderCommand],
    ['/oder', legacyOrderCommand],
  ])('%s exposes both month and day duration options', (_name, command) => {
    const optionNames = command.toJSON().options.map((option) => option.name);
    expect(optionNames).toContain('so_thang');
    expect(optionNames).toContain('so_ngay');
  });
});

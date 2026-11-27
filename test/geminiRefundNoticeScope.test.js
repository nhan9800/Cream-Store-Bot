import { describe, expect, it } from 'vitest';
import { isGemini18MonthRefundNotice as eligible } from '../src/config/geminiRefundNoticeScope.js';
const row = { active: true, productName: 'Gemini', durationMonths: 18, durationDays: null, refundFromStatus: 'WARRANTY_OPEN' };
describe('Gemini 18-month announcement scope', () => {
  it('accepts recorded 18-month warranty plans even with a generic product name', () => {
    expect(eligible(row)).toBe(true);
    expect(eligible({ ...row, refundFromStatus: 'WARRANTY' })).toBe(true);
  });
  it.each([6,12,24,null,undefined])('rejects every other or unknown recorded duration (%s)', durationMonths => {
    expect(eligible({ ...row, durationMonths, productName: 'Gemini 18 tháng' })).toBe(false);
  });
  it('rejects another product, contradictory duration, inactive case and non-warranty origin', () => {
    for (const patch of [{ productName: 'Nitro' }, { durationDays: 30 }, { active: false }, { refundFromStatus: 'COMPLETED' }])
      expect(eligible({ ...row, ...patch })).toBe(false);
  });
});

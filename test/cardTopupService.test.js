import { describe, expect, it } from 'vitest';
import {
  CARD_TOPUP_PROFIT_MARGIN_PERCENT,
  buildCardTopupCatalog,
  calculateCardTopupCredit,
  normalizeCardTopupProfitMargin,
} from '../src/services/cardSwapService.js';

describe('card top-up pricing', () => {
  it('calculates wallet credit from the quoted dynamic fee', () => {
    expect(CARD_TOPUP_PROFIT_MARGIN_PERCENT).toBe(3);
    expect(calculateCardTopupCredit(10_000, 11)).toBe(8_900);
    expect(calculateCardTopupCredit(100_000, 12.5)).toBe(87_500);
  });

  it('keeps the Cenar margin between two and three percent', () => {
    expect(normalizeCardTopupProfitMargin(2)).toBe(2);
    expect(normalizeCardTopupProfitMargin(2.5)).toBe(2.5);
    expect(normalizeCardTopupProfitMargin(5)).toBe(3);
    expect(normalizeCardTopupProfitMargin('invalid')).toBe(3);
  });

  it('builds a sanitized catalog without unsupported providers or duplicate values', () => {
    const catalog = buildCardTopupCatalog([
      { telco: 'VIETTEL', value: '10000', fees: '8' },
      { telco: 'VIETTEL', value: '10000', fees: '9' },
      { telco: 'VIETTEL', value: '50000', fees: '7' },
      { telco: 'UNKNOWN', value: '100000', fees: '1' },
    ]);

    expect(catalog.profit_margin_percent).toBe(3);
    expect(catalog.fee_percent_min).toBe(10);
    expect(catalog.fee_percent_max).toBe(12);
    expect(catalog.telcos).toEqual([
      {
        code: 'VIETTEL',
        label: 'Viettel',
        denominations: [
          {
            value: 10_000,
            provider_fee_percent: 9,
            profit_margin_percent: 3,
            fee_percent: 12,
            received_amount: 8_800,
          },
          {
            value: 50_000,
            provider_fee_percent: 7,
            profit_margin_percent: 3,
            fee_percent: 10,
            received_amount: 45_000,
          },
        ],
      },
    ]);
  });

  it('applies a configured two percent margin to every provider quote', () => {
    const catalog = buildCardTopupCatalog([
      { telco: 'MOBIFONE', value: 100_000, fees: '11,5%' },
    ], 2);

    expect(catalog.telcos[0].denominations[0]).toEqual({
      value: 100_000,
      provider_fee_percent: 11.5,
      profit_margin_percent: 2,
      fee_percent: 13.5,
      received_amount: 86_500,
    });
  });
});

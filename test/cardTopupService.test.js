import { describe, expect, it } from 'vitest';
import {
  CARD_TOPUP_FEE_PERCENT,
  buildCardTopupCatalog,
  calculateCardTopupCredit,
} from '../src/services/cardSwapService.js';

describe('card top-up pricing', () => {
  it('locks wallet credit to 80 percent of the valid card value', () => {
    expect(CARD_TOPUP_FEE_PERCENT).toBe(20);
    expect(calculateCardTopupCredit(10_000)).toBe(8_000);
    expect(calculateCardTopupCredit(100_000)).toBe(80_000);
    expect(calculateCardTopupCredit(500_000)).toBe(400_000);
  });

  it('builds a sanitized catalog without unsupported providers or duplicate values', () => {
    const catalog = buildCardTopupCatalog([
      { telco: 'VIETTEL', value: '10000', fees: '8' },
      { telco: 'VIETTEL', value: '10000', fees: '9' },
      { telco: 'VIETTEL', value: '50000', fees: '7' },
      { telco: 'UNKNOWN', value: '100000', fees: '1' },
    ]);

    expect(catalog.fee_percent).toBe(20);
    expect(catalog.telcos).toEqual([
      {
        code: 'VIETTEL',
        label: 'Viettel',
        denominations: [
          { value: 10_000, received_amount: 8_000 },
          { value: 50_000, received_amount: 40_000 },
        ],
      },
    ]);
  });
});

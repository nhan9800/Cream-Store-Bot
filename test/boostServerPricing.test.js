import { describe, expect, it } from 'vitest';
import { BOOST_PACKAGES } from '../src/services/boostServerService.js';

describe('Boost Server official pricing', () => {
  it('uses the official 120k and 320k prices in the purchase flow', () => {
    expect(BOOST_PACKAGES).toEqual([
      { key: '1m', label: '14x Boost Server · 1 Tháng', price: 120000, months: 1, availability: 'Có liền' },
      { key: '3m', label: '14x Boost Server · 3 Tháng', price: 320000, months: 3, availability: 'Có liền' },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { BOOST_PACKAGES } from '../src/services/boostServerService.js';

describe('Boost Server official pricing', () => {
  it('uses the updated 120k and 290k prices in the purchase flow', () => {
    expect(BOOST_PACKAGES).toEqual([
      { key: '1m', label: 'Gói 1 Tháng (14 Boosts)', price: 120000, months: 1 },
      { key: '3m', label: 'Gói 3 Tháng (14 Boosts)', price: 290000, months: 3 },
    ]);
  });
});

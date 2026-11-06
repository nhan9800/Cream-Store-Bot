import { describe, expect, it } from 'vitest';
import { BOOST_PACKAGES } from '../src/services/boostServerService.js';

describe('Boost Server official pricing', () => {
  it('retains only the three-month package with the initial 320k price', () => {
    expect(BOOST_PACKAGES).toEqual([
      { key: '3m', label: '14x Boost Server · 3 Tháng', price: 320000, months: 3, availability: 'Có liền' },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  extractRequestedDuration,
  extractRequestedQuantity,
  isContextualPurchaseConfirmation,
  rankCatalogProducts,
} from '../src/services/aiCommerceUnderstandingService.js';

const products = [
  {
    id: 1,
    name: 'YouTube Premium 1 Tháng',
    description: 'Gói YouTube cá nhân',
    service_type: 'STREAMING',
    duration_months: 1,
    duration_days: null,
    price: 60_000,
    is_active: 1,
    is_featured: 1,
    sort_order: 1,
  },
  {
    id: 2,
    name: 'YouTube Premium 3 Tháng',
    description: 'Gói YouTube cá nhân dài hạn',
    service_type: 'STREAMING',
    duration_months: 3,
    duration_days: null,
    price: 150_000,
    is_active: 1,
    is_featured: 1,
    sort_order: 2,
  },
  {
    id: 3,
    name: 'Netflix Premium 1 Tháng',
    description: 'Gói Netflix',
    service_type: 'STREAMING',
    duration_months: 1,
    duration_days: null,
    price: 90_000,
    is_active: 1,
    is_featured: 1,
    sort_order: 3,
  },
];

describe('AI commerce understanding', () => {
  it('carries product, duration and quantity across a natural multi-turn confirmation', () => {
    const result = rankCatalogProducts(products, {
      content: 'Ok lấy gói này nhé',
      contextMessages: ['Mình cần YouTube 3 tháng số lượng 2', 'Giá ra sao shop?'],
    });

    expect(result.usedContext).toBe(true);
    expect(result.hasProductSignal).toBe(true);
    expect(result.quantity).toBe(2);
    expect(result.requestedDuration).toEqual({ days: null, months: 3 });
    expect(result.confidentProduct?.id).toBe(2);
  });

  it('keeps close catalog variants ambiguous so the customer must choose', () => {
    const variants = [
      products[1],
      { ...products[1], id: 4, name: 'YouTube Premium 3 Tháng Gia Đình', price: 180_000, sort_order: 4 },
    ];
    const result = rankCatalogProducts(variants, { content: 'Mình muốn mua YouTube 3 tháng' });

    expect(result.products.map((product) => product.id)).toEqual([2, 4]);
    expect(result.confidentProduct).toBeNull();
  });

  it('extracts quantities and Vietnamese durations without letting values exceed the order limit', () => {
    expect(extractRequestedQuantity('Cho mình 3 gói Spotify 6 tháng')).toBe(3);
    expect(extractRequestedQuantity('sl 99')).toBe(10);
    expect(extractRequestedDuration('CapCut 7 ngày')).toEqual({ days: 7, months: null });
    expect(extractRequestedDuration('Office 1 năm')).toEqual({ days: null, months: 12 });
  });

  it('does not invent a product when a contextual confirmation has no usable history', () => {
    const result = rankCatalogProducts(products, { content: 'Ok chốt luôn nhé', contextMessages: [] });
    expect(isContextualPurchaseConfirmation('Ok chốt luôn nhé')).toBe(true);
    expect(result.hasProductSignal).toBe(false);
    expect(result.products).toEqual([]);
    expect(result.confidentProduct).toBeNull();
  });
});

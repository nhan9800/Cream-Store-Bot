import { describe, expect, it } from 'vitest';
import { aiProductDuration, aiProductSubscriptionDuration } from '../src/utils/aiProductFacts.js';
import { extractRequestedDuration, rankCatalogProducts } from '../src/services/aiCommerceUnderstandingService.js';

// Matches the live CapCut SKU's legacy duration shape; catalog is not mutated.
const week = {
  id: 154, name: 'CapCut Pro 7 Ngày (2 Thiết Bị - Cấp Acc)',
  duration_months: 1, duration_days: null, service_type: 'AI', price: 20000, is_active: 1,
};
const month = { ...week, id: 153, name: 'CapCut Pro 1 Tháng (2 Thiết Bị - Cấp Acc)', price: 100000 };

describe('legacy day-plan facts', () => {
  it('uses the primary seven-day SKU duration consistently without changing the source row', () => {
    const before = { ...week };
    expect(aiProductSubscriptionDuration(week)).toEqual({ days: 7, months: null });
    expect(aiProductDuration(week)).toBe('7 ngày');
    const result = rankCatalogProducts([week, month], { content: 'Mua CapCut 7 ngày' });
    expect(result.confidentProduct?.id).toBe(154);
    expect(result.requestedDurationAvailable).toBe(true);
    expect(week).toEqual(before);
  });

  it('keeps a seven-day offer out of monthly recommendations and preserves comparisons', () => {
    expect(rankCatalogProducts([week, month], { content: 'CapCut 1 tháng' }).products.map(p => p.id)).toEqual([153]);
    const comparison = rankCatalogProducts([week, month], { content: 'CapCut 7 ngày hay 1 tháng?' });
    expect(comparison.products.map(p => p.id).sort()).toEqual([153, 154]);
    expect(comparison.confidentProduct).toBeNull();
  });

  it.each([
    'ChatGPT 1 Tháng (BH 2 Ngày)',
    'ChatGPT 1 Tháng · Bảo hành 2 ngày',
    'ChatGPT BH 2 Ngày',
    'Gemini Pro Tặng YouTube 7 Ngày',
    'Gemini Pro + YouTube 7 Ngày',
    'Nitro 2 Tháng Login Giữ Mail 7 Ngày',
    'CapCut Pro (Giao Hàng 7 Ngày)',
    'CapCut Pro Giao Hàng 7 Ngày',
    'CapCut Pro Giao Trong 7 Ngày',
    'CapCut Pro Kích Hoạt 7 Ngày',
    'CapCut Pro 1-3 Ngày',
    'CapCut Pro 1 đến 3 Ngày',
  ])('does not infer a subscription day count from %s', (name) => {
    expect(aiProductSubscriptionDuration({ ...month, name }).days).toBeNull();
  });

  it('prefers explicit day metadata and excludes project hosting or description bonuses', () => {
    expect(aiProductSubscriptionDuration({ ...week, duration_days: 14 })).toEqual({ days: 14, months: null });
    expect(aiProductSubscriptionDuration({ ...month, description: 'Bảo hành 7 ngày' })).toEqual({ days: null, months: 1 });
    expect(aiProductSubscriptionDuration({ ...week, name: 'Setup Bot Hosting 7 Ngày', service_type: 'SERVICE' }).days).toBeNull();
    expect(aiProductDuration({ ...week, name: 'Setup Bot Hosting 7 Ngày', service_type: 'SERVICE' })).toBe('Theo phạm vi dự án');
  });

  it('excludes mail retention conditions when the customer quotes the exact Nitro SKU', () => {
    const nitro = { ...month, id: 117, name: 'Discord Nitro Boost 2 Tháng (Login · Giữ Mail 7 Ngày)', duration_months: 2 };
    const content = `Chốt ${nitro.name}`;
    expect(extractRequestedDuration(content)).toEqual({ days: null, months: 2 });
    const result = rankCatalogProducts([nitro], { content });
    expect(result.hasConflictingDuration).toBe(false);
    expect(result.requestedDurationAvailable).toBe(true);
    expect(result.confidentProduct?.id).toBe(117);
  });

  it.each([
    [{ ...month, name: 'Decor Discord (Acc Có Nitro) - Gói 25k', service_type: 'decor' }, 'Decor Discord 1 tháng'],
    [{ ...month, name: 'Bot Booking / Bảng Giá / Store Custom', service_type: 'SERVICE', duration_months: 3 }, 'Bot Booking 3 tháng'],
  ])('never presents placeholder project/perpetual months as a subscription match', (product, content) => {
    expect(aiProductSubscriptionDuration(product)).toEqual({ days: null, months: null });
    const result = rankCatalogProducts([product], { content });
    expect(result.requestedDurationAvailable).toBe(false);
    expect(result.unmetConstraints).toContain('DURATION');
    expect(result.confidentProduct).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  extractRequestedDuration,
  extractRequestedBudget,
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
  it('preserves explicit budget and quantity before a same-message product correction', () => {
    const result = rankCatalogProducts(products, { content: '2 gói Netflix ngân sách 100k, đổi sang YouTube 1 tháng' });
    expect(result.quantity).toBe(2);
    expect(result.requestedBudget.amount).toBe(100000);
    expect(result.products).toEqual([]);
    expect(result.confidentProduct).toBeNull();
  });
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
    expect(rankCatalogProducts(variants, { content: 'YouTube 3 tháng', limit: 1 }).confidentProduct).toBeNull();
  });

  it('does not silently choose the first duration when the customer compares two plans', () => {
    const result = rankCatalogProducts(products, {
      content: 'Shop ơi YouTube 1 tháng hay 3 tháng thì hợp hơn?',
    });

    expect(result.products.map((product) => product.id).sort()).toEqual([1, 2]);
    expect(result.confidentProduct).toBeNull();
  });

  it('extracts quantities and Vietnamese durations without letting values exceed the order limit', () => {
    expect(extractRequestedQuantity('Cho mình 3 gói Spotify 6 tháng')).toBe(3);
    expect(extractRequestedQuantity('sl 99')).toBe(10);
    expect(extractRequestedDuration('CapCut 7 ngày')).toEqual({ days: 7, months: null });
    expect(extractRequestedDuration('Office 1 năm')).toEqual({ days: null, months: 12 });
  });

  it('keeps the Claude Pro x5 package tier separate from explicit quantities', () => {
    expect(extractRequestedQuantity('Mua Claude Pro x5 KBH 1 tháng')).toBe(1);
    expect(extractRequestedQuantity('Claude Pro x5 full bảo hành 1 tháng')).toBe(1);
    expect(extractRequestedQuantity('Claude Pro x5 x2')).toBe(2);
    expect(extractRequestedQuantity('Claude Pro x5 số lượng 2')).toBe(2);
    expect(extractRequestedQuantity('Mua 2 acc Claude Pro x5')).toBe(2);
    expect(extractRequestedQuantity('5 acc Claude Pro x5')).toBe(5);
    expect(extractRequestedQuantity('Claude Pro x5 số lượng 99')).toBe(10);
    expect(extractRequestedQuantity('Spotify x5')).toBe(5);
  });

  it('reads the subscription duration independently of the short warranty period', () => {
    expect(extractRequestedDuration('ChatGPT 1 Tháng (Cấp Acc · BH 2 Ngày)')).toEqual({ days: null, months: 1 });
    expect(extractRequestedDuration('ChatGPT cấp acc bảo hành 2 day gói 1 tháng')).toEqual({ days: null, months: 1 });
    expect(extractRequestedDuration('ChatGPT bảo hành 2 ngày')).toEqual({ days: null, months: null });
    expect(extractRequestedDuration('CapCut 7 ngày BH 2 ngày')).toEqual({ days: 7, months: null });
  });

  it('quotes a single exact Claude x5 package at its real price through a contextual confirmation', () => {
    const claude = {
      ...products[0], id: 10,
      name: 'Claude Pro x5 1 Tháng (Cấp Tài Khoản · Không BH)',
      description: 'Cấp tài khoản Claude Pro x5 không bảo hành.',
      service_type: 'AI', price: 1900000, is_featured: 0,
    };
    const variants = [claude, { ...claude, id: 11, name: 'Claude Pro x5 1 Tháng (Cấp Tài Khoản · Full BH)', price: 2500000 }];
    const result = rankCatalogProducts(variants, { content: `Mua ${claude.name}` });
    expect(result.confidentProduct?.id).toBe(10);
    expect(result.quantity).toBe(1);
    expect(result.confidentProduct.price * result.quantity).toBe(1900000);
    const repeat = rankCatalogProducts(variants, { content: 'Ok lấy gói này nhé', contextMessages: [`Mua ${claude.name} số lượng 2`] });
    expect(repeat.quantity).toBe(2);
    expect(repeat.products.map((product) => product.id)).toContain(10);
  });

  it('does not invent a product when a contextual confirmation has no usable history', () => {
    const result = rankCatalogProducts(products, { content: 'Ok chốt luôn nhé', contextMessages: [] });
    expect(isContextualPurchaseConfirmation('Ok chốt luôn nhé')).toBe(true);
    expect(result.hasProductSignal).toBe(false);
    expect(result.products).toEqual([]);
    expect(result.confidentProduct).toBeNull();
  });

  it('understands duration-only follow-ups and preserves a later quantity before confirmation', () => {
    const followup = rankCatalogProducts(products, { content: '3t nhé', contextMessages: ['Mình cần mua YouTube'] });
    expect(followup.usedContext).toBe(true);
    expect(followup.confidentProduct?.id).toBe(2);
    const confirm = rankCatalogProducts(products, { content: 'Ok chốt',
      contextMessages: ['Mình cần mua YouTube', '3 tháng nhé', 'số lượng 2'] });
    expect(confirm.confidentProduct?.id).toBe(2);
    expect(confirm.quantity).toBe(2);
  });

  it('keeps implicit comparisons ambiguous until an explicit duration is chosen', () => {
    const compare = rankCatalogProducts([...products, { ...products[0], id: 9, duration_months: 6 }], { content: 'YouTube 1 hay 3 tháng' });
    expect(compare.confidentProduct).toBeNull();
    expect(compare.products.map(product => product.id).sort()).toEqual([1, 2]);
    const unclear = rankCatalogProducts(products, { content: 'Ok lấy nhé', contextMessages: ['YouTube 1 hay 3 tháng'] });
    expect(unclear.confidentProduct).toBeNull();
    const chosen = rankCatalogProducts(products, { content: '3 tháng nhé', contextMessages: ['YouTube 1 hay 3 tháng'] });
    expect(chosen.confidentProduct?.id).toBe(2);
  });

  it('never prepares a different duration when the requested plan is unavailable', () => {
    const result = rankCatalogProducts([products[0]], { content: 'Chốt YouTube 12 tháng' });
    expect(result.confidentProduct).toBeNull();
    expect(result.requestedDuration.months).toBe(12);
    expect(result.requestedDurationAvailable).toBe(false);
    expect(result.unmetConstraints).toContain('DURATION');
  });

  it('separates Nitro subscriptions, server boosts, decor eligibility and development services', () => {
    const discord = [
      { ...products[0], id: 20, name: 'Discord Nitro Boost Trial 3 Tháng', duration_months: 3 },
      { ...products[0], id: 21, name: 'Discord Server Boost 14 Boosts (3 Tháng)', duration_months: 3 },
      { ...products[0], id: 22, name: 'Decor Discord (Acc Có Nitro) - Gói 25k', duration_months: 0 },
      { ...products[0], id: 23, name: 'Setup Discord Store + Bot Custom + Hosting 3 Tháng', duration_months: 3 },
    ];
    for (const [content, expected] of [
      ['Nitro 3 tháng', 20], ['boost server 3 tháng', 21],
      ['decor cho acc có Nitro', 22], ['setup Discord', 23],
    ]) {
      const result = rankCatalogProducts(discord, { content });
      expect(result.products.map(({ id }) => id)).toEqual([expected]);
      expect(result.confidentProduct?.id).toBe(expected);
    }
    const broad = rankCatalogProducts(discord, { content: 'Discord có gì?' });
    expect(broad.products).toHaveLength(4);
    expect(broad.confidentProduct).toBeNull();
    const compare = rankCatalogProducts(discord, { content: 'Decor hay Nitro?' });
    expect(compare.products.map(({ id }) => id).sort()).toEqual([20, 22]);
    expect(compare.confidentProduct).toBeNull();
  });

  it('does not treat bundle benefits or comparison descriptions as product identity', () => {
    const catalog = [
      ...products,
      { ...products[0], id: 30, name: 'Gemini Pro 2 Năm', description: 'Có Claude Opus và YouTube Premium 1 tháng', duration_months: 24 },
      { ...products[0], id: 31, name: 'Claude Pro 1 Tháng', description: 'Lựa chọn thay cho ChatGPT' },
    ];
    expect(rankCatalogProducts(catalog, { content: 'YouTube' }).products.map(({ id }) => id)).toEqual([1, 2]);
    expect(rankCatalogProducts(catalog, { content: 'Claude 1 tháng' }).confidentProduct?.id).toBe(31);
    expect(rankCatalogProducts(catalog, { content: 'ChatGPT' }).products).toEqual([]);
  });

  it('recognizes Locket, Windows shorthand and bot/website requests using current names', () => {
    const catalog = [
      { ...products[0], id: 40, name: 'Locket Gold — 1 năm', duration_months: 12 },
      { ...products[0], id: 41, name: 'Windows 11 / 10 Pro', duration_months: 0 },
      { ...products[0], id: 42, name: 'Bot Booking / Bảng Giá / Store Custom', duration_months: 3 },
      { ...products[0], id: 43, name: 'Discord Store + Bot Custom + Website Đồng Bộ', duration_months: 3 },
    ];
    expect(rankCatalogProducts(catalog, { content: 'Locket 1 năm' }).confidentProduct?.id).toBe(40);
    expect(rankCatalogProducts(catalog, { content: 'win 11' }).confidentProduct?.id).toBe(41);
    expect(rankCatalogProducts(catalog, { content: 'làm bot' }).products.map(({ id }) => id).sort()).toEqual([42, 43]);
  });

  it('keeps different named products ambiguous even if only one alternative is available', () => {
    const result = rankCatalogProducts(products, { content: 'YouTube hay Spotify 3 tháng?' });
    expect(result.products.map(({ id }) => id)).toEqual([2]);
    expect(result.confidentProduct).toBeNull();
  });

  it('uses an explicit correction instead of reviving the abandoned product family', () => {
    const result = rankCatalogProducts(products, {
      content: 'Không lấy YouTube, đổi sang Netflix 1 tháng',
      contextMessages: ['YouTube 3 tháng số lượng 2'],
    });
    expect(result.products.map(({ id }) => id)).toEqual([3]);
    expect(result.requestedDuration.months).toBe(1);
    expect(result.quantity).toBe(1);
    const revised = rankCatalogProducts(products, {
      content: 'YouTube số lượng 2 ngân sách 200k đổi sang Netflix số lượng 1 tối đa 100k',
    });
    expect(revised.quantity).toBe(1);
    expect(revised.requestedBudget.amount).toBe(100000);
    expect(revised.confidentProduct?.id).toBe(3);
    const followup = rankCatalogProducts(products, {
      content: 'Ok chốt', contextMessages: ['YouTube 3 tháng', 'Không lấy YouTube, đổi sang Netflix 1 tháng'],
    });
    expect(followup.confidentProduct?.id).toBe(3);
  });

  it('parses only explicit budget caps, including Vietnamese decimal and grouped amounts', () => {
    expect(extractRequestedBudget('ngân sách 200k')).toEqual({ amount: 200000, inclusive: true, scope: 'TOTAL' });
    expect(extractRequestedBudget('tối đa 1,5 triệu mỗi gói')).toEqual({ amount: 1500000, inclusive: true, scope: 'UNIT' });
    expect(extractRequestedBudget('dưới 150.000đ')).toEqual({ amount: 150000, inclusive: false, scope: 'TOTAL' });
    expect(extractRequestedBudget('tầm 200k')).toBeNull();
    expect(extractRequestedBudget('gói 200k')).toBeNull();
  });

  it('filters by total budget and quantity, preserving the cap through follow-up confirmation', () => {
    const result = rankCatalogProducts(products, { content: 'YouTube số lượng 2 ngân sách 200k' });
    expect(result.products.map(({ id }) => id)).toEqual([1]);
    expect(result.quantity).toBe(2);
    expect(result.requestedBudget.amount).toBe(200000);
    const followup = rankCatalogProducts(products, { content: 'Ok chốt',
      contextMessages: ['YouTube số lượng 2', 'ngân sách 200k'] });
    expect(followup.products.map(({ id }) => id)).toEqual([1]);
    expect(followup.quantity).toBe(2);
    const unitBudget = rankCatalogProducts(products, { content: 'YouTube số lượng 2 tối đa 150k mỗi gói' });
    expect(unitBudget.products.map(({ id }) => id).sort()).toEqual([1, 2]);
  });

  it('returns explicit mismatch without silently exceeding budget or reviving inactive offers', () => {
    const result = rankCatalogProducts(products, { content: 'YouTube 3 tháng dưới 150k' });
    expect(result.products).toEqual([]);
    expect(result.unmetConstraints).toEqual(['BUDGET']);
    expect(result.confidentProduct).toBeNull();
    expect(rankCatalogProducts([{ ...products[0], is_active: 0 }], { content: 'YouTube 1 tháng' }).products).toEqual([]);
  });

  it('does not infer a product from only a duration or budget without usable context', () => {
    for (const content of ['3 tháng nhé', 'ngân sách 200k', 'gói rẻ nhất']) {
      const result = rankCatalogProducts(products, { content });
      expect(result.hasProductSignal).toBe(false);
      expect(result.products).toEqual([]);
      expect(result.confidentProduct).toBeNull();
    }
  });

  it('retains the named product for concise price and warranty-policy follow-ups', () => {
    const catalog = [
      { ...products[0], id: 40, name: 'Locket Gold — 1 năm', duration_months: 12, price: 80000 },
      { ...products[0], id: 41, name: 'Gemini Pro 2 Năm (Antigravity · BH 12 Tháng)', duration_months: 24, price: 250000 },
    ];
    for (const content of ['giá sao?', 'giá nhiêu?', 'bao nhiêu?', 'giá thế nào?']) {
      const result = rankCatalogProducts(catalog, { content, contextMessages: ['Locket 1 năm'] });
      expect(result.usedContext).toBe(true);
      expect(result.confidentProduct?.id).toBe(40);
      expect(result.requestedDuration.months).toBe(12);
    }
    for (const content of ['bh?', 'bh bao lâu?', 'bảo hành thế nào?', 'chính sách ra sao?']) {
      const result = rankCatalogProducts(catalog, { content, contextMessages: ['Gemini Pro 2 năm giá sao?'] });
      expect(result.usedContext).toBe(true);
      expect(result.confidentProduct?.id).toBe(41);
      expect(result.requestedDuration.months).toBe(24);
    }
    for (const content of ['bh bao lâu?', 'giá sao?', 'bao nhiêu?', 'chính sách thế nào?']) {
      const result = rankCatalogProducts(catalog, { content });
      expect(result.hasProductSignal).toBe(false);
      expect(result.products).toEqual([]);
      expect(result.confidentProduct).toBeNull();
    }
  });

  it('does not mistake refusal for confirmation or infer a subscription from warranty months', () => {
    for (const text of ['Không chốt gói này', 'Đừng tạo đơn nhé', 'Chưa mua gói đó', 'Khoan lên đơn']) {
      expect(isContextualPurchaseConfirmation(text)).toBe(false);
    }
    expect(extractRequestedDuration('YouTube bảo hành 3 tháng gói 1 tháng')).toEqual({ days: null, months: 1 });
    const result = rankCatalogProducts(products, { content: 'Ok lấy nhé', contextMessages: ['YouTube 3 tháng', 'Không mua nữa'] });
    expect(result.confidentProduct).toBeNull();
  });
});

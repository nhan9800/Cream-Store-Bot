import { describe, expect, it } from 'vitest';
import { buildPublicFeedbackView } from '../src/services/publicFeedbackView.js';

describe('buildPublicFeedbackView', () => {
  it('keeps public review content while dropping customer and order identifiers', () => {
    const result = buildPublicFeedbackView({
      id: 12,
      guild_id: 'WEB',
      order_code: 'CN_PRIVATE',
      customer_id: '123456789012345678',
      product_id: 7,
      product_name: 'YouTube Premium',
      stars: 5,
      content: 'Giao hàng nhanh và hỗ trợ tốt.',
      customer_name: 'Khách Cenar',
      customer_avatar: 'https://cdn.discordapp.com/avatar.png',
      created_at: '2026-09-28T00:00:00.000Z',
      updated_at: '2026-09-28T00:01:00.000Z',
    });

    expect(result).toEqual({
      id: 12,
      stars: 5,
      content: 'Giao hàng nhanh và hỗ trợ tốt.',
      created_at: '2026-09-28T00:00:00.000Z',
      updated_at: '2026-09-28T00:01:00.000Z',
      customer_name: 'Khách Cenar',
      customer_avatar: 'https://cdn.discordapp.com/avatar.png',
      product_id: 7,
      product_name: 'YouTube Premium',
    });
    expect(result).not.toHaveProperty('customer_id');
    expect(result).not.toHaveProperty('order_code');
    expect(result).not.toHaveProperty('guild_id');
  });

  it('rejects non-https avatars and uses a neutral fallback name', () => {
    const result = buildPublicFeedbackView({ customer_avatar: 'javascript:alert(1)' });

    expect(result.customer_name).toBe('Khách hàng');
    expect(result.customer_avatar).toBeNull();
  });
});

import { describe, expect, it, vi } from 'vitest';

const { reviewEmoji } = vi.hoisted(() => ({
  reviewEmoji: {
    review_header: '<:review_header:100000000000000001>',
    review_star: '<:review_star:100000000000000002>',
    review_customer: '<:review_customer:100000000000000003>',
    review_order: '<:review_order:100000000000000004>',
    review_product: '<:review_product:100000000000000005>',
    review_comment: '<:review_comment:100000000000000006>',
  },
}));

vi.mock('../src/services/emojiService.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getEmoji: vi.fn((_guildId, slot) => reviewEmoji[slot] || ''),
}));

const { buildFeedbackV2 } = await import('../src/utils/embeds.js');

describe('review card custom emoji layout', () => {
  it('uses a distinct custom emoji for every semantic review section', () => {
    const { container, flags } = buildFeedbackV2({
      member: { id: 'customer-1' },
      order: {
        guild_id: 'guild-1',
        order_code: 'CN_123456',
        product_name: 'Gemini Pro 24 tháng',
        quantity: 1,
      },
      stars: 5,
      content: 'Shop hỗ trợ nhanh và rõ ràng.',
    });

    const rendered = JSON.stringify(container.toJSON());
    expect(flags).toBe(32768);
    for (const emoji of Object.values(reviewEmoji)) expect(rendered).toContain(emoji);
    expect(rendered).toContain('<@customer-1>');
    expect(rendered).toContain('CN_123456');
    expect(rendered).toContain('Gemini Pro 24 tháng');
    expect(rendered).toContain('Shop hỗ trợ nhanh và rõ ràng.');
    expect(rendered.match(/review_star:/g)).toHaveLength(5);
  });

  it.each([1, 2, 3, 4, 5])('preserves the submitted %i-star rating and multiline opinion', stars => {
    const { container } = buildFeedbackV2({
      member: { id: 'customer-2' },
      order: { guild_id: 'guild-1', order_code: 'CN_654321', product_name: 'Nitro', quantity: 2 },
      stars,
      content: 'Dòng thứ nhất\nDòng thứ hai',
    });
    const text = container.toJSON().components.filter(c => c.type === 10).map(c => c.content).join('\n');
    expect(text.match(/review_star:/g)).toHaveLength(stars);
    expect(text).toContain(`${stars}/5 sao`);
    expect(text).toContain('Dòng thứ nhất\nDòng thứ hai');
  });
});

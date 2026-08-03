import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/emojiService.js', () => ({
  getEmojiMap: vi.fn(() => ({
    icon_star: '<a:server_star:123456789012345678>',
  })),
}));

const { createEmojiResolver } = await import('../src/utils/emojiHelper.js');

describe('custom emoji resolver', () => {
  it('returns a configured server emoji', () => {
    const E = createEmojiResolver('guild-1');
    expect(E('icon_star')).toBe('<a:server_star:123456789012345678>');
  });

  it('discards a Unicode fallback instead of rendering a default emoji', () => {
    const E = createEmojiResolver('guild-1');
    expect(E('missing_slot', '⭐')).toBe('');
    expect(E.component('missing_slot')).toBeNull();
  });
});

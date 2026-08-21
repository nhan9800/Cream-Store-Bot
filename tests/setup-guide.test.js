import { describe, expect, test } from 'vitest';
import { buildGuideContent } from '../src/commands/setup-guide.js';

describe('setup guide content', () => {
  test('renders a resolved custom brand emoji instead of a legacy name token', () => {
    const content = buildGuideContent({
      emojiSlot: 'brand_spotify',
      content: ['## Spotify Premium', '', 'Nội dung hướng dẫn'],
    }, () => '<:cenar_spotify:1535690966911025262>');

    expect(content).toContain(
      '## <:cenar_spotify:1535690966911025262> Spotify Premium <:cenar_spotify:1535690966911025262>',
    );
    expect(content).not.toContain(':spotify2:');
  });

  test('keeps a clean title when a custom emoji is unavailable', () => {
    const content = buildGuideContent({
      emojiSlot: 'brand_spotify',
      content: ['## Spotify Premium'],
    }, () => '');

    expect(content).toBe('## Spotify Premium');
  });
});

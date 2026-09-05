import { describe, expect, it } from 'vitest';
import {
  PROMOTION_BOARD,
  isPromotionBoardMessage,
  publishPromotionBoard,
  clearPromotionChannel,
} from '../src/campaigns/promotionBoard2026.js';

describe('Cenar promotion channel policy', () => {
  it('marks the current promotion campaign as inactive', () => {
    expect(PROMOTION_BOARD.status).toBe('INACTIVE');
    expect(PROMOTION_BOARD.channelId).toBe('1515008584549797979');
  });

  it('targets only messages authored by the Cenar bot', () => {
    expect(isPromotionBoardMessage({ author: { id: 'bot-1' } }, 'bot-1')).toBe(true);
    expect(isPromotionBoardMessage({ author: { id: 'member-1' } }, 'bot-1')).toBe(false);
    expect(isPromotionBoardMessage(null, 'bot-1')).toBe(false);
  });

  it('keeps the legacy publisher name as a safe cleanup alias', () => {
    expect(publishPromotionBoard).toBe(clearPromotionChannel);
  });
});

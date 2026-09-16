import { describe, expect, it } from 'vitest';
import {
  PROMOTION_BOARD,
  isPromotionBoardMessage,
  publishPromotionBoard,
  clearPromotionChannel,
} from '../src/campaigns/promotionBoard2026.js';

describe('Cenar promotion channel policy', () => {
  it('marks the Mid-Autumn promotion as active', () => {
    expect(PROMOTION_BOARD.status).toBe('ACTIVE');
    expect(PROMOTION_BOARD.campaign).toBe('CENAR-MID-AUTUMN-SALE-2026');
    expect(PROMOTION_BOARD.channelId).toBe('1515008584549797979');
  });

  it('targets only messages authored by the Cenar bot', () => {
    expect(isPromotionBoardMessage({ author: { id: 'bot-1' } }, 'bot-1')).toBe(true);
    expect(isPromotionBoardMessage({ author: { id: 'member-1' } }, 'bot-1')).toBe(false);
    expect(isPromotionBoardMessage(null, 'bot-1')).toBe(false);
  });

  it('keeps explicit publish and cleanup operations separate', () => {
    expect(publishPromotionBoard).toBeTypeOf('function');
    expect(clearPromotionChannel).toBeTypeOf('function');
    expect(publishPromotionBoard).not.toBe(clearPromotionChannel);
  });
});

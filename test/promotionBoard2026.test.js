import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  PROMOTION_BOARD,
  buildPromotionBoardPayload,
  isPromotionBoardMessage,
} from '../src/campaigns/promotionBoard2026.js';

function serialize(payload) {
  return JSON.stringify({
    ...payload,
    components: payload.components.map((component) => component.toJSON()),
  });
}

describe('Cenar promotion board 2026', () => {
  it('renders every requested promotion price and policy', () => {
    const payload = buildPromotionBoardPayload();
    const json = serialize(payload);

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(json).toContain(PROMOTION_BOARD.marker);
    expect(json).toContain('NITRO BOOST LOGIN');
    expect(json).toContain('1 Tháng:** `90.000đ`');
    expect(json).toContain('2 Tháng:** `100.000đ`');
    expect(json).toContain('12 Tháng:** `800.000đ`');
    expect(json).toContain('Trial 4 Tháng:** `65.000đ`');
    expect(json).toContain('1 Tháng:** `110.000đ`');
    expect(json).toContain('3 Tháng:** `250.000đ`');
    expect(json).toContain('1 Tháng:** `35.000đ`');
    expect(json).toContain('~~66.000đ~~ → **24.000đ**');
    expect(json).toContain('~~79.000đ~~ → **34.000đ**');
    expect(json).toContain('HUY HIỆU QUÀ TẶNG HUYỀN THOẠI DISCORD');
    expect(json).toContain('cenar_promo_discount');
    expect(json).toContain('cenar_promo_nitro');
    expect(json).toContain('cenar_promo_boost');
    expect(json).toContain('cenar_promo_netflix');
    expect(json).toContain('cenar_promo_decor');
    expect(json).toContain('cenar_promo_legend');
    expect(payload.components).toHaveLength(5);
    expect(payload.allowedMentions.parse).toContain('everyone');
    expect(payload.allowedMentions.roles).toEqual(PROMOTION_BOARD.audienceRoleIds);
  });

  it('detects only the marked bot-authored campaign message', () => {
    const payload = buildPromotionBoardPayload();
    const message = {
      author: { id: 'bot-1' },
      components: payload.components.map((component) => component.toJSON()),
    };
    expect(isPromotionBoardMessage(message, 'bot-1')).toBe(true);
    expect(isPromotionBoardMessage(message, 'bot-2')).toBe(false);
  });
});

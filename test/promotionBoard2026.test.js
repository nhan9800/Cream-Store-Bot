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
  it('renders the complete Summer Sale catalog and operating policies', () => {
    const payload = buildPromotionBoardPayload();
    const json = serialize(payload);

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(json).toContain(PROMOTION_BOARD.marker);
    expect(json).toContain('SALE CUỐI HÈ');
    expect(json).toContain('DISCORD NITRO BOOST LOGIN');
    expect(json).toContain('2 Tháng:** `99.000đ`');
    expect(json).toContain('4 Tháng:** `200.000đ`');
    expect(json).toContain('6 Tháng:** `380.000đ`');
    expect(json).toContain('8 Tháng:** `480.000đ`');
    expect(json).toContain('12 Tháng:** `630.000đ`');
    expect(json).toContain('Gia hạn 2 tháng/lần · Auto New Update');
    expect(json).toContain('12 Tháng:** `800.000đ`');
    expect(json).toContain('Mua thẳng 1 lần');
    expect(json).toContain('1 Tháng:** `99.000đ`');
    expect(json).toContain('3 Tháng:** `250.000đ`');
    expect(json).toContain('1 Tháng:** `60.000đ`');
    expect(json).toContain('3 Tháng:** `195.000đ`');
    expect(json).toContain('6 Tháng:** `320.000đ`');
    expect(json).toContain('12 Tháng:** `580.000đ`');
    expect(json).toContain('Shop chỉ mở bán dòng **ổn định cao**');
    expect(json).toContain('Dòng 12 tháng gia hạn/đổi Family mỗi tháng đã dừng bán');
    expect(json).not.toContain('1 Năm:** `200.000đ`');
    expect(json).toContain('6 Tháng:** `180.000đ`');
    expect(json).toContain('12 Tháng:** `280.000đ`');
    expect(json).toContain('Cấp tài khoản** — `55.000đ`');
    expect(json).toContain('Cấp tài khoản** — `350.000đ`');
    expect(json).toContain('Office 365 Plus + 1 TB OneDrive · Cấp tài khoản** — `100.000đ`');
    expect(json).toContain('Tài khoản chính chủ** — `180.000đ`');
    expect(json).toContain('Gemini Pro + 5 TB Google One** — `150.000đ`');
    expect(json).toContain('Windows 10/11 Pro chính hãng** — `150.000đ`');
    expect(json).toContain('Locket Gold** — `100.000đ`');
    expect(json).toContain('Canva Pro** — `130.000đ`');
    expect(json).toContain('ChatGPT Plus · Cấp tài khoản · Full bảo hành** — `290.000đ`');
    expect(json).toContain('cenar_promo_discount');
    expect(json).toContain('cenar_promo_nitro');
    expect(json).toContain('cenar_promo_boost');
    expect(json).toContain('cenar_yt_logo');
    expect(json).toContain('cenar_spotify');
    expect(json).toContain('cenar_promo_decor');
    expect(json).toContain('cenar_price_chatgpt');
    expect(payload.components).toHaveLength(6);
    expect(payload.allowedMentions.parse).toContain('everyone');
    expect(payload.allowedMentions.roles).toEqual(PROMOTION_BOARD.audienceRoleIds);
  });

  it('detects current and legacy promotion panels written by the bot', () => {
    const payload = buildPromotionBoardPayload();
    const message = {
      author: { id: 'bot-1' },
      components: payload.components.map((component) => component.toJSON()),
    };
    const legacy = {
      author: { id: 'bot-1' },
      components: [{ type: 17, components: [{ type: 10, content: '-# CENAR-PROMOTION-BOARD-V1' }] }],
    };
    const staleAnnouncement = {
      author: { id: 'bot-1' },
      components: [{ type: 17, components: [{ type: 10, content: '# Khuyến Mãi 21/08 - 02/09' }] }],
    };

    expect(isPromotionBoardMessage(message, 'bot-1')).toBe(true);
    expect(isPromotionBoardMessage(legacy, 'bot-1')).toBe(true);
    expect(isPromotionBoardMessage(staleAnnouncement, 'bot-1')).toBe(true);
    expect(isPromotionBoardMessage(message, 'bot-2')).toBe(false);
  });
});

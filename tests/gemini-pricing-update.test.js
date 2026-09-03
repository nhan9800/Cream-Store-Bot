import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  GEMINI_PRICING_UPDATE,
  buildGeminiPricingUpdateMessage,
  isGeminiPricingUpdateMessage,
} from '../src/campaigns/geminiPricingUpdate2026.js';

function serialize(payload) {
  return JSON.stringify({
    ...payload,
    components: payload.components.map((component) => component.toJSON()),
  });
}

describe('Gemini pricing update 03/09/2026', () => {
  it('announces exactly the two new full-warranty prices', () => {
    const payload = buildGeminiPricingUpdateMessage({ tagEveryone: false });
    const json = serialize(payload);

    expect(json).toContain('CẬP NHẬT GIÁ GEMINI PRO + 5 TB GOOGLE ONE');
    expect(json).toContain('250.000đ');
    expect(json).toContain('280.000đ');
    expect(json).toContain('Full trong toàn bộ **12 tháng**');
    expect(json).toContain('Full trong toàn bộ **18 tháng**');
    expect(json).toContain('phương thức triển khai cũ không còn khả dụng');
    expect(json).toContain('bảo hành giới hạn theo phương thức cũ');
    expect(json).not.toContain('69.000đ');
    expect(json).not.toContain('130.000đ');
    expect(json).not.toContain('180.000đ');
  });

  it('uses Components V2, custom-emoji buttons and a controlled everyone ping', () => {
    const payload = buildGeminiPricingUpdateMessage();
    const json = serialize(payload);

    expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
    expect(payload.allowedMentions).toEqual({
      parse: ['everyone'], roles: [], users: [], repliedUser: false,
    });
    expect(json).toContain('@everyone');
    expect(json).toContain(GEMINI_PRICING_UPDATE.storeUrl);
    expect(json).toContain(GEMINI_PRICING_UPDATE.priceChannelId);
    expect(json).toContain(GEMINI_PRICING_UPDATE.supportChannelId);
    expect(json).toContain(GEMINI_PRICING_UPDATE.marker);
  });

  it('recognizes its own previous post for idempotent republishing', () => {
    const message = {
      author: { id: 'bot-1' },
      toJSON: () => ({ content: GEMINI_PRICING_UPDATE.marker }),
    };
    expect(isGeminiPricingUpdateMessage(message, 'bot-1')).toBe(true);
    expect(isGeminiPricingUpdateMessage(message, 'bot-2')).toBe(false);
  });
});

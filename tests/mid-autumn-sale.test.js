import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  MID_AUTUMN_SALE,
  buildMidAutumnSaleMessages,
  buildMidAutumnSaleSections,
  isStaleCampaignEmojiName,
} from '../src/campaigns/midAutumnSale2026.js';

const NATIVE_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;

function emojiResolver(slot) {
  return `<:cenar_${slot}:1535618654358736926>`;
}
emojiResolver.component = (slot) => ({ id: '1535618654358736926', name: `cenar_${slot}` });

const customEmojis = Object.freeze({
  cenar_event_moon: { text: '<:cenar_event_moon:100000000000000001>', component: { id: '100000000000000001', name: 'cenar_event_moon' } },
  cenar_event_mooncake: { text: '<:cenar_event_mooncake:100000000000000002>', component: { id: '100000000000000002', name: 'cenar_event_mooncake' } },
  cenar_event_lantern: { text: '<:cenar_event_lantern:100000000000000003>', component: { id: '100000000000000003', name: 'cenar_event_lantern' } },
});

describe('Mid-Autumn 25/9 sale campaign', () => {
  it('keeps every supplied product and approved price', () => {
    const sections = buildMidAutumnSaleSections({ E: emojiResolver, customEmojis });
    const content = Object.values(sections).join('\n');
    const prices = [
      '85.000đ', '99.000đ', '115.000đ', '210.000đ', '310.000đ', '450.000đ', '550.000đ', '800.000đ', '55.000đ',
      '100.000đ', '250.000đ', '30.000đ', '50.000đ', '200.000đ', '250.000đ', '190.000đ', '150.000đ', '390.000đ',
      '55.000đ', '305.000đ', '95.000đ', '180.000đ', '280.000đ', '65.000đ', '185.000đ', '295.000đ', '530.000đ', '150.000đ',
    ];
    prices.forEach((price) => expect(content).toContain(price));

    for (const product of [
      'NITRO BOOST LOGIN', 'BOOST SERVER', 'NETFLIX PREMIUM', 'GEMINI PRO',
      'OFFICE 365', 'CHATGPT PLUS', 'CAPCUT PRO', 'SPOTIFY PREMIUM',
      'YOUTUBE PREMIUM', 'CANVA PRO',
    ]) expect(content).toContain(product);
  });

  it('uses professional qualifications for warranty, availability and risk', () => {
    const content = Object.values(buildMidAutumnSaleSections({ E: emojiResolver, customEmojis })).join('\n');
    expect(content).toContain('25/09/2026');
    expect(content).toContain('xử lý 4–5 ngày');
    expect(content).toContain('gia hạn tự động');
    expect(content).toContain('Full bảo hành');
    expect(content).toContain('không bảo hành');
    expect(content).toContain('khoảng 2%');
    expect(content).toContain('không phải cam kết tuyệt đối');
    expect(content).toContain('xác nhận tại ticket trước khi thanh toán');
  });

  it('uses Components V2, custom emoji artwork and only one everyone mention', () => {
    const messages = buildMidAutumnSaleMessages({ E: emojiResolver, customEmojis });
    expect(messages).toHaveLength(3);
    messages.forEach((payload, index) => {
      expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
      expect(payload.allowedMentions.parse).toEqual(index === 0 ? ['everyone'] : []);
      const json = JSON.stringify(payload);
      expect(json).toContain(`${MID_AUTUMN_SALE.marker}-PART-${index + 1}`);
      if (index === 0) expect(json).toContain('@everyone');
      else expect(json).not.toContain('@everyone');
      expect(json).not.toMatch(NATIVE_EMOJI);
    });

    const finalPanel = messages.at(-1).components[0].toJSON();
    const actionRow = finalPanel.components.at(-1);
    expect(actionRow.components).toHaveLength(3);
    expect(actionRow.components.every((button) => button.emoji?.id)).toBe(true);
  });

  it('cleans prior event-only emoji names without touching the current set', () => {
    expect(isStaleCampaignEmojiName('cenar_29_sale')).toBe(true);
    expect(isStaleCampaignEmojiName('cenar_event_christmas')).toBe(true);
    expect(isStaleCampaignEmojiName('cenar_event_moon')).toBe(false);
    expect(isStaleCampaignEmojiName('cenar_sale_gift')).toBe(false);
    expect(isStaleCampaignEmojiName('cenar_warranty_shield')).toBe(false);
  });
});

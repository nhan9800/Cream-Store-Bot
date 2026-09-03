import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  NATIONAL_DAY_SALE,
  buildNationalDaySaleMessages,
  buildNationalDaySaleSections,
} from '../src/campaigns/nationalDaySale2026.js';

const NATIVE_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;

function emojiResolver(slot) {
  return `<:cenar_${slot}:1535618654358736926>`;
}
emojiResolver.component = (slot) => ({ id: '1535618654358736926', name: `cenar_${slot}` });

const customEmojis = Object.freeze({
  cenar_29_badge: { text: '<:cenar_29_badge:100000000000000001>', component: { id: '100000000000000001', name: 'cenar_29_badge' } },
  cenar_29_firework: { text: '<:cenar_29_firework:100000000000000002>', component: { id: '100000000000000002', name: 'cenar_29_firework' } },
  cenar_29_sale: { text: '<:cenar_29_sale:100000000000000003>', component: { id: '100000000000000003', name: 'cenar_29_sale' } },
});

describe('National Day 2/9 sale campaign', () => {
  it('keeps the supplied products and every approved price', () => {
    const sections = buildNationalDaySaleSections({ E: emojiResolver, customEmojis });
    const content = Object.values(sections).join('\n');
    const prices = [
      '85.000đ', '99.000đ', '115.000đ', '210.000đ', '310.000đ', '450.000đ', '550.000đ', '800.000đ', '55.000đ',
      '90.000đ', '230.000đ', '30.000đ', '50.000đ', '250.000đ', '280.000đ', '180.000đ', '130.000đ', '390.000đ',
      '295.000đ', '280.000đ', '65.000đ', '185.000đ', '530.000đ',
    ];
    prices.forEach((price) => expect(content).toContain(price));

    for (const product of [
      'NITRO BOOST LOGIN', 'BOOST SERVER', 'NETFLIX PREMIUM', 'GEMINI PRO',
      'OFFICE 365', 'CHATGPT PLUS', 'CAPCUT PRO', 'SPOTIFY PREMIUM', 'YOUTUBE PREMIUM',
    ]) expect(content).toContain(product);
  });

  it('uses respectful 81-year context and preserves the risk/warranty qualifications', () => {
    const sections = buildNationalDaySaleSections({ E: emojiResolver, customEmojis });
    const content = Object.values(sections).join('\n');
    expect(content).toContain('81 năm Quốc khánh Việt Nam · 1945–2026');
    expect(content).toContain('Bảo hành 02 ngày');
    expect(content).toContain('dao động quanh 2%');
    expect(content).toContain('không phải cam kết tuyệt đối');
    expect(content).toContain('xử lý 4–5 ngày');
    expect(content).toContain('gia hạn tự động');
    expect(content).toContain('mua thẳng 01 năm');
    expect(content).toContain('Giá mới áp dụng từ 03/09/2026');
    expect(content).toContain('Full bảo hành');
  });

  it('pings everyone once in the promotion opener and never repeats the ping', () => {
    const messages = buildNationalDaySaleMessages({ E: emojiResolver, customEmojis });
    expect(messages).toHaveLength(3);

    messages.forEach((payload, index) => {
      expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
      expect(payload.allowedMentions).toEqual({
        parse: index === 0 ? ['everyone'] : [],
        roles: [],
        users: [],
        repliedUser: false,
      });
      const json = JSON.stringify(payload);
      expect(json).toContain(`${NATIONAL_DAY_SALE.marker}-PART-${index + 1}`);
      if (index === 0) expect(json).toContain('@everyone');
      else expect(json).not.toContain('@everyone');
      expect(json).not.toMatch(NATIVE_EMOJI);
    });

    expect(NATIONAL_DAY_SALE.promotionChannelId).toBe('1515008584549797979');
    expect(NATIONAL_DAY_SALE.legacyAnnouncementChannelId).toBe('1514598369597587546');

    const last = messages.at(-1).components[0].toJSON();
    const actionRow = last.components.at(-1);
    expect(actionRow.components).toHaveLength(3);
    expect(actionRow.components.every((button) => button.emoji?.id)).toBe(true);
    expect(JSON.stringify(actionRow)).toContain(NATIONAL_DAY_SALE.storeUrl);
    expect(JSON.stringify(actionRow)).toContain(NATIONAL_DAY_SALE.supportChannelId);
    expect(JSON.stringify(actionRow)).toContain(NATIONAL_DAY_SALE.priceChannelId);
  });
});

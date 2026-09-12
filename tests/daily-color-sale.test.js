import { describe, expect, it } from 'vitest';
import { MessageFlags } from 'discord.js';
import {
  DAILY_COLOR_SALE,
  buildDailyColorSaleMessages,
  buildDailyColorSaleSections,
  dailySaleTheme,
  isStaleDailyCampaignEmojiName,
} from '../src/campaigns/dailyColorSale2026.js';

const NATIVE_EMOJI = /[\u{1F000}-\u{1FAFF}\u2600-\u27BF]/u;

function emojiResolver(slot) {
  return `<:cenar_${slot}:1535618654358736926>`;
}
emojiResolver.component = (slot) => ({ id: '1535618654358736926', name: `cenar_${slot}` });

const customEmojis = Object.freeze({
  cenar_daily_tag: { text: '<:cenar_daily_tag:100000000000000001>', component: { id: '100000000000000001', name: 'cenar_daily_tag' } },
  cenar_daily_leaf: { text: '<:cenar_daily_leaf:100000000000000002>', component: { id: '100000000000000002', name: 'cenar_daily_leaf' } },
  cenar_daily_gift: { text: '<:cenar_daily_gift:100000000000000003>', component: { id: '100000000000000003', name: 'cenar_daily_gift' } },
});

describe('Daily Color sale campaign', () => {
  it('keeps the supplied prices and products', () => {
    const content = Object.values(buildDailyColorSaleSections({ E: emojiResolver, customEmojis })).join('\n');
    for (const price of [
      '85.000đ', '99.000đ', '115.000đ', '210.000đ', '310.000đ', '450.000đ',
      '550.000đ', '800.000đ', '55.000đ', '90.000đ', '230.000đ',
      '119.000đ', '150.000đ', '180.000đ', '390.000đ', '1.900.000đ',
      '295.000đ', '280.000đ', '65.000đ', '185.000đ', '530.000đ',
    ]) expect(content).toContain(price);

    for (const product of [
      'NITRO BOOST LOGIN', 'BOOST SERVER', 'GEMINI PRO',
      'OFFICE 365', 'CHATGPT PLUS', 'CAPCUT PRO', 'SPOTIFY PREMIUM', 'YOUTUBE PREMIUM',
    ]) expect(content).toContain(product);
    expect(content).not.toContain('NETFLIX');
    expect(content).not.toContain('CANVA PRO');
  });

  it('uses Components V2, custom emoji art and exactly one everyone/member mention', () => {
    const messages = buildDailyColorSaleMessages({ E: emojiResolver, customEmojis });
    expect(messages).toHaveLength(3);
    messages.forEach((payload, index) => {
      expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
      expect(payload.allowedMentions.parse).toEqual(index === 0 ? ['everyone'] : []);
      expect(payload.allowedMentions.roles).toEqual(index === 0 ? [DAILY_COLOR_SALE.memberRoleId] : []);
      const json = JSON.stringify(payload);
      expect(json).toContain(`${DAILY_COLOR_SALE.marker}-PART-${index + 1}`);
      if (index === 0) {
        expect(json).toContain('@everyone');
        expect(json).toContain(`<@&${DAILY_COLOR_SALE.memberRoleId}>`);
      } else {
        expect(json).not.toContain('@everyone');
      }
      expect(json).not.toMatch(NATIVE_EMOJI);
    });
    const finalPanel = messages.at(-1).components[0].toJSON();
    expect(finalPanel.components.at(-1).components).toHaveLength(3);
  });

  it('rotates the daily color theme using Vietnam time', () => {
    expect(dailySaleTheme(new Date('2026-09-12T05:00:00.000Z')).name).toBe('Vàng Cuối Tuần');
    expect(dailySaleTheme(new Date('2026-09-14T05:00:00.000Z')).name).toBe('Mint Tươi Mới');
  });

  it('cleans event-only emoji names and preserves the current Daily Color set', () => {
    expect(isStaleDailyCampaignEmojiName('cenar_event_moon')).toBe(true);
    expect(isStaleDailyCampaignEmojiName('cenar_29_sale')).toBe(true);
    expect(isStaleDailyCampaignEmojiName('cenar_daily_retired')).toBe(true);
    expect(isStaleDailyCampaignEmojiName('cenar_daily_gift')).toBe(false);
    expect(isStaleDailyCampaignEmojiName('cenar_sale_gift')).toBe(false);
  });
});

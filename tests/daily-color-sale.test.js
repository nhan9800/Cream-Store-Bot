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
  cenar_autumn_202610_ticket: { text: '<:cenar_autumn_202610_ticket:100000000000000001>', component: { id: '100000000000000001', name: 'cenar_autumn_202610_ticket' } },
  cenar_autumn_202610_leaves: { text: '<:cenar_autumn_202610_leaves:100000000000000002>', component: { id: '100000000000000002', name: 'cenar_autumn_202610_leaves' } },
  cenar_autumn_202610_cup: { text: '<:cenar_autumn_202610_cup:100000000000000003>', component: { id: '100000000000000003', name: 'cenar_autumn_202610_cup' } },
  cenar_autumn_202610_spark: { text: '<:cenar_autumn_202610_spark:100000000000000004>', component: { id: '100000000000000004', name: 'cenar_autumn_202610_spark' } },
});

describe('Daily Color sale campaign', () => {
  it('keeps the supplied prices and products', () => {
    const content = Object.values(buildDailyColorSaleSections({ E: emojiResolver, customEmojis })).join('\n');
    for (const price of [
      '85.000đ', '99.000đ', '120.000đ', '250.000đ', '350.000đ', '450.000đ',
      '680.000đ', '830.000đ', '65.000đ', '110.000đ', '280.000đ', '75.000đ',
      '190.000đ', '200.000đ', '485.000đ', '500.000đ', '2.650.000đ', '4.800.000đ',
      '12.700.000đ', '1.900.000đ', '2.300.000đ', '2.500.000đ',
      '55.000đ', '290.000đ', '180.000đ', '58.000đ', '185.000đ', '295.000đ', '530.000đ',
      '130.000đ', '390.000đ', '79.000đ/slot', '150.000đ/slot',
    ]) expect(content).toContain(price);

    for (const product of [
      'NITRO BOOST LOGIN', 'BOOST SERVER', 'NETFLIX PREMIUM', 'GEMINI PRO',
      'OFFICE 365', 'CHATGPT PLUS CHÍNH CHỦ', 'CLAUDE PRO x5',
      'CAPCUT PRO', 'SPOTIFY PREMIUM', 'YOUTUBE PREMIUM',
      'ADOBE', 'LOCKET', 'GEARUP', 'BOT CUSTOM', 'CLAUDE API',
    ]) expect(content.toLocaleLowerCase('vi')).toContain(product.toLocaleLowerCase('vi'));
    expect(content).toContain('Mail bất tử');
    expect(content).toContain('Có thể thêm 5 thành viên');
    expect(content).toContain('Không BH acc');
    expect(content).toContain('**ChatGPT · Cấp acc** · **120.000đ**');
    expect(content).toContain('BH 2 ngày');
    for (const restoredTerm of ['BH 60 phút', 'Ghép Team', 'File JSON', 'MoMo Pay']) expect(content).toContain(restoredTerm);
    expect(content.toLocaleLowerCase('vi')).not.toContain('canva pro');
  });

  it('keeps every price-board part silent while retaining Components V2 and custom artwork', () => {
    const messages = buildDailyColorSaleMessages({ E: emojiResolver, customEmojis, now: new Date('2026-10-02T02:00:00Z') });
    expect(messages).toHaveLength(8);
    messages.forEach((payload, index) => {
      expect(payload.flags & MessageFlags.IsComponentsV2).toBeTruthy();
      expect(payload.allowedMentions.parse).toEqual([]);
      expect(payload.allowedMentions.roles).toEqual([]);
      const json = JSON.stringify(payload);
      expect(json).toContain(`${DAILY_COLOR_SALE.marker}-PART-${index + 1}`);
      expect(json).toContain(DAILY_COLOR_SALE.revision);
      expect(json).not.toContain('@everyone');
      expect(json).not.toContain(`<@&${DAILY_COLOR_SALE.memberRoleId}>`);
      expect(json).not.toMatch(NATIVE_EMOJI);
      expect(json).not.toContain('cenar_daily_');
      const text = payload.components[0].toJSON().components
        .filter((component) => component.type === 10)
        .map((component) => component.content).join('');
      expect(text.length).toBeLessThanOrEqual(4000);
    });
    const finalPanel = messages.at(-1).components[0].toJSON();
    expect(finalPanel.components.at(-1).components).toHaveLength(3);
  });

  it('changes the branded theme monthly using Vietnam time', () => {
    expect(dailySaleTheme(new Date('2026-09-29T05:00:00.000Z')).name).toBe('Thành Phố Lên Đèn');
    expect(dailySaleTheme(new Date('2026-10-01T05:00:00.000Z')).name).toBe('Trạm Thu Dịu');
    expect(dailySaleTheme(new Date('2026-09-30T16:59:00.000Z')).name).toBe('Thành Phố Lên Đèn');
    expect(dailySaleTheme(new Date('2026-09-30T17:00:00.000Z')).name).toBe('Trạm Thu Dịu');
  });

  it('retires the reused daily/event emoji names and preserves the new autumn set', () => {
    expect(isStaleDailyCampaignEmojiName('cenar_event_moon')).toBe(true);
    expect(isStaleDailyCampaignEmojiName('cenar_29_sale')).toBe(true);
    expect(isStaleDailyCampaignEmojiName('cenar_daily_retired')).toBe(true);
    expect(isStaleDailyCampaignEmojiName('cenar_daily_gift')).toBe(true);
    for (const name of Object.keys(customEmojis)) expect(isStaleDailyCampaignEmojiName(name)).toBe(false);
    expect(isStaleDailyCampaignEmojiName('cenar_sale_gift')).toBe(false);
  });
});

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
  cenar_moonfest_rabbit: { text: '<:cenar_moonfest_rabbit:100000000000000001>', component: { id: '100000000000000001', name: 'cenar_moonfest_rabbit' } },
  cenar_moonfest_cake: { text: '<:cenar_moonfest_cake:100000000000000002>', component: { id: '100000000000000002', name: 'cenar_moonfest_cake' } },
  cenar_moonfest_lantern: { text: '<:cenar_moonfest_lantern:100000000000000003>', component: { id: '100000000000000003', name: 'cenar_moonfest_lantern' } },
});

describe('Mid-Autumn 2026 sale campaign', () => {
  it('keeps every supplied product and approved price', () => {
    const sections = buildMidAutumnSaleSections({ E: emojiResolver, customEmojis });
    const content = Object.values(sections).join('\n');
    const prices = [
      '85.000đ', '99.000đ', '115.000đ', '220.000đ', '350.000đ', '450.000đ', '550.000đ', '800.000đ', '55.000đ',
      '100.000đ', '250.000đ', '119.000đ', '150.000đ', '180.000đ', '390.000đ', '1.900.000đ',
      '295.000đ', '90.000đ', '280.000đ', '56.000đ', '285.000đ', '500.000đ', '35.000đ', '20.000đ',
    ];
    prices.forEach((price) => expect(content).toContain(price));

    for (const product of [
      'NITRO BOOST LOGIN', 'BOOST SERVER', 'GEMINI PRO',
      'OFFICE 365', 'CHATGPT PLUS', 'CAPCUT PRO', 'SPOTIFY PREMIUM',
      'YOUTUBE PREMIUM', 'MEITU', 'DUOLINGO SUPER',
    ]) expect(content).toContain(product);
    expect(content).not.toContain('NETFLIX');
    expect(content).not.toContain('CANVA');
    expect(sections.nitro).not.toContain('210.000đ');
    expect(sections.nitro).not.toContain('310.000đ');
    expect(sections.boost).toContain('100.000đ');
    expect(sections.boost).toContain('250.000đ');
    expect(sections.spotifyYoutube).toContain('56.000đ');
    expect(sections.spotifyYoutube).toContain('500.000đ');
    expect(sections.extrasClosing).toContain('85.000đ');
  });

  it('uses professional qualifications for warranty, availability and risk', () => {
    const content = Object.values(buildMidAutumnSaleSections({ E: emojiResolver, customEmojis })).join('\n');
    expect(content).toContain('gia hạn tự động');
    expect(content).toContain('Bảo hành 02 ngày');
    expect(content).toContain('Không bảo hành');
    expect(content).toContain('Bảo hành 06 tháng');
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
      expect(payload.allowedMentions.roles).toEqual(index === 0 ? [MID_AUTUMN_SALE.memberRoleId] : []);
      const json = JSON.stringify(payload);
      expect(json).toContain(`${MID_AUTUMN_SALE.marker}-PART-${index + 1}`);
      if (index === 0) {
        expect(json).toContain('@everyone');
        expect(json).toContain(`<@&${MID_AUTUMN_SALE.memberRoleId}>`);
      } else expect(json).not.toContain('@everyone');
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
    expect(isStaleCampaignEmojiName('cenar_event_moon')).toBe(true);
    expect(isStaleCampaignEmojiName('cenar_daily_tag')).toBe(true);
    expect(isStaleCampaignEmojiName('cenar_moonfest_rabbit')).toBe(false);
    expect(isStaleCampaignEmojiName('cenar_sale_gift')).toBe(false);
    expect(isStaleCampaignEmojiName('cenar_warranty_shield')).toBe(false);
  });
});

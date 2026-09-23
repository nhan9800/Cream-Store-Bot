import { describe, expect, it } from 'vitest';
import {
  PUBG_DRAMA_SALE,
  buildPubgDramaSaleMessages,
  buildPubgDramaSaleSections,
  isStaleCampaignEmojiName,
} from '../src/campaigns/pubgDramaSale2026.js';

const customEmojis = {
  cenar_pubg_cow: {
    text: '<:cenar_pubg_cow:1539999999999999999>',
    component: { id: '1539999999999999999', name: 'cenar_pubg_cow', animated: false },
  },
};

describe('PUBG trend sale campaign', () => {
  it('renders the supplied prices and neutral trend disclaimer', () => {
    const sections = buildPubgDramaSaleSections({ customEmojis });
    const payload = Object.values(sections).join('\n');

    expect(PUBG_DRAMA_SALE.marker).toBe('CENAR-PUBG-TREND-SALE-2026');
    expect(payload).toContain('02 tháng · xử lý 1–3 ngày` — **99.000đ**');
    expect(payload).toContain('02 tháng · có liền` — **120.000đ**');
    expect(payload).toContain('12 tháng · mua thẳng 01 năm · có liền` — **830.000đ**');
    expect(payload).toContain('NETFLIX PREMIUM · 4K PRIVATE');
    expect(payload).toContain('Pro 5x · team 04 slot` — **79.000đ/slot**');
    expect(payload).toContain('Pro 5x · team 02 slot` — **150.000đ/slot**');
    expect(payload).toContain('Acc ChatGPT Pro 5x` — **250.000đ** · **BH 30 phút · file JSON**');
    expect(payload).toContain('Tỷ lệ lỗi/die của gói MoMo Pay shop ghi nhận khoảng 2%');
    expect(payload).toContain('không liên quan đến bất kỳ sự kiện, đơn vị hay bên thứ ba nào');
    expect(payload).toContain('<:cenar_pubg_cow:1539999999999999999>');
    expect(payload).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('builds three idempotent Components V2 messages with one initial mention', () => {
    const messages = buildPubgDramaSaleMessages({
      customEmojis,
      tagEveryone: true,
      tagMember: true,
    });
    expect(messages).toHaveLength(3);
    expect(JSON.stringify(messages[0])).toContain(PUBG_DRAMA_SALE.marker);
    expect(messages[0].allowedMentions.parse).toEqual(['everyone']);
    expect(messages[0].allowedMentions.roles).toEqual([PUBG_DRAMA_SALE.memberRoleId]);
    expect(messages[1].allowedMentions.parse).toEqual([]);
    expect(messages[2].allowedMentions.parse).toEqual([]);
  });

  it('recognizes legacy campaign emoji names for cleanup', () => {
    expect(isStaleCampaignEmojiName('cenar_moonfest_rabbit')).toBe(true);
    expect(isStaleCampaignEmojiName('cenar_daily_tag')).toBe(true);
    expect(isStaleCampaignEmojiName('cenar_pubg_cow')).toBe(false);
  });
});

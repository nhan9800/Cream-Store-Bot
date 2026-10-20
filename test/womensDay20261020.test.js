import { describe, expect, it } from 'vitest';
import { WOMENS_DAY_GROUPS, WOMENS_DAY, WOMENS_DAY_EMOJIS,
  buildWomensDayCampaign, campaignText, validateWomensDayPayload } from '../src/campaigns/womensDay20261020.js';
import { AUTOMATIC_MARKETING_PAUSED, AUTOMATIC_PRICE_BOARD_PAUSED } from '../src/config/marketingAutomationPolicy.js';

function fixture() {
  const names = [...new Set([...WOMENS_DAY_GROUPS.map((g) => g.emoji), ...WOMENS_DAY_EMOJIS.map((a) => a.name)])];
  return { emojis: Object.fromEntries(names.map((name, i) => [name, {
    id: String(1550000000000000100n + BigInt(i)), name, animated: name.includes('ribbon'),
  }])) };
}
describe('20/10 owner price and publication contract', () => {
  it('contains exactly the 29 owner-supplied prices and conditions, with retired offers absent', () => {
    expect(Object.fromEntries(WOMENS_DAY_GROUPS.map((g) => [g.key, g.offers.map((r) => r.price)]))).toEqual({
      nitro: [85000, 99000, 120000, 230000, 330000, 450000, 550000, 830000, 55000],
      boost: [110000, 290000], gemini: [150000, 200000], office: [200000],
      chatgpt: [130000, 480000, 650000], capcut: [55000, 350000], combo: [320000, 650000],
      netflix: [75000], spotify: [110000, 190000, 290000], youtube: [58000, 185000, 295000, 530000],
    });
    const p = buildWomensDayCampaign(fixture());
    expect(p.offerCount).toBe(29);
    const value = p.boards.map(campaignText).join('\n');
    expect(value).toContain('2 tháng · chờ 1–3 ngày');
    expect(value).toContain('Bảo hành 15 ngày');
    expect(value).toContain('1 tháng · chính chủ');
    expect(value).toContain('4 tháng** — `650.000đ` · Bảo hành full');
    expect(value).toContain('2 năm · không bảo hành** — `320.000đ`');
    expect(value).toContain('2 năm · bảo hành full** — `650.000đ`');
    expect(value).not.toMatch(/Pro 5x|JSON|SUPER DUOLINGO|Bảo hành 10 ngày|Bảo hành 6 tháng|Mail không bao giờ|Opus|Sonnet/);
  });
  it('keeps every panel within Discord limits, custom-only emoji, and no notifications/automatic re-posts', () => {
    const p = buildWomensDayCampaign(fixture());
    expect(p.boards).toHaveLength(3);
    expect(AUTOMATIC_MARKETING_PAUSED).toBe(true);
    expect(AUTOMATIC_PRICE_BOARD_PAUSED).toBe(true);
    for (const payload of [...p.boards, p.notice, p.greeting]) {
      expect(validateWomensDayPayload(payload).textLength).toBeLessThanOrEqual(4000);
      expect(payload.allowed_mentions).toEqual({ parse: [], users: [], roles: [], replied_user: false });
      expect(campaignText(payload)).not.toMatch(/@everyone|@here|<@|\p{Extended_Pictographic}/u);
    }
    expect(JSON.stringify(p.greeting)).toContain('/1515008584549797979/1558114533179138169');
    expect(campaignText(p.greeting)).toContain('NGÀY PHỤ NỮ VIỆT NAM');
    expect(campaignText(p.greeting)).toContain(WOMENS_DAY.marker);
  });
  it('fails closed when custom emoji are missing or a payload contains an accidental ping', () => {
    const f = fixture(); delete f.emojis.cenar_2010_tulips;
    expect(() => buildWomensDayCampaign(f)).toThrow('CAMPAIGN_EMOJI_MISSING');
    const p = buildWomensDayCampaign(fixture()).greeting;
    p.components[0].components[0].content += '\n@everyone';
    expect(() => validateWomensDayPayload(p)).toThrow('CAMPAIGN_UNEXPECTED');
  });
});

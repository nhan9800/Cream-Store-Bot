import { describe, expect, it } from 'vitest';
import {
  DAILY_COLOR_SALE,
  buildDailyColorSaleSections,
  buildDailyFlashSaleMessage,
  dailyFlashSaleDateFromMessage,
  dailyFlashSaleMarker,
  dailySaleDateKey,
  dailySaleTheme,
  isDailyFlashSaleDue,
  isStaleDailyCampaignEmojiName,
  publishDailyFlashSale,
  weeklySaleStory,
} from '../src/campaigns/dailyColorSale2026.js';

const EMOJI_ID = '1539999999999999999';
const customEmojis = Object.fromEntries(['tag', 'leaf', 'gift'].map((name) => [
  `cenar_daily_${name}`,
  {
    text: `<:cenar_daily_${name}:${EMOJI_ID}>`,
    component: { id: EMOJI_ID, name: `cenar_daily_${name}`, animated: false },
  },
]));

function emojiResolver(slot) {
  return `<:${slot}:${EMOJI_ID}>`;
}
emojiResolver.component = (slot) => ({ id: EMOJI_ID, name: slot, animated: false });

describe('Cenar daily Flash Sale story campaign', () => {
  it('renders every supplied price and product condition exactly', () => {
    const sections = buildDailyColorSaleSections({
      E: emojiResolver,
      customEmojis,
      now: new Date('2026-09-29T02:00:00.000Z'),
    });
    const payload = Object.values(sections).join('\n');

    expect(payload).toContain('02 tháng · có liền` — **99.000đ**');
    expect(payload).toContain('02 tháng · có liền · Mail bất tử` — **120.000đ**');
    expect(payload).toContain('04 tháng · có liền` — **250.000đ**');
    expect(payload).toContain('12 tháng · có liền · gia hạn tự động` — **680.000đ**');
    expect(payload).toContain('Trial Boost** · `03 tháng` — **65.000đ**');
    expect(payload).toContain('BOOST SERVER · NÂNG CẤP MÁY CHỦ');
    expect(payload).toContain('`03 tháng` — **280.000đ**');
    expect(payload).toContain('NETFLIX PREMIUM · 4K PRIVATE');
    expect(payload).toContain('Có thể thêm tối đa **05 thành viên**');
    expect(payload).toContain('`18 tháng` — **190.000đ**');
    expect(payload).toContain('OFFICE 365 + ONEDRIVE 1 TB');
    expect(payload).toContain('Pro 5x · ghép Team 04 slot` — **79.000đ/slot**');
    expect(payload).toContain('Acc ChatGPT Pro 5x` — **250.000đ** · **BH 60 phút');
    expect(payload).toContain('CAPCUT PRO');
    expect(payload).toContain('`06 tháng` — **290.000đ**');
    expect(payload).toContain('SPOTIFY PREMIUM');
    expect(payload).toContain('`03 tháng` — **110.000đ**');
    expect(payload).toContain('YOUTUBE PREMIUM · DÒNG ỔN ĐỊNH');
    expect(payload).toContain('`01 tháng` — **58.000đ**');
    expect(payload).toContain('CÒN NHIỀU SẢN PHẨM KHÁC GIÁ RẤT ƯU ĐÃI');
  });

  it('keeps one story Monday-Sunday while advancing one chapter per day', () => {
    const monday = weeklySaleStory(new Date('2026-09-28T02:00:00.000Z'));
    const tuesday = weeklySaleStory(new Date('2026-09-29T02:00:00.000Z'));
    const nextMonday = weeklySaleStory(new Date('2026-10-05T02:00:00.000Z'));

    expect(tuesday.weekKey).toBe(monday.weekKey);
    expect(tuesday.title).toBe(monday.title);
    expect(monday.dayIndex).toBe(0);
    expect(tuesday.dayIndex).toBe(1);
    expect(nextMonday.weekKey).not.toBe(monday.weekKey);
  });

  it('changes the brand direction by month and publishes from 09:00 Vietnam time', () => {
    const september = dailySaleTheme(new Date('2026-09-29T02:00:00.000Z'));
    const october = dailySaleTheme(new Date('2026-10-01T02:00:00.000Z'));

    expect(october.name).not.toBe(september.name);
    expect(dailySaleDateKey(new Date('2026-09-28T17:30:00.000Z'))).toBe('2026-09-29');
    expect(isDailyFlashSaleDue(new Date('2026-09-29T01:59:00.000Z'))).toBe(false);
    expect(isDailyFlashSaleDue(new Date('2026-09-29T02:00:00.000Z'))).toBe(true);
  });

  it('builds one role-only daily post with an exact date marker', () => {
    const now = new Date('2026-09-29T02:00:00.000Z');
    const payload = buildDailyFlashSaleMessage({
      E: emojiResolver,
      customEmojis,
      boardMessageId: '1531111111111111111',
      now,
    });
    const json = JSON.stringify(payload);

    expect(json).toContain(dailyFlashSaleMarker(now));
    expect(json).toContain('Chương 2/7');
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(payload.allowedMentions.roles).toEqual([DAILY_COLOR_SALE.memberRoleId]);
    expect(dailyFlashSaleDateFromMessage({ author: { id: 'bot' }, payload }, 'bot')).toBe('2026-09-29');
    expect(dailyFlashSaleDateFromMessage({ author: { id: 'other' }, payload }, 'bot')).toBeNull();
  });

  it('does not post a second message when today already exists', async () => {
    const now = new Date('2026-09-29T02:00:00.000Z');
    const existing = {
      id: '1532222222222222222',
      author: { id: 'bot' },
      payload: { marker: dailyFlashSaleMarker(now) },
    };
    let sends = 0;
    const channel = {
      id: DAILY_COLOR_SALE.promotionChannelId,
      name: 'khuyến-mãi',
      isTextBased: () => true,
      isThread: () => false,
      messages: { fetch: async () => new Map([[existing.id, existing]]) },
      permissionsFor: () => ({ has: () => true }),
      send: async () => { sends += 1; },
    };
    const guild = {
      id: DAILY_COLOR_SALE.guildId,
      channels: { fetch: async (id) => (id ? channel : new Map()) },
      roles: { fetch: async () => new Map(), cache: new Map([[DAILY_COLOR_SALE.memberRoleId, {}]]) },
      members: { me: {} },
    };
    const client = {
      user: { id: 'bot' },
      guilds: { cache: new Map([[guild.id, guild]]), fetch: async () => guild },
    };

    const result = await publishDailyFlashSale(client, { now });
    expect(result.status).toBe('already_posted');
    expect(result.messageId).toBe(existing.id);
    expect(sends).toBe(0);
  });

  it('retires old PUBG artwork while preserving the current daily emoji set', () => {
    expect(isStaleDailyCampaignEmojiName('cenar_pubg_cow')).toBe(true);
    expect(isStaleDailyCampaignEmojiName('cenar_daily_tag')).toBe(false);
    expect(isStaleDailyCampaignEmojiName('cenar_daily_retired')).toBe(true);
  });
});

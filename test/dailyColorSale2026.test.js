import { describe, expect, it, vi } from 'vitest';
import { Collection, MessageFlags } from 'discord.js';
import {
  DAILY_COLOR_SALE,
  buildDailyColorSaleSections,
  buildDailyColorSaleMessages,
  buildDailyFlashSaleMessage,
  dailyFlashSaleDateFromMessage,
  dailyFlashSaleMarker,
  dailySaleDateKey,
  dailySaleTheme,
  isDailyFlashSaleDue,
  isStaleDailyCampaignEmojiName,
  publishDailyColorSale,
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

function campaignClient(messages = []) {
  const history = new Collection(messages.map((message) => [message.id, message]));
  let sequence = 0;
  const edits = [];
  const sends = [];
  const deletions = [];
  function message(id, payload, authorId = 'bot') {
    const result = {
      id, author: { id: authorId }, payload,
      mentions: { everyone: false, roles: new Collection() },
      toJSON: () => ({ id, author: { id: authorId }, payload: result.payload }),
      edit: vi.fn(async (next) => {
        result.payload = next;
        edits.push({ id, payload: next });
        return result;
      }),
      delete: async () => { history.delete(id); deletions.push(id); },
    };
    return result;
  }
  for (const item of messages) history.set(item.id, message(item.id, item.payload, item.author?.id));
  const channel = {
    id: DAILY_COLOR_SALE.promotionChannelId,
    name: 'khuyến-mãi',
    isTextBased: () => true,
    isThread: () => false,
    messages: { fetch: async () => history },
    permissionsFor: () => ({ has: () => true }),
    send: async (payload) => {
      const sent = message(`15399999999999999${String(sequence++).padStart(2, '0')}`, payload);
      history.set(sent.id, sent);
      sends.push(sent);
      return sent;
    },
  };
  const emojis = new Collection(['tag', 'leaf', 'gift'].map((name) => [name, {
    id: EMOJI_ID, name: `cenar_daily_${name}`, animated: false,
  }]));
  const guild = {
    id: DAILY_COLOR_SALE.guildId,
    channels: { fetch: async (id) => (id ? channel : new Collection()) },
    roles: { fetch: async () => new Collection(), cache: new Collection([[DAILY_COLOR_SALE.memberRoleId, {}]]) },
    emojis: { fetch: async () => emojis, cache: emojis },
    members: { me: {} },
  };
  return {
    client: { user: { id: 'bot' }, guilds: { cache: new Collection([[guild.id, guild]]), fetch: async () => guild } },
    history, sends, edits, deletions,
  };
}

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
    expect(payload).toContain('CAPCUT PRO');
    expect(payload).toContain('`06 tháng` — **290.000đ**');
    expect(payload).toContain('SPOTIFY PREMIUM');
    expect(payload).toContain('`03 tháng` — **110.000đ**');
    expect(payload).toContain('YOUTUBE PREMIUM · DÒNG ỔN ĐỊNH');
    expect(payload).toContain('`01 tháng` — **58.000đ**');
    expect(payload).toContain('CÒN NHIỀU SẢN PHẨM KHÁC GIÁ RẤT ƯU ĐÃI');
  });

  it('replaces the promotional AI offers with all ten new exact prices and warranty distinctions', () => {
    const sections = buildDailyColorSaleSections({ E: emojiResolver, customEmojis });
    const payload = Object.values(sections).join('\n');
    expect(sections.chatgptOwn).toContain('Plus · bảo hành gói` — **485.000đ** · Không bảo hành tài khoản');
    expect(sections.chatgptOwn).toContain('Plus · bảo hành full` — **500.000đ**');
    expect(sections.chatgptOwn).toContain('Pro 100 · bảo hành gói` — **2.650.000đ**');
    expect(sections.chatgptOwn).toContain('Pro 200` — **4.800.000đ**');
    expect(sections.chatgptOwn).toContain('Pro 500` — **12.700.000đ**');
    expect(sections.chatgptOwn).toContain('Pro 200 và Pro 500: xác nhận chính sách bảo hành');
    expect(sections.chatgptSuppliedClaude).toContain('Pro 100 · KBH` — **1.900.000đ** · Không bảo hành');
    expect(sections.chatgptSuppliedClaude).toContain('Pro 100 · BHF` — **2.300.000đ** · Bảo hành full');
    expect(sections.chatgptSuppliedClaude).toContain('Cấp acc · bảo hành 02 ngày` — **120.000đ**');
    expect(sections.chatgptSuppliedClaude).toContain('CLAUDE PRO x5');
    expect(sections.chatgptSuppliedClaude).toContain('01 tháng · KBH` — **1.900.000đ**');
    expect(sections.chatgptSuppliedClaude).toContain('01 tháng · BHF` — **2.500.000đ**');
    expect(payload).toContain('đều có thời hạn **01 tháng**');
    expect(payload).not.toMatch(/MOMO PAY|130\.000đ|390\.000đ|ghép Team|file JSON|tỷ lệ lỗi/);
    expect(payload).not.toMatch(/giảm \d+%|chỉ còn \d+|hết hôm nay/i);
  });

  it('keeps four readable board parts within Discord message budgets and only mentions on part one', () => {
    const payloads = buildDailyColorSaleMessages({ E: emojiResolver, customEmojis, now: new Date('2026-10-02T02:00:00Z') });
    expect(payloads).toHaveLength(4);
    for (const [index, payload] of payloads.entries()) {
      const json = payload.components.map((component) => component.toJSON());
      function flatten(components) { return components.flatMap((item) => [item, ...flatten(item.components || [])]); }
      const components = flatten(json);
      const text = components.filter((item) => item.type === 10).map((item) => item.content).join('');
      expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
      expect(text).toContain(`${DAILY_COLOR_SALE.marker}-PART-${index + 1}`);
      expect(text).toContain(DAILY_COLOR_SALE.revision);
      expect(text.length).toBeLessThanOrEqual(4000);
      expect(components.length).toBeLessThanOrEqual(40);
      if (index) expect(payload.allowedMentions).toMatchObject({ parse: [], roles: [] });
    }
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

  it('tells seven distinct chapters from the same premise across a month boundary', () => {
    const days = Array.from({ length: 7 }, (_, index) => weeklySaleStory(new Date(Date.UTC(2026, 8, 28 + index, 2))));
    expect(new Set(days.map((day) => day.title)).size).toBe(1);
    expect(new Set(days.map((day) => day.premise)).size).toBe(1);
    expect(new Set(days.map((day) => day.chapter.copy)).size).toBe(7);
    expect(days.map((day) => day.dayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(days[0].chapter.focus).toContain('ChatGPT');
    expect(days[3].chapter.focus).toContain('Claude');
    expect(days[5].chapter.focus).toContain('Netflix');
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
      payload: { marker: dailyFlashSaleMarker(now), revision: DAILY_COLOR_SALE.revision },
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

  it('upgrades the existing board and today\'s old post once, without a duplicate daily post or mention', async () => {
    const now = new Date('2026-10-02T02:00:00Z');
    const previous = [1, 2, 3].map((part) => ({
      id: `153111111111111111${part}`, author: { id: 'bot' },
      payload: { marker: `${DAILY_COLOR_SALE.marker}-PART-${part}`, text: 'old AI pricing' },
    }));
    const dailyId = '1532222222222222222';
    const state = campaignClient([
      ...previous,
      { id: dailyId, author: { id: 'bot' }, payload: { marker: dailyFlashSaleMarker(now) } },
      { id: '1533333333333333333', author: { id: 'member' }, payload: { text: 'Keep member message' } },
      { id: '1534444444444444444', author: { id: 'bot' }, payload: { text: 'Keep unrelated bot message' } },
    ]);
    const result = await publishDailyFlashSale(state.client, { now });
    expect(result).toMatchObject({ status: 'already_posted', action: 'updated', messageId: dailyId });
    expect(state.sends).toHaveLength(1); // Only the new fourth board part.
    expect(state.edits).toHaveLength(4); // Three existing board parts and today's post.
    expect(state.deletions).toEqual([]);
    for (const edit of state.edits) expect(edit.payload.allowedMentions).toMatchObject({ parse: [], roles: [] });
    expect(JSON.stringify(state.history.get(dailyId).payload)).toContain(DAILY_COLOR_SALE.revision);
    const again = await publishDailyFlashSale(state.client, { now });
    expect(again).toMatchObject({ status: 'already_posted', action: 'current', messageId: dailyId });
    expect(state.sends).toHaveLength(1);
    expect(state.edits).toHaveLength(4);
  });

  it('retries an interrupted daily revision by editing its same message', async () => {
    const now = new Date('2026-10-02T02:00:00Z');
    const dailyId = '1532222222222222222';
    const state = campaignClient([{ id: dailyId, author: { id: 'bot' }, payload: { marker: dailyFlashSaleMarker(now) } }]);
    await publishDailyColorSale(state.client, { now, tagEveryone: false, tagMember: false });
    state.history.get(dailyId).edit.mockRejectedValueOnce(new Error('Discord temporarily unavailable'));
    await expect(publishDailyFlashSale(state.client, { now })).rejects.toThrow('temporarily unavailable');
    const retried = await publishDailyFlashSale(state.client, { now });
    expect(retried).toMatchObject({ status: 'already_posted', action: 'updated', messageId: dailyId });
    expect(state.sends).toHaveLength(4); // Board only; no second daily message on retry.
  });

  it('retires old PUBG artwork while preserving the current daily emoji set', () => {
    expect(isStaleDailyCampaignEmojiName('cenar_pubg_cow')).toBe(true);
    expect(isStaleDailyCampaignEmojiName('cenar_daily_tag')).toBe(false);
    expect(isStaleDailyCampaignEmojiName('cenar_daily_retired')).toBe(true);
  });
});

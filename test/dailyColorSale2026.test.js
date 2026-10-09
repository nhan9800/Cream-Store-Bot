import { describe, expect, it, vi } from 'vitest';
// Retain campaign mechanics coverage for a future explicitly authorized run.
// Production stays paused; marketingPause.test.js covers its real default.
vi.mock('../src/config/marketingAutomationPolicy.js', () => ({ AUTOMATIC_MARKETING_PAUSED: false }));
import { Collection, MessageFlags, MessagePayload, PermissionFlagsBits } from 'discord.js';
import { rebuildPromotionCampaign } from '../src/services/promotionRebuildService.js';
import {
  DAILY_COLOR_SALE,
  DAILY_COLOR_SALE_EMOJIS,
  preparePromotionRebuild,
  dailyColorSalePart,
  buildDailyColorSaleSections,
  buildDailyColorSaleMessages,
  buildDailyFlashSaleMessage,
  dailyFlashSaleDateFromMessage,
  dailyFlashSaleMarker,
  dailyFlashSaleNonce,
  dailySaleDateKey,
  dailySaleTheme,
  isDailyFlashSaleDue,
  isStaleDailyCampaignEmojiName,
  publishDailyColorSale,
  publishDailyFlashSale,
  weeklySaleStory,
} from '../src/campaigns/dailyColorSale2026.js';

vi.mock('../src/services/promotionRebuildService.js', () => ({ rebuildPromotionCampaign: vi.fn(async () => ({ status: 'DONE' })) }));

const EMOJI_ID = '1539999999999999999';
const customEmojis = Object.fromEntries(['ticket', 'cup', 'spark', 'leaves'].map((name) => [
  `cenar_autumn_202610_${name}`,
  {
    text: `<:cenar_autumn_202610_${name}:${EMOJI_ID}>`,
    component: { id: EMOJI_ID, name: `cenar_autumn_202610_${name}`, animated: false },
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
      delete: vi.fn(async () => { history.delete(id); deletions.push(id); }),
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
  const emojis = new Collection(['ticket', 'cup', 'spark', 'leaves'].map((name) => [name, {
    id: EMOJI_ID, name: `cenar_autumn_202610_${name}`, animated: false,
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
  it('restores old sale rows alongside new AI tiers and the full catalog', () => {
    const sections = buildDailyColorSaleSections({ E: emojiResolver, customEmojis, now: new Date('2026-10-02T02:00:00Z') });
    const text = Object.values(sections).join('\n');
    expect(text).toContain('**99.000đ**');
    expect(text).toContain('Mail bất tử');
    expect(text).toContain('**680.000đ**');
    expect(text).toContain('Trial Boost');
    expect(text).toContain('**65.000đ**');
    expect(text).toContain('MoMo Pay');
    expect(text).toContain('**130.000đ**');
    expect(text).toContain('**390.000đ**');
    expect(text).toContain('**79.000đ/slot**');
    expect(text).toContain('**150.000đ/slot**');
    expect(text).toContain('**250.000đ**');
    expect(text).toContain('60 phút');
    expect(text).toContain('Adobe');
    expect(text).toContain('Locket');
    expect(text).toContain('GearUP');
    expect(text).toContain('Bot Custom');
    expect(text).toContain('API Codex/Claude');
    expect(text).toContain('**155.000đ**');
    expect(text).toContain('Không giới hạn ngày');
    expect(text).not.toContain('ngày đầu');
    expect(text).toContain('**Từ 500.000đ**');
    expect(text).toContain('Giá khuyến mãi shop đã công bố');
    expect(text).toContain('Giá niêm yết hiện hành');
    expect(text).not.toMatch(/\dđgói|\dđslot|\/slot\/slot|giảm \d+%|chỉ còn \d+|hết hôm nay/i);
  });

  it('keeps all ten new AI prices, account forms and separate warranty terms', () => {
    const text = Object.values(buildDailyColorSaleSections({ E: emojiResolver, customEmojis })).join('\n');
    for (const price of ['485.000đ', '500.000đ', '2.650.000đ', '4.800.000đ', '12.700.000đ', '1.900.000đ', '2.300.000đ', '120.000đ', '2.500.000đ']) {
      expect(text).toContain(`**${price}**`);
    }
    expect(text).toContain('Không BH acc');
    expect(text).toContain('BH 2 ngày');
    expect(text).toContain('Claude Pro x5');
    expect(text).toContain('Xác nhận phạm vi bảo hành');
    expect(text).toContain('Loại Plus/Pro chưa được xác nhận');
    expect(text).toContain('không cam kết');
  });

  it('renders complete rows across bounded dynamic board parts and uses the new artwork', () => {
    const payloads = buildDailyColorSaleMessages({ E: emojiResolver, customEmojis, now: new Date('2026-10-02T02:00:00Z') });
    expect(payloads.length).toBeGreaterThanOrEqual(8);
    for (const [index, payload] of payloads.entries()) {
      const json = payload.components.map((component) => component.toJSON());
      function flatten(components) { return components.flatMap((item) => [item, ...flatten(item.components || [])]); }
      const components = flatten(json);
      const text = components.filter((item) => item.type === 10).map((item) => item.content).join('');
      expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
      expect(text).toContain(`${DAILY_COLOR_SALE.marker}-PART-${index + 1}`);
      expect(text).toContain(DAILY_COLOR_SALE.revision);
      expect(text.length).toBeLessThanOrEqual(3500);
      expect(components.length).toBeLessThanOrEqual(38);
      if (index) expect(payload.allowedMentions).toMatchObject({ parse: [], roles: [] });
      else {
        expect(payload.files[0].name).toBe('cenar-autumn-atelier-202610.png');
        expect(json[0].components.some((component) => component.type === 12)).toBe(true);
      }
      expect(JSON.stringify(payload)).not.toMatch(/cenar_daily_|CENAR STUDIO/);
    }
    expect(dailyColorSalePart({ author: { id: 'bot' }, text: `${DAILY_COLOR_SALE.marker}-PART-12` }, 'bot')).toBe(12);
  });

  it('prepares all assets and silent payloads before the cutover', async () => {
    const state = campaignClient();
    const guild = [...state.client.guilds.cache.values()][0];
    const prepared = await preparePromotionRebuild(guild, { now: new Date('2026-10-02T02:00:00Z') });
    expect(prepared.saleData.rows).toHaveLength(88);
    expect(prepared.emojiNames).toEqual(DAILY_COLOR_SALE_EMOJIS.map((asset) => asset.name));
    expect(prepared.boardPayloads[0].files).toHaveLength(1);
    for (const payload of [...prepared.boardPayloads, prepared.buildDailyPayload('1531111111111111111')]) {
      expect(payload.allowedMentions).toMatchObject({ parse: [], roles: [], users: [] });
    }
  });

  it('waits for the durable rebuild before the regular publisher can edit or send', async () => {
    const now = new Date('2026-10-02T02:00:00Z');
    const state = campaignClient();
    let finish;
    vi.mocked(rebuildPromotionCampaign).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = publishDailyColorSale(state.client, { now, tagEveryone: false, tagMember: false });
    await Promise.resolve();
    expect(state.edits).toEqual([]);
    expect(state.sends).toEqual([]);
    finish({ status: 'DONE' });
    await pending;
    expect(state.sends).toHaveLength(buildDailyColorSaleMessages({ now }).length);
  });

  it('removes October artwork on later monthly revisions instead of mislabeling the banner', () => {
    const payloads = buildDailyColorSaleMessages({ customEmojis, now: new Date('2026-11-02T02:00:00Z') });
    expect(payloads[0].files).toBeUndefined();
    expect(payloads[0].attachments).toEqual([]);
    expect(JSON.stringify(payloads[0])).not.toContain('attachment://cenar-autumn');
    expect(JSON.stringify(payloads)).toContain('Gom Điều Hay');
    expect(JSON.stringify(payloads)).not.toContain('Trạm Thu Dịu');
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

  it('builds one everyone-only daily post with an exact date marker', () => {
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
    expect(payload.allowedMentions.parse).toEqual(['everyone']);
    expect(payload.allowedMentions.roles).toEqual([]);
    expect(json.match(/@everyone/g)).toHaveLength(1);
    expect(json).not.toContain(`<@&${DAILY_COLOR_SALE.memberRoleId}>`);
    expect(dailyFlashSaleDateFromMessage({ author: { id: 'bot' }, payload }, 'bot')).toBe('2026-09-29');
    expect(dailyFlashSaleDateFromMessage({ author: { id: 'other' }, payload }, 'bot')).toBeNull();
  });

  it('allows an explicitly silent daily payload and optional member-only manual payload', () => {
    const common = { E: emojiResolver, customEmojis, boardMessageId: '1531111111111111111' };
    const silent = buildDailyFlashSaleMessage({ ...common, tagEveryone: false });
    expect(silent.allowedMentions).toMatchObject({ parse: [], roles: [], users: [] });
    expect(JSON.stringify(silent)).not.toMatch(/@everyone|<@&/);
    const member = buildDailyFlashSaleMessage({ ...common, tagEveryone: false, tagMember: true });
    expect(member.allowedMentions).toMatchObject({ parse: [], roles: [DAILY_COLOR_SALE.memberRoleId] });
    expect(JSON.stringify(member)).not.toContain('@everyone');
  });

  it('notifies everyone only on a fresh daily chapter, leaving all board parts and restart silent', async () => {
    const now = new Date('2026-10-03T02:00:00Z');
    const state = campaignClient();
    [...state.client.guilds.cache.values()][0].roles.cache.clear();
    const [first, concurrent] = await Promise.all([
      publishDailyFlashSale(state.client, { now }),
      publishDailyFlashSale(state.client, { now }),
    ]);
    expect(first).toMatchObject({ status: 'posted', action: 'created' });
    expect(concurrent.messageId).toBe(first.messageId);
    const dailyPosts = state.sends.filter((message) => dailyFlashSaleDateFromMessage(message, 'bot'));
    expect(dailyPosts).toHaveLength(1);
    expect(dailyPosts[0].payload.allowedMentions).toMatchObject({ parse: ['everyone'], roles: [], users: [] });
    expect(dailyPosts[0].payload.nonce).toBe(dailyFlashSaleNonce(DAILY_COLOR_SALE.guildId, now));
    expect(dailyPosts[0].payload.enforceNonce).toBe(true);
    expect(JSON.stringify(dailyPosts[0].payload).match(/@everyone/g)).toHaveLength(1);
    const boardPosts = state.sends.filter((message) => dailyColorSalePart(message, 'bot'));
    expect(boardPosts).toHaveLength(buildDailyColorSaleMessages({ now }).length);
    for (const board of boardPosts) {
      expect(board.payload.allowedMentions).toMatchObject({ parse: [], roles: [] });
      expect(JSON.stringify(board.payload)).not.toMatch(/@everyone|<@&/);
    }
    const sendCount = state.sends.length;
    expect(await publishDailyFlashSale(state.client, { now })).toMatchObject({ status: 'already_posted', messageId: first.messageId });
    expect(state.sends).toHaveLength(sendCount);
    expect(state.edits).toEqual([]);
  });

  it('rechecks history after the board refresh and keeps a concurrently posted current chapter', async () => {
    const now = new Date('2026-10-03T02:00:00Z');
    const state = campaignClient();
    const channel = await [...state.client.guilds.cache.values()][0].channels.fetch(DAILY_COLOR_SALE.promotionChannelId);
    const concurrentId = '1532222222222222222';
    const concurrent = {
      id: concurrentId, author: { id: 'bot' },
      payload: { marker: dailyFlashSaleMarker(now), revision: DAILY_COLOR_SALE.revision },
      edit: vi.fn(), delete: vi.fn(),
    };
    let fetches = 0;
    channel.messages.fetch = async () => {
      fetches += 1;
      // Daily first read, board read, then daily's second read.
      if (fetches === 3) state.history.set(concurrentId, concurrent);
      return new Collection(state.history);
    };
    expect(await publishDailyFlashSale(state.client, { now })).toMatchObject({ status: 'already_posted', messageId: concurrentId });
    expect(state.sends).toHaveLength(buildDailyColorSaleMessages({ now }).length);
    expect(state.sends.some((message) => dailyFlashSaleDateFromMessage(message, 'bot'))).toBe(false);
    expect(concurrent.edit).not.toHaveBeenCalled();
  });

  it('silently upgrades an old-revision chapter appearing during the board refresh', async () => {
    const now = new Date('2026-10-03T02:00:00Z');
    const state = campaignClient();
    const channel = await [...state.client.guilds.cache.values()][0].channels.fetch(DAILY_COLOR_SALE.promotionChannelId);
    const concurrentId = '1532222222222222222';
    const concurrent = { id: concurrentId, author: { id: 'bot' }, payload: { marker: dailyFlashSaleMarker(now) }, edit: vi.fn(), delete: vi.fn() };
    concurrent.edit.mockImplementation(async (payload) => { concurrent.payload = payload; return concurrent; });
    let fetches = 0;
    channel.messages.fetch = async () => {
      if (++fetches === 3) state.history.set(concurrentId, concurrent);
      return new Collection(state.history);
    };
    expect(await publishDailyFlashSale(state.client, { now })).toMatchObject({ status: 'already_posted', action: 'updated', messageId: concurrentId });
    expect(concurrent.edit).toHaveBeenCalledOnce();
    const edited = concurrent.edit.mock.calls[0][0];
    expect(edited.allowedMentions).toMatchObject({ parse: [], roles: [] });
    expect(edited.nonce).toBeUndefined();
    expect(edited.enforceNonce).toBeUndefined();
    expect(JSON.stringify(edited)).not.toMatch(/@everyone|<@&/);
    expect(state.sends).toHaveLength(buildDailyColorSaleMessages({ now }).length);
  });

  it('uses the same Discord-enforced guild/date nonce across independent publisher instances', async () => {
    const now = new Date('2026-10-03T02:00:00Z');
    // A reset creates independent module-level promise guards, as two
    // processes would have, while retaining the first publisher reference.
    vi.resetModules();
    const independent = await import('../src/campaigns/dailyColorSale2026.js');
    const left = campaignClient();
    const right = campaignClient();
    await Promise.all([
      publishDailyFlashSale(left.client, { now }),
      independent.publishDailyFlashSale(right.client, { now }),
    ]);
    const payloads = [left, right].map((state) => state.sends.find((message) => dailyFlashSaleDateFromMessage(message, 'bot')).payload);
    expect(payloads[0].nonce).toBe(payloads[1].nonce);
    expect(payloads[0].nonce.length).toBeLessThanOrEqual(25);
    expect(payloads[0].nonce).not.toBe(dailyFlashSaleNonce(DAILY_COLOR_SALE.guildId, new Date('2026-10-04T02:00:00Z')));
    expect(payloads[0].nonce).not.toBe(dailyFlashSaleNonce('1282637033340403755', now));
    for (const payload of payloads) {
      const apiBody = MessagePayload.create({ client: { options: {} } }, payload).resolveBody().body;
      expect(apiBody.enforce_nonce).toBe(true);
      expect(apiBody.nonce).toBe(payload.nonce);
      expect(apiBody.allowed_mentions.parse).toEqual(['everyone']);
    }
  });

  it('refuses a new everyone post without permission while allowing silent existing-post recovery', async () => {
    const now = new Date('2026-10-03T02:00:00Z');
    const state = campaignClient();
    const guild = [...state.client.guilds.cache.values()][0];
    const channel = await guild.channels.fetch(DAILY_COLOR_SALE.promotionChannelId);
    channel.permissionsFor = () => ({ has: (permissions) => Array.isArray(permissions)
      ? !permissions.includes(PermissionFlagsBits.MentionEveryone)
      : permissions !== PermissionFlagsBits.MentionEveryone });
    await expect(publishDailyFlashSale(state.client, { now })).rejects.toThrow('Mention Everyone');
    expect(state.sends).toEqual([]);
    const currentId = '1532222222222222222';
    const current = campaignClient([{ id: currentId, author: { id: 'bot' }, payload: {
      marker: dailyFlashSaleMarker(now), revision: DAILY_COLOR_SALE.revision,
    } }]);
    const currentChannel = await [...current.client.guilds.cache.values()][0].channels.fetch(DAILY_COLOR_SALE.promotionChannelId);
    currentChannel.permissionsFor = channel.permissionsFor;
    expect(await publishDailyFlashSale(current.client, { now })).toMatchObject({ status: 'already_posted', messageId: currentId });
    expect(current.sends).toEqual([]);
    const old = campaignClient([{ id: currentId, author: { id: 'bot' }, payload: { marker: dailyFlashSaleMarker(now) } }]);
    const oldChannel = await [...old.client.guilds.cache.values()][0].channels.fetch(DAILY_COLOR_SALE.promotionChannelId);
    oldChannel.permissionsFor = channel.permissionsFor;
    expect(await publishDailyFlashSale(old.client, { now })).toMatchObject({ status: 'already_posted', action: 'updated', messageId: currentId });
    for (const payload of [...old.sends.map((message) => message.payload), ...old.edits.map((edit) => edit.payload)]) {
      expect(payload.allowedMentions).toMatchObject({ parse: [], roles: [] });
      expect(JSON.stringify(payload)).not.toMatch(/@everyone|<@&/);
    }
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
    expect(state.sends).toHaveLength(buildDailyColorSaleMessages({ now }).length - 3); // Only missing board parts.
    expect(state.edits).toHaveLength(4); // Three existing board parts and today's post.
    expect(state.deletions).toEqual([]);
    for (const edit of state.edits) expect(edit.payload.allowedMentions).toMatchObject({ parse: [], roles: [] });
    expect(JSON.stringify(state.history.get(dailyId).payload)).toContain(DAILY_COLOR_SALE.revision);
    const again = await publishDailyFlashSale(state.client, { now });
    expect(again).toMatchObject({ status: 'already_posted', action: 'current', messageId: dailyId });
    expect(state.sends).toHaveLength(buildDailyColorSaleMessages({ now }).length - 3);
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
    expect(state.sends).toHaveLength(buildDailyColorSaleMessages({ now }).length); // Board only; no extra daily post.
  });

  it('keeps the current revision and removes only same-day bot duplicates', async () => {
    const now = new Date('2026-10-02T02:00:00Z');
    const oldId = '1532222222222222221';
    const currentId = '1532222222222222222';
    const memberId = '1533333333333333333';
    const yesterdayId = '1534444444444444444';
    const unrelatedId = '1535555555555555555';
    const state = campaignClient([
      { id: oldId, author: { id: 'bot' }, payload: { marker: dailyFlashSaleMarker(now) } },
      { id: currentId, author: { id: 'bot' }, payload: { marker: dailyFlashSaleMarker(now), revision: DAILY_COLOR_SALE.revision } },
      { id: memberId, author: { id: 'member' }, payload: { marker: dailyFlashSaleMarker(now) } },
      { id: yesterdayId, author: { id: 'bot' }, payload: { marker: dailyFlashSaleMarker(new Date('2026-10-01T02:00:00Z')) } },
      { id: unrelatedId, author: { id: 'bot' }, payload: { text: 'Unrelated bot announcement' } },
    ]);
    const result = await publishDailyFlashSale(state.client, { now });
    expect(result).toMatchObject({ status: 'already_posted', action: 'deduplicated', messageId: currentId, removedDuplicates: 1 });
    expect(state.deletions).toEqual([oldId]);
    expect([...state.history.keys()]).toEqual([currentId, memberId, yesterdayId, unrelatedId]);
    expect(state.sends).toEqual([]);
    expect(state.edits).toEqual([]);
    expect(await publishDailyFlashSale(state.client, { now })).toMatchObject({ action: 'current', removedDuplicates: 0, messageId: currentId });
  });

  it('chooses a stable canonical ID when multiple current-revision posts exist', async () => {
    const now = new Date('2026-10-02T02:00:00Z');
    const newerId = '1532222222222222222';
    const olderId = '1532222222222222221';
    const state = campaignClient([newerId, olderId].map((id) => ({
      id, author: { id: 'bot' }, payload: { marker: dailyFlashSaleMarker(now), revision: DAILY_COLOR_SALE.revision },
    })));
    const result = await publishDailyFlashSale(state.client, { now });
    expect(result).toMatchObject({ messageId: olderId, removedDuplicates: 1 });
    expect(state.deletions).toEqual([newerId]);
    expect(state.sends).toEqual([]);
  });

  it('leaves old duplicates intact until the canonical revision edit succeeds', async () => {
    const now = new Date('2026-10-02T02:00:00Z');
    const newerId = '1532222222222222222';
    const olderId = '1532222222222222221';
    const state = campaignClient([newerId, olderId].map((id) => ({
      id, author: { id: 'bot' }, payload: { marker: dailyFlashSaleMarker(now) },
    })));
    state.history.get(olderId).edit.mockRejectedValueOnce(new Error('Edit unavailable'));
    await expect(publishDailyFlashSale(state.client, { now })).rejects.toThrow('Edit unavailable');
    expect(state.deletions).toEqual([]);
    const result = await publishDailyFlashSale(state.client, { now });
    expect(result).toMatchObject({ action: 'updated', messageId: olderId, removedDuplicates: 1 });
    expect(state.deletions).toEqual([newerId]);
    expect(state.sends).toHaveLength(buildDailyColorSaleMessages({ now }).length); // Board only, even after edit retry.
  });

  it('does not report a duplicate-cleanup failure as complete and retries without posting or pinging', async () => {
    const now = new Date('2026-10-02T02:00:00Z');
    const currentId = '1532222222222222222';
    const duplicateId = '1532222222222222221';
    const state = campaignClient([
      { id: currentId, author: { id: 'bot' }, payload: { marker: dailyFlashSaleMarker(now), revision: DAILY_COLOR_SALE.revision } },
      { id: duplicateId, author: { id: 'bot' }, payload: { marker: dailyFlashSaleMarker(now) } },
    ]);
    state.history.get(duplicateId).delete.mockRejectedValueOnce(new Error('Missing permission'));
    await expect(publishDailyFlashSale(state.client, { now })).rejects.toMatchObject({ code: 'DAILY_DUPLICATE_CLEANUP_FAILED' });
    expect(state.history.has(duplicateId)).toBe(true);
    expect(await publishDailyFlashSale(state.client, { now })).toMatchObject({ messageId: currentId, removedDuplicates: 1 });
    expect(state.deletions).toEqual([duplicateId]);
    expect(state.sends).toEqual([]);
    expect(state.edits).toEqual([]);
  });

  it('accepts an already deleted duplicate without retrying or losing the canonical post', async () => {
    const now = new Date('2026-10-02T02:00:00Z');
    const currentId = '1532222222222222222';
    const duplicateId = '1532222222222222221';
    const state = campaignClient([
      { id: currentId, author: { id: 'bot' }, payload: { marker: dailyFlashSaleMarker(now), revision: DAILY_COLOR_SALE.revision } },
      { id: duplicateId, author: { id: 'bot' }, payload: { marker: dailyFlashSaleMarker(now) } },
    ]);
    state.history.get(duplicateId).delete.mockRejectedValueOnce({ code: 10008 });
    expect(await publishDailyFlashSale(state.client, { now })).toMatchObject({ status: 'already_posted', messageId: currentId, removedDuplicates: 1 });
    expect(state.history.has(currentId)).toBe(true);
    expect(state.sends).toEqual([]);
  });

  it('retires old campaign artwork while preserving the new autumn collection', () => {
    expect(isStaleDailyCampaignEmojiName('cenar_pubg_cow')).toBe(true);
    expect(isStaleDailyCampaignEmojiName('cenar_daily_tag')).toBe(true);
    expect(isStaleDailyCampaignEmojiName('cenar_autumn_202610_ticket')).toBe(false);
    expect(isStaleDailyCampaignEmojiName('cenar_daily_retired')).toBe(true);
  });
});

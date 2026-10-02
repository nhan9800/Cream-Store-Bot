import Database from 'better-sqlite3';
import { Collection, MessageFlags } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PROMOTION_REBUILD_TARGET, getPromotionRebuildStatus,
  isPromotionSaleMessage, promotionRebuildInternals,
  rebuildPromotionCampaign, waitForPromotionRebuild,
} from '../src/services/promotionRebuildService.js';

const revision = 'CENAR-SALE-REVISION:FULL-STORY-20261002';
const databases = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });

function payload(text) {
  return { flags: MessageFlags.IsComponentsV2,
    components: [{ type: 17, components: [{ type: 10, content: text }] }],
    allowedMentions: { parse: ['everyone'], roles: ['unsafe-role'] } };
}

function setup(initial = []) {
  const database = new Database(':memory:');
  databases.push(database);
  const history = new Collection();
  const events = [];
  let counter = 999n;
  let rejectSendAt = 0;
  let sends = 0;
  let rejectDeleteId = null;
  const createMessage = (id, textOrPayload, author = 'bot') => {
    let body = typeof textOrPayload === 'string' ? payload(textOrPayload) : textOrPayload;
    const message = { id: String(id), author: { id: author },
      toJSON: () => ({ ...body, author: { id: author }, id: String(id) }),
      edit: vi.fn(async (next) => { body = next; events.push(`edit:${id}`); return message; }),
      delete: vi.fn(async () => {
        if (String(id) === rejectDeleteId) throw Object.assign(new Error('discord delete unavailable'), { code: 50013 });
        history.delete(String(id)); events.push(`delete:${id}`);
      }),
    };
    history.set(String(id), message);
    return message;
  };
  for (const item of initial) createMessage(item.id, item.text, item.author || 'bot');
  const channel = { id: PROMOTION_REBUILD_TARGET.channelId, name: 'khuyến-mãi',
    isTextBased: () => true, isThread: () => false, permissionsFor: () => ({ has: () => true }),
    messages: { fetch: vi.fn(async ({ limit, before } = {}) => {
      const entries = [...history.values()].sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1)
        .filter((message) => !before || BigInt(message.id) < BigInt(before)).slice(0, limit || 100);
      return new Collection(entries.map((message) => [message.id, message]));
    }) },
    send: vi.fn(async (body) => {
      sends += 1;
      if (sends === rejectSendAt) throw new Error('discord send unavailable');
      // A snapshot is durable before even the first new send.
      expect(database.prepare('SELECT snapshot_json FROM promotion_rebuild_jobs WHERE revision = ?').get(revision)).toBeDefined();
      expect(body.allowedMentions).toEqual({ parse: [], users: [], roles: [], repliedUser: false });
      const message = createMessage(`155000000000000${counter++}`, body);
      events.push(`send:${message.id}`);
      return message;
    }),
  };
  const guild = { id: PROMOTION_REBUILD_TARGET.guildId,
    channels: { fetch: async () => channel }, members: { me: {} } };
  const client = { isReady: () => true, user: { id: 'bot' }, guilds: {
    cache: new Collection([[guild.id, guild]]), fetch: async () => guild,
  } };
  const prepare = vi.fn(async () => ({
    boardPayloads: [payload(`${revision} CENAR-STORY-FLASH-SALE-V1-PART-1\nCHATGPT 485.000đ`),
      payload(`${revision} CENAR-STORY-FLASH-SALE-V1-PART-2\nNITRO 85.000đ`)],
    buildDailyPayload: (id) => payload(`${revision} CENAR-DAILY-FLASH-SALE:2026-10-02\nhttps://discord.com/channels/${guild.id}/${channel.id}/${id}`),
    saleData: [{ name: 'Nitro', price: 85000 }], emojiNames: ['cenar_new_leaf'],
  }));
  const run = () => rebuildPromotionCampaign(client, { revision, prepare, dbInstance: database,
    now: new Date('2026-10-02T03:00:00Z') });
  return { database, history, events, channel, guild, client, prepare, run,
    rejectSendAt: (index) => { rejectSendAt = index; }, rejectDeleteId: (id) => { rejectDeleteId = id; } };
}

const oldBoard = { id: '1550000000000000010', text: 'CENAR-STORY-FLASH-SALE-V1-PART-1\nOLD NITRO 85.000đ' };
const oldDaily = { id: '1550000000000000011', text: 'CENAR-DAILY-FLASH-SALE:2026-09-29' };

describe('durable public promotion cutover', () => {
  it('reads an unstarted status without creating or changing any table', async () => {
    const state = setup();
    expect(await getPromotionRebuildStatus(revision, { dbInstance: state.database })).toEqual({ status: 'not_started', revision });
    expect(state.database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([]);
  });

  it('archives old prices, publishes new board and daily before deleting every old sale, preserves unrelated/customer messages', async () => {
    const state = setup([oldBoard, oldDaily,
      { id: '1550000000000000012', text: 'CENAR BIRTHDAY SALE 09/08\nOLD PRICES' },
      { id: '1550000000000000013', text: '# <:fire:123> SIÊU SALE HOÀNH TRÁNG — GIẢM GIÁ 10%!' },
      { id: '1550000000000000014', text: 'CENAR-SECURE-TRANSCRIPT-LAUNCH-2026-09' },
      { id: '1550000000000000015', text: oldBoard.text, author: 'customer' },
    ]);
    const result = await state.run();
    expect(result.status).toBe('DONE');
    expect(result.archivedSaleMessages).toBe(4);
    expect(result.deletedSaleMessages).toBe(4);
    const firstDelete = state.events.findIndex((event) => event.startsWith('delete:'));
    expect(state.events.slice(0, firstDelete).filter((event) => event.startsWith('send:'))).toHaveLength(3);
    expect(state.history.has('1550000000000000014')).toBe(true);
    expect(state.history.has('1550000000000000015')).toBe(true);
    const snapshot = JSON.parse(state.database.prepare('SELECT snapshot_json FROM promotion_rebuild_jobs').get().snapshot_json);
    expect(snapshot.saleData).toEqual([{ name: 'Nitro', price: 85000 }]);
    expect(snapshot.messages.some((message) => message.text.includes('OLD NITRO 85.000đ'))).toBe(true);
    expect(snapshot.messages.some((message) => message.id === '1550000000000000015')).toBe(false);
    const daily = promotionRebuildInternals.publicMessageText(state.history.get(result.dailyMessageId));
    expect(daily).toContain(`/${result.boardMessageIds[0]}`);
    expect(daily).not.toContain(`/${oldBoard.id}`);
  });

  it('keeps all old sale if the complete new publication could not be sent; retry resumes without duplicate parts', async () => {
    const state = setup([oldBoard, oldDaily]);
    state.rejectSendAt(2);
    await expect(state.run()).rejects.toThrow('discord send unavailable');
    expect(state.history.has(oldBoard.id)).toBe(true);
    expect(state.history.has(oldDaily.id)).toBe(true);
    expect(state.events.filter((event) => event.startsWith('delete:'))).toHaveLength(0);
    state.rejectSendAt(0);
    const result = await state.run();
    expect(result.status).toBe('DONE');
    expect(state.history.size).toBe(3);
    expect(state.channel.send).toHaveBeenCalledTimes(4); // one failed request, three accepted sends
  });

  it('does not mark a failed cleanup complete and retries it with the existing new IDs', async () => {
    const state = setup([oldBoard, oldDaily]);
    state.rejectDeleteId(oldDaily.id);
    await expect(state.run()).rejects.toMatchObject({ code: 'PROMOTION_OLD_SALE_DELETE_FAILED' });
    const partial = await getPromotionRebuildStatus(revision, { dbInstance: state.database });
    expect(partial.status).toBe('CLEANUP');
    expect(partial.lastError).toBe('PROMOTION_OLD_SALE_DELETE_FAILED');
    expect(partial.boardMessageIds).toHaveLength(2);
    expect(partial.dailyMessageId).toBeTruthy();
    state.rejectDeleteId(null);
    const result = await state.run();
    expect(result.status).toBe('DONE');
    expect(result.boardMessageIds).toEqual(partial.boardMessageIds);
    expect(result.dailyMessageId).toBe(partial.dailyMessageId);
    expect(state.channel.send).toHaveBeenCalledTimes(3);
  });

  it('recovers a Discord send accepted before its ID was persisted via the exact cutover marker', async () => {
    const state = setup([oldBoard]);
    const send = state.channel.send.getMockImplementation();
    let acceptedThenLost = false;
    state.channel.send.mockImplementation(async (body) => {
      const message = await send(body);
      if (!acceptedThenLost) { acceptedThenLost = true; throw new Error('response lost after accepted'); }
      return message;
    });
    await expect(state.run()).rejects.toThrow('response lost after accepted');
    const result = await state.run();
    expect(result.status).toBe('DONE');
    expect(state.history.size).toBe(3);
    expect(state.channel.send).toHaveBeenCalledTimes(3);
  });

  it('does not repeat cleanup at startup or delete valid subsequent daily chapters after DONE', async () => {
    const state = setup([oldBoard]);
    const first = await state.run();
    state.history.set('1550000000000009999', { id: '1550000000000009999', author: { id: 'bot' },
      toJSON: () => ({ content: 'CENAR-DAILY-FLASH-SALE:2026-10-03' }) });
    const second = await state.run();
    expect(second).toEqual(first);
    expect(state.history.has('1550000000000009999')).toBe(true);
    expect(state.prepare).toHaveBeenCalledTimes(1);
    expect(state.channel.send).toHaveBeenCalledTimes(3);
  });

  it('rejects invalid new payloads before publication or deletion', async () => {
    const state = setup([oldBoard]);
    state.prepare.mockResolvedValue({ boardPayloads: [payload('x'.repeat(4000))], buildDailyPayload: () => payload('daily') });
    await expect(state.run()).rejects.toMatchObject({ code: 'PROMOTION_PAYLOAD_DISCORD_LIMIT' });
    expect(state.channel.send).not.toHaveBeenCalled();
    expect(state.history.has(oldBoard.id)).toBe(true);
    expect(state.events).toEqual([]);
  });

  it('refuses any wrong channel, even one with a matching promotion name', async () => {
    const state = setup([oldBoard]);
    state.channel.id = '1550000000000009000';
    await expect(state.run()).rejects.toMatchObject({ code: 'PROMOTION_CHANNEL_MISMATCH' });
    expect(state.prepare).not.toHaveBeenCalled();
    expect(state.events).toEqual([]);
  });

  it('shares the active revision promise and lets ordinary publishers await the same cutover', async () => {
    const state = setup([oldBoard]);
    let release;
    const original = state.prepare.getMockImplementation();
    state.prepare.mockImplementation(async () => {
      await new Promise((resolve) => { release = resolve; });
      return original();
    });
    const first = state.run();
    const second = state.run();
    expect(second).toBe(first);
    await expect(rebuildPromotionCampaign(state.client, { revision: 'OTHER-REVISION' })).rejects.toMatchObject({ code: 'PROMOTION_OTHER_REBUILD_ACTIVE' });
    let completed = false;
    const waiting = waitForPromotionRebuild().then(() => { completed = true; });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(completed).toBe(false);
    release();
    await first;
    await waiting;
    expect(completed).toBe(true);
  });

  it('scans beyond the newest page and fails explicitly when a bounded history is incomplete', async () => {
    const state = setup(Array.from({ length: 105 }, (_, index) => ({
      id: `${1550000000000000000n + BigInt(index)}`, text: index === 0 ? oldBoard.text : 'Unrelated bot notice',
    })));
    const all = await promotionRebuildInternals.fetchHistory(state.channel);
    expect(all).toHaveLength(105);
    expect(all.some((message) => isPromotionSaleMessage(message, 'bot'))).toBe(true);
    await expect(promotionRebuildInternals.fetchHistory(state.channel, 100)).rejects.toMatchObject({ code: 'PROMOTION_HISTORY_LIMIT_EXCEEDED' });
  });

  it('requires explicit sale identity and the bot author, keeping unrelated announcements', () => {
    const message = (content, author = 'bot') => ({ author: { id: author }, toJSON: () => ({ content }) });
    expect(isPromotionSaleMessage(message('Mở ticket để được tư vấn trước khi sale kết thúc'), 'bot')).toBe(false);
    expect(isPromotionSaleMessage(message('CENAR-PROFILE-EFFECT-GIVEAWAY-66K-2026-09'), 'bot')).toBe(false);
    expect(isPromotionSaleMessage(message('CENAR-MID-AUTUMN-SALE-2026'), 'bot')).toBe(true);
    expect(isPromotionSaleMessage(message('CENAR-MID-AUTUMN-SALE-2026', 'customer'), 'bot')).toBe(false);
  });

  it.each([
    '# 🎉 CENAR BIRTHDAY SALE',
    '# 🎆 ĐẠI TIỆC SALE QUỐC KHÁNH 2/9',
    '# 🔥 SALE 2/9 · AI & CÔNG CỤ BẢN QUYỀN',
    '# 🌕 HỘI TRĂNG CENAR',
    '# 🐮 PUBG TREND SALE · CENAR STORE',
    '# <:cow:1539999999999999999> PUBG MEME SALE · AI & CÔNG CỤ BẢN QUYỀN',
    '# 🚀 FLASH SALE · NÂNG CẤP SERVER LEVEL 3',
    '# 🔥 SIÊU SALE HOÀNH TRÁNG — GIẢM GIÁ 10%!',
    '# 🎁 Cream Store — Khuyến Mãi',
    '# 🍃 CENAR STUDIO · SALE 09:00',
    '🔥 **FLASH SALE · BẢNG GIÁ**',
  ])('recognizes markerless legacy promotion heading: %s', (content) => {
    const message = { author: { id: 'bot' }, toJSON: () => ({ components: [{ type: 10, content }] }) };
    expect(isPromotionSaleMessage(message, 'bot')).toBe(true);
  });

  it.each([
    '# 🛡 CENAR NÂNG CẤP LƯU TRANSCRIPT',
    '# 🎉 CENAR NHẬN DỰ ÁN BOT & WEBSITE',
    '## 🎉 CENAR NÂNG CẤP DANH MỤC AI & SÁNG TẠO',
    '# 💬 CENAR HƯỚNG DẪN NITRO LOGIN',
    'Bạn hãy xem bảng giá sale trước khi đặt hàng.',
    'Đã kết thúc chương trình Sale, tất cả sản phẩm đã được khôi phục về giá gốc!',
  ])('preserves unrelated publication despite decorative emoji: %s', (content) => {
    const message = { author: { id: 'bot' }, toJSON: () => ({ content }) };
    expect(isPromotionSaleMessage(message, 'bot')).toBe(false);
  });

  it('preserves campaign uploads and does not change commerce prices or configured sale percentages', async () => {
    const file = { attachment: Buffer.from('new banner'), name: 'new-banner.png' };
    const upload = promotionRebuildInternals.payloadWithMarker({ ...payload('NEW CAMPAIGN'), files: [file], attachments: [] }, 'new-marker');
    expect(upload.files[0]).toBe(file);
    expect(upload.attachments).toEqual([]);
    const state = setup([oldBoard]);
    state.database.exec(`CREATE TABLE product_catalog (price INTEGER, original_price INTEGER);
      INSERT INTO product_catalog VALUES (85000, 100000);
      CREATE TABLE guild_settings (sale_percent INTEGER, sale_message_id TEXT);
      INSERT INTO guild_settings VALUES (15, 'configured-sale-panel');`);
    await state.run();
    expect(state.database.prepare('SELECT * FROM product_catalog').get()).toEqual({ price: 85000, original_price: 100000 });
    expect(state.database.prepare('SELECT * FROM guild_settings').get()).toEqual({ sale_percent: 15, sale_message_id: 'configured-sale-panel' });
  });
});

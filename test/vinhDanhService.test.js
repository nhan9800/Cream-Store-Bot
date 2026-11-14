import { EventEmitter } from 'node:events';
import Database from 'better-sqlite3';
import { ChannelType, Collection } from 'discord.js';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754', clientId: '1382729296724099132' } }));
vi.mock('../src/database/db.js', async () => {
  const { default: Sqlite } = await import('better-sqlite3');
  const db = new Sqlite(':memory:');
  db.exec(`CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE orders(guild_id TEXT,customer_id TEXT,payment_status TEXT,status TEXT,
      amount_paid INTEGER,paid_at TEXT,created_at TEXT)`);
  return { db };
});
vi.mock('../src/utils/emojiHelper.js', () => ({
  createEmojiResolver: () => slot => `<:${slot}:1234567890123456789>`,
}));

import { db as commandDb } from '../src/database/db.js';
import { STORE_SERVICE_FORUM as TARGET } from '../src/config/storeServiceForum202611.js';
import { buildLeaderboardV2, createVinhDanhService } from '../src/services/vinhDanhService.js';
import { execute } from '../src/commands/vinh-danh.js';

const resources = [];
const flatten = value => {
  const node = value?.toJSON?.() || value;
  return [node?.content || '', ...(node?.components || []).map(flatten)].filter(Boolean).join('\n');
};
function fixture({ database, guildId = TARGET.guildId } = {}) {
  const db = database || new Database(':memory:');
  if (!database) db.exec(`CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE orders(guild_id TEXT,customer_id TEXT,payment_status TEXT,status TEXT,
      amount_paid INTEGER,paid_at TEXT,created_at TEXT)`);
  const client = Object.assign(new EventEmitter(), {
    user: { id: '1382729296724099132' }, token: 'synthetic-token', isReady: vi.fn(() => true), rest: {},
    guilds: { cache: new Collection(), fetch: vi.fn() },
  });
  const messages = new Collection();
  const channel = {
    id: guildId === TARGET.guildId ? TARGET.posts.honor : '1600000000000000100',
    guildId, parentId: TARGET.forumId, ownerId: client.user.id,
    type: guildId === TARGET.guildId ? ChannelType.PublicThread : ChannelType.GuildText,
    name: 'bang-vinh-danh', archived: false,
    setArchived: vi.fn(async archived => { channel.archived = archived; return channel; }),
  };
  let serial = 1600000000000000200n;
  const makeMessage = (payload, id = String(++serial)) => {
    const message = { id, channelId: channel.id, author: { id: client.user.id },
      components: payload.components.map(component => component.toJSON?.() || component) };
    message.edit = vi.fn(async next => {
      message.components = next.components.map(component => component.toJSON?.() || component);
      return message;
    });
    messages.set(id, message);
    return message;
  };
  channel.messages = { fetch: vi.fn(async options => {
    if (options.message) {
      if (!messages.has(options.message)) throw Object.assign(new Error('Not found'), { status: 404, code: 10008 });
      return messages.get(options.message);
    }
    let entries = [...messages.values()].reverse();
    if (options.before) entries = entries.slice(entries.findIndex(item => item.id === options.before) + 1);
    return new Collection(entries.slice(0, options.limit).map(message => [message.id, message]));
  }) };
  channel.send = vi.fn(async payload => makeMessage(payload));
  const guild = { id: guildId, client, channels: { fetch: vi.fn(async () => channel), cache: new Collection([[channel.id, channel]]) } };
  client.guilds.cache.set(guildId, guild);
  const starter = makeMessage({ components: [{ content: '## BẢNG XẾP HẠNG TIÊU DÙNG THÁNG 10/2026 (LIVE)' }] }, channel.id);
  const state = { db, client, guild, channel, starter, messages, makeMessage, date: '2026-11-01T00:00:00.000Z' };
  state.service = createVinhDanhService({ database: db, now: () => new Date(state.date), guildId, clientId: client.user.id });
  state.addOrder = (paidAt, amount = 100000, customer = '111111111111111111') => db.prepare(`INSERT INTO orders
    VALUES(?,?,'PAID','COMPLETED',?,?,?)`).run(guildId, customer, amount, paidAt, paidAt);
  state.setting = key => db.prepare('SELECT value FROM system_settings WHERE key=?').get(key)?.value;
  state.archive = () => db.prepare('SELECT * FROM monthly_leaderboard_archives WHERE guild_id=?').get(guildId);
  resources.push({ state, close: !database });
  return state;
}
afterEach(() => {
  for (const { state, close } of resources.splice(0)) { state.service.stopMaintenance(state.client); if (close) state.db.close(); }
  vi.useRealTimers();
});
afterAll(() => commandDb.close());

describe('monthly Discord leaderboard maintenance', () => {
  it('updates the same honor starter at Vietnam midnight, archives once and skips unchanged edits', async () => {
    const f = fixture();
    f.date = '2026-10-31T16:59:59.000Z';
    f.addOrder(f.date, 200000, '111111111111111111');
    expect((await f.service.run(f.client)).period).toBe('10/2026');
    f.date = '2026-10-31T17:00:00.000Z';
    const result = await f.service.run(f.client);
    expect(result).toMatchObject({ status: 'READY', period: '11/2026', liveStatus: 'UPDATED', archiveStatus: 'SENT' });
    expect(flatten({ components: f.starter.components })).toContain('tháng 11/2026');
    expect(flatten({ components: f.starter.components })).toContain('Chưa có thanh toán hợp lệ');
    expect(f.channel.send).toHaveBeenCalledTimes(1);
    expect(flatten(f.channel.send.mock.calls[0][0])).toContain('THÁNG 10/2026');
    expect(f.setting(`live_vinh_danh_msg_id_2026_11_${TARGET.guildId}`)).toBe(TARGET.posts.honor);
    expect(f.archive()).toMatchObject({ period: '10/2026', status: 'SENT' });
    expect((await f.service.run(f.client)).liveStatus).toBe('CURRENT');
    expect(f.starter.edit).toHaveBeenCalledTimes(2);
    expect(f.channel.send).toHaveBeenCalledTimes(1);
    f.addOrder(f.date, 150000, '222222222222222222');
    await f.service.run(f.client);
    expect(f.starter.edit).toHaveBeenCalledTimes(3);
    expect(flatten({ components: f.starter.components })).toContain('222222222222222222');
    expect(flatten({ components: f.starter.components })).not.toContain('111111111111111111');
    expect(f.channel.send).toHaveBeenCalledTimes(1);
  });
  it('does not replace a starter when fetch or edit fails; the next tick retries the edit', async () => {
    const f = fixture();
    f.channel.messages.fetch.mockRejectedValueOnce(new Error('network timeout'));
    expect((await f.service.run(f.client)).status).toBe('RETRY_REQUIRED');
    expect(f.channel.send).not.toHaveBeenCalled();
    f.starter.edit.mockRejectedValueOnce(new Error('missing permission'));
    expect((await f.service.run(f.client)).status).toBe('RETRY_REQUIRED');
    expect(f.channel.send).not.toHaveBeenCalled();
    expect((await f.service.run(f.client)).status).toBe('READY');
    expect(f.starter.edit).toHaveBeenCalledTimes(2);
  });
  it('wakes an archived honor thread and rejects a different bot owner', async () => {
    const f = fixture();
    f.channel.archived = true;
    await f.service.run(f.client);
    expect(f.channel.setArchived).toHaveBeenCalledWith(false, expect.any(String));
    f.channel.ownerId = '222222222222222222';
    expect((await f.service.run(f.client)).error).toBe('LEADERBOARD_TARGET_MISMATCH');
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.starter.edit).toHaveBeenCalledTimes(1);
  });
  it('keeps a pre-send history failure retryable and records no false legacy posted marker', async () => {
    const f = fixture();
    f.addOrder('2026-10-10T00:00:00.000Z');
    const fetch = f.channel.messages.fetch.getMockImplementation();
    f.channel.messages.fetch.mockImplementationOnce(fetch).mockRejectedValueOnce(new Error('GET failed'));
    expect((await f.service.run(f.client)).archiveStatus).toBe('RETRY');
    expect(f.archive().status).toBe('RETRY');
    expect(f.setting(`final_vinh_danh_posted_2026_10_${TARGET.guildId}`)).toBeUndefined();
    expect((await f.service.run(f.client)).archiveStatus).toBe('SENT');
    expect(f.channel.send).toHaveBeenCalledTimes(1);
  });
  it('retries a confirmed Discord rejection while the current board stays updated', async () => {
    const f = fixture();
    f.addOrder('2026-10-10T00:00:00.000Z');
    f.channel.send.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    expect((await f.service.run(f.client))).toMatchObject({ status: 'PENDING', liveStatus: 'UPDATED', archiveStatus: 'RETRY' });
    expect(f.setting(`final_vinh_danh_posted_2026_10_${TARGET.guildId}`)).toBeUndefined();
    expect((await f.service.run(f.client)).archiveStatus).toBe('SENT');
    expect(f.channel.send).toHaveBeenCalledTimes(2);
    expect(f.starter.edit).toHaveBeenCalledTimes(1);
  });
  it('recovers an accepted archive after an unknown network outcome without posting again', async () => {
    const f = fixture();
    f.addOrder('2026-10-10T00:00:00.000Z');
    f.channel.send.mockImplementationOnce(async payload => { f.makeMessage(payload); throw new Error('socket reset after acceptance'); });
    expect((await f.service.run(f.client)).archiveStatus).toBe('UNKNOWN');
    const restarted = createVinhDanhService({ database: f.db, now: () => new Date(f.date), guildId: TARGET.guildId, clientId: f.client.user.id });
    expect((await restarted.run(f.client)).archiveStatus).toBe('SENT');
    expect(f.channel.send).toHaveBeenCalledTimes(1);
    expect(f.archive().message_id).toBeTruthy();
  });
  it('holds an unknown send with no receipt, including after restart', async () => {
    const f = fixture();
    f.addOrder('2026-10-10T00:00:00.000Z');
    f.channel.send.mockRejectedValueOnce(new Error('socket reset'));
    await f.service.run(f.client);
    const restarted = createVinhDanhService({ database: f.db, now: () => new Date(f.date), guildId: TARGET.guildId, clientId: f.client.user.id });
    expect((await restarted.run(f.client)).archiveStatus).toBe('UNKNOWN');
    expect(f.channel.send).toHaveBeenCalledTimes(1);
  });
  it('recovers an accepted archive whose receipt transaction initially failed', async () => {
    const f = fixture();
    await f.service.run(f.client);
    f.addOrder('2026-10-10T00:00:00.000Z');
    f.db.exec(`CREATE TRIGGER fail_archive_receipt BEFORE UPDATE ON monthly_leaderboard_archives
      WHEN NEW.status='SENT' BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END`);
    expect((await f.service.run(f.client)).archiveStatus).toBe('UNKNOWN');
    expect(f.setting(`final_vinh_danh_posted_2026_10_${TARGET.guildId}`)).toBeUndefined();
    f.db.exec('DROP TRIGGER fail_archive_receipt');
    expect((await f.service.run(f.client)).archiveStatus).toBe('SENT');
    expect(f.channel.send).toHaveBeenCalledTimes(1);
    expect(f.archive().message_id).toBeTruthy();
  });
  it.each(['bang-vinh-danh', '🏆・hall-of-fame'])('reuses the existing second-store live message across months in %s without creating channels', async name => {
    const f = fixture({ guildId: '1070676180103086132' });
    f.channel.name = name;
    f.db.prepare('INSERT INTO system_settings VALUES(?,?)').run('live_vinh_danh_msg_id_2026_10_1070676180103086132', f.starter.id);
    expect((await f.service.run(f.client)).status).toBe('READY');
    expect(f.starter.edit).toHaveBeenCalledTimes(1);
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.guild.channels.fetch).not.toHaveBeenCalled();
  });
  it('coalesces runs, waits for emoji readiness, skips unchanged payload and stops on invalidation', async () => {
    vi.useFakeTimers();
    const f = fixture();
    let ready = false;
    f.service.startMaintenance(f.client, { intervalMs: 1000, isReady: () => ready });
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.channel.messages.fetch).not.toHaveBeenCalled();
    ready = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.starter.edit).toHaveBeenCalledTimes(1);
    let release;
    f.channel.messages.fetch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = f.service.run(f.client);
    const second = f.service.run(f.client);
    expect(first).toBe(second);
    await vi.advanceTimersByTimeAsync(0);
    release(f.starter);
    await first;
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.starter.edit).toHaveBeenCalledTimes(1);
    f.client.emit('invalidated');
    const calls = f.channel.messages.fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.channel.messages.fetch).toHaveBeenCalledTimes(calls);
    expect(() => f.service.stopMaintenance(null)).not.toThrow();
    expect(JSON.stringify(f.service.getHealth(f.client))).not.toMatch(/111111|customer|amount_paid|total_spent/);
  });
  it('shows current live health before a pending archive read completes', async () => {
    const f = fixture();
    f.addOrder('2026-10-10T00:00:00.000Z');
    const fetch = f.channel.messages.fetch.getMockImplementation();
    let release;
    f.channel.messages.fetch.mockImplementationOnce(fetch).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const run = f.service.run(f.client);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(f.service.getHealth(f.client)).toMatchObject({ status: 'PENDING', liveStatus: 'UPDATED', archiveStatus: 'CHECKING' });
    release(new Collection());
    await run;
  });
});

describe('/vinh-danh empty state and channel publication', () => {
  const interaction = f => ({
    options: { getSubcommand: () => 'thang-nay', getString: () => 'month' },
    guildId: f.guild.id, guild: f.guild, client: f.client, user: { id: '111111111111111111' },
    deferReply: vi.fn(async () => {}), editReply: vi.fn(async () => {}),
  });
  it('renders an empty current month without referencing undefined VIP_TIERS', async () => {
    const f = fixture();
    const command = interaction(f);
    await execute(command);
    expect(flatten(command.editReply.mock.calls[0][0])).toContain('Chưa có thanh toán hợp lệ');
    expect(command.editReply.mock.calls[0][0].allowedMentions).toMatchObject({ parse: [], users: [], roles: [] });
  });
  it('routes admin monthly publishing to the same honor starter and preserves archives', async () => {
    const f = fixture({ database: commandDb });
    commandDb.prepare('DELETE FROM orders').run();
    commandDb.prepare('DELETE FROM system_settings').run();
    f.guild.members = { fetch: vi.fn(async () => ({ permissions: { has: () => true } })) };
    const command = interaction(f);
    command.options.getSubcommand = () => 'dang-len-kenh';
    await execute(command);
    expect(f.starter.edit).toHaveBeenCalledTimes(1);
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(command.editReply.mock.calls[0][0]).toContain(TARGET.posts.honor);
  });
});

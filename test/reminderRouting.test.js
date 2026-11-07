import Database from 'better-sqlite3';
import { Collection } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ database: null }));
vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
vi.mock('../src/database/db.js', () => ({ db: { prepare: (...args) => state.database.prepare(...args) } }));
import { STORE_ONE_GUILD_ID, STORE_TWO_GUILD_ID } from '../src/utils/locale.js';
import { STORE_FORUMS } from '../src/config/storeForums202611.js';
import { adoptStoreOneReminderRouting, getReminderRoutingHealth, reminderChannelId, resolveReminderChannel, STORE_ONE_REMINDER_CHANNEL_ID } from '../src/services/reminderRoutingService.js';
import { getPremiumLayoutHealth } from '../src/services/storeLayoutHealthService.js';

beforeEach(() => {
  state.database = new Database(':memory:');
  state.database.exec(`CREATE TABLE guild_settings (guild_id TEXT PRIMARY KEY, reminder_channel_id TEXT,
    staff_log_channel_id TEXT, premium_category_id TEXT, locket_channel_id TEXT, locket_product_message_id TEXT);
    CREATE TABLE subscription_accounts (id INTEGER PRIMARY KEY, next_renewal_at TEXT, admin_reminder_sent_at TEXT, admin_reminder_channel_id TEXT);
    INSERT INTO subscription_accounts VALUES (1, '2026-12-01', '2026-11-01', 'historical-channel');`);
  state.database.prepare('INSERT INTO guild_settings(guild_id,reminder_channel_id,staff_log_channel_id) VALUES(?,?,?)')
    .run(STORE_ONE_GUILD_ID, 'old-reminders', 'staff-one');
  state.database.prepare('INSERT INTO guild_settings(guild_id,reminder_channel_id,staff_log_channel_id) VALUES(?,?,?)')
    .run(STORE_TWO_GUILD_ID, 'global-reminders', 'staff-two');
});
afterEach(() => state.database.close());

describe('new reminder destinations', () => {
  it('persists only Store1 reminder routing, without changing staff logs, schedules or delivery markers', () => {
    const before = state.database.prepare('SELECT * FROM subscription_accounts').all();
    expect(adoptStoreOneReminderRouting(STORE_ONE_GUILD_ID)).toEqual({ skipped: false, changed: true });
    expect(state.database.prepare('SELECT reminder_channel_id, staff_log_channel_id FROM guild_settings WHERE guild_id=?').get(STORE_ONE_GUILD_ID))
      .toEqual({ reminder_channel_id: STORE_ONE_REMINDER_CHANNEL_ID, staff_log_channel_id: 'staff-one' });
    expect(adoptStoreOneReminderRouting(STORE_ONE_GUILD_ID).changed).toBe(false);
    expect(adoptStoreOneReminderRouting(STORE_TWO_GUILD_ID).skipped).toBe(true);
    expect(state.database.prepare('SELECT reminder_channel_id FROM guild_settings WHERE guild_id=?').get(STORE_TWO_GUILD_ID).reminder_channel_id).toBe('global-reminders');
    expect(state.database.prepare('SELECT * FROM subscription_accounts').all()).toEqual(before);
    expect(getReminderRoutingHealth()).toEqual({ guildId: STORE_ONE_GUILD_ID, channelId: STORE_ONE_REMINDER_CHANNEL_ID, persisted: true });
  });
  it('overrides stale Store1 config and reports persistence separately from effective routing', () => {
    expect(reminderChannelId(STORE_ONE_GUILD_ID, { reminder_channel_id: 'old' })).toBe(STORE_ONE_REMINDER_CHANNEL_ID);
    expect(getReminderRoutingHealth()).toEqual({ guildId: STORE_ONE_GUILD_ID, channelId: STORE_ONE_REMINDER_CHANNEL_ID, persisted: false });
    expect(reminderChannelId(STORE_TWO_GUILD_ID, { reminder_channel_id: 'global', staff_log_channel_id: 'fallback' })).toBe('global');
    expect(reminderChannelId(STORE_TWO_GUILD_ID, { staff_log_channel_id: 'fallback' }, { staffFallback: false })).toBeNull();
  });
  it('fetches a cold target and never falls back to an old or cross-guild channel', async () => {
    const target = { id: STORE_ONE_REMINDER_CHANNEL_ID, guildId: STORE_ONE_GUILD_ID, isTextBased: () => true };
    const guild = { id: STORE_ONE_GUILD_ID, channels: { cache: new Collection(), fetch: vi.fn().mockResolvedValue(target) } };
    const client = { channels: { cache: new Collection(), fetch: vi.fn().mockResolvedValue(null) } };
    expect(await resolveReminderChannel(client, guild, { reminder_channel_id: 'old' })).toBe(target);
    expect(guild.channels.fetch).toHaveBeenCalledWith(STORE_ONE_REMINDER_CHANNEL_ID);
    guild.channels.fetch.mockResolvedValue({ ...target, guildId: STORE_TWO_GUILD_ID });
    expect(await resolveReminderChannel(client, guild, { reminder_channel_id: 'old' })).toBeNull();
    expect(guild.channels.fetch).not.toHaveBeenCalledWith('old');
  });
});

describe('public premium adoption metadata', () => {
  it('does not expose legacy private IDs or claim adoption before raw settings change', () => {
    state.database.prepare('UPDATE guild_settings SET premium_category_id=?,locket_channel_id=?,locket_product_message_id=? WHERE guild_id=?')
      .run('private-category', 'private-channel', 'private-message', STORE_ONE_GUILD_ID);
    expect(getPremiumLayoutHealth()).toEqual({ mode: 'price-forum', adopted: false, locketChannelId: STORE_FORUMS.pricePosts.locket, locketMessageId: null });
  });
  it('reports only the public thread/card after persisted adoption and leaves Store2 metadata alone', () => {
    state.database.prepare('UPDATE guild_settings SET premium_category_id=NULL,locket_channel_id=?,locket_product_message_id=? WHERE guild_id=?')
      .run(STORE_FORUMS.pricePosts.locket, '1568999999999999999', STORE_ONE_GUILD_ID);
    expect(getPremiumLayoutHealth()).toEqual({ mode: 'price-forum', adopted: true, locketChannelId: STORE_FORUMS.pricePosts.locket, locketMessageId: '1568999999999999999' });
    expect(getPremiumLayoutHealth(STORE_TWO_GUILD_ID)).toEqual({ mode: 'legacy' });
  });
});

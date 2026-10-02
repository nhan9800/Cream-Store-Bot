import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Collection } from 'discord.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const targetGuildId = vi.hoisted(() => 'test-core-pack-guild');
vi.mock('../src/config.js', () => ({ config: { guildId: targetGuildId } }));
vi.mock('../src/database/db.js', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE guild_settings (
    guild_id TEXT PRIMARY KEY, custom_emojis TEXT, updated_at TEXT,
    ticket_category_id TEXT, order_log_channel_id TEXT, feedback_channel_id TEXT,
    sale_percent INTEGER DEFAULT 15
  );
  CREATE TABLE product_catalog (price INTEGER, original_price INTEGER);
  CREATE TABLE orders (code TEXT, total INTEGER, status TEXT);
  CREATE TABLE wallet_transactions (amount INTEGER, kind TEXT);`);
  return { db, nowIso: () => new Date().toISOString() };
});

import { db } from '../src/database/db.js';
import { CORE_UI_EMOJI_ASSETS, CORE_UI_EMOJI_SLOTS } from '../src/config/coreEmojiPack2026.js';
import { EMOJI_SLOTS, getEmojiMap, resetAllEmojis } from '../src/services/emojiService.js';
import { getCoreEmojiPackStatus, startCoreEmojiMaintenance, syncCoreEmojiPack } from '../src/services/coreEmojiPackService.js';

const previousClient = global.discordClient;
beforeEach(() => {
  db.exec('DELETE FROM guild_settings; DELETE FROM product_catalog; DELETE FROM orders; DELETE FROM wallet_transactions;');
  resetAllEmojis(targetGuildId);
  db.exec(`INSERT INTO product_catalog VALUES (85000, 100000);
    INSERT INTO orders VALUES ('CN_TEST', 150000, 'PAID');
    INSERT INTO wallet_transactions VALUES (-150000, 'PAYMENT');`);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  global.discordClient = previousClient;
});
afterAll(() => db.close());

function financialSnapshot() {
  return {
    products: db.prepare('SELECT * FROM product_catalog').all(),
    orders: db.prepare('SELECT * FROM orders').all(),
    wallet: db.prepare('SELECT * FROM wallet_transactions').all(),
  };
}

function setup({ preloaded = true } = {}) {
  const live = new Collection();
  const cache = new Collection();
  let serial = 1550000000000000000n;
  let createCount = 0;
  let failCreateAt = 0;
  const record = (name) => ({ id: String(serial++), name, animated: false });
  if (preloaded) for (const asset of CORE_UI_EMOJI_ASSETS) {
    const item = record(asset.name);
    live.set(item.id, item);
    cache.set(item.id, item);
  }
  const manager = { cache,
    fetch: vi.fn(async () => {
      // Match Discord.js: a fresh fetch adds live entries but leaves deleted
      // entries in cache. The production service must reconcile those itself.
      for (const [id, item] of live) cache.set(id, item);
      return new Collection(live);
    }),
    create: vi.fn(async ({ name, attachment }) => {
      createCount += 1;
      if (createCount === failCreateAt) throw Object.assign(new Error('creation rejected'), { code: 50013 });
      expect(fs.existsSync(attachment)).toBe(true);
      const item = record(name);
      live.set(item.id, item);
      cache.set(item.id, item);
      return item;
    }),
  };
  const guildInventory = new Collection();
  const guildCache = new Collection();
  const guild = { id: targetGuildId, emojis: { cache: guildCache,
    fetch: vi.fn(async () => {
      for (const [id, item] of guildInventory) guildCache.set(id, item);
      return new Collection(guildInventory);
    }) } };
  const unrelated = { id: 'other-guild', emojis: { cache: new Collection(), fetch: vi.fn(async () => new Collection()) } };
  const client = { isReady: () => true, application: { emojis: manager },
    guilds: { cache: new Collection([[guild.id, guild], [unrelated.id, unrelated]]), fetch: vi.fn(async (id) => id === guild.id ? guild : null) } };
  guild.client = client;
  unrelated.client = client;
  global.discordClient = client;
  return { client, manager, guild, unrelated, live, cache, guildInventory, guildCache,
    failCreateAt: (index) => { failCreateAt = index; }, record };
}

describe('fresh core emoji application pack', () => {
  it('ships every declared asset as a real 128px PNG within the Discord upload limit and maps only declared semantic slots', async () => {
    expect(CORE_UI_EMOJI_ASSETS.length).toBeGreaterThan(50);
    const names = new Set();
    for (const asset of CORE_UI_EMOJI_ASSETS) {
      expect(names.has(asset.name)).toBe(false);
      names.add(asset.name);
      const path = fileURLToPath(new URL(`../assets/emojis/ui26/${asset.fileName}`, import.meta.url));
      expect(fs.statSync(path).size).toBeGreaterThan(0);
      expect(fs.statSync(path).size).toBeLessThanOrEqual(256 * 1024);
      expect(await sharp(path).metadata()).toMatchObject({ format: 'png', width: 128, height: 128 });
      for (const slot of asset.slots.filter((slot) => EMOJI_SLOTS[slot])) expect(CORE_UI_EMOJI_SLOTS[slot]).toBe(asset.name);
    }
  });

  it('creates an empty application inventory once and reuses accepted artwork without changing commerce or another guild', async () => {
    const state = setup({ preloaded: false });
    db.prepare('INSERT INTO guild_settings (guild_id, custom_emojis, sale_percent) VALUES (?, ?, ?)')
      .run(state.unrelated.id, JSON.stringify({ icon_star: '<:other:1550000000000009999>' }), 25);
    const otherBefore = db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(state.unrelated.id);
    const moneyBefore = financialSnapshot();
    const first = await syncCoreEmojiPack(state.client);
    expect(first).toMatchObject({ status: 'ready', expected: CORE_UI_EMOJI_ASSETS.length, available: CORE_UI_EMOJI_ASSETS.length, created: CORE_UI_EMOJI_ASSETS.length, lastError: null });
    expect(state.manager.create).toHaveBeenCalledTimes(CORE_UI_EMOJI_ASSETS.length);
    const second = await syncCoreEmojiPack(state.client);
    expect(second.created).toBe(first.created);
    expect(state.manager.create).toHaveBeenCalledTimes(CORE_UI_EMOJI_ASSETS.length);
    expect(getEmojiMap(targetGuildId).status_check).toMatch(/^<:cenar_ui26_check:\d+>$/);
    expect(state.unrelated.emojis.fetch).not.toHaveBeenCalled();
    expect(db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(state.unrelated.id)).toEqual(otherBefore);
    expect(db.prepare('SELECT sale_percent FROM guild_settings WHERE guild_id = ?').get(targetGuildId).sale_percent).toBe(15);
    expect(financialSnapshot()).toEqual(moneyBefore);
  });

  it('evicts an icon deleted in the authoritative application inventory and recreates it with a new live ID', async () => {
    const state = setup();
    const old = state.cache.find((item) => item.name === 'cenar_ui26_check');
    state.live.delete(old.id);
    expect(state.cache.has(old.id)).toBe(true);
    await syncCoreEmojiPack(state.client);
    expect(state.cache.has(old.id)).toBe(false);
    const replacement = state.cache.find((item) => item.name === old.name);
    expect(replacement.id).not.toBe(old.id);
    expect(state.manager.create).toHaveBeenCalledTimes(1);
    expect(getEmojiMap(targetGuildId).status_check).toContain(replacement.id);
  });

  it('does not prune mappings or cached guild data when an application or guild inventory fetch fails', async () => {
    const state = setup();
    db.prepare('INSERT INTO guild_settings (guild_id, custom_emojis) VALUES (?, ?)')
      .run(targetGuildId, JSON.stringify({ brand_adobe: '<:old_adobe:1550000000000009998>' }));
    const before = db.prepare('SELECT * FROM guild_settings').all();
    const old = { id: '1550000000000009998', name: 'old_adobe', animated: false };
    state.guildCache.set(old.id, old);
    state.manager.fetch.mockRejectedValueOnce(Object.assign(new Error('app fetch failed'), { code: 50013 }));
    await expect(syncCoreEmojiPack(state.client)).rejects.toThrow('app fetch failed');
    expect(db.prepare('SELECT * FROM guild_settings').all()).toEqual(before);
    expect(state.guildCache.has(old.id)).toBe(true);
    state.guild.emojis.fetch.mockRejectedValueOnce(new Error('guild fetch failed'));
    await expect(syncCoreEmojiPack(state.client)).rejects.toThrow('guild fetch failed');
    expect(db.prepare('SELECT * FROM guild_settings').all()).toEqual(before);
    expect(state.guildCache.has(old.id)).toBe(true);
    expect(getCoreEmojiPackStatus(state.client)).toMatchObject({ status: 'retry_required', failures: 2 });
  });

  it('recovers a partial create failure by reusing already accepted uploads before one atomic mapping write', async () => {
    const state = setup({ preloaded: false });
    db.prepare('INSERT INTO guild_settings (guild_id, custom_emojis) VALUES (?, ?)')
      .run(targetGuildId, JSON.stringify({ brand_spotify: '<:old_brand:1550000000000009997>' }));
    const before = db.prepare('SELECT * FROM guild_settings').all();
    const moneyBefore = financialSnapshot();
    state.failCreateAt(3);
    await expect(syncCoreEmojiPack(state.client)).rejects.toMatchObject({ code: 50013 });
    expect(state.live.size).toBe(2);
    expect(db.prepare('SELECT * FROM guild_settings').all()).toEqual(before);
    expect(financialSnapshot()).toEqual(moneyBefore);
    state.failCreateAt(0);
    const result = await syncCoreEmojiPack(state.client);
    expect(result.status).toBe('ready');
    expect(state.manager.create).toHaveBeenCalledTimes(CORE_UI_EMOJI_ASSETS.length + 1);
    expect(state.live.size).toBe(CORE_UI_EMOJI_ASSETS.length);
    expect(new Set([...state.live.values()].map((item) => item.name)).size).toBe(CORE_UI_EMOJI_ASSETS.length);
    expect(financialSnapshot()).toEqual(moneyBefore);
  });

  it('runs one maintenance timer across duplicate startup calls and refreshes UI again after restoring a deleted icon', async () => {
    vi.useFakeTimers();
    const state = setup();
    const afterSync = vi.fn(async () => {});
    const first = startCoreEmojiMaintenance(state.client, { afterSync });
    const second = startCoreEmojiMaintenance(state.client, { afterSync });
    await Promise.all([first, second]);
    expect(state.manager.fetch).toHaveBeenCalledTimes(1);
    expect(afterSync).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(state.manager.fetch).toHaveBeenCalledTimes(2);
    expect(afterSync).toHaveBeenCalledTimes(1);
    const deleted = state.live.find((item) => item.name === 'cenar_ui26_check');
    state.live.delete(deleted.id);
    await vi.advanceTimersByTimeAsync(60000);
    expect(state.manager.create).toHaveBeenCalledTimes(1);
    expect(afterSync).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('retries a failed presentation refresh on the next maintenance pass even when the emoji inventory was already ready', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = setup();
    const afterSync = vi.fn().mockRejectedValueOnce(new Error('UI refresh unavailable')).mockResolvedValue(undefined);
    await startCoreEmojiMaintenance(state.client, { afterSync });
    expect(getCoreEmojiPackStatus(state.client).refreshPending).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    expect(afterSync).toHaveBeenCalledTimes(2);
    expect(state.manager.create).not.toHaveBeenCalled();
    expect(getCoreEmojiPackStatus(state.client).refreshPending).toBe(false);
    expect(vi.getTimerCount()).toBe(1);
  });
});

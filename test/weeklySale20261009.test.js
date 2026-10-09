import { Collection } from 'discord.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
vi.mock('../src/database/db.js', async () => {
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE guild_settings(guild_id TEXT PRIMARY KEY, custom_emojis TEXT)');
  return { db, nowIso: () => new Date().toISOString() };
});
import { db } from '../src/database/db.js';
import { WEEKLY_SALE_20261009, WEEKLY_SALE_GROUPS, WEEKLY_SALE_EMOJIS,
  buildWeeklySalePayloads, syncWeeklySaleEmojis } from '../src/campaigns/weeklySale20261009.js';
import { createEmojiResolver } from '../src/utils/emojiHelper.js';
import { promotionRebuildInternals } from '../src/services/promotionRebuildService.js';
import { resolveVerifiedCustomEmoji } from '../src/services/emojiService.js';
import { AUTOMATIC_MARKETING_PAUSED, AUTOMATIC_PRICE_BOARD_PAUSED } from '../src/config/marketingAutomationPolicy.js';

const previous = global.discordClient;
let client;
beforeEach(() => {
  const names = [...new Set([...WEEKLY_SALE_GROUPS.map((g) => g.slot), 'icon_brain', 'icon_book', 'warranty_shield',
    'icon_store', 'icon_sparkle', 'icon_price', 'ticket_open'])];
  const inventory = new Collection(names.map((name, i) => {
    const id = String(1550000000000001000n + BigInt(i));
    return [id, { id, name, animated: false }];
  }));
  const guild = { id: WEEKLY_SALE_20261009.guildId, emojis: { cache: inventory } };
  const app = new Collection();
  client = { guilds: { cache: new Collection([[guild.id, guild]]) },
    application: { emojis: { cache: app, fetch: vi.fn(async () => app), create: vi.fn(async ({ name }) => {
      const id = String(1550000000000002000n + BigInt(app.size));
      const emoji = { id, name, animated: false }; app.set(id, emoji); return emoji;
    }) } } };
  global.discordClient = client;
});
afterEach(() => { global.discordClient = previous; });
afterAll(() => db.close());

describe('owner-authorized 2026-10-09 weekly sale', () => {
  it('contains all 30 owner prices and the exact short warranty/JSON terms', () => {
    const prices = Object.fromEntries(WEEKLY_SALE_GROUPS.map((g) => [g.key, g.offers.map((r) => r.price)]));
    expect(prices).toEqual({ nitro: [85000, 99000, 120000, 240000, 350000, 480000, 580000, 830000, 65000],
      boost: [100000, 290000], gemini: [150000, 200000], office: [200000],
      chatgpt: [130000, 390000, 79000, 150000, 250000], capcut: [55000, 350000], netflix: [75000],
      spotify: [110000, 190000, 290000], youtube: [35000, 150000, 220000, 380000], duolingo: [80000] });
    const prepared = buildWeeklySalePayloads();
    expect(prepared.saleData).toHaveLength(30);
    const text = prepared.boardPayloads.map((p) => promotionRebuildInternals.publicMessageText({
      ...p, components: p.components.map((component) => component.toJSON()),
    })).join('\n');
    expect(text).toContain('Bảo hành 10 ngày');
    expect(text).toContain('BH 30 phút');
    expect(text).toContain('Bảo hành 6 tháng');
    expect(text).toContain('`79.000đ/slot` · file JSON có hướng dẫn');
    expect(text).toContain('`150.000đ/slot` · file JSON có hướng dẫn');
    expect(text).toContain('2 tháng · 1 ngày');
    expect(text).toContain('Opus 5.5 & Sonnet 5.5 qua Google Antigravity');
    expect(text).toContain('không phải bản dùng thử');
    expect(text).not.toMatch(/BH 60|85\.000đ.*ngày đầu|giảm \d+%|chỉ \d+ slot/);
  });
  it('uploads only three new original emojis and reuses live IDs on rerun', async () => {
    const first = await syncWeeklySaleEmojis(client);
    expect(client.application.emojis.create).toHaveBeenCalledTimes(3);
    for (const asset of WEEKLY_SALE_EMOJIS) {
      expect(fs.statSync(asset.path).size).toBeLessThan(256 * 1024);
      expect(resolveVerifiedCustomEmoji(WEEKLY_SALE_20261009.guildId, first[asset.key].text)).toBe(first[asset.key].text);
    }
    expect(await syncWeeklySaleEmojis(client)).toEqual(first);
    expect(client.application.emojis.create).toHaveBeenCalledTimes(3);
  });
  it('fits Discord limits, uses verified custom artwork and remains silent with automatic systems paused', async () => {
    const customEmojis = await syncWeeklySaleEmojis(client);
    const prepared = buildWeeklySalePayloads({ E: createEmojiResolver(WEEKLY_SALE_20261009.guildId), customEmojis });
    expect(prepared.boardOnly).toBe(true);
    expect(prepared.boardPayloads).toHaveLength(3);
    expect(prepared.buildDailyPayload).toBeUndefined();
    expect(AUTOMATIC_MARKETING_PAUSED).toBe(true);
    expect(AUTOMATIC_PRICE_BOARD_PAUSED).toBe(true);
    for (const [index, payload] of prepared.boardPayloads.entries()) {
      const marked = promotionRebuildInternals.payloadWithMarker(payload, `CENAR-PROMOTION-CUTOVER:${WEEKLY_SALE_20261009.revision}:PART-${index + 1}`);
      const text = promotionRebuildInternals.publicMessageText(marked);
      expect(text.length).toBeLessThanOrEqual(4000);
      expect(text).not.toMatch(/@everyone|@here|<@|\p{Extended_Pictographic}/u);
      expect(marked.allowedMentions).toEqual({ parse: [], roles: [], users: [], repliedUser: false });
      for (const token of text.match(/<a?:\w+:\d+>/g) || []) {
        expect(resolveVerifiedCustomEmoji(WEEKLY_SALE_20261009.guildId, token)).toBe(token);
      }
      const json = JSON.stringify(marked);
      expect(json).not.toContain('ticket:create:ORDER'); // sale is explicitly quoted in ticket, not the catalog checkout
    }
  });
});

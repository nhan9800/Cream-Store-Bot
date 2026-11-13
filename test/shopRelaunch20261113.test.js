import Database from 'better-sqlite3';
import { PermissionFlagsBits } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
vi.mock('../src/services/emojiService.js', () => ({
  resolveLiveCustomEmoji: value => typeof value === 'object' ? `<:${value.name}:${value.id}>` : value,
  sanitizeCustomEmojiText: (_guildId, value) => value,
}));
import { installDiscordEmojiBoundary } from '../src/utils/discordEmojiBoundary.js';
import { withManualAnnouncementWrite } from '../src/utils/manualAnnouncementWrite.js';
import { GEMINI_PRO_CDK_PRODUCT } from '../src/config/geminiProCdk202611.js';
import { SHOP_RELAUNCH, buildShopRelaunchPayloads, prepareShopRelaunch, readShopRelaunchProducts } from '../src/campaigns/shopRelaunch20261113.js';
import { getShopRelaunchPublicationHealth, publishShopRelaunch, shopRelaunchPublicationInternals } from '../src/services/shopRelaunchPublicationService.js';

const databases = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const E = slot => `<:test_${slot}:1550000000000001000>`;
function catalog(products = [
  { name: 'Discord Nitro Boost Login 1 Tháng', price: 90000, service_type: 'GAME' },
  { name: 'ChatGPT Plus 1 Tháng', price: 530000, service_type: 'AI', warranty_policy: 'Full 1 tháng' },
  { name: 'Spotify Premium 6 Tháng', price: 190000, original_price: 250000, service_type: 'spotify' },
]) {
  const db = new Database(':memory:'); databases.push(db);
  db.exec(`CREATE TABLE product_catalog(id INTEGER PRIMARY KEY, guild_id TEXT, name TEXT, price INTEGER,
    original_price INTEGER DEFAULT 0, duration_months INTEGER DEFAULT 1, service_type TEXT,
    warranty_policy TEXT, product_key TEXT, is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0)`);
  const add = db.prepare(`INSERT INTO product_catalog(guild_id,name,price,original_price,service_type,warranty_policy,is_active)
    VALUES(@guild_id,@name,@price,@original_price,@service_type,@warranty_policy,@is_active)`);
  for (const product of products) add.run({ guild_id: 'WEB', original_price: 0, warranty_policy: '', is_active: 1, ...product });
  return db;
}
function fixture() {
  const db = catalog();
  let sequence = 1550000000000003000n;
  const histories = new Map();
  const channels = new Map([SHOP_RELAUNCH.channelId, SHOP_RELAUNCH.announcementChannelId].map(id => {
    const messages = new Map(); histories.set(id, messages);
    const channel = { id, guildId: SHOP_RELAUNCH.guildId, isTextBased: () => true,
      permissionsFor: () => ({ has: () => true }),
      messages: { fetch: vi.fn(async query => {
        if (typeof query === 'string') return messages.get(query);
        const page = [...messages.values()].sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1)
          .filter(message => !query.before || BigInt(message.id) < BigInt(query.before)).slice(0, query.limit);
        return new Map(page.map(message => [message.id, message]));
      }) },
      send: vi.fn(async payload => {
        const id = String(sequence++);
        const message = { id, channelId: channel.id, author: { id: 'bot' }, flags: payload.flags,
          mentions: { everyone: false, roles: new Map(payload.allowedMentions.roles.map(role => [role, {}])), users: new Map() },
          toJSON: () => payload };
        messages.set(id, message); return message;
      }),
    };
    return [id, channel];
  }));
  const guild = { id: SHOP_RELAUNCH.guildId, members: { me: {} },
    roles: { fetch: async id => ({ id, managed: false, mentionable: true }) },
    channels: { fetch: async id => channels.get(id) } };
  const client = { isReady: () => true, user: { id: 'bot' }, guilds: { fetch: async () => guild } };
  const prepare = () => prepareShopRelaunch({ dbInstance: db, E });
  const run = options => publishShopRelaunch(client, { dbInstance: db, E, expectedPriceHash: prepare().priceHash, ...options });
  return { db, client, channels, histories, prepare, run };
}

describe('current-catalog shop relaunch presentation', () => {
  it('uses WEB precedence, active positive prices and only real crossed-out prices', () => {
    const db = catalog();
    db.prepare("INSERT INTO product_catalog(guild_id,name,price,service_type,is_active) VALUES(?,?,?,?,?)")
      .run(SHOP_RELAUNCH.guildId, 'Old Nitro', 1000, 'GAME', 1);
    const preview = prepareShopRelaunch({ dbInstance: db, E });
    expect(preview.priceManifest.map(p => p.price)).toEqual([90000, 530000, 190000]);
    const text = preview.payloads.map(shopRelaunchPublicationInternals.textOf).join('\n');
    expect(text).toContain('90.000đ'); expect(text).toContain('530.000đ');
    expect(text).toContain('~~250.000đ~~ **190.000đ**');
    expect(text).not.toContain('Old Nitro'); expect(text).not.toMatch(/giảm \d+%|@everyone|@here|\p{Extended_Pictographic}/u);
    expect(preview.payloads.filter(p => p.allowedMentions.roles.length)).toHaveLength(1);
  });

  it('builds the full current seed without old sale prices, stock claims or Discord overflow', () => {
    const source = fs.readFileSync(new URL('../src/database/db.js', import.meta.url), 'utf8');
    const literal = `${source.split('export const DEFAULT_PRODUCT_CATALOG = ')[1].split('\n];')[0]}\n]`;
    const products = Function('GEMINI_PRO_CDK_PRODUCT', `return ${literal}`)(GEMINI_PRO_CDK_PRODUCT)
      .map((product, index) => ({ id: index + 1, name: product.name, key: product.product_key || String(index),
        price: product.price, originalPrice: product.original_price || 0, service_type: product.service_type, warranty: product.warranty_policy || '' }));
    const payloads = buildShopRelaunchPayloads({ products, E });
    expect(payloads).toHaveLength(3);
    const text = payloads.map(shopRelaunchPublicationInternals.textOf).join('\n');
    expect(text).toContain('850.000đ'); expect(text).toContain('530.000đ');
    expect(text).toContain('~~66.000đ~~ **25.000đ**');
    expect(text).toContain('~~79.000đ~~ **35.000đ**');
    expect(text).not.toMatch(/mail không bao giờ|tỷ lệ die|giao ngay|hạn mức.*không giới hạn/i);
    for (const payload of payloads) expect(shopRelaunchPublicationInternals.textOf(payload).length).toBeLessThanOrEqual(4000);
  });

  it('fails before publication if any required icon lacks custom artwork or reviewed prices changed', async () => {
    const state = fixture();
    expect(() => prepareShopRelaunch({ dbInstance: state.db, E: slot => slot === 'icon_price' ? '💰' : E(slot) }))
      .toThrow('RELAUNCH_CUSTOM_EMOJI_MISSING');
    await expect(state.run({ expectedPriceHash: 'old-price-hash' })).rejects.toMatchObject({ code: 'RELAUNCH_CATALOG_CHANGED' });
    expect([...state.channels.values()].every(channel => channel.send.mock.calls.length === 0)).toBe(true);
    expect(state.db.prepare("SELECT name FROM sqlite_master WHERE name='shop_relaunch_jobs'").get()).toBeUndefined();
  });

  it('keeps all decorations custom when optional product logos are unavailable', () => {
    const state = fixture();
    const preview = prepareShopRelaunch({ dbInstance: state.db,
      E: slot => slot?.startsWith('brand_') || slot === 'promo_decor' ? '' : E(slot) });
    const text = preview.payloads.map(shopRelaunchPublicationInternals.textOf).join('\n');
    expect(text).toContain(E('icon_gem')); expect(text).toContain(E('icon_brain'));
    expect(text).not.toMatch(/undefined|\p{Extended_Pictographic}/u);
  });

  it('keeps campaign text and allowed Member mentions intact through the final paused REST boundary', async () => {
    const state = fixture();
    const request = vi.fn(async options => options.body);
    const client = { rest: { request }, channels: { cache: new Map([[SHOP_RELAUNCH.channelId, { guildId: SHOP_RELAUNCH.guildId }]]) } };
    installDiscordEmojiBoundary(client);
    for (const payload of state.prepare().payloads) {
      const body = { components: payload.components, flags: payload.flags,
        allowed_mentions: payload.allowedMentions, nonce: payload.nonce, enforce_nonce: true };
      const sent = await withManualAnnouncementWrite({ rest: client.rest, channelId: SHOP_RELAUNCH.channelId, nonce: payload.nonce },
        () => client.rest.request({ method: 'POST', fullRoute: `/channels/${SHOP_RELAUNCH.channelId}/messages`, body }));
      expect(shopRelaunchPublicationInternals.textOf(sent)).toBe(shopRelaunchPublicationInternals.textOf(payload));
      expect(sent.allowed_mentions).toEqual(payload.allowedMentions);
    }
    expect(request).toHaveBeenCalledTimes(3);
    await expect(client.rest.request({ method: 'POST', fullRoute: `/channels/${SHOP_RELAUNCH.channelId}/messages`, body: { content: 'legacy automated sale' } }))
      .rejects.toMatchObject({ code: 'MARKETING_PAUSED' });
  });
});

describe('durable relaunch publication and one Member mention', () => {
  it('does not post a purported Member ping when the bot cannot mention that role', async () => {
    const state = fixture();
    const guild = await state.client.guilds.fetch(SHOP_RELAUNCH.guildId);
    guild.roles.fetch = async id => ({ id, managed: false, mentionable: false });
    state.channels.get(SHOP_RELAUNCH.channelId).permissionsFor = () => ({ has: permission => permission !== PermissionFlagsBits.MentionEveryone });
    await expect(state.run()).rejects.toMatchObject({ code: 'RELAUNCH_MEMBER_MENTION_PERMISSION_MISSING' });
    expect(state.channels.get(SHOP_RELAUNCH.channelId).send).not.toHaveBeenCalled();
  });
  it('publishes three boards plus a silent announcement, verifies fetched messages and never repeats the ping', async () => {
    const state = fixture();
    expect(getShopRelaunchPublicationHealth({ dbInstance: state.db }).status).toBe('not_started');
    const first = await state.run();
    expect(first.status).toBe('DONE'); expect(first.links).toHaveLength(4);
    expect(first.parts.every(part => part.verification.status === 'VERIFIED' && part.verification.nativeEmojiCount === 0)).toBe(true);
    expect(first.parts.flatMap(part => part.verification.allowedRoles)).toEqual([SHOP_RELAUNCH.memberRoleId]);
    expect(state.channels.get(SHOP_RELAUNCH.channelId).send).toHaveBeenCalledTimes(3);
    expect(state.channels.get(SHOP_RELAUNCH.announcementChannelId).send).toHaveBeenCalledTimes(1);
    const second = await state.run();
    expect(second.links).toEqual(first.links);
    expect(state.channels.get(SHOP_RELAUNCH.channelId).send).toHaveBeenCalledTimes(3);
  });

  it('recovers accepted-but-response-lost sends from exact markers without a second Member ping', async () => {
    const state = fixture();
    const channel = state.channels.get(SHOP_RELAUNCH.channelId);
    const send = channel.send.getMockImplementation(); let lost = false;
    channel.send.mockImplementation(async payload => {
      const message = await send(payload);
      if (!lost) { lost = true; throw new Error('Response lost'); }
      return message;
    });
    await expect(state.run()).rejects.toMatchObject({ code: 'RELAUNCH_SEND_UNCERTAIN' });
    expect((await state.run()).status).toBe('DONE');
    expect(channel.send).toHaveBeenCalledTimes(3);
    expect(channel.send.mock.calls.filter(([payload]) => payload.allowedMentions.roles.length)).toHaveLength(1);
  });

  it('refuses to blindly resend an uncertain missing message and exposes an actionable code', async () => {
    const state = fixture(); const channel = state.channels.get(SHOP_RELAUNCH.channelId);
    channel.send.mockRejectedValueOnce(new Error('Connection closed before response'));
    await expect(state.run()).rejects.toMatchObject({ code: 'RELAUNCH_SEND_UNCERTAIN' });
    await expect(state.run()).rejects.toMatchObject({ code: 'RELAUNCH_SEND_UNCERTAIN' });
    expect(channel.send).toHaveBeenCalledTimes(1);
    expect(getShopRelaunchPublicationHealth({ dbInstance: state.db }).lastError).toBe('RELAUNCH_SEND_UNCERTAIN');
  });

  it('resumes a known rejection after earlier boards without duplicate sends or edits/deletions', async () => {
    const state = fixture(); const channel = state.channels.get(SHOP_RELAUNCH.channelId);
    const send = channel.send.getMockImplementation(); let calls = 0;
    channel.send.mockImplementation(async payload => {
      calls++; if (calls === 2) throw Object.assign(new Error('Forbidden'), { status: 403 });
      return send(payload);
    });
    await expect(state.run()).rejects.toMatchObject({ code: 'RELAUNCH_SEND_REJECTED' });
    expect((await state.run()).status).toBe('DONE');
    expect(channel.send).toHaveBeenCalledTimes(4);
    expect(channel.send.mock.calls.filter(([payload]) => payload.allowedMentions.roles.length)).toHaveLength(1);
  });

  it('rejects tampered accepted content rather than declaring a successful publication', async () => {
    const state = fixture(); const channel = state.channels.get(SHOP_RELAUNCH.channelId);
    const send = channel.send.getMockImplementation();
    channel.send.mockImplementation(async payload => {
      const message = await send(payload); message.toJSON = () => ({ content: 'changed' }); return message;
    });
    await expect(state.run()).rejects.toMatchObject({ code: 'RELAUNCH_PUBLICATION_CONTENT_MISMATCH' });
    expect(getShopRelaunchPublicationHealth({ dbInstance: state.db }).status).toBe('RETRY_REQUIRED');
  });
});

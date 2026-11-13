import Database from 'better-sqlite3';
import { Client, Collection, Message } from 'discord.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
vi.mock('../src/database/db.js', async () => {
  const { default: Sqlite } = await import('better-sqlite3');
  const db = new Sqlite(':memory:');
  db.exec('CREATE TABLE guild_settings(guild_id TEXT PRIMARY KEY,custom_emojis TEXT)');
  return { db, nowIso: () => new Date().toISOString() };
});
import { db as emojiDb } from '../src/database/db.js';
import { CORE_UI_EMOJI_ASSETS } from '../src/config/coreEmojiPack2026.js';
import { createEmojiResolver } from '../src/utils/emojiHelper.js';
import { resetAllEmojis } from '../src/services/emojiService.js';
import { normalizeMessagePresentation } from '../src/utils/discordEmojiBoundary.js';
import { SHOP_RELAUNCH } from '../src/campaigns/shopRelaunch20261113.js';
import { COMPACT_SALE, readCompactSaleRanking, prepareCompactSale, compactSaleInternals } from '../src/campaigns/compactSale20261113.js';
import { getCompactSalePublicationHealth, updateCompactSale, compactSalePublicationInternals as I } from '../src/services/compactSalePublicationService.js';

const oldGlobal = global.discordClient;
const resources = [];
let state;

function addOrder(db, patch = {}) {
  db.prepare(`INSERT INTO orders(guild_id,product_id,product_name,duration_months,quantity,
    total_amount,amount_paid,payment_status,status,fulfillment_mode)
    VALUES(@guild_id,@product_id,@product_name,@duration_months,@quantity,
    @total_amount,@amount_paid,@payment_status,@status,@fulfillment_mode)`).run({
    guild_id: COMPACT_SALE.guildId, product_id: 1, product_name: 'Nitro 1 tháng', duration_months: 1,
    quantity: 1, total_amount: 100000, amount_paid: 100000, payment_status: 'PAID', status: 'COMPLETED',
    fulfillment_mode: 'LEGACY', ...patch,
  });
}

beforeEach(() => {
  const db = new Database(':memory:');
  const client = new Client({ intents: [] }); resources.push({ db, client });
  db.exec(`CREATE TABLE product_catalog(id INTEGER PRIMARY KEY,guild_id TEXT,name TEXT,price INTEGER,ctv_price INTEGER,
    original_price INTEGER DEFAULT 0,duration_months INTEGER DEFAULT 1,service_type TEXT,
    warranty_policy TEXT DEFAULT '',product_key TEXT,is_active INTEGER DEFAULT 1,sort_order INTEGER DEFAULT 0);
    CREATE TABLE orders(id INTEGER PRIMARY KEY,guild_id TEXT,product_id INTEGER,product_name TEXT,duration_months INTEGER,
    quantity INTEGER,total_amount INTEGER,amount_paid INTEGER,payment_status TEXT,status TEXT,fulfillment_mode TEXT);`);
  const names = ['Nitro 1 tháng', 'Nitro 2 tháng', 'Nitro 12 tháng', 'ChatGPT Plus 1 tháng', 'Locket Gold 1 năm',
    'Spotify Premium 6 tháng', 'YouTube Premium 6 tháng', 'CapCut Pro 1 tháng'];
  const insert = db.prepare(`INSERT INTO product_catalog(id,guild_id,name,price,ctv_price,product_key,service_type)
    VALUES(?,'WEB',?,100000,70000,?,'PREMIUM')`);
  names.forEach((name, index) => { insert.run(index + 1, name, `product-${index + 1}`);
    addOrder(db, { product_id: index + 1, product_name: name, quantity: 10 - index }); });
  const application = new Collection(CORE_UI_EMOJI_ASSETS.map((asset, index) => {
    const id = String(1569038518242510000n + BigInt(index));
    return [id, { id, name: asset.name, animated: false }];
  }));
  client.application = { emojis: { cache: application } };
  client.user = client.users._add({ id: '1282637033340403999', username: 'shopbot', discriminator: '0', avatar: null });
  client.isReady = () => true;
  const channels = new Collection();
  const guild = { id: COMPACT_SALE.guildId, members: { me: {}, resolve: () => null, cache: new Collection() },
    roles: { cache: new Collection() }, emojis: { cache: new Collection() },
    channels: { cache: channels, fetch: async id => channels.get(id) } };
  client.guilds.cache.set(guild.id, guild); client.guilds.fetch = async () => guild;
  const history = new Map();
  const edits = vi.fn();
  const channel = { id: COMPACT_SALE.channelId, guildId: guild.id, guild, client, isTextBased: () => true,
    permissionsFor: () => ({ has: () => true }), send: vi.fn(),
    messages: { fetch: vi.fn(async query => history.get(typeof query === 'string' ? query : query.message)) } };
  const message = (id, payload, authorId = client.user.id) => {
    const body = normalizeMessagePresentation(payload, guild.id);
    const instance = new Message(client, { id, channel_id: channel.id, guild_id: guild.id,
      author: { id: authorId, username: 'shopbot', discriminator: '0', avatar: null }, type: 0,
      content: '', components: body.components, flags: 32768, mentions: [], mention_roles: [], mention_everyone: false,
      attachments: [], embeds: [], timestamp: new Date().toISOString(), edited_timestamp: null });
    instance.edit = vi.fn(async next => { edits(id, next); const updated = message(id, next); history.set(id, updated); return updated; });
    return instance;
  };
  COMPACT_SALE.messageIds.forEach((id, index) => history.set(id, message(id, { components: [{ type: 17,
    components: [{ type: 10, content: `Old price card ${index + 1}\n-# ${SHOP_RELAUNCH.revision}:PART-${index + 1} · 1/3` }] }] })));
  channels.set(channel.id, channel); client.channels.cache.set(channel.id, channel);
  global.discordClient = client; resetAllEmojis(guild.id);
  const E = createEmojiResolver(guild.id);
  const selection = [1, 2, 4, 5, 6, 7];
  const prepare = options => prepareCompactSale({ dbInstance: db, E, selection, ...options });
  const run = options => updateCompactSale(client, { dbInstance: db, E, selection,
    expectedPreviewHash: prepare().previewHash, ...options });
  state = { db, client, guild, application, channel, history, edits, message, E, selection, prepare, run };
});
afterEach(async () => {
  global.discordClient = oldGlobal;
  for (const resource of resources.splice(0)) { resource.db.close(); await resource.client.destroy(); }
});
afterAll(() => emojiDb.close());

describe('real completed purchases and a compact six-product preview', () => {
  it('ranks only paid completed legacy Store1 orders and ignores fake counters, invalid IDs and unpaid/refunded history', () => {
    const { db } = state;
    for (const patch of [{ payment_status: 'FREE' }, { payment_status: 'UNPAID' }, { status: 'CANCELLED' },
      { status: 'REFUNDED' }, { fulfillment_mode: 'SUPPLIER' }, { guild_id: 'other-store' },
      { total_amount: 0, amount_paid: 0 }, { amount_paid: 1 }, { product_id: 999 }]) addOrder(db, { quantity: 1000, ...patch });
    addOrder(db, { product_id: null, product_name: 'Locket Gold 1 năm', quantity: 2 });
    const ranked = readCompactSaleRanking(db);
    expect(ranked.find(product => product.id === 1).completedUnits).toBe(10);
    expect(ranked.find(product => product.id === 5).completedUnits).toBe(8);
    expect(ranked.find(product => product.id === 1).ctvPrice).toBe(70000);
    const preview = prepareCompactSale({ dbInstance: db, E: state.E });
    expect(preview.selection).toHaveLength(6);
    expect(preview.selectedProducts.filter(product => /Nitro/.test(product.name))).toHaveLength(2);
    expect(JSON.stringify(preview)).not.toContain('ctvPrice');
    expect(preview.payloads).toHaveLength(3);
  });

  it('projects a small reviewed discount read-only and omits changing order counts from the release hash', () => {
    const first = state.prepare({ priceOverrides: new Map([[1, 97000]]) });
    expect(first.selectedProducts[0]).toMatchObject({ id: 1, price: 97000, originalPrice: 100000 });
    expect(state.db.prepare('SELECT price FROM product_catalog WHERE id=1').get().price).toBe(100000);
    addOrder(state.db, { quantity: 1 });
    expect(state.prepare({ priceOverrides: { 1: 97000 } }).previewHash).toBe(first.previewHash);
    expect(() => state.prepare({ priceOverrides: { 1: 95000 } })).toThrow('COMPACT_PRICE_CUT_TOO_LARGE');
    expect(() => state.prepare({ priceOverrides: { 999: 97000 } })).toThrow('COMPACT_PRICE_OVERRIDE_UNKNOWN');
    state.db.prepare('UPDATE product_catalog SET price=97000,original_price=100000 WHERE id=1').run();
    expect(state.prepare().previewHash).toBe(first.previewHash);
  });

  it('uses distinct live custom artwork across all cards and final REST normalization, never mentions a role', () => {
    const preview = state.prepare();
    const again = preview.payloads.map(payload => normalizeMessagePresentation(payload, COMPACT_SALE.guildId));
    expect(compactSaleInternals.emojiAudit(again)).toMatchObject({ nativeEmojiCount: 0 });
    expect(preview.emojiAudit.customEmojiCount).toBe(preview.emojiAudit.uniqueEmojiCount);
    expect(preview.emojiAudit.customEmojiCount).toBeGreaterThan(20);
    for (const payload of preview.payloads) expect(payload.allowedMentions).toEqual({ parse: [], roles: [], users: [], repliedUser: false });
    const text = preview.payloads.map(I.textOf).join('\n');
    expect(text).not.toMatch(/@everyone|@here|<@&|\p{Extended_Pictographic}/u);
    state.selection.forEach(id => expect(text).toContain(state.db.prepare('SELECT name FROM product_catalog WHERE id=?').get(id).name));
    expect(text).not.toContain('Nitro 12 tháng');
  });

  it('fails a bestseller preview when history is empty or required artwork is unavailable', () => {
    state.db.prepare('DELETE FROM orders').run();
    expect(() => state.prepare()).toThrow('COMPACT_SELECTION_NOT_PURCHASED');
    expect(() => prepareCompactSale({ dbInstance: state.db, E: state.E })).toThrow('COMPACT_NO_COMPLETED_PRODUCTS');
    addOrder(state.db);
    state.application.clear(); resetAllEmojis(COMPACT_SALE.guildId);
    expect(() => prepareCompactSale({ dbInstance: state.db, E: state.E })).toThrow('COMPACT_CUSTOM_EMOJI_NOT_READY');
  });
});

describe('silent edits of the exact three existing sale messages', () => {
  it('edits those messages in place, verifies real Discord.js messages, and never sends another post or Member ping', async () => {
    expect(getCompactSalePublicationHealth({ dbInstance: state.db }).status).toBe('NOT_STARTED');
    const result = await state.run();
    expect(result.status).toBe('DONE'); expect(result.links).toHaveLength(3);
    expect(state.edits).toHaveBeenCalledTimes(3); expect(state.channel.send).not.toHaveBeenCalled();
    expect([...state.history.keys()]).toEqual([...COMPACT_SALE.messageIds]);
    expect(result.parts.every(part => part.verification.status === 'VERIFIED')).toBe(true);
    for (const [, payload] of state.edits.mock.calls) expect(payload.allowedMentions).toEqual({ parse: [], roles: [], users: [], repliedUser: false });
    await state.run();
    expect(state.edits).toHaveBeenCalledTimes(3);
  });

  it('recovers an accepted edit with a lost receipt using the same message IDs and no repeated edit', async () => {
    let lost = false;
    const editMessage = async (message, payload) => {
      const updated = await message.edit(payload);
      if (!lost && message.id === COMPACT_SALE.messageIds[1]) { lost = true; throw new Error('Lost PATCH receipt'); }
      return updated;
    };
    await expect(state.run({ editMessage })).rejects.toThrow('Lost PATCH receipt');
    const result = await state.run();
    expect(result.status).toBe('DONE'); expect(state.edits).toHaveBeenCalledTimes(3);
    expect(state.channel.send).not.toHaveBeenCalled();
  });

  it('refuses modified preview hashes or foreign saved messages before any edit', async () => {
    await expect(state.run({ expectedPreviewHash: 'stale' })).rejects.toMatchObject({ code: 'COMPACT_PREVIEW_CHANGED' });
    expect(state.db.prepare("SELECT name FROM sqlite_master WHERE name='compact_sale_revisions'").get()).toBeUndefined();
    const id = COMPACT_SALE.messageIds[1];
    state.history.set(id, state.message(id, { components: [{ type: 10, content: `${SHOP_RELAUNCH.revision}:PART-2` }] }, '1282637033340403000'));
    await expect(state.run()).rejects.toMatchObject({ code: 'COMPACT_OWNED_MESSAGE_REQUIRED' });
    expect(state.edits).not.toHaveBeenCalled();
  });

  it('does not overwrite a subsequent external edit while resuming a partial update', async () => {
    const editMessage = async (message, payload) => {
      if (message.id === COMPACT_SALE.messageIds[1]) throw new Error('temporary failure');
      return message.edit(payload);
    };
    await expect(state.run({ editMessage })).rejects.toThrow('temporary failure');
    const id = COMPACT_SALE.messageIds[1];
    state.history.set(id, state.message(id, { components: [{ type: 17, components: [{ type: 10,
      content: `Manually revised\n-# ${SHOP_RELAUNCH.revision}:PART-2 · custom` }] }] }));
    await expect(state.run()).rejects.toMatchObject({ code: 'COMPACT_EXTERNAL_EDIT_CONFLICT' });
    expect(state.edits).toHaveBeenCalledTimes(1);
  });
});

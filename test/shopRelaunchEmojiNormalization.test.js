import Database from 'better-sqlite3';
import { Client, Collection, Message } from 'discord.js';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config.js', () => ({ config: { guildId: '1282637033340403754' } }));
vi.mock('../src/database/db.js', async () => {
  const { default: Sqlite } = await import('better-sqlite3');
  const db = new Sqlite(':memory:');
  db.exec('CREATE TABLE guild_settings(guild_id TEXT PRIMARY KEY, custom_emojis TEXT)');
  return { db, nowIso: () => new Date().toISOString() };
});

import { db as emojiDb } from '../src/database/db.js';
import { CORE_UI_EMOJI_ASSETS } from '../src/config/coreEmojiPack2026.js';
import { createEmojiResolver } from '../src/utils/emojiHelper.js';
import { normalizeMessagePresentation } from '../src/utils/discordEmojiBoundary.js';
import { resetAllEmojis } from '../src/services/emojiService.js';
import { SHOP_RELAUNCH, prepareShopRelaunch } from '../src/campaigns/shopRelaunch20261113.js';
import { getShopRelaunchPublicationHealth, publishShopRelaunch, shopRelaunchPublicationInternals as I } from '../src/services/shopRelaunchPublicationService.js';

const oldGlobal = global.discordClient;
const legacySpotify = { id: '1535690966911025262', name: 'cenar_spotify', animated: false };
const legacyText = `<:${legacySpotify.name}:${legacySpotify.id}>`;
const resources = [];
let state;

beforeEach(() => {
  const catalog = new Database(':memory:');
  const client = new Client({ intents: [] });
  resources.push({ catalog, client });
  catalog.exec(`CREATE TABLE product_catalog(id INTEGER PRIMARY KEY,guild_id TEXT,name TEXT,price INTEGER,
    original_price INTEGER DEFAULT 0,duration_months INTEGER DEFAULT 1,service_type TEXT,
    warranty_policy TEXT DEFAULT '',product_key TEXT,is_active INTEGER DEFAULT 1,sort_order INTEGER DEFAULT 0);
    INSERT INTO product_catalog(guild_id,name,price,service_type) VALUES
      ('WEB','Discord Nitro Boost Login 1 Tháng',90000,'GAME'),
      ('WEB','ChatGPT Plus 1 Tháng',530000,'AI'),
      ('WEB','Spotify Premium 6 Tháng',190000,'spotify');`);
  const application = new Collection(CORE_UI_EMOJI_ASSETS.map((asset, i) => {
    const id = asset.name === 'cenar_ui27_music' ? '1569038518242508930' : String(1569038518242510000n + BigInt(i));
    return [id, { id, name: asset.name, animated: false }];
  }));
  client.application = { emojis: { cache: application } };
  const channels = new Collection();
  const role = { id: SHOP_RELAUNCH.memberRoleId, name: 'Member', managed: false, mentionable: true };
  const guild = { id: SHOP_RELAUNCH.guildId, members: { me: {}, resolve: () => null, cache: new Collection() },
    roles: { cache: new Collection([[role.id, role]]), fetch: async () => role },
    emojis: { cache: new Collection([[legacySpotify.id, legacySpotify]]) },
    channels: { cache: channels, fetch: async id => channels.get(id) } };
  client.guilds.cache.set(guild.id, guild);
  client.guilds.fetch = async () => guild;
  client.isReady = () => true;
  client.user = client.users._add({ id: '1282637033340403999', username: 'shopbot', discriminator: '0', avatar: null });
  let counter = 1570837985631412000n;
  const histories = new Map();
  const normalized = [];
  for (const id of [SHOP_RELAUNCH.channelId, SHOP_RELAUNCH.announcementChannelId]) {
    const history = new Collection(); histories.set(id, history);
    const channel = { id, guildId: guild.id, guild, client, isTextBased: () => true,
      permissionsFor: () => ({ has: () => true }),
      messages: { fetch: vi.fn(async query => typeof query === 'string' ? history.get(query)
        : new Collection([...history].sort(([a], [b]) => BigInt(a) > BigInt(b) ? -1 : 1)
          .filter(([key]) => !query.before || BigInt(key) < BigInt(query.before)).slice(0, query.limit))) },
      send: vi.fn(async payload => {
        const body = normalizeMessagePresentation(payload, guild.id);
        normalized.push({ payload, body });
        const message = new Message(client, { id: String(counter++), channel_id: id, guild_id: guild.id,
          author: { id: client.user.id, username: 'shopbot', discriminator: '0', avatar: null },
          type: 0, content: '', components: body.components, flags: 32768,
          mentions: [], mention_roles: payload.allowedMentions.roles, mention_everyone: false,
          attachments: [], embeds: [], timestamp: new Date().toISOString(), edited_timestamp: null });
        history.set(message.id, message); return message;
      }),
    };
    channels.set(id, channel); client.channels.cache.set(id, channel);
  }
  global.discordClient = client;
  resetAllEmojis(guild.id);
  const E = createEmojiResolver(guild.id);
  const prepared = prepareShopRelaunch({ dbInstance: catalog, E });
  state = { client, guild, catalog, application, channels, histories, normalized, E, prepared,
    run: () => publishShopRelaunch(client, { dbInstance: catalog, E, expectedPriceHash: prepared.priceHash }) };
});

afterEach(async () => {
  global.discordClient = oldGlobal;
  for (const { catalog, client } of resources.splice(0)) { catalog.close(); await client.destroy(); }
});
afterAll(() => emojiDb.close());

describe('real Spotify legacy alias normalization during relaunch recovery', () => {
  it('reproduces the live legacy logo to application music rewrite without relaxing text checks', async () => {
    expect(state.E('brand_spotify')).toBe(legacyText);
    const raw = state.prepared.payloads[2];
    const channel = state.channels.get(SHOP_RELAUNCH.channelId);
    const actual = await channel.send(raw);
    expect(I.textOf(raw)).toContain(`# ${legacyText} KHOẢNG`);
    expect(I.textOf(actual)).toContain('# <:cenar_ui27_music:1569038518242508930> KHOẢNG');
    expect(I.textOf(actual)).not.toBe(I.textOf(raw));
    expect(() => I.verify(actual, raw, channel.id, state.client.user.id, '3')).not.toThrow();
    const changedPrice = JSON.parse(JSON.stringify(normalizeMessagePresentation(raw, state.guild.id)));
    changedPrice.components[0].components.find(component => component.content?.includes('190.000đ')).content =
      changedPrice.components[0].components.find(component => component.content?.includes('190.000đ')).content.replace('190.000đ', '1.000đ');
    const tampered = { ...actual, toJSON: () => changedPrice };
    expect(() => I.verify(tampered, raw, channel.id, state.client.user.id, '3'))
      .toThrow('RELAUNCH_PUBLICATION_CONTENT_MISMATCH');
  });

  it('recovers a previously accepted third part and never repeats the Member ping on parts one or two', async () => {
    const channel = state.channels.get(SHOP_RELAUNCH.channelId);
    const original = channel.send.getMockImplementation();
    let attempt = 0;
    channel.send.mockImplementation(async payload => {
      const accepted = await original(payload);
      if (++attempt === 3) throw new Error('Third-part response lost after acceptance');
      return accepted;
    });
    await expect(state.run()).rejects.toMatchObject({ code: 'RELAUNCH_SEND_UNCERTAIN' });
    const interrupted = getShopRelaunchPublicationHealth({ dbInstance: state.catalog });
    expect(interrupted.parts.map(part => part.status)).toEqual(['SENT', 'SENT', 'SENDING']);
    const acceptedThirdId = [...state.histories.get(SHOP_RELAUNCH.channelId).values()]
      .find(message => I.textOf(message).includes(`${SHOP_RELAUNCH.revision}:PART-3`)).id;
    const result = await state.run();
    expect(result.status).toBe('DONE'); expect(result.links).toHaveLength(4);
    expect(result.parts.find(part => part.part === '3').message_id).toBe(acceptedThirdId);
    expect(channel.send).toHaveBeenCalledTimes(3);
    expect(state.channels.get(SHOP_RELAUNCH.announcementChannelId).send).toHaveBeenCalledTimes(1);
    expect(state.normalized.filter(({ payload }) => payload.allowedMentions.roles.length)).toHaveLength(1);
    expect(result.parts.every(part => part.verification.nativeEmojiCount === 0)).toBe(true);
  });

  it('rejects a normalization that loses a custom token instead of accepting missing artwork', async () => {
    const raw = state.prepared.payloads[2];
    state.guild.emojis.cache.delete(legacySpotify.id);
    state.application.delete('1569038518242508930');
    const channel = state.channels.get(SHOP_RELAUNCH.channelId);
    const actual = await channel.send(raw);
    expect(I.textOf(actual).match(/<a?:\w+:\d+>/g).length).toBeLessThan(I.textOf(raw).match(/<a?:\w+:\d+>/g).length);
    expect(() => I.verify(actual, raw, channel.id, state.client.user.id, '3'))
      .toThrow('RELAUNCH_PUBLICATION_CONTENT_MISMATCH');
  });
});

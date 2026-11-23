import fs from 'node:fs';
import { Collection, ChannelType, MessageFlags } from 'discord.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const databasePath = vi.hoisted(() => {
  const path = `./data/test-booking-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.test-booking-absent';
  process.env.DATABASE_PATH = path;
  return path;
});
import { db, initDatabase } from '../src/database/db.js';
import { STORE_TWO_GUILD_ID } from '../src/utils/locale.js';
import { bookingPanels, bookingPortal, bookingStoreSetupStatus, setupBookingStore } from '../src/services/bookingStoreSetupService.js';

beforeAll(() => initDatabase());
afterAll(() => {
  db.close();
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(databasePath + suffix, { force: true });
});

function setupGuild() {
  let nextId = 1521000000000000000n;
  const id = () => String(nextId++);
  const cache = new Collection();
  const emojis = new Collection();
  const unrepresented = { id: id(), name: 'unrepresented', type: 255, permission_overwrites: [] };
  const client = {
    user: { id: '1139187282075721768' },
    rest: { get: vi.fn(async () => [...cache.values()].map(row => ({
      id: row.id, name: row.name, type: row.type, parent_id: row.parentId, position: row.rawPosition,
      permission_overwrites: [...row.permissionOverwrites.cache.values()].map(item => ({
        id: item.id, type: item.type, allow: String(item.allow.bitfield), deny: String(item.deny.bitfield),
      })),
    })).concat(unrepresented)) },
  };
  const guild = {
    id: STORE_TWO_GUILD_ID, client, name: 'Cenar Global', features: ['COMMUNITY'],
    roles: { cache: new Collection(), fetch: async () => new Collection() }, members: {},
    emojis: {
      fetch: async () => emojis,
      create: vi.fn(async ({ name }) => {
        const icon = { id: id(), name, roles: { cache: new Collection() } };
        emojis.set(icon.id, icon);
        return icon;
      }),
    },
  };
  function channel({ name, type, parent, id: channelId = id(), availableTags, defaultReactionEmoji }) {
    const messages = new Collection();
    const row = {
      id: channelId, name, type, client, parentId: parent, rawPosition: cache.size,
      availableTags: availableTags?.map(tag => ({ ...tag, id: id() })), defaultReactionEmoji,
      permissionOverwrites: { cache: new Collection() },
      edit: vi.fn(async options => Object.assign(row, options)),
      setName: async value => Object.assign(row, { name: value }),
      setParent: vi.fn(async (value, options) => {
        expect(options.lockPermissions).toBe(false);
        return Object.assign(row, { parentId: value });
      }),
      messages: { fetch: async () => messages },
      send: vi.fn(async payload => {
        const attachments = new Collection((payload.files ?? []).map(file => [file.name, { id: id(), name: file.name }]));
        const message = {
          ...payload, id: id(), author: client.user, attachments,
          pinned: false, flags: new Set([MessageFlags.IsComponentsV2]),
          pin: async () => Object.assign(message, { pinned: true }),
          edit: vi.fn(async value => {
            for (const file of value.files ?? []) attachments.set(file.name, { id: id(), name: file.name });
            return Object.assign(message, { components: value.components });
          }),
        };
        messages.set(message.id, message);
        return message;
      }),
    };
    cache.set(row.id, row);
    return row;
  }
  guild.channels = {
    cache, fetch: async () => new Collection(cache).set(unrepresented.id, null),
    create: vi.fn(async options => channel(options)),
    setPositions: vi.fn(async positions => {
      for (const { channel: channelId, position } of positions) cache.get(channelId).rawPosition = position;
    }),
  };
  guild.setName = async name => Object.assign(guild, { name });
  client.guilds = { fetch: vi.fn(async () => guild) };
  const start = channel({ name: 'START HERE', type: ChannelType.GuildCategory });
  for (const [channelId, name] of [
    ['1514604934245384233', 'welcome'], ['1536693543463297104', 'rules'],
    ['1514594182717640735', 'announcements'], ['1514604946308464722', 'verify'],
    ['1536693550455070761', 'how-to-buy'], ['1514604974066237551', 'support-center'],
  ]) channel({ id: channelId, name, type: ChannelType.GuildText, parent: start.id });
  const support = cache.get('1514604974066237551');
  support.permissionOverwrites.cache.set(guild.id, {
    id: guild.id, type: 0, allow: { bitfield: 0n }, deny: { bitfield: 1024n },
  });
  const oldCommunity = channel({ name: '04 · CỘNG ĐỒNG & VOICE', type: ChannelType.GuildCategory });
  const oldLobby = channel({ name: 'Sảnh chờ', type: ChannelType.GuildVoice, parent: oldCommunity.id });
  oldLobby.permissionOverwrites.cache.set(guild.id, {
    id: guild.id, type: 0, allow: { bitfield: 0n }, deny: { bitfield: 1048576n },
  });
  return { client, guild, cache, support, emojis, oldLobby };
}

describe('Store 2 booking layout', () => {
  it('publishes only from the expected bot and keeps old channel IDs and permissions across repeated runs', async () => {
    const { client, guild, cache, support, oldLobby } = setupGuild();
    expect(await setupBookingStore({ ...client, user: { id: 'not-booking-bot' } }, guild.id)).toEqual({ status: 'not_configured' });
    expect(guild.channels.create).not.toHaveBeenCalled();
    const before = [...cache.keys()];
    const result = await setupBookingStore(client, guild.id);
    expect(result).toMatchObject({ status: 'ready', revision: 'CENAR-BOOKING-CHECKOUT-20261123',
      existingChannelsRetained: before.length + 1, bookingChannels: 11, guidesPinned: 8, forums: 2, customEmoji: 12 });
    expect(bookingStoreSetupStatus(client)).toBe(result);
    expect(guild.name).toBe('Cenar Booking');
    expect(before.every(channelId => cache.has(channelId))).toBe(true);
    expect(support.permissionOverwrites.cache.get(guild.id).deny.bitfield).toBe(1024n);
    expect(oldLobby.permissionOverwrites.cache.get(guild.id).deny.bitfield).toBe(1048576n);
    expect(cache.get(oldLobby.parentId).name).toContain('𝐕𝐨𝐢𝐜𝐞');
    expect(bookingPortal(client).voiceChannels).toContain(oldLobby.id);
    expect(cache.get(cache.get(bookingPortal(client).games).parentId).name).toContain('𝐆𝐚𝐦𝐞𝐬');
    const directory = cache.find(channel => channel.name === '✰・𝑽𝑰𝑷-𝑷𝑹𝑶𝑭𝑰𝑳𝑬');
    expect(directory.availableTags.map(tag => tag.name)).toEqual(['Nam', 'Nữ', 'Chơi game', 'Trò chuyện']);
    expect(directory.availableTags.every(tag => /^\d+$/.test(tag.emoji.id))).toBe(true);
    const firstChannelCount = cache.size;
    expect(guild.channels.setPositions).toHaveBeenCalledOnce();
    for (const channel of cache.values()) channel.rawPosition = channel.rawPosition * 2 + 3;
    await setupBookingStore(client, guild.id);
    expect(cache.size).toBe(firstChannelCount);
    expect(guild.channels.setPositions).toHaveBeenCalledOnce();
    expect([...cache.values()].reduce((n, channel) => n + channel.send.mock.calls.length, 0)).toBe(8);
    const ticketCategory = cache.get(bookingPortal(client).tickets);
    expect(ticketCategory.name).toBe('----- ☬ 𝐏𝐡𝐢ế𝐮 𝐁𝐨𝐨𝐤𝐢𝐧𝐠 ☬ ------');
    const creation = guild.channels.create.mock.calls.find(([options]) => options.name === ticketCategory.name)[0];
    expect(creation.permissionOverwrites[0]).toEqual({ id: guild.id, deny: [1024n] });
  });

  it('omits missing emoji and opens service-specific booking forms', () => {
    const channels = Object.fromEntries(['profiles', 'request', 'rules', 'welcome', 'support', 'handbook', 'apply', 'games', 'events'].map((key, i) => [
      key, { id: String(1500000000000000000n + BigInt(i)) },
    ]));
    const panels = bookingPanels(STORE_TWO_GUILD_ID, channels, {});
    const content = panels.request.components[0].toJSON();
    const [auto, game, voice] = content.components.filter(item => item.type === 9).map(item => item.accessory);
    expect(auto.custom_id).toBe('booking:dashboard:auto');
    expect(game.custom_id).toBe('booking:open:game');
    expect(voice.custom_id).toBe('booking:open:voice');
    expect(game.emoji).toBeUndefined();
    expect(content.components.flatMap(item => item.components ?? []).map(item => item.custom_id)).toContain('booking:dashboard:hosts');
    const shortcuts = panels.games.components[0].toJSON().components.flatMap(item => item.components ?? []);
    expect(shortcuts.map(item => item.custom_id)).toEqual(['words-vi', 'words-en', 'checkin', 'missions', 'shop', 'leaderboard']
      .map(action => `booking:shortcut:${action}`));
    expect(JSON.stringify(content)).not.toMatch(/\p{Extended_Pictographic}|<a?:\w+:\d+>/u);
    expect(panels.welcome.components[0].toJSON().components[0].items[0]).toMatchObject({
      media: { url: 'attachment://cenar-booking-header.webp' }, description: expect.stringContaining('Cenar Booking'),
    });
    expect(fs.statSync(panels.welcome.files[0].attachment).size).toBeLessThan(100_000);
  });

  it('styles previously published panels and forum tags using available server emoji on a full server', async () => {
    const { client, guild, cache, emojis } = setupGuild();
    guild.emojis.create.mockRejectedValue(new Error('Emoji slots are full'));
    expect(await setupBookingStore(client, guild.id)).toMatchObject({ customEmoji: 0 });
    const profiles = cache.find(channel => channel.name === '✰・𝑽𝑰𝑷-𝑷𝑹𝑶𝑭𝑰𝑳𝑬');
    const tags = profiles.availableTags.map(tag => tag.id);
    const request = cache.find(channel => channel.name === '˖ი𐑼⋆𝑻𝑰𝑪𝑲𝑬𝑻');
    const message = (await request.messages.fetch()).first();
    for (const [index, name] of ['pepenoted', 'blobcathug', '2558keroppiwave', 'starxoay'].entries()) {
      const emojiId = String(1523000000000000000n + BigInt(index));
      emojis.set(emojiId, { id: emojiId, name, available: true, roles: { cache: new Collection() } });
    }
    expect(await setupBookingStore(client, guild.id)).toMatchObject({ customEmoji: 4 });
    expect(profiles.availableTags.map(tag => tag.id)).toEqual(tags);
    expect(profiles.availableTags[0].emoji.id).toBe('1523000000000000002');
    expect(profiles.defaultReactionEmoji.id).toBe('1523000000000000003');
    expect(message.edit.mock.calls).toHaveLength(1);
    expect(message.components[0].toJSON().components[0].content).toContain('<:pepenoted:1523000000000000000>');
    expect(message.pinned).toBe(true);
    expect(request.send.mock.calls).toHaveLength(1);
    await setupBookingStore(client, guild.id);
    expect(message.edit.mock.calls).toHaveLength(1);
    expect(profiles.edit.mock.calls).toHaveLength(1);
  });

  it('updates an old pinned panel in place even when the custom emoji inventory is unchanged', async () => {
    const { client, guild, cache } = setupGuild();
    await setupBookingStore(client, guild.id);
    const request = cache.find(channel => channel.name === '˖ი𐑼⋆𝑻𝑰𝑪𝑲𝑬𝑻');
    const message = (await request.messages.fetch()).first();
    const old = message.components.map(component => component.toJSON());
    old[0].components.find(item => item.type === 1).components[0].custom_id = 'ticket:create:SUPPORT';
    message.components = old;
    await setupBookingStore(client, guild.id);
    expect(message.pinned).toBe(true);
    expect(message.edit).toHaveBeenCalledTimes(1);
    expect(request.send).toHaveBeenCalledTimes(1);
  });

  it('repairs a missing banner once and accepts the resolved Discord attachment URL', async () => {
    const { client, guild, cache } = setupGuild();
    await setupBookingStore(client, guild.id);
    const welcome = cache.get('1514604934245384233');
    const message = (await welcome.messages.fetch()).first();
    const content = message.components.map(component => component.toJSON());
    content[0].components[0].items[0].media.url = `https://cdn.discordapp.com/attachments/${welcome.id}/${message.id}/cenar-booking-header.webp?ex=fixture`;
    message.components = content;
    await setupBookingStore(client, guild.id);
    expect(message.edit).not.toHaveBeenCalled();
    message.attachments.clear();
    await setupBookingStore(client, guild.id);
    expect(message.edit).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.objectContaining({ name: 'cenar-booking-header.webp' })] }));
    await setupBookingStore(client, guild.id);
    expect(message.edit).toHaveBeenCalledTimes(1);
    expect(welcome.send).toHaveBeenCalledTimes(1);
  });
});

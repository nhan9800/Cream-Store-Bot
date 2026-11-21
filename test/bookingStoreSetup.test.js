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
import { bookingPanels, bookingStoreSetupStatus, setupBookingStore } from '../src/services/bookingStoreSetupService.js';

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
  function channel({ name, type, parent, id: channelId = id(), availableTags }) {
    const messages = new Collection();
    const row = {
      id: channelId, name, type, client, parentId: parent, rawPosition: cache.size,
      availableTags,
      permissionOverwrites: { cache: new Collection() },
      setName: async value => Object.assign(row, { name: value }),
      setParent: vi.fn(async (value, options) => {
        expect(options.lockPermissions).toBe(false);
        return Object.assign(row, { parentId: value });
      }),
      messages: { fetch: async () => messages },
      send: vi.fn(async payload => {
        const message = {
          ...payload, id: id(), author: client.user, attachments: new Collection(),
          pinned: false, flags: new Set([MessageFlags.IsComponentsV2]),
          pin: async () => Object.assign(message, { pinned: true }),
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
    setPositions: async positions => {
      for (const { channel: channelId, position } of positions) cache.get(channelId).rawPosition = position;
    },
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
  return { client, guild, cache, support };
}

describe('Store 2 booking layout', () => {
  it('publishes only from the expected bot and keeps old channel IDs and permissions across repeated runs', async () => {
    const { client, guild, cache, support } = setupGuild();
    expect(await setupBookingStore({ ...client, user: { id: 'not-booking-bot' } }, guild.id)).toEqual({ status: 'not_configured' });
    expect(guild.channels.create).not.toHaveBeenCalled();
    const before = [...cache.keys()];
    const result = await setupBookingStore(client, guild.id);
    expect(result).toMatchObject({ status: 'ready', existingChannelsRetained: before.length + 1, bookingChannels: 8,
      guidesPinned: 5, forums: 2, customEmoji: 12 });
    expect(bookingStoreSetupStatus(client)).toBe(result);
    expect(guild.name).toBe('Cenar Booking');
    expect(before.every(channelId => cache.has(channelId))).toBe(true);
    expect(support.permissionOverwrites.cache.get(guild.id).deny.bitfield).toBe(1024n);
    const directory = cache.find(channel => channel.name === 'ho-so-host');
    expect(directory.availableTags.map(tag => tag.name)).toEqual(['Nam', 'Nữ', 'Chơi game', 'Trò chuyện']);
    expect(directory.availableTags.every(tag => /^\d+$/.test(tag.emoji.id))).toBe(true);
    const firstChannelCount = cache.size;
    await setupBookingStore(client, guild.id);
    expect(cache.size).toBe(firstChannelCount);
    expect([...cache.values()].reduce((n, channel) => n + channel.send.mock.calls.length, 0)).toBe(5);
  });

  it('omits missing emoji and gives the booking button the existing support ticket action', () => {
    const channels = Object.fromEntries(['profiles', 'request', 'rules', 'welcome', 'support'].map((key, i) => [
      key, { id: String(1500000000000000000n + BigInt(i)) },
    ]));
    const panels = bookingPanels(STORE_TWO_GUILD_ID, channels, {});
    const content = panels.request.components[0].toJSON();
    const button = content.components.find(item => item.type === 1).components[0];
    expect(button.custom_id).toBe('ticket:create:SUPPORT');
    expect(button.emoji).toBeUndefined();
    expect(JSON.stringify(content)).not.toMatch(/\p{Extended_Pictographic}|<a?:\w+:\d+>/u);
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ChannelType, OverwriteType } from 'discord.js';

const testDatabasePath = vi.hoisted(() => {
  const relativePath = `./data/test-guild-recovery-${process.pid}-${Date.now()}.sqlite`;
  process.env.ENV_FILE = '.env.test-guild-recovery-not-present';
  process.env.DATABASE_PATH = relativePath;
  process.env.ENCRYPTION_KEY = 'test-guild-recovery-key';
  return relativePath;
});

import { db, initDatabase } from '../src/database/db.js';
import { getRecoveryRoleMapping, mapRecoveryRoleIds, restoreGuildStructure } from '../src/services/guildRecoveryService.js';
import { addMemberToGuild, syncMemberRoles } from '../src/commands/chuyen-server.js';

function makeRole(id, name, overrides = {}) {
  return {
    id,
    name,
    managed: false,
    editable: true,
    position: 1,
    edit: vi.fn(async (options) => Object.assign(role, options)),
    ...overrides,
  };
}

function makeTargetGuild() {
  const edits = [];
  const rolePositions = [];
  const channelPositions = [];
  let roleSequence = 0;
  let channelSequence = 0;

  const roles = new Map();
  const channels = new Map();
  const emojis = new Map();
  const stickers = new Map();

  const roleManager = {
    cache: roles,
    fetch: vi.fn(async () => roles),
    create: vi.fn(async (options) => {
      roleSequence += 1;
      const role = makeRole(`target-role-${roleSequence}`, options.name, options);
      roles.set(role.id, role);
      return role;
    }),
    setPositions: vi.fn(async (positions) => { rolePositions.push(...positions); }),
  };

  const channelManager = {
    cache: channels,
    fetch: vi.fn(async () => channels),
    create: vi.fn(async (options) => {
      channelSequence += 1;
      const permissionOverwrites = {
        set: vi.fn(async () => undefined),
      };
      const channel = {
        id: `target-channel-${channelSequence}`,
        name: options.name,
        type: options.type,
        parentId: options.parent || null,
        permissionOverwrites,
        edit: vi.fn(async (editOptions) => Object.assign(channel, editOptions)),
      };
      channels.set(channel.id, channel);
      return channel;
    }),
    setPositions: vi.fn(async (positions) => { channelPositions.push(...positions); }),
  };

  const emojiManager = {
    cache: emojis,
    fetch: vi.fn(async () => emojis),
    create: vi.fn(async (options) => {
      const emoji = { id: `target-emoji-${emojis.size + 1}`, name: options.name };
      emojis.set(emoji.id, emoji);
      return emoji;
    }),
  };

  const stickerManager = {
    cache: stickers,
    fetch: vi.fn(async () => stickers),
    create: vi.fn(async (options) => {
      const sticker = { id: `target-sticker-${stickers.size + 1}`, name: options.name };
      stickers.set(sticker.id, sticker);
      return sticker;
    }),
  };

  return {
    id: '9876543210987654321',
    roles: roleManager,
    channels: channelManager,
    emojis: emojiManager,
    stickers: stickerManager,
    edit: vi.fn(async (options) => { edits.push(options); }),
    _edits: edits,
    _rolePositions: rolePositions,
    _channelPositions: channelPositions,
  };
}

describe('guild recovery structure and role mapping', () => {
  beforeAll(() => initDatabase());

  afterAll(() => {
    db.close();
    const absolutePath = path.resolve(process.cwd(), testDatabasePath);
    for (const suffix of ['', '-shm', '-wal']) fs.rmSync(`${absolutePath}${suffix}`, { force: true });
  });

  it('clones identity, hierarchy, channels, emoji and stickers from a snapshot', async () => {
    const sourceGuildId = '1234567890123456789';
    db.prepare(`
      INSERT OR REPLACE INTO guild_recovery_snapshots
        (guild_id, captured_at, structure_hash, snapshot_json, member_count, authorized_member_count, customer_count)
      VALUES (?, ?, ?, ?, 3, 1, 1)
    `).run(sourceGuildId, '2026-09-22T00:00:00.000Z', 'test-hash', JSON.stringify({
      version: 2,
      guild: {
        name: 'Cenar Store',
        description: 'Recovery copy',
        verificationLevel: 1,
        defaultMessageNotifications: 1,
        explicitContentFilter: 1,
        preferredLocale: 'vi',
        afkTimeout: 300,
        premiumProgressBarEnabled: true,
        systemChannelId: 'source-text',
      },
      roles: [
        { id: sourceGuildId, name: '@everyone', managed: false, position: 0, permissions: '0' },
        {
          id: 'source-role',
          name: 'Cenar Member',
          managed: false,
          position: 2,
          color: 0x123456,
          hoist: true,
          mentionable: true,
          permissions: '8',
          iconAssetData: Buffer.from('role-icon').toString('base64'),
        },
      ],
      channels: [
        { id: 'source-category', name: 'STORE', type: ChannelType.GuildCategory, position: 0, permissionOverwrites: [] },
        {
          id: 'source-text',
          name: 'verify',
          type: ChannelType.GuildText,
          position: 1,
          parentId: 'source-category',
          topic: 'Verify here',
          nsfw: false,
          rateLimitPerUser: 0,
          permissionOverwrites: [{ id: 'source-role', type: OverwriteType.Role, allow: '1024', deny: '0' }],
        },
      ],
      emojis: [{ id: 'source-emoji', name: 'cenar', assetData: Buffer.from('emoji').toString('base64') }],
      stickers: [{
        id: 'source-sticker',
        name: 'welcome',
        tags: 'wave',
        description: 'Welcome',
        assetData: Buffer.from('sticker').toString('base64'),
      }],
    }));

    const targetGuild = makeTargetGuild();
    const result = await restoreGuildStructure(sourceGuildId, targetGuild);

    expect(result.failures).toEqual([]);
    expect(result.created).toMatchObject({ roles: 1, channels: 2, emojis: 1, stickers: 1 });
    expect(targetGuild._edits[0]).toMatchObject({ name: 'Cenar Store', description: 'Recovery copy' });
    expect(targetGuild._edits.at(-1)).toMatchObject({ systemChannel: 'target-channel-2' });
    expect(targetGuild._rolePositions).toEqual([{ role: 'target-role-1', position: 2 }]);
    expect(targetGuild._channelPositions).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'target-channel-1', position: 0 }),
      expect.objectContaining({ channel: 'target-channel-2', position: 1, parent: 'target-channel-1' }),
    ]));
    expect(targetGuild.roles.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Cenar Member',
      permissions: 8n,
      icon: expect.any(Buffer),
    }));
    expect(targetGuild.stickers.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'welcome', tags: 'wave' }));
  });

  it('falls back safely for malformed legacy permission bits', async () => {
    const sourceGuildId = '1234567890123456790';
    db.prepare(`
      INSERT OR REPLACE INTO guild_recovery_snapshots
        (guild_id, captured_at, structure_hash, snapshot_json, member_count, authorized_member_count, customer_count)
      VALUES (?, ?, ?, ?, 0, 0, 0)
    `).run(sourceGuildId, '2026-09-22T00:00:00.000Z', 'legacy-hash', JSON.stringify({
      version: 1,
      guild: { name: 'Legacy recovery' },
      roles: [{
        id: 'legacy-role',
        name: 'Legacy Role',
        managed: false,
        position: 1,
        permissions: 'not-a-number',
      }],
      channels: [{
        id: 'legacy-channel',
        name: 'legacy',
        type: ChannelType.GuildText,
        position: 0,
        parentId: null,
        permissionOverwrites: [{ id: 'legacy-role', type: OverwriteType.Role, allow: 'bad', deny: null }],
      }],
      emojis: [],
    }));

    const targetGuild = makeTargetGuild();
    const result = await restoreGuildStructure(sourceGuildId, targetGuild);

    expect(result.failures).toEqual([]);
    expect(targetGuild.roles.create).toHaveBeenCalledWith(expect.objectContaining({ permissions: 0n }));
    expect(targetGuild.channels.create).toHaveBeenCalledWith(expect.objectContaining({
      permissionOverwrites: [expect.objectContaining({ allow: 0n, deny: 0n })],
    }));
  });

  it('maps role names case-insensitively while excluding managed or higher roles', () => {
    const targetRoles = new Map([
      ['one', { id: 'one', name: 'CENAR MEMBER', managed: false, editable: true }],
      ['two', { id: 'two', name: 'Bot Managed', managed: true, editable: true }],
      ['three', { id: 'three', name: 'Too High', managed: false, editable: false }],
    ]);
    const guild = {
      roles: { cache: targetRoles },
    };
    expect(mapRecoveryRoleIds(JSON.stringify([{ name: 'cenar member' }, { name: 'Bot Managed' }, { name: 'Too High' }]), guild)).toEqual(['one']);
    expect(getRecoveryRoleMapping(JSON.stringify([{ name: 'cenar member' }, { name: 'Bot Managed' }, { name: 'Too High' }]), guild).skipped)
      .toEqual(['Bot Managed', 'Too High (vượt role cao nhất của bot)']);
    expect(getRecoveryRoleMapping('{}', guild)).toEqual({ ids: [], skipped: [] });
    expect(getRecoveryRoleMapping('null', guild)).toEqual({ ids: [], skipped: [] });
  });
});

describe('guild recovery member migration helpers', () => {
  it('honours Discord retry_after before retrying a rate limited add', async () => {
    const responses = [
      {
        status: 429,
        headers: { get: () => '0.001' },
        json: async () => ({ message: 'rate limited', retry_after: 0.001 }),
      },
      { status: 201, headers: { get: () => null }, json: async () => ({}) },
    ];
    const fetchImpl = vi.fn(async () => responses.shift());
    const sleeps = [];
    const result = await addMemberToGuild(
      '9876543210987654321',
      '1111111111111111111',
      'user-access-token',
      'bot-token',
      ['target-role'],
      { fetchImpl, sleep: async (ms) => sleeps.push(ms) },
    );

    expect(result).toMatchObject({ status: 201, ok: true, retries: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([50]);
  });

  it('retries transient network failures when adding a member', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('socket reset'))
      .mockResolvedValueOnce({ status: 201, headers: { get: () => null }, json: async () => ({}) });
    const sleeps = [];

    const result = await addMemberToGuild(
      '9876543210987654321',
      '1111111111111111111',
      'user-access-token',
      'bot-token',
      [],
      { fetchImpl, sleep: async (ms) => sleeps.push(ms) },
    );

    expect(result).toMatchObject({ status: 201, ok: true, retries: 1 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([250]);
  });

  it('adds missing roles when the OAuth add endpoint reports an existing member', async () => {
    const add = vi.fn(async () => undefined);
    const targetGuild = {
      members: {
        fetch: vi.fn(async () => ({
          roles: { cache: new Map([['already', {}]]), add },
        })),
      },
    };
    const result = await syncMemberRoles(targetGuild, '1111111111111111111', ['already', 'missing']);
    expect(result).toEqual({ synced: 1, missing: 0, error: '' });
    expect(add).toHaveBeenCalledWith(['missing'], expect.stringContaining('recovery'));
  });
});
